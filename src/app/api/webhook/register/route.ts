/**
 * /api/webhook/register
 *
 * Manages registration of webhook trigger nodes. Matches the netlify
 * bundle's contract:
 *
 *  POST   — register / re-register a slug
 *    body: { slug, workflow: { nodes, edges }, apiKeys, autoRun, providedToken? }
 *    headers: Authorization: Bearer <token>  (when updating existing)
 *    response: { success: true, token: string }
 *
 *  DELETE — unpublish a slug
 *    body: { slug }
 *    headers: Authorization: Bearer <token>
 *    response: { success: true }
 *
 * Once registered, an external client can POST any JSON payload to
 * /api/webhook/<slug> to trigger the workflow. See that route for details.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  deleteWebhook,
  generateWebhookToken,
  getWebhook,
  registerWebhook,
} from "@/lib/webhook/registry";

interface RegisterRequest {
  slug?: string;
  workflow?: { nodes: unknown[]; edges: unknown[] };
  apiKeys?: Record<string, string>;
  autoRun?: boolean;
  providedToken?: string | null;
}

interface RegisterOk {
  success: true;
  token: string;
}

interface RegisterErr {
  success: false;
  error: string;
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,63}$/.test(slug);
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<RegisterOk | RegisterErr>> {
  let body: RegisterRequest;
  try {
    body = (await request.json()) as RegisterRequest;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim().toLowerCase();
  if (!slug) {
    return NextResponse.json({ success: false, error: "'slug' is required" }, { status: 400 });
  }
  if (!isValidSlug(slug)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "'slug' must be 3-64 characters, lowercase letters / digits / hyphens, and start with an alphanumeric.",
      },
      { status: 400 }
    );
  }

  if (!body.workflow || !Array.isArray(body.workflow.nodes) || !Array.isArray(body.workflow.edges)) {
    return NextResponse.json(
      { success: false, error: "'workflow' must include 'nodes' and 'edges' arrays" },
      { status: 400 }
    );
  }

  // If a registration already exists for this slug, the client must present
  // either the bearer token or the original providedToken to update it.
  const existing = getWebhook(slug);
  if (existing) {
    const presented = bearerToken(request) ?? body.providedToken ?? null;
    if (!presented || presented !== existing.token) {
      return NextResponse.json(
        {
          success: false,
          error: `Webhook slug '${slug}' is already taken. Pass its auth token to update.`,
        },
        { status: 403 }
      );
    }
  }

  // Use `||` instead of `??` so an empty / whitespace-only providedToken
  // falls through to a freshly generated token. With `??` an empty string
  // would be kept verbatim, which would (a) leave the registry without an
  // auth token (so anyone could POST to /api/webhook/<slug>) and (b) make
  // the entry undeletable, because the auth check at delete time would
  // always fail against `""`.
  const providedTrimmed = body.providedToken?.trim() ?? "";
  const token = existing?.token || providedTrimmed || generateWebhookToken();

  registerWebhook({
    slug,
    token,
    workflow: body.workflow as never,
    apiKeys: body.apiKeys ?? {},
    autoRun: body.autoRun ?? true,
    createdAt: existing?.createdAt ?? Date.now(),
  });

  return NextResponse.json({ success: true, token });
}

export async function DELETE(
  request: NextRequest
): Promise<NextResponse<RegisterOk | RegisterErr>> {
  let body: RegisterRequest;
  try {
    body = (await request.json()) as RegisterRequest;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim().toLowerCase();
  if (!slug) {
    return NextResponse.json({ success: false, error: "'slug' is required" }, { status: 400 });
  }

  const existing = getWebhook(slug);
  if (!existing) {
    return NextResponse.json(
      { success: false, error: `No webhook registered for slug '${slug}'` },
      { status: 404 }
    );
  }

  const presented = bearerToken(request);
  if (!presented || presented !== existing.token) {
    return NextResponse.json(
      { success: false, error: "Invalid auth token for this webhook" },
      { status: 403 }
    );
  }

  deleteWebhook(slug);
  // Return shape kept as { success: true, token } for callers that read
  // .token on the result; token is empty on delete.
  return NextResponse.json({ success: true, token: "" });
}
