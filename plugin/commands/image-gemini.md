---
description: Generate an image with Google Gemini (Nano Banana) — skip the model-choice prompt.
---

The user has chosen Gemini as the image model. Follow the `image-gen`
skill end-to-end with `model: "gemini"` (alias for `gemini-flash`) on
every call to `generate_image`. If the user explicitly mentioned "pro"
or "Nano Banana Pro" in the original ask, use `model: "gemini-pro"`
instead — but be ready to fall back to `gemini-flash` on a 503.

**Do not ask the user which model to use** — they've already chosen by
invoking `/image-gemini`.

The user's request: $ARGUMENTS
