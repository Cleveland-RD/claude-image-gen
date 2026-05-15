/**
 * Helpers shared by both the stdio and HTTP MCP entrypoints.
 *
 * Pure functions only — no I/O, no env reads, no stateful objects.
 */
import { randomBytes } from "node:crypto";

// Sharp is loaded lazily so a `dlopen` failure (e.g. macOS Library Validation
// rejecting our prebuilt sharp.node when the .mcpb runs inside Claude.app's
// Electron UtilityProcess — see modelcontextprotocol/mcpb#229) becomes a
// per-thumbnail soft-failure caught by index.ts instead of crashing the MCP
// at module load. The .mcpb manifest pairs this with a darwin
// platform_overrides that escapes UtilityProcess so sharp normally still
// loads; this fallback covers the case where the escape doesn't apply.
let _sharp: any | null = null;
async function getSharp(): Promise<any> {
  if (_sharp) return _sharp;
  const mod: any = await import("sharp");
  _sharp = mod.default ?? mod;
  return _sharp;
}

export const VALID_SIZES = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "1152x2048",
  "auto",
] as const;
export type ValidSize = (typeof VALID_SIZES)[number];

export const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export function sniffMime(blob: Buffer): string | null {
  if (
    blob.length >= 8 &&
    blob[0] === 0x89 &&
    blob[1] === 0x50 &&
    blob[2] === 0x4e &&
    blob[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    blob.length >= 3 &&
    blob[0] === 0xff &&
    blob[1] === 0xd8 &&
    blob[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    blob.length >= 12 &&
    blob.slice(0, 4).toString("ascii") === "RIFF" &&
    blob.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function slug(text: string, maxLen = 40): string {
  const s = text
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return s.slice(0, maxLen) || "image";
}

export function randomSuffix(): string {
  return randomBytes(4).toString("hex");
}

export function jobId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Encode the generated PNG as a JPEG for inline delivery over MCP.
 * MCP-aware chat UIs render `type: "image"` content blocks inline,
 * so this is *the* image the user sees — not a preview.
 *
 * Sized for "the image looks good in chat" rather than "the smallest
 * possible payload": 1280px on the long edge at q=88 is typically
 * 200–400 KB, well within MCP content limits, and visually identical to
 * the source for any chat-sized viewport. The full-resolution PNG is
 * still in Blob at the returned `url` for anyone who wants pixel-perfect.
 */
export async function makeThumbnail(png: Buffer): Promise<string> {
  const sharp = await getSharp();
  const jpg = await sharp(png)
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return jpg.toString("base64");
}
