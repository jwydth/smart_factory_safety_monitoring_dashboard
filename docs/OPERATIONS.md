# Operations

Running, stopping, checking and recovering the system. Commands are PowerShell, as
the project is developed and run on Windows.

For first-time setup see the [README](../README.md). For what the system cannot do,
see [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).

---

## Start-up order

The order matters: the backend expects its database and object store to exist, and the
dashboard expects the stream to be publishing.

```powershell
# 1. Infrastructure
docker compose up -d
docker compose ps                      # wait for postgres to report healthy

# 2. Stream source (leave this terminal open — it loops the video)
.\scripts\publish-rtsp.ps1 -InputPath C:\videos\camera1.mp4 -StreamName stream1

# 3. Backend (new terminal)
cd backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --reload-dir app --port 8000

# 4. Frontend (new terminal)
cd frontend
npm run dev
```

`--reload-dir app` is not optional in practice. Without it the auto-reloader watches
the whole `backend/` tree, so **every violation snapshot written to
`backend/storage/` restarts the server and drops every open camera WebSocket.**

### Shutting down

Stop the frontend, backend and publisher with `Ctrl+C`, then:

```powershell
docker compose down          # keeps data
docker compose down -v       # DESTROYS all PostgreSQL and MinIO data
```

Backend shutdown tears down every capture thread and ffmpeg process immediately — the
idle grace windows apply only to a disconnecting viewer, not to shutdown — so no
ffmpeg is left orphaned.

## Ports

| Port | Service | Notes |
| --- | --- | --- |
| 3000 | Frontend (Next.js) | The dashboard |
| 8000 | Backend (FastAPI) | API, `/docs`, WebSocket |
| 8554 | MediaMTX RTSP | Where the publisher sends video and the backend reads it |
| 8888 | MediaMTX LL-HLS | What the browser plays |
| 5433 | PostgreSQL | Host port; the container listens on 5432 |
| 9000 | MinIO API | Evidence snapshot storage |
| 9011 | MinIO console | Host port; the container serves 9001 |

Both `8554` and `8888` conflict with a standalone `mediamtx.exe`. Use Docker Compose
**or** the standalone binary, never both.

## Health endpoints

Poll these from outside the system — there is no built-in alerting.

| Endpoint | Checks |
| --- | --- |
| `GET /health` | The API process is up |
| `GET /health/db` | PostgreSQL is reachable |
| `GET /health/storage` | MinIO is reachable |
| `GET /health/streams` | Per-stream inference health: FPS, latency percentiles, event rates |
| `DELETE /health/streams` | Resets the accumulated stream health counters |
| `GET /health/smtp` | SMTP connectivity, if email reports are configured |

```powershell
curl http://localhost:8000/health
curl http://localhost:8000/health/db
curl http://localhost:8000/health/storage
curl http://localhost:8000/health/streams
```

**`GET /health` is a liveness check only.** It returns success while the database is
unreachable, so a monitor should poll `/health/db` and `/health/storage` too.

## Backups

**There is no automated backup.** Both commands below must be scheduled by whoever
operates the system. Two things need backing up: the PostgreSQL database (incidents,
zones, cameras, report schedules) and the MinIO bucket (evidence snapshots).

> `VERIFY:` these are the standard procedures for this stack and are given here as the
> documented approach, but they were **not executed** as part of the handover. Run a
> restore test before relying on them.

### PostgreSQL

```powershell
# Back up
docker compose exec -T postgres pg_dump -U safety_user safety_monitoring > backup_safety_monitoring.sql

# Restore into an empty database
docker compose exec -T postgres psql -U safety_user -d safety_monitoring < backup_safety_monitoring.sql
```

Substitute the real user and database name if they were changed from the
docker-compose defaults.

### MinIO

Evidence snapshots are not reconstructible — if the object is gone, the photographic
evidence for that incident is gone. The database keeps only the object path.

```powershell
# Using the MinIO client, configured against the running server
mc mirror local/safety-monitoring-evidence C:\backups\evidence\
```

Alternatively back up the `minio_data` Docker volume while the container is stopped.

**Database and bucket must be backed up together.** A database restored to a different
point in time than the bucket will have incident rows pointing at objects that do not
exist, or orphaned objects with no rows — and note from
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) §4 that most delete paths already leave
orphans.

## Applying schema changes to an existing database

This project has **no migration framework**. `SQLModel.metadata.create_all()` creates
whole missing tables and never alters an existing one, so new columns arrive via patch
scripts. All three are idempotent and safe to re-run:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\add_incident_area_zone.py
.\.venv\Scripts\python.exe scripts\backfill_zone_violation_severity.py
.\.venv\Scripts\python.exe scripts\add_report_language_column.py
```

A database created fresh already has these columns. See
[DATABASE.md](./DATABASE.md) for what each one does.

## Verifying the installation

```powershell
cd backend

# Are the model weights present and correct?
.\.venv\Scripts\python.exe scripts\verify_weights.py

# Is the GPU visible and will CUDA be used?
.\.venv\Scripts\python.exe scripts\check_gpu_runtime.py
```

---

## Troubleshooting

### The video is black on page load

Expected briefly; sustained is a fault. The annotated LL-HLS playlist **404s until the
camera WebSocket has started its compositor**, which is normal for a second or two.

What should prevent it lasting longer:

- `FRAME_HUB_IDLE_GRACE_SECONDS` (60s) keeps the capture session warm across a reload
  so it does not pay a full RTSP handshake again.
- `ANNOTATED_PUBLISHER_IDLE_GRACE_SECONDS` (60s) does the same for the
  ffmpeg → MediaMTX → HLS chain.
- `<video poster>` is served from `/stream-snapshot` to cover the gap.

If it persists, check in this order:

1. Is the publisher still running? It must stay in the foreground.
2. `curl http://localhost:8888/stream1_annotated/index.m3u8` — a 404 here means the
   compositor never started; check the backend log.
3. Is `ffmpeg` on `PATH`? `ffmpeg -version`. `ANNOTATED_FFMPEG_PATH` must resolve.
4. Is a standalone `mediamtx.exe` fighting the container for port 8554?

**`/stream-snapshot` returning 404 is deliberate** past
`ANNOTATED_SNAPSHOT_MAX_AGE_SECONDS` (10s). Serving a stale frame as the current view
of a factory floor would be worse than showing nothing.

### No behavior detection, no error anywhere

Almost always **the source is below 24 FPS.** The classifier needs 60 ordered samples
on a canonical 24-FPS timeline, and a slower source can never fill the window, so it
produces nothing rather than failing.

- The dashboard shows a "Behavior detection unavailable" banner.
- The reason is surfaced on the worker and in the backend log.
- Fix the source cadence. `publish-rtsp.ps1` normalizes to CFR 24 FPS for exactly this
  reason — use it rather than publishing raw.
- **Do not** try to compensate with `FALL_LIVE_FRAME_STRIDE`; a validator rejects any
  value but `1`.

If the source is already 24 FPS, check that the behavior model loaded:
`scripts\verify_weights.py`, then the backend log for a "Behavior classifier loaded
from …" line.

### The GPU is not being used

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\check_gpu_runtime.py
```

- `INFERENCE_DEVICE` must be `auto` or an explicit `cuda:0`.
- CUDA wheels must be installed **before** the normal requirements:
  `pip install -r requirements-cuda-cu132.txt` then `pip install -r requirements.txt`.
- `torch.cuda.is_available()` returning `False` with an NVIDIA GPU present usually
  means a CPU-only torch wheel was installed over the CUDA one.

### A `.engine` file fails to load at startup

Expected on hardware other than the machine that built it. TensorRT engines are tied
to GPU compute capability, driver and TensorRT version.

**Note that the demonstrated system ran on engines**, not `.pt` files — PPE, sign and
pose all pointed at `.engine` paths (see
[`backend/weights/README.md`](../backend/weights/README.md)). So on different hardware
you have a real choice: fall back to the `.pt` files and accept slower inference, or
rebuild the engines to recover demo performance.

Either point the settings back at the `.pt` files, or rebuild:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\export_tensorrt.py ppe pose sign
```

See [`backend/weights/README.md`](../backend/weights/README.md) for the build
environment of the supplied engines.

### The whole server freezes, including working camera feeds

Historically this was a database connection hanging on the event loop. `app/db/session.py`
now passes `connect_timeout=5` for PostgreSQL URLs, which turns an unrecoverable hang
into a fast 503.

If it recurs, check `/health/db` and whether PostgreSQL is reachable on port 5433.
**Note:** a connection failure traceback prints the database password — see
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) §9 before pasting logs anywhere.

### A camera will not stream and keeps retrying

`MAX_CONCURRENT_STREAMS` (default 8) is a hard ceiling on simultaneous cameras.
Connections beyond it queue for a free model instance and time out. Every *active*
camera holds an instance for the life of its WebSocket, whether or not its tile is
on screen.

### The dashboard feels slow when selecting a zone

Three fixes already address this and are worth knowing about before re-diagnosing:
analytics handlers are deliberately sync `def` (as `async def` they blocked the event
loop), the MinIO bucket check is memoized, and the KPI query keeps previous data
across zone changes.

**Do not "fix" the analytics handlers in `app/routers/analytics.py` back to
`async def`.** That change took `/health` from a 4 ms median to 1549 ms and stalled
every camera WebSocket.

### Analytics numbers look too low on a long date range

`ANALYTICS_LIMIT` (default 20000) caps rows read per category per call, and analytics
aggregates in Python. A range with more incidents than that silently drops its oldest
rows from the counts — but **a truncation warning is logged**, so check the backend
log before assuming the numbers are right.
