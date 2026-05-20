import {
  NodeType,
  ModelType,
  ImageInputNodeData,
  AudioInputNodeData,
  VideoInputNodeData,
  AnnotationNodeData,
  StickyNoteNodeData,
  PromptNodeData,
  ArrayNodeData,
  PromptConstructorNodeData,
  NanoBananaNodeData,
  GenerateVideoNodeData,
  Generate3DNodeData,
  GenerateAudioNodeData,
  LLMGenerateNodeData,
  SplitGridNodeData,
  OutputNodeData,
  OutputGalleryNodeData,
  ImageCompareNodeData,
  EaseCurveNodeData,
  VideoTrimNodeData,
  VideoFrameGrabNodeData,
  RouterNodeData,
  SwitchNodeData,
  ConditionalSwitchNodeData,
  GLBViewerNodeData,
  TextSplitterNodeData,
  MaskPainterNodeData,
  LoadLoraNodeData,
  BlurNodeData,
  ReformatNodeData,
  CropNodeData,
  CompositorNodeData,
  ColorCorrectionNodeData,
  ForEachStartNodeData,
  ForEachEndNodeData,
  ActionDirectorNodeData,
  UrlSpawnerNodeData,
  MediaDownloadNodeData,
  VideoMaskOverlayNodeData,
  ExtractFrameCustomNodeData,
  FrameComposerNodeData,
  AudioEnvironmentNodeData,
  WorkflowNodeData,
  GroupColor,
  SelectedModel,
  MODEL_DISPLAY_NAMES,
  XNodeModelNodeData,
} from "@/types";
import { getXNodeModel } from "@/lib/xnode/models";
import { loadGenerateImageDefaults, loadNodeDefaults } from "./localStorage";

const DEFAULT_FLOW_VIDEO_MODEL: SelectedModel = {
  provider: "flow",
  modelId: "flow-veo-3.1/reference-video",
  displayName: "Flow Reference Video",
};

/**
 * Default dimensions for each node type.
 * Used in addNode and createGroup for consistent sizing.
 */
export const defaultNodeDimensions: Record<NodeType, { width: number; height: number }> = {
  imageInput: { width: 300, height: 280 },
  audioInput: { width: 300, height: 200 },
  videoInput: { width: 300, height: 280 },
  annotation: { width: 300, height: 280 },
  stickyNote: { width: 250, height: 100 },
  prompt: { width: 320, height: 220 },
  array: { width: 340, height: 260 },
  promptConstructor: { width: 340, height: 280 },
  nanoBanana: { width: 300, height: 300 },
  generateVideo: { width: 300, height: 300 },
  generate3d: { width: 300, height: 300 },
  generateAudio: { width: 300, height: 280 },
  llmGenerate: { width: 320, height: 360 },
  splitGrid: { width: 300, height: 320 },
  output: { width: 320, height: 320 },
  outputGallery: { width: 320, height: 360 },
  imageCompare: { width: 400, height: 360 },
  videoStitch: { width: 400, height: 280 },
  easeCurve: { width: 340, height: 280 },
  videoTrim: { width: 360, height: 360 },
  videoFrameGrab: { width: 320, height: 320 },
  router: { width: 200, height: 80 },
  switch: { width: 220, height: 120 },
  conditionalSwitch: { width: 260, height: 180 },
  glbViewer: { width: 360, height: 380 },
  textSplitter: { width: 300, height: 260 },
  maskPainter: { width: 360, height: 430 },
  loadLora: { width: 280, height: 190 },
  blur: { width: 300, height: 260 },
  reformat: { width: 310, height: 360 },
  crop: { width: 310, height: 360 },
  compositor: { width: 330, height: 430 },
  colorCorrection: { width: 330, height: 520 },
  forEachStart: { width: 300, height: 260 },
  forEachEnd: { width: 300, height: 260 },
  actionDirector: { width: 560, height: 900 },
  urlSpawner: { width: 340, height: 380 },
  mediaDownload: { width: 300, height: 300 },
  videoMaskOverlay: { width: 340, height: 420 },
  extractFrameCustom: { width: 340, height: 430 },
  frameComposer: { width: 340, height: 440 },
  audioEnvironment: { width: 340, height: 480 },
  aiFaceSwap: { width: 340, height: 420 },
  autoSubtitle: { width: 300, height: 700 },
  cloudinaryUpload: { width: 300, height: 380 },
  dataForward: { width: 280, height: 400 },
  dropboxUpload: { width: 280, height: 330 },
  dubbing: { width: 320, height: 300 },
  dwPose: { width: 300, height: 380 },
  dynamicFal: { width: 300, height: 280 },
  extractFrames: { width: 300, height: 340 },
  falBlendVideo: { width: 320, height: 460 },
  falGptImage2Edit: { width: 340, height: 850 },
  falHappyHorse: { width: 340, height: 560 },
  falHyWuEdit: { width: 340, height: 680 },
  falMergeAudioVideo: { width: 320, height: 350 },
  falMergeAudios: { width: 340, height: 350 },
  falMergeVideos: { width: 340, height: 500 },
  falPixelcutBgRemoval: { width: 320, height: 440 },
  falSmartResize: { width: 340, height: 500 },
  falTextOutput: { width: 300, height: 280 },
  flux2Klein9BBaseLora: { width: 340, height: 640 },
  fluxProKontextEdit: { width: 340, height: 640 },
  generateTTS: { width: 320, height: 380 },
  generateTTSStitch: { width: 340, height: 580 },
  grokImagine: { width: 340, height: 450 },
  grokVideo: { width: 340, height: 480 },
  happyHorse: { width: 340, height: 420 },
  kling26: { width: 340, height: 450 },
  klingAvatar: { width: 320, height: 380 },
  klingMotionControl: { width: 340, height: 450 },
  klingO1: { width: 360, height: 520 },
  klingVideo: { width: 340, height: 480 },
  ltx219bV2V: { width: 360, height: 580 },
  ltx23: { width: 340, height: 520 },
  ltx2322b: { width: 360, height: 580 },
  ltx2322bDistilled: { width: 360, height: 580 },
  lucy2: { width: 340, height: 620 },
  openaiImage: { width: 340, height: 640 },
  phota: { width: 340, height: 860 },
  qwenImage2512Lora: { width: 360, height: 600 },
  qwenImage2ProEdit: { width: 360, height: 860 },
  qwenImageEdit2511Lora: { width: 360, height: 680 },
  qwenImageEditInpaint: { width: 360, height: 900 },
  qwenMultipleAngles: { width: 380, height: 600 },
  reverseVideo: { width: 300, height: 320 },
  sam31SegmentVideo: { width: 420, height: 720 },
  sam3SegmentVideo: { width: 420, height: 680 },
  seedVRUpscale: { width: 340, height: 380 },
  seedance20: { width: 360, height: 660 },
  seedreamV45Edit: { width: 360, height: 800 },
  seedreamV5LiteEdit: { width: 360, height: 800 },
  soundEffect: { width: 320, height: 180 },
  topazVideoUpscale: { width: 340, height: 420 },
  trimVideo: { width: 300, height: 390 },
  veoVideo: { width: 340, height: 550 },
  videoUnderstanding: { width: 340, height: 300 },
  voiceChanger: { width: 320, height: 320 },
  voiceIsolator: { width: 300, height: 200 },
  wan22A14BLora: { width: 340, height: 500 },
  wan22VaceA14b: { width: 340, height: 500 },
  wan25I2V: { width: 340, height: 450 },
  wan26I2V: { width: 340, height: 450 },
  wan26R2V: { width: 340, height: 450 },
  wanAnimateMove: { width: 340, height: 400 },
  wanAnimateReplace: { width: 340, height: 400 },
  wanMotion: { width: 340, height: 420 },
  wanVisionEnhancer: { width: 340, height: 380 },
  webhookResponse: { width: 260, height: 280 },
  webhookTrigger: { width: 300, height: 420 },
  xaiSpeechToText: { width: 340, height: 420 },
  zImageTurboI2I: { width: 340, height: 580 },
  zImageTurboInpaintLora: { width: 340, height: 740 },
  zImageTurboLora: { width: 340, height: 640 },
};

/**
 * Group color palette (dark mode tints).
 */
export const GROUP_COLORS: Record<GroupColor, string> = {
  neutral: "#262626",
  blue: "#1e3a5f",
  green: "#1a3d2e",
  purple: "#2d2458",
  orange: "#3d2a1a",
  red: "#3d1a1a",
};

/**
 * Order in which group colors are assigned.
 */
export const GROUP_COLOR_ORDER: GroupColor[] = [
  "neutral", "blue", "green", "purple", "orange", "red"
];

/**
 * Creates default data for a node based on its type.
 */
export const createDefaultNodeData = (type: NodeType): WorkflowNodeData => {
  switch (type) {
    case "imageInput":
      return {
        image: null,
        filename: null,
        dimensions: null,
      } as ImageInputNodeData;
    case "audioInput":
      return {
        audioFile: null,
        filename: null,
        duration: null,
        format: null,
      } as AudioInputNodeData;
    case "videoInput":
      return {
        video: null,
        filename: null,
        duration: null,
        dimensions: null,
        format: null,
      } as VideoInputNodeData;
    case "annotation":
      return {
        sourceImage: null,
        annotations: [],
        outputImage: null,
      } as AnnotationNodeData;
    case "stickyNote":
      return {
        text: "",
        fontSize: 16,
        color: "neutral",
      } as StickyNoteNodeData;
    case "prompt":
      return {
        prompt: "",
      } as PromptNodeData;
    case "array":
      return {
        inputText: null,
        splitMode: "delimiter",
        delimiter: "*",
        regexPattern: "",
        trimItems: true,
        removeEmpty: true,
        batchMode: false,
        selectedOutputIndex: null,
        outputItems: [],
        outputText: "[]",
        error: null,
      } as ArrayNodeData;
    case "promptConstructor":
      return {
        template: "",
        outputText: null,
        unresolvedVars: [],
      } as PromptConstructorNodeData;
    case "nanoBanana": {
      const nodeDefaults = loadNodeDefaults();
      const legacyDefaults = loadGenerateImageDefaults();

      // Determine selectedModel: prefer new nodeDefaults, fallback to legacy
      let selectedModel: SelectedModel;
      if (nodeDefaults.generateImage?.selectedModel) {
        selectedModel = nodeDefaults.generateImage.selectedModel;
      } else {
        const modelDisplayName = MODEL_DISPLAY_NAMES[legacyDefaults.model as ModelType] || legacyDefaults.model;
        selectedModel = {
          provider: "gemini",
          modelId: legacyDefaults.model,
          displayName: modelDisplayName,
        };
      }

      // Merge settings: new nodeDefaults override legacy defaults
      const aspectRatio = nodeDefaults.generateImage?.aspectRatio ?? legacyDefaults.aspectRatio;
      const resolution = nodeDefaults.generateImage?.resolution ?? legacyDefaults.resolution;
      const useGoogleSearch = nodeDefaults.generateImage?.useGoogleSearch ?? legacyDefaults.useGoogleSearch;
      const useImageSearch = nodeDefaults.generateImage?.useImageSearch ?? legacyDefaults.useImageSearch;

      return {
        inputImages: [],
        inputPrompt: null,
        outputImage: null,
        aspectRatio,
        resolution,
        model: legacyDefaults.model, // Keep legacy model field for backward compat
        selectedModel,
        useGoogleSearch,
        useImageSearch,
        status: "idle",
        error: null,
        imageHistory: [],
        selectedHistoryIndex: 0,
      } as NanoBananaNodeData;
    }
    case "generateVideo": {
      const nodeDefaults = loadNodeDefaults();
      return {
        inputImages: [],
        inputVideos: [],
        inputPrompt: null,
        outputVideo: null,
        selectedModel: nodeDefaults.generateVideo?.selectedModel ?? DEFAULT_FLOW_VIDEO_MODEL,
        status: "idle",
        error: null,
        videoHistory: [],
        selectedVideoHistoryIndex: 0,
      } as GenerateVideoNodeData;
    }
    case "generate3d": {
      const nodeDefaults = loadNodeDefaults();
      return {
        inputImages: [],
        inputPrompt: null,
        output3dUrl: null,
        savedFilename: null,
        savedFilePath: null,
        selectedModel: nodeDefaults.generate3d?.selectedModel,
        status: "idle",
        error: null,
      } as Generate3DNodeData;
    }
    case "generateAudio": {
      const nodeDefaults = loadNodeDefaults();
      return {
        inputPrompt: null,
        outputAudio: null,
        selectedModel: nodeDefaults.generateAudio?.selectedModel,
        status: "idle",
        error: null,
        audioHistory: [],
        selectedAudioHistoryIndex: 0,
        duration: null,
        format: null,
      } as GenerateAudioNodeData;
    }
    case "llmGenerate": {
      const nodeDefaults = loadNodeDefaults();
      const llmDefaults = nodeDefaults.llm;
      return {
        inputPrompt: null,
        inputImages: [],
        outputText: null,
        provider: llmDefaults?.provider ?? "google",
        model: llmDefaults?.model ?? "gemini-3-flash-preview",
        temperature: llmDefaults?.temperature ?? 0.7,
        maxTokens: llmDefaults?.maxTokens ?? 8192,
        status: "idle",
        error: null,
      } as LLMGenerateNodeData;
    }
    case "splitGrid":
      return {
        sourceImage: null,
        targetCount: 6,
        defaultPrompt: "",
        generateSettings: {
          aspectRatio: "1:1",
          resolution: "1K",
          model: "nano-banana-pro",
          useGoogleSearch: false,
          useImageSearch: false,
        },
        childNodeIds: [],
        gridRows: 2,
        gridCols: 3,
        isConfigured: false,
        status: "idle",
        error: null,
      } as SplitGridNodeData;
    case "output":
      return {
        image: null,
        outputFilename: "",
      } as OutputNodeData;
    case "outputGallery":
      return {
        images: [],
        videos: [],
      } as OutputGalleryNodeData;
    case "imageCompare":
      return {
        imageA: null,
        imageB: null,
      } as ImageCompareNodeData;
    case "videoStitch":
      return {
        clips: [],
        clipOrder: [],
        outputVideo: null,
        loopCount: 1,
        status: "idle",
        error: null,
        progress: 0,
        encoderSupported: null,
      };
    case "easeCurve":
      return {
        bezierHandles: [0.445, 0.05, 0.55, 0.95], // easeInOutSine preset
        easingPreset: "easeInOutSine",
        inheritedFrom: null,
        outputDuration: 1.5,
        outputVideo: null,
        status: "idle",
        error: null,
        progress: 0,
        encoderSupported: null,
      } as EaseCurveNodeData;
    case "videoTrim":
      return {
        startTime: 0,
        endTime: 0,
        duration: null,
        outputVideo: null,
        status: "idle",
        error: null,
        progress: 0,
        encoderSupported: null,
      } as VideoTrimNodeData;
    case "videoFrameGrab":
      return {
        framePosition: "first",
        outputImage: null,
        status: "idle",
        error: null,
      } as VideoFrameGrabNodeData;
    case "router":
      return {} as RouterNodeData;
    case "switch":
      return {
        inputType: null,
        switches: [
          { id: Math.random().toString(36).slice(2, 9), name: "Output 1", enabled: true }
        ]
      } as SwitchNodeData;
    case "conditionalSwitch":
      return {
        incomingText: null,
        rules: [
          {
            id: "rule-" + Math.random().toString(36).slice(2, 9),
            value: "",
            mode: "contains",
            label: "Rule 1",
            isMatched: false,
          }
        ]
      } as ConditionalSwitchNodeData;
    case "glbViewer":
      return {
        glbUrl: null,
        filename: null,
        capturedImage: null,
      } as GLBViewerNodeData;
    case "textSplitter":
      return {
        inputText: null,
        delimiter: "\n",
        trimItems: true,
        removeEmpty: true,
        maxOutputs: 10,
        outputItems: [],
        outputText: null,
        status: "idle",
        error: null,
        outputKind: "text",
      } as TextSplitterNodeData;
    case "maskPainter":
      return {
        sourceImage: null,
        outputImage: null,
        brushSize: 28,
        mode: "paint",
        status: "idle",
        error: null,
        outputKind: "image",
      } as MaskPainterNodeData;
    case "loadLora":
      return {
        path: "",
        scale: 1,
        outputLora: null,
        status: "idle",
        error: null,
        outputKind: "lora",
      } as LoadLoraNodeData;
    case "blur":
      return {
        sourceImage: null,
        maskImage: null,
        outputImage: null,
        radius: 12,
        status: "idle",
        error: null,
        outputKind: "image",
      } as BlurNodeData;
    case "reformat":
      return {
        sourceImage: null,
        outputImage: null,
        preset: "custom",
        width: 512,
        height: 512,
        mode: "contain",
        background: "#000000",
        keepAspectRatio: true,
        scaleBy: "width",
        status: "idle",
        error: null,
        outputKind: "image",
      } as ReformatNodeData;
    case "crop":
      return {
        sourceImage: null,
        outputImage: null,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        flipHorizontal: false,
        flipVertical: false,
        status: "idle",
        error: null,
        outputKind: "image",
      } as CropNodeData;
    case "compositor":
      return {
        sourceImage: null,
        secondaryImage: null,
        maskImage: null,
        outputImage: null,
        blendMode: "source-over",
        opacity: 0.75,
        status: "idle",
        error: null,
        outputKind: "image",
      } as CompositorNodeData;
    case "colorCorrection":
      return {
        sourceImage: null,
        maskImage: null,
        outputImage: null,
        activeTab: "color",
        brightness: 100,
        contrast: 100,
        saturation: 100,
        grayscale: 0,
        gain: 1,
        gamma: 1,
        blackPoint: 0,
        whitePoint: 255,
        redGain: 1,
        greenGain: 1,
        blueGain: 1,
        status: "idle",
        error: null,
        outputKind: "image",
      } as ColorCorrectionNodeData;
    case "forEachStart":
      return {
        inputText: null,
        currentIndex: 0,
        outputText: null,
        outputItems: [],
        status: "idle",
        error: null,
        outputKind: "text",
      } as ForEachStartNodeData;
    case "forEachEnd":
      return {
        outputImage: null,
        outputVideo: null,
        outputAudio: null,
        outputText: null,
        outputJson: null,
        status: "idle",
        error: null,
        outputKind: "json",
      } as ForEachEndNodeData;
    case "actionDirector":
      return {
        sourceImage: null,
        sourceVideo: null,
        outputImage: null,
        outputVideo: null,
        outputPose: null,
        outputDepth: null,
        outputCanny: null,
        outputNormal: null,
        outputShaded: null,
        outputAlpha: null,
        outputPoseVideo: null,
        outputDepthVideo: null,
        outputCannyVideo: null,
        outputNormalVideo: null,
        outputShadedVideo: null,
        outputAlphaVideo: null,
        mode: "pose",
        preset: "512x512",
        width: 512,
        height: 512,
        outputMode: "image",
        frameCount: 48,
        fps: 24,
        currentFrame: 0,
        isPlaying: false,
        transformMode: "move",
        depthPreviewMode: false,
        cameraKeyframes: { start: null, end: null },
        ease: "linear",
        characters: [{ id: "char-1", name: "Char 1", gender: "M", selected: true, muted: false, clips: [] }],
        clips: [],
        props: [],
        faceMocapVideos: [],
        bindings: [],
        rigUrl: "",
        status: "idle",
        error: null,
        outputKind: "image",
      } as ActionDirectorNodeData;
    case "urlSpawner":
      return {
        urls: "",
        lastSpawnedCount: 0,
        status: "idle",
        error: null,
      } as UrlSpawnerNodeData;
    case "mediaDownload":
      return {
        inputUrl: "",
        format: "video",
        quality: "720p",
        outputVideo: null,
        outputAudio: null,
        status: "idle",
        error: null,
        outputKind: "video",
      } as MediaDownloadNodeData;
    case "videoMaskOverlay":
      return {
        sourceVideo: null,
        maskVideo: null,
        outputVideo: null,
        maskColor: "#ff0000",
        maskOpacity: 1,
        useShortestDuration: true,
        status: "idle",
        error: null,
        outputKind: "video",
      } as VideoMaskOverlayNodeData;
    case "extractFrameCustom":
      return {
        sourceVideo: null,
        outputImage: null,
        frameTime: 0,
        frameIndex: 0,
        fps: 30,
        status: "idle",
        error: null,
        outputKind: "image",
      } as ExtractFrameCustomNodeData;
    case "frameComposer":
      return {
        sourceVideo: null,
        outputVideo: null,
        referenceImages: [],
        referenceOpacity: 0.35,
        regionPosition: "left",
        regionSize: 320,
        referenceDistribution: "single",
        fps: 30,
        status: "idle",
        error: null,
        outputKind: "video",
      } as FrameComposerNodeData;
    case "audioEnvironment":
      return {
        sourceAudio: null,
        outputAudio: null,
        bass: 0,
        mid: 0,
        treble: 0,
        gain: 1,
        bypass: false,
        preset: "studioNarration",
        tone: "neutral",
        outputFormat: "wav",
        distance: 0.1,
        reverbWet: 0.02,
        pan: 0,
        status: "idle",
        error: null,
        outputKind: "audio",
      } as AudioEnvironmentNodeData;
  }

  // Fallback: schema-driven defaults for nodes registered via the
  // X-Node model registry (72 nodes reverse-engineered from the netlify
  // bundle — see src/lib/xnode/models.ts).
  const schema = getXNodeModel(type as string);
  if (schema) {
    return {
      status: "idle",
      error: null,
      ...schema.defaultData,
    } as XNodeModelNodeData;
  }
  return {} as WorkflowNodeData;
};
