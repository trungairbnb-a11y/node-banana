import type {
  ActionDirectorNodeData,
  AudioEnvironmentNodeData,
  BlurNodeData,
  ColorCorrectionNodeData,
  CompositorNodeData,
  CropNodeData,
  ExtractFrameCustomNodeData,
  ForEachEndNodeData,
  ForEachStartNodeData,
  FrameComposerNodeData,
  LoadLoraNodeData,
  MediaDownloadNodeData,
  ReformatNodeData,
  TextSplitterNodeData,
  UtilityNodeData,
  VideoMaskOverlayNodeData,
  WorkflowNodeData,
} from "@/types";
import {
  bakeActionDirectorVideoOutputs,
  blurImage,
  colorCorrectImage,
  compositeImages,
  cropImage,
  equalizeAudio,
  extractVideoFrame,
  reformatImage,
  renderActionDirectorImageOutputs,
} from "@/utils/utilityProcessing";
import type { NodeExecutionContext, NodeExecutor } from "./types";
import { getXNodeModel } from "@/lib/xnode/models";

const UTILITY_EXECUTORS: Record<string, NodeExecutor> = {
  textSplitter: executeTextSplitter,
  loadLora: executeLoadLora,
  blur: executeBlur,
  reformat: executeReformat,
  crop: executeCrop,
  compositor: executeCompositor,
  colorCorrection: executeColorCorrection,
  forEachStart: executeForEachStart,
  forEachEnd: executeForEachEnd,
  actionDirector: executeActionDirector,
  mediaDownload: executeMediaDownload,
  videoMaskOverlay: executeVideoMaskOverlay,
  extractFrameCustom: executeExtractFrameCustom,
  frameComposer: executeFrameComposer,
  audioEnvironment: executeAudioEnvironment,
};

export function getUtilityExecutor(type: string): NodeExecutor | undefined {
  return UTILITY_EXECUTORS[type];
}

export async function executeRegisteredUtilityNode(ctx: NodeExecutionContext): Promise<boolean> {
  const executor = getUtilityExecutor(ctx.node.type);
  if (executor) {
    await executor(ctx);
    return true;
  }
  // Fall back to the generic X-Node model executor for the 72 nodes
  // reverse-engineered from https://dev-x-node.netlify.app/.
  if (getXNodeModel(ctx.node.type)) {
    await executeXNodeModelNode(ctx);
    return true;
  }
  return false;
}

/**
 * Executes a node whose behaviour is defined by the X-Node model registry
 * (see `src/lib/xnode/models.ts`). Dispatches to `/api/xnode/run`, which
 * routes to the appropriate provider (Gemini today; everything else returns
 * a structured "API key required" error so the UI can prompt the user).
 */
export async function executeXNodeModelNode(ctx: NodeExecutionContext): Promise<void> {
  const schema = getXNodeModel(ctx.node.type);
  if (!schema) {
    fail(ctx, new Error(`No X-Node schema for type ${ctx.node.type}`));
    return;
  }
  // Orchestration / webhook nodes (webhookTrigger, webhookResponse, dataForward)
  // are not API-backed — they're driven by external HTTP events and remain in
  // 'idle' until something pokes them. Skipping silently keeps Run-all flows
  // from showing a spurious error on these nodes.
  if (schema.provider === "internal") {
    return;
  }
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as Record<string, unknown>;
    const connected = ctx.getConnectedInputs(ctx.node.id);
    const prompt = (connected.text ?? (data.inputPrompt as string) ?? "").toString();
    const inputImages = connected.images ?? [];
    const inputVideo = connected.videos?.[0] ?? (data.inputVideo as string | undefined);
    const inputAudio = connected.audio?.[0] ?? (data.inputAudio as string | undefined);
    const negativePrompt = (data.negativePrompt as string | undefined) ?? "";

    const response = await fetch("/api/xnode/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: ctx.node.type,
        prompt,
        negativePrompt,
        inputImages,
        inputVideo,
        inputAudio,
        parameters: (data.parameters as Record<string, unknown>) ?? {},
      }),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    const result = (await response.json()) as
      | { ok: true; kind: "image" | "video" | "audio" | "text"; value: string }
      | { ok: false; error?: string; missingEnv?: string; provider?: string };

    if (!result.ok) {
      const missing = "missingEnv" in result && result.missingEnv
        ? ` (set ${result.missingEnv})`
        : "";
      fail(ctx, new Error((result.error ?? "X-Node execution failed") + missing));
    }

    const patch: Partial<Record<string, unknown>> = {};
    if (result.kind === "image") patch.outputImage = result.value;
    else if (result.kind === "video") patch.outputVideo = result.value;
    else if (result.kind === "audio") patch.outputAudio = result.value;
    else if (result.kind === "text") patch.outputText = result.value;
    setComplete(ctx, patch as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

function setLoading(ctx: NodeExecutionContext): void {
  ctx.updateNodeData(ctx.node.id, {
    status: "loading",
    error: null,
    progress: 0,
  } as Partial<WorkflowNodeData>);
}

function setComplete(ctx: NodeExecutionContext, data: Partial<WorkflowNodeData>): void {
  ctx.updateNodeData(ctx.node.id, {
    ...data,
    status: "complete",
    error: null,
    progress: 100,
  } as Partial<WorkflowNodeData>);
}

function fail(ctx: NodeExecutionContext, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  ctx.updateNodeData(ctx.node.id, {
    status: "error",
    error: message,
    progress: 0,
  } as Partial<WorkflowNodeData>);
  throw error instanceof Error ? error : new Error(message);
}

function firstConnectedImage(ctx: NodeExecutionContext, fallback?: string | null): string | null {
  return ctx.getConnectedInputs(ctx.node.id).images[0] ?? fallback ?? null;
}

function connectedImages(ctx: NodeExecutionContext): string[] {
  return ctx.getConnectedInputs(ctx.node.id).images;
}

function firstConnectedVideo(ctx: NodeExecutionContext, fallback?: string | null): string | null {
  return ctx.getConnectedInputs(ctx.node.id).videos[0] ?? fallback ?? null;
}

function firstConnectedAudio(ctx: NodeExecutionContext, fallback?: string | null): string | null {
  return ctx.getConnectedInputs(ctx.node.id).audio[0] ?? fallback ?? null;
}

function splitText(input: string, delimiter: string, trimItems: boolean, removeEmpty: boolean): string[] {
  const resolvedDelimiter = delimiter === "\\n" ? "\n" : delimiter === "\\t" ? "\t" : delimiter || "\n";
  const parts = input.split(resolvedDelimiter);
  return parts
    .map((part) => (trimItems ? part.trim() : part))
    .filter((part) => !removeEmpty || part.length > 0);
}

export async function executeTextSplitter(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as TextSplitterNodeData;
    const connected = ctx.getConnectedInputs(ctx.node.id);
    const inputText = connected.text ?? data.inputText ?? "";
    const outputItems = splitText(inputText, data.delimiter, data.trimItems, data.removeEmpty).slice(
      0,
      Math.max(1, data.maxOutputs || 10)
    );
    setComplete(ctx, {
      inputText,
      outputItems,
      outputText: outputItems.join("\n"),
      outputKind: "text",
    } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeLoadLora(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as LoadLoraNodeData;
    if (!data.path.trim()) throw new Error("Enter a LoRA URL or path");
    setComplete(ctx, {
      outputLora: JSON.stringify({ path: data.path.trim(), scale: data.scale }),
      outputKind: "lora",
    } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeBlur(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as BlurNodeData;
    const sourceImage = firstConnectedImage(ctx, data.sourceImage);
    if (!sourceImage) throw new Error("Connect an image to blur");
    const outputImage = await blurImage(sourceImage, data.radius);
    setComplete(ctx, { sourceImage, outputImage, outputKind: "image" } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeReformat(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as ReformatNodeData;
    const sourceImage = firstConnectedImage(ctx, data.sourceImage);
    if (!sourceImage) throw new Error("Connect an image to reformat");
    const outputImage = await reformatImage(sourceImage, {
      width: data.width,
      height: data.height,
      mode: data.mode,
      background: data.background,
    });
    setComplete(ctx, { sourceImage, outputImage, outputKind: "image" } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeCrop(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as CropNodeData;
    const sourceImage = firstConnectedImage(ctx, data.sourceImage);
    if (!sourceImage) throw new Error("Connect an image to crop");
    const outputImage = await cropImage(sourceImage, data);
    setComplete(ctx, { sourceImage, outputImage, outputKind: "image" } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeCompositor(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as CompositorNodeData;
    const images = connectedImages(ctx);
    const sourceImage = images[0] ?? data.sourceImage;
    const secondaryImage = images[1] ?? data.secondaryImage;
    if (!sourceImage || !secondaryImage) throw new Error("Connect two images to composite");
    const outputImage = await compositeImages(sourceImage, secondaryImage, {
      blendMode: data.blendMode,
      opacity: data.opacity,
    });
    setComplete(ctx, { sourceImage, secondaryImage, outputImage, outputKind: "image" } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeColorCorrection(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as ColorCorrectionNodeData;
    const sourceImage = firstConnectedImage(ctx, data.sourceImage);
    if (!sourceImage) throw new Error("Connect an image to color-correct");
    const outputImage = await colorCorrectImage(sourceImage, data);
    setComplete(ctx, { sourceImage, outputImage, outputKind: "image" } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeForEachStart(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as ForEachStartNodeData;
    const connected = ctx.getConnectedInputs(ctx.node.id);
    const inputText = connected.text ?? data.inputText ?? "";
    let outputItems: string[];
    try {
      const parsed = JSON.parse(inputText) as unknown;
      outputItems = Array.isArray(parsed) ? parsed.map((item) => String(item)) : splitText(inputText, "\n", true, true);
    } catch {
      outputItems = splitText(inputText, "\n", true, true);
    }
    const index = Math.max(0, Math.min(outputItems.length - 1, data.currentIndex || 0));
    setComplete(ctx, {
      inputText,
      currentIndex: index,
      outputItems,
      outputText: outputItems[index] ?? "",
      outputKind: "text",
    } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeForEachEnd(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const inputs = ctx.getConnectedInputs(ctx.node.id);
    const payload = {
      text: inputs.text,
      images: inputs.images,
      videos: inputs.videos,
      audio: inputs.audio,
    };
    setComplete(ctx, {
      outputText: inputs.text,
      outputImage: inputs.images[0] ?? null,
      outputVideo: inputs.videos[0] ?? null,
      outputAudio: inputs.audio[0] ?? null,
      outputJson: JSON.stringify(payload),
      outputKind: "json",
    } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeActionDirector(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as ActionDirectorNodeData;
    const inputs = ctx.getConnectedInputs(ctx.node.id);
    const sourceImage = inputs.images[0] ?? data.sourceImage;
    const sourceVideo = inputs.videos[0] ?? data.sourceVideo;
    const outputMode = data.outputMode ?? data.outputKind ?? "image";
    const width = Math.max(1, Number(data.width ?? 512));
    const height = Math.max(1, Number(data.height ?? 512));
    const mode = data.mode ?? "pose";

    if (outputMode === "video") {
      if (sourceVideo && typeof MediaRecorder === "undefined") {
        setComplete(ctx, {
          sourceVideo,
          outputVideo: sourceVideo,
          outputPoseVideo: sourceVideo,
          outputDepthVideo: sourceVideo,
          outputCannyVideo: sourceVideo,
          outputNormalVideo: sourceVideo,
          outputShadedVideo: sourceVideo,
          outputAlphaVideo: sourceVideo,
          outputKind: "video",
          outputMode: "video",
        } as Partial<WorkflowNodeData>);
        return;
      }
      const videos = await bakeActionDirectorVideoOutputs(width, height, data.frameCount ?? 48, data.fps ?? 24);
      setComplete(ctx, {
        sourceVideo: sourceVideo ?? null,
        outputVideo: videos.poseVideo,
        outputPoseVideo: videos.poseVideo,
        outputDepthVideo: videos.depthVideo,
        outputCannyVideo: videos.cannyVideo,
        outputNormalVideo: videos.normalVideo,
        outputShadedVideo: videos.shadedVideo,
        outputAlphaVideo: videos.alphaVideo,
        outputKind: "video",
        outputMode: "video",
      } as Partial<WorkflowNodeData>);
      return;
    }

    const maps = await renderActionDirectorImageOutputs(sourceImage ?? null, width, height);
    const selectedOutput = mode === "depth"
      ? maps.depth
      : mode === "canny"
        ? maps.canny
        : mode === "normal"
          ? maps.normal
          : mode === "shaded"
            ? maps.shaded
            : mode === "alpha"
              ? maps.alpha
              : maps.pose;
    setComplete(ctx, {
      sourceImage: sourceImage ?? null,
      outputImage: selectedOutput,
      outputPose: maps.pose,
      outputDepth: maps.depth,
      outputCanny: maps.canny,
      outputNormal: maps.normal,
      outputShaded: maps.shaded,
      outputAlpha: maps.alpha,
      outputVideo: null,
      outputKind: "image",
      outputMode: "image",
    } as Partial<WorkflowNodeData>);

    if (sourceImage) {
      return;
    }
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeMediaDownload(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as MediaDownloadNodeData;
    const connectedUrl = ctx.getConnectedInputs(ctx.node.id).text;
    const url = (connectedUrl ?? data.inputUrl).trim();
    if (!url) throw new Error("Enter a media URL");
    const response = await fetch("/api/media-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, format: data.format, quality: data.quality }),
      signal: ctx.signal,
    });
    const result = await response.json() as { media?: string; contentType?: string; error?: string };
    if (!response.ok || !result.media) throw new Error(result.error || "Media download failed");
    const isAudio = (result.contentType || "").startsWith("audio/") || data.format === "audio";
    setComplete(ctx, {
      inputUrl: url,
      outputAudio: isAudio ? result.media : null,
      outputVideo: isAudio ? null : result.media,
      outputKind: isAudio ? "audio" : "video",
    } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeVideoMaskOverlay(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as VideoMaskOverlayNodeData;
    const videos = ctx.getConnectedInputs(ctx.node.id).videos;
    const sourceVideo = videos[0] ?? data.sourceVideo;
    const maskVideo = videos[1] ?? data.maskVideo;
    if (!sourceVideo) throw new Error("Connect the original video");
    setComplete(ctx, {
      sourceVideo,
      maskVideo: maskVideo ?? null,
      outputVideo: sourceVideo,
      outputKind: "video",
    } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeExtractFrameCustom(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as ExtractFrameCustomNodeData;
    const sourceVideo = firstConnectedVideo(ctx, data.sourceVideo);
    if (!sourceVideo) throw new Error("Connect a video to extract a frame");
    const outputImage = await extractVideoFrame(sourceVideo, data.frameTime, data.frameIndex, data.fps);
    setComplete(ctx, { sourceVideo, outputImage, outputKind: "image" } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeFrameComposer(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as FrameComposerNodeData;
    const inputs = ctx.getConnectedInputs(ctx.node.id);
    const sourceVideo = inputs.videos[0] ?? data.sourceVideo;
    if (!sourceVideo) throw new Error("Connect a video to compose");
    setComplete(ctx, {
      sourceVideo,
      referenceImages: inputs.images,
      outputVideo: sourceVideo,
      outputKind: "video",
    } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export async function executeAudioEnvironment(ctx: NodeExecutionContext): Promise<void> {
  setLoading(ctx);
  try {
    const data = (ctx.getFreshNode(ctx.node.id)?.data ?? ctx.node.data) as AudioEnvironmentNodeData;
    const sourceAudio = firstConnectedAudio(ctx, data.sourceAudio);
    if (!sourceAudio) throw new Error("Connect audio to equalize");
    const outputAudio = await equalizeAudio(sourceAudio, {
      bass: data.bass,
      mid: data.mid,
      treble: data.treble,
      gain: data.gain,
      bypass: data.bypass,
      preset: data.preset,
      tone: data.tone,
      outputFormat: data.outputFormat,
      distance: data.distance,
      reverbWet: data.reverbWet,
      pan: data.pan,
    });
    setComplete(ctx, { sourceAudio, outputAudio, outputKind: "audio" } as Partial<WorkflowNodeData>);
  } catch (error) {
    fail(ctx, error);
  }
}

export function isUtilityNodeData(data: WorkflowNodeData): data is UtilityNodeData {
  return typeof (data as UtilityNodeData).status === "string";
}
