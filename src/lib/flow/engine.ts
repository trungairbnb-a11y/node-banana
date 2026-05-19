import * as fs from "fs/promises";
import { getFlowBridgeStatus, type FlowBridgeTarget } from "./bridge";
import {
  createFlowTaskId,
  findVideoMedia,
  getFlowMediaPath,
  getProjectIdForWorkflow,
  getTask,
  listTasks,
  markTaskComplete,
  markTaskFailed,
  saveTask,
  setProjectIdForWorkflow,
  type FlowVideoRecord,
  type FlowTaskRecord,
} from "./registry";
import { ensureFlowImage } from "./media";
import {
  checkAsync,
  createProject,
  editImage,
  generateReferenceVideo,
  generateStartEndVideo,
  generateStartVideo,
  getCredits,
  getMedia,
  upscaleVideo,
  type FlowMediaEntry,
} from "./sdk";
import { getFlowModeFromModelId, type FlowVideoMode } from "./modes";
import {
  flowFailureKind,
  isFlowFallbackableError,
  listFlowRouteCandidates,
  markFlowAccountFailure,
  quotaSnapshotFromRaw,
  recordFlowAccountQuota,
  type FlowAttemptRecord,
  type FlowRouteCandidate,
} from "./router";

export interface SubmitFlowTaskInput {
  modelId: string;
  modelName: string;
  prompt?: string | null;
  images?: string[];
  videos?: string[];
  mediaRefs?: {
    startImage?: string;
    endImage?: string;
    referenceImages?: string[];
    extraRefs?: string[];
    video?: string;
  };
  dynamicInputs?: Record<string, string | string[]>;
  parameters?: Record<string, unknown>;
  workflowId?: string | null;
  workflowName?: string | null;
  requestOrigin?: string;
}

export interface FlowPollResult {
  status: "processing" | "complete" | "failed";
  task: FlowTaskRecord;
}

const FLOW_WORKFLOW_MEDIA_TIMEOUT_MS = 20 * 60 * 1000;

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return typeof value === "string" && value.length > 0 ? [value] : [];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.find((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (first) return first.trim();
    }
  }
  return "";
}

function collectInputImages(input: SubmitFlowTaskInput, names: string[]): string[] {
  const values: string[] = [];
  if (names.includes("startImage")) values.push(...asArray(input.mediaRefs?.startImage));
  if (names.includes("endImage")) values.push(...asArray(input.mediaRefs?.endImage));
  if (names.includes("referenceImages")) values.push(...asArray(input.mediaRefs?.referenceImages));
  if (names.includes("extraRefs")) values.push(...asArray(input.mediaRefs?.extraRefs));
  for (const name of names) {
    values.push(...asArray(input.dynamicInputs?.[name]));
  }
  return [...new Set(values.filter(Boolean))];
}

function collectInputVideos(input: SubmitFlowTaskInput, names: string[]): string[] {
  const values: string[] = [];
  if (names.includes("video")) values.push(...asArray(input.mediaRefs?.video));
  for (const name of names) {
    values.push(...asArray(input.dynamicInputs?.[name]));
  }
  if (values.length === 0 && input.videos) values.push(...input.videos);
  return [...new Set(values.filter(Boolean))];
}

function requirePrompt(input: SubmitFlowTaskInput, mode: FlowVideoMode): string {
  if (mode === "upscale-video") return "";
  const prompt = firstString(input.dynamicInputs?.prompt, input.prompt);
  if (!prompt) throw new Error("Prompt is required for this Google Flow mode");
  return prompt;
}

function hasWorkflowMediaNotFound(raw: unknown): boolean {
  const polls = (raw as any)?.workflow_polls;
  return Array.isArray(polls) && polls.some((poll) =>
    typeof poll?.error === "string" && /NOT_FOUND|Requested entity was not found/i.test(poll.error)
  );
}

async function ensureProject(
  workflowId: string,
  workflowName: string | null | undefined,
  accountId: string | null | undefined,
  bridgeTarget?: FlowBridgeTarget
): Promise<string> {
  const existing = await getProjectIdForWorkflow(workflowId, accountId);
  if (existing) return existing;
  const title = workflowName?.trim() || `Banana Flow ${workflowId.slice(0, 8)}`;
  const projectId = await createProject(title, bridgeTarget);
  await setProjectIdForWorkflow(workflowId, projectId, accountId);
  return projectId;
}

function assertBridgeReady(): void {
  const status = getFlowBridgeStatus();
  if (!status.connected) {
    throw new Error("Google Flow extension is not connected. Load tools/flow-extension and open Google Flow.");
  }
  if (!status.flowKeyPresent) {
    throw new Error("Google Flow token is not captured yet. Open or refresh Google Flow in Chrome.");
  }
}

async function uploadImages(
  input: SubmitFlowTaskInput,
  projectId: string,
  images: string[],
  accountId?: string | null,
  bridgeTarget?: FlowBridgeTarget
): Promise<string[]> {
  const mediaIds: string[] = [];
  for (const image of images) {
    const uploaded = await ensureFlowImage({
      accountId,
      bridgeTarget,
      projectId,
      image,
      requestOrigin: input.requestOrigin,
    });
    mediaIds.push(uploaded.mediaId);
  }
  return mediaIds;
}

function taskUrl(taskId: string): string {
  return `/api/flow/media/${encodeURIComponent(taskId)}`;
}

export async function submitFlowVideoTask(input: SubmitFlowTaskInput): Promise<FlowTaskRecord> {
  const mode = getFlowModeFromModelId(input.modelId);
  if (!mode) {
    throw new Error(`Unsupported Google Flow model: ${input.modelId}`);
  }

  const workflowId = input.workflowId || "default";
  const prompt = requirePrompt(input, mode);
  const requestedAspectRatio = input.parameters?.aspectRatio;
  const aspectRatio = mode === "reference-video" ? requestedAspectRatio ?? "9:16" : requestedAspectRatio;
  const seed = input.parameters?.seed;
  let upscaleSource: FlowVideoRecord | null = null;
  let flowGenerationTrace: Record<string, unknown> | null = null;

  if (mode === "upscale-video") {
    const video = firstString(collectInputVideos(input, ["video", "inputVideo", "videos"])[0], input.videos?.[0]);
    if (!video) throw new Error("Upscale Video requires a Flow-generated video input");
    upscaleSource = await findVideoMedia(video);
    if (!upscaleSource?.mediaId) {
      throw new Error("Upscale Video currently requires a video generated by Google Flow in this Banana project");
    }
  }

  const candidates = await listFlowRouteCandidates();
  const routedCandidates = upscaleSource?.accountId
    ? candidates.filter((candidate) => candidate.account?.id === upscaleSource?.accountId)
    : candidates;
  if (routedCandidates.length === 0) {
    assertBridgeReady();
    throw new Error("No connected Google Flow account/session is available for this request");
  }

  const attempts: FlowAttemptRecord[] = [];
  const firstAccountId = routedCandidates[0]?.account?.id ?? null;
  let lastError: unknown = null;

  for (const candidate of routedCandidates) {
    const startedAt = Date.now();
    try {
      const accountId = candidate.account?.id ?? null;
      const projectId = mode === "upscale-video" && upscaleSource
        ? upscaleSource.projectId
        : await ensureProject(workflowId, input.workflowName, accountId, candidate.target);
      const { paygateTier, raw: rawCredits } = await getCredits(candidate.target);
      await recordFlowAccountQuota(candidate.account, rawCredits);
      let submitResult: { operationNames: string[]; workflows: any[]; raw: unknown; trace?: unknown };

      if (mode === "reference-video") {
        const refs = collectInputImages(input, ["referenceImages", "refs", "component_images"]);
        const images = refs.length > 0 ? refs : input.images ?? [];
        if (images.length === 0) throw new Error("Reference Video requires at least one image reference");
        const referenceMediaIds = await uploadImages(input, projectId, images, accountId, candidate.target);
        submitResult = await generateReferenceVideo({
          prompt,
          projectId,
          referenceMediaIds,
          paygateTier,
          aspectRatio,
          seed,
          bridgeTarget: candidate.target,
        });
        flowGenerationTrace = {
          mode,
          prompt,
          aspectRatio,
          referenceMediaIds,
          referenceImageCount: images.length,
          submit: submitResult.trace,
        };
      } else if (mode === "start-image-video") {
        const start = firstString(input.dynamicInputs?.startImage, input.dynamicInputs?.image, input.images?.[0]);
        if (!start) throw new Error("Start Image Video requires a start image");
        const [startMediaId] = await uploadImages(input, projectId, [start], accountId, candidate.target);
        submitResult = await generateStartVideo({
          prompt,
          projectId,
          startMediaId,
          paygateTier,
          aspectRatio,
          seed,
          bridgeTarget: candidate.target,
        });
        flowGenerationTrace = {
          mode,
          prompt,
          aspectRatio,
          startMediaId,
          submit: submitResult.trace,
        };
      } else if (mode === "compose-start-video") {
        const start = firstString(input.dynamicInputs?.startImage, input.dynamicInputs?.image, input.images?.[0]);
        const explicitRefs = collectInputImages(input, ["extraRefs", "referenceImages", "refs"]).filter((image) => image !== start);
        const refs = explicitRefs.length > 0 ? explicitRefs : (input.images ?? []).slice(1);
        if (!start) throw new Error("Compose Start Video requires a start image");
        if (refs.length === 0) throw new Error("Compose Start Video requires at least one extra reference image");
        const [startMediaId] = await uploadImages(input, projectId, [start], accountId, candidate.target);
        const refMediaIds = await uploadImages(input, projectId, refs, accountId, candidate.target);
        const seedPrompt = firstString(input.dynamicInputs?.seedPrompt, input.parameters?.seedPrompt, prompt);
        const seedMediaId = await editImage({
          prompt: seedPrompt,
          projectId,
          sourceMediaId: startMediaId,
          refMediaIds,
          paygateTier,
          aspectRatio,
          bridgeTarget: candidate.target,
        });
        submitResult = await generateStartVideo({
          prompt,
          projectId,
          startMediaId: seedMediaId,
          paygateTier,
          aspectRatio,
          seed,
          bridgeTarget: candidate.target,
        });
        flowGenerationTrace = {
          mode,
          prompt,
          seedPrompt,
          aspectRatio,
          startMediaId,
          refMediaIds,
          seedMediaId,
          submit: submitResult.trace,
        };
      } else if (mode === "start-end-frame") {
        const start = firstString(input.dynamicInputs?.startImage, input.images?.[0]);
        const end = firstString(input.dynamicInputs?.endImage, input.images?.[1]);
        if (!start || !end) throw new Error("Start/End Frame requires both start and end images");
        const [startMediaId, endMediaId] = await uploadImages(input, projectId, [start, end], accountId, candidate.target);
        submitResult = await generateStartEndVideo({
          prompt,
          projectId,
          startMediaId,
          endMediaId,
          paygateTier,
          aspectRatio,
          seed,
          bridgeTarget: candidate.target,
        });
        flowGenerationTrace = {
          mode,
          prompt,
          aspectRatio,
          startMediaId,
          endMediaId,
          submit: submitResult.trace,
        };
      } else {
        submitResult = await upscaleVideo({
          projectId: upscaleSource!.projectId,
          mediaId: upscaleSource!.mediaId,
          paygateTier,
          resolution: input.parameters?.resolution,
          aspectRatio: input.parameters?.aspectRatio,
          bridgeTarget: candidate.target,
        });
        flowGenerationTrace = {
          mode,
          aspectRatio: input.parameters?.aspectRatio,
          resolution: input.parameters?.resolution,
          sourceMediaId: upscaleSource!.mediaId,
          submit: submitResult.trace,
        };
      }

      await recordFlowAccountQuota(candidate.account, submitResult.raw);
      attempts.push({
        accountId,
        sessionId: candidate.session?.id ?? null,
        extensionInstanceId: candidate.session?.extensionInstanceId ?? candidate.target.extensionInstanceId ?? null,
        status: "submitted",
        startedAt,
        finishedAt: Date.now(),
      });

      const now = Date.now();
      const task: FlowTaskRecord = {
        id: createFlowTaskId(),
        mode,
        status: "processing",
        workflowId,
        workflowName: input.workflowName ?? null,
        accountId,
        sessionId: candidate.session?.id ?? null,
        extensionInstanceId: candidate.session?.extensionInstanceId ?? candidate.target.extensionInstanceId ?? null,
        attempts,
        usedFallbackAccount: attempts.length > 1 || (firstAccountId !== null && accountId !== firstAccountId),
        quotaSnapshot: quotaSnapshotFromRaw(submitResult.raw),
        projectId,
        prompt,
        modelId: input.modelId,
        modelName: input.modelName,
        operationNames: submitResult.operationNames,
        workflows: submitResult.workflows,
        generationTrace: flowGenerationTrace,
        rawSubmit: submitResult.raw,
        createdAt: now,
        updatedAt: now,
      };

      return saveTask(task);
    } catch (error) {
      lastError = error;
      attempts.push({
        accountId: candidate.account?.id ?? null,
        sessionId: candidate.session?.id ?? null,
        extensionInstanceId: candidate.session?.extensionInstanceId ?? candidate.target.extensionInstanceId ?? null,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        failureKind: flowFailureKind(error),
        startedAt,
        finishedAt: Date.now(),
      });
      if (isFlowFallbackableError(error)) {
        await markFlowAccountFailure(candidate.account, error);
      }

      const isLast = candidate === routedCandidates[routedCandidates.length - 1];
      if (!isFlowFallbackableError(error) || isLast) break;
    }
  }

  if (attempts.length > 1) {
    throw new Error(
      `All Google Flow account attempts failed: ${attempts
        .map((attempt) => `${attempt.accountId || "default"}: ${attempt.error || attempt.failureKind}`)
        .join(" | ")}`
    );
  }
  throw lastError instanceof Error ? lastError : new Error("Google Flow task submission failed");
}

async function persistVideoFromEntry(task: FlowTaskRecord, entry: FlowMediaEntry, rawPoll?: unknown): Promise<FlowTaskRecord> {
  const localPath = getFlowMediaPath(task.id);
  if (entry.encoded_video) {
    await fs.writeFile(localPath, Buffer.from(entry.encoded_video, "base64"));
  } else if (entry.url) {
    const response = await fetch(entry.url);
    if (!response.ok) throw new Error(`Failed to download Flow video: HTTP ${response.status}`);
    await fs.writeFile(localPath, Buffer.from(await response.arrayBuffer()));
  } else {
    const media = await getMedia(entry.media_id, {
      accountId: task.accountId ?? null,
      sessionId: task.sessionId ?? null,
      extensionInstanceId: task.extensionInstanceId ?? null,
    });
    const video = (media as any)?.data?.video;
    const encoded = typeof video?.encodedVideo === "string" ? video.encodedVideo : null;
    const url = typeof video?.fifeUrl === "string" ? video.fifeUrl : null;
    return persistVideoFromEntry(task, {
      ...entry,
      encoded_video: encoded ?? undefined,
      url: entry.url ?? url,
    }, rawPoll);
  }

  const completed = await markTaskComplete({
    taskId: task.id,
    mediaId: entry.media_id,
    localPath,
    url: taskUrl(task.id),
    rawPoll,
  });
  if (!completed) throw new Error("Flow task disappeared while completing");
  return completed;
}

export async function pollFlowVideoTask(taskId: string): Promise<FlowPollResult> {
  const task = await getTask(taskId);
  if (!task) throw new Error("Google Flow task not found. The dev server may have restarted or registry was removed.");
  if (task.status !== "processing") return { status: task.status, task };

  const workflows = task.workflows.length > 0
    ? task.workflows
    : task.mode === "upscale-video"
      ? task.operationNames
          .filter((name) => /_upsampled$/i.test(name))
          .map((name) => ({ name, primary_media_id: name }))
      : [];

  const pollResult = await checkAsync(task.operationNames, workflows, {
    accountId: task.accountId ?? null,
    sessionId: task.sessionId ?? null,
    extensionInstanceId: task.extensionInstanceId ?? null,
  });
  const failed = pollResult.operations.find((operation) => operation.done && operation.error);
  if (failed) {
    const failedTask = await markTaskFailed(task.id, failed.error || "Google Flow generation failed");
    return { status: "failed", task: failedTask ?? task };
  }

  const completeEntry = pollResult.operations
    .flatMap((operation) => operation.media_entries)
    .find((entry) => entry.mediaType === "video" && entry.media_id);

  if (!completeEntry) {
    if (
      hasWorkflowMediaNotFound(pollResult.raw) &&
      Date.now() - task.createdAt > FLOW_WORKFLOW_MEDIA_TIMEOUT_MS
    ) {
      const failedTask = await markTaskFailed(
        task.id,
        "Google Flow workflow media was not found after 20 minutes. The R2V submit succeeded, but Google did not publish the output media."
      );
      return { status: "failed", task: failedTask ?? task };
    }
    return { status: "processing", task: { ...task, rawPoll: pollResult.raw } };
  }

  try {
    const completed = await persistVideoFromEntry(task, completeEntry, pollResult.raw);
    return { status: "complete", task: completed };
  } catch (error) {
    const failedTask = await markTaskFailed(
      task.id,
      error instanceof Error ? error.message : "Failed to persist Google Flow video"
    );
    return { status: "failed", task: failedTask ?? task };
  }
}

export async function getFlowDashboardState(): Promise<{
  bridge: ReturnType<typeof getFlowBridgeStatus>;
  tasks: FlowTaskRecord[];
}> {
  return {
    bridge: getFlowBridgeStatus(),
    tasks: await listTasks(50),
  };
}
