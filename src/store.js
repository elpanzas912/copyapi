// Store de jobs en JSON persistente (suficiente para el volumen de esta API).
// Un job por archivo en /data/jobs/<id>.json; estado también en memoria.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const jobsDir = process.env.JOBS_DIR || "/data/jobs";

fs.mkdirSync(jobsDir, { recursive: true });

export function createJob(input) {
  const id = crypto.randomUUID();
  const job = {
    id,
    status: "queued", // queued | uploading | checking | done | error
    createdAt: Date.now(),
    updatedAt: Date.now(),
    input, // { filename, filepath, sizeBytes, webhookUrl }
    videoId: null,
    result: null,
    error: null,
    history: [],
  };
  persist(job);
  return job;
}

export function getJob(id) {
  const file = path.join(jobsDir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function updateJob(id, patch) {
  const job = getJob(id);
  if (!job) return null;
  const next = {
    ...job,
    ...patch,
    history: [...(job.history || []), { at: Date.now(), status: job.status }],
    updatedAt: Date.now(),
  };
  persist(next);
  return next;
}

export function listJobs() {
  return fs
    .readdirSync(jobsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(jobsDir, f), "utf8")))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function persist(job) {
  const file = path.join(jobsDir, `${job.id}.json`);
  fs.writeFileSync(file, JSON.stringify(job, null, 2));
}

export function publicJob(job) {
  // Nunca exponer filepath ni webhookUrl
  const { input, ...rest } = job;
  return {
    ...rest,
    filename: input?.filename,
    sizeBytes: input?.sizeBytes,
  };
}
