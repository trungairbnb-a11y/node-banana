(function inject() {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
})();

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.type === "BANANA_FLOW_FETCH") {
    performFlowFetch(message.params)
      .then(reply)
      .catch((error) => reply({
        status: 500,
        error: error && error.message ? error.message : String(error),
      }));
    return true;
  }

  if (message.type !== "GET_BANANA_FLOW_CAPTCHA") return;

  const requestId = message.requestId;
  const handler = (event) => {
    if (!event.detail || event.detail.requestId !== requestId) return;
    window.removeEventListener("BANANA_FLOW_CAPTCHA_RESULT", handler);
    clearTimeout(timer);
    reply({ token: event.detail.token, error: event.detail.error });
  };

  const timer = setTimeout(() => {
    window.removeEventListener("BANANA_FLOW_CAPTCHA_RESULT", handler);
    reply({ error: "CONTENT_TIMEOUT" });
  }, 25000);

  window.addEventListener("BANANA_FLOW_CAPTCHA_RESULT", handler);
  window.dispatchEvent(new CustomEvent("GET_BANANA_FLOW_CAPTCHA", {
    detail: {
      requestId,
      pageAction: message.pageAction || "VIDEO_GENERATION",
    },
  }));

  return true;
});

async function performFlowFetch(params) {
  const { url, method = "POST", headers = {}, body } = params || {};
  if (
    !url ||
    (
      !url.startsWith("https://aisandbox-pa.googleapis.com/") &&
      !url.startsWith("https://labs.google/")
    )
  ) {
    return { status: 400, error: "INVALID_FLOW_FETCH_URL" };
  }

  const requestHeaders = { ...headers };
  delete requestHeaders.referer;
  delete requestHeaders.Referer;
  delete requestHeaders.origin;
  delete requestHeaders.Origin;

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
    credentials: "include",
    referrer: window.location.href,
    referrerPolicy: "strict-origin-when-cross-origin",
  });
  const text = await response.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: response.status, data };
}
