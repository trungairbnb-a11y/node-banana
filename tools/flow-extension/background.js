const DEFAULT_WS_PORTS = [3000, 3001, 3002, 3003, 3004];

const TWO_CAPTCHA_CREATE_URL = "https://api.2captcha.com/createTask";
const TWO_CAPTCHA_RESULT_URL = "https://api.2captcha.com/getTaskResult";
let lastCaptchaStatus = null; // Tracks current captcha solving status
let twoCaptchaApiKey = null;

let ws = null;
let flowKey = null;
let tokenCapturedAt = null;
let reconnectTimer = null;
let manualDisconnect = false;
let wsPortIndex = 0;
let activeWsUrl = null;
let extensionInstanceId = null;

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "banana-flow-keepalive") keepAlive();
});

async function init() {
  const stored = await chrome.storage.local.get(["flowKey", "tokenCapturedAt", "extensionInstanceId", "twoCaptchaApiKey"]);
  flowKey = stored.flowKey || null;
  tokenCapturedAt = stored.tokenCapturedAt || null;
  extensionInstanceId = stored.extensionInstanceId || null;
  twoCaptchaApiKey = stored.twoCaptchaApiKey || null;
  if (!extensionInstanceId) {
    extensionInstanceId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await chrome.storage.local.set({ extensionInstanceId });
  }
  connect();
  chrome.alarms.create("banana-flow-keepalive", { periodInMinutes: 0.4 });
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const authHeader = (details.requestHeaders || []).find((header) => header.name && header.name.toLowerCase() === "authorization");
    const value = authHeader && authHeader.value ? authHeader.value : "";
    if (!value.startsWith("Bearer ya29.")) return;
    flowKey = value.replace(/^Bearer\s+/i, "").trim();
    tokenCapturedAt = Date.now();
    chrome.storage.local.set({ flowKey, tokenCapturedAt, extensionInstanceId });
    send({ type: "token_captured", flowKey, extensionInstanceId });
  },
  { urls: ["https://aisandbox-pa.googleapis.com/*", "https://labs.google/*"] },
  ["requestHeaders", "extraHeaders"],
);

function connect() {
  if (manualDisconnect) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  activeWsUrl = `ws://127.0.0.1:${DEFAULT_WS_PORTS[wsPortIndex]}/flow-bridge`;
  ws = new WebSocket(activeWsUrl);
  ws.onopen = async () => {
    clearTimeout(reconnectTimer);
    send({
      type: "extension_ready",
      extensionInstanceId,
      flowKeyPresent: !!flowKey,
      tokenAge: tokenCapturedAt ? Date.now() - tokenCapturedAt : null,
      bridgeUrl: activeWsUrl,
      userAgent: navigator.userAgent,
      flowTabUrl: await queryFlowTabUrl(),
    });
    if (flowKey) send({ type: "token_captured", flowKey, extensionInstanceId });
  };
  ws.onmessage = async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.method === "api_request") {
      await handleApiRequest(message);
    } else if (message.method === "trpc_request") {
      await handleTrpcRequest(message);
    } else if (message.method === "get_status") {
      send({
        id: message.id,
        result: {
          connected: ws && ws.readyState === WebSocket.OPEN,
          extensionInstanceId,
          flowKeyPresent: !!flowKey,
          tokenAge: tokenCapturedAt ? Date.now() - tokenCapturedAt : null,
          bridgeUrl: activeWsUrl,
          userAgent: navigator.userAgent,
          flowTabUrl: await queryFlowTabUrl(),
        },
      });
    } else if (message.type === "pong") {
      // keepalive
    }
  };
  ws.onclose = scheduleReconnect;
  ws.onerror = scheduleReconnect;
}

function scheduleReconnect() {
  if (manualDisconnect) return;
  clearTimeout(reconnectTimer);
  wsPortIndex = (wsPortIndex + 1) % DEFAULT_WS_PORTS.length;
  reconnectTimer = setTimeout(connect, 2000);
}

function keepAlive() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    send({ type: "ping" });
  } else {
    connect();
  }
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

async function getFlowTab() {
  const tabs = await chrome.tabs.query({
    url: ["https://labs.google/fx/tools/flow*", "https://labs.google/fx/*/tools/flow*"],
  });
  if (tabs.length) return tabs[0];
  return await chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: false });
}

async function queryFlowTabUrl() {
  const tabs = await chrome.tabs.query({
    url: ["https://labs.google/fx/tools/flow*", "https://labs.google/fx/*/tools/flow*"],
  });
  return tabs[0]?.url || null;
}

async function requestCaptcha(requestId, pageAction) {
  // Attempt to get captcha token via injected script first
  const nativeResult = await sendFlowTabMessage({
    type: "GET_BANANA_FLOW_CAPTCHA",
    requestId,
    pageAction,
  });

  // If native succeeded with token, return it
  if (nativeResult && nativeResult.token) {
    return nativeResult;
  }

  // If native failed (error present), fallback to 2Captcha
  lastCaptchaStatus = "Solving with 2Captcha...";
  send({ type: "captcha_status", status: lastCaptchaStatus });
  const token = await solveWith2Captcha(pageAction);
  if (token) {
    lastCaptchaStatus = "2Captcha Ready";
    send({ type: "captcha_status", status: lastCaptchaStatus });
    return { token };
  }
  lastCaptchaStatus = "2Captcha Failed";
  send({ type: "captcha_status", status: lastCaptchaStatus });
  return { error: "2CAPTCHA_FAILED" };
}

// Solve recaptcha via 2Captcha service (proxyless Enterprise task)
async function solveWith2Captcha(pageAction) {
  const apiKey = String(twoCaptchaApiKey || "").trim();
  if (!apiKey) {
    console.warn("2Captcha API key is not configured in extension storage; skipping 2Captcha fallback");
    return null;
  }

  try {
    // 1. Create task
    const createRes = await fetch(TWO_CAPTCHA_CREATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: "RecaptchaV2EnterpriseTaskProxyless",
          websiteURL: "https://labs.google/fx/tools/flow",
          websiteKey: "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV",
          enterprisePayload: { action: pageAction },
        },
      }),
    });
    const createData = await createRes.json();
    if (!createData || createData.errorId) {
      console.error("2Captcha createTask error", createData);
      return null;
    }
    const taskId = createData.taskId;

    // 2. Poll for result
    for (let attempt = 0; attempt < 24; attempt++) { // up to ~2 minutes
      await new Promise((r) => setTimeout(r, 5000));
      const resultRes = await fetch(TWO_CAPTCHA_RESULT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      });
      const resultData = await resultRes.json();
      if (resultData && resultData.status === "ready" && resultData.solution && resultData.solution.gRecaptchaResponse) {
        return resultData.solution.gRecaptchaResponse;
      }
      if (resultData && resultData.errorId) {
        console.error("2Captcha getTaskResult error", resultData);
        return null;
      }
    }
    console.warn("2Captcha polling timed out");
    return null;
  } catch (e) {
    console.error("2Captcha solving exception", e);
    return null;
  }
}

async function requestFlowFetch(params) {
  return await sendFlowTabMessage({
    type: "BANANA_FLOW_FETCH",
    params,
  });
}

async function sendFlowTabMessage(message) {
  const tab = await getFlowTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    await sleep(200);
    return await chrome.tabs.sendMessage(tab.id, message);
  }
}

async function handleApiRequest(message) {
  const { id, params } = message;
  const { url, method = "POST", headers = {}, body, captchaAction } = params || {};
  if (!url || !url.startsWith("https://aisandbox-pa.googleapis.com/")) {
    send({ id, error: "INVALID_FLOW_API_URL" });
    return;
  }

  let finalBody = body;
  if (captchaAction) {
    const captcha = await requestCaptcha(id, captchaAction);
    if (!captcha || !captcha.token) {
      send({ id, status: 403, error: `CAPTCHA_FAILED: ${captcha && captcha.error ? captcha.error : "NO_TOKEN"}` });
      return;
    }
    finalBody = JSON.parse(JSON.stringify(body || {}));
    injectCaptcha(finalBody, captcha.token);
  }

  if (!flowKey) {
    send({ id, status: 503, error: "NO_FLOW_KEY" });
    return;
  }

  try {
    const proxied = await requestFlowFetch({
      url,
      method,
      headers: {
        ...headers,
        authorization: `Bearer ${flowKey}`,
      },
      body: finalBody || null,
    });
    send({ id, status: proxied.status, data: proxied.data, error: proxied.error });
  } catch (error) {
    send({ id, status: 500, error: error && error.message ? error.message : String(error) });
  }
}

async function handleTrpcRequest(message) {
  const { id, params } = message;
  const { url, method = "POST", headers = {}, body } = params || {};
  if (!url || !url.startsWith("https://labs.google/")) {
    send({ id, error: "INVALID_FLOW_TRPC_URL" });
    return;
  }

  try {
    const requestHeaders = { ...headers };
    if (flowKey) requestHeaders.authorization = `Bearer ${flowKey}`;
    const proxied = await requestFlowFetch({
      url,
      method,
      headers: requestHeaders,
      body: body || null,
    });
    send({ id, status: proxied.status, data: proxied.data, error: proxied.error });
  } catch (error) {
    send({ id, status: 500, error: error && error.message ? error.message : String(error) });
  }
}

function injectCaptcha(body, token) {
  if (body.clientContext && body.clientContext.recaptchaContext) {
    body.clientContext.recaptchaContext.token = token;
  }
  if (Array.isArray(body.requests)) {
    for (const request of body.requests) {
      if (request.clientContext && request.clientContext.recaptchaContext) {
        request.clientContext.recaptchaContext.token = token;
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "https://labs.google/fx/tools/flow" });
});
