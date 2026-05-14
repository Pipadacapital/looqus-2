# Phase 0 — Monorepo Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Looqus Next.js app into `apps/frontend/`, switch the repo to a pnpm + Turborepo workspace, and create top-level placeholder directories — without breaking the running app.

**Architecture:** Single branch (`phase-0-monorepo`) off `main`. Five discrete commits, squash-merged. Pure structural change: no app source code edits beyond `tsconfig.json`. Verification gate after each commit ensures the frontend still builds.

**Tech Stack:** pnpm (via corepack), Turborepo, Next.js 16, TypeScript 5, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-14-phase-0-monorepo-design.md`

---

## Pre-flight environment notes (verified at planning time)

- `node` is v22.19.0 — fine for pnpm 9+ and Next.js 16.
- `npm` is 10.9.3.
- `corepack` is 0.34.0 — use it to install pnpm without a global install.
- Current `tsconfig.json` does **not** extend anything; `@/*` path alias is relative (`./*`) so it survives the move.
- Current `next.config.ts` is essentially empty — no path-affecting config.
- Existing GitHub workflow `sync-ads-cron.yml` only curls a deployed URL and is repo-path-independent.
- Current branch is `kushal-node` which the user confirmed is identical to `main`. The spec file `docs/superpowers/specs/2026-05-14-phase-0-monorepo-design.md` was committed on `kushal-node` as `c7b17eb`.
- `BRAIN_PHASED_PLAN.md` is **untracked** in the working tree at planning time — Task 0 commits it onto the new branch as the first action so the rest of the plan can edit it.

---

## File Structure (what each new file is responsible for)

| Path | Purpose |
|---|---|
| `package.json` (root, new) | Workspace root manifest. Private. Names the monorepo, declares `packageManager: pnpm@9.x`, holds shared `devDependencies` (turbo). |
| `pnpm-workspace.yaml` (root, new) | Declares `apps/*` and `packages/*` as workspace members. |
| `turbo.json` (root, new) | Turborepo pipeline definitions: `build`, `typecheck`, `lint`, `dev`. |
| `tsconfig.base.json` (root, new) | Strict shared TypeScript settings. `apps/frontend/tsconfig.json` extends it. |
| `.npmrc` (root, new) | pnpm hoisting config: `node-linker=hoisted` for npm-equivalent dep layout (zero behavior change for the existing app). |
| `.github/workflows/ci.yml` (new) | Minimal TS-only CI: `pnpm install`, `pnpm turbo run typecheck build` on PR + push to main. |
| `apps/frontend/tsconfig.json` (modified) | Now extends `../../tsconfig.base.json`, keeps Next-specific `include`, `paths`, and the `next` plugin. |
| `apps/README.md` (new) | One paragraph: "Each top-level dir under `apps/` is a deployable service. Today only `frontend/` exists; service shells land in their owning phases." |
| `packages/README.md` (new) | One paragraph: "Shared TypeScript libraries used by `apps/*`. Empty in Phase 0; populated starting Phase 1." |
| `pylibs/README.md` (new) | One paragraph: "Shared Python libraries. Empty in Phase 0; populated starting Phase 1." |
| `protos/README.md` (new) | One paragraph: "Protobuf service contracts and Avro Kafka event schemas. Empty in Phase 0; populated in Phase 1." |
| `infra/README.md` (new) | One paragraph: "AWS CDK stacks. Empty in Phase 0; populated in Phase 11." |
| `tools/README.md` (new) | One paragraph: "Build, codegen, and migration scripts." |
| `docs/README.md` (new) | One paragraph: "Brain-level documentation. App-specific docs live in `apps/frontend/docs/`." |
| `BRAIN_PHASED_PLAN.md` (modified in final commit) | Phase 0 checkboxes ticked; deviation note added. |

Everything else is a `git mv` only — no content edits.

---

## Task 0: Pre-flight — install pnpm, capture baseline, commit BRAIN_PHASED_PLAN.md, create branch

**Files:**
- Modify: nothing yet
- Test: command outputs only

- [ ] **Step 1: Verify clean working tree (other than the one expected untracked file)**

Run: `git status --short`
Expected: only `?? BRAIN_PHASED_PLAN.md` (no modified files, no other untracked files). If anything else appears, stop and resolve before proceeding.

- [ ] **Step 2: Install pnpm via corepack**

Run: `corepack enable pnpm && corepack prepare pnpm@9.15.4 --activate`
Then verify: `pnpm --version`
Expected: `9.15.4` printed.

> If corepack reports a permissions error, fall back to `npm install -g pnpm@9.15.4`.

- [ ] **Step 3: Capture baseline build output**

Run: `npm install --prefer-offline 2>&1 | tail -5 && npm run build 2>&1 | tail -40 > /tmp/baseline-build.txt && echo "exit=$?"`
Expected: `exit=0`. The file `/tmp/baseline-build.txt` now contains the last 40 lines of a successful `npm run build`. We compare against this in Task 7.

- [ ] **Step 4: Commit BRAIN_PHASED_PLAN.md to current branch**

The file is untracked. Land it on the current branch (`kushal-node` = `main`) so subsequent commits can edit it.

```bash
git add BRAIN_PHASED_PLAN.md
git commit -m "$(cat <<'EOF'
docs: add Brain phased implementation plan

Source-of-truth phased plan for migrating Looqus into the Brain
monorepo over phases 0-14. Phase 0 begins now (see
docs/superpowers/specs/2026-05-14-phase-0-monorepo-design.md).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds. `git status --short` is now empty.

- [ ] **Step 5: Create the Phase 0 branch off current HEAD**

```bash
git checkout -b phase-0-monorepo
```

Expected: `Switched to a new branch 'phase-0-monorepo'`.

- [ ] **Step 6: Snapshot the file inventory before moving**

Run: `ls -1 | sort > /tmp/root-before.txt && cat /tmp/root-before.txt`
Expected: prints the alphabetical list of root entries. Used in Task 1 verification.

---

## Task 1: Relocate Next.js app into `apps/frontend/` (Commit 1)

**Files:**
- Create: `apps/frontend/` (and all children, by `git mv`)
- Modify: nothing edited; only renames

- [ ] **Step 1: Create the target directory**

```bash
mkdir -p apps/frontend
```

Expected: directory created.

- [ ] **Step 2: `git mv` all app directories**

```bash
git mv app components constants docs hooks lib module prisma public scripts stores apps/frontend/
```

Expected: no errors. `git status --short` shows 11 `R` (rename) entries.

- [ ] **Step 3: `git mv` all app files**

```bash
git mv components.json eslint.config.mjs next-env.d.ts next.config.ts package.json package-lock.json postcss.config.mjs proxy.ts shopify.app.toml tsconfig.json apps/frontend/
```

Expected: no errors. `git status --short` shows 10 additional `R` entries.

- [ ] **Step 4: `git mv` all `.env*` files**

`.env*` files are tracked-or-ignored depending on `.gitignore`. Move whichever exist:

```bash
for f in .env .env.local .env.development .env.production .env.staging; do
  if [ -e "$f" ]; then
    if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      git mv "$f" "apps/frontend/$f"
    else
      mv "$f" "apps/frontend/$f"
    fi
  fi
done
ls -la apps/frontend/.env* 2>/dev/null
```

Expected: any `.env*` file that existed at root is now under `apps/frontend/`. Tracked ones appear in `git status` as `R`; ignored ones don't.

- [ ] **Step 5: Move `node_modules` aside (we'll regenerate with pnpm in Task 2)**

```bash
rm -rf node_modules
```

Expected: removed. `git status` is unaffected (node_modules was gitignored).

- [ ] **Step 6: Verify the move snapshot**

Run: `ls -1 apps/frontend | sort > /tmp/frontend-after.txt && diff /tmp/root-before.txt /tmp/frontend-after.txt`
Expected: only differences are the docs that stayed at root (`CLAUDE.md`, `AI_INSIGHTS_PLAN.md`, `BRAIN_PHASED_PLAN.md`, `README.md`), the `.git` dir, the `.github` dir, the `.claude` dir, the `.gitignore`, the `apps` dir itself, and `docs/` (which contains the spec doc we already committed). Inspect the diff to confirm no app source got left behind.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: relocate Looqus Next.js app into apps/frontend/

Pure git mv — no content edits. The app cannot run until the next
commit adds the workspace root (pnpm-workspace.yaml, root package.json,
turbo.json, etc.).

Part 1 of 5 in Phase 0 monorepo restructure. See
docs/superpowers/specs/2026-05-14-phase-0-monorepo-design.md.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds, ~21+ rename entries.

- [ ] **Step 8: Verify rename history is preserved for a sample file**

Run: `git log --follow --oneline apps/frontend/lib/prisma.ts | head -5`
Expected: at least one commit older than this one appears (the file's history is intact).

---

## Task 2: Add pnpm workspace + Turborepo + tsconfig.base + .npmrc (Commit 2)

**Files:**
- Create: `package.json` (root), `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.npmrc`
- Modify: `apps/frontend/tsconfig.json`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

Write to `pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 2: Create `.npmrc`**

Write to `.npmrc`:

```
node-linker=hoisted
auto-install-peers=true
strict-peer-dependencies=false
```

> `node-linker=hoisted` makes pnpm produce a flat-ish `node_modules` similar to npm's, which maximizes compatibility for the existing app during the migration. We can revisit later when more workspaces exist.

- [ ] **Step 3: Create `turbo.json`**

Write to `turbo.json`:

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

Write to `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true
  }
}
```

> Note: this base intentionally omits `paths` and `plugins` — those are app-specific and remain in the frontend tsconfig.

- [ ] **Step 5: Create root `package.json`**

Write to `package.json`:

```json
{
  "name": "brain-monorepo",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@9.15.4",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.3.3"
  }
}
```

- [ ] **Step 6: Read the current frontend tsconfig before editing**

Run: `cat apps/frontend/tsconfig.json`
Expected: shows the file (already known: 35 lines, no `extends`).

- [ ] **Step 7: Replace `apps/frontend/tsconfig.json`**

Overwrite `apps/frontend/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules"]
}
```

> Settings that lived in the old tsconfig (`target`, `lib`, `allowJs`, `skipLibCheck`, `strict`, `noEmit`, `esModuleInterop`, `module`, `moduleResolution`, `resolveJsonModule`, `isolatedModules`, `jsx`, `incremental`) are now inherited from `tsconfig.base.json`. The frontend file keeps only what's Next-specific or app-specific.

- [ ] **Step 8: Add `turbo` as a devDependency in `apps/frontend/package.json`? — No.**

The frontend's existing `package.json` is unchanged. Turbo lives only at the root. Skip — this is a placeholder step to prevent the engineer from adding it.

- [ ] **Step 9: Run `pnpm install` from repo root**

Run: `pnpm install`
Expected: pnpm installs dependencies for the frontend workspace. Output ends with something like `Done in Xs`. A new `pnpm-lock.yaml` file is created at the root. The old `apps/frontend/package-lock.json` becomes stale (we'll delete it in step 11).

- [ ] **Step 10: Verify Prisma client generated**

Run: `ls apps/frontend/node_modules/.prisma/client 2>/dev/null && echo "prisma ok" || pnpm --filter frontend exec prisma generate`
Expected: either `prisma ok` (postinstall ran) or a successful manual `prisma generate`.

- [ ] **Step 11: Delete the stale npm lockfile inside the frontend**

```bash
rm -f apps/frontend/package-lock.json
```

Expected: removed. (pnpm-lock.yaml at the root is now the single lockfile.)

- [ ] **Step 12: Run typecheck via Turbo**

Run: `pnpm turbo run typecheck`
Expected: cache miss, typecheck succeeds (or matches the output of `pnpm --filter frontend exec tsc --noEmit` if no `typecheck` script exists in frontend `package.json` — see step 13).

- [ ] **Step 13: Add `typecheck` script to `apps/frontend/package.json` if missing**

Read `apps/frontend/package.json`. If there is no `"typecheck"` script under `"scripts"`, add it:

```json
"typecheck": "tsc --noEmit"
```

Then re-run `pnpm turbo run typecheck` and confirm it passes.

- [ ] **Step 14: Run production build via Turbo**

Run: `pnpm turbo run build`
Expected: `next build` succeeds. Compare last 40 lines of output to `/tmp/baseline-build.txt`. They should describe the same set of routes and similar bundle sizes (exact byte counts may differ slightly between npm and pnpm dep resolution).

- [ ] **Step 15: Spot-check `pnpm --filter frontend run dev`**

Run: `pnpm --filter frontend run dev` in a separate terminal (or background). Visit `http://localhost:3000` and verify the app loads. Then stop the dev server.

> This step requires manual confirmation from the user. Pause and wait for them to confirm the app loads before continuing.

- [ ] **Step 16: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc pnpm-lock.yaml apps/frontend/tsconfig.json apps/frontend/package.json
git rm -f --quiet apps/frontend/package-lock.json
git commit -m "$(cat <<'EOF'
chore: add pnpm workspace + Turborepo + shared tsconfig base

- Root package.json with packageManager pnpm@9.15.4 and turbo devDep
- pnpm-workspace.yaml declaring apps/* and packages/*
- turbo.json with build/typecheck/lint/dev tasks
- tsconfig.base.json with strict shared TS settings
- .npmrc with node-linker=hoisted for max compat with existing app
- apps/frontend/tsconfig.json extends the base, retains Next plugin + @/* alias
- apps/frontend/package-lock.json removed (replaced by root pnpm-lock.yaml)

After this commit, `pnpm install` then `pnpm --filter frontend dev`
runs the app identically to before the move.

Part 2 of 5 in Phase 0 monorepo restructure.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Task 3: Scaffold top-level placeholder dirs (Commit 3)

**Files:**
- Create: `apps/README.md`, `packages/README.md`, `pylibs/README.md`, `protos/README.md`, `infra/README.md`, `tools/README.md`, `docs/README.md`
- Create: `packages/`, `pylibs/`, `protos/`, `infra/`, `tools/` directories (some may already exist via the README write)

- [ ] **Step 1: Create `apps/README.md`**

Write to `apps/README.md`:

```markdown
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
```

- [ ] **Step 2: Create `packages/README.md`**

Write to `packages/README.md`:

```markdown
# packages/

Shared TypeScript libraries used by services in `apps/`.

Empty in Phase 0. Populated starting in Phase 1+ as cross-service needs arise (gRPC clients, shared UI, lib-metrics, lib-regional, etc.).

Add a new package here only when it has at least two consumers (or one consumer plus an imminent second). Premature shared packages are dead weight.
```

- [ ] **Step 3: Create `pylibs/README.md`**

Write to `pylibs/README.md`:

```markdown
# pylibs/

Shared Python libraries used by Python services in `apps/`.

Empty in Phase 0. Populated starting in Phase 1 (`brain_clickhouse`, `brain_db`, `brain_kafka`, `brain_grpc`, `brain_metrics`, `brain_regional`).

Managed via `uv` workspace (see root `pyproject.toml`, added in Phase 1).
```

- [ ] **Step 4: Create `protos/README.md`**

Write to `protos/README.md`:

```markdown
# protos/

Single source of truth for inter-service contracts.

- `core/`, `analytics/`, `intelligence/`, `notifications/` — gRPC service definitions (`.proto`)
- `events/` — Kafka event schemas (Avro `.avsc`)

Empty in Phase 0. Defined in Phase 1; consumed by services in Phases 2+.

Build via `tools/codegen-proto.sh` (added Phase 1) which runs `buf generate` to produce TS clients in `packages/lib-grpc-clients/` and Python clients in `pylibs/brain_grpc/`.

Every event message and gRPC request carries `workspace_id` as a required field — multi-tenancy enforced at the wire level.
```

- [ ] **Step 5: Create `infra/README.md`**

Write to `infra/README.md`:

```markdown
# infra/

AWS infrastructure as code (CDK, TypeScript).

Empty in Phase 0. Populated in Phase 11.

Will hold:
- `stacks/` — network, compute (EKS), data (RDS, ClickHouse Cloud, Redis), kafka (MSK), storage (S3, CloudFront), observability, security
- `k8s/` — Kubernetes manifests synced via ArgoCD
- `bin/` — CDK entrypoint
- `docker-compose.yaml` (Phase 1) — local dev stack: Postgres, ClickHouse, Kafka, Redis, MinIO

Until Phase 11, production deploy of the existing Next.js app continues on whatever host it lives on (TBD; not yet deployed at time of writing).
```

- [ ] **Step 6: Create `tools/README.md`**

Write to `tools/README.md`:

```markdown
# tools/

Build, codegen, migration, and operational scripts.

Empty in Phase 0. Populated as needs arise — examples planned:

- `codegen-proto.sh` (Phase 1) — runs `buf generate` to produce gRPC clients
- `setup-kafka-local.sh` (Phase 1) — creates local Kafka topics with correct partition counts
- `migrate-looqus-to-core.ts` (Phase 3) — one-time data migration from Looqus Postgres to core-service Postgres
- `seed-demo.py` (Phase 4) — seeds a demo workspace with realistic ClickHouse data
- `loadtest/` (Phase 12) — k6 scripts for sustained 5K RPS load testing
```

- [ ] **Step 7: Create `docs/README.md`**

Write to `docs/README.md`:

```markdown
# docs/

Brain-level architectural and product documentation.

App-specific operational docs live in `apps/<service>/docs/` (the existing Looqus docs moved to `apps/frontend/docs/` in Phase 0).

| Document | Purpose | Status |
|---|---|---|
| `superpowers/specs/` | Per-feature design specs from brainstorming | Active |
| `superpowers/plans/` | Per-feature implementation plans | Active |
| `BRAIN_TECHNICAL_DOCUMENTATION.md` | Markdown rendering of the source PDF | Pending (Phase 1) |
| `BRAIN_REQUIREMENTS.md` | Product requirements stub | Pending |
| `TECH/01..09_*.md` | Per-section deep dives | Pending |
```

- [ ] **Step 8: Verify directories exist**

Run: `ls -la apps packages pylibs protos infra tools docs`
Expected: each lists its README.md (and `apps/` lists `README.md` plus `frontend/`).

- [ ] **Step 9: Commit**

```bash
git add apps/README.md packages/README.md pylibs/README.md protos/README.md infra/README.md tools/README.md docs/README.md
git commit -m "$(cat <<'EOF'
chore: scaffold top-level monorepo placeholder directories

Add empty placeholder dirs for the future monorepo layout, each with
a README explaining its eventual purpose and the phase that begins
populating it. No code yet — service shells, packages, pylibs, protos,
infra, and tools are all created in their owning phases.

Part 3 of 5 in Phase 0 monorepo restructure.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Task 4: Add minimal TS-only CI workflow (Commit 4)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

Write to `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  typecheck-and-build:
    name: Typecheck + Build (TS)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9.15.4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm turbo run typecheck

      - name: Build
        run: pnpm turbo run build
```

- [ ] **Step 2: Verify the workflow file is valid YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "yaml ok"`
Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: add TS-only typecheck and build workflow

Runs on every PR and push to main. Uses pnpm 9.15.4 + Node 22 to
match the local toolchain. Installs with --frozen-lockfile so any
drift in pnpm-lock.yaml fails CI immediately.

Python and protobuf jobs deferred to phases that introduce them.

Part 4 of 5 in Phase 0 monorepo restructure.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Task 5: Mark Phase 0 progress in BRAIN_PHASED_PLAN.md (Commit 5)

**Files:**
- Modify: `BRAIN_PHASED_PLAN.md` (Phase 0 section only)

- [ ] **Step 1: Read the current Phase 0 section**

Run: `grep -n "^## Phase 0" BRAIN_PHASED_PLAN.md`
Expected: prints the line number where Phase 0 begins (around line 89).

Then read that section to confirm exact wording before editing:

Run: `sed -n '89,140p' BRAIN_PHASED_PLAN.md`
Expected: shows the Phase 0 mission, deliverables checklist, exit criteria.

- [ ] **Step 2: Edit `BRAIN_PHASED_PLAN.md` to add a deviation note and tick completed boxes**

Find the `## Phase 0 — Repo Rearrangement (Non-Disruptive)` heading. Immediately after the `**Mission:**` paragraph, insert a new "Deviation note" callout:

```markdown
> **Phase 0 deviation (executed 2026-05-14):** Scope reduced to frontend move + monorepo tooling only. Service shells, all `packages/*`, all `pylibs/*`, Docker Compose, Python tooling, protobuf scaffolding, and `infra/` CDK are deferred to their owning phases (e.g. ingestion-service scaffolds at Phase 2 start). Rationale: scaffolding 6 services 6+ weeks before implementation produces dead code that rots. See `docs/superpowers/specs/2026-05-14-phase-0-monorepo-design.md` for full design and `docs/superpowers/plans/2026-05-14-phase-0-monorepo.md` for the executed plan.
```

Then in the `### Deliverables` checklist, change `- [ ]` to `- [x]` for items that were actually executed:

- `- [x] Create top-level dirs: ...` — done.
- `- [x] Move current Next.js app into apps/frontend/: ...` — done.
- `- [x] Add pnpm-workspace.yaml, turbo.json at root. Convert apps/frontend/package.json to use the workspace.` — done.
- `- [x] Add tsconfig.base.json at root; apps/frontend/tsconfig.json extends it.` — done.

Items still `- [ ]` (deferred per the deviation note):
- Add `pyproject.toml`
- Scaffold all 6 service shells
- Scaffold all packages and pylibs
- Move `Technical Document.pdf` into markdown
- Set up monorepo CI for all 3 languages (only TS job added; Python + buf deferred)
- Add `tools/codegen-proto.sh`
- Add root `Makefile` / `make dev`

- [ ] **Step 3: Run typecheck + build once more to confirm nothing broke**

```bash
pnpm turbo run typecheck && pnpm turbo run build
```

Expected: both succeed (Turbo will use cache from earlier — should be very fast).

- [ ] **Step 4: Commit**

```bash
git add BRAIN_PHASED_PLAN.md
git commit -m "$(cat <<'EOF'
docs: mark Phase 0 progress in BRAIN_PHASED_PLAN.md

Add executed-2026-05-14 deviation note (minimal scope: frontend move
+ monorepo tooling only; service shells deferred to their phases).
Tick completed checkboxes; leave deferred ones unticked.

Part 5 of 5 in Phase 0 monorepo restructure.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Task 6: Final verification + push + open PR

**Files:** none

- [ ] **Step 1: Run the full verification suite**

```bash
pnpm install --frozen-lockfile && \
pnpm turbo run typecheck && \
pnpm turbo run build && \
echo "all checks passed"
```

Expected: ends with `all checks passed`.

- [ ] **Step 2: Spot-check dev server one more time**

```bash
pnpm --filter frontend run dev
```

Visit `http://localhost:3000`, click through 2-3 pages, confirm no regressions. Stop the dev server.

> Pause and wait for the user's confirmation that the dev server works correctly.

- [ ] **Step 3: Verify the commit history**

Run: `git log --oneline main..HEAD`
Expected: 5 commits in this order (newest first):
```
<sha> docs: mark Phase 0 progress in BRAIN_PHASED_PLAN.md
<sha> ci: add TS-only typecheck and build workflow
<sha> chore: scaffold top-level monorepo placeholder directories
<sha> chore: add pnpm workspace + Turborepo + shared tsconfig base
<sha> chore: relocate Looqus Next.js app into apps/frontend/
```

- [ ] **Step 4: Push the branch**

```bash
git push -u origin phase-0-monorepo
```

Expected: branch pushed to origin.

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "Phase 0: monorepo restructure (move Looqus into apps/frontend/, switch to pnpm + Turborepo)" --body "$(cat <<'EOF'
## Summary

Phase 0 of the Brain monorepo migration (see `BRAIN_PHASED_PLAN.md`). Restructures the repo from a flat Next.js layout into a pnpm + Turborepo workspace, with the existing Looqus app relocated to `apps/frontend/`.

**Scope (deliberately minimal):** frontend move + workspace tooling + placeholder top-level dirs + minimal TS-only CI. Service shells (`apps/api-gateway/`, etc.), shared packages, Python tooling, Docker Compose, and `infra/` CDK are deferred to their owning phases to avoid dead scaffolding.

Full design: `docs/superpowers/specs/2026-05-14-phase-0-monorepo-design.md`
Executed plan: `docs/superpowers/plans/2026-05-14-phase-0-monorepo.md`

## Five commits in this PR

1. `chore: relocate Looqus Next.js app into apps/frontend/` — pure git mv, ~21 file renames
2. `chore: add pnpm workspace + Turborepo + shared tsconfig base` — workspace config + .npmrc
3. `chore: scaffold top-level monorepo placeholder directories` — READMEs in apps/, packages/, pylibs/, protos/, infra/, tools/, docs/
4. `ci: add TS-only typecheck and build workflow` — GitHub Actions
5. `docs: mark Phase 0 progress in BRAIN_PHASED_PLAN.md` — deviation note + ticked boxes

Squash-merge recommended.

## Test plan

- [ ] CI passes (typecheck + build via pnpm turbo)
- [ ] Local: `pnpm install && pnpm --filter frontend dev` starts the app on :3000
- [ ] Local: every analytics page loads without console errors (manual click-through)
- [ ] Local: `pnpm turbo run build` succeeds with bundle sizes comparable to pre-move baseline
- [ ] `git log --follow apps/frontend/lib/prisma.ts` shows file history preserved through the rename

## Rollback

`git revert <merge-commit>` on main restores the pre-monorepo layout cleanly.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Save it.

- [ ] **Step 6: Watch CI complete**

Run: `gh pr checks --watch`
Expected: typecheck-and-build job goes green.

- [ ] **Step 7: Stop and hand back to user**

Report:
- PR URL
- Five commit SHAs
- CI status
- "Ready for your review and squash-merge."

Do not merge automatically.

---

## Self-review notes

- **Spec coverage:** All 5 in-scope sections of the spec map to tasks 1-5; verification plan maps to task 6 (and embedded checks in task 2). Risks are mitigated by tasks 0 (baseline capture) and 6 (final verification). Definition-of-done items (a)-(e) are covered by tasks 1-5 commits + task 6 PR. ✓
- **Placeholder scan:** No TBDs/TODOs in actionable steps. The deferred items in `apps/README.md` and other READMEs are intentional — they describe the future, not deferred work in this PR. The `infra/README.md` says "TBD; not yet deployed" about deploy host — that's a real fact, not a plan placeholder. ✓
- **Type consistency:** No types defined; no consistency issues to check. ✓
- **Ambiguity:** Step 14 of Task 2 says "compare to /tmp/baseline-build.txt" — the comparison is qualitative ("same routes, similar bundle sizes"). That's intentional because byte-exact match between npm and pnpm is unrealistic. Engineer should flag major regressions but not chase byte-perfect parity. ✓
