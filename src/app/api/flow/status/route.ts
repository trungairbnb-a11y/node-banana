import { NextRequest, NextResponse } from "next/server";
import { getFlowDashboardState } from "@/lib/flow/engine";
import type { FlowBridgeStatus } from "@/lib/flow/bridge";
import { listFlowAccounts } from "@/lib/flow/store";
import type { FlowTaskRecord } from "@/lib/flow/registry";

export const dynamic = "force-dynamic";

const FLOW_EXTENSION_PORTS = [3000, 3001, 3002, 3003, 3004];

interface PeerFlowServer {
  origin: string;
  port: number;
  bridge: FlowBridgeStatus;
}

function requestPort(request: NextRequest): number | null {
  const explicit = Number(request.nextUrl.port);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (request.nextUrl.protocol === "https:") return 443;
  if (request.nextUrl.protocol === "http:") return 80;
  return null;
}

async function fetchPeerStatus(port: number): Promise<PeerFlowServer | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/flow/status?includePeers=0`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const data = await response.json();
    if (!data?.success || !data?.bridge) return null;

    return {
      origin: data.server?.origin ?? `http://localhost:${port}`,
      port,
      bridge: data.bridge,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function findPeerServers(currentPort: number | null): Promise<PeerFlowServer[]> {
  const ports = FLOW_EXTENSION_PORTS.filter((port) => port !== currentPort);
  const peers = await Promise.all(ports.map((port) => fetchPeerStatus(port)));
  return peers
    .filter((peer): peer is PeerFlowServer => peer !== null)
    .filter((peer) => peer.bridge.connected || peer.bridge.flowKeyPresent || peer.bridge.attached);
}

function summarizeQuotaSnapshot(quotaSnapshot: unknown) {
  if (!quotaSnapshot || typeof quotaSnapshot !== "object") return quotaSnapshot ?? null;
  const quota = quotaSnapshot as {
    remainingCredits?: number | null;
    paygateTier?: string | null;
    checkedAt?: number | null;
    lastError?: string | null;
  };
  return {
    remainingCredits: quota.remainingCredits ?? null,
    paygateTier: quota.paygateTier ?? null,
    checkedAt: quota.checkedAt ?? null,
    lastError: quota.lastError ?? null,
  };
}

function publicTask(task: FlowTaskRecord): Omit<FlowTaskRecord, "generationTrace" | "rawSubmit" | "rawPoll" | "quotaSnapshot"> & {
  quotaSnapshot: ReturnType<typeof summarizeQuotaSnapshot>;
} {
  const {
    generationTrace: _generationTrace,
    rawSubmit: _rawSubmit,
    rawPoll: _rawPoll,
    quotaSnapshot,
    ...rest
  } = task;
  return {
    ...rest,
    quotaSnapshot: summarizeQuotaSnapshot(quotaSnapshot),
  };
}

export async function GET(request: NextRequest) {
  const [state, accounts] = await Promise.all([getFlowDashboardState(), listFlowAccounts()]);
  const currentPort = requestPort(request);
  const includePeers = request.nextUrl.searchParams.get("includePeers") !== "0";
  const shouldScanPeers = includePeers && (!state.bridge.attached || !state.bridge.connected || !state.bridge.flowKeyPresent);
  const peerServers = shouldScanPeers ? await findPeerServers(currentPort) : [];

  return NextResponse.json({
    success: true,
    server: {
      origin: request.nextUrl.origin,
      port: currentPort,
      pid: process.pid,
    },
    ...state,
    tasks: state.tasks.map(publicTask),
    accounts,
    peerServers,
  });
}
