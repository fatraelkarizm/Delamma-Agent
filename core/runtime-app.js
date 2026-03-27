import { agentLoop } from "./agent.js";
import { log } from "../lib/logger.js";
import { config } from "./config.js";
import { maybeRunMissedBriefing as maybeRunMissedBriefingService } from "./briefing-service.js";
import { startShellRuntime } from "./shell-runtime.js";
import { startTelegramRuntime } from "./telegram-runtime.js";
import { getDefaultWorkerRuntime } from "./worker-runtime.js";

const DEPLOY = config.management.deployAmountSol;

function createRuntimeState() {
  const sessionHistory = [];
  const MAX_HISTORY = 20;

  return {
    busy: false,
    sessionHistory,
    appendHistory(userMsg, assistantMsg) {
      sessionHistory.push({ role: "user", content: userMsg });
      sessionHistory.push({ role: "assistant", content: assistantMsg });
      if (sessionHistory.length > MAX_HISTORY) {
        sessionHistory.splice(0, sessionHistory.length - MAX_HISTORY);
      }
    },
  };
}

export async function runRuntimeApp({
  shutdown,
  isTTY = process.stdin.isTTY,
  workerRuntime = getDefaultWorkerRuntime(),
} = {}) {
  const runScoped = (fn) => workerRuntime.runInScope ? workerRuntime.runInScope(fn) : fn();

  if (!isTTY) {
    log("startup", "Non-TTY mode - starting cron cycles immediately.");
    await workerRuntime.ensureCronStarted();
    runScoped(() => maybeRunMissedBriefingService()).catch(() => {});

    try {
      await runScoped(() => agentLoop(`
STARTUP CHECK
1. get_wallet_balance. 2. get_my_positions. 3. If SOL >= ${config.management.minSolToOpen}: get_top_candidates then deploy ${DEPLOY} SOL. 4. Report.
      `, config.llm.maxSteps, [], "SCREENER"));
    } catch (e) {
      log("startup_error", e.message);
    }
    return;
  }

  const runtimeState = createRuntimeState();
  const { refreshPrompt } = await startShellRuntime({ shutdown, runtimeState, workerRuntime });
  startTelegramRuntime({ runtimeState, refreshPrompt, workerRuntime });
}
