/**
 * Shared data shape for X-Node AI model nodes (auto-generated from the
 * reverse-engineered netlify bundle — see `src/lib/xnode/models.ts`).
 *
 * Each model has a slightly different parameter set; rather than declaring
 * 72 distinct interfaces we use a single permissive interface and let the
 * schema-driven `XNodeAIModelNode` component drive the UI.
 *
 * The shape intentionally keeps every parameter optional so a freshly added
 * model can flow through `createDefaultNodeData` without TypeScript noise.
 */

import type { BaseNodeData } from "./annotation";
import type { NodeStatus } from "./nodes";

export interface XNodeModelNodeData extends BaseNodeData {
  // Common output buckets — exactly one of these is populated based on the
  // model's declared output type.
  outputImage?: string | null;
  outputImages?: string[];
  outputVideo?: string | null;
  outputAudio?: string | null;
  outputText?: string | null;

  // Common input buckets — populated via connected upstream nodes.
  inputPrompt?: string | null;
  inputImage?: string | null;
  inputImages?: string[];
  inputVideo?: string | null;
  inputAudio?: string | null;
  inputText?: string | null;
  negativePrompt?: string;

  // Common model parameters used by many AI models.
  aspectRatio?: string;
  duration?: string | number;
  resolution?: string;
  seed?: number;

  // Execution state.
  status?: NodeStatus;
  error?: string | null;
  progress?: number;

  // Free-form bucket for model-specific parameters extracted from the
  // reverse-engineered blueprint schema. Render via XNodeAIModelNode.
  parameters?: Record<string, unknown>;
}
