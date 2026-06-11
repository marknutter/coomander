# coomander-video-processor

Standalone Cloudflare Worker + Container that does ffmpeg-based video processing for the main `coomander` Worker. Handles audio transcription (OpenAI Whisper) and key-frame extraction + Claude vision over the frame sequence.

The main `coomander` Worker calls this service via the `VIDEO_PROCESSOR` service binding declared in `../../wrangler.toml`. Cross-Worker auth is a shared secret on the `x-internal-secret` request header.

## Deploy

```bash
cd node/workers/video-processor
npm install
wrangler login                       # if not already authed
wrangler containers build            # build the container image
wrangler containers push             # push to Cloudflare's managed registry
wrangler secret put SHARED_SECRET    # paste the same secret you set on the coomander worker as VIDEO_PROCESSOR_SECRET
wrangler deploy
```

The shared secret must match between this Worker (`SHARED_SECRET`) and the main coomander Worker (`VIDEO_PROCESSOR_SECRET`).

## API

`POST /process-video` — requires `x-internal-secret` header.

Body:
```json
{
  "video_url": "https://...",
  "openai_api_key": "sk-...",
  "anthropic_api_key": "sk-ant-..."
}
```

Response:
```json
{
  "transcript": "...",
  "spoken_hook": "first 15 words...",
  "key_frame_analysis_json": "{...}"
}
```

`GET /health` — unauth'd liveness check.

## Container internals

The container is a Node 22 + Express server with `ffmpeg` and `ffprobe` baked in. Source in `container/server.js`. It mirrors the legacy `lib/ai/video-analysis.ts` pipeline 1:1.
