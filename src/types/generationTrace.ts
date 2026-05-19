import type { ProviderType, SelectedModel } from "./providers";

export interface GenerationTraceMediaRef {
  index: number;
  role: string;
  kind: "image" | "video" | "audio";
  sourceNodeId?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  schemaName?: string | null;
  mime?: string | null;
  bytes?: number | null;
  sha256?: string | null;
  dimensions?: { width: number; height: number } | null;
  isDataUri?: boolean;
  url?: string | null;
  providerRef?: string | null;
}

export interface GenerationTraceInputSummary {
  text: string | null;
  images: GenerationTraceMediaRef[];
  videos: GenerationTraceMediaRef[];
  audio?: GenerationTraceMediaRef[];
  dynamicInputs: Record<string, unknown>;
}

export interface GenerationTrace {
  traceId: string;
  requestId?: string;
  sessionId?: string | null;
  nodeId?: string | null;
  nodeType?: string | null;
  workflowId?: string | null;
  timestamp: string;
  selectedModel?: SelectedModel | null;
  provider?: ProviderType | string | null;
  mediaType?: string | null;
  parameters?: Record<string, unknown> | null;
  fallbackAttempt?: string | null;
  connectedInputs?: GenerationTraceInputSummary;
  resolvedPrompt: string;
  mediaRefs: GenerationTraceMediaRef[];
  providerPayload?: Record<string, unknown> | null;
  response?: Record<string, unknown> | null;
  error?: string | null;
  warnings?: string[];
  logPath?: string | null;
}

export interface GenerationTraceRequestContext {
  traceId?: string;
  sessionId?: string | null;
  nodeId?: string | null;
  nodeType?: string | null;
  workflowId?: string | null;
  connectedInputs?: GenerationTraceInputSummary;
  fallbackAttempt?: string | null;
}
