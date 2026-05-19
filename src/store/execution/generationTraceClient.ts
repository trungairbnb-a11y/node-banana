import type {
  ConnectedInputs,
} from "@/store/utils/connectedInputs";
import { getSourceOutput } from "@/store/utils/connectedInputs";
import type {
  GenerationTraceInputSummary,
  GenerationTraceMediaRef,
  GenerationTraceRequestContext,
  WorkflowEdge,
  WorkflowNode,
} from "@/types";

function createTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function mediaSummary(value: string, index: number, role: string, kind: "image" | "video" | "audio"): GenerationTraceMediaRef {
  const match = value.match(/^data:([^;,]+)?(?:;base64)?,/i);
  return {
    index,
    role,
    kind,
    mime: match?.[1] ?? null,
    bytes: value.startsWith("data:") ? Math.round(value.length * 0.75) : value.length,
    sha256: null,
    dimensions: null,
    isDataUri: value.startsWith("data:"),
    url: /^https?:\/\//i.test(value) || value.startsWith("/api/") ? value : null,
    providerRef: null,
  };
}

function summarizeDynamicInputs(dynamicInputs: Record<string, string | string[]>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dynamicInputs)) {
    const isMedia = /image|frame|video|audio|ref/i.test(key);
    if (Array.isArray(value)) {
      summary[key] = isMedia
        ? value.map((item, index) => mediaSummary(item, index, key, key.toLowerCase().includes("video") ? "video" : "image"))
        : value;
    } else {
      summary[key] = isMedia ? mediaSummary(value, 0, key, key.toLowerCase().includes("video") ? "video" : "image") : value;
    }
  }
  return summary;
}

function attachEdgeMetadata(
  refs: GenerationTraceMediaRef[],
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): GenerationTraceMediaRef[] {
  const incoming = edges.filter((edge) => edge.target === nodeId && !edge.data?.isLoop);
  return refs.map((ref) => {
    const edge = incoming.find((candidate) => {
      const source = nodes.find((node) => node.id === candidate.source);
      if (!source) return false;
      const output = getSourceOutput(source, candidate.sourceHandle, candidate.data as Record<string, unknown> | undefined);
      if (!output.value) return false;
      if (ref.kind === "image" && output.type !== "image") return false;
      if (ref.kind === "video" && output.type !== "video") return false;
      return true;
    });
    return {
      ...ref,
      sourceNodeId: edge?.source ?? null,
      sourceHandle: edge?.sourceHandle ?? null,
      targetHandle: edge?.targetHandle ?? null,
    };
  });
}

export function buildGenerationTraceContext(input: {
  sessionId?: string | null;
  nodeId: string;
  nodeType: string;
  workflowId?: string | null;
  connectedInputs: ConnectedInputs;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  fallbackAttempt?: string | null;
}): GenerationTraceRequestContext {
  const imageRefs = input.connectedInputs.images.map((image, index) =>
    mediaSummary(image, index, "inputImages", "image")
  );
  const videoRefs = input.connectedInputs.videos.map((video, index) =>
    mediaSummary(video, index, "inputVideos", "video")
  );
  const audioRefs = input.connectedInputs.audio.map((audio, index) =>
    mediaSummary(audio, index, "inputAudio", "audio")
  );

  const connectedInputs: GenerationTraceInputSummary = {
    text: input.connectedInputs.text,
    images: attachEdgeMetadata(imageRefs, input.nodeId, input.nodes, input.edges),
    videos: attachEdgeMetadata(videoRefs, input.nodeId, input.nodes, input.edges),
    audio: attachEdgeMetadata(audioRefs, input.nodeId, input.nodes, input.edges),
    dynamicInputs: summarizeDynamicInputs(input.connectedInputs.dynamicInputs),
  };

  return {
    traceId: createTraceId(),
    sessionId: input.sessionId ?? null,
    nodeId: input.nodeId,
    nodeType: input.nodeType,
    workflowId: input.workflowId ?? null,
    connectedInputs,
    fallbackAttempt: input.fallbackAttempt ?? null,
  };
}
