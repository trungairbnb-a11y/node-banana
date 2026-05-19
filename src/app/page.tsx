"use client";

import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Header } from "@/components/Header";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { FloatingActionBar } from "@/components/FloatingActionBar";
import { AnnotationModal } from "@/components/AnnotationModal";
import { useWorkflowStore } from "@/store/workflowStore";
import { FTUXModal } from "@/components/onboarding/FTUXModal";
import { FLOWBOARD_RESULT_KEY, getFTUXCompleted, setFTUXCompleted } from "@/store/utils/localStorage";
import { useFTUXStore } from "@/store/ftuxStore";
import type { GenerateVideoNodeData, WorkflowNode } from "@/types";

interface FlowboardResultPayload {
  id: string;
  videoUrl: string;
  modelId: string;
  modelName: string;
  prompt?: string;
  completedAt: number;
}

export default function Home() {
  const initializeAutoSave = useWorkflowStore(
    (state) => state.initializeAutoSave
  );
  const cleanupAutoSave = useWorkflowStore((state) => state.cleanupAutoSave);
  const setShowQuickstart = useWorkflowStore((state) => state.setShowQuickstart);
  const [showFTUX, setShowFTUX] = useState(false);

  useEffect(() => {
    initializeAutoSave();
    return () => cleanupAutoSave();
  }, [initializeAutoSave, cleanupAutoSave]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useWorkflowStore.getState().hasUnsavedChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    const applyFlowboardResult = (raw: string | null) => {
      if (!raw) return;
      let payload: FlowboardResultPayload;
      try {
        payload = JSON.parse(raw) as FlowboardResultPayload;
      } catch {
        return;
      }
      if (!payload.videoUrl || !payload.modelId) return;

      const store = useWorkflowStore.getState();
      const selectedNode = store.nodes.find(
        (node): node is WorkflowNode & { data: GenerateVideoNodeData } =>
          node.type === "generateVideo" && !!node.selected
      );
      const selectedModel = {
        provider: "flow" as const,
        modelId: payload.modelId,
        displayName: payload.modelName || "Google Flow",
      };
      const historyItem = {
        id: `${payload.id}-${payload.completedAt}`,
        timestamp: payload.completedAt || Date.now(),
        prompt: payload.prompt || "",
        model: payload.modelId,
      };

      if (selectedNode) {
        const currentData = selectedNode.data;
        store.updateNodeData(selectedNode.id, {
          selectedModel,
          inputPrompt: payload.prompt || currentData.inputPrompt || null,
          outputVideo: payload.videoUrl,
          status: "complete",
          error: null,
          videoHistory: [historyItem, ...(currentData.videoHistory || [])].slice(0, 50),
          selectedVideoHistoryIndex: 0,
        });
      } else {
        const rightMostX = store.nodes.reduce((max, node) => Math.max(max, node.position.x), 120);
        store.addNode("generateVideo", { x: rightMostX + 360, y: 140 }, {
          selectedModel,
          inputPrompt: payload.prompt || null,
          outputVideo: payload.videoUrl,
          status: "complete",
          error: null,
          videoHistory: [historyItem],
          selectedVideoHistoryIndex: 0,
        });
      }

      localStorage.removeItem(FLOWBOARD_RESULT_KEY);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === FLOWBOARD_RESULT_KEY) applyFlowboardResult(event.newValue);
    };

    window.addEventListener("storage", handleStorage);
    applyFlowboardResult(localStorage.getItem(FLOWBOARD_RESULT_KEY));
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Client-side only FTUX check (SSR-safe)
  useEffect(() => {
    if (!getFTUXCompleted()) {
      setShowFTUX(true);
    }
  }, []);

  const handleFTUXComplete = () => {
    setShowFTUX(false);
    setFTUXCompleted(true);
  };

  const handleStartTutorial = () => {
    setShowFTUX(false);
    setFTUXCompleted(true);
    setShowQuickstart(false); // Close WelcomeModal if open
    useFTUXStore.getState().startTutorial();
  };

  return (
    <ReactFlowProvider>
      <div className="h-screen flex flex-col">
        <Header />
        <WorkflowCanvas />
        <FloatingActionBar />
        <AnnotationModal />
        {showFTUX && (
          <FTUXModal
            onComplete={handleFTUXComplete}
            onStartTutorial={handleStartTutorial}
          />
        )}
      </div>
    </ReactFlowProvider>
  );
}
