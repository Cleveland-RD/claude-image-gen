# Install on Claude Desktop

This guide installs **image-gen** on Claude Desktop. The MCP gives you the image-generation *tools*; the optional plugin layer adds the `image-gen` *skill* (model-picker workflow, clarifying questions, iteration guidance) and the `/image-gpt` / `/image-gemini` slash commands.

Most people only need the MCP. The plugin is a nice-to-have on top.

> **Audience:** end users on macOS or Windows. (Claude Desktop has no Linux build today; Linux users can install via Claude Code — see the [Claude Code guide](claude-code.md).) Per-platform `.mcpb` files are published — pick the one matching your OS + CPU below.

---

## Prerequisites

1. **Claude Desktop** installed and up to date. Check via *Claude menu → Check for Updates…*
2. **Node.js ≥ 20** must be on the `PATH` Claude Desktop inherits. The `.mcpb` launches its child process via `node` (or `/usr/bin/env node` on POSIX), which searches that `PATH`.
   - **macOS:** `brew install node` is simplest — it installs to `/usr/local/bin` (Intel) or `/opt/homebrew/bin` (Apple Silicon), both on the default `PATH`. Node managed only by `nvm` is typically **not** on Claude Desktop's `PATH` and won't work without a symlink.
     ```bash
     ls /usr/local/bin/node /opt/homebrew/bin/node 2>/dev/null
     node --version
     ```
   - **Windows:** install Node from [nodejs.org](https://nodejs.org). The installer adds `node.exe` to the system `PATH` by default. Verify in a *fresh* PowerShell window (PATH changes don't propagate to already-open shells):
     ```powershell
     where.exe node
     node --version
     ```
3. **API key(s)** — bring at least one:
   - **OpenAI** (for the `gpt-image-2` model) — generate at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
   - **Gemini** (for the Nano Banana / Pro models) — generate at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

---

## 1. Install the MCP (`.mcpb`)

This single step gets you the `generate_image` and `check_image_job` tools. Recommended for everyone.

### Step 1 — Download

Pick the file matching your OS + CPU architecture:

| Your platform | Download |
|---|---|
| macOS, Apple Silicon (M1/M2/M3/M4) | [`image-gen-darwin-arm64.mcpb`](https://github.com/Cleveland-RD/claude-image-gen/releases/latest/download/image-gen-darwin-arm64.mcpb) |
| macOS, Intel | [`image-gen-darwin-x64.mcpb`](https://github.com/Cleveland-RD/claude-image-gen/releases/latest/download/image-gen-darwin-x64.mcpb) |
| Windows, x86_64 | [`image-gen-win32-x64.mcpb`](https://github.com/Cleveland-RD/claude-image-gen/releases/latest/download/image-gen-win32-x64.mcpb) |

Browse all releases: [github.com/Cleveland-RD/claude-image-gen/releases](https://github.com/Cleveland-RD/claude-image-gen/releases)

Not sure of your CPU architecture? On macOS run `uname -m` (`arm64` → Apple Silicon, `x86_64` → Intel). On Windows almost all systems are `x86_64` — open *Settings → System → About* if unsure.

### Step 2 — Install the extension

In Claude Desktop:

1. Open **Settings**.
2. Click **Extensions** in the left sidebar.
3. Click **Advanced Settings**.
4. Click **Install Extension…**
5. Select the `.mcpb` you downloaded.

The extension installs and appears in the Extensions list.

### Step 3 — Configure your API key(s)

After install, the extension's row shows a **Configure** button. Click it to open the API-key dialog:

| Field | Required? | Where to get it |
|---|---|---|
| **OpenAI API Key** | Required for the GPT model | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Gemini API Key** | Required for any Gemini model | [aistudio.google.com](https://aistudio.google.com/apikey) |

Each field is individually optional — fill the one(s) you actually plan to use. Both are marked `sensitive: true` in the manifest, so Claude Desktop persists them via the OS secret store (Keychain on macOS, Credential Manager on Windows), not in plaintext on disk.

> **Heads up:** until you Configure at least one key, calling a tool will return `OPENAI_API_KEY env var is not set` (or the Gemini equivalent) at first use. The MCP itself still starts cleanly.

### Step 4 — Restart Claude Desktop

Fully quit Claude Desktop and reopen — **Cmd-Q** on macOS, **Quit Claude** from the system-tray menu on Windows. Closing the window alone isn't enough; the MCP child process keeps running. The restart makes Claude Desktop re-spawn the MCP with the API keys you just saved.

> Without this restart you'll see the MCP listed but tool calls return `OPENAI_API_KEY env var is not set` — the running MCP was spawned before you added the keys, and env vars don't refresh on the fly.

### Step 5 — Verify

In a new chat, look for the **Connectors icon** at the bottom-right of the chat input. Click it — you should see `image-gen` listed with two tools:

- `generate_image`
- `check_image_job`

If the icon doesn't appear, jump to [Troubleshooting](#troubleshooting).

### Step 6 — Try it

In a new chat:

> Generate me an image of a red apple on a white table.

In ~10–60s:
- The model calls `generate_image`.
- A PNG lands in your `Pictures/image-gen/` folder (`~/Pictures/image-gen/` on macOS, `%USERPROFILE%\Pictures\image-gen\` on Windows) named `<slug>-<hash>.png`.
- The chat reply mentions the file path.

> **About the inline preview.** The MCP returns a JPEG thumbnail alongside the JSON. Claude Desktop currently tucks it inside the collapsed *"Loaded tools, used Image Gen integration"* tool-call block in the chat — click to expand and the thumbnail is there. The full-resolution PNG is always on disk at the returned path.

---

## 2. (Optional) Add the plugin for skill + slash commands

The plugin adds layered behavior on top of the bare MCP:

| What | Purpose |
|---|---|
| `image-gen` skill | When you just ask "generate me an image", the skill drives the model-picker (GPT / Gemini / Both), asks clarifying questions if the brief is ambiguous, and handles iteration. |
| `/image-gpt` slash command | Skip the picker — go straight to `gpt-image-2`. |
| `/image-gemini` slash command | Skip the picker — go straight to Gemini Nano Banana (`gemini-flash`). |

The plugin does **not** include the MCP — it depends on the `.mcpb` install above for the `generate_image` and `check_image_job` tools.

### Step 1 — Download

Direct download from the GitHub Releases page:

- **[`image-gen-plugin.zip`](https://github.com/Cleveland-RD/claude-image-gen/releases/latest/download/image-gen-plugin.zip)** (latest release)
- Or browse all releases: [github.com/Cleveland-RD/claude-image-gen/releases](https://github.com/Cleveland-RD/claude-image-gen/releases)

### Step 2 — Upload the plugin

In Claude Desktop:

1. Open **Customize → Plugins**.
2. Click the **`+`** button.
3. Click **Upload a plugin**.
4. Select the downloaded `image-gen-plugin.zip`.

### Step 3 — Verify

In Customize → Plugins, `image-gen` should appear and be enabled. In any new chat:

- The `image-gen` skill is loaded.
- `/image-gpt` and `/image-gemini` are in the slash-command menu.

### Step 4 — Try it

In a new chat:

```
/image-gpt a red apple on a white table
```

The skill recognises the slash-command path, skips the model picker, and calls `generate_image` with `model: "gpt"`. For the full picker flow, just ask in plain language:

> Generate me an image of a fox reading a book.

The skill will prompt you to pick GPT / Gemini / Both before generating.

> **Marketplace install** *(coming soon).* A `Customize → Plugins → Add marketplace` flow against a GitHub repo is also supported by Claude Desktop. That path will land when the companion marketplace repo is published.

---

## Troubleshooting

### Server disconnects / "process exited early"

The MCP failed to start. Most likely causes:

1. **`node` isn't on the PATH Claude Desktop sees.** The `.mcpb` resolves Node from Claude Desktop's inherited `PATH`.
   - **macOS:** `nvm`-managed Node usually isn't on that `PATH`. Check `ls /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node 2>/dev/null` — if none exist, `brew install node` (or symlink your nvm node into `/usr/local/bin`).
   - **Windows:** `where.exe node` in a fresh PowerShell must return `node.exe`. If not, re-run the [nodejs.org](https://nodejs.org) installer with "Add to PATH" enabled.

   Then **fully quit Claude Desktop and reopen** — closing the window isn't enough.
2. **A previous bad install is still loaded.** Settings → Extensions → remove `image-gen` → reinstall.

For both cases, the MCP's wrapper writes a diagnostic trail to `image-gen-mcp-debug.log` in your home directory (`~/image-gen-mcp-debug.log` on macOS, `%USERPROFILE%\image-gen-mcp-debug.log` on Windows). If the file exists, open it — the boot line shows the Node version and `execPath` that actually ran. If it's missing, the wrapper never ran (most likely the PATH issue above).

### Inline image doesn't render in the reply

Claude Desktop currently renders MCP `type: "image"` content blocks inside the collapsed tool-call accordion, not in the assistant's chat reply. Click *"Loaded tools, used Image Gen integration"* to expand and you'll see the JPEG preview there. The full-resolution PNG is always on disk at the returned path.

### Where to find logs

**macOS:**
```bash
# Per-server stderr (and any startup errors)
tail -n 40 "$HOME/Library/Logs/Claude/mcp-server-Image gen.log"

# General MCP host log (rarely needed)
tail -n 40 "$HOME/Library/Logs/Claude/mcp.log"

# Our wrapper's diagnostic trail (Node version + dynamic-import outcome)
cat ~/image-gen-mcp-debug.log
```

**Windows (PowerShell):** logs land under Claude Desktop's per-user app-data directory (typically `%APPDATA%\Claude\` or `%LOCALAPPDATA%\Claude\`). The wrapper's diagnostic trail is at `%USERPROFILE%\image-gen-mcp-debug.log`:
```powershell
# Wrapper diagnostic
Get-Content "$env:USERPROFILE\image-gen-mcp-debug.log"

# Browse Claude Desktop's logs folder (path may vary by Claude Desktop version)
explorer "$env:APPDATA\Claude"
```

### "Tool not in inventory"

The MCP didn't register. Open Settings → Extensions and check that `image-gen` is still enabled. If yes, the spawn is failing — see the *Server disconnects* section above.

### API key changes not taking effect

The keys are read once, when the MCP launches. After clicking **Configure** and updating a key, the OS secret store updates immediately but the *running* MCP process doesn't reload its env on the fly. **Fully quit Claude Desktop and reopen** (Cmd-Q on macOS; Quit from the system-tray menu on Windows) to pick up the new value. A new chat alone isn't sufficient — the MCP is spawned at app launch.

### Moderation refusals from the provider

If the model refuses to generate the requested image (common for Gemini), Claude will surface the refusal verbatim. Rephrase the prompt — Gemini's content filters are stricter than OpenAI's.

### `gemini-pro` 503 errors

`gemini-3-pro-image-preview` runs on preview-tier capacity and 503s under load. The skill instructs Claude to fall back to `gemini-flash` automatically. If you pinned `gemini-pro` and saw a 503, just retry — or switch to `gemini-flash` for that prompt.

---

## Uninstall

| What | How |
|---|---|
| `.mcpb` MCP | Settings → Extensions → `image-gen` → Remove |
| Plugin | Customize → Plugins → `image-gen` → Uninstall |
| Cached PNGs | macOS: `rm -rf ~/Pictures/image-gen` &nbsp; • &nbsp; Windows: `Remove-Item -Recurse "$env:USERPROFILE\Pictures\image-gen"` |
| Diagnostic log | macOS: `rm ~/image-gen-mcp-debug.log` &nbsp; • &nbsp; Windows: `Remove-Item "$env:USERPROFILE\image-gen-mcp-debug.log"` |

Removing the `.mcpb` also drops the API keys from the OS secret store.
