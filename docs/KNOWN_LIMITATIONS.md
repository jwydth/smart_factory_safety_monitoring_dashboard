# Known limitations

What this system does **not** do, as of commit `950e09c`. Every item was verified
against the code; where a limitation was described inaccurately elsewhere in the
project's own documents, the accurate version is given here.

This exists so De Heus is not surprised. None of it is a defect report — these are
scope boundaries of a capstone project, and most were deliberate.

---

## 1. There is no authentication. On anything.

**This is the most important item on the page.** No endpoint requires a credential,
a token, or a session. Anyone who can reach the backend port can call anything,
including:

| Endpoint | Consequence |
| --- | --- |
| `DELETE /violations` | **Deletes every logged PPE incident.** No confirmation server-side. |
| `DELETE /behavior-incidents/{id}` | Deletes a behavior incident. |
| `DELETE /zone-violations/{id}` | Deletes a zone incursion. |
| `DELETE /physical-zones/{id}`, `DELETE /zones/{id}` | Removes zone configuration. |
| `DELETE /cameras/{id}` | Removes a camera. |
| `POST /reports/incidents/email` | **Sends email through the configured SMTP account.** |

The frontend's "type DELETE to confirm" dialog is a **client-side** guard only. It
protects against a mis-aimed click; it does not protect the endpoint.

### The email endpoint is the sharpest edge

With no auth, an open recipient field makes `POST /reports/incidents/email` an open
mail relay running on De Heus's SMTP credentials. Three settings limit the damage, and
**the code default for the most important one is the unsafe value**:

| Setting | Default in `config.py` | Note |
| --- | --- | --- |
| `REPORT_RECIPIENT_ALLOWLIST` | `[]` — **allows any recipient** | Set this. `backend/.env.example` ships `["@deheus.com"]`; the code default does not. |
| `REPORT_MAX_RECIPIENTS` | `10` | Per request. |
| `REPORT_EMAIL_RATE_LIMIT_PER_HOUR` | `20` | In-process only — see §2. |
| `REPORT_EMAIL_ENABLED` | `False` | Master switch, off by default. |

**Mitigation until authentication exists:** do not expose the backend port beyond a
trusted network, and set `REPORT_RECIPIENT_ALLOWLIST`.

## 2. `POST /predict` is broken

**This is a live bug, not a scope boundary.** Calling `POST /predict` with model
weights loaded returns **HTTP 500**.

`PPEDetector.predict()` dispatches to `self._real_predict(image)`
(`app/services/ppe/detector.py:292`) whenever a real model is loaded. **That method
does not exist anywhere in the codebase.** `app/routers/detection.py:73` calls
`predict()` directly, so the endpoint hits it.

Verified empirically rather than by reading:

```
model loaded: True
AttributeError: 'PPEDetector' object has no attribute '_real_predict'
```

It only works in mock mode (no weights), where `predict()` takes the
`_mock_predict` branch instead — which is why it was never noticed.

> `docs/CODEBASE_OVERVIEW.md` §24 described this as latent dead code that is
> "unexercised because the only production callers route through `video_pipeline`".
> That is not accurate: `POST /predict` is a production caller.

**Impact is small in practice.** Nothing in the frontend's main flow uses it — live
detection goes through `/ws/stream` and uploaded video through `/predict-video`, both
of which route via `video_pipeline` and work correctly. It matters for anyone
integrating against the API expecting single-image inference to work.

Not fixed here, because the handover is documentation-only. The fix is small:
implement `_real_predict`, or route `predict()` through the same path
`process_video` uses.

## 3. Single-worker only

The backend **cannot be run with multiple uvicorn workers.** Several pieces of state
live in process memory, and each worker would see only its own:

| State | Where | What breaks with >1 worker |
| --- | --- | --- |
| Live-stream registry | `app/services/live_streams.py` | The `live_cameras` KPI counts only the streams on the worker that answered. |
| Email rate limiter | `app/routers/reports.py` (`_send_timestamps`, a module-level list) | Each worker keeps a separate counter, so the real limit is N × the configured value. |
| Report scheduler | `app/main.py` | Each worker starts its own scheduler, so a scheduled report is sent N times. |
| Model pool | `app/services/ppe/detector.py` | Each worker loads its own copy of the weights into VRAM. |

This also means the system does not scale horizontally. Capacity is bounded by one
process on one machine with one GPU.

## 4. The report scheduler is in-process

`app/main.py` uses APScheduler's `BackgroundScheduler`, started inside the API
process. Consequences:

- **Scheduled reports stop when the backend stops.** Nothing catches up on restart; a
  report whose scheduled time passed while the process was down is simply not sent.
- There is no persistent job store, so schedule state beyond the database row is lost
  on restart.
- See §2 for what happens with more than one worker.

## 5. Evidence snapshots are orphaned in MinIO when incidents are deleted

Deleting an incident row generally does **not** delete its snapshot object. Storage
grows forever and must be reclaimed by hand.

| Delete path | Cleans up MinIO? |
| --- | --- |
| `delete_all_behavior_incidents` | **Yes** — the only path that does |
| Single behavior-incident delete | No (deliberate; the bulk operation handles it) |
| PPE violation, single or bulk | No |
| Zone violation, single or bulk | No |

> Note: the project's handover plan described this as "orphaned MinIO objects on
> delete" without qualification. The bulk behavior path is the exception.

There is no retention policy and no cleanup job. `VERIFY:` whether De Heus wants a
lifecycle rule on the MinIO bucket.

## 6. Two behavior incident types can never occur

`BehaviorType` (`app/models/behavior_incident.py`) declares four values, and
`incident_normalization.py` has display labels for all four, but the write path
(`fall_detector.py:273`) only ever produces two:

```python
behavior_type = BehaviorType.RUNNING_DETECTED if label == "running" else BehaviorType.FALL_DETECTED
```

`FAINT_DETECTED` and `COLLAPSE_DETECTED` are **unreachable**. The classifier emits
three labels (`others`, `running`, `falling`), so there is nothing to map onto them.
They are not a feature that is switched off; there is no code path to them at all.

## 7. Proximity violations are read-side only

Nothing writes a proximity violation any more. The severity rules still special-case
it — `incident_filters.py` and `incident_normalization.py` both map a
`violation_type` containing `proximity` to **Low** — so the rule survives for any
historical rows, but no new proximity incident can be created.

If a database carries old proximity rows they will display and filter correctly. A
fresh database will never contain one.

## 8. The KPI row has two real metrics, not four

> The handover plan called these "placeholder KPIs". That is now out of date: the
> placeholders were **removed**, not left in.

`useSafetyKpis.ts` renders **Open Incidents** and **Live / Total Cameras**. *PPE
Compliance* and *People On Shift* were removed because they had no data source behind
them and sat as permanent `—` placeholders, pushing the two real numbers to the edges
of the strip. They return if and when a data source exists.

Two caveats on the numbers that *are* shown:

- **Open Incidents** counts Critical + High severity only, within the selected range.
- The **Total Cameras** denominator counts rows in the `cameras` table, which can
  include cameras that are registered but not streaming.

## 9. No accuracy figure in this repository, and the training data was synthetic

**No accuracy figure for any model appears in this repository, and none should be
inferred from it.** Training metrics were recorded, but they are held in the separate
`ppe_labeling` labelling-tool documentation maintained by another member of the
capstone team — obtain them from there (`VERIFY:` its location). They are
training/validation metrics on synthetic data, not field performance.

The models were trained on synthetic footage generated with ComfyUI and Wan 14B, not
on video from a De Heus site. The capstone demo footage was likewise
AI-generated, which is why the dashboard shows an AI-disclaimer badge on every
annotated camera tile.

What that means practically: performance on real De Heus cameras — different lighting,
lens, mounting height, uniforms, and crowding — **is unknown**. A pilot on real
footage is the only way to find out. See `docs/MODELS.md`.

No evaluation against the original project's target metrics was run; this was
deliberately out of scope for the handover.

## 10. A database outage prints the password into logs

When PostgreSQL is unreachable, psycopg's traceback includes the full connection
string, password included. It appears in plain `pytest` output and will appear in any
server log, bug report or screenshot taken during an outage.

Discovered while capturing the Phase A baseline; see `docs/handover/SECURITY.md` §4
for the detail and two possible mitigations. Not fixed, because fixing it is a code
change.

## 11. Test and lint debt

Measured at `950e09c` and recorded in full in `docs/handover/BASELINE.md`:

| | |
| --- | --- |
| Backend tests | **9 deterministic failures** out of 422, plus 1 that needs a database and at least 1 that is timing-flaky |
| Backend lint | 29 ruff errors (mostly `E402` import placement in `app/main.py`, and unused imports) |
| Frontend type-check | **Clean** |
| Frontend lint | 34 problems (21 errors, 13 warnings) |

**Seven of the nine** are in `tests/test_auto_zone.py`; the other two are in
`test_incident_diagnostics.py` and `test_stream_health.py`. Fixing them was explicitly
out of scope for the handover, so the numbers are recorded rather than repaired.

Two further things make this debt easy to misread, both found by the
[clean-room test](./handover/CLEAN_ROOM_TEST.md):

- **`pytest` and `ruff` are not in `requirements.txt`**, and there is no dev-requirements
  file, so a fresh checkout cannot run the checks the README asks for until they are
  installed by hand. A `requirements-dev.txt` pinning `pytest==9.1.1` and
  `ruff==0.15.20` is the tidy fix; it was not added here because the handover is
  documentation-only.
- **The test suite reads `backend/.env`**, so results depend on local configuration.
  Copying `.env.example` verbatim adds **six spurious reporting failures** from
  `REPORT_RECIPIENT_ALLOWLIST`. The tests assume the code default (`[]`); the template
  ships the safe value. The tests are wrong here, not the template.

There is also **no CI**. Nothing re-checks any of this automatically.

## 12. Operational gaps

- **No container image for the backend or frontend.** `docker-compose.yml` runs only
  the infrastructure (PostgreSQL, MinIO, MediaMTX); the application itself is started
  by hand. A `backend/Dockerfile` exists — `VERIFY:` whether it is current, as it is
  not referenced by the compose file or by any documented workflow.
- **No automated backups.** See `docs/OPERATIONS.md` for the manual procedure.
- **No log aggregation, metrics, or alerting.** Health endpoints exist and must be
  polled by something external if you want to be told about a failure.
- **TensorRT engines are machine-specific.** The supplied `.engine` files only load on
  hardware matching the machine that built them; see `backend/weights/README.md`.

## 13. Smaller behavioral limits worth knowing

- **A camera slower than 24 FPS produces no behavior output at all.** The classifier
  needs 60 ordered samples on a canonical 24-FPS timeline, and a slower source can
  never fill the window. The reason is surfaced on the worker, and the dashboard shows
  a "Behavior detection unavailable" banner, but there is no workaround short of a
  faster source. `FALL_LIVE_FRAME_STRIDE` is validated to be exactly `1` for the same
  reason.
- **`MAX_CONCURRENT_STREAMS` caps simultaneous cameras at 8** by default. Connections
  beyond the ceiling queue for a free model instance and time out.
- **The severity rule exists in three places** that must be changed together — the
  Python read layer, the SQL predicates, and a TypeScript mirror in the frontend.
  A test asserts the first two agree; **nothing checks the TypeScript mirror.**
- **PPE is never Critical.** By design — severity is derived from how many rules a
  person is breaking at once. A Critical filter asks the PPE table for nothing.
- **All timestamps are stored in UTC.** `REPORT_TIMEZONE` affects report presentation
  only.
