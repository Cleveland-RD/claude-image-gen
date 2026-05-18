#!/usr/bin/env bash
set -euo pipefail

# Smoke-test a built .mcpb: extract it, boot the wrapped server via stdio,
# feed `initialize` + `tools/list`, and confirm both image-gen tools are
# advertised. Exits 0 on success, non-zero with a diagnostic on failure.
#
# Usage: scripts/smoke-test.sh <path-to-image-gen-*.mcpb>
#
# Reminder: this only exercises the JSON-RPC boot path. It does NOT verify
# that sharp's native prebuild can actually dlopen on the target OS — sharp
# is lazy-loaded inside makeThumbnail and is never reached by initialize +
# tools/list. The real sharp-load check has to run on the matching OS in CI.

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/smoke-test.sh <image-gen-*.mcpb>" >&2
  exit 2
fi

MCPB="$1"
if [ ! -f "$MCPB" ]; then
  echo "not a file: $MCPB" >&2
  exit 2
fi

EXTRACT=$(mktemp -d)
STDERR_LOG=$(mktemp)
trap 'rm -rf "$EXTRACT" "$STDERR_LOG"' EXIT

unzip -q "$MCPB" -d "$EXTRACT"

if [ ! -f "$EXTRACT/server/wrap.cjs" ]; then
  echo "archive missing server/wrap.cjs: $MCPB" >&2
  exit 1
fi

REQUESTS=$(cat <<'JSON'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
JSON
)

OUTPUT=$(printf '%s\n' "$REQUESTS" | node "$EXTRACT/server/wrap.cjs" 2>"$STDERR_LOG" || true)

fail() {
  echo "smoke test FAIL: $1" >&2
  echo "--- captured stdout ---" >&2
  echo "$OUTPUT" >&2
  echo "--- captured stderr ---" >&2
  cat "$STDERR_LOG" >&2
  exit 1
}

if ! echo "$OUTPUT" | grep -q '"generate_image"'; then
  fail "generate_image not in tools/list response"
fi
if ! echo "$OUTPUT" | grep -q '"check_image_job"'; then
  fail "check_image_job not in tools/list response"
fi

echo "smoke OK: $(basename "$MCPB") advertises generate_image + check_image_job"
