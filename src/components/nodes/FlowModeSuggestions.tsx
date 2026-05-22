"use client";

import React, { useMemo, useState } from "react";
import { getFlowModeFromModelId, getFlowModeSuggestions, FLOW_MODEL_TIERS, type FlowVideoMode } from "@/lib/flow/modes";

interface FlowModeSuggestionsProps {
  modelId: string;
  parameters: Record<string, unknown>;
  onParametersChange: (parameters: Record<string, unknown>) => void;
  onModeChange: (modelId: string) => void;
}

export function FlowModeSuggestions({
  modelId,
  parameters,
  onParametersChange,
  onModeChange,
}: FlowModeSuggestionsProps) {
  const [dismissed, setDismissed] = useState(false);

  const mode = useMemo(() => getFlowModeFromModelId(modelId), [modelId]);
  const suggestions = useMemo(() => (mode ? getFlowModeSuggestions(mode) : null), [mode]);

  if (!mode || !suggestions || dismissed) return null;

  const currentTier = parameters.tier as string | undefined;
  const showTierHint = currentTier !== suggestions.suggestedTier;

  return (
    <div className="mt-1 mb-2 rounded border border-neutral-700/60 bg-neutral-800/60 px-2 py-1.5 text-[10px] text-neutral-400">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-neutral-300 text-[9px] uppercase tracking-wide">
          Smart Suggest
        </span>
        <button
          type="button"
          className="text-neutral-500 hover:text-neutral-300 text-[9px] leading-none"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss suggestions"
        >
          ✕
        </button>
      </div>

      {/* Tier suggestion */}
      {showTierHint && (
        <button
          type="button"
          className="nodrag nopan flex items-center gap-1.5 w-full text-left mb-1 rounded px-1.5 py-1 hover:bg-neutral-700/50 transition-colors"
          onClick={() =>
            onParametersChange({ ...parameters, tier: suggestions.suggestedTier })
          }
        >
          <span className="shrink-0 text-amber-400">⚡</span>
          <span>
            Recommended tier:{" "}
            <span className="text-neutral-200 font-medium">
              {FLOW_MODEL_TIERS.find((t) => t.id === suggestions.suggestedTier)?.label ?? suggestions.suggestedTier}
            </span>
          </span>
        </button>
      )}

      {/* Tips */}
      {suggestions.tips.length > 0 && (
        <ul className="space-y-0.5 mb-1">
          {suggestions.tips.map((tip, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="shrink-0 text-blue-400 mt-px">›</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Related modes */}
      {suggestions.relatedModes.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1 pt-1 border-t border-neutral-700/40">
          <span className="text-neutral-500 text-[9px]">Related:</span>
          {suggestions.relatedModes.map((related) => (
            <button
              key={related}
              type="button"
              className="nodrag nopan rounded bg-neutral-700/50 px-1.5 py-0.5 text-[9px] text-neutral-300 hover:bg-neutral-600/60 hover:text-neutral-100 transition-colors"
              onClick={() => onModeChange(`flow-veo-3.1/${related}`)}
            >
              {formatModeName(related)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatModeName(mode: FlowVideoMode): string {
  return mode
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
