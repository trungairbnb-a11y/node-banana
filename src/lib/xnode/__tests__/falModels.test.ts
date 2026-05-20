import { describe, it, expect } from "vitest";
import { FAL_MODEL_ID_MAP, getFalModelId } from "../falModels";
import { X_NODE_MODELS } from "../models";

describe("FAL_MODEL_ID_MAP", () => {
  it("returns null for types with no fal.ai endpoint", () => {
    expect(getFalModelId("definitelyNotAModel")).toBeNull();
    expect(getFalModelId("voiceChanger")).toBeNull(); // elevenlabs
    expect(getFalModelId("dropboxUpload")).toBeNull();
  });

  it("returns the netlify-extracted fal.ai endpoint for known fal types", () => {
    // Spot-check a few mappings extracted from the netlify bundle.
    expect(getFalModelId("kling26")).toBe(
      "fal-ai/kling-video/v2.6/pro/image-to-video"
    );
    expect(getFalModelId("grokImagine")).toBe("xai/grok-imagine-image/edit");
    expect(getFalModelId("seedreamV45Edit")).toBe(
      "fal-ai/bytedance/seedream/v4.5/edit"
    );
    expect(getFalModelId("topazVideoUpscale")).toBe("fal-ai/topaz/upscale/video");
  });

  it("every mapped value looks like a fal.ai endpoint (vendor/path[/...])", () => {
    for (const [, modelId] of Object.entries(FAL_MODEL_ID_MAP)) {
      expect(modelId).toMatch(/^[a-z][a-z0-9-]*\/[a-zA-Z0-9_./-]+$/);
    }
  });

  it("every mapped key corresponds to a registered X-Node model", () => {
    const registeredTypes = new Set(X_NODE_MODELS.map((m) => m.type));
    for (const key of Object.keys(FAL_MODEL_ID_MAP)) {
      expect(registeredTypes.has(key)).toBe(true);
    }
  });
});
