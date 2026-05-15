// CommonJS entry that runs BEFORE the ESM bundle's static imports.
//
// We use file-write diagnostics (NOT just stderr) because Claude Desktop's
// bundled-Node wrapper does not appear to surface stderr from this process
// in mcp-server-Image gen.log — every observation so far shows zero output
// even when the entrypoint definitely ran. Writing synchronously to a file
// under os.tmpdir() gives us a channel that doesn't depend on stderr piping.
//
// Pattern copied from anthropics/mcpb/examples/file-system-node/server/index.js,
// with file-write diagnostics added.
//
// This file is committed; the mcpb build script copies it into mcpb/server/.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const url = require("node:url");

// Write to a predictable path in $HOME so it's findable regardless of
// whatever $TMPDIR Claude Desktop's bundled Node inherits (could be
// app-sandboxed and unreachable). $HOME stays the user's home dir.
const LOG_PATH = path.join(os.homedir(), "image-gen-mcp-debug.log");

function logLine(line) {
  const stamped = new Date().toISOString() + " " + line + "\n";
  try {
    fs.appendFileSync(LOG_PATH, stamped);
  } catch (_) {
    // best-effort
  }
  try {
    process.stderr.write("[image-gen] " + line + "\n");
  } catch (_) {
    // best-effort
  }
}

logLine(
  "boot pid=" + process.pid +
    " node=" + process.version +
    " platform=" + process.platform +
    " arch=" + process.arch +
    " execPath=" + process.execPath
);
logLine(
  "cwd=" + process.cwd() +
    " argv=" + JSON.stringify(process.argv) +
    " env.OPENAI_API_KEY=" + (process.env.OPENAI_API_KEY ? "set" : "unset") +
    " env.GEMINI_API_KEY=" + (process.env.GEMINI_API_KEY ? "set" : "unset")
);

process.on("uncaughtException", function (err) {
  logLine("uncaughtException: " + (err && err.stack ? err.stack : err));
  process.exit(1);
});
process.on("unhandledRejection", function (err) {
  logLine("unhandledRejection: " + (err && err.stack ? err.stack : err));
  process.exit(1);
});
process.on("exit", function (code) {
  logLine("exit code=" + code);
});

const targetUrl = url.pathToFileURL(path.join(__dirname, "index.js")).href;
logLine("about to dynamic-import " + targetUrl);

import(targetUrl).then(
  function () {
    logLine("dynamic import resolved (bundle module evaluated)");
  },
  function (err) {
    logLine("fatal during dynamic import: " + (err && err.stack ? err.stack : err));
    process.exit(1);
  }
);
