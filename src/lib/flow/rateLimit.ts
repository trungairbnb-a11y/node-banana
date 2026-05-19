const DEFAULT_COOLDOWN_MS = process.env.NODE_ENV === "test" ? 0 : 10_000;
const COOLDOWN_MS = Number(process.env.FLOW_API_COOLDOWN_MS ?? DEFAULT_COOLDOWN_MS);
const MAX_CONCURRENT = Math.max(1, Number(process.env.FLOW_MAX_CONCURRENT_REQUESTS ?? 2));

let active = 0;
let lastStartedAt = 0;
const queue: Array<() => void> = [];

function drainQueue(): void {
  if (active >= MAX_CONCURRENT) return;
  const next = queue.shift();
  if (next) next();
}

async function acquire(): Promise<void> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }

  const waitMs = Math.max(0, COOLDOWN_MS - (Date.now() - lastStartedAt));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  active += 1;
  lastStartedAt = Date.now();
}

function release(): void {
  active = Math.max(0, active - 1);
  drainQueue();
}

export async function runFlowLimited<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

