# Video and audio tools

Separate SSR landing pages with Blazor interaction:

| Route | Input limit | Duration | Output |
| --- | --- | --- | --- |
| `/tools/video-to-gif` | 200,000,000 bytes | Source up to 1 hour; selected interval up to 30 seconds | GIF, 320/480/720 longest edge, 10 or 20 fps |
| `/tools/video-to-mp3` | 500,000,000 bytes | Up to 1 hour | MP3, first audio track, 128 kbps stereo |

One MP4/MOV/WebM at a time. Browser must support previewing the codec. GIF never upscales; GIF output has no sound. The server probes the actual file and rechecks duration and audio/video streams. File extension and browser metadata are not trusted for server validation.

The browser previews and selects a range. On conversion it uploads 8 MiB chunks, displays upload progress, queue/conversion status, then a preview and download. No cancel button. Leaving the page cancels the job; users see a navigation warning. Closing/crashing the browser without delivering the leave beacon is handled by a 120-second heartbeat expiry. Switching tabs alone does not cancel intentionally; suspended tabs that stop heartbeat longer than this grace period may expire.

Conversion runs in a native FFmpeg worker on the server, not FFmpeg.wasm. Temporary uploads and output are stored in a private shared Docker volume, never a public static folder. Each job needs a random capability token; only its SHA-256 hash is stored in PostgreSQL. Results are not stored in a user account. Download before leaving. Advertising scripts are excluded from both routes.

Run locally: `docker compose -f infra/compose.yaml up --build -d`, then visit http://localhost:8080. See [operations](media-conversion-operations.md) for queue configuration and deployment.

Tests use synthetic two-second WebM fixtures. Browser tests check actual GIF frames, trim and dimensions, MP3 playback/duration/download, silent input errors, SSR, responsive layouts, authorization and leaving-page cancellation. Database tests check upload retries, incomplete chunks, limits, concurrent claims, fencing, cancellation and expiry cleanup. These checks do not substitute for a 500 MB / one-hour load test on the target VPS or native mobile-device testing.
