/**
 * In-memory webhook registry.
 *
 * Stores published webhook workflows keyed by slug. Each entry holds the
 * workflow graph (nodes + edges), the API keys to use when running it,
 * and an auth token for incoming POSTs to /api/webhook/[slug].
 *
 * The registry lives in module scope so it persists across requests on the
 * same Next.js dev/prod server, but is *not* persistent across restarts.
 * This matches the behaviour of the netlify clone, which uses the same
 * in-memory pattern.
 */

interface WorkflowGraph {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>;
}

export interface WebhookRegistration {
  slug: string;
  token: string;
  workflow: WorkflowGraph;
  apiKeys: Record<string, string>;
  autoRun: boolean;
  createdAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __nodeBananaWebhookRegistry: Map<string, WebhookRegistration> | undefined;
}

function registry(): Map<string, WebhookRegistration> {
  if (!globalThis.__nodeBananaWebhookRegistry) {
    globalThis.__nodeBananaWebhookRegistry = new Map();
  }
  return globalThis.__nodeBananaWebhookRegistry;
}

export function registerWebhook(reg: WebhookRegistration): void {
  registry().set(reg.slug, reg);
}

export function getWebhook(slug: string): WebhookRegistration | undefined {
  return registry().get(slug);
}

export function deleteWebhook(slug: string): boolean {
  return registry().delete(slug);
}

export function generateWebhookToken(): string {
  // 32 chars of base64url randomness — collision-safe for an in-memory map.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
