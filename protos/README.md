# protos/

Single source of truth for inter-service contracts.

- `core/`, `analytics/`, `intelligence/`, `notifications/` — gRPC service definitions (`.proto`)
- `events/` — Kafka event schemas (Avro `.avsc`)

Empty in Phase 0. Defined in Phase 1; consumed by services in Phases 2+.

Build via `tools/codegen-proto.sh` (added Phase 1) which runs `buf generate` to produce TS clients in `packages/lib-grpc-clients/` and Python clients in `pylibs/brain_grpc/`.

Every event message and gRPC request carries `workspace_id` as a required field — multi-tenancy enforced at the wire level.
