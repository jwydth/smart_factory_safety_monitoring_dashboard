# Security & Credentials — Phase B

Scan results and credential handling for the handover of this repository to
De Heus LLC. **No secret value appears in this document.**

| | |
| --- | --- |
| Commit scanned | `950e09c` (working tree at the time of the Phase B branch) |
| Scanner | gitleaks 8.30.1 (installed for this purpose; see §1) |
| Scanned | 2026-10-10 |
| Result | **No secret has ever been committed to this repository.** Committed development placeholders are a separate matter — see §2. |
| Repository visibility | **Public** |

---

## 1. Secret scan

Two scans were run, both with `--redact` so that scanner reports could not themselves
become a leak. Reports were written outside the repository and are **not** committed.

### Full git history — clean

```bash
gitleaks git . --log-opts="--all" --redact
```

`--log-opts="--all"` covers **every ref**, not just `develop`, so abandoned feature
branches are included.

> 141 commits scanned · ~7.71 MB · **no leaks found**

### Working tree — clean

```bash
gitleaks dir . -c <config> --redact
```

The config excluded `node_modules/`, `.venv/`, `.next/`, caches and model binaries
(`.pt`, `.onnx`, `.engine`, `.joblib`), which are vendored or non-text.

> ~51.03 MB scanned · **no leaks found**

The scan **did** include the gitignored environment files, which are the
highest-risk files on disk. This was verified by scanning each one individually
rather than assumed:

| File | Bytes scanned | Result |
| --- | --- | --- |
| `backend/.env` | 3,836 | no leaks found |
| `frontend/.env.local` | 43 | no leaks found |
| `frontend/.env.production.local` | 55 | no leaks found |

### Confirmed: no `.env` was ever tracked

```bash
git log --all --diff-filter=A -- "**/.env" ".env" "**/.env.local" "**/.env.production.local"
```

Returns nothing. A search of every blob in every ref for a `.env`-named object found
only `frontend/.env.local.example`, a template.

**Consequence: no credential rotation is required as a precondition for anything, and
no history rewrite is needed.** The Phase B instruction to "stop and report, rotate
first" does not apply — there was nothing to stop for.

### What a clean scan does *not* mean

gitleaks matches high-entropy strings and known credential formats. It does **not**
flag a low-entropy placeholder such as a dictionary-word database password. The
committed development defaults in §2 were therefore found by reading the files, not by
the scanner, and a clean gitleaks run should not be read as "this repository contains
no credentials".

---

## 2. Committed development defaults — DEV ONLY, and the repository is public

> **The GitHub repository is public** (verified 2026-10-10: the API reports
> `"private": false`). Everything in §2 is therefore world-readable, and so is every
> commit in the history scanned in §1.

These are placeholders committed deliberately so that `docker compose up -d` works on a
laptop. They are now marked `DEV ONLY` in the files that define them.

### Why this is more than cosmetic

The development machine's PostgreSQL and MinIO **use these exact published values** —
evidenced by the psycopg traceback in §4 (`password=safety_password`) and by the
`.env` key lengths recorded in §3, where both MinIO keys are 10 characters, matching
`minioadmin`.

So the credentials protecting the development data store are public knowledge. That is
an exposure **only if those ports were ever reachable from outside `localhost`**, which
this review could not determine — a public tunnel would leave no trace in git.

`VERIFY:` whether the stack was ever exposed publicly (for example through an ngrok
tunnel; a local `ngrok_deploy` branch exists, though it was never pushed and carries no
ngrok configuration or authtoken). **If it was, treat the development PostgreSQL and
MinIO as compromised rather than merely stale**, and assume their contents were
readable.

| Credential | Defined in | Note |
| --- | --- | --- |
| PostgreSQL password | `docker-compose.yml`, `backend/.env.example` | dictionary-word placeholder |
| MinIO root user / password | `docker-compose.yml`, `backend/.env.example` | the MinIO project's own documented placeholders — treat as public |

They are acceptable only where nothing is exposed outside `localhost`. For any shared
or production deployment, override them through the environment:

```bash
# PostgreSQL — read by docker-compose.yml
POSTGRES_DB=... POSTGRES_USER=... POSTGRES_PASSWORD=...

# MinIO — read by docker-compose.yml
MINIO_ROOT_USER=... MINIO_ROOT_PASSWORD=...

# Backend — read from backend/.env
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:PORT/DBNAME
MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=...
```

`docker-compose.yml` already reads all four values from the environment with the
placeholder only as a fallback, so overriding requires no file edit.

## 3. Live credentials that exist only in the untracked `backend/.env`

The local `backend/.env` holds **real** working credentials. It is gitignored, was
never committed, and **must not be included in the handover package**. Recorded here
as key names and whether a value is set — no values.

| Key | State |
| --- | --- |
| `DATABASE_URL` | set (contains a password) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | set (the DEV ONLY placeholders) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` | set |
| **`SMTP_PASSWORD`** | **set — a real mail-account credential** |
| `SMTP_FROM_EMAIL` / `SMTP_FROM_NAME` | set |

`SMTP_PASSWORD` is the one genuine live secret in the project. gitleaks did not flag
it because it is not in git and its format is not distinctive. The tracked
`backend/.env.example` correctly ships it **empty**.

**Action required at handover (Phase F):** rotate the SMTP credential, the MinIO keys
and the database password, and hand over new values through a channel that is not this
repository. Rotating the SMTP credential also revokes whatever mail account the
capstone team used for report delivery.

## 4. A connection failure prints the database password

Found while capturing the Phase A baseline, not by the scanner.

When PostgreSQL is unreachable, psycopg's exception traceback includes the full
connection string — password and all. It appeared in plain `pytest` output:

```
conninfo = 'host=... dbname=... user=... password=<REDACTED> port=... ...'
```

The value was redacted in the committed baseline log
(`docs/handover/baseline-logs/01-backend-pytest.txt`, redaction noted at the top of
that file). The behavior itself is unchanged — fixing it would be a code change, which
this docs-only handover does not make.

**Why it matters:** any CI log, bug report, screenshot or pasted stack trace taken
during a database outage will carry the production password. Two mitigations worth
considering, neither applied here:

- Configure logging to scrub DSNs from tracebacks.
- Give the application a least-privilege database role, so an exposed credential is
  not the full-access one.

This belongs in `docs/KNOWN_LIMITATIONS.md` (Phase D) alongside the existing
no-authentication limitation.

## 5. Files removed in Phase B

Both were tracked, both had **zero** references anywhere in `backend/app`,
`backend/scripts` or `backend/tests` (verified with `git grep` before removal), and
both remain recoverable from git history.

| File | Size | Why removed |
| --- | --- | --- |
| `backend/weights/behavior.joblib.truncated.bak` | 659 KB | A truncated, unusable model file. Loading it raises an EOF error — `fall_detector.py` has a comment describing exactly that failure. Keeping a broken artifact next to working weights invites someone to point the config at it. |
| `backend/app/services/ppe/weights/yolov8n.pt` | 6.5 MB | A stock upstream YOLOv8-nano checkpoint, unreferenced. All weights resolve from `settings.*_MODEL_PATH` under `backend/weights/`; nothing constructs a module-relative weights path (verified). Removing it emptied `app/services/ppe/weights/`, which is now gone. |

## 6. `AGENTS.md` was both tracked and gitignored

`AGENTS.md` is committed, but `.gitignore` also listed it — so the project's own
coding guidelines would be invisible to anyone cloning and then re-adding them, and
local edits were silently untracked. The `.gitignore` entry has been removed; the file
is unchanged.

## 7. Behavior model — the config default was right, the template was wrong

Phase B expected a cosmetic one-line disagreement between `config.py` and
`.env.example`. It is not cosmetic. Evidence:

| Source | Says |
| --- | --- |
| `config.py:147` | default is `weights/best_behavior_model.joblib` |
| `git log -S` on that line | changed by `de167f9` *[UPDATE] Behavioral model update*, which switched the default **from** `behavior.joblib` **to** `best_behavior_model.joblib` |
| `fall_detector.py:156,196` | calls the configured joblib "the primary artifact" and the UBJ file a "fallback" |
| `config.py:182` | labels `FALL_BEHAVIOR_PORTABLE_MODEL_PATH` an "Optional **legacy** XGBoost artifact" |
| the deleted artifact, loaded from `de167f9` | `ExtraTreesClassifier`, 141 features, 3 classes, 11,510,305 bytes |
| `backend/weights/behavior.joblib` on disk | `XGBClassifier`, 141 features, 3 classes, 5.6 MB |

So the ExtraTrees model is the intended primary classifier, `config.py` was already
correct, and `backend/.env.example` was pointing new developers at the **older
XGBoost model**. Because both models accept 141 features and return 3 classes, the
wrong one loads and runs silently; the only visible symptom is one failing test.

**`.env.example` has been corrected** to `weights/best_behavior_model.joblib`, with a
comment explaining the trap. No code was changed.

### The ExtraTrees model is recoverable from this repository

It was deleted from git in `c7653a4`, but it is still in history:

```bash
git show de167f9:backend/weights/best_behavior_model.joblib > backend/weights/best_behavior_model.joblib
```

Verified: the extracted file loads as an `ExtraTreesClassifier` with
`n_features_in_=141` and `classes_=[0 1 2]`. One of the five weights files therefore
does **not** need to come from the capstone team — Phase C will record it this way.

`VERIFY:` whether `de167f9`'s ExtraTrees model is the final trained version or whether
a newer one exists outside git that was never committed.

### A correction to existing documentation

`docs/CHANGES_SINCE_OVERVIEW.md` §7 states the default was renamed
`best_behavior_model.joblib` → `behavior.joblib`. **That is backwards**, and the
commit that changed it (`de167f9`) predates that document's stated range entirely.
Phase D merges that document into `docs/ARCHITECTURE.md` and must not carry the error
forward.

## 8. Known security limitations, not addressed here

Recorded for `docs/KNOWN_LIMITATIONS.md` (Phase D). None is a Phase B change, because
each would require modifying behavior.

- **No authentication anywhere.** `DELETE /violations` (delete every logged incident)
  and the email-report endpoint are both unauthenticated.
- **The DSN-in-traceback exposure** in §4.
- **Committed development defaults** in §2 — mitigated by labelling, not removed.

---

## Scope note

Phase B changed configuration templates, `.gitignore`, documentation, and removed two
dead binary files. **No application behavior was changed.** No test or lint problem
from `BASELINE.md` was fixed.
