#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 1. Rebuild the MCP bundle (writes mcp/dist/index.js).
( cd mcp && npm run build )

# 2. Wipe and re-stage the .mcpb tree.
rm -rf mcpb/server mcpb/node_modules dist
mkdir -p mcpb/server dist

# 3. Drop the bundled JS + the CJS wrapper into server/.
cp mcp/dist/index.js mcpb/server/index.js
cp mcpb/wrap.cjs mcpb/server/wrap.cjs

# 4. Install sharp's native prebuild into the BUNDLE-ROOT node_modules.
#    This matches the canonical .mcpb layout from anthropics/mcpb README:
#    require("sharp") in server/index.js resolves up to mcpb/node_modules/sharp/.
( cd mcpb && npm install --omit=dev --no-package-lock )

# 5. Validate the manifest against the spec before packing.
mcpb validate mcpb

# 6. Pack. Syntax (verified from anthropics/mcpb CLI.md):
#    mcpb pack <directory> [output]
mcpb pack mcpb dist/image-gen.mcpb

echo "Built: $ROOT/dist/image-gen.mcpb"
ls -lh dist/image-gen.mcpb
