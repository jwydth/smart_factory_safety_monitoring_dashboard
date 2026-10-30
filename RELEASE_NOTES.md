# Release notes — `v1.0.0-handover`

Handover release of the Smart Factory Safety Monitoring system to **De Heus LLC**.

| | |
| --- | --- |
| Tag | `v1.0.0-handover` |
| Code baseline | `950e09c` on `develop` |
| Date | 2026-10-10 |
| Contents | **Documentation only.** 7 commits, 36 files, no application behaviour changed. |

**This release changes no application code.** Its purpose is to make the existing
system understandable, verifiable and operable by someone who did not build it. The two
Python files it adds are a weights verifier and a documentation generator; neither is
imported by the application.

---

## What's in it

### Documentation

| Document | What it gives you |
| --- | --- |
| `README.md` | Entry point: what this is, a quick start, repo map, doc index, contact |
| `docs/USER_GUIDE.md` | For HSE staff. No technical knowledge assumed |
| `docs/OPERATIONS.md` | Start/stop, ports, health endpoints, backups, troubleshooting |
| `docs/ARCHITECTURE.md` | How it is built, and why the odd-looking decisions are the way they are |
| `docs/KNOWN_LIMITATIONS.md` | **Read this before relying on the system** |
| `docs/MODELS.md` | One card per AI model: purpose, classes, provenance, limits |
| `OWNERSHIP.md` | Ownership, contact, and a third-party licensing item needing a decision |

### Generated references — they cannot drift from the code

Produced by `backend/scripts/generate_docs.py`, which reads the source rather than
describing it:

- `docs/CONFIGURATION.md` — 121 settings, from `config.py` via its AST
- `docs/API.md` — 38 paths / 50 operations, from the live OpenAPI schema
- `docs/DATABASE.md` — 14 tables with columns, foreign keys and indexes, from the
  SQLModel metadata

Regenerate with `python scripts/generate_docs.py` after changing the code.

### Model weights are now documented and verifiable

Weights are gitignored, so a fresh clone cannot run detection. This was the one thing
without which nothing works.

- `backend/weights/MANIFEST.json` — per model: purpose, the setting that loads it, size,
  SHA-256, classes, training provenance, and **where to obtain it**
- `backend/weights/README.md` — the human version, plus training-data provenance
- `backend/scripts/verify_weights.py` — checks presence, size and checksum; names what
  is missing and how to get it. Exits non-zero, so it can gate a deployment

**One of the five models turned out to be recoverable from this repository's own git
history**, so only four need to be delivered separately.

### Handover evidence

- `docs/handover/BASELINE.md` — the measured state at handover, with full command logs
- `docs/handover/SECURITY.md` — secret-scan results and credential handling
- `docs/handover/CLEAN_ROOM_TEST.md` — the README followed on a fresh checkout
- `docs/handover/CHECKLIST.md` — the acceptance checklist for De Heus

### Housekeeping

- Default credentials in `docker-compose.yml` and `.env.example` marked **DEV ONLY**,
  with production override instructions
- `.env.example`'s `DATABASE_URL` port corrected (said 5432, compose publishes 5433)
- `.env.example` now points at the correct behaviour model
- Two dead binaries removed: a truncated, unusable model backup and an unreferenced
  stock YOLO checkpoint. Both verified unreferenced; both recoverable from history
- `AGENTS.md` removed from `.gitignore`, where it was ignoring a tracked file
- Superseded documents moved to `docs/archive/` with explicit warning headers, and
  stale warnings added to five `backend/docs` files

---

## Known limitations

The full list is in [`docs/KNOWN_LIMITATIONS.md`](./docs/KNOWN_LIMITATIONS.md). The ones
that affect a deployment decision:

### Must be addressed before any exposed deployment

1. **No authentication on any endpoint.** Anyone who can reach the backend port can
   delete every incident or send email through the configured SMTP account. The
   frontend's typed confirmation is a client-side guard only. **Do not expose the
   backend port beyond a trusted network.**
2. **`REPORT_RECIPIENT_ALLOWLIST` defaults to empty**, which allows any recipient. Set
   it. With no authentication, an open recipient field makes the email endpoint a mail
   relay.
3. **`ultralytics` is AGPL-3.0**, and it is the inference engine behind PPE, pose and
   sign detection — not a peripheral dependency. Every `.pt` file also carries AGPL-3.0
   in its own metadata. This needs a legal decision: accept the terms, obtain a
   commercial licence, or replace the dependency.
4. **A database connection failure prints the password** into tracebacks and logs.

### Capacity and reliability

5. **Single-worker only.** The live-stream registry, email rate limiter, report
   scheduler and model pool are all in-process. Multiple uvicorn workers would multiply
   scheduled sends and break the live-camera count. The system does not scale
   horizontally.
6. **Scheduled reports only run while the backend is running**, with no catch-up on
   restart.
7. **Maximum 8 simultaneous cameras** by default (`MAX_CONCURRENT_STREAMS`).
8. **A camera below 24 FPS produces no behaviour detection at all** — the classifier
   needs 60 ordered samples on a 24-FPS timeline and cannot work with less.

### Data

9. **Evidence snapshots are orphaned in MinIO** when incidents are deleted, except via
   the bulk behaviour path. There is no retention policy or cleanup job.
10. **Back up the database and the MinIO bucket together.** Restoring them to different
    points in time leaves incidents pointing at missing evidence.

### Accuracy — the most important caveat

11. **No accuracy figure appears in this repository, and none should be inferred from
    it.** Training metrics were recorded but are held in the separate `ppe_labeling`
    labelling-tool documentation, maintained by another member of the capstone team —
    **obtain them as part of the handover.** They are training metrics on synthetic
    data.

    All training footage was **synthetic**, generated with ComfyUI and Wan 14B, not
    filmed at a De Heus site, and the models have never been evaluated against real
    factory cameras. **Performance in production is unknown**, and a pilot on real
    footage is the only way to establish it.

### Known defects, left unfixed

12. **`POST /predict` returns HTTP 500** with weights loaded — it calls a method that
    does not exist. Found and verified during this handover. The live path
    (`/ws/stream`) and uploaded video (`/predict-video`) are unaffected.
13. **9 backend tests fail deterministically** out of 422, seven of them in
    `tests/test_auto_zone.py`. Backend lint reports 29 problems, frontend lint 34. The
    frontend type-check is clean. Full detail in `docs/handover/BASELINE.md`.
14. **Two behaviour incident types are unreachable** (`FAINT_DETECTED`,
    `COLLAPSE_DETECTED`) — the classifier only produces three labels.
15. **`pytest` and `ruff` are in no requirements file.** Install them by hand; the
    README gives pinned versions.

---

## Deliberately not done

Out of scope for this handover, by agreement, and listed so their absence is not
mistaken for an oversight:

- **No CI pipeline.** Nothing re-checks tests or lint automatically.
- **No test fixes.** The failures are recorded, not repaired.
- **No authentication.** The largest known gap, and a feature, not a doc task.
- **No container packaging** for the backend or frontend. `docker-compose.yml` runs the
  infrastructure only.
- **No measured evaluation** against the original project's target metrics.
- **No demo kit or slide deck.** The demo was already given at the capstone event.
- **No dependency pinning** for the three unpinned packages, and no
  `requirements-dev.txt` — both recommended, both code changes.
- **No GPU or end-to-end verification** in the clean-room test: it covered install,
  startup and health, not live video or detection accuracy.

---

## Which branch is the handover baseline

**`develop` is the handover baseline, not `main`.**

At the time of this release `main` was **53 commits behind `develop`** and carried 7
commits of its own that `develop` does not have, including a revert. Its most recent
commit was 2026-07-05, roughly three months before this handover.

This matters because `docs/ARCHITECTURE.md` and the three generated references
(`CONFIGURATION.md`, `API.md`, `DATABASE.md`) were produced from the code on `develop`
at `950e09c`. **On `main` they would describe code that is not there.**

> **Open decision for De Heus:** someone cloning the repository's default branch gets
> the stale code, not the code these documents describe. Reconciling `main` with
> `develop` moves 53 commits of application code — a code release, with its own
> testing and risk — and was deliberately left out of a documentation-only handover.
> The options are to merge `develop` into `main`, to change the default branch to
> `develop`, or to leave it and tell everyone to use `develop`. **This has not been
> decided.**

## Upgrading from the previous state

There is nothing to upgrade — no application code changed. Two things to be aware of:

1. **If you run an existing database**, the three migration scripts in
   `docs/DATABASE.md` still need to have been run. They are idempotent.
2. **`backend/.env.example` changed.** If you copied it previously, re-check
   `FALL_BEHAVIOR_MODEL_PATH` (it now points at `best_behavior_model.joblib`, the
   correct ExtraTrees model) and `DATABASE_URL` (port corrected to 5433).

## Credentials must be rotated

Development credentials were used throughout the capstone project and are **not**
secrets any more. Before De Heus relies on this system, rotate:

- the SMTP account password (the only live secret, present only in the untracked
  `backend/.env`)
- the MinIO access and secret keys
- the PostgreSQL password

No credential was ever committed to this repository — verified by a full-history scan
across every ref. See [`docs/handover/SECURITY.md`](./docs/handover/SECURITY.md).
