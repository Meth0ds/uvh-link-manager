(function () {
  "use strict";

  const SOURCE = "uvh-hcaptcha-frame";
  const CHANNEL_PATTERN = /^[a-f0-9]{32}$/;
  const SITE_KEY_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
  let channel = "";
  let settings = null;
  let widgetId = null;
  let sdkReady = false;

  function post(type, detail) {
    if (!channel && type !== "frame-ready") return;
    parent.postMessage(Object.assign({ source: SOURCE, channel: channel, type: type }, detail || {}), "*");
  }

  function renderWidget() {
    if (!sdkReady || !settings || widgetId !== null || !window.hcaptcha) return;
    const target = document.getElementById("uvh-hcaptcha");
    if (!target) return;

    try {
      widgetId = window.hcaptcha.render(target, {
        sitekey: settings.siteKey,
        theme: settings.theme,
        size: settings.size,
        tabindex: 0,
        callback: function (token) {
          post("verified", { token: typeof token === "string" ? token : "" });
        },
        "expired-callback": function () { post("expired"); },
        "chalexpired-callback": function () { post("expired"); },
        "open-callback": function () { post("challenge-open"); },
        "close-callback": function () { post("challenge-close"); },
        "error-callback": function () { post("error"); },
      });
      post("ready");
    } catch (_) {
      post("error");
    }
  }

  window.uvhHcaptchaSdkReady = function () {
    sdkReady = true;
    renderWidget();
  };

  window.addEventListener("message", function (event) {
    if (event.source !== parent || !event.data || event.data.source !== "uvh-hcaptcha-host") return;
    const data = event.data;

    if (data.type === "init") {
      if (!CHANNEL_PATTERN.test(data.channel || "") || !SITE_KEY_PATTERN.test(data.siteKey || "")) return;
      channel = data.channel;
      settings = {
        siteKey: data.siteKey,
        theme: data.theme === "dark" ? "dark" : "light",
        size: data.size === "invisible" ? "invisible" : (data.size === "compact" ? "compact" : "normal"),
      };
      renderWidget();
      return;
    }

    if (!channel || data.channel !== channel) return;
    if (data.type === "reset" && widgetId !== null && window.hcaptcha) {
      try {
        window.hcaptcha.reset(widgetId);
        post("ready");
      } catch (_) {
        post("error");
      }
      return;
    }

    if (data.type === "execute" && widgetId !== null && window.hcaptcha) {
      try {
        // Every protected request gets a newly executed token. Resetting here
        // prevents an earlier, expired or already redeemed token from leaking
        // into a later login/registration attempt.
        window.hcaptcha.reset(widgetId);
        window.hcaptcha.execute(widgetId);
      } catch (_) {
        post("error");
      }
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { post("frame-ready"); }, { once: true });
  } else {
    post("frame-ready");
  }
})();
