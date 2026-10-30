# Ownership

**This software is owned by De Heus LLC.**

It was produced as an RMIT University capstone project with De Heus LLC as the
industry partner. At handover, ownership of the source code in this repository rests
with De Heus LLC.

| | |
| --- | --- |
| Owner | De Heus LLC |
| Origin | RMIT University capstone project, De Heus LLC as industry partner |
| Technical contact | Ethan Phuc (Nguyen Trong Phuc), Information Technology — ethan.phuc@deheus.com |
| Handed over at | commit `950e09c`, branch `develop` |

## What this document is, and is not

This is a statement of ownership for the benefit of anyone reading the repository. It
is **not** a license grant, and no formal license text has been added to this
repository. A license is a legal instrument, and drafting one is not something this
handover should invent on De Heus's behalf.

`VERIFY:` whether De Heus wants a formal `LICENSE` file (for example a proprietary
"all rights reserved" notice) committed here, and whether the RMIT capstone
arrangement involved any student IP assignment paperwork that should be referenced
from this file. Until that is confirmed, treat the code as proprietary to De Heus LLC
with all rights reserved.

## What is covered

The source code, configuration, migration scripts, tests and documentation in this
repository.

## What is *not* in this repository

- **Model weights.** They are gitignored and delivered separately. Nothing in
  `backend/weights/` is tracked in git.
- **Training data and the labelling workflow.** Training footage was synthetic,
  generated with ComfyUI and Wan 14B rather than filmed at a De Heus site. The
  labelling tooling lives in a separate `ppe_labeling` repository, which is being
  documented separately by another member of the capstone team and is deliberately
  out of scope for this handover. `VERIFY:` where that documentation will live, so
  this file can point to it.
- **Credentials.** No secret has ever been committed to this repository; this was
  verified with a full-history scan (see `docs/handover/SECURITY.md`).

## Third-party licenses — one item needs a decision

Dependency licenses below were read from the installed package metadata in
`backend/.venv`, not from memory. Most are permissive. **One is not.**

| Dependency | Version | License |
| --- | --- | --- |
| **ultralytics** | **8.4.58** | **AGPL-3.0** |
| psycopg | 3.3.4 | LGPL-3.0-only |
| torch / torchvision | 2.12.0+cu132 / 0.27.0+cu132 | BSD-3-Clause |
| scikit-learn | 1.9.0 | BSD-3-Clause |
| xgboost | 3.2.0 | Apache-2.0 |
| minio | 7.2.20 | Apache-2.0 |
| opencv-python-headless | 4.13.0.92 | Apache-2.0 |
| uvicorn | 0.29.0 | BSD-3-Clause |
| sqlmodel / pydantic-settings / apscheduler | 0.0.38 / 2.2.1 / 3.11.3 | MIT |
| reportlab | 4.4.10 | BSD |
| joblib | 1.5.2 | BSD-3-Clause |
| lap | 0.5.13 | BSD-2-Clause |

**`ultralytics` is AGPL-3.0 and it is not a peripheral dependency.** It is the
inference engine behind PPE detection, pose estimation and sign detection — the
product's core function. AGPL-3.0 is a strong copyleft license whose obligations can
extend to software made available to users over a network.

This is recorded as a **fact about the dependency**, not as legal advice, and not as a
claim about what De Heus must do. The decision belongs with De Heus's legal function,
and the realistic options are to accept the AGPL terms, obtain an Ultralytics
commercial license, or replace the dependency. **It should be raised before this
system is deployed beyond internal evaluation.**

`VERIFY:` whether De Heus already holds an Ultralytics commercial license.

## Attribution

Parts of this codebase and its documentation were written with AI assistance
(Claude Code). This does not affect De Heus LLC's ownership of the result.
