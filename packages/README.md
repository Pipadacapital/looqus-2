# packages/

Shared TypeScript libraries used by services in `apps/`.

Empty in Phase 0. Populated starting in Phase 1+ as cross-service needs arise (gRPC clients, shared UI, lib-metrics, lib-regional, etc.).

Add a new package here only when it has at least two consumers (or one consumer plus an imminent second). Premature shared packages are dead weight.
