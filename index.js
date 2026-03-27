import "dotenv/config";
import { log } from "./lib/logger.js";
import { getMyPositions } from "./tools/dlmm.js";
import { registerCronRestarter } from "./tools/executor.js";
import { stopPolling } from "./core/telegram.js";
import { runRuntimeApp } from "./core/runtime-app.js";
import { getDefaultWorkerRuntime } from "./core/worker-runtime.js";

log("startup", "DLMM LP Agent starting...");
log("startup", `Mode: ${process.env.DRY_RUN === "true" ? "DRY RUN" : "LIVE"}`);
log("startup", `Model: ${process.env.LLM_MODEL || "hermes-3-405b"}`);

const defaultWorkerRuntime = getDefaultWorkerRuntime();
log("startup", `Worker: ${defaultWorkerRuntime.label}`);

async function shutdown(signal) {
  log("shutdown", `Received ${signal}. Shutting down...`);
  stopPolling();
  await defaultWorkerRuntime.stopCronJobs();
  const positions = await getMyPositions();
  log("shutdown", `Open positions at shutdown: ${positions.total_positions}`);
  await defaultWorkerRuntime.destroy();
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch(() => process.exit(1));
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch(() => process.exit(1));
});

registerCronRestarter(() => {
  return defaultWorkerRuntime.restartCronJobsIfStarted();
});

await runRuntimeApp({ shutdown, workerRuntime: defaultWorkerRuntime });
