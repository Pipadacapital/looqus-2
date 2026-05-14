# apps/

Each subdirectory under `apps/` is an independently deployable service.

| Service | Phase introduced | Status |
|---|---|---|
| `frontend/` | Phase 0 | Active |
| `api-gateway/` | Phase 6 | Not yet scaffolded |
| `core-service/` | Phase 3 | Not yet scaffolded |
| `ingestion-service/` | Phase 2 | Not yet scaffolded |
| `analytics-service/` | Phase 4 | Not yet scaffolded |
| `intelligence-service/` | Phase 7 | Not yet scaffolded |
| `notifications-service/` | Phase 8 | Not yet scaffolded |

Service shells are scaffolded at the start of their owning phase rather than upfront, to avoid dead scaffolding rotting between phases.
