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

  it("returns structured 501 for non-Gemini providers (Kie example)", async () => {
    // kling26 is provided by kie according to the X-Node registry
    const res = await POST(makeRequest({ type: "kling26", prompt: "test" }));
    expect(res.status).toBe(501);
    const body = (await res.json()) as {
      ok: boolean;
      provider: string;
      missingEnv: string;
      error: string;
    };
    expect(body.ok).toBe(false);
    expect(body.provider).toBe("kie");
    expect(body.missingEnv).toBe("KIE_API_KEY");
    expect(body.error).toMatch(/KIE_API_KEY/);
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

  it("returns structured 501 for xAI providers", async () => {
    const res = await POST(makeRequest({ type: "xaiSpeechToText", prompt: "x" }));
    expect(res.status).toBe(501);
    const body = (await res.json()) as { missingEnv: string; provider: string };
    expect(body.provider).toBe("xai");
    expect(body.missingEnv).toBe("XAI_API_KEY");
  });
});
