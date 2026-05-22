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

describe("Utility menu order (netlify clone)", () => {
  it("matches the explicit X-Node Utility order exactly", async () => {
    const { getUtilityMenuItems, UTILITY_MENU_ORDER } = await import("@/lib/nodeRegistry");
    const items = getUtilityMenuItems();

    // 22 items mirroring https://dev-x-node.netlify.app/
    expect(items).toHaveLength(22);
    expect(items.map((i) => i.type)).toEqual([
      "output",
      "splitGrid",
      "stickyNote",
      "textSplitter",
      "imageCompare",
      "maskPainter",
      "audioEnvironment",
      "blur",
      "reformat",
      "crop",
      "colorCorrection",
      "compositor",
      "videoMaskOverlay",
      "extractFrameCustom",
      "frameComposer",
      "loadLora",
      "switch",
      "forEachStart",
      "forEachEnd",
      "actionDirector",
      "urlSpawner",
      "mediaDownload",
    ]);
    expect(items).toEqual(
      UTILITY_MENU_ORDER.map((type) => ({ type, label: expect.any(String) }))
    );
  });

  it("excludes the legacy annotation, video-only and conditional Utility nodes", async () => {
    const { getUtilityMenuItems } = await import("@/lib/nodeRegistry");
    const items = getUtilityMenuItems();
    const types = items.map((i) => i.type);
    for (const hidden of [
      "annotation",
      "videoStitch",
      "videoTrim",
      "easeCurve",
      "videoFrameGrab",
    ]) {
      expect(types).not.toContain(hidden);
    }
  });

  it("renames annotation to 'Annotate' and stickyNote to 'Sticky Note'", () => {
    expect(getBlueprint("annotation")?.label).toBe("Annotate");
    expect(getBlueprint("stickyNote")?.label).toBe("Sticky Note");
  });

  it("lowercases the Mask painter label to match netlify", () => {
    expect(getBlueprint("maskPainter")?.label).toBe("Mask painter");
  });

  it("provides defaults and zero handles for the new stickyNote blueprint", () => {
    expect(getBlueprintDefaults("stickyNote")).toEqual({
      text: "",
      fontSize: 16,
      color: "neutral",
    });
    expect(getBlueprintHandles("stickyNote")).toEqual({ inputs: [], outputs: [] });
  });

  it("exposes the 5-item Network menu labels mirroring netlify", async () => {
    const { NETWORK_MENU_LABELS } = await import("@/lib/nodeRegistry");
    expect(Array.from(NETWORK_MENU_LABELS)).toEqual([
      "Webhook Trigger",
      "Webhook Response",
      "Data Forward",
      "Dropbox Upload",
      "Cloudinary Upload",
    ]);
  });
});
