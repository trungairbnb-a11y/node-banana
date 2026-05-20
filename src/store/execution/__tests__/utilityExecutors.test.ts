import { describe, expect, it, vi } from "vitest";
import {
  executeLoadLora,
  executeTextSplitter,
  executeXNodeModelNode,
  getUtilityExecutor,
} from "../utilityExecutors";
import type { NodeExecutionContext } from "../types";
import type { WorkflowNode, WorkflowNodeData } from "@/types";

function makeContext(node: WorkflowNode, overrides: Partial<NodeExecutionContext> = {}) {
  const updates: Array<Partial<WorkflowNodeData>> = [];
  const ctx: NodeExecutionContext = {
    node,
    getConnectedInputs: vi.fn(() => ({
      images: [],
      videos: [],
      audio: [],
      model3d: null,
      text: null,
      textItems: [],
      dynamicInputs: {},
      easeCurve: null,
    })),
    updateNodeData: vi.fn((_id, data) => updates.push(data)),
    getFreshNode: vi.fn(() => node),
    getEdges: vi.fn(() => []),
    getNodes: vi.fn(() => [node]),
    providerSettings: {},
    addIncurredCost: vi.fn(),
    addToGlobalHistory: vi.fn(),
    generationsPath: null,
    saveDirectoryPath: null,
    trackSaveGeneration: vi.fn(),
    appendOutputGalleryImage: vi.fn(),
    get: vi.fn(),
    ...overrides,
  };
  return { ctx, updates };
}

describe("utilityExecutors", () => {
  it("registers utility executors", () => {
    expect(getUtilityExecutor("textSplitter")).toBe(executeTextSplitter);
    expect(getUtilityExecutor("mediaDownload")).toBeTypeOf("function");
    expect(getUtilityExecutor("dropboxUpload")).toBeUndefined();
  });

  it("splits connected text into dynamic outputs", async () => {
    const node = {
      id: "textSplitter-1",
      type: "textSplitter",
      position: { x: 0, y: 0 },
      data: {
        inputText: null,
        delimiter: ",",
        trimItems: true,
        removeEmpty: true,
        maxOutputs: 10,
        outputItems: [],
        outputText: null,
        status: "idle",
        error: null,
      },
    } as WorkflowNode;
    const { ctx, updates } = makeContext(node, {
      getConnectedInputs: vi.fn(() => ({
        images: [],
        videos: [],
        audio: [],
        model3d: null,
        text: " alpha, beta, ,gamma ",
        textItems: [],
        dynamicInputs: {},
        easeCurve: null,
      })),
    });

    await executeTextSplitter(ctx);

    expect(updates.at(-1)).toMatchObject({
      inputText: " alpha, beta, ,gamma ",
      outputItems: ["alpha", "beta", "gamma"],
      outputText: "alpha\nbeta\ngamma",
      status: "complete",
    });
  });

  it("skips orchestration nodes (provider: internal) without setLoading or fetch", async () => {
    // webhookTrigger / webhookResponse / dataForward are not API-backed —
    // they should be a silent no-op during Run-all flows. Previously this
    // path hit the /api/xnode/run dispatch and surfaced a 'requires FAL_KEY'
    // error to the user.
    const node = {
      id: "webhookTrigger-1",
      type: "webhookTrigger",
      position: { x: 0, y: 0 },
      data: {},
    } as WorkflowNode;
    const { ctx, updates } = makeContext(node);
    const fetchSpy = vi.spyOn(global, "fetch");

    await executeXNodeModelNode(ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    fetchSpy.mockRestore();
  });

  it("serializes LoRA payloads", async () => {
    const node = {
      id: "loadLora-1",
      type: "loadLora",
      position: { x: 0, y: 0 },
      data: {
        path: "https://example.com/model.safetensors",
        scale: 0.8,
        outputLora: null,
        status: "idle",
        error: null,
      },
    } as WorkflowNode;
    const { ctx, updates } = makeContext(node);

    await executeLoadLora(ctx);

    expect(JSON.parse(String(updates.at(-1)?.outputLora))).toEqual({
      path: "https://example.com/model.safetensors",
      scale: 0.8,
    });
  });
});
