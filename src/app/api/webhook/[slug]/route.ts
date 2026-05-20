/**
 * /api/webhook/[slug]
 *
 * Public ingestion endpoint for webhook trigger nodes. External services
 * POST a JSON payload here and the registered workflow's `webhookTrigger`
 * node makes the payload available on its output handles.
 *
 * In the netlify clone the registry is in-memory, so this endpoint simply
 * confirms receipt — the actual workflow execution is driven by the
 * connected browser (which polls or subscribes). Without a persistent
 * pub/sub layer we cannot reach a disconnected browser, so this route
 * records the latest payload per slug for the client to poll.
 *
 * Request: any JSON body (or empty). Optional Authorization: Bearer <token>
 * is required if the registration was created with a token.
 *
 * Response on success: { success: true, slug, receivedAt }
 * Response on failure: { success: false, error }
 */
import { NextRequest, NextResponse } from "next/server";
import { getWebhook } from "@/lib/webhook/registry";

interface WebhookEvent {
  receivedAt: number;
  payload: unknown;
  query: Record<string, string>;
}

declare global {
  // eslint-disable-next-line no-var
  var __nodeBananaWebhookEvents: Map<string, WebhookEvent> | undefined;
}

function events(): Map<string, WebhookEvent> {
  if (!globalThis.__nodeBananaWebhookEvents) {
    globalThis.__nodeBananaWebhookEvents = new Map();
  }
  return globalThis.__nodeBananaWebhookEvents;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const { slug } = await context.params;
  const reg = getWebhook(slug);
  if (!reg) {
    return NextResponse.json(
      { success: false, error: `No webhook registered for slug '${slug}'` },
      { status: 404 }
    );
  }

  // Enforce bearer token if one was provided at registration time.
  if (reg.token) {
    const header = request.headers.get("Authorization");
    const presented = header ? /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] : null;
    if (!presented || presented !== reg.token) {
      return NextResponse.json(
        { success: false, error: "Invalid auth token" },
        { status: 401 }
      );
    }
  }

  let payload: unknown = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    payload = await request.json().catch(() => null);
  } else {
    payload = await request.text().catch(() => "");
  }

  const query: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  events().set(slug, { receivedAt: Date.now(), payload, query });

  return NextResponse.json({
    success: true,
    slug,
    receivedAt: Date.now(),
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  // Polling endpoint for the connected browser. Returns the most recent
  // event, or null if no event has been received since registration.
  const { slug } = await context.params;
  const reg = getWebhook(slug);
  if (!reg) {
    return NextResponse.json(
      { success: false, error: `No webhook registered for slug '${slug}'` },
      { status: 404 }
    );
  }
  const event = events().get(slug);
  return NextResponse.json({ success: true, event: event ?? null });
}
