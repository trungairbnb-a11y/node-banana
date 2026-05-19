import { randomUUID } from "crypto";
import { sendFlowBridgeRequest, type FlowBridgeTarget } from "./bridge";
import { runFlowLimited } from "./rateLimit";
import type { FlowVideoMode } from "./modes";

const FLOW_API_BASE = "https://aisandbox-pa.googleapis.com";
const FLOW_API_KEY = process.env.GOOGLE_FLOW_API_KEY || "AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY";
const TRPC_CREATE_PROJECT = "https://labs.google/fx/api/trpc/project.createProject";

const ENDPOINTS = {
  generateImages: "/v1/projects/{projectId}/flowMedia:batchGenerateImages",
  startImageVideo: "/v1/video:batchAsyncGenerateVideoStartImage",
  startEndVideo: "/v1/video:batchAsyncGenerateVideoStartAndEndImage",
  referenceVideo: "/v1/video:batchAsyncGenerateVideoReferenceImages",
  upscaleVideo: "/v1/video:batchAsyncGenerateVideoUpsampleVideo",
  pollVideo: "/v1/video:batchCheckAsyncVideoGenerationStatus",
  uploadImage: "/v1/flow/uploadImage",
  credits: "/v1/credits",
  media: "/v1/media/{mediaId}",
};

const VALID_TIERS = new Set(["PAYGATE_TIER_ONE", "PAYGATE_TIER_TWO"]);

const VIDEO_MODEL_KEYS: Record<string, Record<string, Record<string, string>>> = {
  PAYGATE_TIER_ONE: {
    "start-image-video": {
      "VIDEO_ASPECT_RATIO_LANDSCAPE": "veo_3_1_i2v_s_fast",
      "VIDEO_ASPECT_RATIO_PORTRAIT": "veo_3_1_i2v_s_fast_portrait",
    },
    "compose-start-video": {
      "VIDEO_ASPECT_RATIO_LANDSCAPE": "veo_3_1_i2v_s_fast",
      "VIDEO_ASPECT_RATIO_PORTRAIT": "veo_3_1_i2v_s_fast_portrait",
    },
    "start-end-frame": {
      "VIDEO_ASPECT_RATIO_LANDSCAPE": "veo_3_1_i2v_s_fast_fl",
      "VIDEO_ASPECT_RATIO_PORTRAIT": "veo_3_1_i2v_s_fast_portrait_fl",
    },
    "reference-video": {
      "VIDEO_ASPECT_RATIO_LANDSCAPE": "veo_3_1_r2v_fast_landscape",
      "VIDEO_ASPECT_RATIO_PORTRAIT": "veo_3_1_r2v_fast_portrait",
    },
  },
  PAYGATE_TIER_TWO: {
    "start-image-video": {
      "VIDEO_ASPECT_RATIO_LANDSCAPE": "veo_3_1_i2v_lite_low_priority",
      "VIDEO_ASPECT_RATIO_PORTRAIT": "veo_3_1_i2v_lite_low_priority",
    },
    "compose-start-video": {
      "VIDEO_ASPECT_RATIO_LANDSCAPE": "veo_3_1_i2v_lite_low_priority",
      "VIDEO_ASPECT_RATIO_PORTRAIT": "veo_3_1_i2v_lite_low_priority",
    },
    "start-end-frame": {
      "VIDEO_ASPECT_RATIO_LANDSCAPE": "veo_3_1_i2v_lite_low_priority",
      "VIDEO_ASPECT_RATIO_PORTRAIT": "veo_3_1_i2v_lite_low_priority",
    },
    "reference-video": {
      "VIDEO_ASPECT_RATIO_LANDSCAPE": "veo_3_1_r2v_fast_landscape_ultra_relaxed",
      "VIDEO_ASPECT_RATIO_PORTRAIT": "veo_3_1_r2v_fast_landscape_ultra_relaxed",
    },
  },
};

const IMAGE_MODELS = {
  NANO_BANANA_PRO: "GEM_PIX_2",
  NANO_BANANA_2: "NARWHAL",
};

const UPSCALE_MODELS = {
  "4K": "veo_3_1_upsampler_4k",
  "1080p": "veo_3_1_upsampler_1080p",
};

const API_HEADERS = {
  "content-type": "text/plain;charset=UTF-8",
  accept: "*/*",
  origin: "https://labs.google",
  referer: "https://labs.google/",
};

const TRPC_HEADERS = {
  "content-type": "application/json",
  accept: "*/*",
};

export interface FlowMediaEntry {
  media_id: string;
  url?: string | null;
  mediaType: "image" | "video";
  encoded_video?: string;
}

export interface FlowOperationSummary {
  name: string;
  done: boolean;
  media_entries: FlowMediaEntry[];
  status?: string | null;
  error?: string | null;
}

export interface FlowWorkflowRef {
  name: string;
  primary_media_id: string;
}

export interface FlowSubmitTrace {
  endpoint: string;
  videoModelKey?: string;
  aspectRatio?: string;
  requestBody: Record<string, unknown>;
}

function buildUrl(endpoint: string, vars: Record<string, string> = {}): string {
  let path = endpoint;
  for (const [key, value] of Object.entries(vars)) {
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  }
  const sep = path.includes("?") ? "&" : "?";
  return `${FLOW_API_BASE}${path}${sep}key=${FLOW_API_KEY}`;
}

function clientContext(projectId: string, paygateTier: string): Record<string, unknown> {
  if (!VALID_TIERS.has(paygateTier)) {
    throw new Error(`Invalid Flow paygate tier: ${paygateTier}`);
  }
  return {
    projectId,
    recaptchaContext: {
      applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
      token: "",
    },
    sessionId: `;${Date.now()}`,
    tool: "PINHOLE",
    userPaygateTier: paygateTier,
  };
}

function aspectToFlow(value: unknown): "VIDEO_ASPECT_RATIO_LANDSCAPE" | "VIDEO_ASPECT_RATIO_PORTRAIT" {
  return value === "9:16" || value === "portrait"
    ? "VIDEO_ASPECT_RATIO_PORTRAIT"
    : "VIDEO_ASPECT_RATIO_LANDSCAPE";
}

function isNotFoundError(error: unknown): boolean {
  return /NOT_FOUND|404|Requested entity was not found/i.test(flowErrorMessage(error));
}

function imageAspectToFlow(value: unknown): "IMAGE_ASPECT_RATIO_LANDSCAPE" | "IMAGE_ASPECT_RATIO_PORTRAIT" {
  return value === "9:16" || value === "portrait"
    ? "IMAGE_ASPECT_RATIO_PORTRAIT"
    : "IMAGE_ASPECT_RATIO_LANDSCAPE";
}

function resolveVideoModel(mode: FlowVideoMode, paygateTier: string, aspectRatio: string): string {
  const tierMap = VIDEO_MODEL_KEYS[paygateTier] ?? VIDEO_MODEL_KEYS.PAYGATE_TIER_ONE;
  const modeMap = tierMap[mode] ?? tierMap["start-image-video"];
  const key = modeMap[aspectRatio];
  if (!key) {
    throw new Error(`No Google Flow model for mode=${mode} tier=${paygateTier} aspect=${aspectRatio}`);
  }
  return key;
}

function shouldSendPromptExpansion(modelKey: string): boolean {
  return !modelKey || modelKey.startsWith("veo_2");
}

function videoTextInput(prompt: string): Record<string, unknown> {
  return {
    structuredPrompt: {
      parts: [{ text: prompt }],
    },
  };
}

function extractInnerApiError(resp: any): string | null {
  if (!resp || typeof resp !== "object") return null;
  const status = resp.status;
  const data = resp.data && typeof resp.data === "object" ? resp.data : null;
  const error = data?.error && typeof data.error === "object" ? data.error : null;
  if (!(typeof status === "number" && status >= 400) && !error) return null;
  if (error) {
    const details = Array.isArray(error.details) ? error.details : [];
    const reason = details.find((detail: any) => typeof detail?.reason === "string")?.reason;
    const statusLabel = typeof error.status === "string" && error.status ? error.status : null;
    const message = error.message || statusLabel || "Google Flow API error";
    const labeledMessage = statusLabel && statusLabel !== message ? `${statusLabel}: ${message}` : String(message);
    return reason ? `${reason}: ${labeledMessage}` : labeledMessage;
  }
  return `Google Flow API_${status}`;
}

function flowErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Google Flow API error");
}

function referenceVideoError(error: unknown): Error {
  const message = flowErrorMessage(error).replace(/\.+$/, "");
  return new Error(
    `Flow Reference Video failed on Google's Reference Video/R2V endpoint: ${message}. ` +
      "Banana submitted this as reference-video with Flow referenceImages and did not substitute another mode. " +
      "If this keeps returning INTERNAL, check whether the paired Gmail account has Reference Video/R2V enabled in Google Flow."
  );
}

async function apiRequest<T = any>(input: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  captchaAction?: "IMAGE_GENERATION" | "VIDEO_GENERATION";
  timeoutMs?: number;
  bridgeTarget?: FlowBridgeTarget;
}): Promise<T> {
  const resp = await runFlowLimited(() =>
    sendFlowBridgeRequest<T>(
      "api_request",
      {
        url: input.url,
        method: input.method ?? "POST",
        headers: input.headers ?? API_HEADERS,
        body: input.body ?? null,
        captchaAction: input.captchaAction,
      },
      input.timeoutMs ?? 300000,
      input.bridgeTarget
    )
  );
  const error = extractInnerApiError(resp);
  if (error) throw new Error(error);
  if ((resp as any)?.error) throw new Error(String((resp as any).error));
  return resp;
}

async function trpcRequest<T = any>(input: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  bridgeTarget?: FlowBridgeTarget;
}): Promise<T> {
  const resp = await runFlowLimited(() =>
    sendFlowBridgeRequest<T>(
      "trpc_request",
      {
        url: input.url,
        method: input.method ?? "POST",
        headers: input.headers ?? TRPC_HEADERS,
        body: input.body ?? null,
      },
      input.timeoutMs ?? 30000,
      input.bridgeTarget
    )
  );
  const error = extractInnerApiError(resp);
  if (error) throw new Error(error);
  if ((resp as any)?.error) throw new Error(String((resp as any).error));
  return resp;
}

export async function createProject(title: string, bridgeTarget?: FlowBridgeTarget): Promise<string> {
  const resp: any = await trpcRequest({
    url: TRPC_CREATE_PROJECT,
    method: "POST",
    headers: TRPC_HEADERS,
    body: { json: { projectTitle: title, toolName: "PINHOLE" } },
    bridgeTarget,
  });
  const json = resp?.data?.result?.data?.json;
  const projectId =
    json?.result?.projectId ??
    json?.projectId ??
    json?.project?.id ??
    json?.project?.projectId;
  if (!projectId || typeof projectId !== "string") {
    throw new Error("Google Flow did not return a project id");
  }
  return projectId;
}

export async function getCredits(bridgeTarget?: FlowBridgeTarget): Promise<{ paygateTier: string; raw: unknown }> {
  const resp: any = await apiRequest({
    url: buildUrl(ENDPOINTS.credits),
    method: "GET",
    headers: API_HEADERS,
    timeoutMs: 15000,
    bridgeTarget,
  });
  const tier = resp?.data?.userPaygateTier;
  return {
    paygateTier: VALID_TIERS.has(tier) ? tier : "PAYGATE_TIER_ONE",
    raw: resp,
  };
}

export async function uploadImage(input: {
  imageBase64: string;
  mimeType: string;
  projectId: string;
  fileName?: string;
  bridgeTarget?: FlowBridgeTarget;
}): Promise<string> {
  const resp: any = await apiRequest({
    url: buildUrl(ENDPOINTS.uploadImage),
    method: "POST",
    headers: API_HEADERS,
    timeoutMs: 60000,
    body: {
      clientContext: {
        projectId: input.projectId,
        tool: "PINHOLE",
      },
      fileName: input.fileName ?? "upload.png",
      imageBytes: input.imageBase64,
      isHidden: false,
      isUserUploaded: true,
      mimeType: input.mimeType,
    },
    bridgeTarget: input.bridgeTarget,
  });
  const mediaId = resp?.data?.media?.name;
  if (!mediaId || typeof mediaId !== "string") {
    throw new Error("Google Flow uploadImage returned no media id");
  }
  return mediaId;
}

export async function editImage(input: {
  prompt: string;
  projectId: string;
  sourceMediaId: string;
  refMediaIds: string[];
  paygateTier: string;
  aspectRatio?: unknown;
  bridgeTarget?: FlowBridgeTarget;
}): Promise<string> {
  const ts = Date.now();
  const ctx = clientContext(input.projectId, input.paygateTier);
  const imageInputs = [
    { name: input.sourceMediaId, imageInputType: "IMAGE_INPUT_TYPE_BASE_IMAGE" },
    ...input.refMediaIds.map((mediaId) => ({ name: mediaId, imageInputType: "IMAGE_INPUT_TYPE_REFERENCE" })),
  ];
  const resp: any = await apiRequest({
    url: buildUrl(ENDPOINTS.generateImages, { projectId: input.projectId }),
    method: "POST",
    headers: API_HEADERS,
    captchaAction: "IMAGE_GENERATION",
    body: {
      clientContext: ctx,
      mediaGenerationContext: { batchId: randomUUID() },
      useNewMedia: true,
      requests: [
        {
          clientContext: { ...ctx, sessionId: `;${ts}` },
          seed: ts % 1_000_000,
          structuredPrompt: { parts: [{ text: input.prompt }] },
          imageAspectRatio: imageAspectToFlow(input.aspectRatio),
          imageModelName: IMAGE_MODELS.NANO_BANANA_PRO,
          imageInputs,
        },
      ],
    },
    bridgeTarget: input.bridgeTarget,
  });
  const entries = extractMediaEntries(resp);
  const first = entries[0]?.media_id;
  if (!first) throw new Error("Google Flow image refine returned no seed frame");
  return first;
}

function submitVideoBody(input: {
  mode: FlowVideoMode;
  prompt: string;
  projectId: string;
  paygateTier: string;
  aspectRatio?: unknown;
  startMediaId?: string;
  endMediaId?: string;
  referenceMediaIds?: string[];
  seed?: unknown;
}): { url: string; body: Record<string, unknown>; trace: FlowSubmitTrace } {
  const aspect = aspectToFlow(input.mode === "reference-video" ? input.aspectRatio ?? "9:16" : input.aspectRatio);
  const modelKey = resolveVideoModel(input.mode, input.paygateTier, aspect);
  const baseRequest: Record<string, unknown> = {
    aspectRatio: aspect,
    seed: typeof input.seed === "number" ? input.seed : Date.now() % 1_000_000,
    textInput: videoTextInput(input.prompt),
    videoModelKey: modelKey,
    metadata: {},
  };

  let endpoint = ENDPOINTS.startImageVideo;
  if (input.mode === "reference-video") {
    endpoint = ENDPOINTS.referenceVideo;
    const referenceImages = (input.referenceMediaIds ?? []).map((mediaId) => ({
      mediaId,
      imageUsageType: "IMAGE_USAGE_TYPE_ASSET",
    }));
    baseRequest.referenceImages = referenceImages;
    if (shouldSendPromptExpansion(modelKey)) {
      baseRequest.promptExpansionInput = {
        prompt: input.prompt,
        seed: baseRequest.seed,
        templateId: "3037644266",
        imageInputs: referenceImages,
      };
    }
  } else {
    baseRequest.startImage = { mediaId: input.startMediaId };
    if (input.mode === "start-end-frame") {
      endpoint = ENDPOINTS.startEndVideo;
      baseRequest.endImage = { mediaId: input.endMediaId };
    }
  }

  const url = buildUrl(endpoint);
  const body = {
    clientContext: clientContext(input.projectId, input.paygateTier),
    mediaGenerationContext: {
      batchId: randomUUID(),
      audioFailurePreference: "BLOCK_SILENCED_VIDEOS",
    },
    requests: [baseRequest],
    useV2ModelConfig: true,
  };

  return {
    url,
    body,
    trace: {
      endpoint,
      videoModelKey: modelKey,
      aspectRatio: aspect,
      requestBody: body,
    },
  };
}

export async function generateReferenceVideo(input: {
  prompt: string;
  projectId: string;
  referenceMediaIds: string[];
  paygateTier: string;
  aspectRatio?: unknown;
  seed?: unknown;
  bridgeTarget?: FlowBridgeTarget;
}): Promise<{ operationNames: string[]; workflows: FlowWorkflowRef[]; raw: unknown; trace?: FlowSubmitTrace }> {
  const { url, body, trace } = submitVideoBody({ ...input, mode: "reference-video" });
  try {
    const resp: any = await apiRequest({
      url,
      method: "POST",
      headers: API_HEADERS,
      captchaAction: "VIDEO_GENERATION",
      timeoutMs: 60000,
      body,
      bridgeTarget: input.bridgeTarget,
    });
    return { ...extractSubmitResult(resp), trace };
  } catch (error) {
    throw referenceVideoError(error);
  }
}

export async function generateStartVideo(input: {
  prompt: string;
  projectId: string;
  startMediaId: string;
  paygateTier: string;
  aspectRatio?: unknown;
  seed?: unknown;
  bridgeTarget?: FlowBridgeTarget;
}): Promise<{ operationNames: string[]; workflows: FlowWorkflowRef[]; raw: unknown; trace?: FlowSubmitTrace }> {
  const { url, body, trace } = submitVideoBody({ ...input, mode: "start-image-video" });
  const resp: any = await apiRequest({
    url,
    method: "POST",
    headers: API_HEADERS,
    captchaAction: "VIDEO_GENERATION",
    timeoutMs: 60000,
    body,
    bridgeTarget: input.bridgeTarget,
  });
  return { ...extractSubmitResult(resp), trace };
}

export async function generateStartEndVideo(input: {
  prompt: string;
  projectId: string;
  startMediaId: string;
  endMediaId: string;
  paygateTier: string;
  aspectRatio?: unknown;
  seed?: unknown;
  bridgeTarget?: FlowBridgeTarget;
}): Promise<{ operationNames: string[]; workflows: FlowWorkflowRef[]; raw: unknown; trace?: FlowSubmitTrace }> {
  const { url, body, trace } = submitVideoBody({ ...input, mode: "start-end-frame" });
  const resp: any = await apiRequest({
    url,
    method: "POST",
    headers: API_HEADERS,
    captchaAction: "VIDEO_GENERATION",
    timeoutMs: 60000,
    body,
    bridgeTarget: input.bridgeTarget,
  });
  return { ...extractSubmitResult(resp), trace };
}

export async function upscaleVideo(input: {
  projectId: string;
  mediaId: string;
  paygateTier: string;
  resolution?: unknown;
  aspectRatio?: unknown;
  bridgeTarget?: FlowBridgeTarget;
}): Promise<{ operationNames: string[]; workflows: FlowWorkflowRef[]; raw: unknown; trace?: FlowSubmitTrace }> {
  const resolution = input.resolution === "1080p" ? "VIDEO_RESOLUTION_1080P" : "VIDEO_RESOLUTION_4K";
  const body = {
    clientContext: {
      sessionId: `;${Date.now()}`,
      recaptchaContext: {
        applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        token: "",
      },
    },
    requests: [
      {
        aspectRatio: aspectToFlow(input.aspectRatio),
        resolution,
        seed: Date.now() % 1_000_000,
        metadata: { sceneId: randomUUID() },
        videoInput: { mediaId: input.mediaId },
        videoModelKey: UPSCALE_MODELS[input.resolution === "1080p" ? "1080p" : "4K"],
      },
    ],
  };
  const resp: any = await apiRequest({
    url: buildUrl(ENDPOINTS.upscaleVideo),
    method: "POST",
    headers: API_HEADERS,
    captchaAction: "VIDEO_GENERATION",
    timeoutMs: 60000,
    body,
    bridgeTarget: input.bridgeTarget,
  });
  return {
    ...extractSubmitResult(resp),
    trace: {
      endpoint: ENDPOINTS.upscaleVideo,
      videoModelKey: UPSCALE_MODELS[input.resolution === "1080p" ? "1080p" : "4K"],
      aspectRatio: aspectToFlow(input.aspectRatio),
      requestBody: body,
    },
  };
}

export async function checkAsync(
  operationNames: string[],
  workflows: FlowWorkflowRef[] = [],
  bridgeTarget?: FlowBridgeTarget
): Promise<{ operations: FlowOperationSummary[]; raw: unknown }> {
  const workflowNames = new Set(workflows.map((workflow) => workflow.name));
  const oldNames = operationNames.filter((name) => !workflowNames.has(name));
  const operations: FlowOperationSummary[] = [];
  const raw: Record<string, unknown> = {};

  if (oldNames.length > 0) {
    const resp: any = await apiRequest({
      url: buildUrl(ENDPOINTS.pollVideo),
      method: "POST",
      headers: API_HEADERS,
      timeoutMs: 30000,
      body: {
        operations: oldNames.map((name) => ({ operation: { name } })),
      },
      bridgeTarget,
    });
    raw.operations_poll = resp;
    operations.push(...extractVideoOperations(resp, oldNames));
  }

  if (workflows.length > 0) {
    const workflowPolls: unknown[] = [];
    for (const workflow of workflows) {
      try {
        const resp = await getMedia(workflow.primary_media_id, bridgeTarget);
        workflowPolls.push({ name: workflow.name, mediaId: workflow.primary_media_id, resp });
        operations.push(extractWorkflowOperation(workflow, resp));
      } catch (error) {
        const message = flowErrorMessage(error);
        workflowPolls.push({ name: workflow.name, mediaId: workflow.primary_media_id, error: message });
        operations.push({
          name: workflow.name,
          done: !isNotFoundError(error),
          media_entries: [],
          status: isNotFoundError(error) ? "MEDIA_GENERATION_STATUS_PENDING" : "MEDIA_GENERATION_STATUS_FAILED",
          error: isNotFoundError(error) ? null : message,
        });
      }
    }
    raw.workflow_polls = workflowPolls;
  }

  const order = new Map(operationNames.map((name, index) => [name, index]));
  operations.sort((a, b) => (order.get(a.name) ?? 9999) - (order.get(b.name) ?? 9999));
  return { operations, raw };
}

export async function getMedia(mediaId: string, bridgeTarget?: FlowBridgeTarget): Promise<unknown> {
  return await apiRequest({
    url: buildUrl(ENDPOINTS.media, { mediaId }) + "&clientContext.tool=PINHOLE",
    method: "GET",
    headers: API_HEADERS,
    timeoutMs: 15000,
    bridgeTarget,
  });
}

function extractSubmitResult(resp: any): { operationNames: string[]; workflows: FlowWorkflowRef[]; raw: unknown } {
  const operationNames = extractOperationNames(resp);
  const workflows = extractVideoWorkflows(resp);
  if (operationNames.length === 0) {
    throw new Error("Google Flow returned no video operations");
  }
  return { operationNames, workflows, raw: resp };
}

export function extractOperationNames(resp: any): string[] {
  const data = resp?.data;
  const names: string[] = [];
  if (Array.isArray(data?.operations)) {
    for (const op of data.operations) {
      const name = op?.operation?.name ?? op?.name;
      if (typeof name === "string" && name) names.push(name);
    }
  }
  if (names.length > 0) return names;
  if (Array.isArray(data?.workflows)) {
    for (const workflow of data.workflows) {
      if (typeof workflow?.name === "string" && workflow.name) names.push(workflow.name);
    }
  }
  return names;
}

export function extractVideoWorkflows(resp: any): FlowWorkflowRef[] {
  const workflows = resp?.data?.workflows;
  if (!Array.isArray(workflows)) return [];
  return workflows
    .map((workflow: any) => {
      const primaryMediaId = workflow?.metadata?.primaryMediaId;
      return {
        name: workflow?.name ?? primaryMediaId,
        primary_media_id: primaryMediaId,
      };
    })
    .filter((workflow) => typeof workflow.name === "string" && typeof workflow.primary_media_id === "string");
}

export function extractVideoOperations(resp: any, requested: string[]): FlowOperationSummary[] {
  const byName = new Map<string, FlowOperationSummary>();
  const ops = resp?.data?.operations;
  if (Array.isArray(ops)) {
    for (const op of ops) {
      const inner = op?.operation && typeof op.operation === "object" ? op.operation : op;
      const name = inner?.name;
      if (typeof name !== "string") continue;
      const meta = inner?.metadata ?? {};
      const video = meta?.video ?? {};
      const fife = typeof video?.fifeUrl === "string" ? video.fifeUrl : null;
      const mediaId =
        typeof video?.mediaId === "string" && video.mediaId
          ? video.mediaId
          : mediaIdFromUrl(fife ?? video?.servingBaseUri);
      const status = typeof op?.status === "string" ? op.status : null;
      const opError =
        typeof inner?.error?.message === "string"
          ? inner.error.message
          : status === "MEDIA_GENERATION_STATUS_FAILED"
            ? "MEDIA_GENERATION_STATUS_FAILED"
            : null;
      const done = status === "MEDIA_GENERATION_STATUS_SUCCESSFUL" || status === "MEDIA_GENERATION_STATUS_FAILED" || !!inner?.done || !!(mediaId && fife);
      byName.set(name, {
        name,
        done,
        media_entries:
          done && !opError && mediaId
            ? [{ media_id: mediaId, url: fife, mediaType: "video" }]
            : [],
        status,
        error: opError,
      });
    }
  }
  return requested.map((name) => byName.get(name) ?? { name, done: false, media_entries: [] });
}

function extractWorkflowOperation(workflow: FlowWorkflowRef, resp: any): FlowOperationSummary {
  const status = typeof resp?.status === "number" ? resp.status : 200;
  if (status >= 400 && status !== 404) {
    return {
      name: workflow.name,
      done: true,
      media_entries: [],
      error: extractInnerApiError(resp) ?? `API_${status}`,
    };
  }

  const media = resp?.data && typeof resp.data === "object" ? resp.data : {};
  const video = media?.video && typeof media.video === "object" ? media.video : {};
  const encoded = typeof video?.encodedVideo === "string" ? video.encodedVideo : null;
  if (!encoded || !isBase64Mp4(encoded)) {
    return { name: workflow.name, done: false, media_entries: [] };
  }
  const fife = typeof video?.fifeUrl === "string" ? video.fifeUrl : typeof media?.fifeUrl === "string" ? media.fifeUrl : null;
  return {
    name: workflow.name,
    done: true,
    media_entries: [
      {
        media_id: workflow.primary_media_id,
        url: fife,
        mediaType: "video",
        encoded_video: encoded,
      },
    ],
    status: "MEDIA_GENERATION_STATUS_SUCCESSFUL",
  };
}

export function extractMediaEntries(resp: any): FlowMediaEntry[] {
  const media = resp?.data?.media;
  if (!Array.isArray(media)) return [];
  const entries: FlowMediaEntry[] = [];
  for (const item of media) {
    const mediaId = item?.name;
    if (typeof mediaId !== "string" || !mediaId) continue;
    let mediaType: "image" | "video" = "image";
    let url: string | null = null;
    if (item?.image?.generatedImage?.fifeUrl) {
      url = item.image.generatedImage.fifeUrl;
    }
    if (item?.video) {
      mediaType = "video";
      url = item.video.generatedVideo?.fifeUrl ?? item.video.generatedImage?.fifeUrl ?? null;
    }
    entries.push({ media_id: mediaId, url, mediaType });
  }
  return entries;
}

function mediaIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const match = url.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?]|$)/i);
  return match?.[1] ?? null;
}

function isBase64Mp4(encoded: string): boolean {
  try {
    const binary = Buffer.from(encoded, "base64");
    return binary.length >= 12 && binary.subarray(4, 8).toString("ascii") === "ftyp";
  } catch {
    return false;
  }
}
