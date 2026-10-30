# Model weights

**Nothing in this directory is tracked in git**, apart from this README and
`MANIFEST.json`. A fresh clone therefore has no weights, and **detection will not
start until they are supplied**. This is the single thing without which the system
does not run.

`.gitignore` excludes `backend/weights/*.pt`, `*.joblib`, `*.onnx` and `*.engine`.
That is deliberate — model files are large binaries and TensorRT engines are tied to
specific hardware — but it means the files have to travel separately from the code.

## Where to get the files

**All model files are delivered separately**, outside this repository, because they are
large binaries that git does not track. Delivery is being handled by the member of the
capstone team who also maintains the `ppe_labeling` labelling-tool documentation, and
covers the five required models plus the optional TensorRT engines.

> **De Heus technical contact:** Ethan Phuc (Nguyen Trong Phuc), Information
> Technology — ethan.phuc@deheus.com
>
> `VERIFY:` confirm on receipt that all five arrived, by running
> `scripts/verify_weights.py` — it checks every checksum and exits non-zero if
> anything is missing or wrong.

The final behavior model, `behavior.joblib`, exists **only** in that delivery. An older
version is in this repository's git history and can serve as a fallback, but it is not
the final model. See [below](#git-history-holds-an-older-behavior-model-fallback-only).

The `source` field in `MANIFEST.json` records how each model was *trained*, which is a
different question from how to *obtain* it; `obtain_from` answers the latter.

## Quick start

1. Obtain the five required files (see the table below) and place them in this
   directory. Pre-built TensorRT engines may be delivered too — those are optional,
   see [TensorRT engines](#tensorrt-engines--delivered-separately-optional).
2. Verify them:

   ```bash
   # from backend/
   .venv/Scripts/python.exe scripts/verify_weights.py
   ```

   The script checks presence, file size and SHA-256 against `MANIFEST.json`, exits
   `0` only when every required model is correct, and for anything missing it prints
   what the file is for, which setting loads it, and how to obtain it.
3. Check that `backend/.env` points at these filenames. The defaults in
   `app/core/config.py` already do.

## Required models

Checksums, sizes, class lists and training metadata are in
[`MANIFEST.json`](./MANIFEST.json), which is the machine-readable source of truth.
This table is the human summary.

| File | Loaded by | Purpose | Origin |
| --- | --- | --- | --- |
| `ppe.pt` | `MODEL_PATH` | PPE compliance: people, helmets, vests, cleaning coveralls | **Custom-trained** for this project, 2026-08-26 |
| `sign.pt` | `SIGN_MODEL_PATH` | Safety-sign detection, which drives automatic zone suggestions | **Custom-trained** for this project, 2026-06-14 |
| `pose.pt` | `FALL_MODEL_PATH` | 17-keypoint pose estimation, feeding the behavior classifier | Upstream Ultralytics COCO-pose model |
| `reid.pt` | `FALL_REID_MODEL_PATH` | Appearance embeddings so track ids survive occlusion | Upstream Ultralytics ImageNet classifier |
| `behavior.joblib` | `FALL_BEHAVIOR_MODEL_PATH` | Behavior classification: others / running / falling | **Custom-trained** for this project |

**Only the three custom-trained models are genuinely irreplaceable.** `pose.pt` and
`reid.pt` are general-purpose public checkpoints whose metadata shows training on COCO
and ImageNet respectively, not on De Heus data. `VERIFY:` whether each is
byte-identical to a published Ultralytics release — that was not confirmed here,
because confirming it requires downloading and comparing.

### Class lists are load-bearing

| Model | Classes |
| --- | --- |
| `ppe.pt` | `person`, `helmet`, `vest`, `cleaning_coverall` |
| `sign.pt` | `M014_Helmet`, `M015_Vest`, `P004_NoThoroughfare`, `W011_Slippery` |
| `pose.pt` | `person`, with 17 COCO keypoints |
| `behavior.joblib` | `others`, `running`, `falling` — **in that index order** |

The behavior classifier's order matters: `fall_detector.py` unpacks `predict_proba`
positionally (`others, running, falling = probabilities`). A retrained model that
emits the same three classes in a different order will produce confidently wrong
labels with no error anywhere. It takes 141 input features.

`cleaning_coverall` is what identifies a janitor, which is why janitors are exempt
from slippery-zone violations but still flagged in restricted zones.

## Git history holds an older behavior model (fallback only)

The final behavior model is the `behavior.joblib` supplied by the capstone team on
2026-10-30 (ExtraTrees, 300 trees, 23,122,305 bytes). It is delivered out of band and is
**not** in git. Get it from the delivery above.

An **older** ExtraTrees version (500 trees, 11,510,305 bytes) was committed in
`de167f9` as `best_behavior_model.joblib` and deleted in `c7653a4`. Use it only if the
final file is unobtainable:

```bash
# from the repository root - fallback only, NOT the final model
git show de167f9:backend/weights/best_behavior_model.joblib > backend/weights/behavior.joblib
```

It loads as an `ExtraTreesClassifier` with `n_features_in_=141` and `classes_=[0 1 2]`,
but `verify_weights.py` will report a checksum mismatch, because `MANIFEST.json`
records the final model. That mismatch is expected for the fallback.

**This needs a clone with history.** A `--depth 1` shallow clone cannot reach `de167f9`.

### Identify `behavior.joblib` by checksum, not by name

An **older XGBoost model** was also named `behavior.joblib` and may still be present on
a development machine. It is a trap: it accepts the same 141 features and returns the
same three classes, so it loads and runs silently. The only visible symptom is one
failing test
(`tests/test_fall_detector.py::test_primary_behavior_classifier_is_extra_trees_with_configured_threads`).
Its checksum is recorded under `superseded` in `MANIFEST.json`. Run
`scripts/verify_weights.py` to confirm you have the final model.

`behavior.ubj` is an older still, optional fallback that is used only when the primary
file is absent. It exists neither in the repository nor in history. Supplying it would
make a missing primary model fail quietly instead of loudly, so do not.

## TensorRT engines — what the demonstrated system actually ran on

Pre-built FP16 TensorRT engines (`*.engine`) and their ONNX intermediates (`*.onnx`)
are delivered alongside the `.pt` files. Their checksums and build environment are
recorded under `accelerated_optional` in `MANIFEST.json`.

> **Read this before choosing a configuration.** The capstone development and demo
> machine ran **three of the four YOLO models from TensorRT engines, not from `.pt`
> files.** Its `backend/.env` set:
>
> ```bash
> MODEL_PATH=weights/ppe.engine             # PPE
> SIGN_MODEL_PATH=weights/sign.engine       # signs
> FALL_MODEL_PATH=weights/pose.engine       # the pose stage of fall detection
> FALL_REID_MODEL_PATH=weights/reid.pt      # the only one left as .pt
> ```
>
> So **any performance you were shown was TensorRT performance.** A `.pt`-only
> deployment is a valid and fully supported configuration — it was verified end to end
> in the [clean-room test](../../docs/handover/CLEAN_ROOM_TEST.md) — but it **will be
> slower than the demo**, and that difference is not a fault.

There is no `reid.engine`: `scripts/export_tensorrt.py` builds engines for the PPE,
pose and sign models only, so re-identification always runs from `reid.pt`.

**The `.pt` files remain required regardless.** They are the source the engines are
built from, the fallback when an engine will not load, and the only portable form.
Nothing loads an engine automatically — a setting has to point at the `.engine` path
explicitly:

```bash
# in backend/.env, to use the accelerated models
MODEL_PATH=weights/ppe.engine
FALL_MODEL_PATH=weights/pose.engine
SIGN_MODEL_PATH=weights/sign.engine
```

### They will only load on matching hardware

A TensorRT engine is tied to the GPU compute capability, driver and TensorRT version
that built it, and **fails to deserialize at startup anywhere else**. The engines
supplied were built on:

| | |
| --- | --- |
| Built | 2026-09-14 |
| GPU | NVIDIA GeForce RTX 3050 6GB Laptop GPU (compute capability 8.6, 6 GB VRAM) |
| Driver | 610.62 |
| TensorRT | 11.1.0.106 |
| CUDA / cuDNN | 13.2 / 92000 |
| torch | 2.12.0+cu132 |

If the De Heus machine differs, **an engine failing to load is expected, not a
defect.** Leave the settings on the `.pt` files, or rebuild on the target machine:

```bash
# from backend/
.venv/Scripts/python.exe scripts/export_tensorrt.py [ppe] [pose] [sign]
```

Rebuild after changing GPU, driver or TensorRT version, and after retraining any
`.pt`. A stale engine fails at startup rather than silently running the old model.

Two further notes from the export script: the optimisation profile is tuned for the
live shape (1280x720 letterboxed to 384x640) and capped at 640x640 to suit a 6 GB
card, so a larger card is better served by rebuilding; and `pose.engine` is built with
a batch size that must equal `BEHAVIOR_BATCH_MAX_SIZE`, so changing that setting also
requires a rebuild.

## Training data provenance

**The training footage was synthetic.** It was generated with ComfyUI and Wan 14B
rather than filmed at a De Heus site. This matters when judging how the models will
behave on real factory cameras: no accuracy figure against real De Heus
footage exists, and none should be inferred from the models' training metadata.

The live demo footage shown at the capstone event was likewise AI-generated, which is
why the dashboard carries an AI-disclaimer badge on every annotated camera tile.

The labelling tooling and the data workflow live in a separate `ppe_labeling`
repository. **It is deliberately out of scope here and is being documented separately
by another member of the capstone team**, so this handover makes no claims about it.
Nothing in this repository depends on it at runtime.

`VERIFY:` where that separate documentation will live, so this page can link to it.

`VERIFY:` whether the training datasets referenced in `MANIFEST.json`
(`ppe-detection/v2_pipeline/artifacts/...` and
`sign-detection/runs/final_model/...`, both paths on the capstone team's training
machine) are archived anywhere De Heus can reach. Without them the models cannot be
retrained, only replaced.

## Licensing

Every `.pt` file carries `AGPL-3.0` in its own embedded metadata, and `ultralytics`
itself is AGPL-3.0. See [`/OWNERSHIP.md`](../../OWNERSHIP.md) — this needs a decision
from De Heus before deployment beyond internal evaluation.

## If you replace or retrain a model

`MANIFEST.json` is hand-maintained; nothing regenerates it. After swapping a file:

1. Recompute its size and SHA-256 (`sha256sum <file>`) and update its manifest entry.
2. Update `classes` if they changed — and re-read the class-order warning above.
3. Re-run `scripts/verify_weights.py` to confirm the manifest agrees with reality.
4. Rebuild any `.engine` derived from it.
