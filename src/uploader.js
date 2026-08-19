// Subida de videos al canal canario replicando el flujo nativo de YouTube Studio.
// Auth: mismas cookies de Studio. Sin OAuth, sin quota de Data API.
//
// Flujo (extraido del HAR):
// 1) POST https://upload.youtube.com/upload/studio?authuser=0
//    body: {"frontendUploadId":"innertube_studio:<uuid>:0"}
//    -> headers de respuesta: x-goog-upload-url (sesion resumable)
//
// 2) PUT/POST a x-goog-upload-url con headers:
//    x-goog-upload-command: upload, finalize
//    x-goog-upload-file-name: <filename urlencoded>
//    x-goog-upload-offset: 0
//    body: bytes del video
//    -> response JSON: { status: "STATUS_SUCCESS", scottyResourceId: "..." }
//
// 3) POST youtubei/v1/upload/createvideo con el scottyResourceId
//    -> response: { videoId: "..." }
import crypto from "node:crypto";

const UPLOAD_INIT_URL = "https://upload.youtube.com/upload/studio?authuser=1";

export class StudioUploader {
  constructor({ cookie, clientVersion, userAgent }) {
    this.cookie = cookie;
    this.clientVersion = clientVersion || "1.20260815.00.01";
    this.userAgent =
      userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
  }

  #sapisidHash() {
    const m =
      this.cookie.match(/SAPISID=([^;]+)/) ||
      this.cookie.match(/__Secure-3PAPISID=([^;]+)/);
    if (!m) throw new Error("Cookie sin SAPISID/__Secure-3PAPISID");
    const sapisid = m[1].trim();
    const ts = Math.floor(Date.now() / 1000);
    const origin = "https://studio.youtube.com";
    const sha1 = crypto
      .createHash("sha1")
      .update(`${ts} ${sapisid}`)
      .update(`${origin} ${sapisid}`)
      .digest("hex");
    return `SAPISIDHASH ${ts}_${sha1}`;
  }

  async uploadPrivateVideo({ filePath, title = "copy check" }) {
    const { readFile } = await import("node:fs/promises");
    const videoBuffer = await readFile(filePath);
    const frontendUploadId = `innertube_studio:${crypto.randomUUID().toUpperCase()}:0`;

    // 1) Init de sesion resumable
    const initRes = await fetch(UPLOAD_INIT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        cookie: this.cookie,
        origin: "https://studio.youtube.com",
        referer: "https://studio.youtube.com/",
        "user-agent": this.userAgent,
      },
      body: JSON.stringify({ frontendUploadId }),
    });
    if (!initRes.ok) {
      const text = await initRes.text().catch(() => "");
      throw new Error(
        `upload init HTTP ${initRes.status}: ${text.slice(0, 300)}`
      );
    }
    const uploadUrl = initRes.headers.get("x-goog-upload-url");
    if (!uploadUrl) throw new Error("upload init no devolvio x-goog-upload-url");

    // 2) Subir bytes + finalize
    const fileName =
      filePath.split(/[\\/]/).pop() || "video.mp4";
    const upRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        cookie: this.cookie,
        "content-length": String(videoBuffer.length),
        "x-goog-upload-command": "upload, finalize",
        "x-goog-upload-file-name": encodeURIComponent(fileName),
        "x-goog-upload-offset": "0",
        origin: "https://studio.youtube.com",
        referer: "https://studio.youtube.com/",
        "user-agent": this.userAgent,
      },
      body: videoBuffer,
    });
    if (!upRes.ok) {
      const text = await upRes.text().catch(() => "");
      throw new Error(`upload HTTP ${upRes.status}: ${text.slice(0, 300)}`);
    }
    const uploadResult = await upRes.json();
    if (uploadResult.status !== "STATUS_SUCCESS" || !uploadResult.scottyResourceId) {
      throw new Error(
        `upload finalize inesperado: ${JSON.stringify(uploadResult).slice(0, 300)}`
      );
    }

    // 3) Crear el video PRIVADO en el canal
    const createRes = await fetch(
      "https://studio.youtube.com/youtubei/v1/upload/createvideo?alt=json",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: this.cookie,
          authorization: this.#sapisidHash(),
          origin: "https://studio.youtube.com",
          referer: "https://studio.youtube.com/",
          "user-agent": this.userAgent,
          "x-goog-authuser": "1",
          "x-origin": "https://studio.youtube.com",
          "x-youtube-client-name": "62",
          "x-youtube-client-version": this.clientVersion,
        },
        body: JSON.stringify({
          resourceId: { scottyResourceId: uploadResult.scottyResourceId },
          frontendUploadId,
          initialMetadata: {
            title: { newTitle: title.slice(0, 100) },
            privacy: { newPrivacy: "PRIVATE" },
            draftState: { isDraft: false },
          },
          contentLevelProtection: { enableRequiresContentLevelProtection: false },
          context: {
            client: {
              clientName: 62,
              clientVersion: this.clientVersion,
              hl: "en",
              gl: "US",
            },
            user: {
              onBehalfOfUser: "",
            },
          },
        }),
      }
    );
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "");
      throw new Error(`createvideo HTTP ${createRes.status}: ${text.slice(0, 300)}`);
    }
    const created = await createRes.json();
    const videoId = created.videoId;
    if (!videoId) {
      throw new Error(
        `createvideo no devolvio videoId: ${JSON.stringify(created).slice(0, 300)}`
      );
    }
    return videoId;
  }
}
