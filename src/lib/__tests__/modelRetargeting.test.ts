import { describe, expect, it } from "vitest";
import type { ProviderSettings, WorkflowNode } from "@/types";
import {
  CCS_OPENAI_IMAGE_MODEL,
  applyWorkflowModelRetargets,
  buildModelRetargetPatch,
  scanWorkflowForModelRetargets,
} from "../modelRetargeting";

function providerSettings(overrides: Partial<ProviderSettings["providers"]> = {}): ProviderSettings {
  return {
    providers: {
      gemini: { id: "gemini", name: "Gemini", enabled: true, apiKey: null },
      openai: { id: "openai", name: "OpenAI", enabled: true, apiKey: null },
      ccs: { id: "ccs", name: "CCS", enabled: true, apiKey: null },
      anthropic: { id: "anthropic", name: "Anthropic", enabled: true, apiKey: null },
      replicate: { id: "replicate", name: "Replicate", enabled: false, apiKey: null },
      fal: { id: "fal", name: "fal.ai", enabled: true, apiKey: null },
      kie: { id: "kie", name: "Kie.ai", enabled: false, apiKey: null },
      wavespeed: { id: "wavespeed", name: "WaveSpeed", enabled: false, apiKey: null },
      flow: { id: "flow", name: "Google Flow", enabled: true, apiKey: null },
      ...overrides,
    },
  };
}

function imageNode(id = "image-node"): WorkflowNode {
  return {
    id,
    type: "nanoBanana",
    position: { x: 0, y: 0 },
    data: {
      inputImages: [],
      inputPrompt: null,
      outputImage: null,
      aspectRatio: "1:1",
      resolution: "1K",
      model: "nano-banana-pro",
      selectedModel: { provider: "kie", modelId: "nano-banana-pro", displayName: "Nano Banana Pro" },
      fallbackModel: { provider: "kie", modelId: "z-image", displayName: "Z-Image" },
      useGoogleSearch: false,
      useImageSearch: false,
      status: "error",
      error: "Kie key missing",
      imageHistory: [],
      selectedHistoryIndex: 0,
    },
  };
}

function videoNode(id = "video-node"): WorkflowNode {
  return {
    id,
    type: "generateVideo",
    position: { x: 0, y: 0 },
    data: {
      inputImages: [],
      inputVideos: [],
      inputPrompt: null,
      outputVideo: null,
      selectedModel: { provider: "kie", modelId: "veo3/image-to-video", displayName: "Veo 3 I2V" },
      parameters: { aspectRatio: "16:9" },
      status: "error",
      error: "Kie key missing",
      videoHistory: [],
      selectedVideoHistoryIndex: 0,
    },
  };
}

describe("modelRetargeting", () => {
  it("retargets an unavailable Kie image node to CCS/OpenAI-compatible GPT Image 2", () => {
    const nodes = [imageNode()];
    const settings = providerSettings({
      openai: { id: "openai", name: "OpenAI", enabled: true, apiKey: "ccs-key" },
      kie: { id: "kie", name: "Kie.ai", enabled: false, apiKey: null },
    });

    const issues = scanWorkflowForModelRetargets(nodes, settings, {});
    expect(issues).toHaveLength(1);
    expect(issues[0].primaryReason).toBe("Kie.ai is disabled in Settings");
    expect(issues[0].imageTargetAvailable).toBe(true);

    const nextNodes = applyWorkflowModelRetargets(nodes, issues, { "image-node": {} });
    expect((nextNodes[0].data as any).selectedModel).toEqual(CCS_OPENAI_IMAGE_MODEL);
    expect((nextNodes[0].data as any).fallbackModel).toBeUndefined();
    expect((nextNodes[0].data as any).parameters).toEqual({});
    expect((nextNodes[0].data as any).error).toBeNull();
  });

  it("retargets an unavailable Kie video node to the selected Flow mode schema", () => {
    const node = videoNode();
    const settings = providerSettings({
      kie: { id: "kie", name: "Kie.ai", enabled: false, apiKey: null },
    });

    const [issue] = scanWorkflowForModelRetargets([node], settings, { flow: true });
    const patch = buildModelRetargetPatch(node, issue, {
      flowModelId: "flow-veo-3.1/start-end-frame",
    }) as any;

    expect(patch.selectedModel).toMatchObject({
      provider: "flow",
      modelId: "flow-veo-3.1/start-end-frame",
      displayName: "Flow Start/End Frame",
    });
    expect(patch.parameters).toEqual({ aspectRatio: "16:9" });
    expect(patch.inputSchema.map((input: any) => input.name)).toEqual(["startImage", "endImage", "prompt"]);
  });

  it("clears an unavailable fallback while preserving an available primary model", () => {
    const node = imageNode();
    node.data = {
      ...node.data,
      selectedModel: { provider: "openai", modelId: "gpt-image-2", displayName: "GPT Image 2" },
      fallbackModel: { provider: "kie", modelId: "z-image", displayName: "Z-Image" },
    } as any;
    const settings = providerSettings({
      openai: { id: "openai", name: "OpenAI", enabled: true, apiKey: "ccs-key" },
      kie: { id: "kie", name: "Kie.ai", enabled: false, apiKey: null },
    });

    const [issue] = scanWorkflowForModelRetargets([node], settings, {});
    expect(issue.action).toBe("clear-fallback");

    const patch = buildModelRetargetPatch(node, issue);
    expect(patch).toMatchObject({
      fallbackModel: undefined,
      fallbackParameters: undefined,
      status: "idle",
      error: null,
    });
  });
});
