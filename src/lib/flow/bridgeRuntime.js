const crypto = require("crypto");

const GLOBAL_KEY = "__bananaFlowBridgeRuntime";
const DEFAULT_PATH = "/flow-bridge";

function socketOpen(socket) {
  return !!socket && socket.readyState === 1;
}

function rejectPending(session, error) {
  session.pending.forEach((pending) => {
    clearTimeout(pending.timeout);
    pending.reject(error);
  });
  session.pending.clear();
}

function sessionStatus(session) {
  return {
    id: session.id,
    accountId: session.accountId,
    extensionInstanceId: session.extensionInstanceId,
    connected: socketOpen(session.socket),
    connectedAt: session.connectedAt,
    disconnectedAt: session.disconnectedAt,
    uptimeMs: session.connectedAt && socketOpen(session.socket) ? Date.now() - session.connectedAt : null,
    flowKeyPresent: session.flowKeyPresent,
    tokenAgeMs: session.tokenCapturedAt ? Date.now() - session.tokenCapturedAt : null,
    tokenCapturedAt: session.tokenCapturedAt,
    bridgeUrl: session.extensionBridgeUrl,
    remoteAddress: session.remoteAddress,
    lastError: session.lastError,
    pending: session.pending.size,
    userAgent: session.userAgent,
    flowTabUrl: session.flowTabUrl,
  };
}

function openSessions(runtime) {
  return [...runtime.sessions.values()].filter((session) => socketOpen(session.socket));
}

function sortSessionsForDefault(sessions) {
  return [...sessions].sort((a, b) => {
    if (a.flowKeyPresent !== b.flowKeyPresent) return a.flowKeyPresent ? -1 : 1;
    return (b.connectedAt || 0) - (a.connectedAt || 0);
  });
}

function selectSession(runtime, target = {}) {
  const open = openSessions(runtime);
  if (open.length === 0) return null;

  if (target.sessionId) {
    const session = runtime.sessions.get(String(target.sessionId));
    if (session && socketOpen(session.socket)) return session;
  }

  if (target.extensionInstanceId) {
    const session = open.find(
      (candidate) => candidate.extensionInstanceId === String(target.extensionInstanceId)
    );
    if (session) return session;
  }

  if (target.accountId) {
    const session = open.find((candidate) => candidate.accountId === String(target.accountId));
    if (session) return session;
  }

  if (runtime.defaultSessionId) {
    const session = runtime.sessions.get(runtime.defaultSessionId);
    if (session && socketOpen(session.socket)) return session;
  }

  return sortSessionsForDefault(open)[0] || null;
}

function createRuntime() {
  const runtime = {
    attached: false,
    path: DEFAULT_PATH,
    sessions: new Map(),
    defaultSessionId: null,
    connectCount: 0,
    disconnectCount: 0,
    expectedBridgeUrl: null,
    lastError: null,
    async send(method, params, timeoutMs = 300000, target = {}) {
      const session = selectSession(runtime, target);
      if (!session) {
        throw new Error("Google Flow extension is not connected. Load the Banana Flow extension and open Google Flow.");
      }

      const id = crypto.randomUUID();
      const payload = JSON.stringify({ id, method, params });

      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          session.pending.delete(id);
          reject(new Error(`Timeout waiting for Flow extension response to ${method}`));
        }, timeoutMs);

        session.pending.set(id, { resolve, reject, timeout });
        try {
          session.socket.send(payload);
        } catch (error) {
          clearTimeout(timeout);
          session.pending.delete(id);
          reject(error);
        }
      });
    },
    assignSession(target = {}) {
      const session = selectSession(runtime, target);
      if (!session) return null;
      if (target.accountId) session.accountId = String(target.accountId);
      return sessionStatus(session);
    },
    getStatus() {
      const sessions = [...runtime.sessions.values()]
        .map(sessionStatus)
        .sort((a, b) => Number(b.connected) - Number(a.connected) || (b.connectedAt || 0) - (a.connectedAt || 0));
      const selected = selectSession(runtime);
      const selectedStatus = selected ? sessionStatus(selected) : null;
      return {
        attached: runtime.attached,
        connected: !!selectedStatus?.connected,
        path: runtime.path,
        connectCount: runtime.connectCount,
        disconnectCount: runtime.disconnectCount,
        uptimeMs: selectedStatus?.uptimeMs ?? null,
        flowKeyPresent: !!selectedStatus?.flowKeyPresent,
        tokenAgeMs: selectedStatus?.tokenAgeMs ?? null,
        expectedBridgeUrl: runtime.expectedBridgeUrl,
        extensionBridgeUrl: selectedStatus?.bridgeUrl ?? null,
        remoteAddress: selectedStatus?.remoteAddress ?? null,
        lastError: runtime.lastError,
        pending: sessions.reduce((sum, session) => sum + session.pending, 0),
        activeSessionId: selectedStatus?.id ?? null,
        sessions,
      };
    },
  };
  return runtime;
}

function getRuntime() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = createRuntime();
  }
  return globalThis[GLOBAL_KEY];
}

function adoptExtensionInstance(runtime, session, extensionInstanceId) {
  if (!extensionInstanceId) return;
  session.extensionInstanceId = extensionInstanceId;

  for (const [id, candidate] of runtime.sessions) {
    if (id === session.id) continue;
    if (candidate.extensionInstanceId !== extensionInstanceId) continue;
    rejectPending(candidate, new Error("Google Flow extension reconnected"));
    try {
      candidate.socket && candidate.socket.close();
    } catch {}
    runtime.sessions.delete(id);
  }
}

function handleMessage(runtime, session, raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }

  if (message.type === "extension_ready") {
    session.flowKeyPresent = !!message.flowKeyPresent;
    session.userAgent = typeof message.userAgent === "string" ? message.userAgent : session.userAgent;
    session.flowTabUrl = typeof message.flowTabUrl === "string" ? message.flowTabUrl : session.flowTabUrl;
    adoptExtensionInstance(
      runtime,
      session,
      typeof message.extensionInstanceId === "string" ? message.extensionInstanceId : null
    );
    if (typeof message.bridgeUrl === "string" && message.bridgeUrl) {
      session.extensionBridgeUrl = message.bridgeUrl;
    }
    if (message.flowKeyPresent && !session.tokenCapturedAt) {
      session.tokenCapturedAt = Date.now();
    }
    runtime.defaultSessionId = session.id;
    return;
  }

  if (message.type === "token_captured") {
    session.flowKeyPresent = true;
    session.tokenCapturedAt = Date.now();
    adoptExtensionInstance(
      runtime,
      session,
      typeof message.extensionInstanceId === "string" ? message.extensionInstanceId : null
    );
    runtime.defaultSessionId = session.id;
    return;
  }

  if (message.type === "ping") {
    try {
      session.socket && session.socket.send(JSON.stringify({ type: "pong" }));
    } catch {}
    return;
  }

  if (message.type === "pong") return;

  const id = message.id;
  if (!id || !session.pending.has(id)) return;

  const pending = session.pending.get(id);
  session.pending.delete(id);
  clearTimeout(pending.timeout);

  if (message.error && message.status === undefined && message.data === undefined && message.result === undefined) {
    pending.reject(new Error(String(message.error)));
    return;
  }

  pending.resolve(message.result !== undefined ? message.result : message);
}

function attachFlowBridge(server, options = {}) {
  const runtime = getRuntime();
  if (options.expectedBridgeUrl) {
    runtime.expectedBridgeUrl = options.expectedBridgeUrl;
  }
  if (runtime.attached) return runtime;

  const path = options.path || DEFAULT_PATH;
  const WebSocket = require("ws");
  const wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname !== path) return;
    const remote = request.socket.remoteAddress || "";
    const isLocal =
      remote === "127.0.0.1" ||
      remote === "::1" ||
      remote === "::ffff:127.0.0.1";
    if (!isLocal) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws, request) => {
    const session = {
      id: crypto.randomUUID(),
      socket: ws,
      pending: new Map(),
      accountId: null,
      extensionInstanceId: null,
      connectedAt: Date.now(),
      disconnectedAt: null,
      flowKeyPresent: false,
      tokenCapturedAt: null,
      extensionBridgeUrl: null,
      remoteAddress: request.socket.remoteAddress || null,
      lastError: null,
      userAgent: request.headers["user-agent"] || null,
      flowTabUrl: null,
    };

    runtime.sessions.set(session.id, session);
    runtime.defaultSessionId = session.id;
    runtime.path = path;
    runtime.connectCount += 1;
    runtime.lastError = null;

    ws.on("message", (raw) => handleMessage(runtime, session, raw));
    ws.on("close", () => {
      runtime.disconnectCount += 1;
      session.disconnectedAt = Date.now();
      if (runtime.defaultSessionId === session.id) {
        runtime.defaultSessionId = sortSessionsForDefault(openSessions(runtime))[0]?.id ?? null;
      }
      rejectPending(session, new Error("Google Flow extension disconnected"));
    });
    ws.on("error", (error) => {
      session.lastError = error instanceof Error ? error.message : String(error);
      runtime.lastError = session.lastError;
    });
  });

  runtime.attached = true;
  runtime.path = path;
  runtime.expectedBridgeUrl = options.expectedBridgeUrl || runtime.expectedBridgeUrl;
  return runtime;
}

module.exports = {
  attachFlowBridge,
  getFlowBridge: getRuntime,
};
