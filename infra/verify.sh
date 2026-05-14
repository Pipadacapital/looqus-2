#!/usr/bin/env bash
# Verifies all 8 services in the local Docker Compose stack are healthy.
# Exits 0 if all pass, 1 on first failure (with red [FAIL] line).

set -uo pipefail

COMPOSE_FILE="$(cd "$(dirname "$0")" && pwd)/docker-compose.yaml"
PASS=0
FAIL=0

red()   { printf "\033[0;31m%s\033[0m\n" "$1"; }
green() { printf "\033[0;32m%s\033[0m\n" "$1"; }

check() {
  local name="$1"
  local cmd="$2"
  local expect_grep="$3"
  local actual
  actual=$(eval "$cmd" 2>&1)
  if [[ -z "$expect_grep" ]] || echo "$actual" | grep -qE "$expect_grep"; then
    green "[PASS] $name"
    PASS=$((PASS + 1))
  else
    red "[FAIL] $name"
    echo "  cmd: $cmd"
    echo "  expected match: $expect_grep"
    echo "  actual: $(echo "$actual" | head -3)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Brain local stack verification ==="
echo

check "1. All 8 containers Up" \
  "docker compose -f '$COMPOSE_FILE' ps --format '{{.Name}} {{.State}}' | wc -l | tr -d ' '" \
  "^8$"

check "2. Postgres reachable + brain db exists" \
  "docker compose -f '$COMPOSE_FILE' exec -T postgres psql -U postgres -d brain -tAc 'SELECT current_database();'" \
  "^brain$"

check "3. ClickHouse /ping" \
  "curl -s --max-time 5 http://localhost:8123/ping" \
  "^Ok\\.$"

check "4. ClickHouse SELECT 1" \
  "curl -s --max-time 5 'http://localhost:8123/?query=SELECT+1'" \
  "^1$"

check "5. Kafka responsive" \
  "docker compose -f '$COMPOSE_FILE' exec -T kafka kafka-broker-api-versions --bootstrap-server localhost:9092 2>&1 | head -1" \
  "kafka:9092"

check "6. Schema Registry reachable" \
  "curl -s --max-time 5 http://localhost:8081/subjects" \
  "^\\[\\]$|^\\[.*\\]$"

check "7. Redis PING" \
  "docker compose -f '$COMPOSE_FILE' exec -T redis redis-cli ping" \
  "^PONG$"

check "8. MinIO live" \
  "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:9100/minio/health/live" \
  "^200$"

echo
echo "=== Result: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
