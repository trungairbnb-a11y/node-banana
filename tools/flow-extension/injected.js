const SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";

window.addEventListener("GET_BANANA_FLOW_CAPTCHA", async ({ detail }) => {
  const { requestId, pageAction } = detail;
  try {
    await waitForGrecaptcha();
    const token = await window.grecaptcha.enterprise.execute(SITE_KEY, {
      action: pageAction,
    });
    window.dispatchEvent(new CustomEvent("BANANA_FLOW_CAPTCHA_RESULT", {
      detail: { requestId, token },
    }));
  } catch (error) {
    window.dispatchEvent(new CustomEvent("BANANA_FLOW_CAPTCHA_RESULT", {
      detail: {
        requestId,
        error: error && error.message ? error.message : String(error),
      },
    }));
  }
});

function waitForGrecaptcha(timeout = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (window.grecaptcha && window.grecaptcha.enterprise && window.grecaptcha.enterprise.execute) {
        resolve();
        return;
      }
      if (Date.now() - started > timeout) {
        reject(new Error("grecaptcha not available"));
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}
