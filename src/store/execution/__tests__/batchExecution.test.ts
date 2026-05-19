import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowNode } from "@/types";
import type { NodeExecutionContext } from "../types";

const { mockExecuteNanoBanana } = vi.hoisted(() => ({
  mockExecuteNanoBanana: vi.fn(),
}));

vi.mock("../nanoBananaExecutor", () => ({
  executeNanoBanana: mockExecuteNanoBanana,
}));

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
  },
}));

import { runBatchIfApplicable } from "../batchExecution";

function makeDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeNode(): WorkflowNode {
  return {
    id: "gen-1",
    type: "nanoBanana",
    position: { x: 0, y: 0 },
    data: {
      inputImages: [],
      inputPrompt: null,
      outputImage: null,
      aspectRatio: "1:1",
      resolution: "1K",
      model: "nano-banana",
      selectedModel: { provider: "openai", modelId: "gpt-image-2", displayName: "GPT Image 2" },
      useGoogleSearch: false,
      useImageSearch: false,
      status: "idle",
      error: null,
      imageHistory: [],
      selectedHistoryIndex: 0,
    },
  } as WorkflowNode;
}

function makeCtx(
  textItems: string[],
  overrides: Partial<NodeExecutionContext> = {}
): NodeExecutionContext {
  const node = makeNode();
  return {
    node,
    getConnectedInputs: vi.fn().mockReturnValue({
      images: [],
      videos: [],
      audio: [],
      model3d: null,
      text: textItems[0] ?? null,
      textItems,
      dynamicInputs: {},
      easeCurve: null,
    }),
    updateNodeData: vi.fn(),
    getFreshNode: vi.fn().mockReturnValue(node),
    getEdges: vi.fn().mockReturnValue([]),
    getNodes: vi.fn().mockReturnValue([node]),
    maxConcurrentCalls: 2,
    providerSettings: {
      providers: {
        gemini: { id: "gemini", name: "Gemini", enabled: true, apiKey: null },
        openai: { id: "openai", name: "OpenAI", enabled: true, apiKey: "test-key" },
        ccs: { id: "ccs", name: "CCS", enabled: true, apiKey: null },
        anthropic: { id: "anthropic", name: "Anthropic", enabled: true, apiKey: null },
        replicate: { id: "replicate", name: "Replicate", enabled: false, apiKey: null },
        fal: { id: "fal", name: "fal.ai", enabled: false, apiKey: null },
        kie: { id: "kie", name: "Kie.ai", enabled: false, apiKey: null },
        wavespeed: { id: "wavespeed", name: "WaveSpeed", enabled: false, apiKey: null },
        flow: { id: "flow", name: "Google Flow", enabled: true, apiKey: null },
      },
    },
    addIncurredCost: vi.fn(),
    addToGlobalHistory: vi.fn(),
    generationsPath: null,
    saveDirectoryPath: null,
    trackSaveGeneration: vi.fn(),
    appendOutputGalleryImage: vi.fn(),
    get: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runBatchIfApplicable", () => {
  it("runs nanoBanana batch prompts in parallel chunks capped by maxConcurrentCalls", async () => {
    const prompts = ["one", "two", "three", "four", "five"];
    const deferreds: ReturnType<typeof makeDeferred>[] = [];
    const sentPrompts: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    mockExecuteNanoBanana.mockImplementation(async (ctx: NodeExecutionContext) => {
      const prompt = ctx.getConnectedInputs(ctx.node.id).text;
      sentPrompts.push(prompt ?? "");
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const deferred = makeDeferred();
      deferreds.push(deferred);
      await deferred.promise;
      inFlight -= 1;
    });

    const ctx = makeCtx(prompts, { maxConcurrentCalls: 2 });
    const batchPromise = runBatchIfApplicable(ctx);
    await flushAsync();

    expect(mockExecuteNanoBanana).toHaveBeenCalledTimes(2);
    expect(sentPrompts).toEqual(["one", "two"]);

    deferreds[0].resolve();
    deferreds[1].resolve();
    await flushAsync();

    expect(mockExecuteNanoBanana).toHaveBeenCalledTimes(4);
    expect(sentPrompts).toEqual(["one", "two", "three", "four"]);

    deferreds[2].resolve();
    deferreds[3].resolve();
    await flushAsync();

    expect(mockExecuteNanoBanana).toHaveBeenCalledTimes(5);
    expect(sentPrompts).toEqual(prompts);

    deferreds[4].resolve();
    await expect(batchPromise).resolves.toBe(true);

    expect(maxInFlight).toBe(2);
    expect(ctx.updateNodeData).toHaveBeenCalledWith(
      "gen-1",
      expect.objectContaining({
        status: "complete",
        error: null,
        __batchProgress: undefined,
      })
    );
  });

  it("keeps successful batch images and reports a summary error for failed prompts", async () => {
    const prompts = ["good one", "bad", "good two"];
    const ctx = makeCtx(prompts, { maxConcurrentCalls: 3 });

    mockExecuteNanoBanana.mockImplementation(async (batchCtx: NodeExecutionContext) => {
      const prompt = batchCtx.getConnectedInputs(batchCtx.node.id).text;
      if (prompt === "bad") {
        throw new Error("provider rejected prompt");
      }
      batchCtx.appendOutputGalleryImage("gallery-1", `image:${prompt}`);
    });

    await expect(runBatchIfApplicable(ctx)).rejects.toThrow("Batch completed with 2/3 successful");

    expect(ctx.appendOutputGalleryImage).toHaveBeenCalledTimes(2);
    expect(ctx.appendOutputGalleryImage).toHaveBeenCalledWith("gallery-1", "image:good one");
    expect(ctx.appendOutputGalleryImage).toHaveBeenCalledWith("gallery-1", "image:good two");

    const errorCall = (ctx.updateNodeData as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => (call[1] as Record<string, unknown>).status === "error"
    );
    expect(errorCall).toBeDefined();
    expect((errorCall![1] as Record<string, unknown>).error).toContain("1 failed");
    expect((errorCall![1] as Record<string, unknown>).__batchProgress).toEqual({
      completed: 3,
      total: 3,
      failed: 1,
    });
  });

  it("returns false and does not execute when no batch text items are present", async () => {
    const ctx = makeCtx([]);

    await expect(runBatchIfApplicable(ctx)).resolves.toBe(false);

    expect(mockExecuteNanoBanana).not.toHaveBeenCalled();
  });
});
