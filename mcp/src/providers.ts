/**
 * Image-generation provider calls. Pure logic — no transport, no storage,
 * no MCP. Shared by the stdio and HTTP entrypoints.
 */
import OpenAI, { toFile } from "openai";
import { GoogleGenAI } from "@google/genai";

export type ModelName = "gpt" | "gemini" | "gemini-pro" | "gemini-flash";

/**
 * `gemini` is an alias for `gemini-flash` — the safe default. The 3.1-flash
 * preview sits on a more provisioned capacity pool than the Pro preview,
 * which 503s under load.
 */
export const MODEL_IDS: Record<ModelName, string> = {
  gpt: "gpt-image-2",
  gemini: "gemini-3.1-flash-image-preview",
  "gemini-flash": "gemini-3.1-flash-image-preview",
  "gemini-pro": "gemini-3-pro-image-preview",
};

export function isGeminiModel(model: ModelName): boolean {
  return model !== "gpt";
}

function openaiClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY env var is not set. Add it to the MCP entry in " +
        "claude_desktop_config.json (for stdio) or to Vercel project " +
        "environment variables (for HTTP)."
    );
  }
  return new OpenAI({ apiKey: key });
}

function geminiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY env var is not set. Add it to the MCP entry in " +
        "claude_desktop_config.json (for stdio) or to Vercel project " +
        "environment variables (for HTTP)."
    );
  }
  return new GoogleGenAI({ apiKey: key });
}

/**
 * Map the shared pixel-size enum onto Gemini's aspectRatio + imageSize
 * config. Gemini supports aspect ratios ("1:1", "16:9", …) and image sizes
 * ("512", "1K", "2K", "4K"), not literal WxH dimensions.
 */
function geminiSizeFromEnum(
  size: string
): { aspectRatio: string; imageSize: string } | undefined {
  switch (size) {
    case "1024x1024":
      return { aspectRatio: "1:1", imageSize: "1K" };
    case "1536x1024":
      return { aspectRatio: "3:2", imageSize: "1K" };
    case "1024x1536":
      return { aspectRatio: "2:3", imageSize: "1K" };
    case "2048x2048":
      return { aspectRatio: "1:1", imageSize: "2K" };
    case "2048x1152":
      return { aspectRatio: "16:9", imageSize: "2K" };
    case "1152x2048":
      return { aspectRatio: "9:16", imageSize: "2K" };
    case "auto":
      return undefined;
    default:
      return undefined;
  }
}

export type InputBlob = { buf: Buffer; mime: string; label: string };

export async function callOpenAI(params: {
  fullPrompt: string;
  size: string;
  inputBlobs: InputBlob[];
}): Promise<Buffer> {
  const { fullPrompt, size, inputBlobs } = params;
  const client = openaiClient();
  let resultB64: string | undefined;

  if (inputBlobs.length > 0) {
    const images = await Promise.all(
      inputBlobs.map((b) =>
        toFile(b.buf, `${b.label}.${b.mime.split("/")[1]}`, { type: b.mime })
      )
    );
    const r = await client.images.edit({
      model: MODEL_IDS.gpt,
      image: images.length === 1 ? images[0] : images,
      prompt: fullPrompt,
      size: (size === "auto" ? undefined : size) as any,
    });
    resultB64 = r.data?.[0]?.b64_json;
  } else {
    const r = await client.images.generate({
      model: MODEL_IDS.gpt,
      prompt: fullPrompt,
      size: (size === "auto" ? undefined : size) as any,
    });
    resultB64 = r.data?.[0]?.b64_json;
  }

  if (!resultB64) {
    throw new Error("OpenAI returned no image data");
  }
  return Buffer.from(resultB64, "base64");
}

export async function callGemini(params: {
  fullPrompt: string;
  size: string;
  model: ModelName;
  inputBlobs: InputBlob[];
}): Promise<Buffer> {
  const { fullPrompt, size, model, inputBlobs } = params;
  const client = geminiClient();

  const contents: any[] = [{ text: fullPrompt }];
  for (const b of inputBlobs) {
    contents.push({
      inlineData: { mimeType: b.mime, data: b.buf.toString("base64") },
    });
  }

  const sizeCfg = geminiSizeFromEnum(size);
  // Image models require an explicit `responseModalities: ["IMAGE"]`. Without
  // it, the model returns text-only and we get zero inlineData parts back.
  const config: any = { responseModalities: ["IMAGE"] };
  if (sizeCfg) {
    config.responseFormat = {
      image: {
        aspectRatio: sizeCfg.aspectRatio,
        imageSize: sizeCfg.imageSize,
      },
    };
  }

  const response: any = await client.models.generateContent({
    model: MODEL_IDS[model],
    contents,
    config,
  });

  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }

  // Surface the text response (often a refusal) and finishReason so the user
  // sees what Gemini actually said instead of a generic "no image" error.
  const finishReason = response?.candidates?.[0]?.finishReason;
  const textParts = parts
    .map((p: any) => p?.text)
    .filter(Boolean)
    .join(" ")
    .slice(0, 400);
  throw new Error(
    `Gemini returned no image data` +
      (finishReason ? ` (finishReason=${finishReason})` : "") +
      (textParts ? `: "${textParts}"` : "") +
      ". This is usually a moderation refusal — try rephrasing the prompt."
  );
}

export async function callImageProvider(params: {
  fullPrompt: string;
  size: string;
  model: ModelName;
  inputBlobs: InputBlob[];
}): Promise<Buffer> {
  return isGeminiModel(params.model)
    ? callGemini(params)
    : callOpenAI({
        fullPrompt: params.fullPrompt,
        size: params.size,
        inputBlobs: params.inputBlobs,
      });
}
