#!/usr/bin/env bash
set -euo pipefail

fail() { printf '%s\n' "$1" >&2; exit 1; }
[[ -n "${GITHUB_ENV:-}" ]] || fail MEMORY_ENV_REQUIRED
[[ ! -L .auto-memory ]] || fail MEMORY_UNSAFE_DIRECTORY
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
files=(latest.json history.json paper.json paper-trades.json journal.json governance.json execution-intents.json preflight-audit.json execution-quality.json)

remote_status=0
git ls-remote --exit-code --heads origin research-data >/dev/null 2>&1 || remote_status=$?
if [[ "$remote_status" == 2 ]]; then
  for file in "${files[@]}"; do
    [[ ! -e ".auto-memory/$file" && ! -L ".auto-memory/$file" ]] || fail MEMORY_BOOTSTRAP_WITH_EXISTING_STATE
  done
  mkdir -p .auto-memory
  printf 'AUTONOMOUS_MEMORY_MODE=BOOTSTRAP\nMEMORY_BASE_SHA=\n' >> "$GITHUB_ENV"
  exit 0
fi
[[ "$remote_status" == 0 ]] || fail MEMORY_REMOTE_PROBE_FAILED
git fetch --no-tags origin +refs/heads/research-data:refs/remotes/origin/research-data >/dev/null 2>&1 || fail MEMORY_FETCH_FAILED
base_sha="$(git rev-parse --verify 'refs/remotes/origin/research-data^{commit}' 2>/dev/null)" || fail MEMORY_BASE_INVALID
[[ "$base_sha" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]] || fail MEMORY_BASE_INVALID

stage_dir="$(mktemp -d)" || fail MEMORY_STAGE_FAILED
trap 'rm -rf "$stage_dir"' EXIT
for file in "${files[@]:0:5}"; do
  git show "$base_sha:$file" > "$stage_dir/$file" 2>/dev/null || fail MEMORY_REQUIRED_BLOB_FAILED
done
for file in "${files[@]:5}"; do
  entry="$(git ls-tree --name-only "$base_sha" -- "$file" 2>/dev/null)" || fail MEMORY_BLOB_LOOKUP_FAILED
  if [[ -n "$entry" ]]; then
    [[ "$entry" == "$file" ]] || fail MEMORY_BLOB_LOOKUP_FAILED
    git show "$base_sha:$file" > "$stage_dir/$file" 2>/dev/null || fail MEMORY_DIAGNOSTIC_BLOB_FAILED
  fi
done
node --input-type=module - "$script_root/lib/autonomous-memory.js" "$stage_dir" <<'NODE'
import path from "node:path";
import { pathToFileURL } from "node:url";
const { loadAutonomousMemory } = await import(pathToFileURL(process.argv[2]));
const names = { latest: "latest.json", history: "history.json", paper: "paper.json", trades: "paper-trades.json",
  journal: "journal.json", governance: "governance.json", executionIntents: "execution-intents.json",
  preflightAudit: "preflight-audit.json", executionQuality: "execution-quality.json" };
try {
  loadAutonomousMemory({ mode: "RESTORE", paths: Object.fromEntries(Object.entries(names)
    .map(([key, name]) => [key, path.join(process.argv[3], name)])) });
} catch (error) {
  console.error(/^MEMORY_[A-Z_]+$/.test(error.code || "") ? error.code : "MEMORY_VALIDATION_FAILED");
  process.exit(1);
}
NODE
mkdir -p .auto-memory
for file in "${files[@]}"; do
  rm -f ".auto-memory/$file"
  if [[ -f "$stage_dir/$file" ]]; then cp "$stage_dir/$file" ".auto-memory/$file"; fi
done
printf 'AUTONOMOUS_MEMORY_MODE=RESTORE\nMEMORY_BASE_SHA=%s\n' "$base_sha" >> "$GITHUB_ENV"
