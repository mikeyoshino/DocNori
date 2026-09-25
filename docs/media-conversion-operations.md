# Media conversion operations

## Architecture and scaling

The API uploads bounded 8 MiB chunks into a private `media-data` volume and enqueues metadata in PostgreSQL. The separate `SabuySign.Media.Worker` executable (no HTTP listener) in a `media-worker` container claims jobs with `FOR UPDATE SKIP LOCKED`. A unique run ID and 30-second renewable lease fence stale workers from publishing a result. The worker checks liveness every two seconds and terminates its FFmpeg process tree when cancelled. Jobs interrupted by worker failure retry at most three times while the owning browser remains present.

Start with one worker: 1 CPU and 2 GiB memory limit, 128 processes, no external network in production. FFmpeg threads are bounded; each conversion has a five-minute deadline and a 128 MiB output cap. These are protective defaults, not guaranteed throughput. Benchmark representative large/4K files and one-hour audio on the actual VPS, alongside TrackZ, before advertising performance or increasing concurrency.

On the same host, scale with `docker compose ... up -d --scale media-worker=2` after verifying spare RAM/CPU/disk. All replicas need the same database and volume. For multiple hosts, provision shared storage with consistent filesystem semantics and the same mount path first; a named Docker volume is local to one host. Object storage requires a separate storage adapter/upload flow and is not implemented here.

## Configuration

- `MediaConversion__Enabled=true` on the API. Workers run the dedicated executable.
- `MediaConversion__MaxConcurrency=0`: automatic slots, bounded by assigned CPU and available memory. Positive values set a lower maximum.
- `MediaConversion__MemoryPerJobMb=1024` and `MediaConversion__ReservedMemoryMb=256`: memory budget per slot and process headroom. This is admission budgeting; Docker provides the hard memory limit.
- Compose `MEDIA_WORKER_CPUS` and `MEDIA_WORKER_MEMORY` allocate hardware per instance (shared VPS defaults: 1 CPU / 2 GiB). Set these explicitly on dedicated worker VPSs, leaving OS headroom.
- `MediaConversion__ConnectionString` or the existing `SigningSessions__ConnectionString` fallback.
- `MediaConversion__StoragePath=/media` on every replica.
- `MediaConversion__MaxJobs=20` limits uncleaned jobs, including ready results.
- `MediaConversion__MaxReservedBytes=4000000000` reserves declared input plus 128 MiB output per job.
- Optional `MediaConversion__ffmpeg` / `MediaConversion__ffprobe` executable paths.

Creation is limited to 30 requests/minute per API instance, other media requests to 1200/minute. PostgreSQL admission limits apply across instances. For larger installations use edge-level abuse controls and resource monitoring; scaling the API multiplies its in-memory rate limits.

## Retention and cancellation

No cancel button and no resumable job link. Internal navigation asks before leaving. Page disposal/pagehide sends a token-bearing beacon; tokens never appear in URLs. Missing heartbeat expires work after 120 seconds. Cleanup runs every two seconds and removes cancelled, failed and expired directories. The worker kills active subprocesses when its lease cannot renew. Input is deleted after successful conversion; results expire one hour after completion even if the page stays open. Maximum job lifetime is two hours. Non-content metadata is removed after one day once cleanup succeeds. Exclude this volume from document backups.

A database/storage outage can delay cleanup until services recover. Do not describe deletion as instantaneous or cryptographic erasure. Operators with host access can access temporary media; this is server-side conversion and does not have the local-only privacy model of PDF filling.

## Production rollout

The repository includes updated `deploy/compose.production.yaml`, `infra/nginx.conf`, `deploy/docnory-deploy`, and the FFmpeg host image. Before deploying these images, update the corresponding VPS files (`/opt/docnory/compose.production.yaml`, `/opt/docnory/nginx.conf`, installed deployment script) using the established provisioning process. Merely pushing a new image to the previous compose configuration will not start a media worker or mount its storage. No VPS changes are performed by this implementation.

Keep proxy body limits above 8 MiB (nginx media location uses 9 MiB) and request buffering off. Do not expose the worker or volume publicly. Preserve the existing TrackZ/Caddy services. Monitor queue age, free disk, failed jobs, worker restarts and memory pressure. A single Docker host remains a single point of failure.

## Verification

`npm test` and `npx tsc --noEmit`; database tests use `SIGNING_TEST_DATABASE` with the existing Signing.Tests project. Run browser tests against the Docker stack with `APP_URL=http://127.0.0.1:8080 npx playwright test tests/video-gif.spec.ts tests/video-audio.spec.ts`.

## Add a dedicated worker VPS

1. Provision a private network between the database, API and workers. Install Docker.
2. Mount a shared filesystem (for example NFS over the private network) on every machine. Ensure the container user UID1654 has read/write access. Keep the filesystem private and excluded from backups; do not place it under a web root.
3. Drain old jobs before moving the API from its local volume. Apply `compose.media-shared.yaml` alongside the production compose, with `MEDIA_SHARED_PATH` set to that mount. Both API and local worker use the same shared path.
4. On the new worker VPS create `/etc/docnory/media-worker.env` (0600) containing `MediaConversion__ConnectionString` for the same PostgreSQL database. Do not copy Stripe/OpenAI secrets to workers.
5. Set `DOCNORY_HOST_IMAGE` to the immutable release image; `MEDIA_SHARED_PATH` to the mount; and `MEDIA_WORKER_CPUS` / `MEDIA_WORKER_MEMORY` to the resources assigned on that VPS. Run `docker compose -f compose.media-worker.yaml up -d`.
6. Check the startup log for the selected concurrent slot count. All workers claim from the same queue; clients continue polling the same API. The release image contains two executables so the existing image publication workflow stays compatible; the remote worker runs only the dedicated worker executable and can be updated separately.

Example: an 8-vCPU/8-GiB dedicated server might assign 7 CPUs and 7 GiB to conversion, giving up to 6 slots with the default memory reservation. Start lower and measure actual peak memory before raising concurrency. Heavy codecs may use the entire per-job budget; max throughput cannot be guaranteed solely from core count.
