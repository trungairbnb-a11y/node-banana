"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useWorkflowStore } from "@/store/workflowStore";
import { GROUP_COLORS } from "@/store/utils/nodeDefaults";
import type { StickyNoteColor, StickyNoteNodeData, WorkflowNode } from "@/types";

const COLOR_OPTIONS: Array<{ color: StickyNoteColor; label: string }> = [
  { color: "neutral", label: "Gray" },
  { color: "blue", label: "Blue" },
  { color: "green", label: "Green" },
  { color: "purple", label: "Purple" },
  { color: "orange", label: "Orange" },
  { color: "red", label: "Red" },
];

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 72;
const FONT_STEP = 2;

export const StickyNoteNode = memo(function StickyNoteNode({
  id,
  data,
  selected,
}: NodeProps<WorkflowNode>) {
  const noteData = data as StickyNoteNodeData;
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null);
  const colorBtnRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const onTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData(id, { text: e.target.value });
    },
    [id, updateNodeData]
  );

  const bumpFontSize = useCallback(
    (delta: number) => {
      const next = Math.max(
        MIN_FONT_SIZE,
        Math.min(MAX_FONT_SIZE, (noteData.fontSize || 16) + delta)
      );
      updateNodeData(id, { fontSize: next });
    },
    [id, noteData.fontSize, updateNodeData]
  );

  const setColor = useCallback(
    (color: StickyNoteColor) => {
      updateNodeData(id, { color });
      setPickerOpen(false);
    },
    [id, updateNodeData]
  );

  const togglePicker = useCallback(() => {
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    if (colorBtnRef.current) {
      const rect = colorBtnRef.current.getBoundingClientRect();
      setPickerPos({ x: rect.right, y: rect.bottom + 4 });
      setPickerOpen(true);
    }
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const inBtn = colorBtnRef.current?.contains(e.target as Node);
      const inPicker = pickerRef.current?.contains(e.target as Node);
      if (!inBtn && !inPicker) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [pickerOpen]);

  const activeColor: StickyNoteColor = noteData.color || "neutral";
  const colorValue = GROUP_COLORS[activeColor];
  const fontSize = noteData.fontSize || 16;

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={150}
        minHeight={100}
        lineClassName="!border-transparent"
        handleClassName="!w-3 !h-3 !bg-neutral-500/50 !border-neutral-400 hover:!bg-neutral-400"
      />
      <div
        className="w-full h-full min-h-0 overflow-hidden rounded-xl flex flex-col shadow-lg transition-colors border"
        style={{
          backgroundColor: `${colorValue}30`,
          borderColor: colorValue,
        }}
      >
        <div
          className="flex items-center gap-1 px-2 py-1 shrink-0 border-b border-white/10 rounded-t-[11px]"
          style={{ backgroundColor: colorValue }}
        >
          <div className="flex items-center gap-0.5 mr-auto">
            <button
              type="button"
              onClick={() => bumpFontSize(-FONT_STEP)}
              className="p-1 rounded hover:bg-white/20 text-white/70 hover:text-white transition-colors"
              title="Decrease font size"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 12h-15"
                />
              </svg>
            </button>
            <span className="text-[10px] font-bold text-white min-w-[20px] text-center">
              {fontSize}
            </span>
            <button
              type="button"
              onClick={() => bumpFontSize(FONT_STEP)}
              className="p-1 rounded hover:bg-white/20 text-white/70 hover:text-white transition-colors"
              title="Increase font size"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
            </button>
          </div>

          <button
            ref={colorBtnRef}
            type="button"
            onClick={togglePicker}
            className="w-5 h-5 rounded-full border border-white/30 hover:border-white/60 transition-colors"
            style={{ backgroundColor: colorValue }}
            title="Change color"
          />
        </div>

        {pickerOpen &&
          pickerPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={pickerRef}
              className="fixed p-2 bg-neutral-800 rounded-lg shadow-xl border border-neutral-600 grid grid-cols-4 gap-1.5 z-[9999]"
              style={{
                top: pickerPos.y,
                left: pickerPos.x,
                transform: "translateX(-100%)",
              }}
            >
              {COLOR_OPTIONS.map(({ color, label }) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setColor(color)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${
                    activeColor === color
                      ? "border-white scale-110"
                      : "border-transparent hover:border-white/50"
                  }`}
                  style={{ backgroundColor: GROUP_COLORS[color] }}
                  title={label}
                />
              ))}
            </div>,
            document.body
          )}

        <textarea
          value={noteData.text}
          onChange={onTextChange}
          placeholder="Write a note..."
          className="nodrag nopan nowheel w-full flex-1 min-h-0 p-3 text-white placeholder:text-white/40 bg-transparent resize-none focus:outline-none border-none leading-relaxed rounded-b-[11px] overflow-auto"
          style={{ fontSize: `${fontSize}px` }}
        />
      </div>
    </>
  );
});
