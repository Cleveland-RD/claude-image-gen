/**
 * image-gen MCP — stdio entrypoint.
 *
 * Spawned by Claude Code / Claude Desktop / a manual MCP config as a child
 * process. Speaks MCP over stdin/stdout. Jobs live in memory; PNGs are
 * written to disk; an inline JPEG thumbnail is returned alongside the file
 * path so chat UIs render the result without a second round-trip.
 */

// Surface any otherwise-silent failures BEFORE we touch the SDK. The banner
// in mcp/package.json already wrote a `[image-gen] boot node=…` line; these
// handlers turn any later crash into a stderr message instead of a silent
// exit, so Claude Desktop's mcp-server-Image gen.log shows what happened.
process.on("uncaughtException", (err) => {
  console.error("[image-gen] uncaughtException:", err && (err as any).stack ? (err as any).stack : err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("[image-gen] unhandledRejection:", err && (err as any).stack ? (err as any).stack : err);
  process.exit(1);
});

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve as pathResolve } from "node:path";
import { homedir } from "node:os";

import {
  ALLOWED_MIMES,
  MAX_INPUT_BYTES,
  VALID_SIZES,
  jobId as genJobId,
  makeThumbnail,
  randomSuffix,
  slug,
  sniffMime,
} from "./util.js";
import {
  callImageProvider,
  InputBlob,
  MODEL_IDS,
  ModelName,
} from "./providers.js";

const DEFAULT_OUTPUT_DIR = join(homedir(), "Pictures", "image-gen");
const WAIT_WINDOW_MS = 45 * 1000;
const JOB_TTL_MS = 60 * 60 * 1000;

// ─── in-memory job tracking ────────────────────────────────────────────────

type JobStatus = "pending" | "done" | "error";
type JobResult = {
  path: string;
  bytes: number;
  thumbnailB64: string | null;
  elapsedSeconds: number;
};
type ImageJob = {
  id: string;
  startedAt: number;
  prompt: string;
  size: string;
  model: ModelName;
  status: JobStatus;
  result?: JobResult;
  error?: string;
  promise: Promise<void>;
};

const imageJobs = new Map<string, ImageJob>();

function reapOldJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of imageJobs) {
    if (job.status !== "pending" && job.startedAt < cutoff) {
      imageJobs.delete(id);
    }
  }
}

async function waitForJob(job: ImageJob, maxMs: number): Promise<void> {
  await Promise.race([
    job.promise.catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, maxMs)),
  ]);
}

function formatJobAsContent(job: ImageJob): { content: any[]; isError?: boolean } {
  if (job.status === "done" && job.result) {
    const meta = {
      status: "done",
      job_id: job.id,
      model: MODEL_IDS[job.model],
      prompt: job.prompt,
      size: job.size,
      elapsed_seconds: Math.round(job.result.elapsedSeconds * 10) / 10,
      path: job.result.path,
      bytes: job.result.bytes,
      display_hint:
        `The full-resolution PNG is at ${job.result.path}. The inline image ` +
        `content block below this JSON is a ~1280px JPEG thumbnail — most ` +
        `chat UIs render it inline. In your response, mention the local ` +
        `file path so the user can open it directly; do NOT paste a base64 ` +
        `string or attempt a markdown image embed pointing at the local ` +
        `path (chat UIs do not render file:// URLs).`,
    };
    const content: any[] = [
      { type: "text" as const, text: JSON.stringify(meta) },
    ];
    if (job.result.thumbnailB64) {
      content.push({
        type: "image" as const,
        data: job.result.thumbnailB64,
        mimeType: "image/jpeg",
      });
    }
    return { content };
  }
  if (job.status === "error") {
    return {
      content: [
        {
          type: "text" as const,
          text: `${MODEL_IDS[job.model]} request failed: ${job.error}`,
        },
      ],
      isError: true,
    };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          status: "pending",
          job_id: job.id,
          elapsed_seconds: Math.round((Date.now() - job.startedAt) / 100) / 10,
          hint:
            `Provider is still generating. Call check_image_job with ` +
            `job_id="${job.id}" to retrieve the result. Most generations ` +
            `complete within 30-90s; complex prompts can take up to 2 ` +
            `minutes.`,
        }),
      },
    ],
  };
}

async function runImageJob(
  job: ImageJob,
  params: {
    fullPrompt: string;
    size: string;
    model: ModelName;
    inputBlobs: InputBlob[];
    outputDir: string;
  }
): Promise<void> {
  const { fullPrompt, size, model, inputBlobs, outputDir } = params;
  try {
    const fullBuf = await callImageProvider({
      fullPrompt,
      size,
      model,
      inputBlobs,
    });

    await mkdir(outputDir, { recursive: true });
    const fname = `${slug(job.prompt)}-${randomSuffix()}.png`;
    const fpath = join(outputDir, fname);
    await writeFile(fpath, fullBuf);

    let thumbnailB64: string | null = null;
    try {
      thumbnailB64 = await makeThumbnail(fullBuf);
    } catch (err: any) {
      process.stderr.write(`thumbnail failed: ${err?.message ?? err}\n`);
    }

    job.result = {
      path: fpath,
      bytes: fullBuf.length,
      thumbnailB64,
      elapsedSeconds: (Date.now() - job.startedAt) / 1000,
    };
    job.status = "done";
    process.stderr.write(
      `job ${job.id} done: wrote ${fullBuf.length} bytes to ${fpath} ` +
        `in ${job.result.elapsedSeconds.toFixed(1)}s\n`
    );
  } catch (err: any) {
    job.error = err?.message ?? String(err);
    job.status = "error";
    process.stderr.write(`job ${job.id} failed: ${job.error}\n`);
  }
}

// ─── input decoding ────────────────────────────────────────────────────────

async function readInputPaths(paths: string[] | undefined): Promise<InputBlob[]> {
  const blobs: InputBlob[] = [];
  for (let i = 0; i < (paths?.length ?? 0); i++) {
    const rawPath = paths![i];
    const resolved = pathResolve(rawPath.replace(/^~/, homedir()));
    let buf: Buffer;
    try {
      const st = await stat(resolved);
      if (!st.isFile()) {
        throw new Error(`input_image_paths[${i}]: ${resolved} is not a file`);
      }
      if (st.size > MAX_INPUT_BYTES) {
        throw new Error(
          `input_image_paths[${i}]: ${resolved} exceeds ${
            MAX_INPUT_BYTES / 1024 / 1024
          } MB`
        );
      }
      buf = await readFile(resolved);
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        throw new Error(`input_image_paths[${i}]: file not found at ${resolved}`);
      }
      if (err?.code === "EACCES" || err?.code === "EPERM") {
        throw new Error(
          `input_image_paths[${i}]: permission denied reading ${resolved}. ` +
            `macOS may be protecting this folder. Ask the user to save ` +
            `the image to a stable location first.`
        );
      }
      throw err;
    }
    const mime = sniffMime(buf);
    if (!mime || !ALLOWED_MIMES.has(mime)) {
      throw new Error(
        `input_image_paths[${i}]: ${resolved} is not PNG/JPEG/WEBP ` +
          `(got ${extname(resolved) || "unknown"})`
      );
    }
    blobs.push({ buf, mime, label: basename(resolved) });
  }
  return blobs;
}

async function fetchInputUrls(urls: string[] | undefined): Promise<InputBlob[]> {
  const blobs: InputBlob[] = [];
  for (let i = 0; i < (urls?.length ?? 0); i++) {
    const u = urls![i];
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error(`input_image_urls[${i}]: not a valid URL`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`input_image_urls[${i}]: only http(s) URLs are supported`);
    }
    let res: Response;
    try {
      res = await fetch(u);
    } catch (err: any) {
      throw new Error(
        `input_image_urls[${i}]: fetch failed: ${err?.message ?? err}`
      );
    }
    if (!res.ok) {
      throw new Error(
        `input_image_urls[${i}]: fetch returned HTTP ${res.status}`
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      throw new Error(`input_image_urls[${i}]: empty body`);
    }
    if (buf.length > MAX_INPUT_BYTES) {
      throw new Error(
        `input_image_urls[${i}]: ${buf.length} bytes exceeds ${
          MAX_INPUT_BYTES / 1024 / 1024
        } MB`
      );
    }
    const mime = sniffMime(buf);
    if (!mime || !ALLOWED_MIMES.has(mime)) {
      throw new Error(
        `input_image_urls[${i}]: unrecognized format (need PNG/JPEG/WEBP)`
      );
    }
    const name = decodeURIComponent(parsed.pathname.split("/").pop() || `url-${i}`);
    blobs.push({ buf, mime, label: name });
  }
  return blobs;
}

// ─── MCP server ────────────────────────────────────────────────────────────

const server = new McpServer({ name: "image-gen", version: "0.1.0" });

server.registerTool(
  "generate_image",
  {
    description:
      "Generate or edit an image. Writes the PNG to disk and returns the " +
      "file path AND an inline JPEG thumbnail content block.\n\n" +
      "Models: 'gpt' (OpenAI gpt-image-2; default; best for editorial / " +
      "brand photography and literal text rendering); 'gemini' / " +
      "'gemini-flash' (gemini-3.1-flash-image-preview, a.k.a. Nano Banana; " +
      "good multi-image composition, character consistency, fast); " +
      "'gemini-pro' (gemini-3-pro-image-preview, highest Gemini quality " +
      "but preview-tier capacity — can 503 under load).\n\n" +
      "Reference images: pass local file paths in `input_image_paths` " +
      "(preferred) or http(s) URLs in `input_image_urls`. Never embed " +
      "base64 — LLMs corrupt long opaque strings and providers reject " +
      "them.\n\n" +
      "Returns the finished image in one round-trip when the provider " +
      "completes within ~45s. Otherwise returns " +
      "{status: 'pending', job_id} and you poll via check_image_job — " +
      "do NOT abandon the job, the result is on its way. Most generations " +
      "finish in 30-90s; complex prompts can take up to 2 minutes.\n\n" +
      "Prompt tips: use natural prose (not tag lists); put exact in-image " +
      "text in quotes; if a logo is supplied, instruct 'reproduce the " +
      "supplied logo exactly — do not redraw or reinterpret'; keep " +
      "prompts under ~60 words for best results.",
    inputSchema: {
      prompt: z
        .string()
        .min(1)
        .describe("Plain-language description of the image or edit."),
      model: z
        .enum(["gpt", "gemini", "gemini-flash", "gemini-pro"])
        .default("gpt")
        .describe(
          "Image model. 'gpt' = OpenAI gpt-image-2 (default). " +
            "'gemini'/'gemini-flash' = gemini-3.1-flash-image-preview. " +
            "'gemini-pro' = gemini-3-pro-image-preview (can 503)."
        ),
      size: z
        .enum(VALID_SIZES)
        .default("1024x1024")
        .describe(
          "1024x1024 (square), 1536x1024 (landscape), 1024x1536 " +
            "(portrait), 2048x2048 (2K square), 2048x1152, 1152x2048, " +
            "or 'auto'."
        ),
      style_hint: z
        .string()
        .optional()
        .describe(
          "Optional style hint appended to the prompt as 'Style: <hint>'."
        ),
      output_dir: z
        .string()
        .optional()
        .describe(
          "Absolute path to the directory where the PNG should be written. " +
            "Defaults to ~/Pictures/image-gen/. Tilde (~) is expanded."
        ),
      input_image_paths: z
        .array(z.string())
        .optional()
        .describe(
          "Absolute file paths to reference / edit images on disk " +
            "(PNG/JPEG/WEBP, max 20 MB each). Preferred way to attach " +
            "references."
        ),
      input_image_urls: z
        .array(z.string())
        .optional()
        .describe(
          "Optional http(s) URLs to reference / edit images. Server " +
            "fetches the bytes directly. Max 20 MB each."
        ),
      mode: z
        .enum(["generate", "edit"])
        .default("generate")
        .describe(
          "'generate' (default): treat inputs as references. 'edit': " +
            "modify the inputs per the prompt; requires at least one input."
        ),
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (args) => {
    try {
      const prompt = args.prompt;
      const model = (args.model ?? "gpt") as ModelName;
      const size = (args.size ?? "1024x1024") as string;
      const fullPrompt = args.style_hint
        ? `${prompt}. Style: ${args.style_hint}.`
        : prompt;

      const pathBlobs = await readInputPaths(args.input_image_paths);
      const urlBlobs = await fetchInputUrls(args.input_image_urls);
      const inputBlobs = [...pathBlobs, ...urlBlobs];

      if ((args.mode ?? "generate") === "edit" && inputBlobs.length === 0) {
        throw new Error(
          "mode='edit' requires at least one input_image_paths or " +
            "input_image_urls entry"
        );
      }

      const dir = args.output_dir
        ? pathResolve(args.output_dir.replace(/^~/, homedir()))
        : DEFAULT_OUTPUT_DIR;

      reapOldJobs();
      const id = genJobId();
      const job: ImageJob = {
        id,
        startedAt: Date.now(),
        prompt,
        size,
        model,
        status: "pending",
        promise: undefined as any,
      };
      job.promise = runImageJob(job, {
        fullPrompt,
        size,
        model,
        inputBlobs,
        outputDir: dir,
      });
      imageJobs.set(id, job);

      process.stderr.write(
        `generate_image: job=${id} model=${model} mode=${args.mode ?? "generate"} ` +
          `size=${size} inputs=${inputBlobs.length} prompt="${prompt.slice(0, 80)}"\n`
      );

      await waitForJob(job, WAIT_WINDOW_MS);
      return formatJobAsContent(job);
    } catch (error: any) {
      return {
        content: [
          { type: "text", text: `Error generating image: ${error.message ?? error}` },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "check_image_job",
  {
    description:
      "Poll a previously-started image generation job. Returns the " +
      "finished image (file path + inline thumbnail) once the provider " +
      "completes, or a 'pending' status if still working. Call this when " +
      "generate_image returned status='pending' with a job_id. Each call " +
      "waits up to ~45s for completion before returning. If still pending " +
      "after this call, call it again — generations finish within 1-2 " +
      "more polls in nearly all cases.",
    inputSchema: {
      job_id: z
        .string()
        .min(1)
        .describe("The job_id returned by a previous generate_image call."),
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ job_id }) => {
    try {
      const job = imageJobs.get(job_id);
      if (!job) {
        throw new Error(
          `Unknown job_id: ${job_id}. The job may have expired (1 hour TTL) ` +
            `or never existed. Re-call generate_image to start fresh.`
        );
      }
      await waitForJob(job, WAIT_WINDOW_MS);
      return formatJobAsContent(job);
    } catch (error: any) {
      return {
        content: [
          { type: "text", text: `Error checking job: ${error.message ?? error}` },
        ],
        isError: true,
      };
    }
  }
);

// ─── entrypoint ────────────────────────────────────────────────────────────

// Async IIFE rather than top-level await: any rejection here goes through our
// explicit catch and `process.exit(1)`, so the log shows the failure instead
// of the bundled Node silently exiting on an unhandled top-level rejection.
(async () => {
  try {
    console.error("[image-gen] connecting transport");
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[image-gen] connected via stdio");
  } catch (err: any) {
    console.error(
      "[image-gen] fatal during connect:",
      err && err.stack ? err.stack : err
    );
    process.exit(1);
  }
})();
