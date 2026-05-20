import { describe, it, expect } from "vitest";

import { dropboxDirectUrl } from "../route";

describe("dropboxDirectUrl", () => {
  it("returns null for null input", () => {
    expect(dropboxDirectUrl(null)).toBeNull();
  });

  it("flips a single-parameter ?dl=0 to ?dl=1", () => {
    expect(dropboxDirectUrl("https://www.dropbox.com/scl/fi/abc/name?dl=0")).toBe(
      "https://www.dropbox.com/scl/fi/abc/name?dl=1"
    );
  });

  it("flips a multi-parameter &dl=0 without introducing a second '?'", () => {
    // Regression: previously `replace(/[?&]dl=0/, "?dl=1")` produced
    // `...?rlkey=xyz&st=abc?dl=1` (two '?').
    expect(
      dropboxDirectUrl(
        "https://www.dropbox.com/scl/fi/abc/name?rlkey=xyz&st=abc&dl=0"
      )
    ).toBe(
      "https://www.dropbox.com/scl/fi/abc/name?rlkey=xyz&st=abc&dl=1"
    );
  });

  it("leaves URLs that already have dl=1 untouched", () => {
    expect(
      dropboxDirectUrl(
        "https://www.dropbox.com/scl/fi/abc/name?rlkey=xyz&dl=1"
      )
    ).toBe("https://www.dropbox.com/scl/fi/abc/name?rlkey=xyz&dl=1");
  });

  it("appends dl=1 when the parameter is absent and URL has no query string", () => {
    expect(dropboxDirectUrl("https://www.dropbox.com/scl/fi/abc/name")).toBe(
      "https://www.dropbox.com/scl/fi/abc/name?dl=1"
    );
  });

  it("appends &dl=1 when the parameter is absent but other params exist", () => {
    expect(
      dropboxDirectUrl("https://www.dropbox.com/scl/fi/abc/name?rlkey=xyz")
    ).toBe("https://www.dropbox.com/scl/fi/abc/name?rlkey=xyz&dl=1");
  });
});
