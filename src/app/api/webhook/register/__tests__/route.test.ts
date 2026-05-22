import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST, DELETE } from "../route";

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const get = (name: string) =>
    headers[name] ??
    headers[name.toLowerCase()] ??
    headers[name.charAt(0).toUpperCase() + name.slice(1)] ??
    null;
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: { get },
  } as unknown as NextRequest;
}

describe("/api/webhook/register", () => {
  beforeEach(() => {
    // Reset in-memory registry between tests.
    (globalThis as { __nodeBananaWebhookRegistry?: Map<string, unknown> }).__nodeBananaWebhookRegistry =
      new Map();
  });

  it("returns 400 when slug is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false });
  });

  it("rejects invalid slug format", async () => {
    const res = await POST(
      makeRequest({ slug: "X", workflow: { nodes: [], edges: [] } })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: false; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("3-64 characters");
  });

  it("registers a fresh slug and returns a generated token", async () => {
    const res = await POST(
      makeRequest({
        slug: "my-hook",
        workflow: { nodes: [], edges: [] },
        apiKeys: {},
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: true; token: string };
    expect(body.success).toBe(true);
    expect(body.token).toMatch(/^[0-9a-f]{48}$/);
  });

  it("falls through to a generated token when providedToken is an empty string", async () => {
    // Regression test for the empty-string `??` bug. With `??` the empty
    // string was retained, leaving the slug with no auth token, allowing
    // anonymous POSTs and making the entry undeletable.
    const res = await POST(
      makeRequest({
        slug: "empty-token-hook",
        workflow: { nodes: [], edges: [] },
        providedToken: "",
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: true; token: string };
    expect(body.token.length).toBeGreaterThan(0);
  });

  it("falls through to a generated token when providedToken is whitespace-only", async () => {
    const res = await POST(
      makeRequest({
        slug: "ws-token-hook",
        workflow: { nodes: [], edges: [] },
        providedToken: "   ",
      })
    );
    const body = (await res.json()) as { success: true; token: string };
    expect(body.token.length).toBeGreaterThan(0);
  });

  it("uses the providedToken verbatim when non-empty", async () => {
    const res = await POST(
      makeRequest({
        slug: "fixed-token-hook",
        workflow: { nodes: [], edges: [] },
        providedToken: "my-fixed-token-1234",
      })
    );
    const body = (await res.json()) as { success: true; token: string };
    expect(body.token).toBe("my-fixed-token-1234");
  });

  it("requires bearer auth to update an existing slug", async () => {
    const first = await POST(
      makeRequest({
        slug: "auth-hook",
        workflow: { nodes: [], edges: [] },
      })
    );
    const token = ((await first.json()) as { token: string }).token;

    const second = await POST(
      makeRequest({
        slug: "auth-hook",
        workflow: { nodes: [], edges: [] },
      })
    );
    expect(second.status).toBe(403);

    const third = await POST(
      makeRequest(
        {
          slug: "auth-hook",
          workflow: { nodes: [], edges: [] },
        },
        { Authorization: `Bearer ${token}` }
      )
    );
    expect(third.status).toBe(200);
  });

  it("DELETE requires bearer auth and removes the entry", async () => {
    const first = await POST(
      makeRequest({ slug: "del-hook", workflow: { nodes: [], edges: [] } })
    );
    const token = ((await first.json()) as { token: string }).token;

    const noAuth = await DELETE(makeRequest({ slug: "del-hook" }));
    expect(noAuth.status).toBe(403);

    const withAuth = await DELETE(
      makeRequest({ slug: "del-hook" }, { Authorization: `Bearer ${token}` })
    );
    expect(withAuth.status).toBe(200);
  });
});
