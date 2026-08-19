// Configuración central: todo por variables de entorno, nada hardcodeado.
const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
};

export const config = {
  port: Number(process.env.PORT || 3000),
  apiKey: process.env.API_KEY || "", // auth de la propia API

  // Canal canario (YouTube Data API v3, OAuth refresh token)
  google: {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    refreshToken: required("GOOGLE_REFRESH_TOKEN"),
  },

  // Sesión de YouTube Studio (cookies exportadas)
  studio: {
    // Cookie header completo, ej: "SID=...; HSID=...; SSID=...; SAPISID=...; __Secure-3PAPISID=..."
    cookie: required("STUDIO_COOKIE"),
    // ID del canal canario (UC...)
    channelId: required("STUDIO_CHANNEL_ID"),
    clientVersion: process.env.STUDIO_CLIENT_VERSION || "1.20260815.00.01",
  },

  worker: {
    // Intervalos de polling (ms)
    studioPollMs: Number(process.env.STUDIO_POLL_MS || 10000),
    // Timeout total del job (ms) - default 30 min
    jobTimeoutMs: Number(process.env.JOB_TIMEOUT_MS || 30 * 60 * 1000),
    // Borrar el video canario siempre (default true)
    alwaysDeleteVideo: process.env.ALWAYS_DELETE_VIDEO !== "false",
    maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS || 1),
  },

  storage: {
    uploadsDir: process.env.UPLOADS_DIR || "/data/uploads",
    dbPath: process.env.DB_PATH || "/data/jobs.db",
  },
};
