import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFlowBridgeStatus: vi.fn(),
  createFlowTaskId: vi.fn(),
  findVideoMedia: vi.fn(),
  getFlowMediaPath: vi.fn(),
  getProjectIdForWorkflow: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  markTaskComplete: vi.fn(),
  markTaskFailed: vi.fn(),
  saveTask: vi.fn(),
  setProjectIdForWorkflow: vi.fn(),
  ensureFlowImage: vi.fn(),
  checkAsync: vi.fn(),
  createProject: vi.fn(),
  editImage: vi.fn(),
  generateReferenceVideo: vi.fn(),
  generateStartEndVideo: vi.fn(),
  generateStartVideo: vi.fn(),
  getCredits: vi.fn(),
  getMedia: vi.fn(),
  upscaleVideo: vi.fn(),
  listFlowRouteCandidates: vi.fn(),
  recordFlowAccountQuota: vi.fn(),
  markFlowAccountFailure: vi.fn(),
  isFlowFallbackableError: vi.fn(),
  flowFailureKind: vi.fn(),
  quotaSnapshotFromRaw: vi.fn(),
}));

vi.mock("../bridge", () => ({
  getFlowBridgeStatus: mocks.getFlowBridgeStatus,
}));

vi.mock("../registry", () => ({
  createFlowTaskId: mocks.createFlowTaskId,
  findVideoMedia: mocks.findVideoMedia,
  getFlowMediaPath: mocks.getFlowMediaPath,
  getProjectIdForWorkflow: mocks.getProjectIdForWorkflow,
  getTask: mocks.getTask,
  listTasks: mocks.listTasks,
  markTaskComplete: mocks.markTaskComplete,
  markTaskFailed: mocks.markTaskFailed,
  saveTask: mocks.saveTask,
  setProjectIdForWorkflow: mocks.setProjectIdForWorkflow,
}));

vi.mock("../media", () => ({
  ensureFlowImage: mocks.ensureFlowImage,
}));

vi.mock("../sdk", () => ({
  checkAsync: mocks.checkAsync,
  createProject: mocks.createProject,
  editImage: mocks.editImage,
  generateReferenceVideo: mocks.generateReferenceVideo,
  generateStartEndVideo: mocks.generateStartEndVideo,
  generateStartVideo: mocks.generateStartVideo,
  getCredits: mocks.getCredits,
  getMedia: mocks.getMedia,
  upscaleVideo: mocks.upscaleVideo,
}));

vi.mock("../router", () => ({
  listFlowRouteCandidates: mocks.listFlowRouteCandidates,
  recordFlowAccountQuota: mocks.recordFlowAccountQuota,
  markFlowAccountFailure: mocks.markFlowAccountFailure,
  isFlowFallbackableError: mocks.isFlowFallbackableError,
  flowFailureKind: mocks.flowFailureKind,
  quotaSnapshotFromRaw: mocks.quotaSnapshotFromRaw,
}));

import { submitFlowVideoTask } from "../engine";

function submitResult(operation = "operations/test") {
  return {
    operationNames: [operation],
    workflows: [],
    raw: { operation },
  };
}

describe("submitFlowVideoTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFlowBridgeStatus.mockReturnValue({
      connected: true,
      pending: 0,
      flowKeyPresent: true,
      flowKeyAgeMs: 100,
      lastSeenAt: Date.now(),
    });
    mocks.createFlowTaskId.mockReturnValue("flow_task_123_test");
    mocks.getProjectIdForWorkflow.mockResolvedValue("project-existing");
    mocks.getCredits.mockResolvedValue({ paygateTier: "PAYGATE_TIER_ONE", raw: {} });
    mocks.listFlowRouteCandidates.mockResolvedValue([{
      account: null,
      target: {},
      session: { id: "session-a", extensionInstanceId: "ext-a" },
      label: "Default Flow session",
    }]);
    mocks.recordFlowAccountQuota.mockResolvedValue({});
    mocks.markFlowAccountFailure.mockResolvedValue(undefined);
    mocks.isFlowFallbackableError.mockReturnValue(false);
    mocks.flowFailureKind.mockReturnValue("generation_failed");
    mocks.quotaSnapshotFromRaw.mockReturnValue({});
    mocks.ensureFlowImage.mockImplementation(async ({ image }: { image: string }) => ({
      mediaId: `media-${image}`,
      hash: `hash-${image}`,
      mimeType: "image/png",
    }));
    mocks.generateReferenceVideo.mockResolvedValue(submitResult("operations/reference"));
    mocks.generateStartVideo.mockResolvedValue(submitResult("operations/start"));
    mocks.generateStartEndVideo.mockResolvedValue(submitResult("operations/start-end"));
    mocks.editImage.mockResolvedValue("media-seed-frame");
    mocks.upscaleVideo.mockResolvedValue(submitResult("operations/upscale"));
    mocks.findVideoMedia.mockResolvedValue({
      taskId: "flow_task_done",
      projectId: "project-video",
      mediaId: "media-video",
      url: "/api/flow/media/flow_task_done",
      localPath: "C:\\tmp\\flow_task_done.mp4",
      createdAt: 1,
    });
    mocks.saveTask.mockImplementation(async (task) => task);
  });

  it("maps multiple reference images to one reference-video request in order", async () => {
    const task = await submitFlowVideoTask({
      modelId: "flow-veo-3.1/reference-video",
      modelName: "Flow Reference Video",
      prompt: "make one video",
      dynamicInputs: {
        referenceImages: ["ref-a", "ref-b"],
      },
      workflowId: "workflow-a",
    });

    expect(mocks.ensureFlowImage).toHaveBeenNthCalledWith(1, expect.objectContaining({ image: "ref-a" }));
    expect(mocks.ensureFlowImage).toHaveBeenNthCalledWith(2, expect.objectContaining({ image: "ref-b" }));
    expect(mocks.generateReferenceVideo).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "make one video",
      projectId: "project-existing",
      referenceMediaIds: ["media-ref-a", "media-ref-b"],
      paygateTier: "PAYGATE_TIER_ONE",
      aspectRatio: "9:16",
    }));
    expect(task.mode).toBe("reference-video");
    expect(task.operationNames).toEqual(["operations/reference"]);
  });

  it("submits landscape reference-video after uploading references", async () => {
    await submitFlowVideoTask({
      modelId: "flow-veo-3.1/reference-video",
      modelName: "Flow Reference Video",
      prompt: "make one video",
      dynamicInputs: {
        referenceImages: ["ref-a"],
      },
      parameters: {
        aspectRatio: "16:9",
      },
      workflowId: "workflow-a",
    });

    expect(mocks.ensureFlowImage).toHaveBeenCalledWith(expect.objectContaining({ image: "ref-a" }));
    expect(mocks.generateReferenceVideo).toHaveBeenCalledWith(expect.objectContaining({
      referenceMediaIds: ["media-ref-a"],
      aspectRatio: "16:9",
    }));
  });

  it("composes a seed frame from start image and extra refs before start-image video", async () => {
    await submitFlowVideoTask({
      modelId: "flow-veo-3.1/compose-start-video",
      modelName: "Flow Compose Start Video",
      prompt: "animate the composed frame",
      dynamicInputs: {
        startImage: "start",
        extraRefs: ["style-ref", "product-ref"],
        seedPrompt: "make a seed frame",
      },
      workflowId: "workflow-a",
      parameters: { aspectRatio: "9:16", seed: 42 },
    });

    expect(mocks.editImage).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "make a seed frame",
      sourceMediaId: "media-start",
      refMediaIds: ["media-style-ref", "media-product-ref"],
      aspectRatio: "9:16",
    }));
    expect(mocks.generateStartVideo).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "animate the composed frame",
      startMediaId: "media-seed-frame",
      aspectRatio: "9:16",
      seed: 42,
    }));
  });

  it("dispatches start/end frame mode with both frame media IDs", async () => {
    await submitFlowVideoTask({
      modelId: "flow-veo-3.1/start-end-frame",
      modelName: "Flow Start/End Frame",
      prompt: "transition between frames",
      dynamicInputs: {
        startImage: "first-frame",
        endImage: "last-frame",
      },
      workflowId: "workflow-a",
    });

    expect(mocks.generateStartEndVideo).toHaveBeenCalledWith(expect.objectContaining({
      startMediaId: "media-first-frame",
      endMediaId: "media-last-frame",
      prompt: "transition between frames",
    }));
  });

  it("requires a registry-backed Flow media id for upscale mode", async () => {
    await submitFlowVideoTask({
      modelId: "flow-veo-3.1/upscale-video",
      modelName: "Flow Upscale Video",
      mediaRefs: {
        video: "/api/flow/media/flow_task_done",
      },
      workflowId: "workflow-a",
      parameters: { resolution: "1080p" },
    });

    expect(mocks.findVideoMedia).toHaveBeenCalledWith("/api/flow/media/flow_task_done");
    expect(mocks.upscaleVideo).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-video",
      mediaId: "media-video",
      resolution: "1080p",
    }));
  });

  it("fails early when the extension bridge is not connected", async () => {
    mocks.getFlowBridgeStatus.mockReturnValueOnce({
      connected: false,
      pending: 0,
      flowKeyPresent: false,
      flowKeyAgeMs: null,
      lastSeenAt: null,
    });
    mocks.listFlowRouteCandidates.mockResolvedValueOnce([]);

    await expect(submitFlowVideoTask({
      modelId: "flow-veo-3.1/reference-video",
      modelName: "Flow Reference Video",
      prompt: "make one video",
      images: ["ref-a"],
    })).rejects.toThrow(/extension is not connected/);
  });
});
