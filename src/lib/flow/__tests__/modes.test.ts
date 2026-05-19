import { describe, expect, it } from "vitest";
import {
  FLOW_MODELS,
  getFlowModeFromModelId,
  getFlowSchemaForModel,
  isFlowModelId,
} from "../modes";

describe("Flow video modes", () => {
  it("exposes the supported Flow model presets", () => {
    expect(FLOW_MODELS.map((model) => model.id)).toEqual([
      "flow-veo-3.1/reference-video",
      "flow-veo-3.1/start-image-video",
      "flow-veo-3.1/compose-start-video",
      "flow-veo-3.1/start-end-frame",
      "flow-veo-3.1/upscale-video",
    ]);
  });

  it("detects Flow model IDs and rejects non-Flow models", () => {
    expect(isFlowModelId("flow-veo-3.1/reference-video")).toBe(true);
    expect(getFlowModeFromModelId("flow-veo-3.1/start-end-frame")).toBe("start-end-frame");
    expect(getFlowModeFromModelId("veo-3.1/reference-video")).toBeNull();
    expect(getFlowModeFromModelId(null)).toBeNull();
  });

  it("returns reference-video schema with multi-reference images and prompt", () => {
    const schema = getFlowSchemaForModel("flow-veo-3.1/reference-video");

    expect(schema?.inputs.map((input) => input.name)).toEqual(["referenceImages", "prompt"]);
    expect(schema?.inputs[0]).toMatchObject({
      type: "image",
      required: true,
      isArray: true,
      label: "Refs",
    });
    expect(schema?.parameters[0]).toMatchObject({
      name: "aspectRatio",
      enum: ["16:9", "9:16"],
      default: "9:16",
    });
  });

  it("returns compose-start-video schema with start, extra refs, prompt, and seed prompt", () => {
    const schema = getFlowSchemaForModel("flow-veo-3.1/compose-start-video");

    expect(schema?.inputs.map((input) => input.name)).toEqual([
      "startImage",
      "extraRefs",
      "prompt",
      "seedPrompt",
    ]);
    expect(schema?.inputs[1]).toMatchObject({
      type: "image",
      required: false,
      isArray: true,
      label: "Extra Refs",
    });
  });

  it("returns start/end and upscale schemas with mode-specific required handles", () => {
    expect(getFlowSchemaForModel("flow-veo-3.1/start-end-frame")?.inputs.map((input) => input.name)).toEqual([
      "startImage",
      "endImage",
      "prompt",
    ]);
    expect(getFlowSchemaForModel("flow-veo-3.1/upscale-video")?.inputs).toEqual([
      expect.objectContaining({
        name: "video",
        type: "video",
        required: true,
      }),
    ]);
  });
});
