"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useWorkflowStore } from "@/store/workflowStore";
import { useToast } from "@/components/Toast";
import {
  CCS_OPENAI_IMAGE_MODEL,
  buildModelRetargetPatch,
  fetchModelRetargetEnvStatus,
  scanWorkflowForModelRetargets,
  type ModelRetargetIssue,
} from "@/lib/modelRetargeting";
import { FLOW_MODELS, getFlowModeFromModelId } from "@/lib/flow/modes";
import type { WorkflowEdge, WorkflowNodeData } from "@/types";

interface RetargetModelsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function modelLabel(issue: ModelRetargetIssue): string {
  const model = issue.currentModel;
  return model ? `${model.displayName} (${model.provider}:${model.modelId || "none"})` : "No model selected";
}

function fallbackLabel(issue: ModelRetargetIssue): string | null {
  const model = issue.fallbackModel;
  return model ? `${model.displayName} (${model.provider}:${model.modelId || "none"})` : null;
}

function incomingCounts(nodeId: string, edges: WorkflowEdge[]) {
  let image = 0;
  let video = 0;
  for (const edge of edges) {
    if (edge.target !== nodeId || edge.data?.isLoop) continue;
    const handle = (edge.targetHandle || "").toLowerCase();
    if (!handle || handle.includes("image") || handle.includes("frame")) image += 1;
    if (handle.includes("video")) video += 1;
  }
  return { image, video };
}

function flowModeWarning(modelId: string, nodeId: string, edges: WorkflowEdge[]): string | null {
  const mode = getFlowModeFromModelId(modelId);
  if (!mode) return null;
  const counts = incomingCounts(nodeId, edges);

  if (mode === "reference-video" && counts.image < 1) {
    return "Reference Video needs at least one image reference.";
  }
  if (mode === "start-image-video" && counts.image < 1) {
    return "Start Image Video needs one start image.";
  }
  if (mode === "compose-start-video" && counts.image < 2) {
    return `Compose Start Video works best with a start image plus at least one extra ref. Current image edges: ${counts.image}.`;
  }
  if (mode === "start-end-frame" && counts.image < 2) {
    return `Start/End Frame needs two image inputs. Current image edges: ${counts.image}.`;
  }
  if (mode === "upscale-video" && counts.video < 1) {
    return "Upscale Video needs a Flow-generated video input.";
  }
  return null;
}

export function RetargetModelsModal({ isOpen, onClose }: RetargetModelsModalProps) {
  const {
    nodes,
    edges,
    providerSettings,
    updateNodeData,
    incrementModalCount,
    decrementModalCount,
  } = useWorkflowStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
      providerSettings: state.providerSettings,
      updateNodeData: state.updateNodeData,
      incrementModalCount: state.incrementModalCount,
      decrementModalCount: state.decrementModalCount,
    }))
  );
  const { show: showToast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [issues, setIssues] = useState<ModelRetargetIssue[]>([]);
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [flowSelections, setFlowSelections] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    incrementModalCount();
    return () => decrementModalCount();
  }, [isOpen, incrementModalCount, decrementModalCount]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    async function scan() {
      setIsLoading(true);
      const envStatus = await fetchModelRetargetEnvStatus();
      if (cancelled) return;

      const nextIssues = scanWorkflowForModelRetargets(nodes, providerSettings, envStatus);
      setIssues(nextIssues);
      setSkipped((current) => {
        const next: Record<string, boolean> = {};
        for (const issue of nextIssues) next[issue.nodeId] = current[issue.nodeId] ?? false;
        return next;
      });
      setFlowSelections((current) => {
        const next: Record<string, string> = {};
        for (const issue of nextIssues) {
          if (issue.mediaType === "video") {
            next[issue.nodeId] = current[issue.nodeId] || FLOW_MODELS[0].id;
          }
        }
        return next;
      });
      setIsLoading(false);
    }

    scan();
    return () => {
      cancelled = true;
    };
  }, [isOpen, nodes, providerSettings]);

  const applicableIssueIds = useMemo(() => {
    return issues
      .filter((issue) => {
        if (skipped[issue.nodeId]) return false;
        if (issue.action === "clear-fallback") return true;
        if (issue.mediaType === "image") return issue.imageTargetAvailable;
        return issue.flowTargetAvailable;
      })
      .map((issue) => issue.nodeId);
  }, [issues, skipped]);

  const handleApply = useCallback(() => {
    let applied = 0;

    for (const issue of issues) {
      if (!applicableIssueIds.includes(issue.nodeId)) continue;
      const node = nodes.find((candidate) => candidate.id === issue.nodeId);
      if (!node) continue;
      const patch = buildModelRetargetPatch(node, issue, {
        flowModelId: flowSelections[issue.nodeId],
      });
      if (!patch) continue;

      updateNodeData(issue.nodeId, patch as Partial<WorkflowNodeData>);
      applied += 1;
    }

    if (applied > 0) {
      showToast(`Retargeted ${applied} model${applied === 1 ? "" : "s"}`, "success");
    }
    onClose();
  }, [applicableIssueIds, flowSelections, issues, nodes, onClose, showToast, updateNodeData]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-3xl max-h-[86vh] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-700 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-neutral-100">Retarget Models</h2>
            <p className="mt-1 text-xs text-neutral-400">
              Replace template models that need missing keys with your CCS/OpenAI-compatible image model or Google Flow video modes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-4 py-5 text-sm text-neutral-300">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent" />
              Scanning workflow models...
            </div>
          ) : issues.length === 0 ? (
            <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-5 text-sm text-neutral-300">
              No unavailable image or video models were found in this workflow.
            </div>
          ) : (
            <div className="space-y-3">
              {issues.map((issue) => {
                const isSkipped = skipped[issue.nodeId] ?? false;
                const unavailableTarget =
                  issue.action === "retarget-primary" &&
                  ((issue.mediaType === "image" && !issue.imageTargetAvailable) ||
                    (issue.mediaType === "video" && !issue.flowTargetAvailable));
                const selectedFlowModelId = flowSelections[issue.nodeId] || FLOW_MODELS[0].id;
                const warning =
                  issue.mediaType === "video" && !isSkipped
                    ? flowModeWarning(selectedFlowModelId, issue.nodeId, edges)
                    : null;

                return (
                  <div
                    key={issue.nodeId}
                    className={`rounded-md border px-4 py-3 ${
                      isSkipped ? "border-neutral-800 bg-neutral-950/70 opacity-70" : "border-neutral-700 bg-neutral-950"
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-neutral-100">{issue.nodeLabel}</span>
                          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                            {issue.mediaType}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-neutral-400">Current: {modelLabel(issue)}</p>
                        {issue.primaryReason && (
                          <p className="mt-1 text-xs text-red-300">Primary: {issue.primaryReason}</p>
                        )}
                        {issue.fallbackReason && (
                          <p className="mt-1 text-xs text-amber-300">
                            Fallback {fallbackLabel(issue) ? `(${fallbackLabel(issue)})` : ""}: {issue.fallbackReason}
                          </p>
                        )}
                      </div>

                      <label className="flex shrink-0 items-center gap-2 text-xs text-neutral-300">
                        <input
                          type="checkbox"
                          checked={isSkipped}
                          onChange={(event) =>
                            setSkipped((current) => ({ ...current, [issue.nodeId]: event.target.checked }))
                          }
                          className="h-3.5 w-3.5 accent-neutral-300"
                        />
                        Skip
                      </label>
                    </div>

                    <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-900/70 p-3">
                      {issue.action === "clear-fallback" ? (
                        <p className="text-xs text-neutral-200">Action: clear unavailable fallback model.</p>
                      ) : issue.mediaType === "image" ? (
                        <div className="text-xs">
                          <p className="text-neutral-200">Target: {CCS_OPENAI_IMAGE_MODEL.displayName}</p>
                          {!issue.imageTargetAvailable && (
                            <p className="mt-1 text-red-300">
                              OpenAI/CCS-compatible API key is not configured, so this image node cannot be retargeted yet.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <label className="block text-xs text-neutral-300">
                            <span className="mb-1 block text-neutral-400">Flow mode</span>
                            <select
                              value={selectedFlowModelId}
                              disabled={isSkipped || !issue.flowTargetAvailable}
                              onChange={(event) =>
                                setFlowSelections((current) => ({ ...current, [issue.nodeId]: event.target.value }))
                              }
                              className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
                            >
                              {FLOW_MODELS.map((model) => (
                                <option key={model.id} value={model.id}>
                                  {model.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          {!issue.flowTargetAvailable && (
                            <p className="text-xs text-red-300">Google Flow is disabled or unavailable.</p>
                          )}
                          {warning && <p className="text-xs text-amber-300">{warning}</p>}
                        </div>
                      )}
                    </div>

                    {unavailableTarget && !isSkipped && (
                      <p className="mt-2 text-xs text-red-300">This row will be skipped until its target provider is configured.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-neutral-700 px-5 py-4">
          <p className="text-xs text-neutral-500">
            {issues.length > 0
              ? `${applicableIssueIds.length} row${applicableIssueIds.length === 1 ? "" : "s"} ready to apply`
              : "Workflow is already compatible with configured providers"}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-2 text-sm text-neutral-400 hover:text-neutral-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={isLoading || applicableIssueIds.length === 0}
              className="rounded bg-white px-3 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply Retarget
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
