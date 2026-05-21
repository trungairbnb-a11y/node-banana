"use client";

/**
 * Right-click context menu for the React Flow pane — searchable Quick Add list.
 *
 * Mirrors the menu shown on https://dev-x-node.netlify.app/ when a user
 * right-clicks the canvas. Source for the behavior + Quick Add ordering was
 * reverse-engineered from the netlify bundle (component `er` in
 * `0o1h54py9~oq3.js` lines 5904–6086).
 *
 * Behavior parity points:
 *  - Search input auto-focuses on open.
 *  - ArrowUp / ArrowDown / Enter / Escape keyboard navigation.
 *  - Mouse hover updates the highlighted index.
 *  - Click-outside dismisses.
 *  - The menu's `{ left, top }` is clamped to keep it inside the viewport.
 *  - With an empty query, the menu shows the curated Quick Add shortcut list.
 *    With a query, results are filtered across the shortcut list + every
 *    registered blueprint (label / type / xnode title).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NodeMenuIcon } from "@/lib/nodeIcons";
import { getBlueprint, getBlueprints, type NodeBlueprint } from "@/lib/nodeRegistry";
import type { NodeType, WorkflowNodeData, XYPosition } from "@/types";

export interface PaneContextMenuItem {
  type: NodeType;
  /** Optional override for the menu label (used to expose model variants). */
  label?: string;
  /** Optional initial data to merge into defaults when the node is created. */
  initialData?: Partial<WorkflowNodeData>;
}

/**
 * Curated Quick Add shortcut list shown when the search input is empty.
 * Order + entries copied from the netlify bundle (`et` array).
 *
 * Items whose `type` is unknown to our blueprint registry are filtered out
 * at render time so the menu never shows entries that can't be created.
 */
const QUICK_ADD_ITEMS: PaneContextMenuItem[] = [
  { type: "output" as NodeType },
  {
    type: "nanoBanana" as NodeType,
    label: "Nano Banana",
    // Both legacy `model` AND new `selectedModel` MUST be set: the execution
    // path (nanoBananaExecutor) and the API route prefer `selectedModel.modelId`
    // over the legacy `model` field, so without `selectedModel` the user's
    // stored default (often "nano-banana-pro") would silently win.
    initialData: {
      model: "nano-banana",
      selectedModel: { provider: "gemini", modelId: "nano-banana", displayName: "Nano Banana" },
    } as Partial<WorkflowNodeData>,
  },
  {
    type: "nanoBanana" as NodeType,
    label: "Nano Banana Pro",
    initialData: {
      model: "nano-banana-pro",
      selectedModel: { provider: "gemini", modelId: "nano-banana-pro", displayName: "Nano Banana Pro" },
    } as Partial<WorkflowNodeData>,
  },
  {
    type: "nanoBanana" as NodeType,
    label: "Nano Banana 2",
    initialData: {
      model: "nano-banana-2",
      selectedModel: { provider: "gemini", modelId: "nano-banana-2", displayName: "Nano Banana 2" },
    } as Partial<WorkflowNodeData>,
  },
  { type: "extractFrames" as NodeType },
  { type: "reverseVideo" as NodeType },
  { type: "falMergeVideos" as NodeType },
  { type: "videoMaskOverlay" as NodeType },
  { type: "falMergeAudioVideo" as NodeType },
  { type: "falMergeAudios" as NodeType },
  { type: "trimVideo" as NodeType },
  { type: "imageCompare" as NodeType },
  { type: "compositor" as NodeType },
  { type: "maskPainter" as NodeType },
  { type: "blur" as NodeType },
  { type: "colorCorrection" as NodeType },
  { type: "urlSpawner" as NodeType },
];

interface PaneContextMenuProps {
  /** Mouse position in screen / client coords where the menu should appear. */
  position: { x: number; y: number };
  /** Same coords already projected into React Flow coordinates. */
  flowPosition: XYPosition;
  /**
   * Called when the user picks an item. The handler is responsible for
   * actually creating the node (so the parent can mix in extra fields like
   * default dimensions or selection state).
   */
  onSelect: (
    type: NodeType,
    flowPosition: XYPosition,
    initialData?: Partial<WorkflowNodeData>
  ) => void;
  /** Called when the menu should close (Escape, outside click, after select). */
  onClose: () => void;
}

function blueprintMatchesQuery(blueprint: NodeBlueprint, q: string): boolean {
  const haystack = [
    blueprint.label,
    blueprint.type,
    blueprint.xnode?.title,
    blueprint.category,
  ]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function PaneContextMenu({
  position,
  flowPosition,
  onSelect,
  onClose,
}: PaneContextMenuProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [style, setStyle] = useState<{ left: number; top: number; opacity: number }>(
    { left: position.x, top: position.y, opacity: 0 }
  );

  // Resolve the list of items to show. Empty query → curated Quick Add list;
  // otherwise filter shortcuts by label + all registered blueprints by
  // name/type/title, de-duplicated against shortcuts that already match.
  const items = useMemo<PaneContextMenuItem[]>(() => {
    const allBlueprints = getBlueprints();
    if (!query) {
      return QUICK_ADD_ITEMS.filter((item) => getBlueprint(item.type) !== undefined);
    }
    const q = query.toLowerCase();
    const matchedShortcuts = QUICK_ADD_ITEMS.filter((item) => {
      const blueprint = getBlueprint(item.type);
      if (!blueprint) return false;
      const fallbackLabel = blueprint.label ?? item.type;
      const label = (item.label ?? fallbackLabel).toLowerCase();
      return label.includes(q) || blueprintMatchesQuery(blueprint, q);
    });
    const shortcutTypeSetWithoutLabel = new Set(
      matchedShortcuts.filter((item) => !item.label).map((item) => item.type)
    );
    const extraBlueprints = allBlueprints
      .filter(
        (bp) =>
          blueprintMatchesQuery(bp, q) && !shortcutTypeSetWithoutLabel.has(bp.type)
      )
      .map<PaneContextMenuItem>((bp) => ({ type: bp.type }));
    return [...matchedShortcuts, ...extraBlueprints];
  }, [query]);

  // Clamp highlight to a valid index whenever the visible list shrinks so we
  // never index off the end. Derived rather than written from an effect to
  // keep the render loop tight (react-hooks/set-state-in-effect).
  const safeHighlight = items.length === 0 ? 0 : Math.min(highlightIndex, items.length - 1);

  // Auto-focus the search input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Position the menu — clamp to keep it on-screen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - rect.height - 8;
    setStyle({
      left: Math.max(8, Math.min(position.x, maxLeft)),
      top: Math.max(8, Math.min(position.y, maxTop)),
      opacity: 1,
    });
  }, [position.x, position.y]);

  // Keyboard navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const len = items.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((i) => {
            if (!len) return 0;
            const current = Math.min(i, len - 1);
            return (current + 1) % len;
          });
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((i) => {
            if (!len) return 0;
            const current = Math.min(i, len - 1);
            return (current - 1 + len) % len;
          });
          break;
        case "Enter":
          e.preventDefault();
          if (items[safeHighlight]) {
            const item = items[safeHighlight];
            onSelect(item.type, flowPosition, item.initialData);
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [items, safeHighlight, flowPosition, onSelect, onClose]);

  // Click-outside dismissal.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Element)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Swallow wheel events so the React Flow pane doesn't pan/zoom while the
  // user scrolls the menu list.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener("wheel", handler, { passive: true });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const handlePick = useCallback(
    (item: PaneContextMenuItem) => {
      onSelect(item.type, flowPosition, item.initialData);
      onClose();
    },
    [flowPosition, onSelect, onClose]
  );

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label="Add node"
      data-testid="pane-context-menu"
      className="fixed z-[100] bg-neutral-800 border border-neutral-600 rounded-lg shadow-xl min-w-[220px] overflow-hidden"
      style={style}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-2 pt-2 pb-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes…"
          className="w-full bg-neutral-700 border border-neutral-600 rounded px-2 py-1 text-[11px] text-neutral-200 placeholder-neutral-500 outline-none focus:border-neutral-500"
          data-testid="pane-context-menu-search"
        />
      </div>
      <div className="px-3 py-1">
        <span className="text-[9px] text-neutral-500 uppercase tracking-wide">
          {query ? "Results" : "Quick Add"}
        </span>
      </div>
      <div className="py-1 max-h-[400px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-[11px] text-neutral-500">No results</div>
        ) : (
          items.map((item, index) => {
            const blueprint = getBlueprint(item.type);
            const label = item.label ?? blueprint?.label ?? item.type;
            const isHighlighted = index === safeHighlight;
            return (
              <button
                key={`${item.type}-${item.label ?? index}`}
                type="button"
                onClick={() => handlePick(item)}
                onMouseEnter={() => setHighlightIndex(index)}
                className={`w-full px-3 py-2 text-left text-[11px] font-medium flex items-center gap-2 transition-colors ${
                  isHighlighted
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
                }`}
              >
                <NodeMenuIcon type={item.type} className="shrink-0 opacity-80" />
                <span className="truncate">{label}</span>
              </button>
            );
          })
        )}
      </div>
      <div className="px-2 py-1.5 border-t border-neutral-700 flex items-center justify-between">
        <span className="text-[9px] text-neutral-500 flex items-center gap-1">
          <kbd className="px-1 py-0.5 bg-neutral-700 rounded text-[8px]">↑↓</kbd>
          <span>Navigate</span>
          <kbd className="px-1 py-0.5 bg-neutral-700 rounded text-[8px] ml-1">↵</kbd>
          <span>Add</span>
        </span>
        <span className="text-[9px] text-neutral-500 flex items-center gap-1">
          <kbd className="px-1 py-0.5 bg-neutral-700 rounded text-[8px]">Esc</kbd>
          <span>Close</span>
        </span>
      </div>
    </div>
  );
}
