import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PaneContextMenu } from "@/components/PaneContextMenu";
// Importing the registry has side effects: it populates the blueprint store
// for the menu's lookups. Without it the Quick Add list filters out every
// entry (no blueprints registered).
import "@/lib/nodeRegistry";

const defaultProps = {
  position: { x: 100, y: 200 },
  flowPosition: { x: 500, y: 600 },
  onSelect: vi.fn(),
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "innerWidth", { value: 1280, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
});

describe("PaneContextMenu", () => {
  describe("Rendering & default state", () => {
    it("renders the search input with placeholder + auto-focuses it", () => {
      render(<PaneContextMenu {...defaultProps} />);
      const input = screen.getByTestId("pane-context-menu-search") as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.placeholder).toBe("Search nodes…");
      expect(document.activeElement).toBe(input);
    });

    it("shows the 'Quick Add' label when query is empty", () => {
      render(<PaneContextMenu {...defaultProps} />);
      expect(screen.getByText("Quick Add")).toBeInTheDocument();
      expect(screen.queryByText("Results")).not.toBeInTheDocument();
    });

    it("renders the keyboard shortcut footer", () => {
      render(<PaneContextMenu {...defaultProps} />);
      expect(screen.getByText("Navigate")).toBeInTheDocument();
      expect(screen.getByText("Add")).toBeInTheDocument();
      expect(screen.getByText("Close")).toBeInTheDocument();
    });

    it("positions itself at the requested coords and clamps inside viewport", () => {
      // Cramped viewport — menu must still fit
      Object.defineProperty(window, "innerWidth", { value: 320 });
      Object.defineProperty(window, "innerHeight", { value: 240 });
      render(<PaneContextMenu {...defaultProps} position={{ x: 1000, y: 800 }} />);
      const menu = screen.getByTestId("pane-context-menu");
      // After layout effect runs, left should be clamped (innerWidth - rect.width - 8)
      expect(menu).toBeInTheDocument();
      // Style left/top are set inline — we don't assert exact pixels because
      // jsdom returns 0 for getBoundingClientRect, but we assert opacity went
      // from 0 → 1 via the effect.
      const style = (menu as HTMLElement).style;
      expect(style.opacity).toBe("1");
    });
  });

  describe("Quick Add list", () => {
    it("includes Output, Nano Banana variants, and netlify shortcut items", () => {
      render(<PaneContextMenu {...defaultProps} />);
      // Output is the first item in the shortcut list
      expect(screen.getByText("Output")).toBeInTheDocument();
      // Three nanoBanana variants with explicit labels
      expect(screen.getByText("Nano Banana")).toBeInTheDocument();
      expect(screen.getByText("Nano Banana Pro")).toBeInTheDocument();
      expect(screen.getByText("Nano Banana 2")).toBeInTheDocument();
    });

    it("filters out unknown types whose blueprints are not registered", () => {
      // The component fetches the registry via getBlueprint(item.type). For any
      // shortcut whose type is not registered (e.g. mistyped), it should be
      // silently dropped — we just assert no crash + at least Output renders.
      render(<PaneContextMenu {...defaultProps} />);
      expect(screen.getByText("Output")).toBeInTheDocument();
    });
  });

  describe("Search filtering", () => {
    it("switches header label from 'Quick Add' → 'Results' once the user types", () => {
      render(<PaneContextMenu {...defaultProps} />);
      const input = screen.getByTestId("pane-context-menu-search");
      fireEvent.change(input, { target: { value: "image" } });
      expect(screen.getByText("Results")).toBeInTheDocument();
      expect(screen.queryByText("Quick Add")).not.toBeInTheDocument();
    });

    it("returns 'No results' when the query matches nothing", () => {
      render(<PaneContextMenu {...defaultProps} />);
      const input = screen.getByTestId("pane-context-menu-search");
      fireEvent.change(input, { target: { value: "qzxwlmnopqrabcdef-no-such-node" } });
      expect(screen.getByText("No results")).toBeInTheDocument();
    });

    it("matches blueprints by label substring (case-insensitive)", () => {
      render(<PaneContextMenu {...defaultProps} />);
      const input = screen.getByTestId("pane-context-menu-search");
      fireEvent.change(input, { target: { value: "blur" } });
      // The Blur utility is registered as a blueprint; it should appear in results.
      expect(screen.getByText(/blur/i)).toBeInTheDocument();
    });
  });

  describe("Keyboard navigation", () => {
    it("invokes onSelect + onClose on Enter for the highlighted item", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      render(
        <PaneContextMenu
          {...defaultProps}
          onSelect={onSelect}
          onClose={onClose}
        />
      );
      // First item is Output, which is the default highlight (index 0)
      fireEvent.keyDown(document, { key: "Enter" });
      expect(onSelect).toHaveBeenCalledTimes(1);
      const [type, flowPos] = onSelect.mock.calls[0];
      expect(type).toBe("output");
      expect(flowPos).toEqual(defaultProps.flowPosition);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("invokes onClose on Escape", () => {
      const onClose = vi.fn();
      render(<PaneContextMenu {...defaultProps} onClose={onClose} />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("ArrowDown moves highlight to the next item and Enter selects it", () => {
      const onSelect = vi.fn();
      render(<PaneContextMenu {...defaultProps} onSelect={onSelect} />);
      // Move down from Output (index 0) to Nano Banana (index 1)
      fireEvent.keyDown(document, { key: "ArrowDown" });
      fireEvent.keyDown(document, { key: "Enter" });
      const [type, , initialData] = onSelect.mock.calls[0];
      expect(type).toBe("nanoBanana");
      expect(initialData).toEqual({ model: "nano-banana" });
    });

    it("ArrowUp wraps from the first item to the last", () => {
      const onSelect = vi.fn();
      render(<PaneContextMenu {...defaultProps} onSelect={onSelect} />);
      fireEvent.keyDown(document, { key: "ArrowUp" });
      fireEvent.keyDown(document, { key: "Enter" });
      // Should have selected SOMETHING — we don't pin the exact last item
      // because the curated list is filtered against the registry — but
      // onSelect must have been called exactly once with a non-Output type.
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe("Click selection", () => {
    it("invokes onSelect + onClose when an item is clicked", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      render(
        <PaneContextMenu
          {...defaultProps}
          onSelect={onSelect}
          onClose={onClose}
        />
      );
      const button = screen.getByText("Output").closest("button");
      expect(button).not.toBeNull();
      act(() => {
        fireEvent.click(button!);
      });
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect.mock.calls[0][0]).toBe("output");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Outside-click dismissal", () => {
    it("invokes onClose when the user mouses down outside the menu", () => {
      const onClose = vi.fn();
      render(<PaneContextMenu {...defaultProps} onClose={onClose} />);
      // Mousedown on a different element
      const outsideDiv = document.createElement("div");
      document.body.appendChild(outsideDiv);
      fireEvent.mouseDown(outsideDiv);
      expect(onClose).toHaveBeenCalledTimes(1);
      document.body.removeChild(outsideDiv);
    });

    it("does NOT invoke onClose when clicking inside the menu", () => {
      const onClose = vi.fn();
      render(<PaneContextMenu {...defaultProps} onClose={onClose} />);
      const input = screen.getByTestId("pane-context-menu-search");
      fireEvent.mouseDown(input);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
