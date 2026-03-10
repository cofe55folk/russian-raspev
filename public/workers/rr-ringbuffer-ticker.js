let tickTimer = null;

function stopTicker() {
  if (tickTimer == null) return;
  clearInterval(tickTimer);
  tickTimer = null;
}

self.onmessage = (event) => {
  const message = event?.data || {};
  const type = message.type;

  if (type === "start") {
    stopTicker();
    const intervalMs = Math.max(8, Number(message.intervalMs) || 20);
    tickTimer = setInterval(() => {
      self.postMessage({
        type: "tick",
        ts: typeof performance !== "undefined" ? performance.now() : Date.now(),
      });
    }, intervalMs);
    return;
  }

  if (type === "stop") {
    stopTicker();
  }
};
