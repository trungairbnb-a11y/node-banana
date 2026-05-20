import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FloatingActionBar } from "@/components/FloatingActionBar";
import { ReactFlowProvider } from "@xyflow/react";
import { ProviderSettings } from "@/types";

// Mock the workflow store
const mockAddNode = vi.fn();
const mockExecuteWorkflow = vi.fn();
const mockRegenerateNode = vi.fn();
const mockExecuteSelectedNodes = vi.fn();
const mockStopWorkflow = vi.fn();
const mockValidateWorkflow = vi.fn();
const mockSetEdgeStyle = vi.fn();
const mockSetModelSearchOpen = vi.fn();
const mockCreateImageInputBoard = vi.fn();
const mockUseWorkflowStore = vi.fn();

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector?: (state: unknown) => unknown) => {
    if (selector) {
      return mockUseWorkflowStore(selector);
    }
    return mockUseWorkflowStore((s: unknown) => s);
  },
}));

// Mock useReactFlow
const mockScreenToFlowPosition = vi.fn((pos) => pos);
const mockGetNodes = vi.fn(() => []);

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({
      screenToFlowPosition: mockScreenToFlowPosition,
      getNodes: mockGetNodes,
    }),
  };
});

// Mock ModelSearchDialog
vi.mock("@/components/modals/ModelSearchDialog", () => ({
  ModelSearchDialog: ({ isOpen, onClose, initialProvider }: { isOpen: boolean; onClose: () => void; initialProvider?: string }) => (
    isOpen ? (
      <div data-testid="model-search-dialog" data-provider={initialProvider}>
        Model Search Dialog
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
  ),
}));

// Mock fetch for env-status
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Wrapper component for React Flow context
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

// Default provider settings
const defaultProviderSettings: ProviderSettings = {
  providers: {
    gemini: { id: "gemini", name: "Gemini", enabled: true, apiKey: null, apiKeyEnvVar: "GEMINI_API_KEY" },
    openai: { id: "openai", name: "OpenAI", enabled: false, apiKey: null },
    replicate: { id: "replicate", name: "Replicate", enabled: false, apiKey: null },
    fal: { id: "fal", name: "fal.ai", enabled: true, apiKey: null },
    kie: { id: "kie", name: "Kie.ai", enabled: false, apiKey: null },
    wavespeed: { id: "wavespeed", name: "WaveSpeed", enabled: false, apiKey: null },
  },
};

// Default store state factory
const createDefaultState = (overrides = {}) => ({
  nodes: [],
  isRunning: false,
  currentNodeIds: [],
  executeWorkflow: mockExecuteWorkflow,
  regenerateNode: mockRegenerateNode,
  executeSelectedNodes: mockExecuteSelectedNodes,
  stopWorkflow: mockStopWorkflow,
  validateWorkflow: mockValidateWorkflow,
  edgeStyle: "angular" as const,
  setEdgeStyle: mockSetEdgeStyle,
  setModelSearchOpen: mockSetModelSearchOpen,
  modelSearchOpen: false,
  modelSearchProvider: null,
  addNode: mockAddNode,
  createImageInputBoard: mockCreateImageInputBoard,
  ...overrides,
});

describe("FloatingActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateWorkflow.mockReturnValue({ valid: true, errors: [] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ gemini: true, openai: false, replicate: false }),
    });

    // Default mock implementation
    mockUseWorkflowStore.mockImplementation((selector) => {
      return selector(createDefaultState());
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic Rendering", () => {
    it("should render node type buttons", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Image")).toBeInTheDocument();
        expect(screen.getByText("Prompt")).toBeInTheDocument();
        expect(screen.getByText("Generate")).toBeInTheDocument();
        expect(screen.getByText("Utility")).toBeInTheDocument();
        expect(screen.getByText("Network")).toBeInTheDocument();
        expect(screen.getByText("Run")).toBeInTheDocument();
        expect(screen.getByTitle("Browse fal.ai models")).toBeInTheDocument();
        expect(screen.queryByText("Inputs")).not.toBeInTheDocument();
        expect(screen.queryByText("All nodes")).not.toBeInTheDocument();
        expect(screen.queryByText("All models")).not.toBeInTheDocument();
      });
    });

    it("should keep the old Inputs quick action out of the X-Node toolbar", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.queryByText("Inputs")).not.toBeInTheDocument();
      });

      expect(mockCreateImageInputBoard).not.toHaveBeenCalled();
    });

    it("should render Generate combo button", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Generate")).toBeInTheDocument();
      });
    });

    it("should render Run button", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Run")).toBeInTheDocument();
      });
    });

    it("should render edge style toggle button", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Switch to curved connectors")).toBeInTheDocument();
      });
    });
  });

  describe("Node Button Click", () => {
    it("should call addNode when Image button is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Image")).toBeInTheDocument();
      });

      const imageButton = screen.getByText("Image");
      fireEvent.click(imageButton);

      expect(mockAddNode).toHaveBeenCalledWith("imageInput", expect.any(Object));
    });

    it("should call addNode when Prompt button is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Prompt")).toBeInTheDocument();
      });

      const promptButton = screen.getByText("Prompt");
      fireEvent.click(promptButton);

      expect(mockAddNode).toHaveBeenCalledWith("prompt", expect.any(Object));
    });

    it("should add Output from the Utility menu", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Utility")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Utility"));
      const outputButton = screen.getByText("Output");
      fireEvent.click(outputButton);

      expect(mockAddNode).toHaveBeenCalledWith("output", expect.any(Object));
    });
  });

  describe("Node Button Drag", () => {
    it("should set dataTransfer with node type on drag start", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Image")).toBeInTheDocument();
      });

      const imageButton = screen.getByText("Image");

      const mockDataTransfer = {
        setData: vi.fn(),
        effectAllowed: "",
      };

      fireEvent.dragStart(imageButton, {
        dataTransfer: mockDataTransfer,
      });

      expect(mockDataTransfer.setData).toHaveBeenCalledWith("application/node-type", "imageInput");
      expect(mockDataTransfer.effectAllowed).toBe("copy");
    });

    it("should set dataTransfer with prompt type on drag", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Prompt")).toBeInTheDocument();
      });

      const promptButton = screen.getByText("Prompt");

      const mockDataTransfer = {
        setData: vi.fn(),
        effectAllowed: "",
      };

      fireEvent.dragStart(promptButton, {
        dataTransfer: mockDataTransfer,
      });

      expect(mockDataTransfer.setData).toHaveBeenCalledWith("application/node-type", "prompt");
    });
  });

  describe("Generate Combo Button", () => {
    it("should open dropdown menu when Generate button is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Generate")).toBeInTheDocument();
      });

      const generateButton = screen.getByText("Generate");
      fireEvent.click(generateButton);

      // Dropdown menu items should appear
      expect(screen.getByText("Image", { selector: "button.w-full" })).toBeInTheDocument();
      expect(screen.getByText("Video", { selector: "button.w-full" })).toBeInTheDocument();
      expect(screen.getByText("Text (LLM)")).toBeInTheDocument();
    });

    it("should add nanoBanana node when Image option is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Generate")).toBeInTheDocument();
      });

      // Open dropdown
      fireEvent.click(screen.getByText("Generate"));

      // Click Image option in dropdown
      const imageOption = screen.getByText("Image", { selector: "button.w-full" });
      fireEvent.click(imageOption);

      expect(mockAddNode).toHaveBeenCalledWith("nanoBanana", expect.any(Object));
    });

    it("should add kling26 node when Video option is clicked (mirrors netlify Generate menu)", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Generate")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Generate"));
      fireEvent.click(screen.getByText("Video", { selector: "button.w-full" }));

      expect(mockAddNode).toHaveBeenCalledWith("kling26", expect.any(Object));
    });

    it("should add llmGenerate node when Text (LLM) option is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Generate")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Generate"));
      fireEvent.click(screen.getByText("Text (LLM)"));

      expect(mockAddNode).toHaveBeenCalledWith("llmGenerate", expect.any(Object));
    });

    it("should close dropdown after selecting an option", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Generate")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Generate"));

      // Verify dropdown is open
      expect(screen.getByText("Video", { selector: "button.w-full" })).toBeInTheDocument();

      // Click an option
      fireEvent.click(screen.getByText("Video", { selector: "button.w-full" }));

      // Dropdown should close
      expect(screen.queryByText("Video", { selector: "button.w-full" })).not.toBeInTheDocument();
    });
  });

  describe("Browse Models Button", () => {
    it("should render the X-Node model icon button", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Browse fal.ai models")).toBeInTheDocument();
        expect(screen.queryByText("All models")).not.toBeInTheDocument();
      });
    });

    it("should open ModelSearchDialog when model icon button is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Browse fal.ai models")).toBeInTheDocument();
      });

      const browseButton = screen.getByTitle("Browse fal.ai models");
      fireEvent.click(browseButton);

      expect(mockSetModelSearchOpen).toHaveBeenCalledWith(true);
    });
  });

  describe("Network Menu", () => {
    it("should render Network shell button", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Network")).toBeInTheDocument();
      });
    });

    it("should open Network dropdown listing the five netlify entries", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Network")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Network"));

      expect(screen.getByText("Webhook Trigger")).toBeInTheDocument();
      expect(screen.getByText("Webhook Response")).toBeInTheDocument();
      expect(screen.getByText("Data Forward")).toBeInTheDocument();
      expect(screen.getByText("Dropbox Upload")).toBeInTheDocument();
      expect(screen.getByText("Cloudinary Upload")).toBeInTheDocument();
    });

    it("should add the corresponding X-Node node type when a Network entry is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Network")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Network"));
      const webhookButton = screen.getByText("Webhook Trigger").closest("button")!;

      expect(webhookButton).not.toBeDisabled();
      fireEvent.click(webhookButton);
      expect(mockAddNode).toHaveBeenCalledWith("webhookTrigger", expect.any(Object));
    });
  });

  describe("Utility Nodes Menu", () => {
    it("should render Utility button next to the quick node buttons", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Utility")).toBeInTheDocument();
      });
    });

    it("should open Utility dropdown when clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Utility")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Utility"));

      expect(screen.getByText("Output")).toBeInTheDocument();
      expect(screen.getByText("Split Grid")).toBeInTheDocument();
      expect(screen.getByText("Sticky Note")).toBeInTheDocument();
      expect(screen.getByText("Switch")).toBeInTheDocument();
      expect(screen.getByText("Text Splitter")).toBeInTheDocument();
      expect(screen.getByText("Media Download")).toBeInTheDocument();
      expect(screen.getByText("Audio Equalizer")).toBeInTheDocument();
      expect(screen.queryByText("Cloudinary Upload")).not.toBeInTheDocument();
    });

    it("should call addNode when a node is selected from Utility menu", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Utility")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Utility"));
      fireEvent.click(screen.getByText("Media Download"));

      expect(mockAddNode).toHaveBeenCalledWith("mediaDownload", expect.any(Object));
    });

    it("should close Utility dropdown after selection", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Utility")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Utility"));
      expect(screen.getByText("Text Splitter")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Text Splitter"));

      expect(screen.queryByText("Text Splitter")).not.toBeInTheDocument();
    });
  });

  describe("Edge Style Toggle", () => {
    it("should call setEdgeStyle with curved when currently angular", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Switch to curved connectors")).toBeInTheDocument();
      });

      const toggleButton = screen.getByTitle("Switch to curved connectors");
      fireEvent.click(toggleButton);

      expect(mockSetEdgeStyle).toHaveBeenCalledWith("curved");
    });

    it("should call setEdgeStyle with angular when currently curved", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          edgeStyle: "curved",
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Switch to angular connectors")).toBeInTheDocument();
      });

      const toggleButton = screen.getByTitle("Switch to angular connectors");
      fireEvent.click(toggleButton);

      expect(mockSetEdgeStyle).toHaveBeenCalledWith("angular");
    });
  });

  describe("Run Button", () => {
    it("should call executeWorkflow when Run button is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Run")).toBeInTheDocument();
      });

      const runButton = screen.getByText("Run");
      fireEvent.click(runButton);

      expect(mockExecuteWorkflow).toHaveBeenCalled();
    });

    it("should show Stop button when isRunning is true", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          isRunning: true,
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Stop")).toBeInTheDocument();
      });
    });

    it("should call stopWorkflow when Stop button is clicked", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          isRunning: true,
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Stop")).toBeInTheDocument();
      });

      const stopButton = screen.getByText("Stop");
      fireEvent.click(stopButton);

      expect(mockStopWorkflow).toHaveBeenCalled();
    });

    it("should disable Run button when workflow is invalid", async () => {
      mockValidateWorkflow.mockReturnValue({ valid: false, errors: ["No nodes"] });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText("Run")).toBeInTheDocument();
      });

      const runButton = screen.getByText("Run").closest("button");
      expect(runButton).toBeDisabled();
    });

    it("should show error message in title when workflow is invalid", async () => {
      mockValidateWorkflow.mockReturnValue({ valid: false, errors: ["Missing required nodes"] });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        const runButton = screen.getByText("Run").closest("button");
        expect(runButton).toHaveAttribute("title", "Missing required nodes");
      });
    });
  });

  describe("Run Menu Dropdown", () => {
    it("should show dropdown chevron when workflow is valid and not running", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });
    });

    it("should not show dropdown chevron when workflow is invalid", async () => {
      mockValidateWorkflow.mockReturnValue({ valid: false, errors: ["No nodes"] });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.queryByTitle("Run options")).not.toBeInTheDocument();
      });
    });

    it("should not show dropdown chevron when running", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          isRunning: true,
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.queryByTitle("Run options")).not.toBeInTheDocument();
      });
    });

    it("should open run menu when dropdown chevron is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));

      expect(screen.getByText("Run entire workflow")).toBeInTheDocument();
      expect(screen.getByText("Run from selected node")).toBeInTheDocument();
      expect(screen.getByText("Run selected node only")).toBeInTheDocument();
    });

    it("should call executeWorkflow when 'Run entire workflow' is clicked", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));
      fireEvent.click(screen.getByText("Run entire workflow"));

      expect(mockExecuteWorkflow).toHaveBeenCalled();
    });

    it("should disable 'Run from selected node' when no node is selected", async () => {
      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));

      const runFromSelectedButton = screen.getByText("Run from selected node").closest("button");
      expect(runFromSelectedButton).toHaveClass("cursor-not-allowed");
    });

    it("should enable 'Run from selected node' when a single node is selected", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          nodes: [{ id: "node-1", selected: true, type: "prompt" }],
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));

      const runFromSelectedButton = screen.getByText("Run from selected node").closest("button");
      expect(runFromSelectedButton).not.toHaveClass("cursor-not-allowed");
    });

    it("should call executeWorkflow with node id when 'Run from selected node' is clicked", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          nodes: [{ id: "node-1", selected: true, type: "prompt" }],
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));
      fireEvent.click(screen.getByText("Run from selected node"));

      expect(mockExecuteWorkflow).toHaveBeenCalledWith("node-1");
    });

    it("should call regenerateNode when 'Run selected node only' is clicked", async () => {
      mockUseWorkflowStore.mockImplementation((selector) => {
        return selector(createDefaultState({
          nodes: [{ id: "node-1", selected: true, type: "prompt" }],
        }));
      });

      render(
        <TestWrapper>
          <FloatingActionBar />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTitle("Run options")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Run options"));
      fireEvent.click(screen.getByText("Run selected node only"));

      expect(mockRegenerateNode).toHaveBeenCalledWith("node-1");
    });
  });
});
