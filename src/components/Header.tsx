"use client";

import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWorkflowStore } from "@/store/workflowStore";
import { useShallow } from "zustand/shallow";
import { ProjectSetupModal } from "./ProjectSetupModal";
import { CostIndicator } from "./CostIndicator";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { WorkflowBrowserModal } from "./WorkflowBrowserModal";
import { RetargetModelsModal } from "./modals/RetargetModelsModal";
import { fetchModelRetargetEnvStatus, scanWorkflowForModelRetargets } from "@/lib/modelRetargeting";

function IconButton({
  title,
  onClick,
  children,
  disabled = false,
}: {
  title: string;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function CommentsNavigationIcon() {
  const nodes = useWorkflowStore((state) => state.nodes);
  const getNodesWithComments = useWorkflowStore((state) => state.getNodesWithComments);
  const viewedCommentNodeIds = useWorkflowStore((state) => state.viewedCommentNodeIds);
  const markCommentViewed = useWorkflowStore((state) => state.markCommentViewed);
  const setNavigationTarget = useWorkflowStore((state) => state.setNavigationTarget);

  const nodesWithComments = useMemo(() => getNodesWithComments(), [getNodesWithComments, nodes]);
  const unviewedCount = useMemo(
    () => nodesWithComments.filter((node) => !viewedCommentNodeIds.has(node.id)).length,
    [nodesWithComments, viewedCommentNodeIds]
  );

  if (nodesWithComments.length === 0) return null;

  const handleClick = () => {
    const targetNode = nodesWithComments.find((node) => !viewedCommentNodeIds.has(node.id)) || nodesWithComments[0];
    if (!targetNode) return;
    markCommentViewed(targetNode.id);
    setNavigationTarget(targetNode.id);
  };

  return (
    <button
      onClick={handleClick}
      className="relative p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
      title={`${unviewedCount} unviewed comment${unviewedCount !== 1 ? "s" : ""} (${nodesWithComments.length} total)`}
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0 1 12 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 0 1-3.476.383.39.39 0 0 0-.297.17l-2.755 4.133a.75.75 0 0 1-1.248 0l-2.755-4.133a.39.39 0 0 0-.297-.17 48.9 48.9 0 0 1-3.476-.384C2.87 16.439 1.5 14.705 1.5 12.759V6.741c0-1.946 1.37-3.68 3.348-3.97Z" clipRule="evenodd" />
      </svg>
      {unviewedCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold text-white bg-blue-500 rounded-full px-0.5">
          {unviewedCount > 9 ? "9+" : unviewedCount}
        </span>
      )}
    </button>
  );
}

export function Header() {
  const {
    workflowName,
    workflowId,
    saveDirectoryPath,
    hasUnsavedChanges,
    lastSavedAt,
    isSaving,
    setWorkflowMetadata,
    saveToFile,
    loadWorkflow,
    previousWorkflowSnapshot,
    revertToSnapshot,
    shortcutsDialogOpen,
    setShortcutsDialogOpen,
    setShowQuickstart,
  } = useWorkflowStore(useShallow((state) => ({
    workflowName: state.workflowName,
    workflowId: state.workflowId,
    saveDirectoryPath: state.saveDirectoryPath,
    hasUnsavedChanges: state.hasUnsavedChanges,
    lastSavedAt: state.lastSavedAt,
    isSaving: state.isSaving,
    setWorkflowMetadata: state.setWorkflowMetadata,
    saveToFile: state.saveToFile,
    loadWorkflow: state.loadWorkflow,
    previousWorkflowSnapshot: state.previousWorkflowSnapshot,
    revertToSnapshot: state.revertToSnapshot,
    shortcutsDialogOpen: state.shortcutsDialogOpen,
    setShortcutsDialogOpen: state.setShortcutsDialogOpen,
    setShowQuickstart: state.setShowQuickstart,
  })));

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectModalMode, setProjectModalMode] = useState<"new" | "settings">("new");
  const [showWorkflowBrowser, setShowWorkflowBrowser] = useState(false);
  const [showRetargetModels, setShowRetargetModels] = useState(false);

  const isProjectConfigured = !!workflowName;
  const canSave = !!(workflowId && workflowName && saveDirectoryPath);

  const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const handleNewProject = () => {
    setProjectModalMode("new");
    setShowProjectModal(true);
  };

  const handleOpenSettings = () => {
    setProjectModalMode("settings");
    setShowProjectModal(true);
  };

  const handleProjectSave = async (id: string, name: string, path: string) => {
    setWorkflowMetadata(id, name, path);
    setShowProjectModal(false);
    setTimeout(() => {
      saveToFile().catch((error) => {
        console.error("Failed to save project:", error);
        alert("Failed to save project. Please try again.");
      });
    }, 50);
  };

  const handleOpenDirectory = async () => {
    if (!saveDirectoryPath) return;
    try {
      const response = await fetch("/api/open-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: saveDirectoryPath }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        alert(`Failed to open project folder: ${result.error || "Unknown error"}`);
      }
    } catch {
      alert("Failed to open project folder. Please try again.");
    }
  };

  const openRetargetModalIfNeeded = useCallback(async () => {
    const envStatus = await fetchModelRetargetEnvStatus();
    const state = useWorkflowStore.getState();
    const issues = scanWorkflowForModelRetargets(state.nodes, state.providerSettings, envStatus);
    if (issues.length > 0) setShowRetargetModels(true);
  }, []);

  const handleRevertAIChanges = useCallback(() => {
    if (window.confirm("Are you sure? This will restore your previous workflow.")) {
      revertToSnapshot();
    }
  }, [revertToSnapshot]);

  const saveTitle = isSaving ? "Saving..." : canSave ? "Save project" : isProjectConfigured ? "Configure save location" : "Save project";
  const saveStatus = isProjectConfigured
    ? isSaving
      ? "Saving..."
      : lastSavedAt
        ? `Saved ${formatTime(lastSavedAt)}`
        : "Not saved"
    : "Not saved";

  const saveClick = () => {
    if (isSaving) return;
    if (canSave) {
      saveToFile();
    } else if (isProjectConfigured) {
      handleOpenSettings();
    } else {
      handleNewProject();
    }
  };

  return (
    <>
      <ProjectSetupModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onSave={handleProjectSave}
        mode={projectModalMode}
      />
      <WorkflowBrowserModal
        isOpen={showWorkflowBrowser}
        onClose={() => setShowWorkflowBrowser(false)}
        onWorkflowLoaded={async (workflow, dirPath) => {
          setShowWorkflowBrowser(false);
          await loadWorkflow(workflow, dirPath);
          await openRetargetModalIfNeeded();
        }}
      />
      <RetargetModelsModal isOpen={showRetargetModels} onClose={() => setShowRetargetModels(false)} />
      <header className="h-10 bg-[#151515] border-b border-neutral-800 flex items-center justify-between shrink-0">
        <div className="flex h-full items-center">
          <button
            onClick={() => setShowQuickstart?.(true)}
            title="Open welcome screen"
            className="flex h-full items-center gap-2 px-3 hover:bg-neutral-900/70 transition-colors"
          >
            <img src="/banana_icon.png" alt="Banana" className="w-6 h-6" />
            <span className="text-[23px] font-semibold tracking-tight text-neutral-100">X-Node</span>
            <span className="sr-only">Node Banana</span>
          </button>

          <div className="flex h-full items-center gap-2 border-l border-neutral-700 px-4">
            <span className="max-w-[180px] truncate text-sm italic text-neutral-500">
              {workflowName || "Untitled"}
            </span>
            {isProjectConfigured && (
              <span className="sr-only"><CostIndicator /></span>
            )}
            <span className="sr-only">{saveStatus}</span>

            <div className="flex items-center gap-0.5 border-l border-neutral-700/50 pl-3">
              <button
                onClick={saveClick}
                disabled={isSaving}
                title={saveTitle}
                data-tutorial="save-button"
                className="relative flex items-center gap-1 px-2 py-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-l transition-colors disabled:opacity-50"
              >
                <span className="text-xs">Save</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 20.25h15m-12-9 4.5 4.5m0 0 4.5-4.5m-4.5 4.5V3.75" />
                </svg>
                {((!isProjectConfigured && !isSaving) || (hasUnsavedChanges && !isSaving)) && (
                  <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-[#151515]" />
                )}
              </button>
              <button
                disabled
                title="More save options"
                className="p-1 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-r border-l border-neutral-700 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                </svg>
              </button>
              <button
                onClick={() => setShowWorkflowBrowser(true)}
                title="Open project"
                className="flex items-center gap-1 px-2 py-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
              >
                <span className="text-xs">Open</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v6.75A2.25 2.25 0 0 1 19.5 21H4.5A2.25 2.25 0 0 1 2.25 18.75v-6Zm9.19-6.44-2.12-2.12a1.5 1.5 0 0 0-1.06-.44H4.5A2.25 2.25 0 0 0 2.25 6v6" />
                </svg>
              </button>
              {saveDirectoryPath && (
                <IconButton title="Open Project Folder" onClick={handleOpenDirectory}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h6l2 2h8.5v11.5h-16.5V5.25Z" />
                  </svg>
                </IconButton>
              )}
              <IconButton title="Project settings" onClick={handleOpenSettings}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h3l.7 2.1 2 .8 2-1 2.1 2.1-1 2 .8 2 2.1.7v3h-2.1l-.8 2 1 2-2.1 2.1-2-1-2 .8-.7 2.1h-3l-.7-2.1-2-.8-2 1-2.1-2.1 1-2-.8-2H1.5v-3l2.1-.7.8-2-1-2 2.1-2.1 2 1 2-.8.7-2.1Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z" />
                </svg>
              </IconButton>
              <IconButton title="Prompt Library (Ctrl+Shift+P)" onClick={() => setShortcutsDialogOpen?.(true)}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5A2.5 2.5 0 0 1 7 17h12M4.5 4.5A2.5 2.5 0 0 1 7 2h12v20H7a2.5 2.5 0 0 1-2.5-2.5v-15Z" />
                </svg>
              </IconButton>
              <IconButton title="Home" onClick={() => setShowQuickstart?.(true)}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m3 10.5 9-7 9 7M5 9.5V21h14V9.5M9 21v-6h6v6" />
                </svg>
              </IconButton>
              <IconButton title="Retarget Models" onClick={() => setShowRetargetModels(true)}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h10m0 0-3-3m3 3-3 3M17 17H7m0 0 3 3m-3-3 3-3" />
                </svg>
              </IconButton>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 text-xs">
          {previousWorkflowSnapshot && (
            <button
              onClick={handleRevertAIChanges}
              className="px-2.5 py-1.5 text-xs text-neutral-300 hover:text-neutral-100 bg-neutral-700/50 hover:bg-neutral-700 border border-neutral-600 rounded transition-colors"
              title="Restore workflow from before AI changes"
            >
              Revert AI Changes
            </button>
          )}
          <CommentsNavigationIcon />
          <a href="https://x.com/ReflctWillie" target="_blank" rel="noopener noreferrer" className="sr-only">
            Made by Willie
          </a>
          <button onClick={() => setShortcutsDialogOpen?.(true)} className="sr-only" title="Keyboard shortcuts (?)">
            Keyboard shortcuts
          </button>
          <a
            href="https://discord.com/invite/89Nr6EKkTf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-400 hover:text-neutral-200 transition-colors"
            title="Support"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03Z" />
            </svg>
          </a>
          <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="text-neutral-400 hover:text-neutral-200 transition-colors" title="X">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817-5.966 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
            </svg>
          </a>
        </div>
      </header>
      <KeyboardShortcutsDialog isOpen={Boolean(shortcutsDialogOpen)} onClose={() => setShortcutsDialogOpen?.(false)} />
    </>
  );
}
