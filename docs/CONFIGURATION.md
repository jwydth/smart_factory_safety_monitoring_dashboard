# Configuration

> **Generated file — do not edit by hand.**
> Produced by `backend/scripts/generate_docs.py` from `backend/app/core/config.py`.
> Regenerate after changing that source; edit the script, not this file.
>
> Generated 2026-10-10 at commit `a9b356b`.

Every setting is read by `pydantic-settings` from the environment or from
`backend/.env` (see `Settings.Config.env_file`). Names are case-sensitive and
match exactly. `backend/.env.example` is a copyable template.

There are **121 settings**. Most are tuning constants that should be
left alone; the ones an operator actually sets are listed first.


## Settings you need to set

| Setting | Default | Why you would change it |
| --- | --- | --- |
| `DATABASE_URL` | `None` | Required. Without it the backend has no database. |
| `MINIO_ENDPOINT` | `None` | Required for evidence snapshots. |
| `MINIO_ACCESS_KEY` | `None` | Required for evidence snapshots. |
| `MINIO_SECRET_KEY` | `None` | Required for evidence snapshots. |
| `MINIO_BUCKET_NAME` | `None` | Required for evidence snapshots. |
| `MODEL_PATH` | `'weights/ppe.pt'` | Point at the PPE weights, or at a .engine to use TensorRT. |
| `FALL_MODEL_PATH` | `'weights/pose.pt'` | Pose weights. |
| `FALL_BEHAVIOR_MODEL_PATH` | `'weights/behavior.joblib'` | Behavior classifier. See backend/weights/README.md. |
| `FALL_REID_MODEL_PATH` | `'weights/reid.pt'` | Re-identification weights. |
| `SIGN_MODEL_PATH` | `'weights/sign.pt'` | Sign-detection weights. |
| `ALLOWED_ORIGINS` | `['http://localhost:3000', 'http://127.0.0.1:3000']` | Must list the frontend origin or the browser is blocked by CORS. |
| `INFERENCE_DEVICE` | `'auto'` | Leave auto unless pinning a specific GPU or forcing CPU. |
| `MAX_CONCURRENT_STREAMS` | `8` | Raise only if more cameras must stream at once. |
| `MODEL_POOL_PREWARM` | `3` | Keep at least as high as the number of cameras normally streaming. |
| `REPORT_TIMEZONE` | `'Asia/Ho_Chi_Minh'` | Display timezone for report timestamps. Storage is always UTC. |
| `REPORT_COMPANY_NAME` | `'De Heus LLC'` | Appears on generated PDF reports. |
| `REPORT_EMAIL_ENABLED` | `False` | Master switch for emailed reports. |
| `SMTP_HOST` | `None` | Required if emailed reports are enabled. |
| `SMTP_USERNAME` | `None` | Required if emailed reports are enabled. |
| `SMTP_PASSWORD` | `None` | Required if emailed reports are enabled. Never commit it. |
| `SMTP_FROM_EMAIL` | `None` | Required if emailed reports are enabled. |
| `REPORT_RECIPIENT_ALLOWLIST` | `[]` | Set this. An empty list allows any recipient. |


## Settings you must not change

| Setting | Value | Why |
| --- | --- | --- |
| `FALL_LIVE_FRAME_STRIDE` | `1` | A validator rejects any value but 1: the behavior classifier needs every frame of an ordered 24-FPS window. |
| `FALL_BEHAVIOR_WINDOW_FRAMES` | `60` | The classifier was trained on 60-frame windows. |
| `FALL_BEHAVIOR_CANONICAL_FPS` | `24` | The classifier's temporal features assume 24 FPS. |


## Full reference

Grouped by name prefix. Defaults are the values in `config.py`; a value in
`backend/.env` overrides them, so a running system may differ.


### ANNOTATED

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `ANNOTATED_STREAM_ENABLED` | `bool` | `True` | Server-composed live output. AI remains asynchronous; the compositor releases each buffered source frame at its presentation deadline. |
| `ANNOTATED_PUBLISHER_IDLE_GRACE_SECONDS` | `float` | `60.0` | Mirrors FRAME_HUB_IDLE_GRACE_SECONDS for the downstream annotated-output publisher (ffmpeg -> mediamtx -> HLS): keeps its ffmpeg process and RTSP publish connection alive for this long after the last viewer disconnects, so a page reload reattaches to the still-running publisher instead of tearing down and re-negotiating a fresh RTSP publish + HLS stream (the dominant remaining cost behind the reload black screen once the camera capture itself — see FRAME_HUB_IDLE_GRACE_SECONDS — is kept warm). Cold-starting this chain leaves the HLS path 404ing for several seconds, which the player can only sit and retry through, so this window is kept generous enough that an ordinary reload always lands inside it. A too-long window costs an idle encoder; a too-short one costs a multi-second black screen on every reload. |
| `ANNOTATED_SNAPSHOT_MAX_AGE_SECONDS` | `float` | `10.0` | How stale the poster still-frame served by /stream-snapshot may be. It exists to cover the sub-second gap while a reloaded page starts its HLS player, so anything beyond a few seconds is past its usefulness — and serving an old frame as the current view of the factory floor would be actively misleading. Beyond this age the endpoint 404s and the player simply falls back to its black background. |
| `ANNOTATED_STREAM_DELAY_SECONDS` | `float` | `3.0` | — |
| `ANNOTATED_STREAM_QUEUE_SIZE` | `int` | `180` | — |
| `ANNOTATED_PPE_TTL_FRAMES` | `int` | `8` | — |
| `ANNOTATED_SIGN_TTL_SECONDS` | `float` | `3.0` | — |
| `ANNOTATED_PPE_MATCH_IOU` | `float` | `0.2` | — |
| `ANNOTATED_RTSP_BASE_URL` | `str` | `'rtsp://127.0.0.1:8554'` | — |
| `ANNOTATED_PATH_SUFFIX` | `str` | `'_annotated'` | — |
| `ANNOTATED_FFMPEG_PATH` | `str` | `'ffmpeg'` | — |
| `ANNOTATED_ENCODER` | `str` | `'auto'` | — |


### AUTO

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `AUTO_ZONE_BUFFER_RATIO` | `float` | `0.25` | — |
| `AUTO_ZONE_CONFIRM_FRAMES` | `int` | `3` | — |
| `AUTO_PPE_CONFIRM_FRAMES` | `int` | `1` | — |
| `AUTO_ZONE_DEDUPE_GRID` | `float` | `0.05` | — |
| `AUTO_ZONE_STATIONARY_SECONDS` | `float` | `3.0` | A zone sign must hold still (within AUTO_ZONE_MOVE_TOLERANCE of where its still-streak began) for this many seconds before a zone is suggested. This prevents a sign being carried across the floor from creating a zone — only a sign that has been put down and left in place triggers one. |
| `AUTO_ZONE_MOVE_TOLERANCE` | `float` | `0.03` | max center drift (fraction of frame) still counted as "still" |


### BEHAVIOR

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `BEHAVIOR_ORDERED_QUEUE_SIZE` | `int` | `180` | Multi-camera behavior runtime. Behavior frames remain ordered and are never subsampled; batching only combines one ready frame per camera into a single finite CUDA forward pass. |
| `BEHAVIOR_BATCH_MAX_SIZE` | `int` | `4` | — |
| `BEHAVIOR_CAMERA_BURST_SIZE` | `int` | `2` | — |
| `BEHAVIOR_BATCH_WAIT_MS` | `float` | `4.0` | — |
| `BEHAVIOR_POSE_IMGSZ` | `int` | `448` | — |
| `BEHAVIOR_FIXED_CAMERA` | `bool` | `True` | — |
| `BEHAVIOR_GMC_METHOD` | `str` | `'none'` | — |
| `BEHAVIOR_REID_HALF` | `bool` | `True` | — |
| `BEHAVIOR_REID_INTERVAL_FRAMES` | `int` | `4` | — |
| `BEHAVIOR_POSE_REPAIR_MAX_GAP` | `int` | `8` | — |
| `BEHAVIOR_POSE_REPAIR_MIN_CONFIDENCE` | `float` | `0.1` | — |
| `BEHAVIOR_POSE_REPAIR_MAX_CENTER_SHIFT_RATIO` | `float` | `1.5` | — |
| `BEHAVIOR_LIVE_WARMUP_FRAMES` | `int` | `3` | — |
| `BEHAVIOR_START_COHORT_WAIT_MS` | `float` | `1200.0` | — |
| `BEHAVIOR_TORCH_THREADS` | `int` | `4` | — |
| `BEHAVIOR_TORCH_INTEROP_THREADS` | `int` | `1` | — |
| `BEHAVIOR_OPENCV_THREADS` | `int` | `4` | — |
| `BEHAVIOR_XGBOOST_THREADS` | `int` | `1` | — |
| `BEHAVIOR_HEALTH_LOG_INTERVAL_SECONDS` | `float` | `10.0` | — |


### FALL

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `FALL_MODEL_PATH` | `str` | `'weights/pose.pt'` | Behavioral-detection / behavior-incident settings. Pose + behavior-classifier pipeline.  The classifier was trained on 60-frame COCO-pose windows and predicts others/running/falling. |
| `FALL_BEHAVIOR_MODEL_PATH` | `str` | `'weights/behavior.joblib'` | Primary classifier: 141 transformed pose/motion features -> others/running/falling. The current production artifact is an sklearn ExtraTreesClassifier. |
| `FALL_REID_MODEL_PATH` | `str` | `'weights/reid.pt'` | — |
| `FALL_PERSON_CONFIDENCE` | `float` | `0.2` | — |
| `FALL_BEHAVIOR_WINDOW_FRAMES` | `int` | `60` | — |
| `FALL_BEHAVIOR_WINDOW_STRIDE` | `int` | `12` | — |
| `FALL_BEHAVIOR_CANONICAL_FPS` | `int` | `24` | — |
| `FALL_BEHAVIOR_MIN_CONFIDENCE` | `float` | `0.5` | — |
| `FALL_TRACK_MAX_MISSING_SAMPLES` | `int` | `12` | — |
| `FALL_MAX_FRAMES` | `int` | `1200` | — |
| `FALL_FRAME_STRIDE` | `int` | `1` | — |
| `FALL_LIVE_FRAME_STRIDE` | `int` | `1` | Do not subsample pose frames: behavior.joblib was trained on 60 frames at 24 FPS, so its temporal features require every source frame. |
| `FALL_BEHAVIOR_PORTABLE_MODEL_PATH` | `str` | `'weights/behavior.ubj'` | Optional legacy XGBoost artifact. It is used only when the configured primary classifier is unavailable. |
| `FALL_INCIDENT_COOLDOWN_SECONDS` | `float` | `10.0` | — |
| `FALL_MODEL_NAME` | `str` | `'pose-behavior-xgboost'` | — |
| `FALL_MODEL_VERSION` | `str` | `'behavior-v1'` | — |


### INFERENCE

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `INFERENCE_DEVICE` | `str` | `'auto'` | "auto" uses the first CUDA GPU when PyTorch can access one, otherwise CPU. You can also force "cpu", "cuda", "cuda:0", "0", etc. |
| `INFERENCE_HALF` | `bool` | `True` | applied only on CUDA by the pipeline |
| `INFERENCE_IMGSZ` | `int` | `640` | pin inference resolution for predictable latency |


### LIVE

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `LIVE_PPE_TARGET_FPS` | `float` | `8.0` | — |
| `LIVE_SIGN_TARGET_FPS` | `float` | `1.0` | — |
| `LIVE_SIGN_PHASE_FRAME` | `int` | `13` | — |


### MINIO

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `MINIO_ENDPOINT` | `str \| None` | `None` | — |
| `MINIO_ACCESS_KEY` | `str \| None` | `None` | — |
| `MINIO_SECRET_KEY` | `str \| None` | `None` | — |
| `MINIO_BUCKET_NAME` | `str \| None` | `None` | — |
| `MINIO_SECURE` | `bool` | `False` | — |


### MODEL

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `MODEL_PATH` | `str` | `'weights/ppe.pt'` | — |
| `MODEL_POOL_PREWARM` | `int` | `3` | How many of those instances are built and warmed at startup. These absorb the multi-second load+warm cost for the first cameras to connect; the rest pay it once, on their first connection. Keep it at least as high as the number of cameras normally streaming at once. |


### Other

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | `str \| None` | `None` | — |
| `MAX_CONCURRENT_STREAMS` | `int` | `8` | Safety ceiling on the pool of tracker-isolated model instances backing the live streaming path — one instance is held per connected camera for the life of its websocket (every *active* camera connects, whether or not its tile is on screen), so this is also the maximum number of cameras that can stream at once. Connections beyond it queue for a free instance and time out (see PPEDetector.acquire_model_instance). Instances load on demand, so this costs nothing until cameras actually need the slots: raising it does not reserve VRAM, and adding a camera needs no config change until the ceiling itself is reached. Lower it only to protect a machine whose VRAM cannot hold this many copies of the weights at once. |
| `FRAME_HUB_IDLE_GRACE_SECONDS` | `float` | `60.0` | How long a camera's shared frame-capture thread (CameraFrameHub) stays connected after its last subscriber disconnects before it actually tears down the RTSP/capture session. A page reload or a StrictMode dev-mode remount closes and reopens the websocket within a second or two; without this grace window every such reconnect pays the full RTSP handshake (TCP connect + SETUP/PLAY + wait for a keyframe) again, which is what makes the live feed go black for a few seconds on reload. Sized to comfortably cover a slow reload, a brief tab switch, or a user reopening the dashboard a moment later — at 8s a reload that took slightly longer still fell off the edge and paid a full cold start. Set to 0 to tear down immediately (previous behavior). |
| `CONFIDENCE_THRESHOLD` | `float` | `0.3` | — |
| `PPE_OVERLAP_THRESHOLD` | `float` | `0.3` | Minimum fraction of an equipment box that must overlap its person box for the two to be considered associated (0.0 – 1.0) |
| `SNAPSHOT_DIR` | `str` | `'storage/snapshots'` | — |
| `UPLOAD_DIR` | `str` | `'storage/uploads'` | — |
| `ALLOWED_ORIGINS` | `list[str]` | `['http://localhost:3000', 'http://127.0.0.1:3000']` | — |
| `NO_WALKWAY_DWELL_SECONDS` | `float` | `1.5` | When zone monitoring is enabled but no WALKWAY zone is defined, every detected walker is treated as being outside a walkway.  A violation is raised once the worker has been visible for this many consecutive seconds. |
| `ANALYTICS_LIMIT` | `int` | `20000` | Upper bound on rows UnifiedIncidentService will read per category per call. Analytics aggregates in Python (see analytics_service.py's module docstring for why), so a date range with more incidents than this gets its oldest rows silently dropped from the counts. Raise this if real incident volume approaches it; a truncation warning is logged when it's hit either way. |


### REPORT

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `REPORT_TIMEZONE` | `str` | `'Asia/Ho_Chi_Minh'` | Display timezone for rendered report timestamps. All storage is UTC (see UnifiedIncidentService._ensure_tz); this only affects presentation. |
| `REPORT_COMPANY_NAME` | `str` | `'De Heus LLC'` | — |
| `REPORT_LOGO_PATH` | `str \| None` | `None` | optional PNG/JPG, absolute or backend-relative |
| `REPORT_MAX_INCIDENT_ROWS` | `int` | `25` | rows in the detail table |
| `REPORT_MAX_SNAPSHOTS` | `int` | `6` | evidence thumbnails in the appendix |
| `REPORT_SNAPSHOT_TIMEOUT_SECONDS` | `float` | `5.0` | per-image fetch budget |
| `REPORT_ARCHIVE_TO_MINIO` | `bool` | `True` | — |
| `REPORT_EMAIL_ENABLED` | `bool` | `False` | master switch; see security note in the plan |
| `REPORT_RECIPIENT_ALLOWLIST` | `list[str]` | `[]` | Empty list = allow any recipient. NON-EMPTY IS STRONGLY RECOMMENDED: without auth on this API, an open recipient field makes /reports/incidents/email a spam relay. Exact-match emails and/or "@domain.com" suffixes are accepted. |
| `REPORT_MAX_RECIPIENTS` | `int` | `10` | — |
| `REPORT_EMAIL_RATE_LIMIT_PER_HOUR` | `int` | `20` | In-process rate limit for POST /reports/incidents/email. Does not survive multi-worker uvicorn (each worker keeps its own counter). |


### SIGN

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `SIGN_MODEL_PATH` | `str` | `'weights/sign.pt'` | Sign-detection / auto-zone settings |
| `SIGN_CONFIDENCE_THRESHOLD` | `float` | `0.35` | — |
| `SIGN_CLASS_ZONE_MAP` | `dict[int, str]` | `{2: 'RESTRICTED', 3: 'SLIPPERY'}` | — |
| `SIGN_CLASS_NAMES` | `dict[int, str]` | `{0: 'M001_MustWearHardHat', 1: 'M002_MustWearSafetyVest', 2: 'P004_NoThoroughfare', 3: 'W011_Slippery'}` | — |
| `SIGN_CLASS_PPE_TRIGGER` | `set[int]` | `{0, 1}` | Sign classes that should trigger PPE detection (not zone creation) |
| `SIGN_PASS_FRAME_INTERVAL` | `int` | `15` | — |


### SMTP

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `SMTP_HOST` | `str \| None` | `None` | — |
| `SMTP_PORT` | `int` | `587` | — |
| `SMTP_USERNAME` | `str \| None` | `None` | — |
| `SMTP_PASSWORD` | `str \| None` | `None` | — |
| `SMTP_USE_STARTTLS` | `bool` | `True` | port 587 |
| `SMTP_USE_SSL` | `bool` | `False` | port 465; mutually exclusive with STARTTLS |
| `SMTP_TIMEOUT_SECONDS` | `float` | `20.0` | — |
| `SMTP_FROM_EMAIL` | `str \| None` | `None` | — |
| `SMTP_FROM_NAME` | `str` | `'Smart Factory Safety Monitoring'` | — |


### VIDEO

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `VIDEO_FRAME_STRIDE` | `int` | `1` | — |
| `VIDEO_TRACKER` | `str` | `'bytetrack.yaml'` | — |
| `VIDEO_CASE_IOU_THRESHOLD` | `float` | `0.2` | — |
| `VIDEO_CASE_CENTER_DISTANCE_RATIO` | `float` | `0.75` | — |
| `VIDEO_CASE_MAX_FRAME_GAP` | `int` | `90` | — |
| `VIDEO_PPE_DUPLICATE_SUPPRESSION_GAP` | `int` | `300` | — |
| `VIDEO_PPE_DUPLICATE_CENTER_DISTANCE_RATIO` | `float` | `1.25` | — |
| `VIDEO_EDGE_MARGIN_RATIO` | `float` | `0.05` | — |
| `VIDEO_NEW_TRACK_GRACE_SECONDS` | `float` | `0.5` | — |
| `VIDEO_VIOLATION_CONFIRM_SECONDS` | `float` | `0.2` | — |
| `VIDEO_RECENT_PPE_MEMORY_SECONDS` | `float` | `1.5` | — |
| `VIDEO_MIN_PERSON_HEIGHT_RATIO` | `float` | `0.1` | — |
| `VIDEO_STABILITY_WINDOW_FRAMES` | `int` | `5` | — |
| `VIDEO_MAX_CENTER_SHIFT_RATIO` | `float` | `0.35` | — |
| `VIDEO_MAX_SIZE_CHANGE_RATIO` | `float` | `0.45` | — |
| `VIDEO_MIN_CLEAR_PERSON_ASPECT_RATIO` | `float` | `1.2` | — |
| `VIDEO_POSTURE_HEIGHT_DROP_RATIO` | `float` | `0.7` | — |
| `VIDEO_POSTURE_HISTORY_MIN_FRAMES` | `int` | `3` | — |
| `VIDEO_ZONE_REENTRY_GAP_SECONDS` | `float` | `1.0` | Gap in seconds without a detection that is treated as the worker having exited any zone |
