# Smart Factory Safety Monitoring

Real-time PPE compliance, zone incursion and dangerous-behaviour monitoring for
factory camera feeds. FastAPI backend, Next.js dashboard.

Cameras are analysed live for people missing safety equipment, entering restricted
areas, or running and falling. Each incident is saved with a photograph, pushed to a
dashboard as it happens, aggregated into analytics, and exportable as a PDF report in
English or Vietnamese.

**Owner: De Heus LLC.** See [OWNERSHIP.md](./OWNERSHIP.md) — it includes a licensing
item that needs a decision before deployment.

> **Before you rely on this system, read
> [docs/KNOWN_LIMITATIONS.md](./docs/KNOWN_LIMITATIONS.md).** The two things most
> likely to surprise you: **there is no authentication on any endpoint**, and **every
> model was trained on synthetic video, so accuracy on real cameras is unmeasured.**

---

## Documentation

| If you want to… | Read |
| --- | --- |
| **Use the dashboard** (HSE staff) | [docs/USER_GUIDE.md](./docs/USER_GUIDE.md) |
| **Run, stop, back up or troubleshoot it** | [docs/OPERATIONS.md](./docs/OPERATIONS.md) |
| **Understand how it is built** | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| **Know what it cannot do** | [docs/KNOWN_LIMITATIONS.md](./docs/KNOWN_LIMITATIONS.md) |
| **Look up a setting** | [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) *(generated)* |
| **Look up an endpoint** | [docs/API.md](./docs/API.md) *(generated)* |
| **Look up a table or column** | [docs/DATABASE.md](./docs/DATABASE.md) *(generated)* |
| **Understand the AI models** | [docs/MODELS.md](./docs/MODELS.md) |
| **Obtain or verify model weights** | [backend/weights/README.md](./backend/weights/README.md) |
| **Know about credentials and security** | [docs/handover/SECURITY.md](./docs/handover/SECURITY.md) |
| **See the measured state at handover** | [docs/handover/BASELINE.md](./docs/handover/BASELINE.md) |
| **See this guide verified on a clean checkout** | [docs/handover/CLEAN_ROOM_TEST.md](./docs/handover/CLEAN_ROOM_TEST.md) |
| **Accept the handover** (De Heus) | [docs/handover/CHECKLIST.md](./docs/handover/CHECKLIST.md) |
| **Know what changed in this release** | [RELEASE_NOTES.md](./RELEASE_NOTES.md) |

The three documents marked *generated* are produced from the code and must not be
edited by hand:

```bash
cd backend
.venv/Scripts/python.exe scripts/generate_docs.py
```

`docs/archive/` holds superseded documents, kept for history and clearly marked. Do
not use them as reference.

---

## Quick start

**You need:** Windows, Python 3.11, Node.js 20+, Docker Desktop, FFmpeg, and an
NVIDIA GPU for realistic performance (CPU works but is slow). **You also need the
model weights, which are not in this repository** — see
[backend/weights/README.md](./backend/weights/README.md).

> **Clone to a short path**, for example `C:\dev\ppe`. Creating the Python virtual
> environment fails on a deeply nested path, and the error it gives — a non-zero exit
> from `ensurepip` — says nothing about path length. This was confirmed during the
> [clean-room test](./docs/handover/CLEAN_ROOM_TEST.md).
>
> Clone with **full history**: an older fallback copy of the behavior model is
> recoverable from an old commit, which a `--depth 1` clone cannot reach. The final
> `behavior.joblib` is delivered out of band, not through git.

### 1. Infrastructure

```powershell
docker compose up -d
docker compose ps          # wait for postgres to report healthy
```

Starts PostgreSQL (host port 5433), MinIO (9000, console 9011) and MediaMTX
(RTSP 8554, LL-HLS 8888).

### 2. Backend

Commands below call the virtual environment's interpreter by path, so you never need
to activate it — which also avoids PowerShell's execution-policy prompt. If you prefer
to activate, `.\.venv\Scripts\Activate.ps1` works once execution policy allows it
(`Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned`).

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip

# For NVIDIA GPU, install the CUDA wheels FIRST, then the rest:
.\.venv\Scripts\python.exe -m pip install -r requirements-cuda-cu132.txt
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# CPU-only: just the second line. Everything in this quick start works on CPU.

Copy-Item .env.example .env       # then edit it — see the DEV ONLY notes inside
.\.venv\Scripts\python.exe -m app.db.init_db          # create the tables
```

Put the model weights in `backend/weights/`, then check them:

```powershell
.\.venv\Scripts\python.exe scripts\verify_weights.py
```

Start the API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app --port 8000
```

`--reload-dir app` matters: without it, every incident snapshot written during
detection restarts the server and drops every camera connection.

### 3. A camera feed

No real camera? Loop a video file as an RTSP stream. Leave this terminal open:

```powershell
.\scripts\publish-rtsp.ps1 -InputPath C:\videos\camera1.mp4 -StreamName stream1
```

This normalises to 24 FPS, which the behaviour classifier requires — publishing raw
video at another frame rate will silently disable behaviour detection.

### 4. Frontend

```powershell
cd frontend
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

Open **http://localhost:3000**, add the camera `rtsp://localhost:8554/stream1`, and
the dashboard will start streaming it.

### Check it worked

```powershell
curl http://localhost:8000/health        # API alive
curl http://localhost:8000/health/db     # database reachable
curl http://localhost:8000/health/storage # MinIO reachable
```

API docs are at http://localhost:8000/docs.

If something does not work, [docs/OPERATIONS.md](./docs/OPERATIONS.md) has a
troubleshooting section covering black video, missing behaviour detection, and the GPU
not being used.

---

## Repository map

```
├── backend/                  FastAPI application
│   ├── app/
│   │   ├── main.py           Entry point, router registration, scheduler
│   │   ├── core/             config.py (121 settings), runtime setup
│   │   ├── db/               Engine, session, table creation
│   │   ├── models/           SQLModel tables
│   │   ├── schemas/          Pydantic request/response contracts
│   │   ├── repositories/     Thin CRUD wrappers per table
│   │   ├── routers/          HTTP + the /ws/stream WebSocket
│   │   ├── services/         The real work:
│   │   │   ├── ppe/              PPE detection, tracking, violation logic
│   │   │   ├── video_pipeline/   Orchestrator: PPE + zone + sign + behaviour
│   │   │   ├── reporting/        PDF, email, scheduling, EN/VI
│   │   │   └── …                 Zones, incidents, analytics, streaming
│   │   └── storage/          MinIO and local snapshot handling
│   ├── scripts/              Migrations, diagnostics, doc generation
│   ├── tests/                pytest suite
│   └── weights/             Models (gitignored) + MANIFEST.json + README
├── frontend/                 Next.js dashboard
│   └── src/
│       ├── app/              Routes: / and /analytics
│       ├── components/       dashboard/, ppe/, analytics/, factory3d/
│       ├── hooks/            useLiveStream, useZoneDrawing, useSafetyKpis
│       ├── lib/              REST client, overlay time-sync, geometry
│       └── types/            Mirrors the backend schemas
├── docs/                     Documentation (see the table above)
├── scripts/publish-rtsp.ps1  Simulates a camera from a video file
├── docker-compose.yml        PostgreSQL + MinIO + MediaMTX
└── mediamtx.yml              RTSP / LL-HLS media server config
```

## How it fits together, in one paragraph

One shared capture thread per camera feeds four consumers: a PPE detector, a
safety-sign detector, a behaviour classifier, and a compositor. The compositor draws
every result onto the video itself and republishes it as a second RTSP stream which
MediaMTX serves as low-latency HLS — so the dashboard plays one already-synchronised
picture instead of racing a browser-drawn overlay against a video element. Incidents
go to PostgreSQL with their snapshots in MinIO, and reach the browser over a WebSocket
separate from the video. There is a deliberate **three-second delay** on the annotated
stream: that is the budget the AI needs to catch up with a frame before it is shown.

Full detail in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Development

**The test and lint tools are not in `requirements.txt`.** Install them first, pinned
to the versions the recorded baseline was measured with:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pip install "pytest==9.1.1" "ruff==0.15.20"
```

Then:

```powershell
.\.venv\Scripts\python.exe -m pytest -q          # tests
.\.venv\Scripts\python.exe -m ruff check .       # lint

cd ..\frontend
.\node_modules\.bin\tsc --noEmit                 # type-check
npm run lint
```

**These do not all pass**, and that is the known state rather than a broken checkout:
**9 backend tests fail deterministically** (seven of them in `tests/test_auto_zone.py`),
backend lint reports 29 problems, and frontend lint reports 34. The frontend
type-check is clean. There is no CI.

> **The test suite reads `backend/.env`.** If you copied `.env.example` verbatim, six
> reporting tests fail on `REPORT_RECIPIENT_ALLOWLIST` — they assume the code default
> of `[]` while the template ships `["@deheus.com"]`. Those six failures are an
> artefact of the test setup, not a defect. Keep the template's value, which is the
> safe one.

Exact numbers, the full list of failing tests, and one timing-flaky test are in
[docs/handover/BASELINE.md](./docs/handover/BASELINE.md); the clean-checkout
verification is in
[docs/handover/CLEAN_ROOM_TEST.md](./docs/handover/CLEAN_ROOM_TEST.md).

Project coding conventions are in [AGENTS.md](./AGENTS.md).

## Contact

| | |
| --- | --- |
| Technical contact | Ethan Phuc (Nguyen Trong Phuc), Information Technology — ethan.phuc@deheus.com |
| Origin | RMIT University capstone project, De Heus LLC as industry partner |
| Handed over at | commit `950e09c` |
