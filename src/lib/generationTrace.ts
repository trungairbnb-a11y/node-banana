import * as fs from "fs/promises";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import type {
  GenerationTrace,
  GenerationTraceInputSummary,
  GenerationTraceMediaRef,
  GenerationTraceRequestContext,
  SelectedModel,
} from "@/types";

const TRACE_LIMIT = 50;

export function createTraceId(): string {
  return `trace_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function traceDir(): string {
  return path.join(process.cwd(), "logs", "generation-traces");
}

function safeFilenamePart(value: string | null | undefined): string {
  return (value || "unknown").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
}

function byteLengthFromBase64(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function summarizeDataUri(value: string): Pick<GenerationTraceMediaRef, "mime" | "bytes" | "sha256" | "isDataUri"> {
  const match = value.match(/^data:([^;,]+)?(?:;[^,]*)?,([\s\S]*)$/);
  if (!match) {
    return {
      mime: null,
      bytes: value.length,
      sha256: createHash("sha256").update(value).digest("hex"),
      isDataUri: false,
    };
  }
  const mime = match[1] || null;
  const payload = match[2] || "";
  const isBase64 = /;base64,/i.test(value.slice(0, value.indexOf(",") + 1));
  const buffer = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf-8");
  return {
    mime,
    bytes: isBase64 ? byteLengthFromBase64(payload) : buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    isDataUri: true,
  };
}

export function summarizeMediaRef(input: {
  value: string;
  index: number;
  role: string;
  kind: "image" | "video" | "audio";
  sourceNodeId?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  schemaName?: string | null;
  providerRef?: string | null;
}): GenerationTraceMediaRef {
  const value = input.value;
  const isDataUri = value.startsWith("data:");
  const url = /^https?:\/\//i.test(value) || value.startsWith("/api/") ? value : null;
  const dataSummary = isDataUri ? summarizeDataUri(value) : {
    mime: null,
    bytes: value.length,
    sha256: createHash("sha256").update(value).digest("hex"),
    isDataUri: false,
  };

  return {
    index: input.index,
    role: input.role,
    kind: input.kind,
    sourceNodeId: input.sourceNodeId ?? null,
    sourceHandle: input.sourceHandle ?? null,
    targetHandle: input.targetHandle ?? null,
    schemaName: input.schemaName ?? null,
    ...dataSummary,
    dimensions: null,
    url,
    providerRef: input.providerRef ?? null,
  };
}

function summarizeUnknownMedia(value: unknown, index: number, role: string): GenerationTraceMediaRef | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const kind = role.toLowerCase().includes("video") ? "video" : role.toLowerCase().includes("audio") ? "audio" : "image";
  return summarizeMediaRef({ value, index, role, kind });
}

export function summarizeDynamicInputs(dynamicInputs?: Record<string, string | string[]>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  if (!dynamicInputs) return summary;

  for (const [key, value] of Object.entries(dynamicInputs)) {
    const keyLooksMedia = /image|frame|video|audio|ref/i.test(key);
    if (Array.isArray(value)) {
      summary[key] = keyLooksMedia
        ? value.map((item, index) => summarizeUnknownMedia(item, index, key)).filter(Boolean)
        : value;
    } else {
      summary[key] = keyLooksMedia ? summarizeUnknownMedia(value, 0, key) : value;
    }
  }
  return summary;
}

export function sanitizeProviderPayload(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) return summarizeUnknownMedia(value, 0, "payload-media");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeProviderPayload(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/api[-_]?key|authorization|token|cookie/i.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = sanitizeProviderPayload(item);
      }
    }
    return out;
  }
  return value;
}

export function buildTraceWarnings(input: {
  resolvedPrompt: string;
  topLevelPrompt?: string | null;
  dynamicPrompt?: string | string[] | null;
  inputImageHashes?: string[];
  providerImageHashes?: string[];
}): string[] {
  const warnings: string[] = [];
  if (!input.resolvedPrompt.trim()) warnings.push("Resolved prompt is empty.");
  const unresolved = Array.from(new Set(input.resolvedPrompt.match(/@\w+/g) ?? []));
  if (unresolved.length > 0) warnings.push(`Unresolved prompt variables remain: ${unresolved.join(", ")}`);

  const dynamicPrompt = Array.isArray(input.dynamicPrompt) ? input.dynamicPrompt[0] : input.dynamicPrompt;
  if (
    input.topLevelPrompt &&
    dynamicPrompt &&
    input.topLevelPrompt.trim() !== dynamicPrompt.trim()
  ) {
    warnings.push("Top-level prompt differs from dynamicInputs.prompt; provider will use its prompt precedence.");
  }

  if (
    input.inputImageHashes &&
    input.providerImageHashes &&
    input.inputImageHashes.length === input.providerImageHashes.length &&
    input.inputImageHashes.some((hash, index) => hash !== input.providerImageHashes?.[index])
  ) {
    warnings.push("Provider image order differs from node input image order.");
  }
  return warnings;
}

export function buildGenerationTrace(input: {
  requestId: string;
  context?: GenerationTraceRequestContext;
  selectedModel?: SelectedModel | null;
  provider?: string | null;
  mediaType?: string | null;
  parameters?: Record<string, unknown> | null;
  resolvedPrompt: string;
  mediaRefs: GenerationTraceMediaRef[];
  connectedInputs?: GenerationTraceInputSummary;
  providerPayload?: Record<string, unknown> | null;
  response?: Record<string, unknown> | null;
  error?: string | null;
  warnings?: string[];
}): GenerationTrace {
  const traceId = input.context?.traceId || createTraceId();
  return {
    traceId,
    requestId: input.requestId,
    sessionId: input.context?.sessionId ?? null,
    nodeId: input.context?.nodeId ?? null,
    nodeType: input.context?.nodeType ?? null,
    workflowId: input.context?.workflowId ?? null,
    timestamp: new Date().toISOString(),
    selectedModel: input.selectedModel ?? null,
    provider: input.provider ?? null,
    mediaType: input.mediaType ?? null,
    parameters: input.parameters ?? null,
    fallbackAttempt: input.context?.fallbackAttempt ?? null,
    connectedInputs: input.connectedInputs ?? input.context?.connectedInputs,
    resolvedPrompt: input.resolvedPrompt,
    mediaRefs: input.mediaRefs,
    providerPayload: sanitizeProviderPayload(input.providerPayload) as Record<string, unknown> | null,
    response: input.response ?? null,
    error: input.error ?? null,
    warnings: input.warnings ?? [],
    logPath: null,
  };
}

export async function saveGenerationTrace(trace: GenerationTrace): Promise<GenerationTrace> {
  try {
    const dir = traceDir();
    await fs.mkdir(dir, { recursive: true });
    const filename = `trace-${Date.now()}-${safeFilenamePart(trace.nodeId)}-${safeFilenamePart(trace.requestId)}.json`;
    const filepath = path.join(dir, filename);
    const withPath = { ...trace, logPath: filepath };
    await fs.writeFile(filepath, JSON.stringify(withPath, null, 2), "utf-8");
    await rotateGenerationTraces(dir);
    return withPath;
  } catch (error) {
    console.warn("[generation-trace] Failed to save trace:", error);
    return trace;
  }
}

async function rotateGenerationTraces(dir: string): Promise<void> {
  try {
    const files = (await fs.readdir(dir))
      .filter((file) => file.startsWith("trace-") && file.endsWith(".json"))
      .sort()
      .reverse();
    for (const file of files.slice(TRACE_LIMIT)) {
      await fs.unlink(path.join(dir, file)).catch(() => {});
    }
  } catch {
    // Non-fatal.
  }
}
