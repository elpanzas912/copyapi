// Worker: procesa jobs de la cola.
// Flujo: subir privado (Studio) -> polling get_creator_videos hasta copyright COMPLETED
//        -> (si hay claims) list_creator_received_claims + matches -> borrar -> reporte
import fs from "node:fs";
import { config } from "./config.js";
import { StudioUploader } from "./uploader.js";
import { StudioClient } from "./studio-client.js";
import { getJob, updateJob } from "./store.js";

const uploader = new StudioUploader(config.studio);
const studio = new StudioClient(config.studio);

export async function processJob(jobId) {
  let job = getJob(jobId);
  if (!job) return;

  const timeout = setTimeout(
    () => fail(jobId, `Job timeout tras ${config.worker.jobTimeoutMs / 60000} min`),
    config.worker.jobTimeoutMs
  );

  try {
    // 1) Subida privada via flujo de Studio
    updateJob(jobId, { status: "uploading" });
    const videoId = await uploader.uploadPrivateVideo({
      filePath: job.input.filepath,
      title: `check ${job.id.slice(0, 8)}`,
    });
    updateJob(jobId, { videoId, status: "checking" });

    // 2) Polling del resultado de copyright
    const result = await pollCopyright(videoId);

    // 3) Detalle de claims si hay
    let claims = [];
    if (result.activeClaimsCount > 0 || result.thirdPartyClaim) {
      claims = await studio.listReceivedClaims(videoId);
      for (const claim of claims) {
        claim.segments = await studio
          .getClaimMatches(videoId, claim.claimId)
          .catch(() => []);
      }
    }

    updateJob(jobId, { status: "done", result: { ...result, claims } });
  } catch (err) {
    fail(jobId, err.message);
  } finally {
    // 4) Borrar el video canario SIEMPRE (salvo configuracion contraria)
    const current = getJob(jobId);
    const vid = current?.videoId;
    if (vid && config.worker.alwaysDeleteVideo) {
      try {
        await studio.deleteVideo(vid);
      } catch (err) {
        console.error(`[job ${jobId}] fallo el borrado del video ${vid}:`, err.message);
      }
    }
    // 5) Limpiar archivo local y notificar webhook
    try {
      fs.unlinkSync(current.input.filepath);
    } catch {}
    notifyWebhook(getJob(jobId));
    clearTimeout(timeout);
  }
}

async function pollCopyright(videoId) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < config.worker.jobTimeoutMs) {
    const status = await studio.getCreatorVideos(videoId);
    if (status.found) {
      last = status;
      const completed =
        status.copyrightCheckStatus ===
        "UPLOAD_CHECKS_DATA_COPYRIGHT_STATUS_COMPLETED";
      if (completed) return status;
    }
    await sleep(config.worker.studioPollMs);
  }
  throw new Error(
    `El escaneo de copyright no completo a tiempo. Ultimo estado: ${
      last?.copyrightCheckStatus || "sin datos"
    }`
  );
}

function fail(jobId, message) {
  console.error(`[job ${jobId}] ERROR:`, message);
  updateJob(jobId, { status: "error", error: message });
}

function notifyWebhook(job) {
  const url = job?.input?.webhookUrl;
  if (!url) return;
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
    }),
  }).catch((err) => console.error(`[job ${job.id}] webhook fallo:`, err.message));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
