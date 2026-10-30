# Handover checklist

For De Heus LLC to work through and tick off. Ordered so that nothing depends on
something further down.

Release `v1.0.0-handover` · code baseline `950e09c` · technical contact:
Ethan Phuc (Nguyen Trong Phuc) — ethan.phuc@deheus.com

---

## 1. Receive

- [ ] Repository access transferred — `jwydth/smart_factory_safety_monitoring`
- [ ] **Clone with full history** (not `--depth 1`) to a **short path**, e.g. `C:\dev\ppe`
- [ ] **Cloned the `develop` branch, not the default branch.** `develop` is the
      handover baseline; at handover `main` was 53 commits behind it and three months
      old, so the documentation does not describe the code on `main`
- [ ] Tag `v1.0.0-handover` is present
- [ ] **All five model weight files received** out of band: `ppe.pt`, `sign.pt`,
      `pose.pt`, `reid.pt`, `behavior.joblib` — delivered by the capstone
      team member who also documents the `ppe_labeling` tool
- [ ] TensorRT `.engine` files received — **what the demo actually ran on**, so expect
      `.pt`-only deployment to be slower. They only load on hardware matching the
      machine that built them; otherwise rebuild with `scripts/export_tensorrt.py`
- [ ] Confirmed what happened to the training datasets and the `ppe_labeling`
      repository — **without the datasets the two custom models can be replaced but not
      retrained** (see `docs/MODELS.md`)

## 2. Verify

- [ ] `python scripts/verify_weights.py` → **all 5 OK, exit 0**
- [ ] Backend starts: `python -m uvicorn app.main:app --port 8000`
- [ ] `GET /health`, `/health/db`, `/health/storage`, `/health/streams` → all **200**
- [ ] Frontend builds and loads at `http://localhost:3000`
- [ ] A camera streams and the dashboard shows annotated video
- [ ] An incident is recorded, appears in the Live Incident Panel, and has a snapshot
- [ ] A PDF report downloads
- [ ] Test/lint output matches `docs/handover/BASELINE.md`
      *(install `pytest` and `ruff` first — they are in no requirements file)*

## 3. Secure — do before any exposed deployment

- [ ] **Repository visibility decided.** It is currently **public**, which means the
      DEV ONLY placeholder credentials in `docker-compose.yml` and `.env.example` are
      world-readable — and the development PostgreSQL and MinIO used those exact values
- [ ] **Established whether the stack was ever exposed publicly** (e.g. an ngrok
      tunnel) while running on those default credentials. If it was, treat the
      development database and object store as compromised, not just stale
- [ ] **SMTP password rotated.** The only live secret. The old one was used throughout
      the capstone project and must be treated as compromised
- [ ] **MinIO access and secret keys rotated** (defaults were `minioadmin`/`minioadmin`)
- [ ] **PostgreSQL password rotated** (default was a dictionary word)
- [ ] New values supplied through something other than this repository
- [ ] `REPORT_RECIPIENT_ALLOWLIST` **set to a non-empty value**. The code default allows
      any recipient, which with no authentication makes the email endpoint a mail relay
- [ ] Backend port **not reachable** outside a trusted network — **there is no
      authentication on any endpoint**
- [ ] Accepted that the `docker-compose.yml` and `.env.example` defaults are marked
      DEV ONLY and must be overridden

## 4. Decide

- [ ] **`ultralytics` AGPL-3.0 reviewed by legal.** It is the core inference engine, not
      a peripheral dependency, and every `.pt` carries AGPL-3.0 in its own metadata.
      Options: accept the terms, buy a commercial licence, or replace it.
      **See `OWNERSHIP.md`**
- [ ] Decided whether a formal `LICENSE` file is wanted (none was added; ownership is
      stated in `OWNERSHIP.md`)
- [ ] Confirmed whether any RMIT capstone IP assignment paperwork should be referenced
- [ ] Data-protection position agreed for storing footage and snapshots of identifiable
      people
- [ ] Retention policy decided for the MinIO evidence bucket — **there is none, and
      deleted incidents mostly leave their snapshots behind**
- [ ] **Decided what happens to the `main` branch.** It is three months stale and
      diverged from `develop`, so anyone cloning the default branch gets code the
      documentation does not match. Options: merge `develop` into `main`, make
      `develop` the default branch, or leave it and tell everyone to use `develop`.
      See `RELEASE_NOTES.md`

## 5. Operate

- [ ] Read `docs/OPERATIONS.md`
- [ ] **Backups scheduled for the database *and* the MinIO bucket together.** There is
      no automated backup. A restore has been tested at least once
- [ ] Health endpoints polled by something external — there is **no alerting**
- [ ] Accepted the single-worker constraint: one process, one machine, one GPU,
      **maximum 8 simultaneous cameras**
- [ ] Accepted that scheduled reports only run while the backend runs, with no catch-up
- [ ] Owner named for restarting the system and responding to failures

## 6. Understand the limits

- [ ] **`docs/KNOWN_LIMITATIONS.md` read and accepted**
- [ ] **Model training metrics obtained** from the `ppe_labeling` labelling-tool
      documentation — they exist, but not in this repository, and this handover never
      saw them
- [ ] **Accepted that those are synthetic-data training metrics, not field
      performance.** Nothing has been evaluated against real De Heus cameras, so
      **production accuracy is unknown**
- [ ] A pilot on real footage planned before anyone relies on the output
- [ ] HSE staff told the system is an assistant, not a referee, and that every incident
      is a prompt to check rather than proof
- [ ] `docs/USER_GUIDE.md` passed to the people who will use the dashboard
- [ ] Noted that `POST /predict` returns 500 (unused by the dashboard; see
      `KNOWN_LIMITATIONS.md` §2)

## 7. Close

- [ ] Questions raised with the technical contact while they are still available
- [ ] Capstone team's access to the repository, MinIO and the mail account removed
- [ ] Development machine's local `backend/.env` destroyed rather than copied — **it
      contains live credentials and must not travel with the handover**
- [ ] Handover accepted

---

### If something does not work

1. `docs/OPERATIONS.md` — troubleshooting covers black video, missing behaviour
   detection, GPU not used, engines failing to load, and server freezes
2. `docs/handover/CLEAN_ROOM_TEST.md` — what a fresh install does and does not do, and
   the nine traps found while testing it
3. `docs/handover/BASELINE.md` — whether a failure is pre-existing or new
4. The technical contact above
