/**
 * GenerateVideo Executor
 *
 * Unified executor for generateVideo nodes.
 * Used by both executeWorkflow and regenerateNode.
 */

import type { GenerateVideoNodeData, SelectedModel } from "@/types";
import { buildGenerateHeaders } from "@/store/utils/buildApiHeaders";
import { pollGenerateTask } from "./pollTaskCompletion";
import { runWithFallback } from "./runWithFallback";
import type { NodeExecutionContext } from "./types";
import { buildGenerationTraceContext } from "./generationTraceClient";
import { logger } from "@/utils/logger";

export interface GenerateVideoOptions {
  /** When true, falls back to stored inputImages/inputPrompt if no connections provide them. */
  useStoredFallback?: boolean;
}

export async function executeGenerateVideo(
  ctx: NodeExecutionContext,
  options: GenerateVideoOptions = {}
): Promise<void> {
  const {
    node,
    getConnectedInputs,
    updateNodeData,
    getFreshNode,
    signal,
    providerSettings,
    workflowId,
    workflowName,
    addIncurredCost,
    generationsPath,
    getNodes,
    getEdges,
    trackSaveGeneration,
  } = ctx;

  const { useStoredFallback = false } = options;

  const connectedInputs = getConnectedInputs(node.id);
  const { images: connectedImages, videos: connectedVideos, text: connectedText, audio: connectedAudio, dynamicInputs } = connectedInputs;

  // Get fresh node data from store
  const freshNode = getFreshNode(node.id);
  const nodeData = (freshNode?.data || node.data) as GenerateVideoNodeData;

  // Determine images and text
  let images: string[];
  let videos: string[];
  let text: string | null;

  if (useStoredFallback) {
    images = connectedImages.length > 0 ? connectedImages : nodeData.inputImages;
    videos = connectedVideos.length > 0 ? connectedVideos : (nodeData.inputVideos || []);
    text = connectedText ?? nodeData.inputPrompt;
    const hasPrompt = text || dynamicInputs.prompt || dynamicInputs.negative_prompt;
    const hasAudio = connectedAudio.length > 0;
    if (!hasPrompt && images.length === 0 && videos.length === 0 && !hasAudio) {
      updateNodeData(node.id, {
        status: "error",
        error: "Missing required inputs",
      });
      throw new Error("Missing required inputs");
    }
  } else {
    images = connectedImages;
    videos = connectedVideos;
    text = connectedText;
    const hasPrompt = text || dynamicInputs.prompt || dynamicInputs.negative_prompt;
    const hasAudio = connectedAudio.length > 0;
    if (!hasPrompt && images.length === 0 && videos.length === 0 && !hasAudio) {
      updateNodeData(node.id, {
        status: "error",
        error: "Missing required inputs",
      });
      throw new Error("Missing required inputs");
    }
  }

  if (!nodeData.selectedModel?.modelId) {
    updateNodeData(node.id, {
      status: "error",
      error: "No model selected",
    });
    throw new Error("No model selected");
  }

  updateNodeData(node.id, {
    inputImages: images,
    inputVideos: videos,
    inputPrompt: text,
    status: "loading",
    error: null,
  });

  const runOnce = async (modelToUse: SelectedModel, parametersOverride?: Record<string, unknown>): Promise<void> => {
    const provider = modelToUse.provider;
    const headers = buildGenerateHeaders(provider, providerSettings);
    const traceContext = buildGenerationTraceContext({
      sessionId: logger.getSessionId(),
      nodeId: node.id,
      nodeType: node.type,
      workflowId,
      connectedInputs,
      nodes: getNodes(),
      edges: getEdges(),
      fallbackAttempt: modelToUse.modelId === nodeData.fallbackModel?.modelId ? "fallback" : "primary",
    });

    const requestPayload = {
      images,
      videos,
      prompt: text,
      selectedModel: modelToUse,
      parameters: parametersOverride ?? nodeData.parameters,
      dynamicInputs,
      mediaType: "video" as const,
      workflowId,
      workflowName,
      traceContext,
    };

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers,
        body: JSON.stringify(requestPayload),
        ...(signal ? { signal } : {}),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorMessage;
        } catch {
          if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
        }

        updateNodeData(node.id, {
          status: "error",
          error: errorMessage,
        });
        throw new Error(errorMessage);
      }

      let result = await response.json();
      const submitTrace = result.generationTrace;
      if (submitTrace?.traceId) {
        logger.info("node.execution", "Generation trace captured", {
          nodeId: node.id,
          traceId: submitTrace.traceId,
          logPath: submitTrace.logPath,
        });
      }

      // Handle polling response (long-running Kie tasks)
      if (result.polling) {
        result = await pollGenerateTask({
          taskId: result.taskId,
          provider: result.pollProvider,
          modelId: result.pollModelId,
          modelName: result.pollModelName,
          mediaType: result.pollMediaType,
          headers,
          signal,
        });
        if (!result.generationTrace && submitTrace) {
          result = { ...result, generationTrace: submitTrace };
        }

        if (!result.success) {
          updateNodeData(node.id, {
            status: "error",
            error: result.error || "Video generation failed",
            __latestGenerationTrace: result.generationTrace,
          });
          throw new Error(result.error || "Video generation failed");
        }
      }

      // Handle video response (video or videoUrl field)
      const videoData = result.video || result.videoUrl;
      if (result.success && (videoData || result.image)) {
        const outputContent = videoData || result.image;
        const timestamp = Date.now();
        const videoId = `${timestamp}`;

        // Add to node's video history
        const newHistoryItem = {
          id: videoId,
          timestamp,
          prompt: text || "",
          model: modelToUse.modelId || "",
        };
        const updatedHistory = [newHistoryItem, ...(nodeData.videoHistory || [])].slice(0, 50);

        updateNodeData(node.id, {
          outputVideo: outputContent,
          status: "complete",
          error: null,
          videoHistory: updatedHistory,
          selectedVideoHistoryIndex: 0,
          __latestGenerationTrace: result.generationTrace,
        });
        // Track cost
        if (modelToUse.provider === "fal" && modelToUse.pricing) {
          addIncurredCost(modelToUse.pricing.amount);
        }

        // Auto-save to generations folder if configured
        if (generationsPath) {
          const saveContent = videoData
            ? { video: videoData }
            : { image: result.image };

          const savePromise = fetch("/api/save-generation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              directoryPath: generationsPath,
              ...saveContent,
              prompt: text,
              imageId: videoId,
            }),
          })
            .then((res) => res.json())
            .then((saveResult) => {
              if (saveResult.success && saveResult.imageId && saveResult.imageId !== videoId) {
                const currentNode = getNodes().find((n) => n.id === node.id);
                if (currentNode) {
                  const currentData = currentNode.data as GenerateVideoNodeData;
                  const histCopy = [...(currentData.videoHistory || [])];
                  const entryIndex = histCopy.findIndex((h) => h.id === videoId);
                  if (entryIndex !== -1) {
                    histCopy[entryIndex] = { ...histCopy[entryIndex], id: saveResult.imageId };
                    updateNodeData(node.id, { videoHistory: histCopy });
                  }
                }
              }
            })
            .catch((err) => {
              console.error("Failed to save video generation:", err);
            });

          trackSaveGeneration(videoId, savePromise);
        }
      } else {
        updateNodeData(node.id, {
          status: "error",
          error: result.error || "Video generation failed",
          __latestGenerationTrace: result.generationTrace,
        });
        throw new Error(result.error || "Video generation failed");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      let errorMessage = "Video generation failed";
      if (error instanceof TypeError && error.message.includes("NetworkError")) {
        errorMessage = "Network error. Check your connection and try again.";
      } else if (error instanceof TypeError) {
        errorMessage = `Network error: ${error.message}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      updateNodeData(node.id, {
        status: "error",
        error: errorMessage,
      });
      throw new Error(errorMessage);
    }
  };

  await runWithFallback({
    nodeId: node.id,
    primary: nodeData.selectedModel,
    fallback: nodeData.fallbackModel,
    fallbackParameters: nodeData.fallbackParameters,
    updateNodeData,
    runOnce,
    clearOutput: { outputVideo: null },
  });
}
