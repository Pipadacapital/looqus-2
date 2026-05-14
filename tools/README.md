# tools/

Build, codegen, migration, and operational scripts.

Empty in Phase 0. Populated as needs arise — examples planned:

- `codegen-proto.sh` (Phase 1) — runs `buf generate` to produce gRPC clients
- `setup-kafka-local.sh` (Phase 1) — creates local Kafka topics with correct partition counts
- `migrate-looqus-to-core.ts` (Phase 3) — one-time data migration from Looqus Postgres to core-service Postgres
- `seed-demo.py` (Phase 4) — seeds a demo workspace with realistic ClickHouse data
- `loadtest/` (Phase 12) — k6 scripts for sustained 5K RPS load testing
