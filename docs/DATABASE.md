# Database schema

> **Generated file — do not edit by hand.**
> Produced by `backend/scripts/generate_docs.py` from the SQLModel metadata.
> Regenerate after changing that source; edit the script, not this file.
>
> Generated 2026-10-10 at commit `a9b356b`.

**14 tables.** The schema is created by
`SQLModel.metadata.create_all()`. **There is no migration framework** — no
Alembic — so `create_all()` creates whole missing tables and never alters an
existing one. Schema changes to a live database are applied by the patch
scripts listed at the end of this document.


## `factories`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `name` | `VARCHAR(255)` | NOT NULL, unique | — |
| `location` | `VARCHAR(500)` | — | — |
| `is_active` | `BOOLEAN` | NOT NULL | `True` |
| `created_at` | `DATETIME` | NOT NULL | `now()` |
| `updated_at` | `DATETIME` | NOT NULL | `now()` |


## `features`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `key` | `VARCHAR(50)` | NOT NULL, indexed, unique | — |
| `name` | `VARCHAR(255)` | NOT NULL | — |
| `description` | `VARCHAR(500)` | — | — |
| `is_active` | `BOOLEAN` | NOT NULL | `True` |
| `created_at` | `DATETIME` | NOT NULL | `now()` |
| `updated_at` | `DATETIME` | NOT NULL | `now()` |

**Indexes**

| Index | Columns |
| --- | --- |
| `ix_features_key` | `key` |


## `report_deliveries`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `report_type` | `VARCHAR(64)` | NOT NULL | — |
| `range_param` | `VARCHAR(16)` | NOT NULL | — |
| `zone_id` | `BIGINT` | — | — |
| `recipients` | `VARCHAR(1000)` | NOT NULL | — |
| `subject` | `VARCHAR(500)` | NOT NULL | — |
| `filename` | `VARCHAR(255)` | NOT NULL | — |
| `object_key` | `VARCHAR(500)` | — | — |
| `size_bytes` | `INTEGER` | NOT NULL | — |
| `status` | `VARCHAR(16)` | NOT NULL | — |
| `error_message` | `TEXT` | — | — |
| `created_at` | `DATETIME` | NOT NULL | `now()` |


## `report_schedules`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `frequency` | `VARCHAR(16)` | NOT NULL | `off` |
| `day_of_week` | `INTEGER` | — | — |
| `day_of_month` | `INTEGER` | — | — |
| `hour` | `INTEGER` | NOT NULL | `7` |
| `minute` | `INTEGER` | NOT NULL | `0` |
| `zone_id` | `BIGINT` | — | — |
| `recipients` | `VARCHAR(1000)` | NOT NULL | — |
| `include_snapshots` | `BOOLEAN` | NOT NULL | `True` |
| `language` | `VARCHAR(8)` | NOT NULL | `en` |
| `subject` | `VARCHAR(500)` | — | — |
| `message` | `TEXT` | — | — |
| `last_sent_at` | `DATETIME` | — | — |
| `created_at` | `DATETIME` | NOT NULL | `now()` |
| `updated_at` | `DATETIME` | NOT NULL | `now()` |


## `physical_zones`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `factory_id` | `BIGINT` | NOT NULL, indexed | — |
| `name` | `VARCHAR(255)` | NOT NULL | — |
| `zone_type` | `VARCHAR(32)` | NOT NULL | — |
| `floor_plan_polygon` | `JSONB` | — | — |
| `dwell_threshold_seconds` | `FLOAT` | NOT NULL | `0.0` |
| `is_active` | `BOOLEAN` | NOT NULL | `True` |
| `created_at` | `DATETIME` | NOT NULL | `now()` |
| `updated_at` | `DATETIME` | NOT NULL | `now()` |

**Foreign keys**

| Column | References | ON DELETE |
| --- | --- | --- |
| `factory_id` | `factories.id` | RESTRICT |

**Indexes**

| Index | Columns |
| --- | --- |
| `ix_physical_zones_factory_id` | `factory_id` |
| `ix_physical_zones_factory_id_name` | `factory_id`, `name` |


## `cameras`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `factory_id` | `BIGINT` | NOT NULL, indexed | — |
| `name` | `VARCHAR(255)` | NOT NULL | — |
| `source_key` | `VARCHAR(500)` | NOT NULL, indexed, unique | — |
| `source_uri` | `VARCHAR` | — | — |
| `calibration_source_points` | `JSONB` | — | — |
| `home_zone_id` | `BIGINT` | indexed | — |
| `is_active` | `BOOLEAN` | NOT NULL | `True` |
| `created_at` | `DATETIME` | NOT NULL | `now()` |
| `updated_at` | `DATETIME` | NOT NULL | `now()` |

**Foreign keys**

| Column | References | ON DELETE |
| --- | --- | --- |
| `factory_id` | `factories.id` | RESTRICT |
| `home_zone_id` | `physical_zones.id` | SET NULL |

**Indexes**

| Index | Columns |
| --- | --- |
| `ix_cameras_factory_id` | `factory_id` |
| `ix_cameras_home_zone_id` | `home_zone_id` |
| `ix_cameras_source_key` | `source_key` |


## `behavior_incidents`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `camera_id` | `BIGINT` | indexed | — |
| `area_zone_id` | `BIGINT` | indexed | — |
| `source_key` | `VARCHAR(500)` | indexed | — |
| `behavior_type` | `VARCHAR(64)` | NOT NULL, indexed | — |
| `status` | `VARCHAR(32)` | NOT NULL, indexed | `NEW` |
| `severity` | `VARCHAR(32)` | — | — |
| `confidence` | `FLOAT` | — | — |
| `track_id` | `BIGINT` | — | — |
| `frame_start` | `INTEGER` | — | — |
| `frame_end` | `INTEGER` | — | — |
| `started_at` | `DATETIME` | NOT NULL, indexed | — |
| `ended_at` | `DATETIME` | — | — |
| `details` | `TEXT` | NOT NULL | — |
| `metadata` | `JSONB` | NOT NULL | — |
| `created_at` | `DATETIME` | NOT NULL | `now()` |

**Foreign keys**

| Column | References | ON DELETE |
| --- | --- | --- |
| `camera_id` | `cameras.id` | SET NULL |
| `area_zone_id` | `physical_zones.id` | SET NULL |

**Indexes**

| Index | Columns |
| --- | --- |
| `ix_behavior_incidents_area_zone_id` | `area_zone_id` |
| `ix_behavior_incidents_behavior_type` | `behavior_type` |
| `ix_behavior_incidents_camera_id` | `camera_id` |
| `ix_behavior_incidents_source_key` | `source_key` |
| `ix_behavior_incidents_started_at` | `started_at` |
| `ix_behavior_incidents_started_at_camera_id` | `started_at`, `camera_id` |
| `ix_behavior_incidents_status` | `status` |
| `ix_behavior_incidents_status_started_at` | `status`, `started_at` |


## `camera_feature_configs`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `camera_id` | `BIGINT` | NOT NULL, indexed | — |
| `feature_id` | `BIGINT` | NOT NULL, indexed | — |
| `is_enabled` | `BOOLEAN` | NOT NULL | `False` |
| `config_params` | `JSONB` | — | — |
| `created_at` | `DATETIME` | NOT NULL | `now()` |
| `updated_at` | `DATETIME` | NOT NULL | `now()` |

**Foreign keys**

| Column | References | ON DELETE |
| --- | --- | --- |
| `feature_id` | `features.id` | CASCADE |
| `camera_id` | `cameras.id` | CASCADE |

**Indexes**

| Index | Columns |
| --- | --- |
| `ix_camera_feature_configs_camera_id` | `camera_id` |
| `ix_camera_feature_configs_feature_id` | `feature_id` |


## `camera_zone_views`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `camera_id` | `BIGINT` | NOT NULL, indexed | — |
| `physical_zone_id` | `BIGINT` | NOT NULL, indexed | — |
| `ui_shape_data` | `JSONB` | NOT NULL | — |
| `normalized_coordinates` | `JSONB` | NOT NULL | — |
| `is_active` | `BOOLEAN` | NOT NULL | `True` |
| `created_at` | `DATETIME` | NOT NULL | `now()` |
| `updated_at` | `DATETIME` | NOT NULL | `now()` |

**Foreign keys**

| Column | References | ON DELETE |
| --- | --- | --- |
| `physical_zone_id` | `physical_zones.id` | CASCADE |
| `camera_id` | `cameras.id` | CASCADE |

**Indexes**

| Index | Columns |
| --- | --- |
| `ix_camera_zone_views_camera_id` | `camera_id` |
| `ix_camera_zone_views_physical_zone_id` | `physical_zone_id` |


## `ppe_violations`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `camera_id` | `BIGINT` | indexed | — |
| `area_zone_id` | `BIGINT` | indexed | — |
| `source_key` | `VARCHAR(500)` | indexed | — |
| `occurred_at` | `DATETIME` | NOT NULL, indexed | — |
| `violation_type` | `VARCHAR(64)` | NOT NULL | — |
| `details` | `TEXT` | NOT NULL | — |
| `snapshot_path` | `VARCHAR` | — | — |
| `frame_index` | `INTEGER` | — | — |
| `created_at` | `DATETIME` | NOT NULL | `now()` |

**Foreign keys**

| Column | References | ON DELETE |
| --- | --- | --- |
| `camera_id` | `cameras.id` | SET NULL |
| `area_zone_id` | `physical_zones.id` | SET NULL |

**Indexes**

| Index | Columns |
| --- | --- |
| `ix_ppe_violations_area_zone_id` | `area_zone_id` |
| `ix_ppe_violations_camera_id` | `camera_id` |
| `ix_ppe_violations_occurred_at` | `occurred_at` |
| `ix_ppe_violations_occurred_at_camera_id` | `occurred_at`, `camera_id` |
| `ix_ppe_violations_source_key` | `source_key` |


## `behavior_evidence`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `behavior_incident_id` | `BIGINT` | NOT NULL, indexed | — |
| `evidence_type` | `VARCHAR(32)` | NOT NULL | `SNAPSHOT` |
| `object_key` | `VARCHAR(500)` | NOT NULL | — |
| `frame_index` | `INTEGER` | — | — |
| `occurred_at` | `DATETIME` | NOT NULL, indexed | — |
| `created_at` | `DATETIME` | NOT NULL | `now()` |

**Foreign keys**

| Column | References | ON DELETE |
| --- | --- | --- |
| `behavior_incident_id` | `behavior_incidents.id` | CASCADE |

**Indexes**

| Index | Columns |
| --- | --- |
| `ix_behavior_evidence_behavior_incident_id` | `behavior_incident_id` |
| `ix_behavior_evidence_occurred_at` | `occurred_at` |


## `behavior_incident_subjects`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `behavior_incident_id` | `BIGINT` | NOT NULL, indexed | — |
| `tracker_id` | `BIGINT` | — | — |
| `person_index` | `INTEGER` | — | — |
| `bounding_box` | `JSONB` | — | — |
| `confidence` | `FLOAT` | — | — |
| `keypoints` | `JSONB` | — | — |
| `features` | `JSONB` | — | — |
| `created_at` | `DATETIME` | NOT NULL | `now()` |

**Foreign keys**

| Column | References | ON DELETE |
| --- | --- | --- |
| `behavior_incident_id` | `behavior_incidents.id` | CASCADE |

**Indexes**

| Index | Columns |
| --- | --- |
| `ix_behavior_incident_subjects_behavior_incident_id` | `behavior_incident_id` |


## `ppe_violation_subjects`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `ppe_violation_id` | `BIGINT` | NOT NULL, indexed | — |
| `tracker_id` | `BIGINT` | — | — |
| `person_index` | `INTEGER` | — | — |
| `missing_equipment` | `JSONB` | NOT NULL | — |
| `bounding_box` | `JSONB` | — | — |
| `confidence` | `FLOAT` | — | — |
| `created_at` | `DATETIME` | NOT NULL | `now()` |

**Foreign keys**

| Column | References | ON DELETE |
| --- | --- | --- |
| `ppe_violation_id` | `ppe_violations.id` | CASCADE |

**Indexes**

| Index | Columns |
| --- | --- |
| `ix_ppe_violation_subjects_ppe_violation_id` | `ppe_violation_id` |


## `zone_violations`

| Column | Type | Constraints | Default |
| --- | --- | --- | --- |
| `id` | `BIGINT` | PK, NOT NULL | — |
| `camera_id` | `BIGINT` | indexed | — |
| `physical_zone_id` | `BIGINT` | indexed | — |
| `camera_zone_view_id` | `BIGINT` | indexed | — |
| `area_zone_id` | `BIGINT` | indexed | — |
| `zone_name` | `VARCHAR(255)` | NOT NULL | — |
| `zone_type` | `VARCHAR(32)` | NOT NULL | — |
| `source_key` | `VARCHAR(500)` | NOT NULL, indexed | — |
| `tracker_id` | `BIGINT` | — | — |
| `occurred_at` | `DATETIME` | NOT NULL, indexed | — |
| `frame_index` | `INTEGER` | NOT NULL | — |
| `snapshot_path` | `VARCHAR` | — | — |
| `status` | `VARCHAR(32)` | NOT NULL | `OPEN` |
| `severity` | `VARCHAR(32)` | — | — |
| `created_at` | `DATETIME` | NOT NULL | `now()` |

**Foreign keys**

| Column | References | ON DELETE |
| --- | --- | --- |
| `area_zone_id` | `physical_zones.id` | SET NULL |
| `camera_zone_view_id` | `camera_zone_views.id` | SET NULL |
| `physical_zone_id` | `physical_zones.id` | SET NULL |
| `camera_id` | `cameras.id` | SET NULL |

**Indexes**

| Index | Columns |
| --- | --- |
| `ix_zone_violations_area_zone_id` | `area_zone_id` |
| `ix_zone_violations_camera_id` | `camera_id` |
| `ix_zone_violations_camera_zone_view_id` | `camera_zone_view_id` |
| `ix_zone_violations_occurred_at` | `occurred_at` |
| `ix_zone_violations_occurred_at_camera_id` | `occurred_at`, `camera_id` |
| `ix_zone_violations_physical_zone_id` | `physical_zone_id` |
| `ix_zone_violations_source_key` | `source_key` |
| `ix_zone_violations_status_occurred_at` | `status`, `occurred_at` |


## Migration scripts

All are **idempotent and safe to re-run**. A database created fresh after these
changes already has the columns via `create_all()`; **an existing database needs
all three**, run from `backend/`:

```bash
.venv/Scripts/python.exe scripts/add_incident_area_zone.py
.venv/Scripts/python.exe scripts/backfill_zone_violation_severity.py
.venv/Scripts/python.exe scripts/add_report_language_column.py
```

| Script | What it does |
| --- | --- |
| `add_incident_area_zone.py` | Adds `area_zone_id` to all three incident tables and backfills it, including re-attaching rows orphaned by a camera deletion. |
| `backfill_zone_violation_severity.py` | Fills historical `NULL` severities using the same mapping the write path now uses. Rows that already carry a severity are left alone. |
| `add_report_language_column.py` | Adds `report_schedules.language`. |
| `apply_new_indexes.py` | Pre-existing index patch script; the three above follow its pattern. |
