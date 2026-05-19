"use client";

import React, { useMemo, useState } from "react";
import type { GenerationTrace } from "@/types";

interface GenerationTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
  trace?: GenerationTrace | null;
}

type TraceTab = "prompt" | "refs" | "payload" | "response";

function JsonBlock({ value }: { value: unknown }) {
  const text = useMemo(() => JSON.stringify(value ?? null, null, 2), [value]);
  return (
    <pre className="max-h-[56vh] overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-950 p-3 text-[11px] leading-5 text-neutral-200">
      {text}
    </pre>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(value).catch(() => {})}
      className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-white"
    >
      Copy
    </button>
  );
}

export function GenerationTraceModal({ isOpen, onClose, trace }: GenerationTraceModalProps) {
  const [activeTab, setActiveTab] = useState<TraceTab>("prompt");
  if (!isOpen) return null;

  const tabs: Array<{ id: TraceTab; label: string }> = [
    { id: "prompt", label: "Resolved Prompt" },
    { id: "refs", label: "References" },
    { id: "payload", label: "Provider Payload" },
    { id: "response", label: "Response/Error" },
  ];

  const prompt = trace?.resolvedPrompt || "";
  const response = {
    response: trace?.response ?? null,
    error: trace?.error ?? null,
    logPath: trace?.logPath ?? null,
    traceId: trace?.traceId ?? null,
    requestId: trace?.requestId ?? null,
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-100">Generation Debug Trace</h2>
            <p className="truncate text-[11px] text-neutral-500">
              {trace ? `${trace.provider || "provider"} / ${trace.selectedModel?.displayName || trace.selectedModel?.modelId || "model"} / ${trace.traceId}` : "No trace captured yet"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            Close
          </button>
        </div>

        {!trace ? (
          <div className="p-6 text-sm text-neutral-400">
            Run this node once to capture the exact prompt, references, and provider payload.
          </div>
        ) : (
          <>
            {trace.warnings && trace.warnings.length > 0 && (
              <div className="border-b border-amber-900/50 bg-amber-950/40 px-4 py-2 text-[11px] text-amber-200">
                {trace.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            )}

            <div className="flex gap-1 border-b border-neutral-800 px-3 pt-3">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-t px-3 py-1.5 text-[11px] ${
                    activeTab === tab.id
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-100"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {activeTab === "prompt" && (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <CopyButton value={prompt} />
                  </div>
                  <pre className="max-h-[56vh] overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-950 p-3 text-[12px] leading-5 text-neutral-100">
                    {prompt || "(empty prompt)"}
                  </pre>
                </div>
              )}
              {activeTab === "refs" && <JsonBlock value={{ mediaRefs: trace.mediaRefs, connectedInputs: trace.connectedInputs }} />}
              {activeTab === "payload" && <JsonBlock value={trace.providerPayload} />}
              {activeTab === "response" && <JsonBlock value={response} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
