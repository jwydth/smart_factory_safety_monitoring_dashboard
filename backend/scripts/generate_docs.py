"""Generate the reference documentation that can be derived from the code.

Run from anywhere:  .venv/Scripts/python.exe scripts/generate_docs.py [config] [api] [database]

With no arguments it regenerates all three. Output goes to docs/ in the
repository root:

  config    -> docs/CONFIGURATION.md   from app/core/config.py
  api       -> docs/API.md             from the FastAPI OpenAPI schema
  database  -> docs/DATABASE.md        from the SQLModel metadata

These three documents are generated rather than written so they cannot drift
from the code. Edit this script, not the Markdown — each generated file says so
in its own header.

Note: the api target imports app.main, which loads and warms detection models,
so it needs the weights present and takes a few seconds. The config and
database targets do not.
"""

import ast
import subprocess
import sys
from datetime import date
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent

# Make `app` importable however the script is invoked, matching the pattern in
# scripts/check_model.py and scripts/check_gpu_runtime.py.
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

DOCS_DIR = REPO_DIR / "docs"
CONFIG_SOURCE = BACKEND_DIR / "app" / "core" / "config.py"

# Settings an operator realistically has to set, as opposed to the tuning
# constants that make up most of config.py. Keeping this list here rather than
# in the Markdown means the generated document cannot disagree with it.
OPERATOR_SETTINGS = {
    "DATABASE_URL": "Required. Without it the backend has no database.",
    "MINIO_ENDPOINT": "Required for evidence snapshots.",
    "MINIO_ACCESS_KEY": "Required for evidence snapshots.",
    "MINIO_SECRET_KEY": "Required for evidence snapshots.",
    "MINIO_BUCKET_NAME": "Required for evidence snapshots.",
    "MODEL_PATH": "Point at the PPE weights, or at a .engine to use TensorRT.",
    "FALL_MODEL_PATH": "Pose weights.",
    "FALL_BEHAVIOR_MODEL_PATH": "Behavior classifier. See backend/weights/README.md.",
    "FALL_REID_MODEL_PATH": "Re-identification weights.",
    "SIGN_MODEL_PATH": "Sign-detection weights.",
    "ALLOWED_ORIGINS": "Must list the frontend origin or the browser is blocked by CORS.",
    "INFERENCE_DEVICE": "Leave auto unless pinning a specific GPU or forcing CPU.",
    "MAX_CONCURRENT_STREAMS": "Raise only if more cameras must stream at once.",
    "MODEL_POOL_PREWARM": "Keep at least as high as the number of cameras normally streaming.",
    "REPORT_TIMEZONE": "Display timezone for report timestamps. Storage is always UTC.",
    "REPORT_COMPANY_NAME": "Appears on generated PDF reports.",
    "REPORT_EMAIL_ENABLED": "Master switch for emailed reports.",
    "SMTP_HOST": "Required if emailed reports are enabled.",
    "SMTP_USERNAME": "Required if emailed reports are enabled.",
    "SMTP_PASSWORD": "Required if emailed reports are enabled. Never commit it.",
    "SMTP_FROM_EMAIL": "Required if emailed reports are enabled.",
    "REPORT_RECIPIENT_ALLOWLIST": "Set this. An empty list allows any recipient.",
}

# Settings whose default is deliberately conservative or whose value is
# load-bearing enough that changing it breaks something. Surfaced as warnings.
DO_NOT_CHANGE = {
    "FALL_LIVE_FRAME_STRIDE": "A validator rejects any value but 1: the behavior classifier needs every frame of an ordered 24-FPS window.",
    "FALL_BEHAVIOR_WINDOW_FRAMES": "The classifier was trained on 60-frame windows.",
    "FALL_BEHAVIOR_CANONICAL_FPS": "The classifier's temporal features assume 24 FPS.",
}


def markdown_table(headers: list[str], rows: list[list[str]]) -> str:
    """Render a Markdown table. Returns an empty string for no rows."""
    if not rows:
        return ""
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    lines.extend("| " + " | ".join(cells) + " |" for cells in rows)
    return "\n".join(lines)


def escape_cell(value: str) -> str:
    """Make a value safe to place inside a Markdown table cell."""
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


def current_commit() -> str:
    """Short hash of HEAD, or a placeholder outside a git checkout."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_DIR, capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def generated_header(title: str, source: str) -> str:
    """Standard header marking a file as generated, with its provenance."""
    return (
        f"# {title}\n\n"
        f"> **Generated file — do not edit by hand.**\n"
        f"> Produced by `backend/scripts/generate_docs.py` from {source}.\n"
        f"> Regenerate after changing that source; edit the script, not this file.\n"
        f">\n"
        f"> Generated {date.today().isoformat()} at commit `{current_commit()}`.\n"
    )


# ---- config ----------------------------------------------------------------


def parse_settings_fields() -> list[dict]:
    """Extract every Settings field from config.py with its comments.

    The AST gives names, annotations and defaults; comments are harvested from
    the source lines because the AST discards them. Section markers of the form
    "# ---- Name ----" group the output the same way the source groups it.
    """
    source_lines = CONFIG_SOURCE.read_text(encoding="utf-8").splitlines()
    tree = ast.parse(CONFIG_SOURCE.read_text(encoding="utf-8"))

    settings_class = next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == "Settings"
    )

    fields: list[dict] = []
    for node in settings_class.body:
        # Only annotated assignments are settings; validators and the nested
        # Config class are not.
        if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name):
            continue

        # Walk backwards from the field to collect its comment block and the
        # most recent section marker.
        description_parts: list[str] = []
        section = ""
        index = node.lineno - 2
        while index >= 0:
            stripped = source_lines[index].strip()
            if stripped.startswith("# ----"):
                section = stripped.strip("# -")
                break
            if stripped.startswith("#"):
                description_parts.insert(0, stripped.lstrip("#").strip())
                index -= 1
                continue
            break

        # A trailing inline comment on the field's own line is part of its
        # description too.
        own_line = source_lines[node.lineno - 1]
        if "#" in own_line.split("=", 1)[-1]:
            inline = own_line.split("#", 1)[1].strip()
            if inline:
                description_parts.append(inline)

        # Find the enclosing section by scanning upwards past the comment block.
        if not section:
            for scan in range(node.lineno - 2, -1, -1):
                candidate = source_lines[scan].strip()
                if candidate.startswith("# ----"):
                    section = candidate.strip("# -")
                    break

        fields.append({
            "name": node.target.id,
            "type": ast.unparse(node.annotation),
            "default": ast.unparse(node.value) if node.value is not None else "(required)",
            "description": " ".join(description_parts),
            "section": section or "General",
        })
    return fields


def generate_config_doc() -> Path:
    """Write docs/CONFIGURATION.md from config.py."""
    fields = parse_settings_fields()
    by_name = {field["name"]: field for field in fields}

    parts = [generated_header("Configuration", "`backend/app/core/config.py`")]
    parts.append(
        "Every setting is read by `pydantic-settings` from the environment or from\n"
        "`backend/.env` (see `Settings.Config.env_file`). Names are case-sensitive and\n"
        "match exactly. `backend/.env.example` is a copyable template.\n\n"
        f"There are **{len(fields)} settings**. Most are tuning constants that should be\n"
        "left alone; the ones an operator actually sets are listed first.\n"
    )

    # Operator-facing settings first, because almost nobody needs the rest.
    parts.append("\n## Settings you need to set\n")
    operator_rows = []
    for name, guidance in OPERATOR_SETTINGS.items():
        field = by_name.get(name)
        if field is None:
            continue
        operator_rows.append([
            f"`{name}`",
            f"`{escape_cell(field['default'])}`",
            escape_cell(guidance),
        ])
    parts.append(markdown_table(["Setting", "Default", "Why you would change it"], operator_rows))

    # Load-bearing values, called out so nobody "optimises" them.
    parts.append("\n\n## Settings you must not change\n")
    locked_rows = [
        [f"`{name}`", f"`{escape_cell(by_name[name]['default'])}`", escape_cell(reason)]
        for name, reason in DO_NOT_CHANGE.items() if name in by_name
    ]
    parts.append(markdown_table(["Setting", "Value", "Why"], locked_rows))

    # Then the full reference. Grouped by the setting-name prefix rather than
    # by the source's own section comments: config.py only marks two sections
    # explicitly, which would leave everything else in one table of over a
    # hundred rows. The prefix is derived from the name, so it cannot drift.
    parts.append("\n\n## Full reference\n")
    parts.append(
        "Grouped by name prefix. Defaults are the values in `config.py`; a value in\n"
        "`backend/.env` overrides them, so a running system may differ.\n"
    )
    grouped: dict[str, list[dict]] = {}
    for field in fields:
        grouped.setdefault(field["name"].split("_")[0], []).append(field)

    # Fold one-off prefixes together so the contents list stays readable.
    sections: dict[str, list[dict]] = {}
    for prefix, prefix_fields in grouped.items():
        key = prefix if len(prefix_fields) > 1 else "Other"
        sections.setdefault(key, []).extend(prefix_fields)

    for section in sorted(sections):
        section_fields = sections[section]
        parts.append(f"\n### {section}\n")
        rows = [
            [
                f"`{field['name']}`",
                f"`{escape_cell(field['type'])}`",
                f"`{escape_cell(field['default'])}`",
                escape_cell(field["description"]) or "—",
            ]
            for field in section_fields
        ]
        parts.append(markdown_table(["Setting", "Type", "Default", "Meaning"], rows))
        parts.append("")

    output = DOCS_DIR / "CONFIGURATION.md"
    output.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")
    return output


# ---- api -------------------------------------------------------------------

HTTP_METHODS = ("get", "post", "put", "patch", "delete")


def generate_api_doc() -> Path:
    """Write docs/API.md from the live OpenAPI schema."""
    # Imported lazily: this pulls in the detection models, which the other
    # targets do not need.
    import logging
    import warnings

    warnings.filterwarnings("ignore")
    logging.disable(logging.CRITICAL)
    from app.main import app

    schema = app.openapi()
    paths = schema.get("paths", {})

    # Group operations by tag so the document reads by feature area rather
    # than alphabetically by path.
    by_tag: dict[str, list[tuple[str, str, dict]]] = {}
    operation_count = 0
    for path, item in sorted(paths.items()):
        for method, operation in item.items():
            if method not in HTTP_METHODS:
                continue
            operation_count += 1
            tag = (operation.get("tags") or ["untagged"])[0]
            by_tag.setdefault(tag, []).append((path, method.upper(), operation))

    parts = [generated_header("HTTP API", "the FastAPI OpenAPI schema")]
    parts.append(
        f"`{schema['info']['title']}` version `{schema['info']['version']}`, "
        f"OpenAPI `{schema.get('openapi')}`.\n\n"
        f"**{len(paths)} paths, {operation_count} operations.** The running server also\n"
        "serves this interactively at `/docs`, which is authoritative; this file exists so\n"
        "the surface can be reviewed without starting anything.\n\n"
        "**There is no authentication on any endpoint.** See `docs/KNOWN_LIMITATIONS.md`.\n"
    )

    parts.append("\n## WebSocket\n")
    parts.append(
        "WebSocket routes do not appear in an OpenAPI schema and are listed here by hand:\n\n"
        "| Route | Source | Purpose |\n| --- | --- | --- |\n"
        "| `/ws/stream` | `app/routers/streaming.py` | The live camera channel: streams "
        "detection results and frame events, and accepts `update_settings` messages to "
        "toggle per-camera ppe/zone/behavior flags and `reload_zones` after zones change. |\n"
    )

    for tag, operations in sorted(by_tag.items()):
        parts.append(f"\n## {tag}\n")
        rows = []
        for path, method, operation in sorted(operations):
            summary = operation.get("summary") or operation.get("operationId") or ""
            parameters = operation.get("parameters") or []
            query = ", ".join(
                f"`{parameter['name']}`"
                for parameter in parameters
                if parameter.get("in") == "query"
            )
            has_body = "yes" if operation.get("requestBody") else ""
            rows.append([
                f"`{method}`",
                f"`{path}`",
                escape_cell(summary),
                query or "—",
                has_body or "—",
            ])
        parts.append(markdown_table(
            ["Method", "Path", "Summary", "Query parameters", "Body"], rows
        ))
        parts.append("")

    output = DOCS_DIR / "API.md"
    output.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")
    return output


# ---- database --------------------------------------------------------------


def generate_database_doc() -> Path:
    """Write docs/DATABASE.md from the SQLModel metadata."""
    # Importing the models registers every table on the shared metadata.
    from sqlmodel import SQLModel

    import app.models  # noqa: F401  (imported for its registration side effect)

    metadata = SQLModel.metadata

    parts = [generated_header("Database schema", "the SQLModel metadata")]
    parts.append(
        f"**{len(metadata.tables)} tables.** The schema is created by\n"
        "`SQLModel.metadata.create_all()`. **There is no migration framework** — no\n"
        "Alembic — so `create_all()` creates whole missing tables and never alters an\n"
        "existing one. Schema changes to a live database are applied by the patch\n"
        "scripts listed at the end of this document.\n"
    )

    for table in metadata.sorted_tables:
        parts.append(f"\n## `{table.name}`\n")

        column_rows = []
        for column in table.columns:
            flags = []
            if column.primary_key:
                flags.append("PK")
            if not column.nullable:
                flags.append("NOT NULL")
            if column.index:
                flags.append("indexed")
            if column.unique:
                flags.append("unique")

            default = ""
            if column.server_default is not None:
                # server_default carries a SQL text clause, not a Python value.
                default = getattr(column.server_default.arg, "text", str(column.server_default.arg))
            elif column.default is not None:
                default = str(getattr(column.default, "arg", column.default))

            column_rows.append([
                f"`{column.name}`",
                f"`{escape_cell(column.type)}`",
                ", ".join(flags) or "—",
                f"`{escape_cell(default)}`" if default else "—",
            ])
        parts.append(markdown_table(["Column", "Type", "Constraints", "Default"], column_rows))

        foreign_key_rows = []
        for constraint in table.foreign_key_constraints:
            for element in constraint.elements:
                foreign_key_rows.append([
                    f"`{element.parent.name}`",
                    f"`{element.target_fullname}`",
                    escape_cell(constraint.ondelete or "(no action)"),
                ])
        if foreign_key_rows:
            parts.append("\n**Foreign keys**\n")
            parts.append(markdown_table(["Column", "References", "ON DELETE"], foreign_key_rows))

        index_rows = [
            [f"`{index.name}`", ", ".join(f"`{c.name}`" for c in index.columns)]
            for index in sorted(table.indexes, key=lambda i: i.name or "")
        ]
        if index_rows:
            parts.append("\n**Indexes**\n")
            parts.append(markdown_table(["Index", "Columns"], index_rows))
        parts.append("")

    # The patch scripts are the only way an existing database gets a new
    # column, so their order matters more than anything else on this page.
    parts.append("\n## Migration scripts\n")
    parts.append(
        "All are **idempotent and safe to re-run**. A database created fresh after these\n"
        "changes already has the columns via `create_all()`; **an existing database needs\n"
        "all three**, run from `backend/`:\n\n"
        "```bash\n"
        ".venv/Scripts/python.exe scripts/add_incident_area_zone.py\n"
        ".venv/Scripts/python.exe scripts/backfill_zone_violation_severity.py\n"
        ".venv/Scripts/python.exe scripts/add_report_language_column.py\n"
        "```\n\n"
        "| Script | What it does |\n| --- | --- |\n"
        "| `add_incident_area_zone.py` | Adds `area_zone_id` to all three incident tables "
        "and backfills it, including re-attaching rows orphaned by a camera deletion. |\n"
        "| `backfill_zone_violation_severity.py` | Fills historical `NULL` severities using "
        "the same mapping the write path now uses. Rows that already carry a severity are "
        "left alone. |\n"
        "| `add_report_language_column.py` | Adds `report_schedules.language`. |\n"
        "| `apply_new_indexes.py` | Pre-existing index patch script; the three above follow "
        "its pattern. |\n"
    )

    output = DOCS_DIR / "DATABASE.md"
    output.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")
    return output


TARGETS = {
    "config": generate_config_doc,
    "api": generate_api_doc,
    "database": generate_database_doc,
}


def main(argv: list[str]) -> int:
    requested = argv or list(TARGETS)
    unknown = [name for name in requested if name not in TARGETS]
    if unknown:
        print(f"ERROR: unknown target(s): {', '.join(unknown)}", file=sys.stderr)
        print(f"Available: {', '.join(TARGETS)}", file=sys.stderr)
        return 1

    for name in requested:
        output = TARGETS[name]()
        line_count = len(output.read_text(encoding="utf-8").splitlines())
        print(f"  wrote {output.relative_to(REPO_DIR)} ({line_count} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
