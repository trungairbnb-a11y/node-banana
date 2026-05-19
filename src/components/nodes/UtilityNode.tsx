"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PointerEvent, ReactNode } from "react";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { HandleLabel } from "./HandleLabel";
import { useShowHandleLabels } from "@/hooks/useShowHandleLabels";
import { useWorkflowStore } from "@/store/workflowStore";
import { useAdaptiveImageSrc } from "@/hooks/useAdaptiveImageSrc";
import { useVideoBlobUrl } from "@/hooks/useVideoBlobUrl";
import { getBlueprint, getBlueprintHandles } from "@/lib/nodeRegistry";
import type {
  HandleType,
  NodeType,
  UtilityNodeData,
  WorkflowNodeData,
} from "@/types";

type UtilityFlowNode = Node<UtilityNodeData, NodeType>;

const IMAGE_TYPES = new Set(["maskPainter", "blur", "reformat", "crop", "compositor", "colorCorrection", "actionDirector"]);
const VIDEO_TYPES = new Set(["videoMaskOverlay", "extractFrameCustom", "frameComposer", "actionDirector"]);
const AUDIO_TYPES = new Set(["audioEnvironment"]);
const TEXT_TYPES = new Set(["textSplitter", "forEachStart", "mediaDownload"]);

function handleKind(handleId: string): HandleType | "reference" | "mask" | "lora" | null {
  if (handleId === "mask") return "image";
  if (handleId === "lora") return "text";
  if (handleId === "reference") return "reference";
  if (handleId.includes("image") || handleId.includes("frame")) return "image";
  if (handleId.includes("video")) return "video";
  if (handleId.includes("audio")) return "audio";
  if (handleId.includes("text") || handleId === "prompt") return "text";
  return null;
}

function handleColor(handleId: string): string {
  const kind = handleKind(handleId);
  if (kind === "image") return "var(--handle-color-image)";
  if (kind === "video") return "var(--handle-color-video)";
  if (kind === "audio") return "var(--handle-color-audio)";
  if (kind === "text") return "var(--handle-color-text)";
  return "#9ca3af";
}

function handleLabel(handleId: string): string {
  if (handleId === "image-1") return "Image B";
  if (handleId === "video-1") return "Mask";
  if (handleId === "mask") return "Mask";
  if (handleId === "lora") return "LoRA";
  if (handleId.startsWith("text-")) return handleId.replace("text-", "Text ");
  return handleId
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function mergeUpdate(
  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void,
  id: string,
  data: Partial<WorkflowNodeData>
): void {
  updateNodeData(id, data);
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
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="text-[10px] uppercase tracking-wide text-neutral-500">{children}</label>;
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
      className="nodrag nopan w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-100"
    />
  );
}

function RangeInput({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="range"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
      className="nodrag nopan w-full accent-blue-500"
    />
  );
}

function SelectInput<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: T[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="nodrag nopan w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-100"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
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

  return (
    <div className="relative h-32 overflow-hidden rounded border border-neutral-700 bg-neutral-950">
      {adaptiveImage ? (
        <img src={adaptiveImage} alt="" className="absolute inset-0 h-full w-full object-contain opacity-70" />
      ) : null}
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
  const showLabels = useShowHandleLabels(selected);
  const handles = getBlueprintHandles(nodeType);

  const connected = useMemo(() => getConnectedInputs(id), [id, getConnectedInputs, nodes, edges]);
  const sourceImage = data.outputImage ?? data.sourceImage ?? null;
  const adaptivePreviewImage = useAdaptiveImageSrc(sourceImage, id);
  const previewVideo = useVideoBlobUrl(data.outputVideo ?? data.sourceVideo ?? null);

  useEffect(() => {
    const next: Partial<WorkflowNodeData> = {};
    if (IMAGE_TYPES.has(nodeType) || nodeType === "frameComposer") {
      if (connected.images[0] && connected.images[0] !== data.sourceImage) {
        (next as UtilityNodeData).sourceImage = connected.images[0];
      }
      if (connected.images[1] && connected.images[1] !== data.secondaryImage) {
        (next as UtilityNodeData).secondaryImage = connected.images[1];
      }
      if (nodeType === "frameComposer" && connected.images.length > 0) {
        (next as UtilityNodeData).referenceImages = connected.images;
      }
    }
    if (VIDEO_TYPES.has(nodeType)) {
      if (connected.videos[0] && connected.videos[0] !== data.sourceVideo) {
        (next as UtilityNodeData).sourceVideo = connected.videos[0];
      }
      if (connected.videos[1] && connected.videos[1] !== data.maskVideo) {
        (next as UtilityNodeData).maskVideo = connected.videos[1];
      }
    }
    if (AUDIO_TYPES.has(nodeType) && connected.audio[0] && connected.audio[0] !== data.sourceAudio) {
      (next as UtilityNodeData).sourceAudio = connected.audio[0];
    }
    if (TEXT_TYPES.has(nodeType) && connected.text && connected.text !== data.inputText) {
      (next as UtilityNodeData).inputText = connected.text;
      if (nodeType === "mediaDownload") {
        (next as UtilityNodeData).inputUrl = connected.text;
      }
    }
    if (Object.keys(next).length > 0) {
      updateNodeData(id, next);
    }
  }, [connected, data.inputText, data.maskVideo, data.secondaryImage, data.sourceAudio, data.sourceImage, data.sourceVideo, id, nodeType, updateNodeData]);

  const setField = useCallback(
    (field: string, value: unknown) => {
      mergeUpdate(updateNodeData, id, { [field]: value } as Partial<WorkflowNodeData>);
    },
    [id, updateNodeData]
  );

  const spawnUrls = useCallback(() => {
    const currentNode = nodes.find((node) => node.id === id);
    const base = currentNode?.position ?? { x: 0, y: 0 };
    let created = 0;
    parseUrls(String(data.urls ?? "")).forEach((url, index) => {
      const nodeKind = classifyUrl(url);
      if (!nodeKind) return;
      const filename = filenameFromUrl(url);
      const position = { x: base.x + 380 + (index % 2) * 330, y: base.y + Math.floor(index / 2) * 240 };
      if (nodeKind === "imageInput") {
        addNode("imageInput", position, { image: url, filename, dimensions: null });
      } else if (nodeKind === "videoInput") {
        addNode("videoInput", position, { video: url, filename, duration: null, dimensions: null, format: null });
      } else if (nodeKind === "audioInput") {
        addNode("audioInput", position, { audioFile: url, filename, duration: null, format: null });
      } else {
        addNode("loadLora", position, { path: url, scale: 1 });
      }
      created += 1;
    });
    updateNodeData(id, {
      lastSpawnedCount: created,
      status: "complete",
      error: created === 0 ? "No supported URLs found" : null,
    } as Partial<WorkflowNodeData>);
  }, [addNode, data.urls, id, nodes, updateNodeData]);

  const renderHandles = () => {
    const outputHandles =
      nodeType === "textSplitter" && Array.isArray(data.outputItems) && data.outputItems.length > 0
        ? data.outputItems.slice(0, 10).map((_, index) => `text-${index}`)
        : handles.outputs;
    const allInputs = handles.inputs;
    return (
      <>
        {allInputs.map((handleId, index) => {
          const top = `${((index + 1) / (allInputs.length + 1)) * 100}%`;
          return (
            <div key={`in-${handleId}`}>
              <Handle type="target" position={Position.Left} id={handleId} data-handletype={handleKind(handleId)} style={{ top, zIndex: 10 }} />
              <HandleLabel label={handleLabel(handleId)} side="target" color={handleColor(handleId)} top={`calc(${top} - 7px)`} visible={showLabels} />
            </div>
          );
        })}
        {outputHandles.map((handleId, index) => {
          const top = `${((index + 1) / (outputHandles.length + 1)) * 100}%`;
          return (
            <div key={`out-${handleId}`}>
              <Handle type="source" position={Position.Right} id={handleId} data-handletype={handleKind(handleId)} style={{ top, zIndex: 10 }} />
              <HandleLabel label={handleLabel(handleId)} side="source" color={handleColor(handleId)} top={`calc(${top} - 7px)`} visible={showLabels} />
            </div>
          );
        })}
      </>
    );
  };

  const renderPreview = () => {
    if (nodeType === "urlSpawner" || nodeType === "loadLora" || nodeType === "textSplitter" || nodeType === "forEachStart" || nodeType === "forEachEnd") {
      const text = data.outputText ?? data.outputJson ?? data.outputLora ?? "";
      return text ? (
        <pre className="max-h-20 overflow-auto rounded bg-neutral-950 p-2 text-[10px] text-neutral-300">{String(text)}</pre>
      ) : null;
    }
    if (nodeType === "audioEnvironment" && (data.outputAudio || data.sourceAudio)) {
      return <audio src={(data.outputAudio ?? data.sourceAudio) || undefined} controls className="w-full" />;
    }
    if ((data.outputVideo || data.sourceVideo) && previewVideo) {
      return <video src={previewVideo} controls muted loop playsInline className="h-28 w-full rounded bg-black object-contain" />;
    }
    if (adaptivePreviewImage) {
      return <img src={adaptivePreviewImage} alt="" className="h-28 w-full rounded bg-neutral-950 object-contain" />;
    }
    return <div className="flex h-20 items-center justify-center rounded bg-neutral-900 text-[11px] text-neutral-500">No preview</div>;
  };

  const renderControls = () => {
    switch (nodeType) {
      case "textSplitter":
        return (
          <>
            <textarea value={data.inputText ?? ""} onChange={(event) => setField("inputText", event.target.value)} className="nodrag nopan h-16 rounded border border-neutral-700 bg-neutral-900 p-2 text-[11px] text-neutral-100" />
            <div className="grid grid-cols-2 gap-2">
              <div><FieldLabel>Delimiter</FieldLabel><input value={String(data.delimiter ?? "\\n")} onChange={(event) => setField("delimiter", event.target.value)} className="nodrag nopan w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-100" /></div>
              <div><FieldLabel>Outputs</FieldLabel><NumberInput value={Number(data.maxOutputs ?? 10)} min={1} max={10} onChange={(value) => setField("maxOutputs", value)} /></div>
            </div>
          </>
        );
      case "maskPainter":
        return (
          <>
            <MaskPainterSurface id={id} sourceImage={data.sourceImage} mode={(data.mode as "paint" | "erase") ?? "paint"} brushSize={Number(data.brushSize ?? 28)} updateNodeData={updateNodeData} />
            <div className="grid grid-cols-2 gap-2">
              <div><FieldLabel>Mode</FieldLabel><SelectInput value={(data.mode as "paint" | "erase") ?? "paint"} options={["paint", "erase"]} onChange={(value) => setField("mode", value)} /></div>
              <div><FieldLabel>Brush</FieldLabel><NumberInput value={Number(data.brushSize ?? 28)} min={2} max={96} onChange={(value) => setField("brushSize", value)} /></div>
            </div>
          </>
        );
      case "loadLora":
        return (
          <>
            <div><FieldLabel>URL or path</FieldLabel><input value={String(data.path ?? "")} onChange={(event) => setField("path", event.target.value)} className="nodrag nopan w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-100" /></div>
            <div><FieldLabel>Scale</FieldLabel><RangeInput value={Number(data.scale ?? 1)} min={0} max={2} step={0.05} onChange={(value) => setField("scale", value)} /></div>
          </>
        );
      case "blur":
        return <div><FieldLabel>Radius</FieldLabel><RangeInput value={Number(data.radius ?? 12)} min={0} max={60} onChange={(value) => setField("radius", value)} /></div>;
      case "reformat":
        return (
          <div className="grid grid-cols-2 gap-2">
            <div><FieldLabel>Width</FieldLabel><NumberInput value={Number(data.width ?? 1024)} min={1} onChange={(value) => setField("width", value)} /></div>
            <div><FieldLabel>Height</FieldLabel><NumberInput value={Number(data.height ?? 1024)} min={1} onChange={(value) => setField("height", value)} /></div>
            <div><FieldLabel>Mode</FieldLabel><SelectInput value={(data.mode as "contain" | "cover" | "stretch") ?? "contain"} options={["contain", "cover", "stretch"]} onChange={(value) => setField("mode", value)} /></div>
            <div><FieldLabel>Background</FieldLabel><input type="color" value={String(data.background ?? "#000000")} onChange={(event) => setField("background", event.target.value)} className="nodrag nopan h-7 w-full rounded border border-neutral-700 bg-neutral-900" /></div>
          </div>
        );
      case "crop":
        return (
          <div className="grid grid-cols-4 gap-2">
            {(["x", "y", "width", "height"] as const).map((field) => <div key={field}><FieldLabel>{field}</FieldLabel><NumberInput value={Number(data[field] ?? (field === "width" || field === "height" ? 100 : 0))} min={0} max={100} onChange={(value) => setField(field, value)} /></div>)}
            <label className="col-span-2 flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" checked={Boolean(data.flipHorizontal)} onChange={(event) => setField("flipHorizontal", event.target.checked)} /> Flip H</label>
            <label className="col-span-2 flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" checked={Boolean(data.flipVertical)} onChange={(event) => setField("flipVertical", event.target.checked)} /> Flip V</label>
          </div>
        );
      case "compositor":
        return (
          <div className="grid grid-cols-2 gap-2">
            <div><FieldLabel>Blend</FieldLabel><SelectInput value={(data.blendMode as GlobalCompositeOperation) ?? "source-over"} options={["source-over", "multiply", "screen", "overlay", "darken", "lighten"]} onChange={(value) => setField("blendMode", value)} /></div>
            <div><FieldLabel>Opacity</FieldLabel><RangeInput value={Number(data.opacity ?? 0.75)} min={0} max={1} step={0.05} onChange={(value) => setField("opacity", value)} /></div>
          </div>
        );
      case "colorCorrection":
        return (
          <div className="grid grid-cols-2 gap-2">
            {(["brightness", "contrast", "saturation", "grayscale"] as const).map((field) => <div key={field}><FieldLabel>{field}</FieldLabel><RangeInput value={Number(data[field] ?? (field === "grayscale" ? 0 : 100))} min={0} max={200} onChange={(value) => setField(field, value)} /></div>)}
          </div>
        );
      case "forEachStart":
        return (
          <>
            <textarea value={data.inputText ?? ""} onChange={(event) => setField("inputText", event.target.value)} className="nodrag nopan h-16 rounded border border-neutral-700 bg-neutral-900 p-2 text-[11px] text-neutral-100" />
            <div><FieldLabel>Current index</FieldLabel><NumberInput value={Number(data.currentIndex ?? 0)} min={0} onChange={(value) => setField("currentIndex", value)} /></div>
          </>
        );
      case "actionDirector":
        return <div><FieldLabel>Mode</FieldLabel><SelectInput value={(data.mode as "pose" | "depth" | "canny" | "normal" | "shaded" | "alpha") ?? "canny"} options={["pose", "depth", "canny", "normal", "shaded", "alpha"]} onChange={(value) => setField("mode", value)} /></div>;
      case "urlSpawner": {
        const counts = parseUrls(String(data.urls ?? "")).reduce<Record<string, number>>((acc, url) => {
          const kind = classifyUrl(url) ?? "unknown";
          acc[kind] = (acc[kind] ?? 0) + 1;
          return acc;
        }, {});
        return (
          <>
            <textarea value={String(data.urls ?? "")} onChange={(event) => setField("urls", event.target.value)} className="nodrag nopan h-28 rounded border border-neutral-700 bg-neutral-900 p-2 text-[11px] text-neutral-100" />
            <div className="flex flex-wrap gap-1 text-[10px] text-neutral-400">
              {Object.entries(counts).map(([kind, count]) => <span key={kind} className="rounded bg-neutral-900 px-1.5 py-0.5">{kind}: {count}</span>)}
            </div>
            <button onClick={spawnUrls} className="nodrag nopan rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-500">Spawn Nodes</button>
          </>
        );
      }
      case "mediaDownload":
        return (
          <>
            <input value={String(data.inputUrl ?? "")} onChange={(event) => setField("inputUrl", event.target.value)} placeholder="https://..." className="nodrag nopan w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-100" />
            <div className="grid grid-cols-2 gap-2">
              <div><FieldLabel>Format</FieldLabel><SelectInput value={(data.format as "video" | "audio") ?? "video"} options={["video", "audio"]} onChange={(value) => setField("format", value)} /></div>
              <div><FieldLabel>Quality</FieldLabel><SelectInput value={(data.quality as "best" | "medium" | "low") ?? "best"} options={["best", "medium", "low"]} onChange={(value) => setField("quality", value)} /></div>
            </div>
          </>
        );
      case "extractFrameCustom":
        return (
          <div className="grid grid-cols-3 gap-2">
            <div><FieldLabel>Time</FieldLabel><NumberInput value={Number(data.frameTime ?? 0)} min={0} step={0.1} onChange={(value) => setField("frameTime", value)} /></div>
            <div><FieldLabel>Frame</FieldLabel><NumberInput value={Number(data.frameIndex ?? 0)} min={0} onChange={(value) => setField("frameIndex", value)} /></div>
            <div><FieldLabel>FPS</FieldLabel><NumberInput value={Number(data.fps ?? 30)} min={1} onChange={(value) => setField("fps", value)} /></div>
          </div>
        );
      case "frameComposer":
        return <div><FieldLabel>Reference opacity</FieldLabel><RangeInput value={Number(data.referenceOpacity ?? 0.35)} min={0} max={1} step={0.05} onChange={(value) => setField("referenceOpacity", value)} /></div>;
      case "audioEnvironment":
        return (
          <div className="grid grid-cols-2 gap-2">
            {(["bass", "mid", "treble"] as const).map((field) => <div key={field}><FieldLabel>{field}</FieldLabel><RangeInput value={Number(data[field] ?? 0)} min={-24} max={24} onChange={(value) => setField(field, value)} /></div>)}
            <div><FieldLabel>Gain</FieldLabel><RangeInput value={Number(data.gain ?? 1)} min={0} max={2} step={0.05} onChange={(value) => setField("gain", value)} /></div>
            <label className="col-span-2 flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" checked={Boolean(data.bypass)} onChange={(event) => setField("bypass", event.target.checked)} /> Bypass</label>
          </div>
        );
      default:
        return null;
    }
  };

  const canExecute = Boolean(blueprint?.canExecute);

  return (
    <BaseNode id={id} selected={selected} hasError={data.status === "error"} contentClassName="flex h-full flex-col gap-2 p-3">
      {renderHandles()}
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-neutral-300">{blueprint?.label ?? nodeType}</div>
        {canExecute ? (
          <button
            onClick={() => regenerateNode(id)}
            disabled={isRunning}
            className="nodrag nopan rounded bg-neutral-700 px-2 py-1 text-[10px] font-medium text-neutral-100 hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Run
          </button>
        ) : null}
      </div>
      {renderPreview()}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">{renderControls()}</div>
      {data.status === "loading" ? <div className="h-1 rounded bg-blue-500" /> : null}
      {data.error ? <div className="rounded bg-red-950/50 px-2 py-1 text-[10px] text-red-300">{data.error}</div> : null}
      {nodeType === "urlSpawner" && data.lastSpawnedCount ? <div className="text-[10px] text-neutral-500">Spawned {Number(data.lastSpawnedCount)} nodes</div> : null}
    </BaseNode>
  );
}
