import { log } from "../lib/logger.js";
import { registerCronRestarter } from "../tools/executor.js";
import { runRuntimeApp } from "./runtime-app.js";
import { createShutdownHandler, registerSignalHandlers } from "./runtime-lifecycle.js";
import { getDefaultWorkerRuntime } from "./worker-runtime.js";

export async function bootstrapRuntime({
  workerRuntime = getDefaultWorkerRuntime(),
} = {}) {
  log("startup", "DLMM LP Agent starting...");
  log("startup", `Mode: ${process.env.DRY_RUN === "true" ? "DRY RUN" : "LIVE"}`);
  log("startup", `Model: ${process.env.LLM_MODEL || "hermes-3-405b"}`);
  log("startup", `Worker: ${workerRuntime.label}`);

  const shutdown = createShutdownHandler({ workerRuntime });
  registerSignalHandlers(shutdown);

  registerCronRestarter(() => workerRuntime.restartCronJobsIfStarted());
  await runRuntimeApp({ shutdown, workerRuntime });
}
