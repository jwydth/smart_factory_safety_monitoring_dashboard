"""Check that the model weights are present and match weights/MANIFEST.json.

Run from anywhere:  .venv/Scripts/python.exe scripts/verify_weights.py

Weights are gitignored, so a fresh clone has none of them and detection cannot
start. This script answers the only two questions that matter before a first
run: is every required file here, and is it the right file.

Exit code is 0 when every required model is present and its checksum matches,
and 1 otherwise, so it can gate a deployment step.
"""

import hashlib
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
WEIGHTS_DIR = BACKEND_DIR / "weights"
MANIFEST_PATH = WEIGHTS_DIR / "MANIFEST.json"

# Read in blocks: the largest model is ~24 MB and there is no reason to hold a
# whole file in memory to hash it.
HASH_BLOCK_SIZE = 1024 * 1024


def file_sha256(path: Path) -> str:
    """Return the hex SHA-256 digest of a file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(HASH_BLOCK_SIZE), b""):
            digest.update(block)
    return digest.hexdigest()


def check_model(entry: dict) -> tuple[str, str]:
    """Check one manifest entry. Return a (status, detail) pair.

    Status is one of "ok", "missing", "mismatch" or "unverifiable".
    """
    path = WEIGHTS_DIR / entry["file"]
    if not path.is_file():
        return "missing", f"not found at {path}"

    expected_size = entry.get("size_bytes")
    actual_size = path.stat().st_size
    expected_sha = entry.get("sha256")

    # An entry without a checksum can still be reported as present. The
    # manifest records one for every required model, so this only happens for
    # an entry someone added later without filling it in.
    if not expected_sha:
        return "unverifiable", f"present ({actual_size} bytes), no checksum in manifest"

    # Compare the size first: it is free, and it turns the common case of a
    # half-copied or truncated file into an immediate, obvious answer instead
    # of a checksum mismatch that looks like the wrong model entirely.
    if expected_size is not None and actual_size != expected_size:
        return "mismatch", (
            f"wrong size: expected {expected_size} bytes, found {actual_size}. "
            "A short file usually means an interrupted copy or download."
        )

    actual_sha = file_sha256(path)
    if actual_sha != expected_sha:
        return "mismatch", (
            f"checksum differs\n      expected {expected_sha}\n      found    {actual_sha}"
        )

    return "ok", f"{actual_size} bytes"


def report_accelerated(manifest: dict) -> None:
    """Report on optional TensorRT/ONNX artifacts that happen to be present."""
    section = manifest.get("accelerated_optional") or {}
    entries = section.get("files", [])
    present = [entry for entry in entries if (WEIGHTS_DIR / entry["file"]).is_file()]
    if not present:
        return

    print(f"\nOptional accelerated artifacts ({len(present)} of {len(entries)} present):")
    for entry in present:
        status, detail = check_model(entry)
        marker = "OK      " if status == "ok" else "MISMATCH"
        print(f"  [{marker}] {entry['file']}: {detail}")

    # Say which machine built them, so a startup failure is recognised as a
    # hardware mismatch rather than a corrupt file.
    environment = section.get("build_environment") or {}
    if environment:
        print(
            f"  Built on {environment.get('gpu', 'unknown GPU')}, "
            f"driver {environment.get('driver_version', '?')}, "
            f"TensorRT {environment.get('tensorrt', '?')}. "
            "An engine only loads on matching hardware; otherwise rebuild with "
            "scripts/export_tensorrt.py."
        )


def main() -> int:
    if not MANIFEST_PATH.is_file():
        print(f"ERROR: manifest not found at {MANIFEST_PATH}", file=sys.stderr)
        return 1

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    models = manifest.get("models", [])
    if not models:
        print(f"ERROR: no models listed in {MANIFEST_PATH}", file=sys.stderr)
        return 1

    print(f"Verifying {len(models)} model(s) against {MANIFEST_PATH.name}")
    print(f"Weights directory: {WEIGHTS_DIR}\n")

    # Collect failures rather than exiting on the first one, so a single run
    # tells someone everything they need to obtain.
    failures: list[dict] = []
    for entry in models:
        status, detail = check_model(entry)
        required = entry.get("required", True)
        if status == "ok":
            marker = "OK      "
        elif status == "unverifiable":
            marker = "PRESENT "
        else:
            marker = "FAILED  " if required else "optional"

        print(f"  [{marker}] {entry['file']}: {detail}")
        if status != "ok" and status != "unverifiable" and required:
            failures.append({"entry": entry, "status": status, "detail": detail})

    # Optional accelerated artifacts: verify any that were delivered, but never
    # fail on them. They are a performance extra, and one that legitimately
    # does not load on hardware other than the machine that built it.
    report_accelerated(manifest)

    if not failures:
        print("\nAll required weights are present and match the manifest.")
        return 0

    # Say what to do about each failure, not just that it happened. Every
    # required model is delivered out of band; only an older fallback of the
    # behavior model is in git history, so obtain_from says whom to contact.
    print(f"\n{len(failures)} required model(s) need attention:\n")
    for failure in failures:
        entry = failure["entry"]
        print(f"  {entry['file']} - {failure['status']}")
        print(f"    purpose: {entry.get('purpose', 'unknown')}")
        print(f"    loaded by setting: {entry.get('loaded_by', 'unknown')}")
        # obtain_from says how to get the file, which is what someone staring at a
        # missing-weights error needs. `source` describes how it was trained, which
        # is a different question and not useful here.
        obtain_from = entry.get("obtain_from")
        if obtain_from:
            print(f"    how to obtain: {obtain_from}")
        print()

    print("Detection will not start until these are resolved.")
    print("See backend/weights/README.md for the full handover notes.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
