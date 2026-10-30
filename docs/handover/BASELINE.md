# Handover Baseline — Phase A

**Purpose.** Record the measured state of this repository at the moment handover
documentation started, so that every later claim in the handover docs can be checked
against a number that was actually observed rather than quoted.

**Nothing here is a fix.** Phase A records; it does not repair. The failures and lint
problems listed below were present before this branch existed and are left untouched.

| | |
| --- | --- |
| Commit measured | `950e09cdffb1f4124dc59c6e06d10911749d7c23` (`950e09c`) |
| Commit date | 2026-09-16 |
| Commit subject | `[STYLE] camera config: in CAMERA FEEDS page, in Configure cameras panel, rm 3D Blueprint Zone input field` |
| Source branch | `develop` |
| Measured on branch | `handover/docs` (created from `develop`, no code changes) |
| Captured | 2026-10-10 02:54 UTC |
| Platform | Windows 11 Home Single Language 10.0.26200, x64, NVIDIA GPU present |
| Working tree | clean except two untracked docs (`docs/HANDOVER_PLAN_LITE.md`, `docs/PRESENTATION_QA.md`) and the new `docs/handover/` |

Full command output for every row below is in [`baseline-logs/`](./baseline-logs/).
The logs are kept verbatim — including the absolute paths of the capture machine —
because editing them would defeat their purpose as evidence, with **one exception**:
the failing database test printed a psycopg connection string containing the local
development database password, and that value has been replaced with `<REDACTED>` in
`01-backend-pytest.txt`. The redaction is noted at the top of that file. Nothing else
was altered.

That leak is itself a finding: a stack trace from a dropped database connection prints
the full DSN. It is listed for Phase B.

---

## 1. Environment

| Tool | Version | Notes |
| --- | --- | --- |
| Python | 3.11.9 | from the project venv at `backend/.venv` |
| pytest | 9.1.1 | |
| ruff | 0.15.20 | |
| Node.js | v24.17.0 | |
| npm | 11.13.0 | |
| TypeScript | 5.9.3 | `frontend/node_modules/.bin/tsc` |
| ESLint | v9.39.4 | via `npm run lint`, flat config at `frontend/eslint.config.mjs` |

Two environment facts that matter when reproducing these numbers:

- **The backend venv is not optional.** The machine's system `python` (3.11.9, same
  version) has none of the project dependencies installed. All backend commands must
  run through `backend/.venv/Scripts/python.exe`.
- **There is no ruff configuration anywhere in the repo** — no `pyproject.toml`, no
  `ruff.toml`, no `.ruff.toml`, no `setup.cfg`. Ruff therefore ran on its built-in
  defaults. Any future ruff count is only comparable to this one if the configuration
  is still absent.

## 2. Results

| # | Command | Working dir | Exit | Result | Log |
| --- | --- | --- | --- | --- | --- |
| 1 | `./.venv/Scripts/python.exe -m pytest -q` | `backend/` | 1 | **11 failed, 411 passed** (422 total), 16 warnings, 34.32s — but see the determinism correction in §3 | [`01-backend-pytest.txt`](./baseline-logs/01-backend-pytest.txt) |
| 2 | `./.venv/Scripts/python.exe -m ruff check .` | `backend/` | 1 | **29 errors** (11 auto-fixable) | [`02-backend-ruff.txt`](./baseline-logs/02-backend-ruff.txt) |
| 3 | `./node_modules/.bin/tsc --noEmit` | `frontend/` | 0 | **clean — 0 errors** | [`03-frontend-tsc.txt`](./baseline-logs/03-frontend-tsc.txt) |
| 4 | `npm run lint` | `frontend/` | 1 | **34 problems** (21 errors, 13 warnings) | [`04-frontend-lint.txt`](./baseline-logs/04-frontend-lint.txt) |

Environment capture (git state and tool versions):
[`00-environment.txt`](./baseline-logs/00-environment.txt).

## 3. Backend tests — 11 failures

**422 collected · 411 passed · 11 failed · 0 skipped.**

**One of the eleven is environmental, not a code defect.** Docker Desktop was not
running during this capture, so PostgreSQL was unreachable on `localhost:5433`
(verified: `docker ps` could not reach the daemon, and a TCP connect to port 5433
failed). Exactly one failing test reports a connection timeout. The remaining ten fail
with no infrastructure dependency.

| Test | First reported error | Infra-dependent |
| --- | --- | --- |
| `tests/test_auto_zone.py::TestDeriveZonePolygon::test_buffer_expands_bbox` | `AssertionError: assert {'x': 0.05, 'y': 0.4} == approx(...)` | no |
| `tests/test_auto_zone.py::TestDeriveZonePolygon::test_clamp_at_top_left_boundary` | `assert 0.5 == 0.0 ± 1.0e-12` | no |
| `tests/test_auto_zone.py::TestDeriveZonePolygon::test_tl_tr_br_bl_ordering` | `assert 0.35 < 0.35` | no |
| `tests/test_auto_zone.py::TestDeriveZonePolygon::test_zero_buffer_equals_normalized_bbox` | `AssertionError: assert {'x': 0.2, 'y': 0.7} == approx(...)` | no |
| `tests/test_auto_zone.py::test_pipeline_emits_exactly_one_zone_suggestion` | `TypeError: 'async_generator' object is not iterable` | no |
| `tests/test_auto_zone.py::test_pipeline_does_not_emit_suggestion_twice` | `TypeError: 'async_generator' object is not iterable` | no |
| `tests/test_auto_zone.py::test_accepted_polygon_contains_person_foot_point` | `assert 0 == 1` | no |
| `tests/test_fall_detector.py::test_primary_behavior_classifier_is_extra_trees_with_configured_threads` | `AssertionError: assert 'XGBClassifier' == 'ExtraTreesClassifier'` | no |
| `tests/test_incident_diagnostics.py::test_existing_incident_title_is_not_upgraded` | `AssertionError: assert 'action=create' in ''` | no |
| `tests/test_stream_health.py::test_stream_health_reports_rolling_percentiles_and_event_rate` | `assert 0.0 > 0` | no |
| `tests/test_tracking_overlay.py::test_mock_video_tracking_overlay_respects_stride` | `psycopg.errors.ConnectionTimeout: connection timeout expired` (PostgreSQL `localhost:5433`) | **yes** |

Seven of the ten real failures are in one file, `tests/test_auto_zone.py` — the auto
zone-suggestion feature that commit `fe94876` reworked (see
`docs/CHANGES_SINCE_OVERVIEW.md` §5).

### Correction: the suite is not fully deterministic

*Added during Phase B.* A later run of the same unchanged suite produced **12**
failures rather than 11. The extra one was
`tests/test_frame_hub.py::test_latest_drops_stale_while_ordered_marks_overflow_gap`,
which **failed 1 time in 5** when run in isolation.

It is flaky by construction, not a regression: it sleeps 30 ms and then asserts that
the capture thread produced enough frames to overflow a queue of size 2
(`tests/test_frame_hub.py:89-107`). On a loaded machine, or when the thread is slow to
start, nothing is dropped and the assertion fails.

### Correction 2: the deterministic count is 9, not 10

*Added during Phase E.* The [clean-room test](./CLEAN_ROOM_TEST.md) ran the same suite
on a fresh CPU-only checkout and got **9 failures / 413 passed**. Two of the failures
recorded above turned out to be artefacts of *this* machine, not of the code:

| Test | Here | Clean room | Cause |
| --- | --- | --- | --- |
| `test_fall_detector.py::test_primary_behavior_classifier_is_extra_trees_...` | FAIL | **PASS** | This machine's `backend/.env` points at the superseded XGBoost `behavior.joblib`. With the corrected `.env.example` and the real ExtraTrees model, it passes. |
| `test_tracking_overlay.py::test_mock_video_tracking_overlay_respects_stride` | FAIL | **PASS** | Needs a reachable database; PostgreSQL was down during this capture. |

**The honest baseline is therefore: 9 deterministic failures** — seven in
`tests/test_auto_zone.py`, one in `test_incident_diagnostics.py`, one in
`test_stream_health.py` — **plus 1 that needs a database, plus at least 1 that is
timing-flaky.** On this machine that totals 11 or 12; on a correctly configured machine
it is 9 or 10.

Anyone comparing a future run against this document should re-run before concluding a
regression. No other test has been observed to be flaky, but only a handful of runs
were performed — `VERIFY:` by repeated runs if a stable number is ever needed.

### Correction 3: the suite reads `backend/.env`

Also found in Phase E, and it affects anyone reproducing these numbers. The test suite
loads the real `backend/.env` through `Settings.Config.env_file`, so **test results
depend on the contents of that file.**

Concretely: copying `.env.example` verbatim — which the README instructs — makes **six
reporting tests fail**, because the template ships
`REPORT_RECIPIENT_ALLOWLIST=["@deheus.com"]` while those tests assume the code default
of `[]`. They are not defects. This machine's `.env` happens not to set that key, which
is why they pass here.

### One failure worth flagging for Phase C

`test_primary_behavior_classifier_is_extra_trees_with_configured_threads` asserts the
loaded behavior classifier is an `ExtraTreesClassifier`; the model that actually loads
from `backend/weights/behavior.joblib` is an **`XGBClassifier`**. The same test run
also emits an XGBoost warning that the pickle was serialized by an older XGBoost
version. This is recorded here as an observation only.

`VERIFY:` whether `behavior.joblib` is the intended production behavior model and the
test is stale, or the test is right and the deployed weights file is the wrong
artifact. This has to be settled before the Phase C weights manifest can describe the
file honestly.

## 4. Backend lint — 29 errors

By rule:

| Rule | Count | Meaning |
| --- | --- | --- |
| `E402` | 15 | module-level import not at top of file |
| `F401` | 12 | imported but unused |
| `F841` | 1 | local variable assigned but never used |
| `E731` | 1 | lambda assigned to a variable |

By file:

| File | Count |
| --- | --- |
| `app/main.py` | 10 |
| `scripts/check_model.py` | 4 |
| `app/schemas/streaming.py` | 4 |
| `scripts/test_sign_detection.py` | 2 |
| `app/services/fall_detector.py` | 2 |
| `app/services/zone_violation_service.py` | 1 |
| `app/services/video_pipeline/__init__.py` | 1 |
| `app/services/feature_service.py` | 1 |
| `app/services/behavior_features.py` | 1 |
| `app/routers/streaming.py` | 1 |
| `tests/test_auto_zone.py` | 1 |
| `tests/services/test_ppe_violation_service.py` | 1 |

Ruff reports 11 of the 29 as auto-fixable, with 2 further fixes available only under
`--unsafe-fixes`. **No fixes were applied.** The `E402` cluster in `app/main.py` may
well be deliberate — import order there interacts with application startup — so this
count should not be read as 29 units of work.

## 5. Frontend type-check — clean

`tsc --noEmit` exits 0 with no output. The frontend is fully type-clean at `950e09c`.

## 6. Frontend lint — 34 problems

**21 errors, 13 warnings.**

| Rule | Severity | Count |
| --- | --- | --- |
| *(React Compiler diagnostic, no rule id printed)* `Calling setState synchronously within an effect can trigger cascading renders` | error | 10 |
| `@typescript-eslint/no-explicit-any` | error | 9 |
| `@typescript-eslint/no-unused-vars` | warning | 8 |
| `react-hooks/exhaustive-deps` | warning | 5 |
| `react/no-unescaped-entities` | error | 2 |

By file:

| File | Count |
| --- | --- |
| `src/components/dashboard/dashboard-shell.tsx` | 12 |
| `src/hooks/useLiveStream.ts` | 8 |
| `src/hooks/useAutoZoneSuggestions.ts` | 4 |
| `src/hooks/useZoneDrawing.ts` | 2 |
| `src/components/analytics/analytics-dashboard.tsx` | 1 |
| `src/components/dashboard/zone-button.tsx` | 1 |
| `src/components/factory3d/factory-3d-view.tsx` | 1 |
| `src/components/factory3d/use-zone-incidents.ts` | 1 |
| `src/components/ppe/video-tracking-overlay.tsx` | 1 |
| `src/lib/ppe-api.ts` | 1 |
| `src/types/camera.ts` | 1 |
| `src/types/detection.ts` | 1 |

The ten unlabelled errors come from the React Compiler lint that ships with Next.js 16
and `eslint-plugin-react-hooks` v6. They print as `Error: …` with no rule id, so they
cannot be suppressed or tallied by rule name the way the others can.

## 7. Measured vs. previously quoted figures

`docs/CHANGES_SINCE_OVERVIEW.md` §8 quotes commit `9591860` (2026-08-26) and states
plainly that those numbers were **not re-run** for that document. This is the first
re-run since.

| Figure | Quoted at `9591860` | Measured at `950e09c` | Delta |
| --- | --- | --- | --- |
| Backend tests passing | 391 | 411 | +20 |
| Backend test failures | 10 | 11 (10 + 1 PostgreSQL-unreachable) | +1, fully explained by infrastructure |
| Backend ruff | "clean on changed files" | 29 errors repo-wide | not comparable — different scope |
| Frontend `tsc` | clean | clean | unchanged |
| Frontend lint | 35 problems | 34 problems | −1 |

Reading of the deltas:

- **The ten-failure baseline has held.** Excluding the one test that needs a database,
  the failure count is identical to what `9591860` reported, and 20 tests were added
  in between. The pre-existing failures are stable, not spreading.
- **The ruff figures are not comparable.** `9591860` claimed ruff clean *on the files
  that commit changed*; this is ruff over the whole backend. The 29 errors are not a
  regression against that claim — they were never in its scope. This is the first
  repo-wide ruff number on record.
- **Frontend lint moved 35 → 34.** `VERIFY:` the cause. One problem fewer could come
  from the four commits after `9591860` or from a dependency version change, and the
  earlier run's per-rule breakdown was never recorded, so the two totals cannot be
  reconciled item by item.

## 8. Caveats — why these numbers may not reproduce elsewhere

1. **Measured in place, not on a fresh clone.** Deliberate: a clean clone would require
   re-installing `torch 2.12.0+cu132` and the full CUDA stack, and the resulting
   failures would be installation artifacts rather than a baseline. The true
   fresh-checkout experience is Phase E's clean-room check, not this document.
2. **A local `backend/.env` is present** and is gitignored. Settings in it override the
   `config.py` defaults, so a clone without it may behave differently. In particular
   `FALL_BEHAVIOR_MODEL_PATH` defaults in `config.py` to
   `weights/best_behavior_model.joblib`, a file that **does not exist on disk** — the
   local `.env` is what makes behavior-model loading work here at all.
3. **Real model weights are present and gitignored.** `backend/weights/` holds
   `ppe_v4.pt`, `pose.pt`, `reid.pt`, `sign_model.pt`, `behavior.joblib` and the
   `.onnx`/`.engine` exports. A fresh clone has none of them. Tests that touch model
   loading pass here *because* the files are present; that is not evidence a clone
   would pass. This is the gap Phase C's weights manifest exists to close.
4. **PostgreSQL and MinIO were not running.** Docker Desktop was down. This accounts
   for exactly one test failure and means no test requiring live storage was exercised.
5. **An NVIDIA GPU is present** and CUDA-enabled torch is installed. *Phase E measured
   the CPU-only case, so this is no longer an open question:* **the results are the
   same.** Ruff is identical (29), frontend type-check and lint are identical (clean,
   34), and the backend failure set is identical once the two environmental causes in
   Correction 2 are accounted for. The backend starts and serves all four health
   endpoints on CPU. The GPU affects throughput, not correctness.
6. **Three dependencies are unpinned** (`pillow`, `lap`, `opencv-python-headless`), so a
   fresh install does not necessarily get the versions measured here. Phase E's clean
   install resolved `opencv-python-headless` to **5.0.0.93** against this machine's
   **4.13.0.92** — a major version apart from the same requirements file.
7. **One machine, one run, no CI.** There is no continuous integration in this
   repository (a deliberate omission per `docs/HANDOVER_PLAN_LITE.md`), so nothing
   re-checks these numbers automatically. They are a point-in-time snapshot.

## 9. How to reproduce

```powershell
# from the repository root
git checkout 950e09c

# backend (needs the project venv; see section 1)
cd backend
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .

# frontend
cd ..\frontend
.\node_modules\.bin\tsc --noEmit
npm run lint
```

For the single database-dependent test, start the infrastructure first
(`docker compose up -d` from the repository root, then wait for `postgres` to report
`healthy`).
