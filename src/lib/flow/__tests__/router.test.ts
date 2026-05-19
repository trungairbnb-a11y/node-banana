import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assignFlowBridgeSession: vi.fn(),
  getFlowBridgeStatus: vi.fn(),
  getCredits: vi.fn(),
  getFlowAccount: vi.fn(),
  listFlowAccounts: vi.fn(),
  updateFlowAccount: vi.fn(),
}));

vi.mock("../bridge", () => ({
  assignFlowBridgeSession: mocks.assignFlowBridgeSession,
  getFlowBridgeStatus: mocks.getFlowBridgeStatus,
}));

vi.mock("../sdk", () => ({
  getCredits: mocks.getCredits,
}));

vi.mock("../store", () => ({
  getFlowAccount: mocks.getFlowAccount,
  listFlowAccounts: mocks.listFlowAccounts,
  updateFlowAccount: mocks.updateFlowAccount,
}));

import {
  checkFlowAccountQuota,
  listFlowRouteCandidates,
  pairFlowAccountSession,
  quotaSnapshotFromRaw,
} from "../router";
import type { FlowAccount } from "../store";

function account(overrides: Partial<FlowAccount>): FlowAccount {
  return {
    id: "account-1",
    label: "Account",
    email: null,
    profilePath: "C:/tmp/profile",
    active: false,
    status: "connected",
    createdAt: 1,
    updatedAt: 1,
    lastError: null,
    browserSource: "gpm",
    gpmProfileId: null,
    gpmProfileName: null,
    gpmBrowser: "chrome",
    extensionInstanceId: null,
    priority: null,
    disabled: false,
    quota: null,
    ...overrides,
  };
}

function bridgeStatus(sessions: any[], activeSessionId = sessions[0]?.id ?? null) {
  return {
    attached: true,
    connected: sessions.some((session) => session.connected),
    path: "/flow-bridge",
    connectCount: sessions.length,
    disconnectCount: 0,
    uptimeMs: 100,
    flowKeyPresent: sessions.some((session) => session.flowKeyPresent),
    tokenAgeMs: 50,
    expectedBridgeUrl: "ws://127.0.0.1:3001/flow-bridge",
    extensionBridgeUrl: "ws://127.0.0.1:3001/flow-bridge",
    remoteAddress: "127.0.0.1",
    lastError: null,
    pending: 0,
    activeSessionId,
    sessions,
  };
}

function session(overrides: any) {
  return {
    id: "session-1",
    accountId: null,
    extensionInstanceId: "ext-1",
    connected: true,
    connectedAt: 100,
    disconnectedAt: null,
    uptimeMs: 100,
    flowKeyPresent: true,
    tokenAgeMs: 10,
    tokenCapturedAt: 90,
    bridgeUrl: "ws://127.0.0.1:3001/flow-bridge",
    remoteAddress: "127.0.0.1",
    lastError: null,
    pending: 0,
    userAgent: null,
    flowTabUrl: "https://labs.google/fx/tools/flow",
    ...overrides,
  };
}

describe("Flow account router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFlowAccounts.mockResolvedValue([]);
    mocks.getFlowBridgeStatus.mockReturnValue(bridgeStatus([]));
    mocks.updateFlowAccount.mockImplementation(async (id, updates) => account({ id, ...updates }));
  });

  it("routes connected accounts by active flag and priority", async () => {
    const first = account({ id: "first", active: false, priority: 2, extensionInstanceId: "ext-first" });
    const active = account({ id: "active", active: true, priority: 99, extensionInstanceId: "ext-active" });
    const exhausted = account({ id: "empty", active: false, priority: 0, status: "credit_exhausted", extensionInstanceId: "ext-empty" });
    mocks.listFlowAccounts.mockResolvedValue([first, active, exhausted]);
    mocks.getFlowBridgeStatus.mockReturnValue(bridgeStatus([
      session({ id: "s-first", extensionInstanceId: "ext-first", connectedAt: 10 }),
      session({ id: "s-active", extensionInstanceId: "ext-active", connectedAt: 20 }),
      session({ id: "s-empty", extensionInstanceId: "ext-empty", connectedAt: 30 }),
    ]));

    const candidates = await listFlowRouteCandidates();

    expect(candidates.map((candidate) => candidate.account?.id)).toEqual(["active", "first"]);
    expect(candidates[0].target).toMatchObject({
      accountId: "active",
      sessionId: "s-active",
      extensionInstanceId: "ext-active",
    });
  });

  it("falls back to the default ready bridge session when no account is paired", async () => {
    mocks.getFlowBridgeStatus.mockReturnValue(bridgeStatus([
      session({ id: "old", extensionInstanceId: "old", flowKeyPresent: false, connectedAt: 20 }),
      session({ id: "ready", extensionInstanceId: "ready", flowKeyPresent: true, connectedAt: 10 }),
    ], "old"));

    const candidates = await listFlowRouteCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      account: null,
      label: "Default Flow session",
      target: { sessionId: "ready", extensionInstanceId: "ready" },
    });
  });

  it("does not let an active legacy account steal a paired account session", async () => {
    const legacy = account({ id: "legacy-active", active: true, priority: 0, extensionInstanceId: null });
    const paired = account({ id: "profile-4452", active: false, priority: 1, extensionInstanceId: "ext-4452" });
    mocks.listFlowAccounts.mockResolvedValue([legacy, paired]);
    mocks.getFlowBridgeStatus.mockReturnValue(bridgeStatus([
      session({ id: "s-4452", extensionInstanceId: "ext-4452" }),
    ]));

    const candidates = await listFlowRouteCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].account?.id).toBe("profile-4452");
    expect(candidates[0].target).toMatchObject({
      accountId: "profile-4452",
      sessionId: "s-4452",
      extensionInstanceId: "ext-4452",
    });
  });

  it("extracts quota from nested Flow credit responses", () => {
    const quota = quotaSnapshotFromRaw({
      data: {
        userPaygateTier: "PAYGATE_TIER_TWO",
        accountState: { credits: 18 },
      },
    });

    expect(quota.remainingCredits).toBe(18);
    expect(quota.paygateTier).toBe("PAYGATE_TIER_TWO");
    expect(quota.lastError).toBeNull();
  });

  it("checks quota through the paired session target and persists the snapshot", async () => {
    const paired = account({ id: "paired", extensionInstanceId: "ext-paired" });
    mocks.getFlowAccount.mockResolvedValue(paired);
    mocks.listFlowAccounts.mockResolvedValue([paired]);
    mocks.getFlowBridgeStatus.mockReturnValue(bridgeStatus([
      session({ id: "s-paired", extensionInstanceId: "ext-paired" }),
    ]));
    mocks.getCredits.mockResolvedValue({
      paygateTier: "PAYGATE_TIER_TWO",
      raw: { data: { userPaygateTier: "PAYGATE_TIER_TWO", remainingCredits: 7 } },
    });

    const result = await checkFlowAccountQuota("paired");

    expect(mocks.getCredits).toHaveBeenCalledWith({
      accountId: "paired",
      sessionId: "s-paired",
      extensionInstanceId: "ext-paired",
    });
    expect(mocks.updateFlowAccount).toHaveBeenCalledWith("paired", expect.objectContaining({
      status: "connected",
      lastError: null,
      quota: expect.objectContaining({ remainingCredits: 7, paygateTier: "PAYGATE_TIER_TWO" }),
    }));
    expect(result.quota.remainingCredits).toBe(7);
  });

  it("pairs an account with a live bridge session", async () => {
    const target = account({ id: "account-4452" });
    mocks.getFlowAccount.mockResolvedValue(target);
    mocks.assignFlowBridgeSession.mockReturnValue(session({
      id: "session-4452",
      extensionInstanceId: "ext-4452",
      flowKeyPresent: true,
    }));

    await pairFlowAccountSession({ accountId: "account-4452", sessionId: "session-4452" });

    expect(mocks.assignFlowBridgeSession).toHaveBeenCalledWith({
      accountId: "account-4452",
      sessionId: "session-4452",
      extensionInstanceId: undefined,
    });
    expect(mocks.updateFlowAccount).toHaveBeenCalledWith("account-4452", expect.objectContaining({
      extensionInstanceId: "ext-4452",
      status: "connected",
      lastError: null,
    }));
  });
});
