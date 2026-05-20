/**
 * X-Node model type ID → fal.ai model endpoint mapping.
 *
 * Extracted from the netlify Turbopack bundle
 * (see xnode-bundle/output/blueprint-details.json for the source schemas).
 *
 * Used by /api/xnode/run to dispatch fal-provider model executions to
 * the existing fal.ai queue pipeline (generateWithFalQueue).
 */
export const FAL_MODEL_ID_MAP: Record<string, string> = {
  autoSubtitle: "fal-ai/workflow-utilities/auto-subtitle",
  dwPose: "fal-ai/dwpose",
  extractFrames: "fal-ai/ffmpeg-api/extract-frame",
  falBlendVideo: "fal-ai/workflow-utilities/blend-video",
  falGptImage2Edit: "openai/gpt-image-2/edit",
  falHappyHorse: "alibaba/happy-horse/reference-to-video",
  falHyWuEdit: "fal-ai/hy-wu-edit",
  falMergeAudioVideo: "fal-ai/ffmpeg-api/merge-audio-video",
  falMergeAudios: "fal-ai/ffmpeg-api/merge-audios",
  falMergeVideos: "fal-ai/ffmpeg-api/merge-videos",
  falPixelcutBgRemoval: "pixelcut/background-removal",
  falSmartResize: "fal-ai/smart-resize",
  flux2Klein9BBaseLora: "fal-ai/flux-2/klein/9b/base/lora",
  fluxProKontextEdit: "fal-ai/flux-pro/kontext",
  grokImagine: "xai/grok-imagine-image/edit",
  grokVideo: "xai/grok-imagine-video/text-to-video",
  kling26: "fal-ai/kling-video/v2.6/pro/image-to-video",
  klingAvatar: "fal-ai/kling-video/ai-avatar/v2/standard",
  klingMotionControl: "fal-ai/kling-video/v2.6/standard/motion-control",
  klingO1: "fal-ai/kling-image/o1",
  klingVideo: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  ltx219bV2V: "fal-ai/ltx-2-19b/video-to-video/lora",
  ltx23: "fal-ai/ltx-2.3/image-to-video",
  ltx2322b: "fal-ai/ltx-2.3-22b/reference-video-to-video/lora",
  ltx2322bDistilled: "fal-ai/ltx-2.3-22b/distilled/video-to-video/lora",
  phota: "fal-ai/phota/enhance",
  qwenImage2512Lora: "fal-ai/qwen-image-2512/lora",
  qwenImage2ProEdit: "fal-ai/qwen-image-2/pro/edit",
  qwenImageEdit2511Lora: "fal-ai/qwen-image-edit-2511/lora",
  qwenImageEditInpaint: "fal-ai/qwen-image-edit/inpaint",
  qwenMultipleAngles: "fal-ai/qwen-image-edit-2511-multiple-angles",
  reverseVideo: "fal-ai/workflow-utilities/reverse-video",
  sam31SegmentVideo: "fal-ai/sam-3-1/video",
  sam3SegmentVideo: "fal-ai/sam-3/video",
  seedVRUpscale: "fal-ai/seedvr/upscale/image",
  seedreamV45Edit: "fal-ai/bytedance/seedream/v4.5/edit",
  seedreamV5LiteEdit: "fal-ai/bytedance/seedream/v5/lite/edit",
  topazVideoUpscale: "fal-ai/topaz/upscale/video",
  trimVideo: "fal-ai/workflow-utilities/trim-video",
  videoUnderstanding: "fal-ai/video-understanding",
  wan22A14BLora: "fal-ai/wan/v2.2-a14b/image-to-video/lora",
  wan25I2V: "fal-ai/wan-25-preview/image-to-video",
  wan26I2V: "wan/v2.6/image-to-video",
  wan26R2V: "wan/v2.6/reference-to-video",
  wanAnimateMove: "fal-ai/wan/v2.2-14b/animate/move",
  wanAnimateReplace: "fal-ai/wan/v2.2-14b/animate/replace",
  wanMotion: "fal-ai/wan-motion",
  wanVisionEnhancer: "fal-ai/wan-vision-enhancer",
  xaiSpeechToText: "xai/speech-to-text/v1",
  zImageTurboI2I: "fal-ai/z-image/turbo/image-to-image",
  zImageTurboInpaintLora: "fal-ai/z-image/turbo/inpaint",
  zImageTurboLora: "fal-ai/z-image/turbo/lora",
};

/**
 * Returns the fal.ai model endpoint for a given X-Node type, or null
 * if the type is not backed by a fal.ai model.
 */
export function getFalModelId(xnodeType: string): string | null {
  return FAL_MODEL_ID_MAP[xnodeType] ?? null;
}
