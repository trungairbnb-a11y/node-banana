import {
  assignFlowBridgeSession,
  getFlowBridgeStatus,
  type FlowBridgeSession,
  type FlowBridgeTarget,
} from "./bridge";
import { getCredits } from "./sdk";
import {
  getFlowAccount,
  listFlowAccounts,
  updateFlowAccount,
  type FlowAccount,
  type FlowQuotaSnapshot,
} from "./store";

export interface FlowRouteCandidate {
  account: FlowAccount | null;
  target: FlowBridgeTarget;
  session: FlowBridgeSession | null;
  label: string;
}

export interface FlowAttemptRecord {
  accountId?: string | null;
  sessionId?: string | null;
  extensionInstanceId?: string | null;
  status: "failed" | "submitted";
  error?: string | null;
  failureKind?: string | null;
  startedAt: number;
  finishedAt?: number | null;
}

function sortAccounts(accounts: FlowAccount[]): FlowAccount[] {
  return [...accounts].sort((a, b) => {
    if (!!a.active !== !!b.active) return a.active ? -1 : 1;
    const aPriority = typeof a.priority === "number" ? a.priority : Number.MAX_SAFE_INTEGER;
    const bPriority = typeof b.priority === "number" ? b.priority : Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.createdAt - b.createdAt;
  });
}

function sessionForAccount(account: FlowAccount, sessions: FlowBridgeSession[]): FlowBridgeSession | null {
  if (account.extensionInstanceId) {
    return sessions.find((session) => session.extensionInstanceId === account.extensionInstanceId) ?? null;
  }
  if (account.id) {
    return sessions.find((session) => session.accountId === account.id) ?? null;
  }
  return null;
}

function defaultSession(sessions: FlowBridgeSession[], activeSessionId?: string | null): FlowBridgeSession | null {
  if (activeSessionId) {
    const active = sessions.find((session) => session.id === activeSessionId);
    if (active?.connected && active.flowKeyPresent) return active;
  }
  return [...sessions]
    .filter((session) => session.connected)
    .sort((a, b) => {
      if (a.flowKeyPresent !== b.flowKeyPresent) return a.flowKeyPresent ? -1 : 1;
      return (b.connectedAt ?? 0) - (a.connectedAt ?? 0);
    })[0] ?? null;
}

export async function listFlowRouteCandidates(): Promise<FlowRouteCandidate[]> {
  const [accounts, bridge] = await Promise.all([listFlowAccounts(), Promise.resolve(getFlowBridgeStatus())]);
  const sessions = bridge.sessions ?? [];
  const usableAccounts = sortAccounts(accounts).filter(
    (account) => !account.disabled && account.status !== "credit_exhausted"
  );

  const candidates: FlowRouteCandidate[] = [];
  for (const account of usableAccounts) {
    const session = sessionForAccount(account, sessions);
    if (!session?.connected || !session.flowKeyPresent) continue;
    candidates.push({
      account,
      session,
      target: {
        accountId: account.id,
        sessionId: session.id,
        extensionInstanceId: account.extensionInstanceId ?? session.extensionInstanceId,
      },
      label: account.email || account.gpmProfileName || account.label,
    });
  }

  if (candidates.length > 0) return candidates;

  const session = defaultSession(sessions, bridge.activeSessionId);
  const legacyActiveAccount = usableAccounts.find((account) => account.active && !account.extensionInstanceId) ?? null;
  if (legacyActiveAccount && session?.connected && session.flowKeyPresent) {
    return [{
      account: legacyActiveAccount,
      session,
      target: {
        accountId: legacyActiveAccount.id,
        sessionId: session.id,
        extensionInstanceId: session.extensionInstanceId,
      },
      label: legacyActiveAccount.email || legacyActiveAccount.gpmProfileName || legacyActiveAccount.label,
    }];
  }

  if (session?.connected && session.flowKeyPresent) {
    return [{
      account: null,
      session,
      target: {
        sessionId: session.id,
        extensionInstanceId: session.extensionInstanceId,
      },
      label: "Default Flow session",
    }];
  }

  return [];
}

function findNumberByKeys(value: unknown, keys: Set<string>, depth = 0): number | null {
  if (!value || typeof value !== "object" || depth > 6) return null;
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (keys.has(key) && typeof item === "number" && Number.isFinite(item)) return item;
  }
  for (const item of Object.values(record)) {
    const found = findNumberByKeys(item, keys, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function parsePaygateTier(raw: unknown): string | null {
  const data = (raw as any)?.data ?? raw;
  const direct = data?.userPaygateTier ?? data?.paygateTier ?? data?.tier;
  return typeof direct === "string" && direct ? direct : null;
}

export function quotaSnapshotFromRaw(raw: unknown, error?: string | null): FlowQuotaSnapshot {
  return {
    remainingCredits: error
      ? null
      : findNumberByKeys(raw, new Set(["remainingCredits", "remainingCredit", "creditsRemaining", "credits"])),
    paygateTier: error ? null : parsePaygateTier(raw),
    checkedAt: Date.now(),
    lastError: error ?? null,
    raw,
  };
}

export async function recordFlowAccountQuota(
  account: FlowAccount | null,
  raw: unknown,
  error?: string | null
): Promise<FlowQuotaSnapshot> {
  const quota = quotaSnapshotFromRaw(raw, error);
  if (account) {
    await updateFlowAccount(account.id, {
      quota,
      status: error ? account.status : "connected",
      lastError: error ?? null,
    });
  }
  return quota;
}

export function isFlowQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /credit|quota|RESOURCE_EXHAUSTED|not enough generations|generation limit|insufficient/i.test(message);
}

export function isFlowSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/API_KEY_HTTP_REFERRER_BLOCKED/i.test(message)) return false;
  return /NO_FLOW_KEY|token|needs login|not connected|disconnected|401|403|UNAUTHENTICATED|PERMISSION_DENIED/i.test(message);
}

export function isFlowFallbackableError(error: unknown): boolean {
  return isFlowQuotaError(error) || isFlowSessionError(error);
}

export function flowFailureKind(error: unknown): "credit_exhausted" | "needs_login" | "generation_failed" {
  if (isFlowQuotaError(error)) return "credit_exhausted";
  if (isFlowSessionError(error)) return "needs_login";
  return "generation_failed";
}

export async function markFlowAccountFailure(account: FlowAccount | null, error: unknown): Promise<void> {
  if (!account) return;
  const message = error instanceof Error ? error.message : String(error ?? "Google Flow account failed");
  const kind = flowFailureKind(error);
  await updateFlowAccount(account.id, {
    status: kind,
    lastError: message,
    quota: kind === "credit_exhausted"
      ? {
          ...(account.quota ?? {}),
          remainingCredits: 0,
          checkedAt: Date.now(),
          lastError: message,
        }
      : account.quota ?? null,
  });
}

export async function checkFlowAccountQuota(accountId: string): Promise<{
  account: FlowAccount;
  quota: FlowQuotaSnapshot;
}> {
  const account = await getFlowAccount(accountId);
  if (!account) throw new Error("Flow account not found");

  const candidates = await listFlowRouteCandidates();
  const candidate = candidates.find((item) => item.account?.id === accountId);
  if (!candidate) {
    throw new Error("No connected Flow bridge session is paired with this account");
  }

  try {
    const credits = await getCredits(candidate.target);
    const quota = await recordFlowAccountQuota(account, credits.raw);
    return {
      account: (await getFlowAccount(accountId)) ?? account,
      quota,
    };
  } catch (error) {
    const quota = await recordFlowAccountQuota(account, null, error instanceof Error ? error.message : String(error));
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { quota });
  }
}

export async function pairFlowAccountSession(input: {
  accountId: string;
  sessionId?: string | null;
  extensionInstanceId?: string | null;
}): Promise<FlowAccount> {
  const account = await getFlowAccount(input.accountId);
  if (!account) throw new Error("Flow account not found");

  const assigned = assignFlowBridgeSession({
    accountId: account.id,
    sessionId: input.sessionId,
    extensionInstanceId: input.extensionInstanceId,
  });
  if (!assigned) throw new Error("Flow bridge session not found or not connected");

  const updated = await updateFlowAccount(account.id, {
    extensionInstanceId: assigned.extensionInstanceId ?? input.extensionInstanceId ?? account.extensionInstanceId ?? null,
    status: assigned.flowKeyPresent ? "connected" : "needs_login",
    lastError: assigned.flowKeyPresent ? null : "Flow token is not captured for this session",
  });
  return updated ?? account;
}
