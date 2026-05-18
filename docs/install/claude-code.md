# Install on Claude Code

This guide installs **image-gen** in Claude Code. As with Claude Desktop, the MCP gives you the *tools* (`generate_image`, `check_image_job`); the optional plugin adds the `image-gen` *skill* and the `/image-gpt` / `/image-gemini` slash commands.

Unlike Desktop, Claude Code spawns the MCP using **your own** `node` binary, not a bundled Electron Helper. That means no library-validation gotchas, full inline-image rendering when the client supports it, and the same install works across nvm / Homebrew / system Node.

> **Audience:** end users on macOS, Linux, or Windows. macOS and Windows install the published `.mcpb` (auto-picked below). Linux users build from source — the `.mcpb` is a packaging convenience for Claude Desktop (which has no Linux build), but Claude Code on Linux just needs `node mcp/dist/index.js`. Skip to the [Linux / contributor mode appendix](#appendix-contributor--local-dev-mode) for those steps.

---

## Prerequisites

1. **Claude Code** installed:
   ```bash
   claude --version
   ```
   If missing, install via Homebrew (`brew install claude-code`) or follow [setup docs](https://code.claude.com/docs/en/setup).
2. **Node.js ≥ 20.3** on your PATH (any source works — system, Homebrew, nvm, asdf, fnm, etc.):
   ```bash
   node --version
   ```
   Why 20.3+: the bundled sharp prebuilds require N-API 9 (Node 18.17+, 20.3+, or 22+).
3. **API key(s)** — at least one:
   - **OpenAI** for `gpt-image-2` — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - **Gemini** for Nano Banana / Pro — [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

---

## 1. Install the MCP

This step gets you the `generate_image` and `check_image_job` tools. Required for any of the workflows below.

### Step 1 — Download and extract the bundle

The `.mcpb` Desktop Extension is just a zip. We extract its `server/` and `node_modules/` to a stable local path that Claude Code can spawn from.

```bash
# Pick the .mcpb matching your OS + CPU
# Linux users: skip this step — go to the appendix and build from source instead.
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)   MCPB_FILE=image-gen-darwin-arm64.mcpb ;;
  Darwin-x86_64)  MCPB_FILE=image-gen-darwin-x64.mcpb ;;
  *) echo "No published .mcpb for $(uname -s)-$(uname -m). Use the build-from-source appendix instead." >&2; exit 1 ;;
esac

# Download the .mcpb release asset
curl -L -o /tmp/image-gen.mcpb \
  "https://github.com/Cleveland-RD/claude-image-gen/releases/latest/download/$MCPB_FILE"

# Extract into ~/.image-gen-mcp (creates the dir on first run)
mkdir -p ~/.image-gen-mcp
unzip -oq /tmp/image-gen.mcpb -d ~/.image-gen-mcp

# Confirm
ls ~/.image-gen-mcp/server/index.js && \
  echo "MCP bundle ready at ~/.image-gen-mcp/server/index.js"
```

<details>
<summary>Windows (PowerShell)</summary>

```powershell
$Url = "https://github.com/Cleveland-RD/claude-image-gen/releases/latest/download/image-gen-win32-x64.mcpb"
$Mcpb = "$env:TEMP\image-gen.mcpb"
$Dest = "$env:USERPROFILE\.image-gen-mcp"

Invoke-WebRequest -Uri $Url -OutFile $Mcpb
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Expand-Archive -Path $Mcpb -DestinationPath $Dest -Force

Test-Path "$Dest\server\index.js"
```

Then in the next step, use `node "$env:USERPROFILE\.image-gen-mcp\server\index.js"` as the spawn command (instead of the `$HOME/.image-gen-mcp/...` form below).

</details>

The bundle includes sharp's native prebuild under `~/.image-gen-mcp/node_modules/`. Node's module resolution walks up from `server/` to find it, so don't move `server/` independently of `node_modules/`.

### Step 2 — Register with Claude Code

```bash
claude mcp add image-gen -s user \
  -e OPENAI_API_KEY="sk-..." \
  -e GEMINI_API_KEY="..." \
  -- node "$HOME/.image-gen-mcp/server/index.js"
```

What each flag does:

| Flag | What it does |
|---|---|
| `-s user` | Register at user scope — available in every Claude Code session on this machine. Alternatives: `local` (this repo only), `project` (shared with collaborators via `.claude/settings.json`). |
| `-e KEY=value` | Bake the API key into the registration. The MCP receives it via `process.env` on every spawn. Both `-e` flags are optional individually; fill the one(s) you'll actually use. |
| `--` | Separator — everything after this is the literal spawn command and arguments. |

You can also inherit keys from your shell instead of baking them into the registration:

```bash
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=...
claude mcp add image-gen -s user -- node "$HOME/.image-gen-mcp/server/index.js"
```

Inherited env beats `-e` for keeping secrets out of `~/.claude.json`, but it requires the shell that *launches* Claude Code to have those vars exported.

### Step 3 — Verify

```bash
claude mcp list
```

You should see `image-gen` listed. Open Claude Code in a fresh terminal and try:

> Generate me an image of a red apple on a white table.

In ~10–60s a PNG lands at `~/Pictures/image-gen/<slug>-<hash>.png`. Inline thumbnail rendering depends on your Claude Code client — most CLI renderers won't show images inline; check the path or open the file directly.

---

## 2. (Optional) Install the plugin for skill + slash commands

The plugin layers the model-picker workflow and slash commands on top of the bare MCP. Same artifact, two install paths.

### Option A — GitHub marketplace (recommended once published)

Run these inside any Claude Code session:

```
/plugin marketplace add Cleveland-RD/claude-image-gen
/plugin install image-gen@claude-image-gen
/reload-plugins
```

What each command does:

| Command | What it does |
|---|---|
| `/plugin marketplace add Cleveland-RD/claude-image-gen` | Adds the GitHub repo as a marketplace. Claude Code reads `.claude-plugin/marketplace.json` at the repo root and registers the plugin it advertises. |
| `/plugin install image-gen@claude-image-gen` | Installs the `image-gen` plugin from the `claude-image-gen` marketplace into your user scope. |
| `/reload-plugins` | Activates the plugin in the current session (no Claude Code restart needed). |

Verify with `/plugin` — the Installed tab should show `image-gen` enabled. The slash commands `/image-gen:image-gpt` and `/image-gen:image-gemini` should appear when you press `/`.

### Option B — Local zip download

If you don't want to install from GitHub (e.g., offline install, audit the zip first):

```bash
# Download the plugin zip
curl -L -o /tmp/image-gen-plugin.zip \
  https://github.com/Cleveland-RD/claude-image-gen/releases/latest/download/image-gen-plugin.zip

# Extract somewhere stable
mkdir -p ~/.image-gen-plugin
unzip -oq /tmp/image-gen-plugin.zip -d ~/.image-gen-plugin
```

Then inside any Claude Code session:

```
/plugin marketplace add ~/.image-gen-plugin/plugin
/plugin install image-gen@claude-image-gen
/reload-plugins
```

Or for one-off testing without persisting the install:

```bash
claude --plugin-dir ~/.image-gen-plugin/plugin
```

### Step — Try it

In a Claude Code session with the plugin installed:

- Slash command: `/image-gen:image-gpt a red apple on a white table` — skips the model picker, goes straight to `gpt-image-2`.
- Natural language: *"Generate me an image of a fox reading a book"* — the skill prompts you to pick GPT / Gemini / Both.

---

## Troubleshooting

### `generate_image` / `check_image_job` not in the tool inventory

The MCP didn't register or didn't spawn. Check the registration:

```bash
claude mcp list
```

If `image-gen` is missing, re-run `claude mcp add ...` from Step 1.2 above. If it's listed but tool calls still fail, run Claude Code with `--debug` and look for the spawn error:

```bash
claude --debug
```

Common spawn failures:
- `node: command not found` — Node isn't on the shell's PATH. Confirm with `which node`. If using nvm, source it before launching Claude Code.
- `Cannot find module 'sharp'` — the `~/.image-gen-mcp/node_modules/` tree was moved/deleted. Re-extract the `.mcpb`.

### Slash commands `/image-gen:image-gpt` not showing up

The plugin isn't loaded. Inside Claude Code:

```
/plugin
```

Open the Installed tab. If `image-gen` is missing, re-run the install steps. If it's listed but errored, open the **Errors** tab — common causes:
- Plugin path moved or deleted → re-extract / re-install.
- Marketplace stale → `/plugin marketplace update claude-image-gen`.

### API key not picked up

The MCP reads env vars at spawn time:
- If you used `-e` flags during `claude mcp add`, the keys are stored in `~/.claude.json` and used on every spawn.
- If you relied on shell inheritance, the shell that *launches* Claude Code must have the keys exported.

To update a baked-in key:

```bash
claude mcp remove image-gen
claude mcp add image-gen -s user -e OPENAI_API_KEY=<new-key> -- node "$HOME/.image-gen-mcp/server/index.js"
```

### Where to find logs

```bash
# Run Claude Code with verbose output
claude --debug

# Inside a session, plugin errors tab
/plugin
```

The MCP itself writes its stderr to Claude Code's debug stream (visible with `--debug`). It also creates `~/image-gen-mcp-debug.log` on every spawn — same diagnostic trail used on Desktop, useful when comparing behavior across surfaces.

### Moderation / `gemini-pro` 503

Same provider behaviors as Desktop:
- Content-moderation refusals from Gemini → rephrase the prompt.
- `gemini-3-pro-image-preview` 503s under load → retry, or use `gemini-flash`.

---

## Uninstall

```bash
# Unregister the MCP
claude mcp remove image-gen

# Remove the extracted bundle
rm -rf ~/.image-gen-mcp

# Remove the plugin (inside a Claude Code session)
# /plugin uninstall image-gen@claude-image-gen
# /plugin marketplace remove claude-image-gen
```

If you used `Option B — Local zip download` for the plugin, also `rm -rf ~/.image-gen-plugin`.

---

## Appendix: Contributor / local-dev mode

For two audiences:

1. **Linux users.** No `.mcpb` is published for Linux (Claude Desktop has no Linux build, so we don't ship one). Build from source — the steps below produce a working `mcp/dist/index.js` that Claude Code on Linux can spawn directly.
2. **Contributors** working on the repo itself.

Both follow the same flow — clone, build, register from the local checkout.

```bash
# Clone and build
git clone https://github.com/Cleveland-RD/claude-image-gen.git
cd claude-image-gen/mcp
npm install
npm run build      # writes mcp/dist/index.js

# Register the MCP at an absolute path
claude mcp add image-gen -s user \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e GEMINI_API_KEY="$GEMINI_API_KEY" \
  -- node "$(pwd)/dist/index.js"

# Load the plugin as a dev directory (no marketplace install)
cd ..
claude --plugin-dir "$(pwd)/plugin"
```

The `--plugin-dir` flag is session-scoped — re-pass it every time you launch Claude Code while developing. For a persistent local install, run `/plugin marketplace add $(pwd)/plugin` inside a session instead.

When iterating on the MCP source, re-run `npm run build` in `mcp/`, then exit and re-enter the Claude Code session (or run `/mcp restart image-gen` if your version supports it) so the changes are picked up.
