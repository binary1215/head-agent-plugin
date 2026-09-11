process.send?.({ type: "ready", pid: process.pid });
process.disconnect?.();
setInterval(() => {}, 1_000);
