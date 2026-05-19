import { describe, expect, it } from "vitest";
import { parseVarTags } from "../parseVarTags";

describe("parseVarTags", () => {
  it("parses canonical var tags", () => {
    expect(parseVarTags('<var="shot1">Wide runway shot</var>')).toEqual([
      { name: "shot1", value: "Wide runway shot" },
    ]);
  });

  it("parses common LLM typo with dash delimiter", () => {
    expect(parseVarTags('<var-"shot2">Close-up of jacket texture</var>')).toEqual([
      { name: "shot2", value: "Close-up of jacket texture" },
    ]);
  });

  it("supports hyphenated names and trims values", () => {
    expect(parseVarTags("<var='shot-3'>\n Low angle pose \n</var>")).toEqual([
      { name: "shot-3", value: "Low angle pose" },
    ]);
  });
});
