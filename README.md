# YouTube Copy Detection API

API asincrónica que detecta si un video tiene claims de Content ID usando el sistema real de YouTube.

**Cómo funciona:** sube el video como PRIVADO a un canal canario vía YouTube Data API v3, espera el escaneo de Content ID (~2-3 min), lee el resultado vía los endpoints internos de YouTube Studio (youtubei), borra el video y devuelve el reporte.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/check` | Enviar video (multipart, campo `video`). Opcional: `webhookUrl`. Devuelve `job_id` |
| `GET` | `/check/:id` | Estado del job y reporte final |
| `GET` | `/jobs` | Listar jobs |
| `GET` | `/health` | Healthcheck |

## Variables de entorno

| Variable | Descripción |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | OAuth del proyecto Google con YouTube Data API v3 habilitada |
| `STUDIO_COOKIE` | Cookies de sesión de YouTube Studio (header completo) |
| `STUDIO_CHANNEL_ID` | ID del canal canario (UC...) |
| `API_KEY` | API key para autenticar esta API (opcional) |
| `STUDIO_POLL_MS` | Intervalo de polling (default 10000) |
| `JOB_TIMEOUT_MS` | Timeout del job (default 1800000) |
| `UPLOADS_DIR` / `DB_PATH` | Paths de storage (default `/data/...`) |

## Ejemplo

```bash
curl -X POST http://localhost:3000/check \
  -F video=@mi-video.mp4 \
  -F webhookUrl=https://ejemplo.com/webhook

curl http://localhost:3000/check/<job_id>
```

## Reporte

```json
{
  "status": "done",
  "result": {
    "copyrightSummaryStatus": "VIDEO_COPYRIGHT_SUMMARY_STATUS_COPYRIGHT_CONTENT_FOUND",
    "activeClaimsCount": 1,
    "claims": [
      {
        "claimId": "...",
        "type": "CLAIM_TYPE_AUDIOVISUAL",
        "asset": { "musicVideo": { "title": "...", "artists": ["..."], "recordLabel": "..." } },
        "claimant": "UMG",
        "policyType": "POLICY_TYPE_MONETIZE",
        "territories": { "included": ["AR", "US"], "excluded": [] },
        "match": { "longestMatchStartTimeSeconds": "1", "longestMatchDurationSeconds": "152" },
        "segments": [{ "startMillis": 0, "endMillis": 152500 }]
      }
    ]
  }
}
```

## Advertencias

- La quota de YouTube Data API permite ~6 subidas/día con la quota default (1600 unidades c/u).
- Los endpoints de youtubei no son públicos y pueden cambiar sin aviso.
