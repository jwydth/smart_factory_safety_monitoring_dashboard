# HTTP API

> **Generated file — do not edit by hand.**
> Produced by `backend/scripts/generate_docs.py` from the FastAPI OpenAPI schema.
> Regenerate after changing that source; edit the script, not this file.
>
> Generated 2026-10-10 at commit `a9b356b`.

`De Heus PPE Detection API` version `1.0.0`, OpenAPI `3.1.0`.

**38 paths, 50 operations.** The running server also
serves this interactively at `/docs`, which is authoritative; this file exists so
the surface can be reviewed without starting anything.

**There is no authentication on any endpoint.** See `docs/KNOWN_LIMITATIONS.md`.


## WebSocket

WebSocket routes do not appear in an OpenAPI schema and are listed here by hand:

| Route | Source | Purpose |
| --- | --- | --- |
| `/ws/stream` | `app/routers/streaming.py` | The live camera channel: streams detection results and frame events, and accepts `update_settings` messages to toggle per-camera ppe/zone/behavior flags and `reload_zones` after zones change. |


## analytics

| Method | Path | Summary | Query parameters | Body |
| --- | --- | --- | --- | --- |
| `GET` | `/analytics/compare` | Get Analytics Compare | `mode`, `zone_id` | — |
| `GET` | `/analytics/incidents` | List Unified Incidents | `limit`, `zone_id`, `camera_id`, `severity` | — |
| `GET` | `/analytics/summary` | Get Analytics Summary | `range`, `zone_id` | — |
| `GET` | `/analytics/trend` | Get Analytics Trend | `range`, `zone_id` | — |


## behavior-detection

| Method | Path | Summary | Query parameters | Body |
| --- | --- | --- | --- | --- |
| `POST` | `/behavior-detection/predict` | Predict Fall Image | — | yes |
| `POST` | `/behavior-detection/predict-video` | Predict Fall Video | — | yes |
| `GET` | `/behavior-incidents` | Behavior Incidents | `limit`, `behavior_type`, `status`, `camera_id` | — |
| `DELETE` | `/behavior-incidents/{incident_id}` | Delete Behavior Incident | — | — |
| `GET` | `/behavior-incidents/{incident_id}` | Behavior Incident | — | — |
| `POST` | `/fall-detection/predict` | Predict Fall Image | — | yes |
| `POST` | `/fall-detection/predict-video` | Predict Fall Video | — | yes |


## cameras

| Method | Path | Summary | Query parameters | Body |
| --- | --- | --- | --- | --- |
| `GET` | `/cameras` | Get Cameras | — | — |
| `POST` | `/cameras` | Ensure Camera | — | yes |
| `DELETE` | `/cameras/{camera_id}` | Delete Camera | — | — |
| `PUT` | `/cameras/{camera_id}/home-zone` | Set Camera Home Zone | — | yes |


## detection

| Method | Path | Summary | Query parameters | Body |
| --- | --- | --- | --- | --- |
| `POST` | `/predict` | Predict | — | yes |
| `POST` | `/predict-video` | Predict Video | — | yes |
| `GET` | `/safety-events` | Safety Events | `page`, `page_size`, `category`, `severity`, `date_from`, `date_to` | — |
| `POST` | `/upload-video` | Upload Video | — | yes |
| `DELETE` | `/violations` | Delete All Incidents | — | — |
| `GET` | `/violations` | Violations | `limit` | — |
| `DELETE` | `/violations/{violation_id}` | Delete Single Violation | — | — |
| `GET` | `/violations/{violation_id}` | Get Violation Detail | — | — |
| `DELETE` | `/zone-violations/{zone_violation_id}` | Delete Single Zone Violation | — | — |


## features

| Method | Path | Summary | Query parameters | Body |
| --- | --- | --- | --- | --- |
| `GET` | `/cameras/{camera_id}/features` | Get Camera Feature Configs | — | — |
| `PUT` | `/cameras/{camera_id}/features` | Update Camera Feature Configs | — | yes |
| `GET` | `/features` | List Features | — | — |


## meta

| Method | Path | Summary | Query parameters | Body |
| --- | --- | --- | --- | --- |
| `GET` | `/health` | Health | — | — |


## reports

| Method | Path | Summary | Query parameters | Body |
| --- | --- | --- | --- | --- |
| `GET` | `/reports/incidents.pdf` | Download Incident Report Pdf | `range`, `zone_id`, `include_snapshots`, `language` | — |
| `POST` | `/reports/incidents/email` | Email Incident Report | — | yes |
| `GET` | `/reports/incidents/preview` | Get Report Preview | `range`, `zone_id`, `language` | — |
| `GET` | `/reports/schedule` | Get Report Schedule | — | — |
| `PUT` | `/reports/schedule` | Update Report Schedule | — | yes |


## streaming

| Method | Path | Summary | Query parameters | Body |
| --- | --- | --- | --- | --- |
| `GET` | `/stream-snapshot` | Stream Snapshot | `video_name` | — |


## testing

| Method | Path | Summary | Query parameters | Body |
| --- | --- | --- | --- | --- |
| `GET` | `/health/db` | Database Health | — | — |
| `GET` | `/health/smtp` | Smtp Health | — | — |
| `GET` | `/health/storage` | Storage Health | — | — |
| `DELETE` | `/health/streams` | Reset Streams Health | — | — |
| `GET` | `/health/streams` | Streams Health | — | — |


## zones

| Method | Path | Summary | Query parameters | Body |
| --- | --- | --- | --- | --- |
| `GET` | `/physical-zones` | Get Physical Zones | — | — |
| `POST` | `/physical-zones` | Create Physical Zone | — | yes |
| `DELETE` | `/physical-zones/{zone_id}` | Delete Physical Zone | — | — |
| `PUT` | `/physical-zones/{zone_id}` | Update Physical Zone | — | yes |
| `GET` | `/zone-violations` | Get Zone Violations | `limit` | — |
| `GET` | `/zone-violations/{zone_violation_id}` | Get Zone Violation Detail | — | — |
| `GET` | `/zones` | Get Zones | `video_name` | — |
| `POST` | `/zones` | Create Zone | — | yes |
| `DELETE` | `/zones/video` | Remove Zones For Video | `video_name` | — |
| `DELETE` | `/zones/{zone_id}` | Remove Zone | — | — |
| `PUT` | `/zones/{zone_id}` | Modify Zone | — | yes |
