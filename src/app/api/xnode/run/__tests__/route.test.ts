/**
 * Tests for /api/xnode/run — the dispatch endpoint for the 72 X-Node model
 * types reverse-engineered from https://dev-x-node.netlify.app/.
 *
 * Focus areas:
 *   1. Unknown model types return 404
 *   2. Gemini models without GEMINI_API_KEY surface a structured missingEnv
 *   3. Gemini models with an API key call the Gemini endpoint
 *   4. Non-Gemini providers always return the structured "API key required"
 *      error so the UI can prompt the user
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import * as falProvider from "@/app/api/generate/providers/fal";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/xnode/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("/api/xnode/run", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // The runtime env may have these set (e.g. a developer running tests
    // locally with a populated .env.local). Clear them so the "missing key"
    // assertions exercise the structured 501 branch deterministically.
    delete process.env.FAL_KEY;
    delete process.env.KIE_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/xnode/run", {
      method: "POST",
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/JSON/i);
  });

  it("returns 400 when 'type' is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toMatch(/Missing 'type'/);
  });

  it("returns 404 for unknown X-Node model types", async () => {
    const res = await POST(makeRequest({ type: "definitelyNotARealModel" }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toMatch(/Unknown X-Node model/);
  });

  it("routes kling26 through fal.ai (netlify ships it as fal-ai/kling-video/...) and surfaces FAL_KEY when missing", async () => {
    // The X-Node registry categorises kling26 as `provider: "kie"` but the
    // netlify bundle's prepareExecution actually dispatches it through
    // fal.ai. /api/xnode/run honours the real dispatch via FAL_MODEL_ID_MAP.
    const res = await POST(makeRequest({ type: "kling26", prompt: "test" }));
    expect(res.status).toBe(501);
    const body = (await res.json()) as {
      ok: boolean;
      provider: string;
      missingEnv: string;
      error: string;
    };
    expect(body.ok).toBe(false);
    expect(body.provider).toBe("fal");
    expect(body.missingEnv).toBe("FAL_KEY");
    expect(body.error).toMatch(/FAL_KEY/);
  });

  it("returns structured 501 for fal.ai providers", async () => {
    const res = await POST(makeRequest({ type: "falBlendVideo", prompt: "x" }));
    expect(res.status).toBe(501);
    const body = (await res.json()) as { missingEnv: string };
    expect(body.missingEnv).toBe("FAL_KEY");
  });

  it("returns structured 501 for ElevenLabs providers", async () => {
    const res = await POST(makeRequest({ type: "voiceChanger", prompt: "x" }));
    expect(res.status).toBe(501);
    const body = (await res.json()) as { missingEnv: string; provider: string };
    expect(body.provider).toBe("elevenlabs");
    expect(body.missingEnv).toBe("ELEVENLABS_API_KEY");
  });

  it("routes xaiSpeechToText through fal.ai (netlify ships it as xai/speech-to-text/v1 on fal)", async () => {
    // Same story as kling26 — registry says "xai" but the real netlify
    // dispatch is fal.ai. Verified via reverse-engineered prepareExecution.
    const res = await POST(makeRequest({ type: "xaiSpeechToText", prompt: "x" }));
    expect(res.status).toBe(501);
    const body = (await res.json()) as { missingEnv: string; provider: string };
    expect(body.provider).toBe("fal");
    expect(body.missingEnv).toBe("FAL_KEY");
  });

  it("dispatches to generateWithFalQueue with the correct fal model id when FAL_KEY is set", async () => {
    process.env.FAL_KEY = "fake-fal-key";
    const spy = vi
      .spyOn(falProvider, "generateWithFalQueue")
      .mockResolvedValue({
        success: true,
        outputs: [{ type: "video", data: "", url: "https://cdn.fal.ai/test.mp4" }],
      });

    const res = await POST(
      makeRequest({ type: "kling26", prompt: "a dog runs through grass" })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; kind: string; value: string; url?: string };
    expect(body.ok).toBe(true);
    expect(body.kind).toBe("video");
    expect(body.url).toBe("https://cdn.fal.ai/test.mp4");

    expect(spy).toHaveBeenCalledTimes(1);
    const [, apiKey, genInput] = spy.mock.calls[0];
    expect(apiKey).toBe("fake-fal-key");
    expect(genInput.model.id).toBe("fal-ai/kling-video/v2.6/pro/image-to-video");
    expect(genInput.model.provider).toBe("fal");
    expect(genInput.prompt).toBe("a dog runs through grass");
    // kling26 has `outputs[0].type === "video"` in the schema — capabilities
    // must reflect that so `generateWithFalQueue`'s Content-Type fallback at
    // fal.ts:560 picks "video/mp4" instead of defaulting to "image/png".
    expect(genInput.model.capabilities).toContain("text-to-video");
  });

  it("derives image capability from schema for image-output fal models", async () => {
    process.env.FAL_KEY = "fake-fal-key";
    const spy = vi
      .spyOn(falProvider, "generateWithFalQueue")
      .mockResolvedValue({
        success: true,
        outputs: [{ type: "image", data: "", url: "https://cdn.fal.ai/test.png" }],
      });

    // grokImagine outputs[0].type === "image" — should map to text-to-image
    const res = await POST(makeRequest({ type: "grokImagine", prompt: "a cat" }));
    expect(res.status).toBe(200);
    const [, , genInput] = spy.mock.calls[0];
    expect(genInput.model.capabilities).toContain("text-to-image");
    expect(genInput.model.capabilities).not.toContain("text-to-video");
  });

  it("derives audio capability from schema for audio-output fal models", async () => {
    process.env.FAL_KEY = "fake-fal-key";
    const spy = vi
      .spyOn(falProvider, "generateWithFalQueue")
      .mockResolvedValue({
        success: true,
        outputs: [{ type: "audio", data: "", url: "https://cdn.fal.ai/test.mp3" }],
      });

    // falMergeAudios outputs[0].type === "audio" → should map to text-to-audio
    const res = await POST(makeRequest({ type: "falMergeAudios", prompt: "x" }));
    expect(res.status).toBe(200);
    const [, , genInput] = spy.mock.calls[0];
    expect(genInput.model.capabilities).toContain("text-to-audio");
  });

  it("surfaces fal.ai generation errors as 502", async () => {
    process.env.FAL_KEY = "fake-fal-key";
    vi.spyOn(falProvider, "generateWithFalQueue").mockResolvedValue({
      success: false,
      error: "fal queue timed out",
    });

    const res = await POST(makeRequest({ type: "kling26", prompt: "test" }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/timed out/);
  });
});
