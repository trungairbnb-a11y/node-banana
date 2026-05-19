import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendFlowBridgeRequest: vi.fn(),
}));

vi.mock("../bridge", () => ({
  sendFlowBridgeRequest: mocks.sendFlowBridgeRequest,
}));

import {
  checkAsync,
  extractVideoWorkflows,
  generateReferenceVideo,
  generateStartEndVideo,
  upscaleVideo,
} from "../sdk";

describe("Flow SDK video payloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendFlowBridgeRequest.mockResolvedValue({
      data: {
        operations: [{ operation: { name: "operations/video-op" } }],
      },
    });
  });

  it("sends referenceImages[] for reference-video generation", async () => {
    await generateReferenceVideo({
      prompt: "use these references",
      projectId: "project-1",
      referenceMediaIds: ["media-a", "media-b"],
      paygateTier: "PAYGATE_TIER_ONE",
      aspectRatio: "9:16",
      seed: 7,
    });

    const [, payload] = mocks.sendFlowBridgeRequest.mock.calls[0];
    expect(payload.url).toContain("batchAsyncGenerateVideoReferenceImages");
    expect(payload.body.requests[0]).toMatchObject({
      seed: 7,
      textInput: {
        structuredPrompt: {
          parts: [{ text: "use these references" }],
        },
      },
      referenceImages: [
        { mediaId: "media-a", imageUsageType: "IMAGE_USAGE_TYPE_ASSET" },
        { mediaId: "media-b", imageUsageType: "IMAGE_USAGE_TYPE_ASSET" },
      ],
    });
    expect(payload.body.mediaGenerationContext).toMatchObject({
      audioFailurePreference: "BLOCK_SILENCED_VIDEOS",
    });
    expect(payload.body.requests[0].promptExpansionInput).toBeUndefined();
  });

  it("sends landscape reference-video to Google's R2V endpoint", async () => {
    await generateReferenceVideo({
      prompt: "use these references",
      projectId: "project-1",
      referenceMediaIds: ["media-a", "media-b"],
      paygateTier: "PAYGATE_TIER_ONE",
      aspectRatio: "16:9",
    });

    const [, payload] = mocks.sendFlowBridgeRequest.mock.calls[0];
    expect(payload.url).toContain("batchAsyncGenerateVideoReferenceImages");
    expect(payload.body.requests[0]).toMatchObject({
      aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE",
      videoModelKey: "veo_3_1_r2v_fast_landscape",
      referenceImages: [
        { mediaId: "media-a", imageUsageType: "IMAGE_USAGE_TYPE_ASSET" },
        { mediaId: "media-b", imageUsageType: "IMAGE_USAGE_TYPE_ASSET" },
      ],
    });
  });

  it("keeps reference-video failures explicit instead of silently falling back", async () => {
    mocks.sendFlowBridgeRequest.mockResolvedValueOnce({
      status: 500,
      data: {
        error: {
          status: "INTERNAL",
          message: "Internal error encountered.",
        },
      },
    });

    await expect(generateReferenceVideo({
      prompt: "use these references",
      projectId: "project-1",
      referenceMediaIds: ["media-a"],
      paygateTier: "PAYGATE_TIER_ONE",
    })).rejects.toThrow(/Reference Video\/R2V endpoint: INTERNAL: Internal error encountered/);
  });

  it("sends startImage and endImage for start/end frame generation", async () => {
    await generateStartEndVideo({
      prompt: "transition",
      projectId: "project-1",
      startMediaId: "media-start",
      endMediaId: "media-end",
      paygateTier: "PAYGATE_TIER_ONE",
      aspectRatio: "9:16",
    });

    const [, payload] = mocks.sendFlowBridgeRequest.mock.calls[0];
    expect(payload.url).toContain("batchAsyncGenerateVideoStartAndEndImage");
    expect(payload.body.requests[0]).toMatchObject({
      aspectRatio: "VIDEO_ASPECT_RATIO_PORTRAIT",
      startImage: { mediaId: "media-start" },
      endImage: { mediaId: "media-end" },
    });
  });

  it("sends videoInput.mediaId for Flow upscaling", async () => {
    await upscaleVideo({
      projectId: "project-video",
      mediaId: "media-video",
      paygateTier: "PAYGATE_TIER_ONE",
      resolution: "1080p",
    });

    const [, payload] = mocks.sendFlowBridgeRequest.mock.calls[0];
    expect(payload.url).toContain("batchAsyncGenerateVideoUpsampleVideo");
    expect(payload.body.requests[0]).toMatchObject({
      resolution: "VIDEO_RESOLUTION_1080P",
      videoInput: { mediaId: "media-video" },
    });
    expect(payload.body.requests[0].clientContext).toBeUndefined();
  });

  it("synthesizes workflow names from primary media id when Flow omits workflow.name", () => {
    const workflows = extractVideoWorkflows({
      data: {
        workflows: [
          { metadata: { primaryMediaId: "media-upsampled" } },
        ],
      },
    });

    expect(workflows).toEqual([{ name: "media-upsampled", primary_media_id: "media-upsampled" }]);
  });

  it("keeps workflow media NOT_FOUND in processing state while Flow publishes media", async () => {
    mocks.sendFlowBridgeRequest.mockResolvedValueOnce({
      status: 404,
      data: {
        error: {
          status: "NOT_FOUND",
          message: "Requested entity was not found.",
        },
      },
    });

    const result = await checkAsync(["workflow-a"], [{ name: "workflow-a", primary_media_id: "media-a" }]);

    expect(result.operations).toEqual([
      expect.objectContaining({
        name: "workflow-a",
        done: false,
        media_entries: [],
        error: null,
      }),
    ]);
    expect((result.raw as any).workflow_polls[0].error).toContain("NOT_FOUND");
  });
});
