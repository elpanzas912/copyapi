// Subida de videos al canal canario via YouTube Data API v3 (resumable upload).
// OAuth2 con refresh token -> access token.
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

export class YouTubeUploader {
  constructor({ clientId, clientSecret, refreshToken }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  async #getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`token HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  async #apiFetch(url, options = {}) {
    const token = await this.#getAccessToken();
    return fetch(url, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  }

  // Sube un video PRIVADO con resumable upload. Devuelve el videoId.
  async uploadPrivateVideo({ filePath, fileSize, title = "copy check" }) {
    const metadata = {
      snippet: {
        title: title.slice(0, 100),
        description: "canary check",
        categoryId: "22", // People & Blogs
      },
      status: {
        privacyStatus: "private",
        selfDeclaredMadeForKids: false,
      },
    };

    // 1) Iniciar sesión resumable
    const initRes = await this.#apiFetch(
      `${UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(fileSize),
          "x-upload-content-type": "video/mp4",
        },
        body: JSON.stringify(metadata),
      }
    );
    if (!initRes.ok) {
      const text = await initRes.text().catch(() => "");
      throw new Error(`upload init HTTP ${initRes.status}: ${text.slice(0, 500)}`);
    }
    const sessionUrl = initRes.headers.get("location");
    if (!sessionUrl) throw new Error("upload init no devolvio location");

    // 2) Subir el archivo en chunks de 8MB con reintentos
    const CHUNK = 8 * 1024 * 1024;
    const { createReadStream } = await import("node:fs");
    const { statSync } = await import("node:fs");

    let offset = 0;
    let finalRes = null;
    while (offset < fileSize) {
      const end = Math.min(offset + CHUNK, fileSize) - 1;
      const stream = createReadStream(filePath, { start: offset, end });
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      const buf = Buffer.concat(chunks);

      finalRes = await fetch(sessionUrl, {
        method: "PUT",
        headers: {
          "content-length": String(buf.length),
          "content-range": `bytes ${offset}-${end}/${fileSize}`,
        },
        body: buf,
      });

      if (finalRes.status === 308) {
        offset = end + 1;
        continue; // seguir subiendo
      }
      if (finalRes.ok) break;
      // 5xx: consultar progreso y reintentar el rango pendiente
      if (finalRes.status >= 500) {
        const statusRes = await fetch(sessionUrl, {
          method: "PUT",
          headers: { "content-range": `bytes */${fileSize}` },
        });
        const range = statusRes.headers.get("range");
        if (range) {
          offset = Number(range.match(/-(\d+)/)?.[1] || 0) + 1;
          continue;
        }
      }
      const text = await finalRes.text().catch(() => "");
      throw new Error(
        `upload chunk HTTP ${finalRes.status}: ${text.slice(0, 500)}`
      );
    }

    if (!finalRes || !finalRes.ok) {
      throw new Error(`upload finalizo sin exito: ${finalRes?.status}`);
    }
    const video = await finalRes.json();
    return video.id;
  }

  // Borrar el video canario.
  async deleteVideo(videoId) {
    const res = await this.#apiFetch(`${VIDEOS_URL}?id=${videoId}`, {
      method: "DELETE",
    });
    // 204 = ok, 404 = ya no existe (ok para nosotros)
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new Error(`delete HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return true;
  }
}
