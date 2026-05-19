import {
  NodeType,
  ModelType,
  ImageInputNodeData,
  AudioInputNodeData,
  VideoInputNodeData,
  AnnotationNodeData,
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
} from "@/types";
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
  textSplitter: { width: 300, height: 280 },
  maskPainter: { width: 340, height: 420 },
  loadLora: { width: 280, height: 190 },
  blur: { width: 300, height: 340 },
  reformat: { width: 300, height: 380 },
  crop: { width: 300, height: 390 },
  compositor: { width: 320, height: 420 },
  colorCorrection: { width: 320, height: 460 },
  forEachStart: { width: 300, height: 250 },
  forEachEnd: { width: 300, height: 260 },
  actionDirector: { width: 360, height: 460 },
  urlSpawner: { width: 340, height: 380 },
  mediaDownload: { width: 320, height: 320 },
  videoMaskOverlay: { width: 320, height: 420 },
  extractFrameCustom: { width: 320, height: 420 },
  frameComposer: { width: 340, height: 440 },
  audioEnvironment: { width: 320, height: 390 },
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
        width: 1024,
        height: 1024,
        mode: "contain",
        background: "#000000",
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
        brightness: 100,
        contrast: 100,
        saturation: 100,
        grayscale: 0,
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
        mode: "canny",
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
        quality: "best",
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
        status: "idle",
        error: null,
        outputKind: "audio",
      } as AudioEnvironmentNodeData;
  }
};
