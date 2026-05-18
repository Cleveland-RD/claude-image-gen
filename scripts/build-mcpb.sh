#!/usr/bin/env bash
set -euo pipefail

# Build a Claude Desktop .mcpb archive for a target platform/arch.
#
# Usage:
#   scripts/build-mcpb.sh                  # build for the host platform
#   scripts/build-mcpb.sh <os> <arch>      # build for a target
#
# Supported targets:
#   darwin-arm64, darwin-x64, win32-x64
#
# Linux is intentionally out of scope: Claude Desktop has no Linux build, and
# Linux Claude Code users build from source (see docs/install/claude-code.md).
#
# Output: dist/image-gen-<os>-<arch>.mcpb
#
# How cross-platform works: sharp ships per-OS/arch prebuilds via optional deps
# (`@img/sharp-<os>-<arch>`). npm 10+'s `--os/--cpu/--libc` flags pull the right
# prebuild regardless of the build host. The JS bundle itself is host-agnostic.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- Resolve target ---
if [ "$#" -eq 0 ]; then
  case "$(uname -s)" in
    Darwin) TARGET_OS=darwin ;;
    MINGW*|MSYS*|CYGWIN*) TARGET_OS=win32 ;;
    *) echo "Unsupported host OS: $(uname -s) — see script header for supported targets" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) TARGET_ARCH=arm64 ;;
    x86_64|x64)    TARGET_ARCH=x64 ;;
    *) echo "Unsupported host arch: $(uname -m)" >&2; exit 1 ;;
  esac
else
  TARGET_OS="${1:?usage: build-mcpb.sh [<os> <arch>]}"
  TARGET_ARCH="${2:?usage: build-mcpb.sh [<os> <arch>]}"
fi

case "$TARGET_OS-$TARGET_ARCH" in
  darwin-arm64|darwin-x64|win32-x64) ;;
  *)
    echo "Unsupported target: $TARGET_OS-$TARGET_ARCH" >&2
    echo "Allowed: darwin-arm64 darwin-x64 win32-x64" >&2
    exit 1
    ;;
esac

echo "==> Building .mcpb for $TARGET_OS-$TARGET_ARCH"

# --- Build the host-agnostic JS bundle ---
( cd mcp && [ -d node_modules ] || npm ci )
( cd mcp && npm run build )

# --- Stage a fresh per-target build directory ---
STAGE="dist/build-${TARGET_OS}-${TARGET_ARCH}"
rm -rf "$STAGE"
mkdir -p "$STAGE/server" dist

cp mcpb/package.json "$STAGE/package.json"
cp mcpb/wrap.cjs     "$STAGE/server/wrap.cjs"
cp mcp/dist/index.js "$STAGE/server/index.js"

# --- Generate platform-specific manifest ---
# /usr/bin/env trick is required on darwin to keep Claude Desktop's MCP router
# from picking a hardened-runtime UtilityProcess (sharp .node prebuild's Team ID
# mismatch with Anthropic's signing identity — see docs/HANDOFF.md §3). It works
# on linux too. Windows has no /usr/bin/env, and Library Validation is
# macOS-specific, so plain `node` on PATH is correct there.
if [ "$TARGET_OS" = "win32" ]; then
  MANIFEST_COMMAND='node'
  MANIFEST_ARGS='["${__dirname}/server/wrap.cjs"]'
else
  MANIFEST_COMMAND='/usr/bin/env'
  MANIFEST_ARGS='["node", "${__dirname}/server/wrap.cjs"]'
fi

jq \
  --arg cmd  "$MANIFEST_COMMAND" \
  --argjson args "$MANIFEST_ARGS" \
  --arg os   "$TARGET_OS" \
  '.compatibility.platforms = [$os]
   | .server.mcp_config.command = $cmd
   | .server.mcp_config.args = $args' \
  mcpb/manifest.json > "$STAGE/manifest.json"

# --- Install sharp's prebuild for the target ---
NPM_FLAGS=(--omit=dev --no-package-lock --os "$TARGET_OS" --cpu "$TARGET_ARCH")
( cd "$STAGE" && npm install "${NPM_FLAGS[@]}" )

# --- Validate + pack ---
mcpb validate "$STAGE"
OUTPUT="dist/image-gen-${TARGET_OS}-${TARGET_ARCH}.mcpb"
mcpb pack "$STAGE" "$OUTPUT"

echo
echo "Built: $ROOT/$OUTPUT"
ls -lh "$OUTPUT"
echo
echo "sharp prebuilds inside the archive:"
unzip -l "$OUTPUT" | grep -E '\.(node|dylib|dll)$|\.so(\.[0-9]+)*$' || echo "  (none found)"
