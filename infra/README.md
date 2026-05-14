# infra/

AWS infrastructure as code (CDK, TypeScript).

Empty in Phase 0. Populated in Phase 11.

Will hold:
- `stacks/` — network, compute (EKS), data (RDS, ClickHouse Cloud, Redis), kafka (MSK), storage (S3, CloudFront), observability, security
- `k8s/` — Kubernetes manifests synced via ArgoCD
- `bin/` — CDK entrypoint
- `docker-compose.yaml` (Phase 1) — local dev stack: Postgres, ClickHouse, Kafka, Redis, MinIO

Until Phase 11, production deploy of the existing Next.js app continues on whatever host it lives on (TBD; not yet deployed at time of writing).
