/**
 * Generate API Route
 * 
 * TIMEOUT CONFIGURATION:
 * - maxDuration: Only applies on Vercel, not locally
 * - AbortSignal.timeout: Controls outgoing fetch to providers
 * - For local development, server.requestTimeout must be set in server.js (Node.js default is 5 minutes)
 * 
 * FAL.AI QUEUE API NOTE:
 * Uses generateWithFalQueue with async queue submission + polling.
 * Images are uploaded to fal CDN before submission to avoid payload size issues.
 */
import { NextRequest, NextResponse } from "next/server";
import { GenerateRequest, GenerateResponse, ModelType, SelectedModel, ProviderType } from "@/types";
import { GenerationInput, ModelCapability } from "@/lib/providers/types";
import { generateWithGemini, generateWithGeminiVideo } from "./providers/gemini";
import { generateWithReplicate } from "./providers/replicate";
import { clearFalInputMappingCache as _clearFalInputMappingCache, generateWithFalQueue } from "./providers/fal";
import { submitKieTask } from "./providers/kie";
import { generateWithWaveSpeed } from "./providers/wavespeed";
import { submitFlowVideoTask } from "@/lib/flow/engine";
import {
  buildGenerationTrace,
  buildTraceWarnings,
  saveGenerationTrace,
  summarizeDynamicInputs,
  summarizeMediaRef,
} from "@/lib/generationTrace";
import type { GenerationTrace, GenerationTraceMediaRef } from "@/types";

// Re-export for backward compatibility (test file imports from route)
export const clearFalInputMappingCache = _clearFalInputMappingCache;

export const maxDuration = 600; // 10 minute timeout for video generation polling
export const dynamic = 'force-dynamic'; // Ensure this route is always dynamic


/**
 * Extended request format that supports both legacy and multi-provider requests
 */
interface MultiProviderGenerateRequest extends GenerateRequest {
  selectedModel?: SelectedModel;
  parameters?: Record<string, unknown>;
  /** Dynamic inputs from schema-based connections (e.g., image_url, tail_image_url, prompt) */
  dynamicInputs?: Record<string, string | string[]>;
}

function refsFromMedia(values: string[] | undefined, kind: "image" | "video", role: string): GenerationTraceMediaRef[] {
  return (values ?? []).map((value, index) => summarizeMediaRef({ value, index, role, kind }));
}

function refsFromDynamicInputs(dynamicInputs?: Record<string, string | string[]>): GenerationTraceMediaRef[] {
  const refs: GenerationTraceMediaRef[] = [];
  if (!dynamicInputs) return refs;
  for (const [key, value] of Object.entries(dynamicInputs)) {
    if (!/image|frame|video|audio|ref/i.test(key)) continue;
    const kind = key.toLowerCase().includes("video") ? "video" : key.toLowerCase().includes("audio") ? "audio" : "image";
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item, index) => {
      if (typeof item === "string" && item) refs.push(summarizeMediaRef({ value: item, index, role: key, kind }));
    });
  }
  return refs;
}

function hashes(refs: GenerationTraceMediaRef[]): string[] {
  return refs.map((ref) => ref.sha256 || "").filter(Boolean);
}

async function persistTrace(input: {
  requestId: string;
  body: MultiProviderGenerateRequest;
  provider: ProviderType;
  resolvedPrompt: string;
  mediaRefs: GenerationTraceMediaRef[];
  providerPayload?: Record<string, unknown> | null;
  response?: Record<string, unknown> | null;
  error?: string | null;
  providerImageRefs?: GenerationTraceMediaRef[];
}): Promise<GenerationTrace> {
  const warnings = buildTraceWarnings({
    resolvedPrompt: input.resolvedPrompt,
    topLevelPrompt: input.body.prompt,
    dynamicPrompt: input.body.dynamicInputs?.prompt,
    inputImageHashes: hashes(refsFromMedia(input.body.images, "image", "inputImages")),
    providerImageHashes: input.providerImageRefs ? hashes(input.providerImageRefs) : undefined,
  });
  const connectedInputs = input.body.traceContext?.connectedInputs ?? {
    text: input.body.prompt ?? null,
    images: refsFromMedia(input.body.images, "image", "inputImages"),
    videos: refsFromMedia(input.body.videos, "video", "inputVideos"),
    dynamicInputs: summarizeDynamicInputs(input.body.dynamicInputs),
  };
  const trace = buildGenerationTrace({
    requestId: input.requestId,
    context: input.body.traceContext,
    selectedModel: input.body.selectedModel,
    provider: input.provider,
    mediaType: input.body.mediaType ?? "image",
    parameters: input.body.parameters ?? null,
    resolvedPrompt: input.resolvedPrompt,
    mediaRefs: input.mediaRefs,
    connectedInputs,
    providerPayload: input.providerPayload ?? null,
    response: input.response ?? null,
    error: input.error ?? null,
    warnings,
  });
  return saveGenerationTrace(trace);
}

function traceForResponse(body: MultiProviderGenerateRequest, trace: GenerationTrace): GenerationTrace | undefined {
  return body.traceContext ? trace : undefined;
}


export function buildMediaResponse(output: { type: string; data: string; url?: string }, generationTrace?: GenerationTrace): NextResponse {
  if (output.type === "3d") {
    return NextResponse.json<GenerateResponse>({
      success: true,
      model3dUrl: output.url,
      contentType: "3d",
      generationTrace,
    });
  }

  if (output.type === "video") {
    const isLarge = !output.data && output.url;
    return NextResponse.json<GenerateResponse>({
      success: true,
      video: isLarge ? undefined : output.data,
      videoUrl: isLarge ? output.url : undefined,
      contentType: "video",
      generationTrace,
    });
  }

  if (output.type === "audio") {
    const isLarge = !output.data && output.url;
    return NextResponse.json<GenerateResponse>({
      success: true,
      audio: isLarge ? undefined : output.data,
      audioUrl: isLarge ? output.url : undefined,
      contentType: "audio",
      generationTrace,
    });
  }

  return NextResponse.json<GenerateResponse>({
    success: true,
    image: output.data,
    contentType: "image",
    generationTrace,
  });
}

function capabilitiesForMediaType(mediaType?: string): ModelCapability[] {
  const map: Record<string, ModelCapability[]> = {
    audio: ["text-to-audio"],
    video: ["text-to-video"],
    "3d": ["text-to-3d"],
  };
  return map[mediaType ?? ""] ?? ["text-to-image"];
}

function getOpenAIBaseUrl(): string {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}

function normalizeOpenAIImageSize(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "1024x1024";
}

function collectOpenAIEditImages(
  images?: string[],
  dynamicInputs?: Record<string, string | string[]>
): string[] {
  const collected = [...(images ?? [])];

  if (dynamicInputs) {
    for (const [key, value] of Object.entries(dynamicInputs)) {
      const normalizedKey = key.toLowerCase();
      if (!normalizedKey.includes("image") && !normalizedKey.includes("frame")) continue;
      if (Array.isArray(value)) {
        collected.push(...value);
      } else if (value) {
        collected.push(value);
      }
    }
  }

  return [...new Set(collected.filter(Boolean))];
}

async function fetchImageUrlAsDataUrl(url: string, apiKey: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download generated image: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = await response.arrayBuffer();
  return `data:${contentType};base64,${Buffer.from(buffer).toString("base64")}`;
}

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  console.log(`\n[API:${requestId}] ========== NEW GENERATE REQUEST ==========`);

  try {
    const body: MultiProviderGenerateRequest = await request.json();
    const {
      images,
      videos,
      prompt,
      model = "nano-banana-pro",
      aspectRatio,
      resolution,
      useGoogleSearch,
      useImageSearch,
      selectedModel,
      parameters,
      dynamicInputs,
      mediaType,
      workflowId,
      workflowName,
      mediaRefs,
    } = body;

    // Prompt is required unless:
    // - Provided via dynamicInputs
    // - Images are provided (image-to-video/image-to-image models)
    // - Dynamic inputs contain image frames (first_frame, last_frame, etc.)
    const hasPrompt = prompt || (dynamicInputs && (
      typeof dynamicInputs.prompt === 'string'
        ? dynamicInputs.prompt
        : Array.isArray(dynamicInputs.prompt) && dynamicInputs.prompt.length > 0
    ));
    const hasImages = (images && images.length > 0);
    const hasVideos = (videos && videos.length > 0);
    const hasImageInputs = dynamicInputs && Object.keys(dynamicInputs).some(key =>
      key.toLowerCase().includes('frame') || key.toLowerCase().includes('image') || key.toLowerCase().includes('video')
    );

    if (!hasPrompt && !hasImages && !hasVideos && !hasImageInputs) {
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "Prompt or image input is required",
        },
        { status: 400 }
      );
    }

    // Determine which provider to use
    const provider: ProviderType = selectedModel?.provider || "gemini";
    console.log(`[API:${requestId}] Provider: ${provider}, Model: ${selectedModel?.modelId || model}`);

    // Route to appropriate provider
    if (provider === "flow") {
      if (!selectedModel?.modelId || !selectedModel?.displayName) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "selectedModel with modelId and displayName is required for Google Flow" },
          { status: 400 }
        );
      }

      try {
        const resolvedPrompt =
          typeof dynamicInputs?.prompt === "string"
            ? dynamicInputs.prompt
            : Array.isArray(dynamicInputs?.prompt)
              ? dynamicInputs.prompt[0]
              : prompt || "";
        const task = await submitFlowVideoTask({
          prompt,
          modelId: selectedModel.modelId,
          modelName: selectedModel.displayName,
          images: images ?? [],
          videos: videos ?? [],
          mediaRefs,
          dynamicInputs,
          parameters,
          workflowId,
          workflowName,
          requestOrigin: request.nextUrl?.origin,
        });
        const trace = await persistTrace({
          requestId,
          body,
          provider,
          resolvedPrompt,
          mediaRefs: [
            ...refsFromMedia(images, "image", "inputImages"),
            ...refsFromMedia(videos, "video", "inputVideos"),
            ...refsFromDynamicInputs(dynamicInputs),
          ],
          providerPayload: {
            flowTaskId: task.id,
            mode: task.mode,
            modelId: task.modelId,
            modelName: task.modelName,
            projectId: task.projectId,
            operationNames: task.operationNames,
            generationTrace: task.generationTrace,
          },
          response: { polling: true, taskId: task.id, provider: "flow" },
        });

        return NextResponse.json<GenerateResponse>({
          success: true,
          polling: true,
          taskId: task.id,
          pollProvider: "flow",
          pollModelId: selectedModel.modelId,
          pollModelName: selectedModel.displayName,
          pollMediaType: "video",
          generationTrace: traceForResponse(body, trace),
        });
      } catch (error) {
        const trace = await persistTrace({
          requestId,
          body,
          provider,
          resolvedPrompt: prompt || "",
          mediaRefs: [
            ...refsFromMedia(images, "image", "inputImages"),
            ...refsFromMedia(videos, "video", "inputVideos"),
            ...refsFromDynamicInputs(dynamicInputs),
          ],
          providerPayload: { modelId: selectedModel.modelId, modelName: selectedModel.displayName },
          error: error instanceof Error ? error.message : "Google Flow task submission failed",
        });
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: error instanceof Error ? error.message : "Google Flow task submission failed",
            generationTrace: traceForResponse(body, trace),
          },
          { status: 400 }
        );
      }
    }

    if (provider === "openai") {
      if (!selectedModel?.modelId || !selectedModel?.displayName) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "selectedModel with modelId and displayName is required for OpenAI" },
          { status: 400 }
        );
      }

      const openaiApiKey = request.headers.get("X-OpenAI-API-Key") || process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: "OpenAI API key not configured. Add OPENAI_API_KEY to .env.local or configure in Settings.",
          },
          { status: 401 }
        );
      }

      const resolvedPrompt =
        prompt ||
        (typeof dynamicInputs?.prompt === "string"
          ? dynamicInputs.prompt
          : Array.isArray(dynamicInputs?.prompt)
            ? dynamicInputs.prompt[0]
            : "") ||
        "";
      const editImages = collectOpenAIEditImages(images, dynamicInputs);
      const hasEditImages = editImages.length > 0 || !!hasImageInputs;
      const imageEndpoint = hasEditImages ? "edits" : "generations";
      const providerImageRefs = refsFromMedia(editImages, "image", "openaiEditImages");
      const imageBody = hasEditImages
        ? {
            model: selectedModel.modelId,
            prompt: resolvedPrompt,
            images: editImages.map((image) => ({ image_url: image })),
            n: 1,
            size: normalizeOpenAIImageSize(parameters?.size),
            response_format: "b64_json",
          }
        : {
            model: selectedModel.modelId,
            prompt: resolvedPrompt,
            n: 1,
            size: normalizeOpenAIImageSize(parameters?.size),
            response_format: "b64_json",
          };

      console.log(`[API:${requestId}] OpenAI image request`, {
        endpoint: imageEndpoint,
        promptLength: resolvedPrompt.length,
        promptPreview: resolvedPrompt.slice(0, 300),
        imageCount: editImages.length,
        size: imageBody.size,
      });
      let trace = await persistTrace({
        requestId,
        body,
        provider,
        resolvedPrompt,
        mediaRefs: providerImageRefs,
        providerImageRefs,
        providerPayload: {
          endpoint: `images/${imageEndpoint}`,
          body: imageBody,
        },
      });

      const imageResponse = await fetch(`${getOpenAIBaseUrl()}/images/${imageEndpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify(imageBody),
      });

      if (!imageResponse.ok) {
        const errorText = await imageResponse.text();
        let errorMessage = `OpenAI image generation failed: ${imageResponse.status}`;
        try {
          const parsed = JSON.parse(errorText);
          errorMessage = parsed.error?.message || parsed.message || errorMessage;
        } catch {
          if (errorText) errorMessage = errorText.substring(0, 500);
        }
        trace = await persistTrace({
          requestId,
          body,
          provider,
          resolvedPrompt,
          mediaRefs: providerImageRefs,
          providerImageRefs,
          providerPayload: {
            endpoint: `images/${imageEndpoint}`,
            body: imageBody,
          },
          error: errorMessage,
        });
        return NextResponse.json<GenerateResponse>(
          { success: false, error: errorMessage, generationTrace: traceForResponse(body, trace) },
          { status: imageResponse.status }
        );
      }

      const data = await imageResponse.json();
      const first = data.data?.[0];
      let dataUrl: string | null = null;
      if (first?.b64_json) {
        dataUrl = `data:image/png;base64,${first.b64_json}`;
      } else if (first?.url) {
        dataUrl = await fetchImageUrlAsDataUrl(first.url, openaiApiKey);
      }

      if (!dataUrl) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "No image in OpenAI response", generationTrace: traceForResponse(body, trace) },
          { status: 500 }
        );
      }

      trace = await persistTrace({
        requestId,
        body,
        provider,
        resolvedPrompt,
        mediaRefs: providerImageRefs,
        providerImageRefs,
        providerPayload: {
          endpoint: `images/${imageEndpoint}`,
          body: imageBody,
        },
        response: { contentType: "image", output: dataUrl.startsWith("data:") ? "data:image" : "url" },
      });

      return NextResponse.json<GenerateResponse>({
        success: true,
        image: dataUrl,
        contentType: "image",
        generationTrace: traceForResponse(body, trace),
      });
    }

    if (provider === "replicate") {
      if (!selectedModel?.modelId || !selectedModel?.displayName) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "selectedModel with modelId and displayName is required for Replicate" },
          { status: 400 }
        );
      }

      // User-provided key takes precedence over env variable
      const replicateApiKey = request.headers.get("X-Replicate-API-Key") || process.env.REPLICATE_API_KEY;
      if (!replicateApiKey) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: "Replicate API key not configured. Add REPLICATE_API_KEY to .env.local or configure in Settings.",
          },
          { status: 401 }
        );
      }

      // Keep Data URIs as-is since localhost URLs won't work (provider can't reach them)
      const processedImages: string[] = images ? [...images] : [];

      // Process dynamicInputs: filter empty values, keep Data URIs
      let processedDynamicInputs: Record<string, string | string[]> | undefined = undefined;

      if (dynamicInputs) {
        processedDynamicInputs = {};
        for (const key of Object.keys(dynamicInputs)) {
          const value = dynamicInputs[key];

          // Skip empty/null/undefined values (arrays pass through)
          if (value === null || value === undefined || value === '') {
            continue;
          }

          // Keep the value as-is (Data URIs work with Replicate)
          processedDynamicInputs[key] = value;
        }
      }

      // Build generation input
      const genInput: GenerationInput = {
        model: {
          id: selectedModel.modelId,
          name: selectedModel.displayName,
          provider: "replicate",
          capabilities: capabilitiesForMediaType(mediaType),
          description: null,
        },
        prompt: prompt || "",
        images: processedImages,
        parameters,
        dynamicInputs: processedDynamicInputs,
      };

      const result = await generateWithReplicate(requestId, replicateApiKey, genInput);
      const trace = await persistTrace({
        requestId,
        body,
        provider,
        resolvedPrompt: genInput.prompt,
        mediaRefs: [
          ...refsFromMedia(processedImages, "image", "inputImages"),
          ...refsFromDynamicInputs(processedDynamicInputs),
        ],
        providerPayload: {
          provider: "replicate",
          modelId: selectedModel.modelId,
          input: genInput,
        },
        response: result.success ? { outputCount: result.outputs?.length ?? 0 } : null,
        error: result.success ? null : result.error || "Generation failed",
      });

      if (!result.success) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: result.error || "Generation failed",
            generationTrace: traceForResponse(body, trace),
          },
          { status: 500 }
        );
      }

      // Return first output
      const output = result.outputs?.[0];
      if (!output?.data && !output?.url) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "No output in generation result", generationTrace: traceForResponse(body, trace) },
          { status: 500 }
        );
      }

      return buildMediaResponse(output, traceForResponse(body, trace));
    }

    if (provider === "fal") {
      if (!selectedModel?.modelId || !selectedModel?.displayName) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "selectedModel with modelId and displayName is required for fal.ai" },
          { status: 400 }
        );
      }

      // User-provided key takes precedence over env variable
      const falApiKey = request.headers.get("X-Fal-API-Key") || process.env.FAL_API_KEY || null;

      if (!falApiKey) {
        console.warn(`[API:${requestId}] No FAL API key configured. Proceeding without auth (rate-limited).`);
      }

      // Pass images as-is; generateWithFalQueue uploads base64 to CDN internally
      const processedImages: string[] = images ? [...images] : [];

      // Process dynamicInputs: filter empty values
      let processedDynamicInputs: Record<string, string | string[]> | undefined = undefined;

      if (dynamicInputs) {
        processedDynamicInputs = {};
        for (const key of Object.keys(dynamicInputs)) {
          const value = dynamicInputs[key];

          // Skip empty/null/undefined values (arrays pass through)
          if (value === null || value === undefined || value === '') {
            continue;
          }

          // Keep the value as-is; CDN upload happens in generateWithFalQueue
          processedDynamicInputs[key] = value;
        }
      }

      // Build generation input
      const genInput: GenerationInput = {
        model: {
          id: selectedModel.modelId,
          name: selectedModel.displayName,
          provider: "fal",
          capabilities: capabilitiesForMediaType(mediaType),
          description: null,
        },
        prompt: prompt || "",
        images: processedImages,
        parameters,
        dynamicInputs: processedDynamicInputs,
      };

      const result = await generateWithFalQueue(requestId, falApiKey, genInput);
      const trace = await persistTrace({
        requestId,
        body,
        provider,
        resolvedPrompt: genInput.prompt,
        mediaRefs: [
          ...refsFromMedia(processedImages, "image", "inputImages"),
          ...refsFromDynamicInputs(processedDynamicInputs),
        ],
        providerPayload: {
          provider: "fal",
          modelId: selectedModel.modelId,
          input: genInput,
        },
        response: result.success ? { outputCount: result.outputs?.length ?? 0 } : null,
        error: result.success ? null : result.error || "Generation failed",
      });

      if (!result.success) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: result.error || "Generation failed",
            generationTrace: traceForResponse(body, trace),
          },
          { status: 500 }
        );
      }

      // Return first output
      const output = result.outputs?.[0];
      if (!output?.data && !output?.url) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "No output in generation result", generationTrace: traceForResponse(body, trace) },
          { status: 500 }
        );
      }

      return buildMediaResponse(output, traceForResponse(body, trace));
    }

    if (provider === "kie") {
      if (!selectedModel?.modelId || !selectedModel?.displayName) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "selectedModel with modelId and displayName is required for Kie.ai" },
          { status: 400 }
        );
      }

      // User-provided key takes precedence over env variable
      const kieApiKey = request.headers.get("X-Kie-Key") || process.env.KIE_API_KEY;
      if (!kieApiKey) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: "Kie.ai API key not configured. Add KIE_API_KEY to .env.local or configure in Settings.",
          },
          { status: 401 }
        );
      }

      // Process images - Kie requires URLs, we'll upload base64 images in generateWithKie
      const processedImages: string[] = images ? [...images] : [];

      // Process dynamicInputs: filter empty values
      let processedDynamicInputs: Record<string, string | string[]> | undefined = undefined;

      if (dynamicInputs) {
        processedDynamicInputs = {};
        for (const key of Object.keys(dynamicInputs)) {
          const value = dynamicInputs[key];

          // Skip empty/null/undefined values
          if (value === null || value === undefined || value === '') {
            continue;
          }

          processedDynamicInputs[key] = value;
        }
      }

      // Build generation input
      const genInput: GenerationInput = {
        model: {
          id: selectedModel.modelId,
          name: selectedModel.displayName,
          provider: "kie",
          capabilities: capabilitiesForMediaType(mediaType),
          description: null,
        },
        prompt: prompt || "",
        images: processedImages,
        parameters,
        dynamicInputs: processedDynamicInputs,
      };

      // Submit task and return immediately — client polls for completion
      try {
        const { taskId, isVeo, trace: kieTrace } = await submitKieTask(requestId, kieApiKey, genInput);
        const trace = await persistTrace({
          requestId,
          body,
          provider,
          resolvedPrompt: genInput.prompt,
          mediaRefs: [
            ...refsFromMedia(processedImages, "image", "inputImages"),
            ...refsFromDynamicInputs(processedDynamicInputs),
          ],
          providerPayload: {
            provider: "kie",
            modelId: selectedModel.modelId,
            taskId,
            isVeo,
            ...kieTrace,
          },
          response: { polling: true, taskId, provider: "kie" },
        });
        return NextResponse.json<GenerateResponse>({
          success: true,
          polling: true,
          taskId,
          pollProvider: 'kie',
          pollModelId: selectedModel.modelId,
          pollModelName: selectedModel.displayName,
          pollMediaType: mediaType || 'image',
          generationTrace: traceForResponse(body, trace),
        });
      } catch (error) {
        const trace = await persistTrace({
          requestId,
          body,
          provider,
          resolvedPrompt: genInput.prompt,
          mediaRefs: [
            ...refsFromMedia(processedImages, "image", "inputImages"),
            ...refsFromDynamicInputs(processedDynamicInputs),
          ],
          providerPayload: { provider: "kie", modelId: selectedModel.modelId },
          error: error instanceof Error ? error.message : "Task submission failed",
        });
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: error instanceof Error ? error.message : "Task submission failed",
            generationTrace: traceForResponse(body, trace),
          },
          { status: 500 }
        );
      }
    }

    if (provider === "wavespeed") {
      if (!selectedModel?.modelId || !selectedModel?.displayName) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "selectedModel with modelId and displayName is required for WaveSpeed" },
          { status: 400 }
        );
      }

      // User-provided key takes precedence over env variable
      const wavespeedApiKey = request.headers.get("X-WaveSpeed-Key") || process.env.WAVESPEED_API_KEY;
      if (!wavespeedApiKey) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: "WaveSpeed API key not configured. Add WAVESPEED_API_KEY to .env.local or configure in Settings.",
          },
          { status: 401 }
        );
      }

      // Keep Data URIs as-is since localhost URLs won't work
      const processedImages: string[] = images ? [...images] : [];

      // Process dynamicInputs: filter empty values
      let processedDynamicInputs: Record<string, string | string[]> | undefined = undefined;

      if (dynamicInputs) {
        processedDynamicInputs = {};
        for (const key of Object.keys(dynamicInputs)) {
          const value = dynamicInputs[key];

          // Skip empty/null/undefined values
          if (value === null || value === undefined || value === '') {
            continue;
          }

          processedDynamicInputs[key] = value;
        }
      }

      // Build generation input
      const genInput: GenerationInput = {
        model: {
          id: selectedModel.modelId,
          name: selectedModel.displayName,
          provider: "wavespeed",
          capabilities: capabilitiesForMediaType(mediaType),
          description: null,
        },
        prompt: prompt || "",
        images: processedImages,
        parameters,
        dynamicInputs: processedDynamicInputs,
      };

      const result = await generateWithWaveSpeed(requestId, wavespeedApiKey, genInput);
      const trace = await persistTrace({
        requestId,
        body,
        provider,
        resolvedPrompt: genInput.prompt,
        mediaRefs: [
          ...refsFromMedia(processedImages, "image", "inputImages"),
          ...refsFromDynamicInputs(processedDynamicInputs),
        ],
        providerPayload: {
          provider: "wavespeed",
          modelId: selectedModel.modelId,
          input: genInput,
        },
        response: result.success ? { outputCount: result.outputs?.length ?? 0 } : null,
        error: result.success ? null : result.error || "Generation failed",
      });

      if (!result.success) {
        return NextResponse.json<GenerateResponse>(
          {
            success: false,
            error: result.error || "Generation failed",
            generationTrace: traceForResponse(body, trace),
          },
          { status: 500 }
        );
      }

      // Return first output
      const output = result.outputs?.[0];
      if (!output?.data && !output?.url) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "No output in generation result", generationTrace: traceForResponse(body, trace) },
          { status: 500 }
        );
      }

      return buildMediaResponse(output, traceForResponse(body, trace));
    }

    // Default: Use Gemini
    // User-provided key (from settings) takes precedence over env variable
    const geminiApiKey = request.headers.get("X-Gemini-API-Key") || process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "API key not configured. Add GEMINI_API_KEY to .env.local or configure in Settings.",
        },
        { status: 500 }
      );
    }

    // Use selectedModel.modelId if available (new format), fallback to legacy model field
    const geminiModel = (selectedModel?.modelId as ModelType) || model;

    // Resolve prompt: use top-level prompt, fall back to dynamicInputs.prompt
    // This handles cases where the prompt arrives via dynamicInputs instead of top-level
    let resolvedPrompt = prompt;
    if (!resolvedPrompt && dynamicInputs?.prompt) {
      resolvedPrompt = Array.isArray(dynamicInputs.prompt)
        ? dynamicInputs.prompt[0]
        : dynamicInputs.prompt;
    }
    // Validate: if a prompt was provided but isn't a string (corrupted data), return clear error
    // If no prompt provided but images exist, that's valid (image-to-image)
    if (resolvedPrompt !== undefined && resolvedPrompt !== null && typeof resolvedPrompt !== 'string') {
      return NextResponse.json<GenerateResponse>(
        { success: false, error: "prompt must be a string" },
        { status: 400 }
      );
    }

    // Check if this is a Veo video model request
    if (selectedModel?.modelId?.startsWith("veo-")) {
      // Merge negative prompt from dynamic inputs (connected handle) into parameters
      const veoParams = { ...(parameters || {}) };
      if (dynamicInputs?.negative_prompt) {
        const neg = Array.isArray(dynamicInputs.negative_prompt)
          ? dynamicInputs.negative_prompt[0]
          : dynamicInputs.negative_prompt;
        if (neg) veoParams.negativePrompt = neg;
      }
      const result = await generateWithGeminiVideo(
        requestId,
        geminiApiKey,
        selectedModel.modelId,
        resolvedPrompt || "",
        images || [],
        veoParams,
      );
      const trace = await persistTrace({
        requestId,
        body,
        provider,
        resolvedPrompt: resolvedPrompt || "",
        mediaRefs: refsFromMedia(images, "image", "inputImages"),
        providerPayload: {
          provider: "gemini",
          modelId: selectedModel.modelId,
          prompt: resolvedPrompt || "",
          images: refsFromMedia(images, "image", "geminiVideoImages"),
          parameters: veoParams,
        },
        response: result.success ? { outputCount: result.outputs?.length ?? 0 } : null,
        error: result.success ? null : result.error || "Video generation failed",
      });

      if (!result.success) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: result.error || "Video generation failed", generationTrace: traceForResponse(body, trace) },
          { status: 500 }
        );
      }

      const output = result.outputs?.[0];
      if (!output?.data && !output?.url) {
        return NextResponse.json<GenerateResponse>(
          { success: false, error: "No output in video generation result", generationTrace: traceForResponse(body, trace) },
          { status: 500 }
        );
      }

      return buildMediaResponse(output, traceForResponse(body, trace));
    }

    const trace = await persistTrace({
      requestId,
      body,
      provider,
      resolvedPrompt: resolvedPrompt || "",
      mediaRefs: refsFromMedia(images, "image", "inputImages"),
      providerPayload: {
        provider: "gemini",
        modelId: geminiModel,
        prompt: resolvedPrompt || "",
        images: refsFromMedia(images, "image", "geminiImages"),
        aspectRatio,
        resolution,
        useGoogleSearch,
        useImageSearch,
      },
    });
    return await generateWithGemini(
      requestId,
      geminiApiKey,
      resolvedPrompt,
      images || [],
      geminiModel,
      aspectRatio,
      resolution,
      useGoogleSearch,
      useImageSearch,
      traceForResponse(body, trace)
    );
  } catch (error) {
    // Extract error information
    let errorMessage = "Generation failed";
    let errorDetails = "";

    if (error instanceof Error) {
      errorMessage = error.message;
      if ("cause" in error && error.cause) {
        errorDetails = JSON.stringify(error.cause);
      }
    }

    // Try to extract more details from API errors
    if (error && typeof error === "object") {
      const apiError = error as Record<string, unknown>;
      if (apiError.status) {
        errorDetails += ` Status: ${apiError.status}`;
      }
      if (apiError.statusText) {
        errorDetails += ` ${apiError.statusText}`;
      }
    }

    // Handle rate limiting
    if (errorMessage.includes("429")) {
      return NextResponse.json<GenerateResponse>(
        {
          success: false,
          error: "Rate limit reached. Please wait and try again.",
        },
        { status: 429 }
      );
    }

    console.error(`[API:${requestId}] Generation error: ${errorMessage}${errorDetails ? ` (${errorDetails.substring(0, 200)})` : ""}`);
    return NextResponse.json<GenerateResponse>(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
