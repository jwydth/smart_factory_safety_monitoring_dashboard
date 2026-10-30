# Models

One card per model in the detection pipeline. Facts here were read out of the model
files themselves — class lists, training dates, base architectures and training
arguments come from each checkpoint's embedded metadata, not from recollection.

For checksums, sizes and how to obtain the files, see
[`backend/weights/README.md`](../backend/weights/README.md) and
[`backend/weights/MANIFEST.json`](../backend/weights/MANIFEST.json).

## The reference configuration used TensorRT

Each card below names the `.pt` file, because that is the portable artifact and the
`config.py` default. **The capstone development and demo machine did not run three of
them that way.** Its `backend/.env` pointed at pre-built TensorRT engines:

| Model | `.pt` (default) | What the demo machine actually loaded |
| --- | --- | --- |
| PPE | `weights/ppe.pt` | **`weights/ppe.engine`** |
| Signs | `weights/sign.pt` | **`weights/sign.engine`** |
| Pose | `weights/pose.pt` | **`weights/pose.engine`** |
| Re-identification | `weights/reid.pt` | `weights/reid.pt` — no engine exists for it |
| Behavior | `weights/behavior.joblib` | a joblib classifier; TensorRT does not apply |

Two consequences worth stating plainly:

- **Any speed you were shown was TensorRT speed.** Running from `.pt` works — it was
  verified end to end on a CPU-only clean install — but it is slower, and that is not
  a fault.
- **Engines only load on hardware matching the machine that built them.** To get demo
  performance on different hardware, rebuild them with
  `scripts/export_tensorrt.py`; see
  [`backend/weights/README.md`](../backend/weights/README.md).

## Read this before judging any model below

**No accuracy number appears in this repository, and this document deliberately does
not invent one.**

Training metrics **were** recorded, but they live outside this repository: they are
held in the documentation for the separate `ppe_labeling` labelling-tool repository,
maintained by another member of the capstone team. `VERIFY:` the location of that
documentation and obtain it — it is the only place the model evaluation figures exist,
and this handover could not reference figures it has not seen.

Two cautions when those figures arrive:

- They are **training/validation metrics on synthetic data**, not field performance.
- **No measured evaluation was run against real De Heus footage**, so they say nothing
  about how the models behave on your cameras.

**All training footage was synthetic**, generated with ComfyUI and Wan 14B rather than
filmed at a De Heus site. The models have therefore never been tested against the
conditions they would actually run in: real lighting, real lens and mounting height,
real uniforms, real crowding. **Performance on real cameras is unknown.** A pilot on
real footage is the only way to establish it.

---

## PPE detection — `ppe.pt`

| | |
| --- | --- |
| Purpose | Finds people and the safety equipment they are or are not wearing |
| Setting | `MODEL_PATH` |
| Classes | `person`, `helmet`, `vest`, `cleaning_coverall` |
| Architecture | YOLO, fine-tuned from `yolo12n.pt` |
| Trained | 2026-08-26, 100 epochs, 640px, batch 32, ultralytics 8.4.51 |
| Origin | **Custom-trained for this project** |

This is the model the product is named after. A violation is raised when a person is
detected without a required item, confirmed over time rather than on a single frame
(`VIDEO_VIOLATION_CONFIRM_SECONDS`) so a momentary miss does not log an incident.

**`cleaning_coverall` is how a janitor is identified.** `response_builder.py` maps a
detected cleaning coverall to `role="janitor"`, and that role exempts the person from
SLIPPERY-zone violations — a janitor mopping a wet floor is doing their job, not
breaking a rule. Janitors are still flagged in RESTRICTED zones, and still flagged for
PPE they are genuinely missing.

**Limits.** Four classes only: no gloves, boots, eye or hearing protection. The class
list is baked into the weights, so adding an item means retraining, not configuration.

## Safety-sign detection — `sign.pt`

| | |
| --- | --- |
| Purpose | Reads safety signage on the factory floor to propose zones automatically |
| Setting | `SIGN_MODEL_PATH` |
| Classes | `M014_Helmet`, `M015_Vest`, `P004_NoThoroughfare`, `W011_Slippery` |
| Architecture | YOLO, fine-tuned from `yolov9t.pt` |
| Trained | 2026-06-14, 100 epochs, 640px, batch 16, ultralytics 8.4.51 |
| Origin | **Custom-trained for this project** |

This drives the auto-zone feature: point a camera at a "No Thoroughfare" sign and the
system suggests a RESTRICTED zone around it, which an operator accepts or dismisses.

A sign must **hold still for 3 seconds** (`AUTO_ZONE_STATIONARY_SECONDS`, within
`AUTO_ZONE_MOVE_TOLERANCE`) before a suggestion appears, so a sign being carried
across the floor does not create zones behind it. Only a sign that has been put down
and left in place counts.

Two of the four classes create zones (`SIGN_CLASS_ZONE_MAP`: `P004` → RESTRICTED,
`W011` → SLIPPERY); the helmet and vest signs instead switch on PPE checking for that
camera (`SIGN_CLASS_PPE_TRIGGER`).

**A naming inconsistency to be aware of:** `SIGN_CLASS_NAMES` in `config.py` lists
classes 0 and 1 as `M001_MustWearHardHat` and `M002_MustWearSafetyVest`, while the
weights themselves say `M014_Helmet` and `M015_Vest`. The indices agree, so behavior
is correct, but the names disagree. `VERIFY:` which naming is intended before either
is used in a report or a UI label.

## Pose estimation — `pose.pt`

| | |
| --- | --- |
| Purpose | Produces the 17-keypoint skeletons the behavior classifier consumes |
| Setting | `FALL_MODEL_PATH` — **the demo machine pointed this at `pose.engine`, not `pose.pt`** |
| Classes | `person`, with 17 COCO keypoints (`kpt_shape [17, 3]`) |
| Architecture | `yolo26s-pose` |
| Trained | 2026-01-11, 300 epochs, 640px, batch 128, on stock `coco-pose`, ultralytics 8.3.222 |
| Origin | **Upstream Ultralytics model — not trained for this project** |

Its checkpoint metadata shows training on the public COCO-pose dataset on an
Ultralytics developer machine, so this is a general-purpose public model. It is
therefore **replaceable**: any COCO-pose model producing 17 keypoints should work.

`VERIFY:` whether it is byte-identical to a published Ultralytics release. Confirming
that needs a download and comparison, which was not done.

## Behavior classification — `behavior.joblib`

| | |
| --- | --- |
| Purpose | Decides whether a tracked person is behaving normally, running, or falling |
| Setting | `FALL_BEHAVIOR_MODEL_PATH` |
| Classes | `others`, `running`, `falling` — **in that index order** |
| Architecture | scikit-learn `ExtraTreesClassifier` |
| Input | 141 transformed pose/motion features over a 60-frame window |
| Trained | `VERIFY:` unknown. Final file supplied by the capstone team on 2026-10-30 (300 trees). An older version (500 trees) is in git at `de167f9`. |
| Origin | **Custom-trained for this project** |

**ExtraTrees is confirmed as the production classifier** — by the capstone team, and it
is what the capstone report documents. Three things in the code agree: the `config.py`
default, its comment (*"The current production artifact is an sklearn
ExtraTreesClassifier"*), and the assertion in `tests/test_fall_detector.py`.

> **But the capstone demo did not run it.** The development machine's `.env` pointed
> `FALL_BEHAVIOR_MODEL_PATH` at the superseded `behavior.joblib`, which is an
> **XGBoost** model (`XGBClassifier`, 1466 estimators, verified by loading it). Both
> take 141 features and return the same three classes, so it loaded and ran silently —
> the mismatch produced no error, only a failing test. Whatever behaviour detection was
> demonstrated came from the XGBoost model, not this one. The two agree on about 95% of
> inputs, but they are not the same model.
>
> `backend/.env.example` is corrected. Anyone with an existing `.env` should repoint it.

This is the only non-YOLO model in the pipeline, and the only one that reasons over
time rather than over a single frame. It consumes a rolling 60-frame window of pose
keypoints on a canonical 24-FPS timeline and emits three probabilities.

### Three things that will bite whoever maintains this

1. **The class order is load-bearing.** `fall_detector.py` unpacks `predict_proba`
   positionally — `others, running, falling = probabilities`. A retrained model with
   the same three classes in a different order produces confidently wrong labels with
   no error anywhere.
2. **A source below 24 FPS produces nothing.** The window needs 60 real samples;
   `accept_source_frame` pads a slow timeline with missing ones, capping the achievable
   ratio at `source_fps / CANONICAL_FPS` so the quality check can never pass. This is
   why `FALL_LIVE_FRAME_STRIDE` is validated to be exactly `1`.
3. **A wrong-but-compatible model loads silently.** An older XGBoost artifact, also
   named `behavior.joblib`, takes the same 141 features and returns the same 3 classes,
   so using it produces no error — only one failing test. Identify the file by checksum
   with `scripts/verify_weights.py`. See `backend/weights/README.md`.

**Severity mapping:** `running` → Medium, everything else (`falling`) → High.

**Note on naming:** `FALL_MODEL_NAME` defaults to `"pose-behavior-xgboost"`, which is a
leftover from when the classifier was an XGBoost model. The current production model
is ExtraTrees. The setting is a label only and affects no behavior.

## Re-identification — `reid.pt`

| | |
| --- | --- |
| Purpose | Appearance embeddings so a person keeps the same track id across occlusion and re-entry |
| Setting | `FALL_REID_MODEL_PATH` |
| Classes | 1000 ImageNet classes — **the class head is not used** |
| Architecture | `yolo11m-cls` |
| Trained | 2024-09-25, 200 epochs, 224px, batch 256, on ImageNet, ultralytics 8.2.100 |
| Origin | **Upstream Ultralytics model — not trained for this project** |

A stock ImageNet classifier used purely as a feature extractor: the embeddings matter,
the 1000 class labels are irrelevant. Without it, a person walking behind a pillar
returns as a new track, which would double-count incidents and break the behavior
window.

It is the largest model in the pipeline at ~23 MB and runs at a reduced cadence
(`BEHAVIOR_REID_INTERVAL_FRAMES`, default every 4 frames) because full-rate
re-identification is not worth its cost on a fixed camera.

**Replaceable**, like `pose.pt`. `VERIFY:` byte-identity with the published
`yolo11m-cls` release.

---

## Summary: what is irreplaceable

| Model | Custom-trained | If lost |
| --- | --- | --- |
| `ppe.pt` | Yes | **Must be retrained.** Needs the training dataset — see below. |
| `sign.pt` | Yes | **Must be retrained.** Needs the training dataset. |
| `behavior.joblib` | Yes | Final file is delivered out of band. Git history (`de167f9`) holds only an older fallback version. |
| `pose.pt` | No | Replaceable with any COCO-pose model. |
| `reid.pt` | No | Replaceable with any `yolo11m-cls` checkpoint. |

**Retraining depends on datasets that are not in this repository.** The manifest
records the paths they were trained from, both on the capstone team's training
machine. `VERIFY:` whether they are archived anywhere De Heus can reach — without
them, the two custom YOLO models can be *replaced* but not *retrained*.

The labelling tooling lives in a separate `ppe_labeling` repository, documented
separately by another member of the capstone team.

## Licensing

Every `.pt` file carries `AGPL-3.0` in its own embedded metadata, and `ultralytics` is
AGPL-3.0. This needs a decision from De Heus before deployment beyond internal
evaluation — see [`/OWNERSHIP.md`](../OWNERSHIP.md).
