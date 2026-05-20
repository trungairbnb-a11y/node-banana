"use client";

import { memo, useCallback, useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { useWorkflowStore } from "@/store/workflowStore";
import { getXNodeModel, type XNodeHandle } from "@/lib/xnode/models";
import type { WorkflowNode, XNodeModelNodeData } from "@/types";

/**
 * Generic node component for all 72 X-Node AI model nodes that were
 * reverse-engineered from https://dev-x-node.netlify.app/. Renders UI driven
 * by the schema entry in `src/lib/xnode/models.ts` so we don't need 72 hand
 * written React components.
 *
 * The UI shows:
 *   - Model name header
 *   - Connected input handles on the left, labels alongside
 *   - A prompt textarea when a `text`/Prompt input handle is present
 *   - Output preview (image/video/audio/text) on the bottom
 *   - Status + error messages
 *   - "Run" button wired to the workflow executor
 *
 * Backend integration is centralised in `/api/xnode/run` — each model is
 * dispatched to its provider (Gemini, fal.ai, Kie.ai, etc.) server-side.
 */
type XNodeAIModelNodeType = WorkflowNode & { type: string };

function getHandleColor(type: string): string {
  if (type.startsWith("image") || type === "reference" || type.startsWith("ref-image")) return "#3b82f6";
  if (type.startsWith("video") || type === "top-video" || type === "bottom-video") return "#22c55e";
  if (type.startsWith("audio")) return "#f59e0b";
  if (type.startsWith("text") || type === "system" || type === "words") return "#a855f7";
  if (type.startsWith("lora")) return "#ec4899";
  if (type.startsWith("mask") || type === "image-mask" || type === "video-mask") return "#6b7280";
  if (type === "file" || type === "input" || type === "output") return "#94a3b8";
  return "#64748b";
}

const HANDLE_SIZE = 10;
const HANDLE_OFFSET = 18;

export const XNodeAIModelNode = memo(function XNodeAIModelNode({
  id,
  type,
  data,
  selected,
}: NodeProps<XNodeAIModelNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const schema = useMemo(() => getXNodeModel(type as string), [type]);
  const nodeData = data as XNodeModelNodeData;

  const promptHandle = schema?.inputs.find(
    (h) => h.type === "text" && (h.id === "text" || h.id.startsWith("text")) && h.id !== "text-negative"
  );
  const negativeHandle = schema?.inputs.find((h) => h.id === "text-negative");

  const updatePrompt = useCallback(
    (value: string) => updateNodeData(id, { inputPrompt: value }),
    [id, updateNodeData]
  );
  const updateNegative = useCallback(
    (value: string) => updateNodeData(id, { negativePrompt: value }),
    [id, updateNodeData]
  );

  if (!schema) {
    return (
      <BaseNode id={id} selected={selected}>
        <div className="p-3 text-xs text-red-400">Unknown X-Node model: {String(type)}</div>
      </BaseNode>
    );
  }

  return (
    <BaseNode
      id={id}
      selected={selected}
      isExecuting={nodeData.status === "loading"}
      hasError={nodeData.status === "error"}
      minWidth={Math.max(220, schema.dimensions.width - 60)}
      minHeight={Math.max(120, schema.dimensions.height - 200)}
      handles={
        <>
          {schema.inputs.map((handle, index) => (
            <Handle
              key={`in-${handle.id}-${index}`}
              type="target"
              position={Position.Left}
              id={handle.id}
              style={{
                top: HANDLE_OFFSET + index * 22,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: getHandleColor(handle.type),
                border: "2px solid rgb(23 23 23)",
              }}
            />
          ))}
          {schema.outputs.map((handle, index) => (
            <Handle
              key={`out-${handle.id}-${index}`}
              type="source"
              position={Position.Right}
              id={handle.id}
              style={{
                top: HANDLE_OFFSET + index * 22,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: getHandleColor(handle.type),
                border: "2px solid rgb(23 23 23)",
              }}
            />
          ))}
        </>
      }
    >
      <div className="flex flex-col h-full p-2 gap-2 text-xs text-neutral-200">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="font-medium truncate" title={schema.displayName}>
            {schema.displayName}
          </div>
          <div
            className="text-[10px] uppercase tracking-wide opacity-60"
            title={`Provider: ${schema.provider}`}
          >
            {schema.provider}
          </div>
        </div>

        {schema.inputs.length > 0 && (
          <div className="flex flex-col gap-1 text-[10px] text-neutral-400 px-1">
            {schema.inputs.map((handle: XNodeHandle, index) => (
              <div key={`label-${handle.id}-${index}`} className="flex items-center gap-1">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: getHandleColor(handle.type) }}
                />
                <span className="truncate">{handle.label ?? handle.id}</span>
              </div>
            ))}
          </div>
        )}

        {promptHandle && (
          <textarea
            className="nodrag nopan nowheel w-full bg-neutral-900 border border-neutral-700 rounded p-2 resize-none text-xs"
            placeholder={promptHandle.label ?? "Prompt"}
            rows={3}
            value={nodeData.inputPrompt ?? ""}
            onChange={(e) => updatePrompt(e.target.value)}
          />
        )}

        {negativeHandle && (
          <textarea
            className="nodrag nopan nowheel w-full bg-neutral-900 border border-neutral-700 rounded p-2 resize-none text-[11px]"
            placeholder={negativeHandle.label ?? "Negative prompt"}
            rows={2}
            value={nodeData.negativePrompt ?? ""}
            onChange={(e) => updateNegative(e.target.value)}
          />
        )}

        {nodeData.outputImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={nodeData.outputImage}
            alt="output"
            className="w-full h-auto rounded object-contain"
          />
        )}

        {nodeData.outputVideo && (
          <video
            src={nodeData.outputVideo}
            controls
            className="w-full h-auto rounded"
          />
        )}

        {nodeData.outputAudio && (
          <audio src={nodeData.outputAudio} controls className="w-full" />
        )}

        {nodeData.outputText && (
          <div className="bg-neutral-900 border border-neutral-700 rounded p-2 whitespace-pre-wrap break-words">
            {nodeData.outputText}
          </div>
        )}

        {nodeData.error && (
          <div className="text-red-400 break-words">{nodeData.error}</div>
        )}
      </div>
    </BaseNode>
  );
});

export default XNodeAIModelNode;
