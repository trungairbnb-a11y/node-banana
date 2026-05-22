import type { ProviderModel, ModelInput, ModelParameter } from "@/lib/providers/types";

export type FlowVideoMode =
  | "text-to-video"
  | "reference-video"
  | "start-image-video"
  | "compose-start-video"
  | "start-end-frame"
  | "extend-video"
  | "camera-control"
  | "insert-object"
  | "remove-object"
  | "upscale-video";

export const FLOW_MODEL_PREFIX = "flow-veo-3.1/";

export const FLOW_VOICE_PRESETS = [
  "achird", "achernar", "algieba", "algenib", "alnilam", "aoede", "autonoe",
  "callirrhoe", "charon", "despina", "enceladus", "erinome", "fenrir", "gacrux",
  "iapetus", "kore", "laomedeia", "leda", "orus", "puck", "pulcherrima",
  "rasalgethi", "sadachbia", "sadaltager", "schedar", "sulafat", "umbriel",
  "vindemiatrix", "zephyr", "zubenelgenubi",
] as const;

export type FlowVoicePreset = (typeof FLOW_VOICE_PRESETS)[number];

export type FlowModelTier = "lite" | "fast" | "quality";

export const FLOW_MODEL_TIERS: { id: FlowModelTier; label: string; description: string; cost: string }[] = [
  { id: "lite", label: "Veo 3.1 Lite", description: "Fast, lower cost", cost: "5 credits / $0.025" },
  { id: "fast", label: "Veo 3.1 Fast", description: "Balanced speed and quality", cost: "10 credits / $0.05" },
  { id: "quality", label: "Veo 3.1 Quality", description: "Highest quality output", cost: "100 credits / $0.50" },
];

export const FLOW_MODELS: Array<ProviderModel & { mode: FlowVideoMode }> = [
  {
    id: "flow-veo-3.1/text-to-video",
    mode: "text-to-video",
    name: "Flow Text to Video",
    description: "Generate a video from a text prompt only — no image input required. Supports audio generation and voice narration.",
    provider: "flow",
    capabilities: ["text-to-video"],
    pageUrl: "https://labs.google/fx/tools/flow",
  },
  {
    id: "flow-veo-3.1/reference-video",
    mode: "reference-video",
    name: "Flow Reference Video",
    description: "Create one video from one or more image references and a prompt through Google Flow. Supports voice narration with 30 AI voice presets.",
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
    id: "flow-veo-3.1/extend-video",
    mode: "extend-video",
    name: "Flow Extend Video",
    description: "Extend an existing Flow-generated video by 8 seconds with a new prompt describing what happens next.",
    provider: "flow",
    capabilities: ["image-to-video"],
    pageUrl: "https://labs.google/fx/tools/flow",
  },
  {
    id: "flow-veo-3.1/camera-control",
    mode: "camera-control",
    name: "Flow Camera Control",
    description: "Change camera motion or position on a video clip. Requires a start frame (and optional end frame).",
    provider: "flow",
    capabilities: ["image-to-video"],
    pageUrl: "https://labs.google/fx/tools/flow",
  },
  {
    id: "flow-veo-3.1/insert-object",
    mode: "insert-object",
    name: "Flow Insert Object",
    description: "Insert an object into an existing video using a text description and optional bounding region.",
    provider: "flow",
    capabilities: ["image-to-video"],
    pageUrl: "https://labs.google/fx/tools/flow",
  },
  {
    id: "flow-veo-3.1/remove-object",
    mode: "remove-object",
    name: "Flow Remove Object",
    description: "Remove an object from an existing video by specifying a bounding region.",
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

const tierParam: ModelParameter = {
  name: "tier",
  type: "string",
  description: "Veo 3.1 model tier — Lite is cheapest, Quality is best",
  enum: ["lite", "fast", "quality"],
  default: "fast",
};

const durationParam: ModelParameter = {
  name: "duration",
  type: "integer",
  description: "Video duration in seconds. 4s and 6s require Ultra subscription.",
  enum: [4, 6, 8],
  default: 8,
};

const videoParams: ModelParameter[] = [
  tierParam,
  {
    name: "aspectRatio",
    type: "string",
    description: "Output aspect ratio",
    enum: ["16:9", "9:16"],
    default: "16:9",
  },
  durationParam,
  {
    name: "enableAudio",
    type: "boolean",
    description: "Enable AI-generated audio (sound effects, background noise)",
    default: true,
  },
  {
    name: "seed",
    type: "integer",
    description: "Random seed",
    minimum: 0,
  },
];

const referenceVideoParams: ModelParameter[] = [
  tierParam,
  {
    name: "aspectRatio",
    type: "string",
    description: "Output aspect ratio",
    enum: ["16:9", "9:16"],
    default: "9:16",
  },
  durationParam,
  {
    name: "voice",
    type: "string",
    description: "AI voice preset for narration. Only works with reference images (R2V mode).",
    enum: [...FLOW_VOICE_PRESETS],
  },
  {
    name: "enableAudio",
    type: "boolean",
    description: "Enable AI-generated audio (sound effects, background noise)",
    default: true,
  },
  {
    name: "seed",
    type: "integer",
    description: "Random seed",
    minimum: 0,
  },
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

const cameraMotionParam: ModelParameter = {
  name: "cameraMotion",
  type: "string",
  description: "Camera motion type to apply",
  enum: ["pan-left", "pan-right", "tilt-up", "tilt-down", "zoom-in", "zoom-out", "orbit-left", "orbit-right", "dolly-in", "dolly-out"],
};

const cameraPositionParam: ModelParameter = {
  name: "cameraPosition",
  type: "string",
  description: "Camera position preset",
  enum: ["low-angle", "high-angle", "eye-level", "birds-eye", "dutch-angle"],
};

const promptInput: ModelInput = {
  name: "prompt",
  type: "text",
  required: true,
  label: "Prompt",
};

const optionalPromptInput: ModelInput = {
  name: "prompt",
  type: "text",
  required: false,
  label: "Prompt",
  description: "Optional text guidance for the edit.",
};

export function getFlowSchemaForMode(mode: FlowVideoMode): { parameters: ModelParameter[]; inputs: ModelInput[] } {
  switch (mode) {
    case "text-to-video":
      return {
        parameters: videoParams,
        inputs: [promptInput],
      };
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
    case "extend-video":
      return {
        parameters: [
          tierParam,
          {
            name: "aspectRatio",
            type: "string",
            description: "Inherited from source video (read-only)",
            enum: ["16:9", "9:16"],
            default: "16:9",
          },
          {
            name: "seed",
            type: "integer",
            description: "Random seed",
            minimum: 0,
          },
        ],
        inputs: [
          {
            name: "video",
            type: "video",
            required: true,
            label: "Source Video",
            description: "A previously generated Flow video to extend.",
          },
          {
            ...promptInput,
            description: "Describe what happens next in the extended segment.",
          },
        ],
      };
    case "camera-control":
      return {
        parameters: [
          tierParam,
          {
            name: "aspectRatio",
            type: "string",
            description: "Output aspect ratio",
            enum: ["16:9", "9:16"],
            default: "16:9",
          },
          durationParam,
          cameraMotionParam,
          cameraPositionParam,
          {
            name: "seed",
            type: "integer",
            description: "Random seed",
            minimum: 0,
          },
        ],
        inputs: [
          {
            name: "startImage",
            type: "image",
            required: true,
            label: "Start Frame",
            description: "First frame for camera control. Required.",
          },
          {
            name: "endImage",
            type: "image",
            required: false,
            label: "End Frame",
            description: "Optional last frame for camera control.",
          },
          promptInput,
        ],
      };
    case "insert-object":
      return {
        parameters: [
          tierParam,
          {
            name: "regionX",
            type: "number",
            description: "Bounding box X position (0-1, fraction of width)",
            minimum: 0,
            maximum: 1,
          },
          {
            name: "regionY",
            type: "number",
            description: "Bounding box Y position (0-1, fraction of height)",
            minimum: 0,
            maximum: 1,
          },
          {
            name: "regionWidth",
            type: "number",
            description: "Bounding box width (0-1)",
            minimum: 0,
            maximum: 1,
            default: 0.3,
          },
          {
            name: "regionHeight",
            type: "number",
            description: "Bounding box height (0-1)",
            minimum: 0,
            maximum: 1,
            default: 0.3,
          },
        ],
        inputs: [
          {
            name: "video",
            type: "video",
            required: true,
            label: "Source Video",
            description: "Video to insert an object into.",
          },
          {
            ...promptInput,
            description: "Describe the object to insert.",
          },
        ],
      };
    case "remove-object":
      return {
        parameters: [
          tierParam,
          {
            name: "regionX",
            type: "number",
            description: "Bounding box X position (0-1, fraction of width)",
            minimum: 0,
            maximum: 1,
          },
          {
            name: "regionY",
            type: "number",
            description: "Bounding box Y position (0-1, fraction of height)",
            minimum: 0,
            maximum: 1,
          },
          {
            name: "regionWidth",
            type: "number",
            description: "Bounding box width (0-1)",
            minimum: 0,
            maximum: 1,
            default: 0.3,
          },
          {
            name: "regionHeight",
            type: "number",
            description: "Bounding box height (0-1)",
            minimum: 0,
            maximum: 1,
            default: 0.3,
          },
        ],
        inputs: [
          {
            name: "video",
            type: "video",
            required: true,
            label: "Source Video",
            description: "Video to remove an object from.",
          },
          optionalPromptInput,
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

export function getFlowModeSuggestions(mode: FlowVideoMode): {
  suggestedTier: FlowModelTier;
  tips: string[];
  relatedModes: FlowVideoMode[];
} {
  switch (mode) {
    case "text-to-video":
      return {
        suggestedTier: "fast",
        tips: [
          "Add audio guidance in your prompt: e.g. 'the sound of waves crashing'",
          "Use 4s or 6s for quick previews (Ultra subscription required)",
          "Try reference-video mode for more control with ingredient images",
        ],
        relatedModes: ["reference-video", "start-image-video"],
      };
    case "reference-video":
      return {
        suggestedTier: "fast",
        tips: [
          "Use 1-3 reference images for best results",
          "Add a voice preset for AI narration",
          "R2V mode is not supported with Veo 3.1 Quality tier",
          "Duration is fixed at 8s for reference video mode",
        ],
        relatedModes: ["text-to-video", "compose-start-video"],
      };
    case "start-image-video":
      return {
        suggestedTier: "fast",
        tips: [
          "The start image becomes the exact first frame",
          "Try compose-start-video to refine the image first",
        ],
        relatedModes: ["start-end-frame", "compose-start-video", "camera-control"],
      };
    case "compose-start-video":
      return {
        suggestedTier: "fast",
        tips: [
          "The seed prompt refines the start image before animation",
          "Add extra reference images for style consistency",
        ],
        relatedModes: ["start-image-video", "reference-video"],
      };
    case "start-end-frame":
      return {
        suggestedTier: "fast",
        tips: [
          "Provide two distinct frames for a smooth transition",
          "Works well for morphing or movement between two states",
        ],
        relatedModes: ["start-image-video", "camera-control"],
      };
    case "extend-video":
      return {
        suggestedTier: "fast",
        tips: [
          "Extends by 8 seconds from the last ~1 second of the source",
          "Describe what should happen next in the prompt",
          "Chain multiple extends for longer sequences",
        ],
        relatedModes: ["text-to-video", "upscale-video"],
      };
    case "camera-control":
      return {
        suggestedTier: "fast",
        tips: [
          "Requires at least a start frame image",
          "Combine camera motion with camera position for complex shots",
          "Add an end frame for more precise camera path control",
        ],
        relatedModes: ["start-image-video", "start-end-frame"],
      };
    case "insert-object":
      return {
        suggestedTier: "lite",
        tips: [
          "Use bounding box coordinates to position the object",
          "8s videos only for insert/remove operations",
          "Describe the object clearly in the prompt",
        ],
        relatedModes: ["remove-object"],
      };
    case "remove-object":
      return {
        suggestedTier: "lite",
        tips: [
          "Draw a bounding box around the object to remove",
          "8s videos only for insert/remove operations",
          "The prompt is optional — the region selection is the primary input",
        ],
        relatedModes: ["insert-object"],
      };
    case "upscale-video":
      return {
        suggestedTier: "fast",
        tips: [
          "4K upscale uses more credits than 1080p",
          "Only works on Flow-generated videos",
        ],
        relatedModes: ["extend-video"],
      };
  }
}
