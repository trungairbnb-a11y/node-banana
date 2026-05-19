import type { ProviderModel, ModelInput, ModelParameter } from "@/lib/providers/types";

export type FlowVideoMode =
  | "reference-video"
  | "start-image-video"
  | "compose-start-video"
  | "start-end-frame"
  | "upscale-video";

export const FLOW_MODEL_PREFIX = "flow-veo-3.1/";

export const FLOW_MODELS: Array<ProviderModel & { mode: FlowVideoMode }> = [
  {
    id: "flow-veo-3.1/reference-video",
    mode: "reference-video",
    name: "Flow Reference Video",
    description: "Create one video from one or more image references and a prompt through Google Flow.",
    provider: "flow",
    capabilities: ["image-to-video"],
    pageUrl: "https://labs.google/fx/tools/flow",
  },
  {
    id: "flow-veo-3.1/start-image-video",
    mode: "start-image-video",
    name: "Flow Start Image Video",
    description: "Animate a start image as the first frame of a Google Flow video.",
    provider: "flow",
    capabilities: ["image-to-video"],
    pageUrl: "https://labs.google/fx/tools/flow",
  },
  {
    id: "flow-veo-3.1/compose-start-video",
    mode: "compose-start-video",
    name: "Flow Compose Start Video",
    description: "Refine a start image with extra references, then animate the refined seed frame.",
    provider: "flow",
    capabilities: ["image-to-video"],
    pageUrl: "https://labs.google/fx/tools/flow",
  },
  {
    id: "flow-veo-3.1/start-end-frame",
    mode: "start-end-frame",
    name: "Flow Start/End Frame",
    description: "Generate a transition video between a start frame and an end frame.",
    provider: "flow",
    capabilities: ["image-to-video"],
    pageUrl: "https://labs.google/fx/tools/flow",
  },
  {
    id: "flow-veo-3.1/upscale-video",
    mode: "upscale-video",
    name: "Flow Upscale Video",
    description: "Upscale a Google Flow-generated video using Flow's video upsampler.",
    provider: "flow",
    capabilities: ["image-to-video"],
    pageUrl: "https://labs.google/fx/tools/flow",
  },
];

export const DEFAULT_FLOW_MODEL = FLOW_MODELS[0];

export function isFlowModelId(modelId: string | undefined | null): modelId is string {
  return typeof modelId === "string" && modelId.startsWith(FLOW_MODEL_PREFIX);
}

export function getFlowModeFromModelId(modelId: string | undefined | null): FlowVideoMode | null {
  if (!isFlowModelId(modelId)) return null;
  const mode = modelId.slice(FLOW_MODEL_PREFIX.length) as FlowVideoMode;
  return FLOW_MODELS.some((model) => model.mode === mode) ? mode : null;
}

const videoParams: ModelParameter[] = [
  {
    name: "aspectRatio",
    type: "string",
    description: "Output aspect ratio",
    enum: ["16:9", "9:16"],
    default: "16:9",
  },
  {
    name: "seed",
    type: "integer",
    description: "Random seed",
    minimum: 0,
  },
];

const referenceVideoParams: ModelParameter[] = [
  {
    ...videoParams[0],
    enum: ["16:9", "9:16"],
    default: "9:16",
  },
  ...videoParams.slice(1),
];

const upscaleParams: ModelParameter[] = [
  {
    name: "resolution",
    type: "string",
    description: "Upscale target resolution",
    enum: ["1080p", "4K"],
    default: "4K",
  },
];

const promptInput: ModelInput = {
  name: "prompt",
  type: "text",
  required: true,
  label: "Prompt",
};

export function getFlowSchemaForMode(mode: FlowVideoMode): { parameters: ModelParameter[]; inputs: ModelInput[] } {
  switch (mode) {
    case "reference-video":
      return {
        parameters: referenceVideoParams,
        inputs: [
          {
            name: "referenceImages",
            type: "image",
            required: true,
            label: "Refs",
            description: "One or more images used as visual references in the same Flow video.",
            isArray: true,
          },
          promptInput,
        ],
      };
    case "start-image-video":
      return {
        parameters: videoParams,
        inputs: [
          {
            name: "startImage",
            type: "image",
            required: true,
            label: "Start",
            description: "Image used as the first frame.",
          },
          promptInput,
        ],
      };
    case "compose-start-video":
      return {
        parameters: videoParams,
        inputs: [
          {
            name: "startImage",
            type: "image",
            required: true,
            label: "Start",
            description: "Base image refined before video generation.",
          },
          {
            name: "extraRefs",
            type: "image",
            required: false,
            label: "Extra Refs",
            description: "Additional image references used to refine the seed frame.",
            isArray: true,
          },
          promptInput,
          {
            name: "seedPrompt",
            type: "text",
            required: false,
            label: "Seed Prompt",
            description: "Optional image-refine prompt. Falls back to Prompt.",
          },
        ],
      };
    case "start-end-frame":
      return {
        parameters: videoParams,
        inputs: [
          {
            name: "startImage",
            type: "image",
            required: true,
            label: "Start",
            description: "First frame.",
          },
          {
            name: "endImage",
            type: "image",
            required: true,
            label: "End",
            description: "Last frame.",
          },
          promptInput,
        ],
      };
    case "upscale-video":
      return {
        parameters: upscaleParams,
        inputs: [
          {
            name: "video",
            type: "video",
            required: true,
            label: "Video",
            description: "A video generated by Google Flow.",
          },
        ],
      };
  }
}

export function getFlowSchemaForModel(modelId: string): { parameters: ModelParameter[]; inputs: ModelInput[] } | null {
  const mode = getFlowModeFromModelId(modelId);
  return mode ? getFlowSchemaForMode(mode) : null;
}

export function buildFlowParametersForModel(
  modelId: string,
  existing: Record<string, unknown> = {}
): Record<string, unknown> {
  const schema = getFlowSchemaForModel(modelId);
  if (!schema) return {};

  const next: Record<string, unknown> = {};
  for (const param of schema.parameters) {
    if (existing[param.name] !== undefined) {
      next[param.name] = existing[param.name];
    } else if (param.default !== undefined) {
      next[param.name] = param.default;
    }
  }
  return next;
}
