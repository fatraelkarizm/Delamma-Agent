import { log } from "../lib/logger.js";
import { getMyPositions } from "../tools/dlmm.js";
import { stopPolling } from "./telegram.js";

export function createShutdownHandler({
  workerRuntime,
  onExit = (code) => process.exit(code),
} = {}) {
  if (!workerRuntime) {
    throw new Error("createShutdownHandler requires workerRuntime");
  }

  return async function shutdown(signal = "unknown") {
    log("shutdown", `Received ${signal}. Shutting down...`);
    stopPolling();
    await workerRuntime.stopCronJobs();
    const positions = await getMyPositions();
    log("shutdown", `Open positions at shutdown: ${positions.total_positions}`);
    await workerRuntime.destroy();
    onExit(0);
  };
}

export function registerSignalHandlers(shutdown) {
  process.on("SIGINT", () => {
    shutdown("SIGINT").catch(() => process.exit(1));
  });

  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch(() => process.exit(1));
  });
}
