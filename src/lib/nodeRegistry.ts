import type { ComponentType } from "react";
import type { NodeProps } from "@xyflow/react";
import type { NodeType, WorkflowNode, WorkflowNodeData } from "@/types";
import { createDefaultNodeData, defaultNodeDimensions } from "@/store/utils/nodeDefaults";
import { X_NODE_MODELS } from "@/lib/xnode/models";

export type BlueprintCategory =
  | "Input"
  | "Text"
  | "Generate"
  | "Utility"
  | "Route"
  | "Output";

export type BlueprintOutputType = "image" | "text" | "video" | "audio" | "3d";

export interface BlueprintOutput {
  type: BlueprintOutputType;
  value: string | null;
}

export interface BlueprintHandles {
  inputs: string[];
  outputs: string[];
}

export interface NodeBlueprint {
  type: NodeType;
  label: string;
  category: BlueprintCategory;
  dimensions: { width: number; height: number };
  handles: BlueprintHandles;
  component?: ComponentType<NodeProps>;
  createData: () => WorkflowNodeData;
  getOutput?: (node: WorkflowNode, sourceHandle?: string | null) => BlueprintOutput;
  canExecute?: boolean;
  processorId?: string;
  xnode?: {
    title?: string;
    preview?: "image" | "video" | "audio" | "text" | "canvas" | "none";
    handleLabels?: Record<string, string>;
    menuGroup?: "Utility" | "Generate" | "Network" | "Input" | "Output";
  };
}

const blueprints = new Map<NodeType, NodeBlueprint>();

export function registerBlueprint(blueprint: NodeBlueprint): void {
  blueprints.set(blueprint.type, blueprint);
}

export function getBlueprint(type: NodeType | string): NodeBlueprint | undefined {
  return blueprints.get(type as NodeType);
}

export function getBlueprintDefaults(type: NodeType): WorkflowNodeData {
  const blueprint = getBlueprint(type);
  return blueprint ? blueprint.createData() : createDefaultNodeData(type);
}

export function getBlueprintDimensions(type: NodeType): { width: number; height: number } {
  return getBlueprint(type)?.dimensions ?? defaultNodeDimensions[type];
}

export function getBlueprintHandles(type: NodeType | string): BlueprintHandles {
  return getBlueprint(type)?.handles ?? { inputs: [], outputs: [] };
}

export function getBlueprintOutput(
  node: WorkflowNode,
  sourceHandle?: string | null
): BlueprintOutput | null {
  return getBlueprint(node.type)?.getOutput?.(node, sourceHandle) ?? null;
}

export function getBlueprints(): NodeBlueprint[] {
  return Array.from(blueprints.values());
}

export function getBlueprintMenuCategories(): Array<{
  label: BlueprintCategory;
  nodes: Array<{ type: NodeType; label: string }>;
}> {
  const order: BlueprintCategory[] = ["Input", "Text", "Generate", "Utility", "Route", "Output"];
  return order
    .map((category) => ({
      label: category,
      nodes: getBlueprints()
        .filter((blueprint) => blueprint.category === category)
        .map((blueprint) => ({ type: blueprint.type, label: blueprint.label })),
    }))
    .filter((category) => category.nodes.length > 0);
}

function data(node: WorkflowNode): Record<string, unknown> {
  return node.data as Record<string, unknown>;
}

function indexedTextOutput(node: WorkflowNode, sourceHandle?: string | null): BlueprintOutput {
  const d = data(node);
  const items = Array.isArray(d.outputItems) ? d.outputItems : [];
  if (sourceHandle?.startsWith("text-")) {
    const index = Number(sourceHandle.replace("text-", ""));
    const value = Number.isInteger(index) ? items[index] : null;
    return { type: "text", value: typeof value === "string" ? value : null };
  }
  const outputText = d.outputText;
  return { type: "text", value: typeof outputText === "string" ? outputText : null };
}

function fieldOutput(field: string, type: BlueprintOutputType) {
  return (node: WorkflowNode): BlueprintOutput => {
    const value = data(node)[field];
    return { type, value: typeof value === "string" ? value : null };
  };
}

function actionDirectorOutput(node: WorkflowNode, sourceHandle?: string | null): BlueprintOutput {
  const handle = sourceHandle ?? "openPose";
  const fields: Record<string, { field: string; type: BlueprintOutputType }> = {
    pose: { field: "outputPose", type: "image" },
    openPose: { field: "outputPose", type: "image" },
    depth: { field: "outputDepth", type: "image" },
    canny: { field: "outputCanny", type: "image" },
    normal: { field: "outputNormal", type: "image" },
    shaded: { field: "outputShaded", type: "image" },
    alpha: { field: "outputAlpha", type: "image" },
    "pose-video": { field: "outputPoseVideo", type: "video" },
    "video-pose": { field: "outputPoseVideo", type: "video" },
    "video-openPose": { field: "outputPoseVideo", type: "video" },
    "depth-video": { field: "outputDepthVideo", type: "video" },
    "video-depth": { field: "outputDepthVideo", type: "video" },
    "canny-video": { field: "outputCannyVideo", type: "video" },
    "video-canny": { field: "outputCannyVideo", type: "video" },
    "normal-video": { field: "outputNormalVideo", type: "video" },
    "video-normal": { field: "outputNormalVideo", type: "video" },
    "shaded-video": { field: "outputShadedVideo", type: "video" },
    "video-shaded": { field: "outputShadedVideo", type: "video" },
    "alpha-video": { field: "outputAlphaVideo", type: "video" },
    "video-alpha": { field: "outputAlphaVideo", type: "video" },
  };
  const resolved = fields[handle] ?? fields.openPose;
  const value = data(node)[resolved.field];
  return { type: resolved.type, value: typeof value === "string" ? value : null };
}

const passthroughDefault = (type: NodeType): (() => WorkflowNodeData) => () => createDefaultNodeData(type);

const baseBlueprints: Array<Omit<NodeBlueprint, "dimensions" | "createData"> & { dimensions?: { width: number; height: number } }> = [
  { type: "imageInput", label: "Image Input", category: "Input", handles: { inputs: ["reference"], outputs: ["image"] } },
  { type: "audioInput", label: "Audio Input", category: "Input", handles: { inputs: ["audio"], outputs: ["audio"] } },
  { type: "videoInput", label: "Video Input", category: "Input", handles: { inputs: ["video"], outputs: ["video"] } },
  { type: "glbViewer", label: "3D Viewer", category: "Input", handles: { inputs: ["3d"], outputs: ["image"] } },
  { type: "prompt", label: "Prompt", category: "Text", handles: { inputs: ["text"], outputs: ["text"] } },
  { type: "promptConstructor", label: "Prompt Constructor", category: "Text", handles: { inputs: ["text"], outputs: ["text"] } },
  { type: "array", label: "Array", category: "Text", handles: { inputs: ["text"], outputs: ["text"] } },
  { type: "nanoBanana", label: "Generate Image", category: "Generate", handles: { inputs: ["image", "text"], outputs: ["image"] } },
  { type: "generateVideo", label: "Generate Video", category: "Generate", handles: { inputs: ["image", "text", "audio"], outputs: ["video"] } },
  { type: "generate3d", label: "Generate 3D", category: "Generate", handles: { inputs: ["image", "text"], outputs: ["3d"] } },
  { type: "generateAudio", label: "Generate Audio", category: "Generate", handles: { inputs: ["text"], outputs: ["audio"] } },
  { type: "llmGenerate", label: "LLM Generate", category: "Generate", handles: { inputs: ["text", "image"], outputs: ["text"] } },
  { type: "output", label: "Output", category: "Utility", handles: { inputs: ["image", "video", "audio"], outputs: [] } },
  { type: "splitGrid", label: "Split Grid", category: "Utility", handles: { inputs: ["image"], outputs: ["reference"] } },
  { type: "annotation", label: "Annotate", category: "Utility", handles: { inputs: ["image"], outputs: ["image"] } },
  { type: "stickyNote", label: "Sticky Note", category: "Utility", handles: { inputs: [], outputs: [] } },
  { type: "imageCompare", label: "Image Compare", category: "Utility", handles: { inputs: ["image"], outputs: [] } },
  { type: "videoStitch", label: "Video Stitch", category: "Utility", handles: { inputs: ["video", "audio"], outputs: ["video"] } },
  { type: "videoTrim", label: "Video Trim", category: "Utility", handles: { inputs: ["video"], outputs: ["video"] } },
  { type: "easeCurve", label: "Ease Curve", category: "Utility", handles: { inputs: ["video", "easeCurve"], outputs: ["video", "easeCurve"] } },
  { type: "videoFrameGrab", label: "Frame Grab", category: "Utility", handles: { inputs: ["video"], outputs: ["image"] } },
  { type: "router", label: "Router", category: "Route", handles: { inputs: ["image", "text", "video", "audio", "3d", "easeCurve", "generic-input"], outputs: ["image", "text", "video", "audio", "3d", "easeCurve", "generic-output"] } },
  { type: "switch", label: "Switch", category: "Utility", handles: { inputs: ["generic-input"], outputs: [] } },
  { type: "conditionalSwitch", label: "Conditional Switch", category: "Route", handles: { inputs: ["text"], outputs: [] } },
  { type: "outputGallery", label: "Output Gallery", category: "Output", handles: { inputs: ["image", "video"], outputs: [] } },
];

baseBlueprints.forEach((blueprint) => {
  registerBlueprint({
    ...blueprint,
    dimensions: blueprint.dimensions ?? defaultNodeDimensions[blueprint.type],
    createData: passthroughDefault(blueprint.type),
  });
});

const utilityBlueprints: Array<Omit<NodeBlueprint, "dimensions" | "createData">> = [
  { type: "textSplitter", label: "Text Splitter", category: "Utility", handles: { inputs: ["text"], outputs: ["text"] }, getOutput: indexedTextOutput, canExecute: true },
  { type: "maskPainter", label: "Mask painter", category: "Utility", handles: { inputs: ["image"], outputs: ["image"] }, getOutput: fieldOutput("outputImage", "image") },
  { type: "loadLora", label: "Load LoRA", category: "Utility", handles: { inputs: [], outputs: ["lora"] }, getOutput: fieldOutput("outputLora", "text"), canExecute: true },
  { type: "blur", label: "Blur", category: "Utility", handles: { inputs: ["image", "mask"], outputs: ["image"] }, getOutput: fieldOutput("outputImage", "image"), canExecute: true },
  { type: "reformat", label: "Reformat", category: "Utility", handles: { inputs: ["image"], outputs: ["image"] }, getOutput: fieldOutput("outputImage", "image"), canExecute: true },
  { type: "crop", label: "Crop", category: "Utility", handles: { inputs: ["image"], outputs: ["image"] }, getOutput: fieldOutput("outputImage", "image"), canExecute: true },
  { type: "compositor", label: "Compositor", category: "Utility", handles: { inputs: ["image", "image-1", "mask"], outputs: ["image"] }, getOutput: fieldOutput("outputImage", "image"), canExecute: true },
  { type: "colorCorrection", label: "Color Correction", category: "Utility", handles: { inputs: ["image", "mask"], outputs: ["image"] }, getOutput: fieldOutput("outputImage", "image"), canExecute: true },
  { type: "forEachStart", label: "For Each Start", category: "Utility", handles: { inputs: ["text", "image", "video", "audio"], outputs: ["text", "image", "video", "audio"] }, getOutput: indexedTextOutput, canExecute: true },
  { type: "forEachEnd", label: "For Each End", category: "Utility", handles: { inputs: ["text", "image", "video", "audio"], outputs: ["text"] }, getOutput: fieldOutput("outputJson", "text"), canExecute: true },
  { type: "actionDirector", label: "Action Director", category: "Utility", handles: { inputs: [], outputs: ["openPose", "depth", "canny", "normal", "shaded", "alpha", "video-openPose", "video-depth", "video-canny", "video-normal", "video-shaded", "video-alpha"] }, getOutput: actionDirectorOutput, canExecute: true },
  { type: "urlSpawner", label: "URL Spawner", category: "Utility", handles: { inputs: [], outputs: [] } },
  { type: "mediaDownload", label: "Media Download", category: "Utility", handles: { inputs: ["text"], outputs: ["video", "audio"] }, getOutput: (node) => {
    const d = data(node);
    if (typeof d.outputAudio === "string") return { type: "audio", value: d.outputAudio };
    return { type: "video", value: typeof d.outputVideo === "string" ? d.outputVideo : null };
  }, canExecute: true },
  { type: "videoMaskOverlay", label: "Video Mask", category: "Utility", handles: { inputs: ["video", "video-1"], outputs: ["video"] }, getOutput: fieldOutput("outputVideo", "video"), canExecute: true },
  { type: "extractFrameCustom", label: "Extract Frame", category: "Utility", handles: { inputs: ["video"], outputs: ["image"] }, getOutput: fieldOutput("outputImage", "image"), canExecute: true },
  { type: "frameComposer", label: "Frame Composer", category: "Utility", handles: { inputs: ["video", "image"], outputs: ["video"] }, getOutput: fieldOutput("outputVideo", "video"), canExecute: true },
  { type: "audioEnvironment", label: "Audio Equalizer", category: "Utility", handles: { inputs: ["audio"], outputs: ["audio"] }, getOutput: fieldOutput("outputAudio", "audio"), canExecute: true },
];

utilityBlueprints.forEach((blueprint) => {
  registerBlueprint({
    ...blueprint,
    dimensions: defaultNodeDimensions[blueprint.type],
    createData: passthroughDefault(blueprint.type),
    processorId: blueprint.canExecute ? blueprint.type : undefined,
    xnode: {
      title: blueprint.label,
      menuGroup: "Utility",
      preview: blueprint.type === "textSplitter" || blueprint.type === "urlSpawner" || blueprint.type === "loadLora"
        ? "text"
        : blueprint.type === "audioEnvironment"
          ? "audio"
          : blueprint.type === "videoMaskOverlay" || blueprint.type === "frameComposer"
            ? "video"
            : blueprint.type === "maskPainter"
              ? "canvas"
              : "image",
    },
  });
});

/**
 * Auto-register X-Node model blueprints from the reverse-engineered schema
 * registry. Each model becomes a separate node type with its own handle layout,
 * dimensions, and minimap colour — exactly mirroring the netlify behaviour.
 */
function xnodeOutputResolver(modelType: string) {
  return (node: WorkflowNode, sourceHandle?: string | null) => {
    const d = data(node);
    // Prefer the bucket matching the source handle's prefix.
    if (sourceHandle?.startsWith("video") && typeof d.outputVideo === "string") {
      return { type: "video" as const, value: d.outputVideo };
    }
    if (sourceHandle?.startsWith("audio") && typeof d.outputAudio === "string") {
      return { type: "audio" as const, value: d.outputAudio };
    }
    if (sourceHandle?.startsWith("text") && typeof d.outputText === "string") {
      return { type: "text" as const, value: d.outputText };
    }
    if (typeof d.outputImage === "string") {
      return { type: "image" as const, value: d.outputImage };
    }
    if (typeof d.outputVideo === "string") {
      return { type: "video" as const, value: d.outputVideo };
    }
    if (typeof d.outputAudio === "string") {
      return { type: "audio" as const, value: d.outputAudio };
    }
    if (typeof d.outputText === "string") {
      return { type: "text" as const, value: d.outputText };
    }
    void modelType;
    return { type: "image" as const, value: null };
  };
}

const xnodeMenuToCategory: Record<string, BlueprintCategory> = {
  Generate: "Generate",
  Utility: "Utility",
  Network: "Utility",
  Input: "Input",
  Output: "Output",
};

X_NODE_MODELS.forEach((model) => {
  registerBlueprint({
    type: model.type as NodeType,
    label: model.displayName,
    category: xnodeMenuToCategory[model.menuGroup] ?? "Utility",
    dimensions: model.dimensions,
    handles: {
      inputs: model.inputs.map((h) => h.id),
      outputs: model.outputs.map((h) => h.id),
    },
    createData: () => createDefaultNodeData(model.type as NodeType),
    getOutput: xnodeOutputResolver(model.type),
    canExecute: true,
    processorId: `xnode:${model.type}`,
    xnode: {
      title: model.displayName,
      menuGroup: model.menuGroup === "Network"
        ? "Network"
        : model.menuGroup === "Generate"
          ? "Generate"
          : model.menuGroup === "Input"
            ? "Input"
            : model.menuGroup === "Output"
              ? "Output"
              : "Utility",
      preview: model.outputs.some((h) => h.type === "video")
        ? "video"
        : model.outputs.some((h) => h.type === "audio")
          ? "audio"
          : model.outputs.some((h) => h.type === "text")
            ? "text"
            : "image",
      handleLabels: Object.fromEntries(
        [...model.inputs, ...model.outputs]
          .filter((h) => h.label)
          .map((h) => [h.id, h.label!] as const)
      ),
    },
  });
});

/**
 * Explicit Utility menu order — mirrors https://dev-x-node.netlify.app/ exactly.
 *
 * Keeps the legacy `annotation` (Konva canvas) and 4 video utility nodes registered
 * in the Utility category for backward compatibility with saved workflows, but hides
 * them from this menu (they remain accessible via the connection-drop menu / context
 * menu / loaded workflows).
 */
export const UTILITY_MENU_ORDER: NodeType[] = [
  "output",
  "splitGrid",
  "stickyNote",
  "textSplitter",
  "imageCompare",
  "maskPainter",
  "audioEnvironment",
  "blur",
  "reformat",
  "crop",
  "colorCorrection",
  "compositor",
  "videoMaskOverlay",
  "extractFrameCustom",
  "frameComposer",
  "loadLora",
  "switch",
  "forEachStart",
  "forEachEnd",
  "actionDirector",
  "urlSpawner",
  "mediaDownload",
];

/**
 * Network menu items — mirrors the netlify Network menu exactly.
 * Each entry is now a real node type backed by an X-Node blueprint.
 */
export const NETWORK_MENU_ORDER: NodeType[] = [
  "webhookTrigger" as NodeType,
  "webhookResponse" as NodeType,
  "dataForward" as NodeType,
  "dropboxUpload" as NodeType,
  "cloudinaryUpload" as NodeType,
];

/**
 * Legacy label-only export kept for tests that check menu labels directly.
 */
export const NETWORK_MENU_LABELS: readonly string[] = [
  "Webhook Trigger",
  "Webhook Response",
  "Data Forward",
  "Dropbox Upload",
  "Cloudinary Upload",
];

/**
 * Generate menu — 7 items, exact netlify order.
 *
 * The netlify labels differ from the model `displayName` (e.g. `nanoBanana`
 * displays as "Image" in this menu but "Nano Banana" elsewhere). Label
 * overrides live alongside the menu order so the FloatingActionBar matches
 * the netlify UI exactly.
 */
export const GENERATE_MENU_ORDER: Array<{ type: NodeType; label: string }> = [
  { type: "nanoBanana", label: "Image" },
  { type: "grokImagine" as NodeType, label: "Grok Edit" },
  { type: "kling26" as NodeType, label: "Video" },
  { type: "llmGenerate", label: "Text (LLM)" },
  { type: "generateTTS" as NodeType, label: "Speech (TTS)" },
  { type: "voiceChanger" as NodeType, label: "Voice Changer" },
  { type: "voiceIsolator" as NodeType, label: "Voice Isolator" },
];

/**
 * Returns the ordered Utility menu entries (type + label) for the FloatingActionBar.
 * Unknown types are silently dropped.
 */
export function getUtilityMenuItems(): Array<{ type: NodeType; label: string }> {
  return UTILITY_MENU_ORDER.flatMap((type) => {
    const blueprint = getBlueprint(type);
    return blueprint ? [{ type, label: blueprint.label }] : [];
  });
}

/**
 * Returns the ordered Network menu entries for the FloatingActionBar.
 */
export function getNetworkMenuItems(): Array<{ type: NodeType; label: string }> {
  return NETWORK_MENU_ORDER.flatMap((type) => {
    const blueprint = getBlueprint(type);
    return blueprint ? [{ type, label: blueprint.label }] : [];
  });
}

/**
 * Returns the ordered Generate menu entries for the FloatingActionBar.
 */
export function getGenerateMenuItems(): Array<{ type: NodeType; label: string }> {
  return GENERATE_MENU_ORDER.flatMap(({ type, label }) => {
    const blueprint = getBlueprint(type);
    return blueprint ? [{ type, label }] : [];
  });
}
