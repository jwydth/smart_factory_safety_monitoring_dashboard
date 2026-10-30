# Clean-room test — Phase E

Following **only the README** on a fresh checkout, to find the gaps that are invisible
to someone whose machine is already set up. Every place the documentation had to be
improvised became a documentation fix.

| | |
| --- | --- |
| Performed | 2026-10-10 |
| Commit | `2d38e60` on `handover/docs` |
| Method | `git clone --branch handover/docs` to an empty directory — no `.env`, no weights, no venv, no `node_modules` |
| Mode | **CPU-only** install (`requirements.txt` without the CUDA wheels), as the handover plan allows |
| Result | **The README works.** The backend starts, all four health endpoints return 200, the frontend builds and type-checks. Nine documentation defects were found and fixed. |

The fresh clone was confirmed genuinely empty before starting: `backend/weights/`
contained only `MANIFEST.json` and `README.md`, and there was no `backend/.env`,
`backend/.venv` or `frontend/node_modules`.

---

## What worked without improvisation

| README step | Result |
| --- | --- |
| Infrastructure (`docker compose up -d`) | Compose file validates; all three services run |
| `python -m venv .venv` | Works *(at a short path — see defect 1)* |
| `pip install -r requirements.txt` | **Exit 0.** CPU-only install succeeds |
| `Copy-Item .env.example .env` | Works, and needs no edits for local dev — the DATABASE_URL port is correct |
| `python -m app.db.init_db` | **Exit 0.** "PostgreSQL tables created and features seeded successfully." |
| `scripts/verify_weights.py` on an empty clone | Works with **zero dependencies installed** — it is stdlib-only, and correctly reports all five models missing |
| Restoring the behavior model from git history | **The documented one-line command works verbatim**, and the restored file matches the manifest checksum |
| `scripts/verify_weights.py` after placing weights | All 5 OK, exit 0 — the manifest checksums are correct against a real delivery |
| `python -m uvicorn app.main:app` | **Starts on a CPU-only install** |
| `npm install` | **Exit 0** |
| Frontend `tsc --noEmit` | **Clean**, matching the baseline exactly |
| Frontend `npm run lint` | **34 problems**, matching the baseline exactly |
| Backend `ruff check .` | **29 errors**, matching the baseline exactly |

### Health endpoints, CPU-only clean install

```
/health            {"status":"ok"}                                            [200]
/health/db         {"database":"connected"}                                   [200]
/health/storage    {"storage":"connected","bucket":"safety-monitoring-evidence"} [200]
/health/streams    {"stream_count":0,"streams":[]}                            [200]
```

**No part of the quick start requires a GPU.** The GPU matters for throughput, not for
starting up. The CUDA wheels are only needed for real-time performance on live cameras.

---

## Defects found, and the fixes

### 1. `python -m venv` fails on a long Windows path

The first attempt was made in a directory ~200 characters deep. `venv` creation failed:

```
Command '[...\.venv\Scripts\python.exe', '-m', 'ensurepip', ...]' returned non-zero exit status 1
```

Retried at a short path (`C:\...\Temp\cr`) and it succeeded immediately, which isolates
the cause as Windows path length rather than anything in the project. Worth documenting
because a deep clone location is an easy mistake, and the error message does not mention
paths at all.

**Fix:** README now advises cloning to a short path, with the symptom named.

### 2. The tests and linter cannot be installed — this was the biggest find

`requirements.txt` does **not** contain `pytest` or `ruff`. Neither does
`requirements-cuda-cu132.txt`. **There is no dev-requirements file at all.**

Yet the README's Development section tells the reader to run both. On a fresh checkout:

```
.venv\Scripts\python.exe: No module named pytest
```

So the documented verification step was impossible to perform. Verified by grep across
both requirements files and by looking for any `requirements*dev*` file.

**Fix:** README now gives the explicit install command, pinned to the versions the
baseline was measured with (`pytest==9.1.1`, `ruff==0.15.20`), so the recorded numbers
are reproducible. A `requirements-dev.txt` would be the tidier fix and is **recommended
to De Heus**, but adding a new dependency manifest was outside the documentation-only
scope of this handover.

### 3. Copying `.env.example` makes six tests fail

This one is subtle and would have cost somebody a morning.

The test suite reads the real `backend/.env`, because `Settings.Config.env_file` points
at it. So **test results depend on the developer's env file.** The README tells you to
copy `.env.example` to `.env`, and that file ships:

```
REPORT_RECIPIENT_ALLOWLIST=["@deheus.com"]
```

Six reporting tests assume the *code* default (`[]`, meaning allow any recipient), so
they fail with `ServiceValidationError: Recipient a@b.com is not on the allowed list.`

Proven rather than inferred: setting the allowlist back to `[]` made all 32 tests in
the two affected files pass.

**Fix:** README and `BASELINE.md` now state that the suite reads `backend/.env` and that
this value causes six spurious failures. The `.env.example` value is left as-is, because
an empty allowlist is a genuine security problem
([KNOWN_LIMITATIONS.md](../KNOWN_LIMITATIONS.md) §1) and the template should keep the
safe value. **The tests are wrong here, not the template.**

### 4. "How to obtain" the weights did not say who to ask

`verify_weights.py` prints a `how to obtain` line per missing model. For the two
custom-trained YOLO models it printed where they were *trained* — a dataset path on the
capstone team's machine. For someone at De Heus holding a fresh clone, that is not an
answer. The weights README likewise said "obtain the five required files" without ever
naming a source.

**Fix:** `MANIFEST.json` now carries an explicit `obtain_from` for every model, and
`backend/weights/README.md` names the technical contact. The training provenance is kept
as a separate field, since it answers a different question.

### 5. The behavior-model recovery needs a full clone

`git show de167f9:backend/weights/best_behavior_model.joblib` works — confirmed, and the
result matches the manifest checksum. But `de167f9` is only reachable in a clone with
history; a `--depth 1` shallow clone cannot produce it.

**Fix:** noted in `backend/weights/README.md`.

### 6. The README dropped a PowerShell execution-policy step

The previous README included `Set-ExecutionPolicy -Scope Process -ExecutionPolicy
RemoteSigned` before activating the venv. The Phase D rewrite lost it. Windows clients
default to `Restricted`, where `Activate.ps1` fails outright.

This machine could not reproduce the failure — its policy is already permissive — so
the regression was caught by reading rather than by running, and is reported as such.

**Fix:** the README no longer depends on activation at all. Every command now uses the
explicit `.\.venv\Scripts\python.exe` path, which sidesteps execution policy entirely,
with activation mentioned as an optional convenience.

### 7. Three dependencies are unpinned, and one moved a major version

`requirements.txt` pins everything with `==` except:

```
pillow>=12.0.0
lap>=0.5.12
opencv-python-headless>=4.10.0
```

The fresh install resolved `opencv-python-headless` to **5.0.0.93**, while the
development machine runs **4.13.0.92** — a major version apart, from the same
requirements file. `torch` also resolved to 2.14.1 (CPU) versus 2.12.0+cu132.

Nothing broke in this test, but "it works on the dev machine" carries less weight than
it appears to when a major version can change underneath an unpinned constraint.

Also noted: `ultralytics` pulls in `opencv-python` (the non-headless build) as a
transitive dependency, so both `opencv-python` and `opencv-python-headless` end up
installed, which partly defeats the point of specifying the headless package.

**Fix:** documented in `BASELINE.md` as a reproducibility caveat. Pinning them is a
code change and is **recommended to De Heus** rather than done here.

### 8. Two "test failures" in the baseline were environment, not code

The clean room ran **9 failures / 413 passed**, against the dev machine's 11. Both
differences are informative, and both improve on the Phase A baseline:

| Test | Dev machine | Clean room | Why |
| --- | --- | --- | --- |
| `test_fall_detector.py::test_primary_behavior_classifier_is_extra_trees_...` | **FAIL** | **PASS** | The dev `.env` points at the old XGBoost `behavior.joblib`. The clean room used the corrected `.env.example` and the real ExtraTrees model. **This empirically confirms the Phase B fix.** |
| `test_tracking_overlay.py::test_mock_video_tracking_overlay_respects_stride` | **FAIL** | **PASS** | Needs a reachable database. Postgres was down during the Phase A capture. |

**So the true deterministic failure count is 9, not 10** — seven in
`tests/test_auto_zone.py`, one in `test_incident_diagnostics.py`, one in
`test_stream_health.py`. Everything else was environmental.

**Fix:** `BASELINE.md`, `KNOWN_LIMITATIONS.md` and the README all corrected to 9.

### 9. `BASELINE.md`'s CPU question is now answered

Phase A left a `VERIFY:` on how much results differ on a CPU-only machine. They do not,
for anything that matters: ruff is identical (29), frontend tsc and lint are identical
(clean, 34), and the backend failure set is identical once the two environmental causes
above are accounted for. The backend starts and serves on CPU.

**Fix:** the `VERIFY:` in `BASELINE.md` is replaced with this measured answer.

---

## Not covered by this test

Stated plainly rather than left implied:

- **No GPU path was exercised.** The CUDA wheels, TensorRT engines and GPU inference
  were not installed or run in the clean room. The engines are known to be machine-
  specific ([backend/weights/README.md](../../backend/weights/README.md)).
- **No live video.** A camera was never attached, so the RTSP publisher, the WebSocket
  pipeline, the annotated LL-HLS output and the dashboard's live view were not
  exercised end to end. Detection accuracy was not assessed, and could not be — the
  models are unmeasured ([MODELS.md](../MODELS.md)).
- **The frontend was built, not driven.** `npm install`, `tsc` and `lint` ran; the
  dashboard was not opened and clicked through.
- **PDF and email reports** were not generated.
- **Shared infrastructure.** Docker Desktop had auto-restarted the development
  machine's own PostgreSQL and MinIO containers, which hold ports 5433/9000/9011. Rather
  than start a second conflicting stack, the clean-room backend was pointed at an
  isolated `cleanroom_test` database on that server, which was dropped afterwards. The
  development database was not written to. A consequence: **two checkouts cannot both
  run `docker compose up -d`**, since they would contend for the same host ports.
  `VERIFY:` the exact failure mode — it was deliberately not triggered.
