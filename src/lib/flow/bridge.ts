type FlowBridgeRuntime = {
  send(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
    target?: FlowBridgeTarget
  ): Promise<unknown>;
  assignSession(target?: FlowBridgeTarget): FlowBridgeSession | null;
  getStatus(): FlowBridgeStatus;
};

export interface FlowBridgeSession {
  id: string;
  accountId: string | null;
  extensionInstanceId: string | null;
  connected: boolean;
  connectedAt: number | null;
  disconnectedAt: number | null;
  uptimeMs: number | null;
  flowKeyPresent: boolean;
  tokenAgeMs: number | null;
  tokenCapturedAt: number | null;
  bridgeUrl: string | null;
  remoteAddress: string | null;
  lastError: string | null;
  pending: number;
  userAgent: string | null;
  flowTabUrl: string | null;
}

export interface FlowBridgeStatus {
  attached: boolean;
  connected: boolean;
  path: string;
  connectCount: number;
  disconnectCount: number;
  uptimeMs: number | null;
  flowKeyPresent: boolean;
  tokenAgeMs: number | null;
  expectedBridgeUrl: string | null;
  extensionBridgeUrl: string | null;
  remoteAddress: string | null;
  lastError: string | null;
  pending: number;
  activeSessionId: string | null;
  sessions: FlowBridgeSession[];
}

export interface FlowBridgeTarget {
  sessionId?: string | null;
  accountId?: string | null;
  extensionInstanceId?: string | null;
}

interface RuntimeModule {
  getFlowBridge: () => FlowBridgeRuntime;
}

const runtimeModule = require("./bridgeRuntime") as RuntimeModule;

export function getFlowBridgeStatus(): FlowBridgeStatus {
  return runtimeModule.getFlowBridge().getStatus();
}

export async function sendFlowBridgeRequest<T = unknown>(
  method: "api_request" | "trpc_request" | "get_status",
  params: Record<string, unknown>,
  timeoutMs?: number,
  target?: FlowBridgeTarget
): Promise<T> {
  return (await runtimeModule.getFlowBridge().send(method, params, timeoutMs, target)) as T;
}

export function assignFlowBridgeSession(target: FlowBridgeTarget): FlowBridgeSession | null {
  return runtimeModule.getFlowBridge().assignSession(target);
}
