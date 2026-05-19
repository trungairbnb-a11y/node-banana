/**
 * Batch Execution Helper
 *
 * Detects batch mode (textItems from array nodes) and loops through items,
 * executing the appropriate node executor for each. Shared by executeWorkflow,
 * regenerateNode, and executeSelectedNodes.
 */

import { logger } from "@/utils/logger";
import type { WorkflowNodeData } from "@/types";
import type { NodeExecutionContext } from "./types";
import { executeNanoBanana } from "./nanoBananaExecutor";
import { executeGenerateVideo } from "./generateVideoExecutor";
import { executeGenerateAudio } from "./generateAudioExecutor";
import { executeLlmGenerate } from "./llmGenerateExecutor";

const BATCH_NODE_TYPES = new Set(["nanoBanana", "generateVideo", "generateAudio", "llmGenerate"]);
const DEFAULT_BATCH_CONCURRENCY = 3;

interface BatchFailure {
  index: number;
  prompt: string;
  error: string;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function clampConcurrency(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BATCH_CONCURRENCY;
  return Math.max(1, Math.min(10, Math.floor(value)));
}

function buildBatchError(totalItems: number, failures: BatchFailure[]): string {
  const successful = totalItems - failures.length;
  const examples = failures
    .slice(0, 3)
    .map((failure) => `#${failure.index + 1}: ${failure.error}`)
    .join("; ");
  const suffix = failures.length > 3 ? `; +${failures.length - 3} more` : "";
  return `Batch completed with ${successful}/${totalItems} successful. ${failures.length} failed${examples ? ` (${examples}${suffix})` : ""}.`;
}

function createBatchContext(
  executionCtx: NodeExecutionContext,
  item: string
): NodeExecutionContext {
  return {
    ...executionCtx,
    getConnectedInputs: (nodeId: string) => {
      const inputs = executionCtx.getConnectedInputs(nodeId);
      return {
        ...inputs,
        text: item,
        textItems: [],
      };
    },
  };
}

async function runNanoBananaBatch(
  executionCtx: NodeExecutionContext,
  items: string[],
  options?: { useStoredFallback?: boolean },
): Promise<void> {
  const { node } = executionCtx;
  const totalItems = items.length;
  const concurrency = clampConcurrency(executionCtx.maxConcurrentCalls);
  const failures: BatchFailure[] = [];
  let completed = 0;

  executionCtx.updateNodeData(node.id, {
    status: "loading",
    error: null,
    __batchProgress: { completed: 0, total: totalItems, failed: 0 },
  } as Partial<WorkflowNodeData>);

  for (let start = 0; start < totalItems; start += concurrency) {
    if (executionCtx.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const chunk = items.slice(start, start + concurrency);
    const results = await Promise.allSettled(
      chunk.map(async (item, chunkIndex) => {
        const index = start + chunkIndex;

        logger.info("node.execution", `Batch ${index + 1} of ${totalItems}`, {
          nodeId: node.id,
          nodeType: node.type,
          batchIndex: index,
          batchTotal: totalItems,
          batchConcurrency: concurrency,
        });

        try {
          await executeNanoBanana(createBatchContext(executionCtx, item), {
            ...options,
            preserveOutputOnFallback: true,
          });
        } catch (error) {
          if (isAbortError(error)) throw error;
          failures.push({ index, prompt: item, error: errorMessage(error) });
        } finally {
          completed += 1;
          if (!executionCtx.signal?.aborted && completed < totalItems) {
            executionCtx.updateNodeData(node.id, {
              status: "loading",
              error: null,
              __batchProgress: {
                completed,
                total: totalItems,
                failed: failures.length,
              },
            } as Partial<WorkflowNodeData>);
          }
        }
      })
    );

    const aborted = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected" && isAbortError(result.reason)
    );
    if (aborted) throw aborted.reason;
  }

  if (failures.length > 0) {
    const message = buildBatchError(totalItems, failures);
    executionCtx.updateNodeData(node.id, {
      status: "error",
      error: message,
      __batchProgress: {
        completed: totalItems,
        total: totalItems,
        failed: failures.length,
      },
    } as Partial<WorkflowNodeData>);
    throw new Error(message);
  }

  executionCtx.updateNodeData(node.id, {
    status: "complete",
    error: null,
    __batchProgress: undefined,
  } as Partial<WorkflowNodeData>);
}

/**
 * Attempts to run batch execution for a node.
 *
 * If the node type supports batching and has textItems from upstream array
 * nodes, iterates through each item and runs the executor individually.
 *
 * @returns `true` if batch execution was performed, `false` if the node
 *          should proceed with normal single-item execution.
 */
export async function runBatchIfApplicable(
  executionCtx: NodeExecutionContext,
  options?: { useStoredFallback?: boolean },
): Promise<boolean> {
  const { node } = executionCtx;

  if (!node.type || !BATCH_NODE_TYPES.has(node.type)) {
    return false;
  }

  const connectedInputs = executionCtx.getConnectedInputs(node.id);
  if (connectedInputs.textItems.length === 0) {
    return false;
  }

  const items = connectedInputs.textItems;
  const totalItems = items.length;

  if (node.type === "nanoBanana") {
    await runNanoBananaBatch(executionCtx, items, options);
    return true;
  }

  for (let i = 0; i < totalItems; i++) {
    if (executionCtx.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    executionCtx.updateNodeData(node.id, {
      status: "loading",
      error: null,
    } as Partial<WorkflowNodeData>);

    logger.info("node.execution", `Batch ${i + 1} of ${totalItems}`, {
      nodeId: node.id,
      nodeType: node.type,
      batchIndex: i,
      batchTotal: totalItems,
    });

    // Wrap context so getConnectedInputs returns current batch item as text
    const batchCtx = createBatchContext(executionCtx, items[i]);

    switch (node.type) {
      case "generateVideo":
        await executeGenerateVideo(batchCtx, options);
        break;
      case "generateAudio":
        await executeGenerateAudio(batchCtx, options);
        break;
      case "llmGenerate":
        await executeLlmGenerate(batchCtx, options);
        break;
    }

    if (i < totalItems - 1) {
      executionCtx.updateNodeData(node.id, {
        status: "loading",
      } as Partial<WorkflowNodeData>);
    }
  }

  return true;
}
