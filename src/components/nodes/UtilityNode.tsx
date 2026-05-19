"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ChangeEvent, PointerEvent, ReactNode } from "react";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { HandleLabel } from "./HandleLabel";
import { useWorkflowStore } from "@/store/workflowStore";
import { useAdaptiveImageSrc } from "@/hooks/useAdaptiveImageSrc";
import { useVideoBlobUrl } from "@/hooks/useVideoBlobUrl";
import { getBlueprint, getBlueprintHandles } from "@/lib/nodeRegistry";
import type { HandleType, NodeType, UtilityNodeData, WorkflowNodeData } from "@/types";

type UtilityFlowNode = Node<UtilityNodeData, NodeType>;

const IMAGE_TYPES = new Set(["maskPainter", "blur", "reformat", "crop", "compositor", "colorCorrection", "actionDirector"]);
const VIDEO_TYPES = new Set(["videoMaskOverlay", "extractFrameCustom", "frameComposer", "actionDirector"]);
const AUDIO_TYPES = new Set(["audioEnvironment"]);
const TEXT_TYPES = new Set(["textSplitter", "forEachStart", "mediaDownload"]);
const ACTION_IMAGE_OUTPUTS = ["openPose", "depth", "canny", "normal", "shaded", "alpha"] as const;
const ACTION_VIDEO_OUTPUTS = ACTION_IMAGE_OUTPUTS.map((handle) => `video-${handle}`);
const ACTION_OUTPUTS = new Set<string>([...ACTION_IMAGE_OUTPUTS, ...ACTION_VIDEO_OUTPUTS]);

const REFORMAT_PRESETS = [
  { label: "512 x 512 - Square SM", width: 512, height: 512 },
  { label: "1024 x 1024 - Square MD", width: 1024, height: 1024 },
  { label: "1080 x 1080 - Square LG", width: 1080, height: 1080 },
  { label: "1280 x 720 - 720p HD", width: 1280, height: 720 },
  { label: "1920 x 1080 - 1080p Full HD", width: 1920, height: 1080 },
  { label: "720 x 1280 - Portrait HD", width: 720, height: 1280 },
  { label: "1080 x 1920 - Portrait Full HD", width: 1080, height: 1920 },
  { label: "1080 x 1350 - Instagram 4:5", width: 1080, height: 1350 },
];

const ACTION_PRESETS = [
  { label: "512 x 512 (1:1)", width: 512, height: 512 },
  { label: "512 x 768 (2:3)", width: 512, height: 768 },
  { label: "768 x 512 (3:2)", width: 768, height: 512 },
  { label: "768 x 1024 (3:4)", width: 768, height: 1024 },
  { label: "1024 x 768 (4:3)", width: 1024, height: 768 },
  { label: "576 x 1024 (9:16)", width: 576, height: 1024 },
  { label: "1024 x 576 (16:9)", width: 1024, height: 576 },
  { label: "1280 x 720 (HD)", width: 1280, height: 720 },
];

function handleKind(handleId: string): HandleType | "reference" | null {
  if (handleId.startsWith("video-")) return "video";
  if (handleId === "mask" || ACTION_OUTPUTS.has(handleId)) return "image";
  if (handleId === "lora") return "text";
  if (handleId === "reference") return "reference";
  if (handleId.includes("image") || handleId.includes("frame")) return "image";
  if (handleId.includes("video")) return "video";
  if (handleId.includes("audio")) return "audio";
  if (handleId.includes("text") || handleId === "prompt") return "text";
  return null;
}

function handleColor(handleId: string): string {
  if (handleId.startsWith("video-")) return "var(--handle-color-video)";
  const kind = handleKind(handleId);
  if (kind === "image") return "var(--handle-color-image)";
  if (kind === "video") return "var(--handle-color-video)";
  if (kind === "audio") return "var(--handle-color-audio)";
  if (kind === "text") return "var(--handle-color-text)";
  return "#9ca3af";
}

function handleLabel(handleId: string): string {
  const normalizedHandleId = handleId.startsWith("video-") ? handleId.slice("video-".length) : handleId;
  const labels: Record<string, string> = {
    image: "Image",
    "image-1": "Image B",
    video: "Video",
    "video-1": "Mask",
    audio: "Audio",
    text: "Text",
    mask: "Mask",
    lora: "LoRA",
    openPose: "OpenPose",
    depth: "Depth",
    canny: "Canny",
    normal: "Normal",
    shaded: "Shaded",
    alpha: "Alpha",
  };
  if (labels[normalizedHandleId]) return labels[normalizedHandleId];
  if (handleId.startsWith("text-")) return handleId.replace("text-", "Text ");
  return normalizedHandleId.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "remote-file");
  } catch {
    return url.split("/").filter(Boolean).pop() || "remote-file";
  }
}

function classifyUrl(url: string): "imageInput" | "videoInput" | "audioInput" | "loadLora" | null {
  const lower = url.toLowerCase().split("?")[0];
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(lower)) return "imageInput";
  if (/\.(mp4|webm|mov|m4v|avi)$/.test(lower)) return "videoInput";
  if (/\.(mp3|wav|ogg|m4a|flac)$/.test(lower)) return "audioInput";
  if (/\.(safetensors|ckpt|pt)$/.test(lower)) return "loadLora";
  return null;
}

function parseUrls(value: string): string[] {
  return value.split(/\s+/).map((item) => item.trim()).filter((item) => /^https?:\/\//i.test(item));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-[9px] uppercase tracking-wide text-neutral-500">{children}</label>;
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="nodrag nopan w-full rounded-sm border border-neutral-700 bg-[#1a1a1a] px-2 py-1.5 text-[11px] text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-blue-500"
    />
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="nodrag nopan w-full resize-none rounded-sm border border-neutral-800 bg-[#1a1a1a] p-2 text-[11px] text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-blue-500"
    />
  );
}

function NumberInput({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
      className="nodrag nopan w-full rounded-sm border border-neutral-800 bg-[#171717] px-2 py-1 text-[10px] text-neutral-100 outline-none focus:border-blue-500"
    />
  );
}

function ActionNumberInput({
  value,
  min,
  onChange,
}: {
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      onChange={(event) => onChange(Number(event.target.value))}
      className="nodrag nopan h-5 w-full rounded-sm border border-neutral-900 bg-[#121212] px-2 text-[8px] font-semibold text-neutral-100 outline-none focus:border-blue-500"
    />
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        <span className="min-w-10 rounded-sm bg-[#151515] px-1.5 py-0.5 text-right text-[9px] text-blue-300">
          {Number.isFinite(value) ? value.toFixed(step < 1 ? 2 : 0) : "0"}{suffix}
        </span>
      </div>
      <input
        type="range"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="nodrag nopan w-full accent-blue-500"
      />
    </div>
  );
}

function SelectInput<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T;
  options: readonly T[];
  labels?: Record<string, string>;
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="nodrag nopan w-full rounded-sm border border-neutral-800 bg-[#171717] px-2 py-1.5 text-[10px] text-neutral-100 outline-none focus:border-blue-500"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {labels?.[option] ?? option}
        </option>
      ))}
    </select>
  );
}

function ActionSelectInput<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T;
  options: readonly T[];
  labels?: Record<string, string>;
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="nodrag nopan h-5 w-full rounded-sm border border-neutral-900 bg-[#121212] px-2 text-[8px] font-semibold text-neutral-100 outline-none focus:border-blue-500"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {labels?.[option] ?? option}
        </option>
      ))}
    </select>
  );
}

function Segmented<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T;
  options: readonly T[];
  labels?: Record<string, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="nodrag nopan grid grid-flow-col auto-cols-fr rounded-sm bg-[#1a1a1a] p-0.5">
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={`rounded-sm px-2 py-1 text-[9px] font-medium transition-colors ${
            value === option ? "bg-blue-600 text-white" : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
          }`}
        >
          {labels?.[option] ?? option}
        </button>
      ))}
    </div>
  );
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="nodrag nopan flex items-center gap-2 rounded-sm bg-[#1d1d1d] px-2 py-1 text-[10px] text-neutral-300">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-blue-500" />
      {label}
    </label>
  );
}

function PreviewWell({
  children,
  label = "NO IMAGE",
  height = "h-28",
}: {
  children?: ReactNode;
  label?: string;
  height?: string;
}) {
  return (
    <div className={`${height} flex items-center justify-center overflow-hidden rounded-sm border border-neutral-800 bg-[#1b1b1b] text-center text-[10px] uppercase tracking-wide text-neutral-600`}>
      {children ?? (
        <div className="flex flex-col items-center gap-1">
          <svg className="h-5 w-5 text-neutral-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5 8.25 11.25a2.25 2.25 0 0 1 3.18 0L21 20.82M3 5.25h18v15H3v-15Zm13.5 3.75h.01" />
          </svg>
          <span>{label}</span>
        </div>
      )}
    </div>
  );
}

function MiniIconButton({ title, children, onClick }: { title: string; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="nodrag nopan flex h-5 w-5 items-center justify-center rounded border border-neutral-700 bg-[#222] text-neutral-500 hover:text-neutral-200"
    >
      {children}
    </button>
  );
}

function ActionDirectorPreview({ image }: { image?: string | null }) {
  return (
    <div className="relative h-[192px] shrink-0 overflow-hidden rounded-sm border border-neutral-950 bg-[#101010]">
      <div className="absolute inset-y-0 left-0 w-[15%] bg-black" />
      <div className="absolute inset-y-0 right-0 w-[15%] bg-black" />
      <div
        className="absolute inset-[1px] opacity-35"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          transform: "perspective(260px) rotateX(58deg) translateY(42px)",
          transformOrigin: "50% 78%",
        }}
      />
      {image ? (
        <img src={image} alt="" className="absolute inset-0 h-full w-full object-contain opacity-80" />
      ) : (
        <svg viewBox="0 0 280 190" className="absolute inset-0 h-full w-full">
          <line x1="140" y1="22" x2="140" y2="164" stroke="#08e17c" strokeWidth="1.3" />
          <line x1="90" y1="58" x2="190" y2="58" stroke="#02e6a5" strokeWidth="1.2" />
          <line x1="120" y1="162" x2="160" y2="162" stroke="#f1141e" strokeWidth="1.1" />
          <line x1="140" y1="74" x2="122" y2="113" stroke="#15db78" strokeWidth="1.4" />
          <line x1="140" y1="74" x2="158" y2="113" stroke="#15db78" strokeWidth="1.4" />
          <line x1="122" y1="113" x2="124" y2="151" stroke="#0ce070" strokeWidth="1.4" />
          <line x1="158" y1="113" x2="156" y2="151" stroke="#0ce070" strokeWidth="1.4" />
          <line x1="124" y1="151" x2="116" y2="176" stroke="#2459ff" strokeWidth="1.2" />
          <line x1="156" y1="151" x2="164" y2="176" stroke="#2459ff" strokeWidth="1.2" />
          <circle cx="140" cy="42" r="10" fill="none" stroke="#2459ff" strokeWidth="1.3" />
          {[
            [140, 42, "#2459ff"],
            [140, 58, "#00e5ff"],
            [122, 113, "#f1141e"],
            [158, 113, "#f1141e"],
            [124, 151, "#2459ff"],
            [156, 151, "#2459ff"],
            [116, 176, "#2459ff"],
            [164, 176, "#2459ff"],
          ].map(([cx, cy, fill], index) => (
            <circle key={index} cx={cx} cy={cy} r="2.6" fill={String(fill)} />
          ))}
          <line x1="32" y1="160" x2="248" y2="160" stroke="rgba(255,255,255,0.11)" />
          <line x1="32" y1="122" x2="248" y2="122" stroke="rgba(255,255,255,0.07)" />
          <line x1="88" y1="160" x2="140" y2="112" stroke="rgba(255,255,255,0.07)" />
          <line x1="192" y1="160" x2="140" y2="112" stroke="rgba(255,255,255,0.07)" />
          <line x1="55" y1="160" x2="55" y2="122" stroke="rgba(255,255,255,0.06)" />
          <line x1="225" y1="160" x2="225" y2="122" stroke="rgba(255,255,255,0.06)" />
          <line x1="40" y1="150" x2="66" y2="150" stroke="#f1141e" strokeWidth="1.2" />
          <polygon points="40,150 47,146 47,154" fill="#f1141e" />
          <line x1="196" y1="150" x2="225" y2="150" stroke="#e3c51b" strokeWidth="1.2" />
          <line x1="210" y1="136" x2="210" y2="164" stroke="#0ee76e" strokeWidth="1.2" />
        </svg>
      )}
    </div>
  );
}

function ActionTinyButton({
  children,
  tone = "neutral",
  onClick,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "cyan" | "red";
  onClick?: () => void;
  title?: string;
}) {
  const toneClass = {
    neutral: "border-neutral-700 bg-[#191919] text-neutral-400",
    blue: "border-blue-700 bg-blue-700/70 text-white",
    cyan: "border-cyan-700 bg-cyan-700/70 text-white",
    red: "border-red-700 bg-red-800/80 text-white",
  }[tone];
  return <button title={title} onClick={onClick} className={`nodrag nopan rounded-sm border px-1.5 py-0.5 text-[8px] leading-none ${toneClass}`}>{children}</button>;
}

function ActionRowButton({
  children,
  tone = "neutral",
  active = false,
  disabled = false,
  onClick,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "red" | "teal";
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const toneClass = active
    ? "bg-cyan-700 text-white hover:bg-cyan-600"
    : tone === "red"
    ? "bg-red-900/80 text-red-100 hover:bg-red-800"
    : tone === "teal"
      ? "bg-cyan-700 text-white hover:bg-cyan-600"
      : "bg-[#1a1a1a] text-neutral-300 hover:bg-neutral-700";
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`nodrag nopan rounded-sm px-1.5 py-0.5 text-[8px] disabled:cursor-not-allowed disabled:opacity-35 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function MaskPainterSurface({
  id,
  sourceImage,
  mode,
  brushSize,
  updateNodeData,
}: {
  id: string;
  sourceImage: string | null | undefined;
  mode: "paint" | "erase";
  brushSize: number;
  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const adaptiveImage = useAdaptiveImageSrc(sourceImage ?? null, id);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    updateNodeData(id, { outputImage: canvas.toDataURL("image/png"), outputKind: "image" } as Partial<WorkflowNodeData>);
  }, [id, sourceImage, updateNodeData]);

  const drawAt = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = mode === "paint" ? "#ffffff" : "#000000";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, brushSize), 0, Math.PI * 2);
    ctx.fill();
  }, [brushSize, mode]);

  const commitMask = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    updateNodeData(id, {
      outputImage: canvas.toDataURL("image/png"),
      status: "complete",
      error: null,
      outputKind: "image",
    } as Partial<WorkflowNodeData>);
  }, [id, updateNodeData]);

  const clearMask = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    commitMask();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Segmented value={mode} options={["paint", "erase"]} labels={{ paint: "Brush", erase: "Eraser" }} onChange={(value) => updateNodeData(id, { mode: value } as Partial<WorkflowNodeData>)} />
        <button onClick={clearMask} className="nodrag nopan rounded-sm bg-[#1b1b1b] px-2 py-1 text-[9px] text-neutral-300 hover:bg-neutral-700">Clear</button>
      </div>
      <Slider label="Brush" value={brushSize} min={2} max={96} suffix="px" onChange={(value) => updateNodeData(id, { brushSize: value } as Partial<WorkflowNodeData>)} />
      <div className="relative h-36 overflow-hidden rounded-sm border border-neutral-700 bg-[#151515]">
        {adaptiveImage ? <img src={adaptiveImage} alt="" className="absolute inset-0 h-full w-full object-contain opacity-70" /> : null}
        <canvas
          ref={canvasRef}
          className="nodrag nopan absolute inset-0 h-full w-full cursor-crosshair mix-blend-screen"
          onPointerDown={(event) => {
            drawingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            drawAt(event);
          }}
          onPointerMove={(event) => {
            if (drawingRef.current) drawAt(event);
          }}
          onPointerUp={() => {
            drawingRef.current = false;
            commitMask();
          }}
          onPointerCancel={() => {
            drawingRef.current = false;
            commitMask();
          }}
        />
        {!adaptiveImage && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-neutral-600">
            Connect an image to start painting a mask
          </div>
        )}
      </div>
    </div>
  );
}

export function UtilityNode({ id, type, data, selected }: NodeProps<UtilityFlowNode>) {
  const nodeType = type as NodeType;
  const blueprint = getBlueprint(nodeType);
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const regenerateNode = useWorkflowStore((state) => state.regenerateNode);
  const addNode = useWorkflowStore((state) => state.addNode);
  const nodes = useWorkflowStore((state) => state.nodes);
  const edges = useWorkflowStore((state) => state.edges);
  const getConnectedInputs = useWorkflowStore((state) => state.getConnectedInputs);
  const isRunning = useWorkflowStore((state) => state.isRunning);
  const handles = getBlueprintHandles(nodeType);
  const actionAnimationInputRef = useRef<HTMLInputElement>(null);
  const actionClipInputRef = useRef<HTMLInputElement>(null);
  const actionPropInputRef = useRef<HTMLInputElement>(null);
  const actionMocapInputRef = useRef<HTMLInputElement>(null);

  const connected = useMemo(() => getConnectedInputs(id), [id, getConnectedInputs, nodes, edges]);
  const sourceImage = data.outputImage ?? data.sourceImage ?? null;
  const adaptivePreviewImage = useAdaptiveImageSrc(sourceImage, id);
  const previewVideo = useVideoBlobUrl(data.outputVideo ?? data.sourceVideo ?? null);

  useEffect(() => {
    const next: Partial<WorkflowNodeData> = {};
    if (IMAGE_TYPES.has(nodeType) || nodeType === "frameComposer") {
      if (connected.images[0] && connected.images[0] !== data.sourceImage) (next as UtilityNodeData).sourceImage = connected.images[0];
      if (connected.images[1] && connected.images[1] !== data.secondaryImage) (next as UtilityNodeData).secondaryImage = connected.images[1];
      if (connected.images[1] && connected.images[1] !== data.maskImage && (nodeType === "blur" || nodeType === "colorCorrection")) (next as UtilityNodeData).maskImage = connected.images[1];
      if (nodeType === "frameComposer" && connected.images.length > 0) (next as UtilityNodeData).referenceImages = connected.images;
    }
    if (VIDEO_TYPES.has(nodeType)) {
      if (connected.videos[0] && connected.videos[0] !== data.sourceVideo) (next as UtilityNodeData).sourceVideo = connected.videos[0];
      if (connected.videos[1] && connected.videos[1] !== data.maskVideo) (next as UtilityNodeData).maskVideo = connected.videos[1];
    }
    if (AUDIO_TYPES.has(nodeType) && connected.audio[0] && connected.audio[0] !== data.sourceAudio) (next as UtilityNodeData).sourceAudio = connected.audio[0];
    if (TEXT_TYPES.has(nodeType) && connected.text && connected.text !== data.inputText) {
      (next as UtilityNodeData).inputText = connected.text;
      if (nodeType === "mediaDownload") (next as UtilityNodeData).inputUrl = connected.text;
    }
    if (Object.keys(next).length > 0) updateNodeData(id, next);
  }, [connected, data.inputText, data.maskImage, data.maskVideo, data.secondaryImage, data.sourceAudio, data.sourceImage, data.sourceVideo, id, nodeType, updateNodeData]);

  const setField = useCallback((field: string, value: unknown) => {
    updateNodeData(id, { [field]: value } as Partial<WorkflowNodeData>);
  }, [id, updateNodeData]);

  useEffect(() => {
    if (nodeType !== "actionDirector" || !data.isPlaying) return;
    const fps = Math.max(1, Math.min(60, Number(data.fps ?? 24)));
    const frameCount = Math.max(1, Number(data.frameCount ?? 48));
    const timer = window.setInterval(() => {
      const fresh = useWorkflowStore.getState().nodes.find((node) => node.id === id)?.data as UtilityNodeData | undefined;
      const frame = Number(fresh?.currentFrame ?? 0);
      updateNodeData(id, { currentFrame: (frame + 1) % frameCount } as Partial<WorkflowNodeData>);
    }, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [data.frameCount, data.fps, data.isPlaying, id, nodeType, updateNodeData]);

  const getFreshActionData = useCallback(() => {
    return (useWorkflowStore.getState().nodes.find((node) => node.id === id)?.data ?? data) as UtilityNodeData;
  }, [data, id]);

  const handleActionFileImport = useCallback(async (
    event: ChangeEvent<HTMLInputElement>,
    kind: "animation" | "clip" | "prop" | "mocap"
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const current = getFreshActionData();
    const selectedCharacter = current.characters?.find((character) => character.selected) ?? current.characters?.[0];
    if (kind === "prop") {
      const props = [...(current.props ?? []), {
        id: `prop-${Date.now()}`,
        propFile: file.name,
        dataUrl,
        visible: true,
        loop: false,
      }];
      updateNodeData(id, { props, status: "complete", error: null } as Partial<WorkflowNodeData>);
      return;
    }
    if (kind === "mocap") {
      const faceMocapVideos = [...(current.faceMocapVideos ?? []), { id: `mocap-${Date.now()}`, name: file.name, dataUrl }];
      updateNodeData(id, { faceMocapVideos, status: "complete", error: null } as Partial<WorkflowNodeData>);
      return;
    }
    const clip = { id: `clip-${Date.now()}`, url: "", name: file.name, dataUrl };
    const clips = [...(current.clips ?? []), clip];
    const characters = (current.characters ?? []).map((character) => {
      if (character.id !== selectedCharacter?.id) return character;
      return {
        ...character,
        clips: kind === "clip" ? [...(character.clips ?? []), clip] : character.clips ?? [],
        animFile: kind === "animation" ? file.name : (character as { animFile?: string }).animFile,
      };
    });
    updateNodeData(id, { clips, characters, status: "complete", error: null } as Partial<WorkflowNodeData>);
  }, [getFreshActionData, id, updateNodeData]);

  const spawnUrls = useCallback(() => {
    const currentNode = nodes.find((node) => node.id === id);
    const base = currentNode?.position ?? { x: 0, y: 0 };
    let created = 0;
    parseUrls(String(data.urls ?? "")).forEach((url, index) => {
      const nodeKind = classifyUrl(url);
      if (!nodeKind) return;
      const filename = filenameFromUrl(url);
      const position = { x: base.x + 380 + (index % 2) * 330, y: base.y + Math.floor(index / 2) * 240 };
      if (nodeKind === "imageInput") addNode("imageInput", position, { image: url, filename, dimensions: null });
      else if (nodeKind === "videoInput") addNode("videoInput", position, { video: url, filename, duration: null, dimensions: null, format: null });
      else if (nodeKind === "audioInput") addNode("audioInput", position, { audioFile: url, filename, duration: null, format: null });
      else addNode("loadLora", position, { path: url, scale: 1 });
      created += 1;
    });
    updateNodeData(id, {
      lastSpawnedCount: created,
      status: "complete",
      error: created === 0 ? "No supported URLs found" : null,
    } as Partial<WorkflowNodeData>);
  }, [addNode, data.urls, id, nodes, updateNodeData]);

  const renderHandles = () => {
    if (nodeType === "actionDirector") {
      const imageOutputs = [
        { id: "openPose", top: "7%" },
        { id: "depth", top: "17%" },
        { id: "canny", top: "27%" },
        { id: "normal", top: "37%" },
        { id: "shaded", top: "47%" },
        { id: "alpha", top: "57%" },
      ];
      const videoOutputs = [
        { id: "video-openPose", top: "60%" },
        { id: "video-depth", top: "69%" },
        { id: "video-canny", top: "78%" },
        { id: "video-normal", top: "86%" },
        { id: "video-shaded", top: "94%" },
        { id: "video-alpha", top: "99%" },
      ];
      return (
        <>
          {[
            { id: "video", top: "34%" },
            { id: "image", top: "72%" },
          ].map(({ id: handleId, top }) => (
            <div key={`in-${handleId}`} className="contents">
              <Handle type="target" position={Position.Left} id={handleId} data-handletype={handleKind(handleId)} style={{ top, zIndex: 10 }} />
              <HandleLabel label={handleLabel(handleId)} side="target" color={handleColor(handleId)} top={`calc(${top} - 7px)`} visible />
            </div>
          ))}
          {[...imageOutputs, ...videoOutputs].map(({ id: handleId, top }) => (
            <div key={`out-${handleId}`} className="contents">
              <Handle type="source" position={Position.Right} id={handleId} data-handletype={handleKind(handleId)} style={{ top, zIndex: 10 }} />
              <HandleLabel label={handleLabel(handleId)} side="source" color={handleColor(handleId)} top={`calc(${top} - 7px)`} visible />
            </div>
          ))}
        </>
      );
    }

    const outputHandles = nodeType === "textSplitter" && Array.isArray(data.outputItems) && data.outputItems.length > 0
      ? data.outputItems.slice(0, 10).map((_, index) => `text-${index}`)
      : handles.outputs;
    return (
      <>
        {handles.inputs.map((handleId, index) => {
          const top = `${((index + 1) / (handles.inputs.length + 1)) * 100}%`;
          return (
            <div key={`in-${handleId}`} className="contents">
              <Handle type="target" position={Position.Left} id={handleId} data-handletype={handleKind(handleId)} style={{ top, zIndex: 10 }} />
              <HandleLabel label={handleLabel(handleId)} side="target" color={handleColor(handleId)} top={`calc(${top} - 7px)`} visible />
            </div>
          );
        })}
        {outputHandles.map((handleId, index) => {
          const top = `${((index + 1) / (outputHandles.length + 1)) * 100}%`;
          return (
            <div key={`out-${handleId}`} className="contents">
              <Handle type="source" position={Position.Right} id={handleId} data-handletype={handleKind(handleId)} style={{ top, zIndex: 10 }} />
              <HandleLabel label={handleLabel(handleId)} side="source" color={handleColor(handleId)} top={`calc(${top} - 7px)`} visible />
            </div>
          );
        })}
      </>
    );
  };

  const renderPreview = (height = "h-28") => {
    if (nodeType === "audioEnvironment" && (data.outputAudio || data.sourceAudio)) {
      return <audio src={(data.outputAudio ?? data.sourceAudio) || undefined} controls className="w-full" />;
    }
    if ((data.outputVideo || data.sourceVideo) && previewVideo) {
      return <PreviewWell height={height} label="READY"><video src={previewVideo} muted loop playsInline className="h-full w-full object-contain" /></PreviewWell>;
    }
    if (adaptivePreviewImage) {
      return <PreviewWell height={height}><img src={adaptivePreviewImage} alt="" className="h-full w-full object-contain" /></PreviewWell>;
    }
    if (nodeType === "forEachStart" || nodeType === "forEachEnd") return <PreviewWell height={height} label="WAITING" />;
    if (nodeType === "videoMaskOverlay" || nodeType === "frameComposer") return <PreviewWell height={height} label="READY" />;
    return <PreviewWell height={height} />;
  };

  const renderControls = () => {
    switch (nodeType) {
      case "textSplitter":
        return (
          <>
            <div><FieldLabel>Delimiter</FieldLabel><TextInput value={String(data.delimiter ?? "\\n")} onChange={(value) => setField("delimiter", value)} /></div>
            <TextArea value={data.inputText ?? ""} onChange={(value) => setField("inputText", value)} placeholder="Connect text input and run" rows={4} />
          </>
        );
      case "maskPainter":
        return <MaskPainterSurface id={id} sourceImage={data.sourceImage} mode={(data.mode as "paint" | "erase") ?? "paint"} brushSize={Number(data.brushSize ?? 28)} updateNodeData={updateNodeData} />;
      case "loadLora":
        return (
          <>
            <div><FieldLabel>Paste a direct URL to your .safetensors file.</FieldLabel><div className="flex gap-1"><TextInput value={String(data.path ?? "")} onChange={(value) => setField("path", value)} placeholder="https://..." /><button onClick={() => regenerateNode(id)} className="nodrag nopan rounded-sm bg-orange-600 px-2 text-[9px] text-white">Set</button></div></div>
            <Slider label="Scale" value={Number(data.scale ?? 1)} min={0} max={2} step={0.05} onChange={(value) => setField("scale", value)} />
          </>
        );
      case "blur":
        return <><div><FieldLabel>Mask</FieldLabel><span className="text-[10px] text-neutral-500">Mask --</span></div>{renderPreview("h-28")}<Slider label="Blur Radius" value={Number(data.radius ?? 10)} min={0} max={60} suffix="px" onChange={(value) => setField("radius", value)} /></>;
      case "reformat":
        return (
          <>
            {renderPreview("h-32")}
            <Segmented value={(data.preset as "preset" | "custom") ?? "preset"} options={["preset", "custom"]} labels={{ preset: "Preset", custom: "Custom" }} onChange={(value) => setField("preset", value)} />
            <SelectInput value={String(`${data.width ?? 512}x${data.height ?? 512}`)} options={REFORMAT_PRESETS.map((p) => `${p.width}x${p.height}`)} labels={Object.fromEntries(REFORMAT_PRESETS.map((p) => [`${p.width}x${p.height}`, p.label]))} onChange={(value) => {
              const preset = REFORMAT_PRESETS.find((item) => `${item.width}x${item.height}` === value);
              if (preset) updateNodeData(id, { width: preset.width, height: preset.height } as Partial<WorkflowNodeData>);
            }} />
            <Checkbox checked={Boolean(data.keepAspectRatio ?? true)} onChange={(checked) => setField("keepAspectRatio", checked)} label="Keep aspect ratio" />
            <div className="grid grid-cols-2 gap-2">
              <div><FieldLabel>Width</FieldLabel><NumberInput value={Number(data.width ?? 512)} min={1} onChange={(value) => setField("width", value)} /></div>
              <div><FieldLabel>Height</FieldLabel><NumberInput value={Number(data.height ?? 512)} min={1} onChange={(value) => setField("height", value)} /></div>
            </div>
          </>
        );
      case "crop":
        return (
          <>
            {renderPreview("h-36")}
            <div className="flex items-center justify-between"><button onClick={() => updateNodeData(id, { x: 0, y: 0, width: 100, height: 100 } as Partial<WorkflowNodeData>)} className="nodrag nopan rounded-sm bg-neutral-700 px-2 py-1 text-[9px] text-white">Reset</button><div className="flex gap-1"><button onClick={() => setField("flipHorizontal", !data.flipHorizontal)} className="nodrag nopan rounded-sm bg-neutral-700 px-2 py-1 text-[9px] text-white">Flip H</button><button onClick={() => setField("flipVertical", !data.flipVertical)} className="nodrag nopan rounded-sm bg-neutral-700 px-2 py-1 text-[9px] text-white">Flip V</button></div></div>
            <div className="grid grid-cols-4 gap-2">{(["x", "y", "width", "height"] as const).map((field) => <div key={field}><FieldLabel>{field}</FieldLabel><NumberInput value={Number(data[field] ?? (field === "width" || field === "height" ? 100 : 0))} min={0} max={100} onChange={(value) => setField(field, value)} /></div>)}</div>
          </>
        );
      case "compositor":
        return (
          <>
            {renderPreview("h-28")}
            <div className="grid grid-cols-3 gap-1 text-[9px] text-neutral-500"><span>A --</span><span>B --</span><span>Mask --</span></div>
            <div><FieldLabel>Blend Mode</FieldLabel><SelectInput value={String(data.blendMode ?? "source-over")} options={["source-over", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten", "difference"]} labels={{ "source-over": "Normal", "soft-light": "Soft Light", "hard-light": "Hard Light" }} onChange={(value) => setField("blendMode", value)} /></div>
            <Slider label="Opacity" value={Number(data.opacity ?? 1)} min={0} max={1} step={0.05} suffix="" onChange={(value) => setField("opacity", value)} />
            <p className="text-[9px] text-neutral-500">Mask restricts blend to painted white areas; black regions show Image B.</p>
          </>
        );
      case "colorCorrection": {
        const tab = (data.activeTab as "color" | "levels") ?? "color";
        return (
          <>
            <Segmented value={tab} options={["color", "levels"]} labels={{ color: "Color Correction", levels: "Levels" }} onChange={(value) => setField("activeTab", value)} />
            {renderPreview("h-28")}
            {tab === "color" ? (
              <>
                <Slider label="Saturation" value={Number(data.saturation ?? 100)} min={0} max={200} onChange={(value) => setField("saturation", value)} />
                <Slider label="Gain" value={Number(data.gain ?? 1)} min={0} max={3} step={0.05} onChange={(value) => setField("gain", value)} />
                <Slider label="Contrast" value={Number(data.contrast ?? 100)} min={0} max={200} onChange={(value) => setField("contrast", value)} />
                <Slider label="Gamma" value={Number(data.gamma ?? 1)} min={0.1} max={3} step={0.05} onChange={(value) => setField("gamma", value)} />
              </>
            ) : (
              <>
                <Slider label="Black Point" value={Number(data.blackPoint ?? 0)} min={0} max={254} onChange={(value) => setField("blackPoint", value)} />
                <Slider label="White Point" value={Number(data.whitePoint ?? 255)} min={1} max={255} onChange={(value) => setField("whitePoint", value)} />
                <div className="grid grid-cols-3 gap-2">
                  {(["redGain", "greenGain", "blueGain"] as const).map((field) => <Slider key={field} label={field.replace("Gain", "")} value={Number(data[field] ?? 1)} min={0} max={2} step={0.05} onChange={(value) => setField(field, value)} />)}
                </div>
              </>
            )}
          </>
        );
      }
      case "videoMaskOverlay":
        return (
          <>
            {renderPreview("h-32")}
            <div><FieldLabel>Mask Color</FieldLabel><div className="flex gap-1">{["#ff0000", "#ffffff", "#000000", "#00ff00", "#0000ff", "#ff00ff"].map((color) => <button key={color} onClick={() => setField("maskColor", color)} className="nodrag nopan h-4 w-4 rounded-sm border border-neutral-600" style={{ backgroundColor: color }} />)}</div></div>
            <Slider label="Opacity" value={Number(data.maskOpacity ?? 1)} min={0} max={1} step={0.05} onChange={(value) => setField("maskOpacity", value)} />
            <Checkbox checked={Boolean(data.useShortestDuration ?? true)} onChange={(checked) => setField("useShortestDuration", checked)} label="Use Shortest Duration" />
          </>
        );
      case "extractFrameCustom":
        return (
          <>
            {renderPreview("h-32")}
            <div className="grid grid-cols-3 gap-2"><div><FieldLabel>Frame</FieldLabel><NumberInput value={Number(data.frameIndex ?? 0)} min={0} onChange={(value) => setField("frameIndex", value)} /></div><div><FieldLabel>Time</FieldLabel><NumberInput value={Number(data.frameTime ?? 0)} min={0} step={0.1} onChange={(value) => setField("frameTime", value)} /></div><div><FieldLabel>FPS</FieldLabel><NumberInput value={Number(data.fps ?? 30)} min={1} onChange={(value) => setField("fps", value)} /></div></div>
            <button onClick={() => regenerateNode(id)} className="nodrag nopan rounded-sm bg-[#242424] px-2 py-1.5 text-[10px] text-neutral-300 hover:bg-neutral-700">Extract Frame</button>
          </>
        );
      case "frameComposer":
        return (
          <>
            {renderPreview("h-32")}
            <div><FieldLabel>Region Position</FieldLabel><Segmented value={(data.regionPosition as "left" | "right" | "top" | "bottom") ?? "left"} options={["left", "right", "top", "bottom"]} onChange={(value) => setField("regionPosition", value)} /></div>
            <div><FieldLabel>Reference Distribution</FieldLabel><SelectInput value={(data.referenceDistribution as "single" | "perFrame" | "interval" | "all") ?? "single"} options={["single", "perFrame", "interval", "all"]} labels={{ single: "Single (first)", perFrame: "One per frame", interval: "One per interval", all: "All every frame" }} onChange={(value) => setField("referenceDistribution", value)} /></div>
            <NumberInput value={Number(data.regionSize ?? 320)} min={1} onChange={(value) => setField("regionSize", value)} />
            <Slider label="Reference opacity" value={Number(data.referenceOpacity ?? 0.35)} min={0} max={1} step={0.05} onChange={(value) => setField("referenceOpacity", value)} />
          </>
        );
      case "forEachStart":
        return <>{renderPreview("h-36")}<TextArea value={data.inputText ?? ""} onChange={(value) => setField("inputText", value)} placeholder="Connect items" rows={3} /><NumberInput value={Number(data.currentIndex ?? 0)} min={0} onChange={(value) => setField("currentIndex", value)} /></>;
      case "forEachEnd":
        return <>{renderPreview("h-36")}<p className="text-[10px] text-neutral-500">Collects image, video, text, and audio items from loop branches.</p></>;
      case "actionDirector":
        {
          const actionWidth = Number(data.width ?? 512);
          const actionHeight = Number(data.height ?? 512);
          const presetValue = `${actionWidth}x${actionHeight}`;
          const outputMode = ((data.outputMode ?? data.outputKind ?? "image") === "video" ? "video" : "image") as "image" | "video";
          const frameCount = Math.max(1, Number(data.frameCount ?? 48));
          const currentFrame = Math.max(0, Math.min(frameCount - 1, Number(data.currentFrame ?? 0)));
          const characters = data.characters ?? [{ id: "char-1", name: "Char 1", gender: "M" as const, selected: true, muted: false, clips: [] }];
          const selectedCharacter = characters.find((character) => character.selected) ?? characters[0];
          const props = data.props ?? [];
          const mocapVideos = data.faceMocapVideos ?? [];
          const bindings = data.bindings ?? [];
          const transformMode = (data.transformMode as "move" | "rotate" | "scale" | "none" | undefined) ?? "move";
          const setOutputMode = (value: "image" | "video") => updateNodeData(id, { outputMode: value, outputKind: value } as Partial<WorkflowNodeData>);
          const setCurrentFrame = (value: number) => updateNodeData(id, { currentFrame: Math.max(0, Math.min(frameCount - 1, value)) } as Partial<WorkflowNodeData>);
          const addCharacter = () => {
            const nextIndex = characters.length + 1;
            updateNodeData(id, {
              characters: [
                ...characters.map((character) => ({ ...character, selected: false })),
                { id: `char-${Date.now()}`, name: `Char ${nextIndex}`, gender: "M", selected: true, muted: false, clips: [] },
              ],
            } as Partial<WorkflowNodeData>);
          };
          const patchCharacter = (characterId: string, patch: Record<string, unknown>) => {
            updateNodeData(id, {
              characters: characters.map((character) => character.id === characterId ? { ...character, ...patch } : character),
            } as Partial<WorkflowNodeData>);
          };
          const selectCharacter = (characterId: string) => {
            updateNodeData(id, {
              characters: characters.map((character) => ({ ...character, selected: character.id === characterId })),
            } as Partial<WorkflowNodeData>);
          };
          const removeCharacter = (characterId: string) => {
            const nextCharacters = characters.filter((character) => character.id !== characterId);
            updateNodeData(id, {
              characters: nextCharacters.length > 0
                ? nextCharacters.map((character, index) => ({ ...character, selected: index === 0 }))
                : [{ id: "char-1", name: "Char 1", gender: "M", selected: true, muted: false, clips: [] }],
            } as Partial<WorkflowNodeData>);
          };
          const addUrlClip = () => {
            if (!selectedCharacter) return;
            const clip = { id: `clip-${Date.now()}`, url: "", name: "URL clip" };
            updateNodeData(id, {
              clips: [...(data.clips ?? []), clip],
              characters: characters.map((character) => character.id === selectedCharacter.id
                ? { ...character, clips: [...(character.clips ?? []), clip] }
                : character),
              status: "complete",
              error: null,
            } as Partial<WorkflowNodeData>);
          };
          const addBinding = () => {
            if (!selectedCharacter || mocapVideos.length === 0) return;
            updateNodeData(id, {
              bindings: [...bindings, { id: `binding-${Date.now()}`, characterId: selectedCharacter.id, videoId: mocapVideos[mocapVideos.length - 1].id }],
              status: "complete",
              error: null,
            } as Partial<WorkflowNodeData>);
          };
          return (
            <>
              <ActionDirectorPreview image={adaptivePreviewImage} />
              <div className="grid grid-cols-[42px_1fr] items-center gap-2">
                <FieldLabel>Mode</FieldLabel>
                <Segmented value={outputMode} options={["image", "video"]} labels={{ image: "Image", video: "Video" }} onChange={setOutputMode} />
              </div>
              <div className="grid grid-cols-[42px_1fr] items-center gap-2">
                <FieldLabel>Preset</FieldLabel>
                <ActionSelectInput value={presetValue} options={ACTION_PRESETS.map((p) => `${p.width}x${p.height}`)} labels={Object.fromEntries(ACTION_PRESETS.map((p) => [`${p.width}x${p.height}`, p.label]))} onChange={(value) => {
                  const preset = ACTION_PRESETS.find((item) => `${item.width}x${item.height}` === value);
                  if (preset) updateNodeData(id, { width: preset.width, height: preset.height, preset: value } as Partial<WorkflowNodeData>);
                }} />
              </div>
              <div className="grid grid-cols-[44px_1fr_1fr] items-end gap-2">
                <FieldLabel>W x H</FieldLabel>
                <ActionNumberInput value={actionWidth} min={1} onChange={(value) => setField("width", value)} />
                <ActionNumberInput value={actionHeight} min={1} onChange={(value) => setField("height", value)} />
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setField("isPlaying", !data.isPlaying)} className="nodrag nopan flex h-4 w-4 items-center justify-center rounded-sm bg-[#191919] text-cyan-400">
                  <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                </button>
                <input type="range" min={0} max={frameCount - 1} value={currentFrame} onChange={(event) => setCurrentFrame(Number(event.target.value))} className="nodrag nopan h-1 flex-1 accent-cyan-500" />
                <span className="text-[8px] text-neutral-500">{currentFrame} / {frameCount}</span>
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <FieldLabel>Characters</FieldLabel>
                  <button onClick={addCharacter} className="nodrag nopan rounded-sm bg-[#191919] px-1.5 py-0.5 text-[8px] text-neutral-400">+ Add</button>
                </div>
                <div className="max-h-[96px] space-y-1 overflow-y-auto pr-0.5">
                  {characters.map((character, index) => (
                    <div key={character.id} className="rounded-sm bg-[#1a1a1a] px-1.5 py-1 text-[9px] text-neutral-400">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-neutral-300">{character.name || `Char ${index + 1}`}</span>
                        <div className="flex gap-1">
                          <ActionTinyButton title="Gender" tone={character.gender === "M" ? "blue" : "cyan"} onClick={() => patchCharacter(character.id, { gender: character.gender === "M" ? "F" : "M" })}>{character.gender ?? "M"}</ActionTinyButton>
                          <ActionTinyButton title="Mute" tone={character.muted ? "red" : "cyan"} onClick={() => patchCharacter(character.id, { muted: !character.muted })}>{character.muted ? "M" : "U"}</ActionTinyButton>
                          <ActionTinyButton title="Select" tone={character.selected ? "blue" : "neutral"} onClick={() => selectCharacter(character.id)}>Sel</ActionTinyButton>
                          <ActionTinyButton title="Import animation" onClick={() => { selectCharacter(character.id); actionAnimationInputRef.current?.click(); }}>@</ActionTinyButton>
                          <ActionTinyButton title="Remove" tone="red" onClick={() => removeCharacter(character.id)}>x</ActionTinyButton>
                        </div>
                      </div>
                      <div className="text-neutral-600">Clips</div>
                      {(character.clips ?? []).length === 0 ? <div className="text-[8px] text-neutral-600">--</div> : null}
                      {(character.clips ?? []).slice(0, 2).map((clip) => <div key={clip.id} className="truncate text-[8px] text-neutral-500">{clip.name || clip.url || "Clip"}</div>)}
                      <div className="grid grid-cols-2 gap-1">
                        <ActionRowButton onClick={() => { selectCharacter(character.id); actionClipInputRef.current?.click(); }}>+ Add Clip</ActionRowButton>
                        <ActionRowButton onClick={() => { selectCharacter(character.id); addUrlClip(); }}>URL</ActionRowButton>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <FieldLabel>Props</FieldLabel>
                  <ActionRowButton onClick={() => actionPropInputRef.current?.click()}>Import Prop</ActionRowButton>
                </div>
                {props.length === 0 ? <div className="text-[8px] text-neutral-600">No props</div> : props.slice(-2).map((prop) => <div key={prop.id} className="truncate rounded-sm bg-[#151515] px-1.5 py-0.5 text-[8px] text-neutral-400">{prop.propFile}</div>)}
              </div>
              <div className="space-y-0.5">
                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <FieldLabel>Yedp Face Mocap</FieldLabel>
                  <ActionRowButton onClick={() => actionMocapInputRef.current?.click()}>Import Video</ActionRowButton>
                </div>
                {mocapVideos.length === 0 ? <div className="text-[8px] text-neutral-600">No mocap</div> : <div className="truncate text-[8px] text-neutral-500">{mocapVideos[mocapVideos.length - 1].name}</div>}
                <ActionRowButton disabled={!selectedCharacter || mocapVideos.length === 0} onClick={addBinding}>+ Add Binding</ActionRowButton>
                {bindings.length > 0 ? <div className="text-[8px] text-cyan-500">{bindings.length} binding{bindings.length === 1 ? "" : "s"}</div> : null}
              </div>
              <div className="space-y-0.5">
                <FieldLabel>Depth</FieldLabel>
                <div className="grid grid-cols-5 gap-1">
                  <ActionRowButton active={Boolean(data.depthPreviewMode)} onClick={() => setField("depthPreviewMode", !data.depthPreviewMode)}>{data.depthPreviewMode ? "Preview ON" : "Preview OFF"}</ActionRowButton>
                  <ActionRowButton active={transformMode === "move"} onClick={() => setField("transformMode", "move")}>Move</ActionRowButton>
                  <ActionRowButton active={transformMode === "rotate"} onClick={() => setField("transformMode", "rotate")}>Rotate</ActionRowButton>
                  <ActionRowButton active={transformMode === "scale"} onClick={() => setField("transformMode", "scale")}>Scale</ActionRowButton>
                  <ActionRowButton tone="red" active={transformMode === "none"} onClick={() => setField("transformMode", "none")}>Desel</ActionRowButton>
                </div>
              </div>
              <div className="space-y-0.5">
                <FieldLabel>Camera keyframes</FieldLabel>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
                  <ActionRowButton active={data.cameraKeyframes?.start === currentFrame} onClick={() => setField("cameraKeyframes", { ...(data.cameraKeyframes ?? {}), start: currentFrame })}>Set Start</ActionRowButton>
                  <ActionRowButton active={data.cameraKeyframes?.end === currentFrame} onClick={() => setField("cameraKeyframes", { ...(data.cameraKeyframes ?? {}), end: currentFrame })}>Set End</ActionRowButton>
                  <ActionRowButton onClick={() => setField("cameraKeyframes", { start: null, end: null })}>Clear Keyframes</ActionRowButton>
                </div>
              </div>
              <div className="grid grid-cols-[42px_1fr] items-center gap-2">
                <FieldLabel>Ease</FieldLabel>
                <ActionSelectInput value={String(data.ease ?? "linear")} options={["linear", "easeIn", "easeOut", "easeInOut"]} onChange={(value) => setField("ease", value)} />
              </div>
              <ActionRowButton tone="teal" disabled={data.status === "loading"} onClick={() => regenerateNode(id)}>
                {data.status === "loading" ? (outputMode === "video" ? `BAKING ${Math.round(Number(data.progress ?? 0))}%` : "RENDERING...") : outputMode === "video" ? "Bake Video" : "Capture Frame"}
              </ActionRowButton>
              <details className="text-[8px] text-neutral-600">
                <summary>Advanced</summary>
                <div className="mt-1 space-y-1">
                  <FieldLabel>Rig URL override</FieldLabel>
                  <TextInput value={String(data.rigUrl ?? "")} onChange={(value) => setField("rigUrl", value)} placeholder="/action-director/Yedp_Rig.glb" />
                </div>
              </details>
              <input ref={actionAnimationInputRef} type="file" accept=".fbx,.bvh,.glb,.gltf" className="hidden" onChange={(event) => void handleActionFileImport(event, "animation")} />
              <input ref={actionClipInputRef} type="file" accept=".fbx,.bvh,.glb,.gltf" className="hidden" onChange={(event) => void handleActionFileImport(event, "clip")} />
              <input ref={actionPropInputRef} type="file" accept=".glb,.gltf,.fbx,.obj" className="hidden" onChange={(event) => void handleActionFileImport(event, "prop")} />
              <input ref={actionMocapInputRef} type="file" accept="video/*" className="hidden" onChange={(event) => void handleActionFileImport(event, "mocap")} />
            </>
          );
        }
      case "urlSpawner": {
        const counts = parseUrls(String(data.urls ?? "")).reduce<Record<string, number>>((acc, url) => {
          const kind = classifyUrl(url) ?? "unknown";
          acc[kind] = (acc[kind] ?? 0) + 1;
          return acc;
        }, {});
        return (
          <>
            <FieldLabel>Paste one URL per line. Click Spawn to create input nodes.</FieldLabel>
            <TextArea value={String(data.urls ?? "")} onChange={(value) => setField("urls", value)} placeholder="https://example.com/photo.jpg" rows={5} />
            <div className="flex flex-wrap gap-1 text-[10px] text-neutral-400">{Object.entries(counts).map(([kind, count]) => <span key={kind} className="rounded bg-[#171717] px-1.5 py-0.5">{kind}: {count}</span>)}</div>
            <button onClick={spawnUrls} className="nodrag nopan rounded-sm bg-blue-700 px-2 py-1.5 text-[10px] font-medium text-white hover:bg-blue-600">Spawn Nodes</button>
          </>
        );
      }
      case "mediaDownload":
        return (
          <>
            <div><FieldLabel>URL (or connect Prompt above)</FieldLabel><TextInput value={String(data.inputUrl ?? "")} onChange={(value) => setField("inputUrl", value)} placeholder="https://youtube.com/watch?v=..." /></div>
            <div><FieldLabel>Format</FieldLabel><Segmented value={(data.format as "video" | "audio") ?? "video"} options={["video", "audio"]} labels={{ video: "Video", audio: "Audio" }} onChange={(value) => setField("format", value)} /></div>
            <div><FieldLabel>Quality</FieldLabel><SelectInput value={String(data.quality ?? "720p")} options={["best", "1080p", "720p", "480p"]} labels={{ best: "Best (largest file)" }} onChange={(value) => setField("quality", value)} /></div>
            <PreviewWell height="h-20" label="Paste a URL above and run" />
          </>
        );
      case "audioEnvironment":
        return (
          <>
            {data.outputAudio || data.sourceAudio ? renderPreview("h-16") : <PreviewWell height="h-16" label="Connect audio and run" />}
            <div className="grid grid-cols-2 gap-2"><div><FieldLabel>Preset</FieldLabel><SelectInput value={String(data.preset ?? "studioNarration")} options={["studioNarration", "smallRoom", "farRoom", "hall", "phone", "anotherRoom", "custom"]} labels={{ studioNarration: "Studio Narration", smallRoom: "Small Room", farRoom: "Far Room", anotherRoom: "Another Room" }} onChange={(value) => setField("preset", value)} /></div><div><FieldLabel>Tone</FieldLabel><SelectInput value={String(data.tone ?? "neutral")} options={["neutral", "warm", "cold", "muffled"]} labels={{ neutral: "Neutral", warm: "Warm", cold: "Cold", muffled: "Muffled" }} onChange={(value) => setField("tone", value)} /></div></div>
            <div><FieldLabel>Output Format</FieldLabel><SelectInput value={String(data.outputFormat ?? "wav")} options={["wav", "mp3"]} labels={{ wav: "WAV (uncompressed)", mp3: "MP3 (128 kbps)" }} onChange={(value) => setField("outputFormat", value)} /></div>
            <Slider label="Distance" value={Number(data.distance ?? 0.1)} min={0} max={1} step={0.01} onChange={(value) => setField("distance", value)} />
            <Slider label="Reverb Wet" value={Number(data.reverbWet ?? 0.02)} min={0} max={1} step={0.01} onChange={(value) => setField("reverbWet", value)} />
            <Slider label="Pan" value={Number(data.pan ?? 0)} min={-1} max={1} step={0.01} onChange={(value) => setField("pan", value)} />
            <Checkbox checked={Boolean(data.bypass)} onChange={(checked) => setField("bypass", checked)} label="Bypass" />
          </>
        );
      default:
        return null;
    }
  };

  const canExecute = Boolean(blueprint?.canExecute);
  const isActionDirector = nodeType === "actionDirector";

  return (
    <BaseNode
      id={id}
      selected={selected}
      hasError={data.status === "error"}
      className="!bg-[#242424] !border-neutral-700/80"
      contentClassName={isActionDirector ? "flex h-full flex-col gap-1.5 p-2 text-[9px]" : "flex h-full flex-col gap-2 p-3 text-[10px]"}
    >
      {renderHandles()}
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[9px] font-semibold uppercase tracking-wide text-neutral-400">{blueprint?.label ?? nodeType}</div>
        <div className="flex items-center gap-1">
          <MiniIconButton title="Node options">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75v.01M12 12v.01M12 17.25v.01" />
            </svg>
          </MiniIconButton>
          {canExecute ? (
            <MiniIconButton title="Run node" onClick={() => regenerateNode(id)}>
              <svg className={`h-3 w-3 ${isRunning ? "animate-pulse" : ""}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </MiniIconButton>
          ) : null}
        </div>
      </div>
      <div className={isActionDirector ? "flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden" : "flex min-h-0 flex-1 flex-col gap-2 overflow-auto"}>{renderControls()}</div>
      {data.status === "loading" ? <div className="h-1 rounded bg-blue-500" /> : null}
      {data.error ? <div className="rounded-sm bg-red-950/50 px-2 py-1 text-[10px] text-red-300">{data.error}</div> : null}
      {nodeType === "urlSpawner" && data.lastSpawnedCount ? <div className="text-[10px] text-neutral-500">Spawned {Number(data.lastSpawnedCount)} nodes</div> : null}
    </BaseNode>
  );
}
