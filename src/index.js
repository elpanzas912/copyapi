// API HTTP: POST /check (multipart), GET /check/:id, GET /jobs, GET /health
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { createJob, getJob, listJobs, publicJob } from "./store.js";
import { processJob } from "./worker.js";

const app = express();
app.use(express.json());

// Auth simple por API key
app.use((req, res, next) => {
  if (!config.apiKey) return next(); // sin auth si no se configura
  const provided =
    req.get("x-api-key") ||
    (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (provided !== config.apiKey) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// POST /check: acepta multipart con campo "video" y opcional "webhookUrl"
app.post("/check", async (req, res) => {
  // Acepta tambien multipart via busboy-like manual: usamos express.raw para JSON
  // (la subida multipart se maneja abajo con un middleware simple)
  res.status(400).json({ error: "use multipart/form-data con campo video" });
});

// Parser multipart minimo (sin dependencias extra)
import { Readable } from "node:stream";

app.use("/check", async (req, res, next) => {
  if (req.method !== "POST") return next();
  const ct = req.headers["content-type"] || "";
  if (!ct.startsWith("multipart/form-data")) {
    return res
      .status(400)
      .json({ error: "use multipart/form-data con campo video" });
  }
  const boundary = `--${ct.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || ct.match(/boundary=([^;]+)/)?.[1]}`;
  if (!boundary || boundary === "--") {
    return res.status(400).json({ error: "boundary multipart invalido" });
  }
  try {
    const parts = await parseMultipart(req, boundary);
    req.body = { webhookUrl: parts.fields.webhookUrl };
    req.file = parts.files.video || null;
    next();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/check", async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "falta el campo video" });
  }
  const id = crypto.randomUUID();
  const destDir = config.storage.uploadsDir;
  fs.mkdirSync(destDir, { recursive: true });
  const filepath = path.join(destDir, `${id}${path.extname(req.file.filename || ".mp4")}`);

  await fs.promises.writeFile(filepath, req.file.data);

  const job = createJob({
    filename: req.file.filename || "video.mp4",
    filepath,
    sizeBytes: req.file.data.length,
    webhookUrl: req.body?.webhookUrl || null,
  });

  // Procesar async
  setImmediate(() => processJob(job.id).catch((err) => console.error(err)));

  res.status(202).json({ job_id: job.id, status: "queued", poll: `/check/${job.id}` });
});

app.get("/check/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job no encontrado" });
  res.json(publicJob(job));
});

app.get("/jobs", (req, res) => {
  res.json(listJobs().map(publicJob));
});

// ---- multipart parser (multipart/form-data simple) ----
async function parseMultipart(req, boundary) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const fields = {};
  const files = {};
  const delim = Buffer.from(boundary);

  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    const next = buf.indexOf(delim, pos + delim.length);
    if (next === -1) break;
    // part = entre el fin del boundary+CRLF y el CRLF antes del siguiente boundary
    const start = pos + delim.length + 2; // skip \r\n
    const end = next - 2;
    if (end <= start) {
      pos = next;
      continue;
    }
    const part = buf.subarray(start, end);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const body = part.subarray(headerEnd + 4);
      const name = headers.match(/name="([^"]*)"/)?.[1];
      const filename = headers.match(/filename="([^"]*)"/)?.[1];
      if (name) {
        if (filename !== undefined) {
          files[name] = { filename, data: body };
        } else {
          fields[name] = body.toString("utf8");
        }
      }
    }
    pos = next;
  }
  return { fields, files };
}

app.listen(config.port, () => {
  console.log(`API escuchando en puerto ${config.port}`);
});
