"""Build FP16 TensorRT engines for the PPE, pose and sign models.

Run from anywhere:  .venv/Scripts/python.exe scripts/export_tensorrt.py [ppe] [pose] [sign]
Then point MODEL_PATH / FALL_MODEL_PATH / SIGN_MODEL_PATH in backend/.env at
the .engine files.

Engines are tied to this GPU, driver and TensorRT version (which is why
weights/*.engine is gitignored). Rebuild after changing any of those, or after
retraining a .pt; a stale engine fails to deserialize at startup.

Why not `YOLO(...).export(format="engine")`: Ultralytics 8.4.58 sets
BuilderFlag.FP16, which TensorRT 11 removed — TensorRT 11 networks are strongly
typed, so precision has to come from the ONNX graph itself. This script:
  1. exports an FP16 ONNX graph with Ultralytics (half=True on CUDA, dynamic axes);
  2. builds a STRONGLY_TYPED engine whose optimisation profile is tuned for the
     live shape (1280x720 letterboxes to 384x640) and capped at 640x640 —
     Ultralytics' own profile allows up to 1280x1280, sizing activation memory
     for 4x the pixels on a 6 GB card;
  3. prefixes the Ultralytics metadata header, which AutoBackend reads to
     recover task, class names, stride and kpt_shape from a .engine file.
"""

import json
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]

# name -> (weights, batch). Pose batch must equal BEHAVIOR_BATCH_MAX_SIZE: the
# behavior scheduler pads every CUDA batch to that size. Batch 1 (the upload
# path) still fits inside the profile.
JOBS = {
    "ppe": ("weights/ppe.pt", 1),
    "pose": ("weights/pose.pt", 4),
    "sign": ("weights/sign.pt", 1),
}
IMGSZ = 640
OPT_HW = (384, 640)


def build(name: str, weights: str, batch: int) -> Path:
    import onnx
    import tensorrt as trt
    from ultralytics import YOLO

    started = time.perf_counter()
    onnx_path = Path(
        YOLO(str(BACKEND_DIR / weights)).export(
            format="onnx", half=True, dynamic=True, batch=batch, imgsz=IMGSZ,
            device=0, simplify=True, verbose=False,
        )
    )
    model_proto = onnx.load(str(onnx_path), load_external_data=False)
    metadata = {prop.key: prop.value for prop in model_proto.metadata_props}
    if model_proto.graph.input[0].type.tensor_type.elem_type != onnx.TensorProto.FLOAT16:
        raise RuntimeError(f"[{name}] ONNX export is not FP16; refusing to build an FP32 engine")

    logger = trt.Logger(trt.Logger.WARNING)
    builder = trt.Builder(logger)
    network = builder.create_network(1 << int(trt.NetworkDefinitionCreationFlag.STRONGLY_TYPED))
    parser = trt.OnnxParser(network, logger)
    if not parser.parse_from_file(str(onnx_path)):
        errors = [str(parser.get_error(i)) for i in range(parser.num_errors)]
        raise RuntimeError(f"[{name}] ONNX parse failed: {errors}")

    config = builder.create_builder_config()
    config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 2 << 30)
    profile = builder.create_optimization_profile()
    profile.set_shape(
        network.get_input(0).name,
        min=(1, 3, 32, 32),
        opt=(batch, 3, *OPT_HW),
        max=(batch, 3, IMGSZ, IMGSZ),
    )
    config.add_optimization_profile(profile)

    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        raise RuntimeError(f"[{name}] TensorRT engine build failed")
    engine_path = onnx_path.with_suffix(".engine")
    header = json.dumps(metadata).encode()
    with open(engine_path, "wb") as f:
        f.write(len(header).to_bytes(4, byteorder="little", signed=True))
        f.write(header)
        f.write(serialized)
    print(
        f"[{name}] {weights} -> {engine_path.relative_to(BACKEND_DIR)} "
        f"({engine_path.stat().st_size / 1e6:.1f} MB, {time.perf_counter() - started:.0f}s)"
    )
    return engine_path


if __name__ == "__main__":
    selected = sys.argv[1:] or list(JOBS)
    unknown = [name for name in selected if name not in JOBS]
    if unknown:
        raise SystemExit(f"Unknown model(s): {unknown}. Choose from {list(JOBS)}.")
    for name in selected:
        build(name, *JOBS[name])
