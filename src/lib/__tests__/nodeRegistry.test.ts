import { describe, expect, it } from "vitest";
import {
  getBlueprint,
  getBlueprintDefaults,
  getBlueprintHandles,
  getBlueprintMenuCategories,
  getBlueprintOutput,
} from "@/lib/nodeRegistry";
import type { WorkflowNode } from "@/types";

describe("nodeRegistry", () => {
  it("registers X-Node utility blueprints in the Utility menu", () => {
    const utility = getBlueprintMenuCategories().find((category) => category.label === "Utility");
    const types = utility?.nodes.map((node) => node.type) ?? [];

    expect(types).toContain("textSplitter");
    expect(types).toContain("maskPainter");
    expect(types).toContain("mediaDownload");
    expect(types as string[]).not.toContain("dropboxUpload");
    expect(types as string[]).not.toContain("cloudinaryUpload");
  });

  it("provides defaults and handles for new utility nodes", () => {
    expect(getBlueprint("blur")?.label).toBe("Blur");
    expect(getBlueprintDefaults("blur")).toMatchObject({
      sourceImage: null,
      outputImage: null,
      radius: 12,
      status: "idle",
    });
    expect(getBlueprintHandles("compositor")).toEqual({
      inputs: ["image", "image-1", "mask"],
      outputs: ["image"],
    });
  });

  it("resolves dynamic text splitter output handles", () => {
    const node = {
      id: "splitter-1",
      type: "textSplitter",
      position: { x: 0, y: 0 },
      data: {
        inputText: "a\nb",
        delimiter: "\n",
        trimItems: true,
        removeEmpty: true,
        maxOutputs: 10,
        outputItems: ["a", "b"],
        outputText: "a\nb",
        status: "complete",
        error: null,
      },
    } as WorkflowNode;

    expect(getBlueprintOutput(node, "text-1")).toEqual({ type: "text", value: "b" });
    expect(getBlueprintOutput(node, "text")).toEqual({ type: "text", value: "a\nb" });
  });
});
