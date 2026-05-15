# claude-image-gen

Open-source Claude plugin + stdio MCP server for generating and editing images via OpenAI `gpt-image-2` and Google Gemini (`gemini-3.1-flash-image-preview` / `gemini-3-pro-image-preview`). Bring your own OpenAI / Gemini API key(s).

## Layout

- `mcp/` — TypeScript stdio MCP. Canonical source. Built bundle lives at `mcp/dist/index.js` (gitignored).
- `plugin/` — Claude plugin: the `image-gen` skill + `/image-gpt` and `/image-gemini` slash commands. Does **not** bundle the MCP — pair it with one of the MCP install paths below.
- `mcpb/` — Build inputs for the `.mcpb` Desktop Extension. The published `.mcpb` (in `dist/`) is a Desktop-installable archive of the MCP plus sharp's native prebuild.

## Install

The plugin and the MCP are independent artifacts. Most people install just the MCP; add the plugin if you want the skill workflow and slash commands.

| Artifact | Surface | What it gives you |
|---|---|---|
| `image-gen.mcpb` | Claude Desktop (Install Extension) | MCP tools (`generate_image`, `check_image_job`) |
| `image-gen-plugin.zip` | Claude Desktop (upload plugin) or Claude Code (`--plugin-dir` / marketplace) | `image-gen` skill + `/image-gpt` + `/image-gemini` |
| `mcp/dist/index.js` | Manual `claude mcp add` (Claude Code) or `claude_desktop_config.json` (Desktop) | Same MCP, for advanced users who want full control |

### Setup guides

- **[Claude Desktop](docs/install/claude-desktop.md)** — install the `.mcpb` and (optionally) the plugin.
- **[Claude Code](docs/install/claude-code.md)** — `claude mcp add` for the MCP, optional plugin via `/plugin marketplace add Cleveland-RD/claude-image-gen`.
- **Manual MCP config** — coming next.

## License

MIT — see `LICENSE`.
