/**
 * API Types
 *
 * Request and response types for API routes including
 * image generation and LLM text generation.
 */

import type { AspectRatio, Resolution, ModelType } from "./models";
import type { LLMProvider, LLMModelType } from "./providers";
import type { GenerationTrace, GenerationTraceRequestContext } from "./generationTrace";

// API Request/Response types for Image Generation
export interface GenerateRequest {
  images: string[]; // Now supports multiple images
  videos?: string[]; // Optional connected video inputs for video-capable providers
  prompt: string;
  aspectRatio?: AspectRatio;
  resolution?: Resolution; // Only for Nano Banana Pro
  model?: ModelType;
  useGoogleSearch?: boolean; // Only for Nano Banana Pro and Nano Banana 2
  useImageSearch?: boolean; // Only for Nano Banana 2
  mediaType?: "image" | "video" | "3d" | "audio"; // Indicates expected output type for provider routing
  workflowId?: string | null; // Used by local browser providers such as Google Flow
  workflowName?: string | null;
  mediaRefs?: {
    startImage?: string;
    endImage?: string;
    referenceImages?: string[];
    extraRefs?: string[];
    video?: string;
  };
  traceContext?: GenerationTraceRequestContext;
}

export interface GenerateResponse {
  success: boolean;
  image?: string;
  video?: string;
  videoUrl?: string; // For large videos, return URL directly
  audio?: string; // Base64 audio data
  audioUrl?: string; // For large audio, return URL directly
  model3dUrl?: string; // For 3D models, return GLB URL directly
  contentType?: "image" | "video" | "3d" | "audio";
  error?: string;
  // Client-side polling fields (for long-running Kie tasks)
  polling?: boolean; // true = task submitted, poll for completion
  taskId?: string; // Kie task ID to poll
  pollProvider?: string; // e.g. 'kie' or 'flow' - tells poll endpoint which provider
  pollModelId?: string; // model ID for result handling
  pollModelName?: string; // display name for error messages
  generationTrace?: GenerationTrace;
  pollMediaType?: string; // 'video' | 'image' | 'audio' — for result handling
}

// API Request/Response types for LLM Text Generation
export interface LLMGenerateRequest {
  prompt: string;
  images?: string[];
  provider: LLMProvider;
  model: LLMModelType;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMGenerateResponse {
  success: boolean;
  text?: string;
  error?: string;
}
