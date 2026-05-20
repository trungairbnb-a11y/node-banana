import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { StickyNoteNode } from "../StickyNoteNode";
import { useWorkflowStore } from "@/store/workflowStore";
import type { StickyNoteNodeData, WorkflowNode } from "@/types";

const renderNode = (data: Partial<StickyNoteNodeData> = {}, selected = false) => {
  const fullData: StickyNoteNodeData = {
    text: "",
    fontSize: 16,
    color: "neutral",
    ...data,
  };
  return render(
    <ReactFlowProvider>
      <StickyNoteNode
        id="sticky-1"
        type="stickyNote"
        data={fullData as WorkflowNode["data"]}
        selected={selected}
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        dragging={false}
        draggable
        deletable
        selectable
      />
    </ReactFlowProvider>
  );
};

describe("StickyNoteNode", () => {
  beforeEach(() => {
    useWorkflowStore.setState({ nodes: [], edges: [] });
  });

  it("renders the textarea with current text and font size", () => {
    renderNode({ text: "hello", fontSize: 24, color: "blue" });
    const textarea = screen.getByPlaceholderText("Write a note...") as HTMLTextAreaElement;
    expect(textarea.value).toBe("hello");
    expect(textarea.style.fontSize).toBe("24px");
    expect(screen.getByText("24")).toBeInTheDocument();
  });

  it("calls updateNodeData when the text changes", () => {
    const updateNodeData = vi.fn();
    useWorkflowStore.setState({ updateNodeData });
    renderNode({ text: "" });
    fireEvent.change(screen.getByPlaceholderText("Write a note..."), {
      target: { value: "new note" },
    });
    expect(updateNodeData).toHaveBeenCalledWith("sticky-1", { text: "new note" });
  });

  it("bumps font size up and down within the 8..72 range", () => {
    const updateNodeData = vi.fn();
    useWorkflowStore.setState({ updateNodeData });
    renderNode({ fontSize: 16 });

    // "+" is the second titled icon button
    fireEvent.click(screen.getByTitle("Increase font size"));
    fireEvent.click(screen.getByTitle("Decrease font size"));
    expect(updateNodeData).toHaveBeenCalledWith("sticky-1", { fontSize: 18 });
    expect(updateNodeData).toHaveBeenCalledWith("sticky-1", { fontSize: 14 });
  });

  it("clamps font size at the upper bound (72)", () => {
    const updateNodeData = vi.fn();
    useWorkflowStore.setState({ updateNodeData });
    renderNode({ fontSize: 72 });
    fireEvent.click(screen.getByTitle("Increase font size"));
    expect(updateNodeData).toHaveBeenCalledWith("sticky-1", { fontSize: 72 });
  });

  it("clamps font size at the lower bound (8)", () => {
    const updateNodeData = vi.fn();
    useWorkflowStore.setState({ updateNodeData });
    renderNode({ fontSize: 8 });
    fireEvent.click(screen.getByTitle("Decrease font size"));
    expect(updateNodeData).toHaveBeenCalledWith("sticky-1", { fontSize: 8 });
  });

  it("opens the color picker and applies a new color", () => {
    const updateNodeData = vi.fn();
    useWorkflowStore.setState({ updateNodeData });
    renderNode({ color: "neutral" });

    fireEvent.click(screen.getByTitle("Change color"));
    fireEvent.click(screen.getByTitle("Blue"));
    expect(updateNodeData).toHaveBeenCalledWith("sticky-1", { color: "blue" });
  });
});
