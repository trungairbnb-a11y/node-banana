import type {
  GenerateVideoNodeData,
  ModelInputDef,
  NanoBananaNodeData,
  ProviderSettings,
  ProviderType,
  SelectedModel,
  WorkflowNode,
  WorkflowNodeData,
} from "@/types";
import { MODEL_DISPLAY_NAMES } from "@/types";
import {
  DEFAULT_FLOW_MODEL,
  FLOW_MODELS,
  buildFlowParametersForModel,
  getFlowSchemaForModel,
} from "@/lib/flow/modes";

export type ModelRetargetMediaType = "image" | "video";

export type ModelRetargetAction = "retarget-primary" | "clear-fallback";

export type ModelRetargetEnvStatus = Partial<
  Record<ProviderType, boolean>
>;

export interface ModelRetargetIssue {
  nodeId: string;
  nodeType: "nanoBanana" | "generateVideo";
  nodeLabel: string;
  mediaType: ModelRetargetMediaType;
  currentModel: SelectedModel | null;
  fallbackModel: SelectedModel | null;
  primaryReason: string | null;
  fallbackReason: string | null;
  action: ModelRetargetAction;
  imageTargetAvailable: boolean;
  flowTargetAvailable: boolean;
}

export interface ModelRetargetSelection {
  skip?: boolean;
  flowModelId?: string;
}

export const CCS_OPENAI_IMAGE_MODEL: SelectedModel = {
  provider: "openai",
  modelId: "gpt-image-2",
  displayName: "CCS / OpenAI-compatible - GPT Image 2",
  capabilities: ["text-to-image", "image-to-image"],
};

export function fetchModelRetargetEnvStatus(): Promise<ModelRetargetEnvStatus> {
  return fetch("/api/env-status")
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}));
}

function providerName(provider: ProviderType): string {
  switch (provider) {
    case "gemini":
      return "Gemini";
    case "openai":
      return "OpenAI/CCS-compatible";
    case "ccs":
      return "CCS";
    case "anthropic":
      return "Anthropic";
    case "replicate":
      return "Replicate";
    case "fal":
      return "fal.ai";
    case "kie":
      return "Kie.ai";
    case "wavespeed":
      return "WaveSpeed";
    case "flow":
      return "Google Flow";
    default:
      return provider;
  }
}

function getProviderConfig(providerSettings: ProviderSettings, provider: ProviderType) {
  return providerSettings.providers[provider];
}

function providerHasKey(
  providerSettings: ProviderSettings,
  envStatus: ModelRetargetEnvStatus,
  provider: ProviderType
): boolean {
  return Boolean(getProviderConfig(providerSettings, provider)?.apiKey || envStatus[provider]);
}

export function isOpenAICompatibleImageTargetAvailable(
  providerSettings: ProviderSettings,
  envStatus: ModelRetargetEnvStatus = {}
): boolean {
  const openai = getProviderConfig(providerSettings, "openai");
  return openai?.enabled !== false && providerHasKey(providerSettings, envStatus, "openai");
}

export function isFlowTargetAvailable(
  providerSettings: ProviderSettings,
  envStatus: ModelRetargetEnvStatus = {}
): boolean {
  const flow = getProviderConfig(providerSettings, "flow");
  return flow?.enabled !== false && envStatus.flow !== false;
}

function providerUnavailableReason(
  model: SelectedModel,
  providerSettings: ProviderSettings,
  envStatus: ModelRetargetEnvStatus
): string | null {
  const provider = model.provider;
  const config = getProviderConfig(providerSettings, provider);

  if (!model.modelId) {
    return "No model is selected";
  }

  if (config?.enabled === false) {
    return `${providerName(provider)} is disabled in Settings`;
  }

  if (provider === "ccs") {
    return "Direct CCS generation provider is not supported; use the OpenAI-compatible image route";
  }

  if (provider === "anthropic") {
    return "Anthropic is only supported for LLM nodes";
  }

  if (provider === "flow") {
    return isFlowTargetAvailable(providerSettings, envStatus)
      ? null
      : "Google Flow is disabled or unavailable";
  }

  if (provider === "fal") {
    return null;
  }

  if (provider === "gemini") {
    return providerHasKey(providerSettings, envStatus, "gemini")
      ? null
      : "Gemini API key is not configured";
  }

  if (provider === "openai") {
    return providerHasKey(providerSettings, envStatus, "openai")
      ? null
      : "OpenAI/CCS-compatible API key is not configured";
  }

  if (provider === "kie" || provider === "replicate" || provider === "wavespeed") {
    return providerHasKey(providerSettings, envStatus, provider)
      ? null
      : `${providerName(provider)} API key is not configured`;
  }

  return null;
}

function mediaCompatibilityReason(model: SelectedModel, mediaType: ModelRetargetMediaType): string | null {
  const capabilities = model.capabilities ?? [];

  if (mediaType === "image") {
    if (model.provider === "flow") return "Google Flow is video-only";
    if (model.provider === "openai") return null;
    if (capabilities.length === 0) return null;
    return capabilities.some((capability) => capability === "text-to-image" || capability === "image-to-image")
      ? null
      : "Selected model does not advertise image generation support";
  }

  if (model.provider === "flow") return null;
  if (model.provider === "openai" || model.provider === "ccs") {
    return "OpenAI-compatible image models cannot generate video";
  }
  if (model.provider === "gemini" && !model.modelId.startsWith("veo-")) {
    return "Selected Gemini model is not a video model";
  }
  if (capabilities.length === 0) return null;
  return capabilities.some(
    (capability) =>
      capability === "text-to-video" ||
      capability === "image-to-video" ||
      capability === "audio-to-video"
  )
    ? null
    : "Selected model does not advertise video generation support";
}

function selectedModelForNode(node: WorkflowNode): SelectedModel | null {
  if (node.type === "nanoBanana") {
    const data = node.data as NanoBananaNodeData;
    if (data.selectedModel) return data.selectedModel;
    if (data.model) {
      return {
        provider: "gemini",
        modelId: data.model,
        displayName: MODEL_DISPLAY_NAMES[data.model] || data.model,
      };
    }
  }

  if (node.type === "generateVideo") {
    const data = node.data as GenerateVideoNodeData;
    return data.selectedModel ?? null;
  }

  return null;
}

function fallbackModelForNode(node: WorkflowNode): SelectedModel | null {
  const data = node.data as { fallbackModel?: SelectedModel };
  return data.fallbackModel ?? null;
}

function nodeLabel(node: WorkflowNode, selectedModel: SelectedModel | null): string {
  const data = node.data as { customTitle?: unknown; label?: unknown };
  if (typeof data.customTitle === "string" && data.customTitle.trim()) return data.customTitle.trim();
  if (typeof data.label === "string" && data.label.trim()) return data.label.trim();
  return selectedModel?.displayName || (node.type === "nanoBanana" ? "Generate Image" : "Generate Video");
}

function selectedModelIssueReason(
  model: SelectedModel | null,
  mediaType: ModelRetargetMediaType,
  providerSettings: ProviderSettings,
  envStatus: ModelRetargetEnvStatus
): string | null {
  if (!model) return "No model is selected";
  return (
    providerUnavailableReason(model, providerSettings, envStatus) ||
    mediaCompatibilityReason(model, mediaType)
  );
}

export function scanWorkflowForModelRetargets(
  nodes: WorkflowNode[],
  providerSettings: ProviderSettings,
  envStatus: ModelRetargetEnvStatus = {}
): ModelRetargetIssue[] {
  const imageTargetAvailable = isOpenAICompatibleImageTargetAvailable(providerSettings, envStatus);
  const flowTargetAvailable = isFlowTargetAvailable(providerSettings, envStatus);
  const issues: ModelRetargetIssue[] = [];

  for (const node of nodes) {
    if (node.type !== "nanoBanana" && node.type !== "generateVideo") continue;

    const mediaType: ModelRetargetMediaType = node.type === "nanoBanana" ? "image" : "video";
    const currentModel = selectedModelForNode(node);
    const fallbackModel = fallbackModelForNode(node);
    const primaryReason = selectedModelIssueReason(currentModel, mediaType, providerSettings, envStatus);
    const fallbackReason = fallbackModel
      ? selectedModelIssueReason(fallbackModel, mediaType, providerSettings, envStatus)
      : null;

    if (!primaryReason && !fallbackReason) continue;

    issues.push({
      nodeId: node.id,
      nodeType: node.type,
      nodeLabel: nodeLabel(node, currentModel),
      mediaType,
      currentModel,
      fallbackModel,
      primaryReason,
      fallbackReason,
      action: primaryReason ? "retarget-primary" : "clear-fallback",
      imageTargetAvailable,
      flowTargetAvailable,
    });
  }

  return issues;
}

function sameModel(a: SelectedModel | null | undefined, b: SelectedModel | null | undefined): boolean {
  return Boolean(a && b && a.provider === b.provider && a.modelId === b.modelId);
}

function flowSelectedModel(modelId?: string): SelectedModel {
  const model = FLOW_MODELS.find((candidate) => candidate.id === modelId) ?? DEFAULT_FLOW_MODEL;
  return {
    provider: "flow",
    modelId: model.id,
    displayName: model.name,
    capabilities: model.capabilities,
  };
}

function flowInputSchema(modelId: string): ModelInputDef[] | undefined {
  const schema = getFlowSchemaForModel(modelId);
  return schema?.inputs.map((input) => ({ ...input }));
}

export function buildModelRetargetPatch(
  node: WorkflowNode,
  issue: ModelRetargetIssue,
  selection: ModelRetargetSelection = {}
): Partial<WorkflowNodeData> | null {
  if (selection.skip) return null;

  if (issue.action === "clear-fallback") {
    return {
      fallbackModel: undefined,
      fallbackParameters: undefined,
      status: "idle",
      error: null,
    } as Partial<WorkflowNodeData>;
  }

  const clearFallback =
    Boolean(issue.fallbackReason) ||
    sameModel(issue.fallbackModel, issue.mediaType === "image" ? CCS_OPENAI_IMAGE_MODEL : flowSelectedModel(selection.flowModelId));

  if (issue.mediaType === "image") {
    return {
      selectedModel: CCS_OPENAI_IMAGE_MODEL,
      parameters: {},
      inputSchema: undefined,
      ...(clearFallback ? { fallbackModel: undefined, fallbackParameters: undefined } : {}),
      status: "idle",
      error: null,
    } as Partial<NanoBananaNodeData>;
  }

  const selectedModel = flowSelectedModel(selection.flowModelId);
  return {
    selectedModel,
    parameters: buildFlowParametersForModel(selectedModel.modelId, (node.data as GenerateVideoNodeData).parameters || {}),
    inputSchema: flowInputSchema(selectedModel.modelId),
    ...(clearFallback ? { fallbackModel: undefined, fallbackParameters: undefined } : {}),
    status: "idle",
    error: null,
  } as Partial<GenerateVideoNodeData>;
}

export function applyWorkflowModelRetargets(
  nodes: WorkflowNode[],
  issues: ModelRetargetIssue[],
  selections: Record<string, ModelRetargetSelection>
): WorkflowNode[] {
  const issueByNodeId = new Map(issues.map((issue) => [issue.nodeId, issue]));
  return nodes.map((node) => {
    const issue = issueByNodeId.get(node.id);
    if (!issue) return node;
    const patch = buildModelRetargetPatch(node, issue, selections[node.id]);
    return patch ? { ...node, data: { ...node.data, ...patch } } : node;
  });
}
