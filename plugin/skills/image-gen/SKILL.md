---
name: image-gen
description: >
  Generate and edit raster images via OpenAI gpt-image-2 or Google Gemini
  gemini-3-pro-image-preview (Nano Banana). Use when the user asks to
  "generate an image", "make a picture", "create an illustration", "draw",
  "render", "design a hero image / banner / poster / mockup / business
  card", or attaches an image and asks to edit it or use it as a reference
  (e.g. "use this logo in a marketing banner").
---

# Image Generation

This skill drives the `image-gen` MCP server, which calls either OpenAI's
`gpt-image-2` or Google's `gemini-3-pro-image-preview` and writes the
result to disk. The server returns the file path and a small inline
preview — Claude does NOT need to decode or save anything itself.

## Picking a model

**If you got here via a slash command (`/image-gpt` or `/image-gemini`),
the model is already chosen — skip this section and use it.**

**If the user invoked the skill plainly** (e.g. "generate an image of
…"), ask them which model to use before generating. Offer three options:

- **GPT** — OpenAI `gpt-image-2`. Editorial / brand photography, literal
  text rendering, natural-prose adherence.
- **Gemini** — Google Nano Banana family (defaults to `gemini-flash`).
  Multi-image composition, character / object consistency, fast iteration.
  If the user wants top quality and is OK with occasional 503 retries,
  use `gemini-pro` instead.
- **Both** — generate with both `gpt` and `gemini-flash` in parallel and
  present the two results side-by-side. Useful for comparing styles or
  picking the better output. Make the two `generate_image` calls in a
  single message so they run in parallel; polling rounds for each can
  also be issued back-to-back.

If the user already named a model in their request ("…with Gemini Pro",
"using gpt-image"), respect that. If they say "both" / "compare" /
"side-by-side," go straight to both without asking.

## When to use

- "Generate / create / make / draw / render an image of …"
- "Design a hero image / banner / business card / mockup / poster …"
- "Use this logo in a marketing banner"
- "Edit this image — change the background / remove the watermark / add a hat"
- "Iterate on the last image — same but darker / wider / in portrait"

## When NOT to use

- **Diagrams, flowcharts, system architecture** → produce SVG via the
  `frontend-design` skill, or a Mermaid block. Sharper, smaller, editable.
- **Data charts / graphs from a spreadsheet** → use the `xlsx` skill or write
  a chart widget.
- **Region-specific in-place edits requiring a mask** → not exposed here.
  Tell the user this isn't supported and suggest Photopea / Adobe Express.

## The tools

The `image-gen` MCP exposes two tools:

```
generate_image(
  prompt: string,
  model?: "gpt" | "gemini" | "gemini-flash" | "gemini-pro",   // default "gpt"
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "2048x2048"
       | "2048x1152" | "1152x2048" | "auto",
  style_hint?: string,
  output_dir?: string,             // default ~/Pictures/image-gen/
  input_image_paths?: string[],    // PREFERRED — local files on disk
  input_image_urls?: string[],     // http(s) URLs; server fetches the bytes
  mode?: "generate" | "edit"
)

check_image_job(job_id: string)
```

**Choosing a model.** Default is `gpt` (OpenAI gpt-image-2).

- **`gpt`** — OpenAI `gpt-image-2`. Strong for editorial / brand
  photography, literal text rendering inside the image, and prompts that
  benefit from natural-prose adherence.
- **`gemini`** — alias for `gemini-flash` (the sensible Gemini default).
- **`gemini-flash`** — Google `gemini-3.1-flash-image-preview` (Nano
  Banana 2). Fast, reliable capacity, strong multi-image composition and
  character consistency. The default Gemini choice.
- **`gemini-pro`** — Google `gemini-3-pro-image-preview` (Nano Banana
  Pro). Highest Gemini quality but preview-tier capacity — can 503 under
  load. Use only when quality matters more than reliability, and be ready
  to fall back to `gemini-flash` on overload errors.

If a user explicitly names a model ("use Gemini Pro", "try gpt-image"),
respect that. Otherwise default to `gpt`, or — when the skill (not a
command) is invoked — ask the user which one.

`generate_image` starts a job. It waits up to ~45 seconds for the
provider to finish. If the image is ready in that window, you get the
result in one round-trip. **For complex prompts that take longer than
~45 seconds, it returns `{status: "pending", job_id, hint}` — and you
must poll with `check_image_job(job_id)` until you get the finished
result.** This is the workaround for Claude Desktop's 60-second
tool-call timeout, which it enforces regardless of progress
notifications.

A finished response includes two content blocks:
1. A JSON metadata block with `status: "done"`, the local `path`,
   `bytes`, `model`, `prompt`, `size`, and `elapsed_seconds`.
2. An inline JPEG thumbnail (~1280px) so the chat renders a preview.

The PNG is stored on the user's local disk (defaults to
`~/Pictures/image-gen/`). Claude does NOT base64-decode anything.

**Never paste reference image bytes through the LLM context.** LLMs
corrupt long base64 strings unpredictably — dropping characters,
duplicating patterns — and OpenAI/Gemini will then reject the input
with "Invalid image file." Pass file paths in `input_image_paths` and
let the server read the bytes directly.

## Clarifying the brief before generating

Image generation is slow (30–180s) and not free. A misread prompt
wastes the user's time and a real API call. **Before calling
`generate_image`, scan the brief for material ambiguity and ask
clarifying questions via `AskUserQuestion` when something would change
the output.** Don't assume — but don't over-ask either.

This applies to plain skill invocations *and* to `/image-gpt` /
`/image-gemini`. The slash commands skip the model-choice question (the
user already picked), not every clarification.

### Ask when:

- **Aspect ratio is unclear and not implied.** "Picture of a dog" could
  be 1:1, 3:2, or 2:3. If the user said "hero image", "banner", "social
  post", "business card", or "story", the size is already implied —
  skip. Otherwise ask.
- **Style register is unclear.** "An image of a cat" could be a
  photograph, a watercolor, a flat illustration, or a 3D render. Pick
  is material; ask.
- **Multiple reference images are attached and roles aren't clear.**
  Ask which is the primary reference vs background vs ignore.
- **The image must contain specific text** (e.g. "a poster that says…")
  and you don't have the exact words in quotes. Ask for the literal
  text.
- **An image is attached and the user said "use this" without saying
  whether to edit or just reference.** Ask whether they want
  `mode="edit"` (modify this image) or `mode="generate"` (new image
  using this as reference).

### Don't ask when:

- The user gave a complete brief ("make a square watercolor of a fox
  reading a book at sunset"). They've already chosen. Just generate.
- The user said "surprise me", "I trust your judgment", "you pick".
  Make tasteful defaults.
- The ambiguity is small enough that one good first attempt is faster
  than a back-and-forth (e.g. "a coffee cup on a desk" — pick a style;
  iteration is cheap).
- The user is **iterating** ("same but warmer light", "smaller logo").
  They've committed to the prior direction; don't second-guess.

### How to ask

Use `AskUserQuestion` with 1–4 focused questions in one call. Each
question should have 2–4 mutually-exclusive options that map directly
to a prompt-construction decision. Example:

```
AskUserQuestion({
  questions: [
    {
      question: "What aspect ratio?",
      header: "Size",
      options: [
        { label: "Square (1:1)", description: "Social post, profile, icon" },
        { label: "Landscape (3:2)", description: "Hero image, banner, wide social" },
        { label: "Portrait (2:3)", description: "Story, vertical poster" }
      ]
    },
    {
      question: "What style?",
      header: "Style",
      options: [
        { label: "Editorial photo", description: "Realistic, magazine-quality" },
        { label: "Watercolor illustration", description: "Soft, hand-painted feel" },
        { label: "Flat vector", description: "Clean, modern, illustrated" }
      ]
    }
  ]
})
```

Skip purely subjective questions ("what colors do you like?") —
they slow the user down without making the prompt better. Only ask when
the answer materially changes the prompt or the size/mode parameters.

## The standard workflow

### 1. The MCP runs locally

The `image-gen` MCP runs as a stdio child process spawned by Claude
Code / Claude Desktop on the user's machine. It can read any file the
user can read, and it writes the finished PNG straight to their local
disk (default: `~/Pictures/image-gen/`). Override with `output_dir` if
the user names a different folder.

### 2. Gather any reference / edit images

Whenever the user attaches an image, names a local file, or refers to a
previous result that lives on disk:

- **Local file**: pass the absolute path in `input_image_paths`. The
  server reads the bytes itself. Tilde (`~`) is expanded.
- **URL on the open web**: pass the URL in `input_image_urls`. The
  server fetches the bytes directly. Use this when the user gives you
  a link to a product page image or a public CDN URL.
- **Previous generated image**: pass the prior result's `path`
  (returned in the metadata block) back into `input_image_paths`. No
  re-upload, no copying — same disk, same path.

If the user pastes a screenshot path and the server returns
`permission denied`, macOS is protecting that folder (common for
`/var/folders/.../TemporaryItems/`). Ask the user to save the file to
Desktop or another stable folder and re-share the path.

**Never embed base64 image bytes through Claude's context** — LLMs
corrupt long opaque strings and providers reject the result. The MCP
intentionally has no base64 parameter. If the file isn't on disk yet,
ask the user to save it first.

### 3. Decide mode

- `mode="generate"` (default) — make a new image. Inputs, if any, are
  references (logo, style, character to keep consistent).
- `mode="edit"` — modify the input image(s) per the prompt; requires at
  least one input.

### 4. Decide size

Default `1024x1024`. Use `1536x1024` for landscape (hero images, banners,
business cards shown flat). `1024x1536` for portrait. For higher-res
work the API also accepts `2048x2048`, `2048x1152`, `1152x2048`, or `auto`
(let the model choose).

### 5. Call generate_image

Before this call, you should already have resolved any material
ambiguity from the **"Clarifying the brief"** section above. If you
haven't, stop and ask now — once the API call is in flight, the user is
waiting 30–180s for a result they may not want.

The call returns in one of two shapes:

- **Done in one shot** (`status: "done"`): you get metadata + the inline
  preview. The PNG is on disk at `path`. Most generations finish here.
- **Pending** (`status: "pending"`, plus `job_id`): the provider is
  still working. Call `check_image_job(job_id)` to wait for completion.
  If that also returns `pending`, call it again — the job typically
  wraps up within one or two more polls. Each `check_image_job` call
  waits up to ~45 seconds, so you don't need a sleep in between.

### 6. Present the result to the user

The MCP returns the image two ways: a JSON block with the local `path`,
and a `type: "image"` content block carrying an inline JPEG thumbnail.
Most chat UIs render the inline image block automatically — that is the
image the user sees.

**In your reply, mention the local file path** so the user can open the
full-resolution PNG in Finder / their image viewer. Example:

> Here's your hero image — clean, premium, very on-brand. The PNG is
> at `~/Pictures/image-gen/editorial-hero-7a3f.png`. Want any tweaks?

**Do NOT attempt a markdown image embed pointing at the local path.**
Chat UIs do not render `file://` URLs, so `![alt](file:///…)` shows
nothing. The inline image content block is the rendered preview; the
file path is the pointer for the user to open the full-resolution PNG.

**Do NOT paste base64 image data into chat.** It's enormous, breaks the
conversation history, and the inline content block already handles
rendering.

### 7. If the user asks for changes, iterate

The fastest iteration path: take the previous result's `path` (returned
in the metadata block) and pass it straight back in
`input_image_paths=[<previous-path>]`, `mode="edit"`, with a prompt that
describes only what changes. No re-upload, no copying — the server
reads the same file it wrote a moment ago.

## Prompt shaping

gpt-image-2 follows instructions literally. Use natural prose, not tag lists.

- **Photoreal**: include camera/lighting language. *"35mm, soft directional
  daylight from upper-left, shallow depth of field."*
- **Editorial / brand work**: name the register. *"Editorial product photo,
  restrained, top-down flatlay, Faber & Faber aesthetic."*
- **Text in images**: put the exact words in quotes. The model renders text
  reliably at 1024+ sizes.
- **Logo faithfulness**: when a logo is attached as a reference, add
  *"reproduce the supplied logo exactly — do not redraw or reinterpret."*

Keep the prompt small. A 60-word prompt usually beats a 300-word prompt —
the model fills in tasteful defaults when you don't smother it.

## When a user provides a URL to a brand/product

If the user mentions a website (e.g. "for reformatword.com") and the visual
should match that brand, **fetch the URL first** via WebFetch to read the
product positioning, palette cues and tone. Then write a short, grounded
prompt.

## Failure handling

- **Tool not in inventory** → MCP didn't start. In Claude Code, check
  `/plugin` → Errors. In Claude Desktop, check `~/Library/Logs/Claude/`.
  In a manual MCP config, check that the `image-gen` entry in
  `claude_desktop_config.json` points at a node binary on `PATH` and a
  valid `index.js`.
- **"OPENAI_API_KEY env var is not set"** → the user needs to make the
  key available to the MCP. For the `.mcpb` Desktop Extension, that's
  the "OpenAI API Key" field in the extension's settings UI. For the
  plugin install, export the key in the shell the user launches Claude
  Code from (or in the launching shell for Claude Desktop). For a
  manual MCP config, add it to the `env` block of the `image-gen` entry
  in `claude_desktop_config.json`.
- **"GEMINI_API_KEY env var is not set"** → same as above for the
  Gemini key.
- **OpenAI auth error** → the key is invalid or revoked.
- **"organization verification required"** → the user's OpenAI org isn't
  verified for image models.
- **Content moderation refusal** → relay the refusal verbatim and suggest a
  rephrasing.
- **Gemini Pro 503** → preview-tier capacity. Retry once, then fall
  back to `gemini-flash` with the same prompt.

## Examples

> **User:** "Make me an illustration of a fox reading a book, watercolor."
>
> Call `generate_image(prompt="a small red fox reading a leather-bound book",
> style_hint="watercolor")`. The PNG lands at the returned `path`
> (default `~/Pictures/image-gen/`). Mention the path in the reply; the
> inline image block renders the preview.

> **User:** Drops `logo.png` into chat, says "Hero image for our homepage."
>
> Resolve the absolute path of the attached logo, then call
> `generate_image(prompt="editorial homepage hero, cream desk flatlay,
> contract on cream paper, navy ink, soft daylight",
> input_image_paths=["<absolute path to logo>"], size="1536x1024",
> mode="generate")`. Reply with the saved path.

> **User:** "Same image but warmer light, smaller logo."
>
> Reuse the previous result's `path`:
> `generate_image(prompt="same composition, warmer afternoon light, smaller
> logo placement", input_image_paths=["<previous path>"], mode="edit")`.

> **User:** "Draw me a flowchart of our intake process."
>
> Stop. Not this skill. Reply: "For a flowchart I'd use a Mermaid diagram or
> an SVG — sharper and editable. Want me to do that instead?"
