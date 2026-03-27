import { agentLoop } from "./agent.js";
import { log } from "../lib/logger.js";
import { getMyPositions, closePosition } from "../tools/dlmm.js";
import { startPolling, sendMessage, sendHTML } from "./telegram.js";
import { generateBriefing } from "../lib/briefing.js";
import { config } from "./config.js";
import { createWorkerContext } from "./tenant-context.js";
import { runWithRuntimeScope } from "./runtime-scope.js";
import { createWorkerStateStore } from "../lib/state.js";
import { createWorkerStrategyLibraryStore } from "../memory/strategy-library.js";
import { createWorkerLessonsStore } from "../memory/lessons.js";
import { createWorkerPoolMemoryStore } from "../memory/pool-memory.js";
import { createWorkerSmartWalletStore } from "../memory/smart-wallets.js";
import { createWorkerTokenBlacklistStore } from "../memory/token-blacklist.js";
import { runBriefing } from "./briefing-service.js";
import {
  bindTelegramChat,
  listTelegramScopesForChat,
  unbindTelegramChat,
  upsertTelegramSession,
} from "../lib/telegram-state.js";
import {
  createWorkerControlRequest,
  listWorkerControlRequests,
  listWorkerRuntimeState,
} from "../lib/db.js";

const HELP_TEXT = [
  "Telegram control plane",
  "",
  "/help - show commands",
  "/scope - show current tenant/wallet scope",
  "/scope <tenant> <wallet> - switch active scope for this chat",
  "/bindings - list notification bindings for this chat",
  "/bind [tenant wallet] - bind this chat to current scope notifications",
  "/unbind [tenant wallet] - remove notification binding",
  "/status - show worker/control status for current scope",
  "/positions - show positions for current scope",
  "/briefing - show scoped briefing snapshot",
  "/launch - queue launch_worker",
  "/restartworker - queue restart_worker",
  "/start - start cron for current scope",
  "/restart - restart cron for current scope",
  "/stop - stop cron for current scope",
  "/manage - run one management cycle",
  "/screen - run one screening cycle",
  "/briefingrun - queue briefing execution",
  "/shutdown - queue shutdown_worker",
  "/set <n> <note> - set instruction on tracked position",
  "/close <n> - close a live local position on attached wallet only",
  "",
  "Free-form chat stays local-only. Remote SaaS scopes use control commands above.",
].join("\n");

const CONTROL_COMMAND_MAP = {
  "/launch": "launch_worker",
  "/restartworker": "restart_worker",
  "/start": "start_cron",
  "/restart": "restart_cron",
  "/stop": "stop_cron",
  "/manage": "run_management_cycle",
  "/screen": "run_screening_cycle",
  "/briefingrun": "run_briefing",
  "/shutdown": "shutdown_worker",
};

function createHistoryStore(runtimeState) {
  if (!runtimeState.telegramHistory) {
    runtimeState.telegramHistory = new Map();
  }
  return runtimeState.telegramHistory;
}

function historyForChat(runtimeState, chatId) {
  const histories = createHistoryStore(runtimeState);
  if (!histories.has(chatId)) {
    histories.set(chatId, []);
  }
  return histories.get(chatId);
}

function appendHistory(runtimeState, chatId, userMsg, assistantMsg) {
  const history = historyForChat(runtimeState, chatId);
  history.push({ role: "user", content: userMsg });
  history.push({ role: "assistant", content: assistantMsg });
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
}

function formatScope(scope) {
  return `${scope.tenantId}/${scope.walletId}`;
}

function sameScope(left, right) {
  return Boolean(
    left?.tenantId &&
    left?.walletId &&
    right?.tenantId &&
    right?.walletId &&
    left.tenantId === right.tenantId &&
    left.walletId === right.walletId
  );
}

function supportsLocalExecution(workerRuntime) {
  return workerRuntime?.supportsLocalExecution !== false;
}

function parseScopeInput(text) {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  return {
    tenantId: parts[1],
    walletId: parts[2],
  };
}

function createScopedRunner() {
  const cache = new Map();

  function getScopeRuntime(scope) {
    const key = `${scope.tenantId}:${scope.walletId}`;
    if (cache.has(key)) {
      return cache.get(key);
    }

    const workerContext = createWorkerContext({
      tenantId: scope.tenantId,
      walletId: scope.walletId,
      workerId: `telegram:${scope.tenantId}:${scope.walletId}`,
      mode: "telegram",
      channel: "telegram-gateway",
    });

    const scopedRuntime = {
      workerContext,
      stateStore: createWorkerStateStore(workerContext),
      strategyLibraryStore: createWorkerStrategyLibraryStore(workerContext),
      lessonsStore: createWorkerLessonsStore(workerContext),
      poolMemoryStore: createWorkerPoolMemoryStore(workerContext),
      smartWalletStore: createWorkerSmartWalletStore(workerContext),
      tokenBlacklistStore: createWorkerTokenBlacklistStore(workerContext),
    };

    cache.set(key, scopedRuntime);
    return scopedRuntime;
  }

  return {
    getScopeRuntime,
    run(scope, fn) {
      return runWithRuntimeScope(getScopeRuntime(scope), fn);
    },
  };
}

function getSessionScope(event, workerRuntime) {
  const tenantId = event?.session?.tenant_id || workerRuntime.context.tenantId;
  const walletId = event?.session?.wallet_id || workerRuntime.context.walletId;
  return { tenantId, walletId };
}

function canUseLiveWallet(scope, workerRuntime) {
  return supportsLocalExecution(workerRuntime) &&
    sameScope(scope, workerRuntime.context) &&
    Boolean(process.env.WALLET_PRIVATE_KEY);
}

async function reply(chatId, text, { html = false } = {}) {
  if (html) {
    return sendHTML(text, { chatId });
  }
  return sendMessage(text, { chatId });
}

async function showPositions({ chatId, scope, workerRuntime, scopedRunner }) {
  if (canUseLiveWallet(scope, workerRuntime)) {
    const { positions, total_positions } = await workerRuntime.runInScope(() => getMyPositions({ force: true }));
    if (total_positions === 0) {
      await reply(chatId, `No live open positions for ${formatScope(scope)}.`);
      return;
    }

    const lines = positions.map((position, index) => {
      const age = position.age_minutes != null ? `${position.age_minutes}m` : "?";
      const fees = position.unclaimed_fees_usd ?? 0;
      return `${index + 1}. ${position.pair} | fees $${fees} | age ${age} | ${position.in_range ? "in-range" : "out-of-range"}`;
    });

    await reply(chatId, `Live positions for ${formatScope(scope)}:\n\n${lines.join("\n")}`);
    return;
  }

  const scopedState = scopedRunner.getScopeRuntime(scope).stateStore.load();
  const openPositions = Object.values(scopedState.positions || {}).filter((position) => !position.closed);

  if (openPositions.length === 0) {
    await reply(chatId, `No tracked positions for ${formatScope(scope)}.`);
    return;
  }

  const lines = openPositions.map((position, index) => {
    const deployedAt = position.deployed_at ? position.deployed_at.slice(0, 16).replace("T", " ") : "unknown";
    return `${index + 1}. ${position.pool_name || position.pool} | strategy ${position.strategy || "?"} | deployed ${deployedAt}`;
  });

  await reply(chatId, `Tracked positions for ${formatScope(scope)}:\n\n${lines.join("\n")}`);
}

async function showBriefing({ chatId, scope, scopedRunner }) {
  const scopedRuntime = scopedRunner.getScopeRuntime(scope);
  const briefing = await scopedRunner.run(scope, () => generateBriefing({
    state: scopedRuntime.stateStore.load(),
    lessonsData: scopedRuntime.lessonsStore.load(),
    perfSummary: scopedRuntime.lessonsStore.getPerformanceSummary(),
  }));

  await reply(chatId, briefing, { html: true });
}

async function showBindings(chatId) {
  const bindings = listTelegramScopesForChat(chatId);
  if (bindings.length === 0) {
    await reply(chatId, "No notification bindings saved for this chat.");
    return;
  }

  const lines = bindings.map((binding, index) => (
    `${index + 1}. ${binding.tenant_id}/${binding.wallet_id} | notifications ${binding.notifications_enabled ? "on" : "off"}`
  ));
  await reply(chatId, `Bindings for this chat:\n\n${lines.join("\n")}`);
}

async function showStatus({ chatId, scope, workerRuntime }) {
  const runtime = await listWorkerRuntimeState();
  const requests = await listWorkerControlRequests({
    tenant_id: scope.tenantId,
    wallet_id: scope.walletId,
    limit: 5,
  });

  const workers = runtime?.workers?.filter((worker) => (
    worker.tenant_id === scope.tenantId && worker.wallet_id === scope.walletId
  )) || [];
  const leases = runtime?.wallet_leases?.filter((lease) => (
    lease.tenant_id === scope.tenantId && lease.wallet_id === scope.walletId
  )) || [];

  const lines = [
    `Scope: ${formatScope(scope)}`,
    `Local worker attached: ${sameScope(scope, workerRuntime.context) && supportsLocalExecution(workerRuntime) ? "yes" : "no"}`,
    `Workers visible: ${workers.length}`,
    `Leases visible: ${leases.length}`,
  ];

  if (workers.length > 0) {
    lines.push("");
    lines.push("Workers:");
    for (const worker of workers.slice(0, 4)) {
      lines.push(`- ${worker.worker_id} | ${worker.status || "unknown"} | seen ${worker.last_seen_at || "unknown"}`);
    }
  }

  if (requests?.length > 0) {
    lines.push("");
    lines.push("Recent requests:");
    for (const request of requests.slice(0, 4)) {
      lines.push(`- #${request.id} ${request.command} | ${request.status}`);
    }
  }

  if (!runtime) {
    lines.push("");
    lines.push("Runtime DB state unavailable here. Local control still works for the attached scope.");
  }

  await reply(chatId, lines.join("\n"));
}

async function queueOrRunControl({ chatId, scope, command, workerRuntime }) {
  if (supportsLocalExecution(workerRuntime) && sameScope(scope, workerRuntime.context)) {
    switch (command) {
      case "start_cron":
        await workerRuntime.ensureCronStarted();
        await reply(chatId, `Started cron for local scope ${formatScope(scope)}.`);
        return;
      case "restart_cron":
        await workerRuntime.restartCronJobsIfStarted();
        await reply(chatId, `Restarted cron for local scope ${formatScope(scope)}.`);
        return;
      case "stop_cron":
        await workerRuntime.stopCronJobs();
        await reply(chatId, `Stopped cron for local scope ${formatScope(scope)}.`);
        return;
      case "run_management_cycle": {
        const report = await workerRuntime.runManagementCycle({ silent: true });
        await reply(chatId, report || `Management cycle finished for ${formatScope(scope)}.`);
        return;
      }
      case "run_screening_cycle": {
        const report = await workerRuntime.runScreeningCycle({ silent: true });
        await reply(chatId, report || `Screening cycle finished for ${formatScope(scope)}.`);
        return;
      }
      case "run_briefing":
        await workerRuntime.runInScope(() => runBriefing());
        await reply(chatId, `Ran briefing locally for ${formatScope(scope)}.`);
        return;
      case "shutdown_worker":
        await reply(chatId, "Shutdown requested for the local attached worker.");
        process.nextTick(() => {
          workerRuntime.destroy().finally(() => process.exit(0));
        });
        return;
      case "launch_worker":
        await reply(chatId, "This chat is already attached to the local worker. Use /start or /restart instead.");
        return;
      case "restart_worker":
        await reply(chatId, "Full restart_worker needs the supervisor loop. Use /restart for the local attached worker.");
        return;
      default:
        break;
    }
  }

  const queued = await createWorkerControlRequest({
    tenant_id: scope.tenantId,
    wallet_id: scope.walletId,
    requested_by: `telegram:${chatId}`,
    command,
    payload: {
      source: "telegram",
      chat_id: chatId,
    },
  });

  if (!queued) {
    await reply(chatId, `Failed to queue ${command} for ${formatScope(scope)}. DB-backed control plane is unavailable here.`);
    return;
  }

  await reply(chatId, `Queued ${command} for ${formatScope(scope)} as request #${queued.id}.`);
}

async function setPositionNote({ chatId, scope, scopedRunner, index, note }) {
  const scopedRuntime = scopedRunner.getScopeRuntime(scope);
  const openPositions = Object.values(scopedRuntime.stateStore.load().positions || {}).filter((position) => !position.closed);
  const position = openPositions[index];

  if (!position) {
    await reply(chatId, "Invalid number. Use /positions first.");
    return;
  }

  scopedRuntime.stateStore.setPositionInstruction(position.position, note);
  await reply(chatId, `Note set for ${position.pool_name || position.pool} in ${formatScope(scope)}:\n"${note}"`);
}

async function closeScopedPosition({ chatId, scope, workerRuntime, index }) {
  if (!canUseLiveWallet(scope, workerRuntime)) {
    await reply(chatId, "Direct /close only works for the local attached wallet scope. Use control commands for remote SaaS workers.");
    return;
  }

  const { positions } = await workerRuntime.runInScope(() => getMyPositions({ force: true }));
  const position = positions[index];
  if (!position) {
    await reply(chatId, "Invalid number. Use /positions first.");
    return;
  }

  await reply(chatId, `Closing ${position.pair} on ${formatScope(scope)}...`);
  const result = await workerRuntime.runInScope(() => closePosition({ position_address: position.position }));
  if (result.success) {
    await reply(chatId, `Closed ${position.pair}\nPnL: $${result.pnl_usd ?? "?"}`);
    return;
  }

  await reply(chatId, `Close failed: ${JSON.stringify(result)}`);
}

export function startTelegramRuntime({ runtimeState, refreshPrompt = () => {}, workerRuntime } = {}) {
  const scopedRunner = createScopedRunner();

  return startPolling(async (event) => {
    const scope = getSessionScope(event, workerRuntime);
    const text = String(event.text || "").trim();
    const chatId = event.chatId;

    if (!text) return;

    if (text === "/help" || text === "/startbot") {
      await reply(chatId, HELP_TEXT);
      return;
    }

    if (text === "/scope") {
      await reply(chatId, `Current scope: ${formatScope(scope)}`);
      return;
    }

    if (text.startsWith("/scope ")) {
      const nextScope = parseScopeInput(text);
      if (!nextScope) {
        await reply(chatId, "Usage: /scope <tenant> <wallet>");
        return;
      }

      upsertTelegramSession({
        chatId,
        tenantId: nextScope.tenantId,
        walletId: nextScope.walletId,
        metadata: { updated_by: "telegram_command" },
      });
      await reply(chatId, `Active scope changed to ${formatScope(nextScope)}.`);
      return;
    }

    if (text === "/bindings") {
      await showBindings(chatId);
      return;
    }

    if (text === "/bind" || text.startsWith("/bind ")) {
      const explicitScope = parseScopeInput(text);
      const targetScope = explicitScope || scope;
      const binding = bindTelegramChat({
        chatId,
        tenantId: targetScope.tenantId,
        walletId: targetScope.walletId,
        notificationsEnabled: true,
        metadata: { source: "telegram_command" },
      });

      if (!binding) {
        await reply(chatId, "Failed to bind this chat. Use /bind <tenant> <wallet>.");
        return;
      }

      upsertTelegramSession({
        chatId,
        tenantId: targetScope.tenantId,
        walletId: targetScope.walletId,
        metadata: { bound_at: new Date().toISOString() },
      });
      await reply(chatId, `Bound this chat to ${formatScope(targetScope)} notifications.`);
      return;
    }

    if (text === "/unbind" || text.startsWith("/unbind ")) {
      const explicitScope = parseScopeInput(text);
      const targetScope = explicitScope || scope;
      const result = unbindTelegramChat({
        chatId,
        tenantId: targetScope.tenantId,
        walletId: targetScope.walletId,
      });
      await reply(chatId, result.removed > 0
        ? `Removed binding for ${formatScope(targetScope)}.`
        : `No binding found for ${formatScope(targetScope)}.`);
      return;
    }

    if (text === "/status") {
      await showStatus({ chatId, scope, workerRuntime });
      return;
    }

    if (text === "/positions") {
      await showPositions({ chatId, scope, workerRuntime, scopedRunner });
      return;
    }

    if (text === "/briefing") {
      await showBriefing({ chatId, scope, scopedRunner });
      return;
    }

    if (CONTROL_COMMAND_MAP[text]) {
      await queueOrRunControl({
        chatId,
        scope,
        command: CONTROL_COMMAND_MAP[text],
        workerRuntime,
      });
      return;
    }

    const closeMatch = text.match(/^\/close\s+(\d+)$/i);
    if (closeMatch) {
      await closeScopedPosition({
        chatId,
        scope,
        workerRuntime,
        index: parseInt(closeMatch[1], 10) - 1,
      });
      return;
    }

    const setMatch = text.match(/^\/set\s+(\d+)\s+(.+)$/i);
    if (setMatch) {
      await setPositionNote({
        chatId,
        scope,
        scopedRunner,
        index: parseInt(setMatch[1], 10) - 1,
        note: setMatch[2].trim(),
      });
      return;
    }

    if (!supportsLocalExecution(workerRuntime) || !sameScope(scope, workerRuntime.context)) {
      await reply(chatId, "Free-form chat is only enabled for the local attached wallet. For remote SaaS scopes, use the control commands from /help.");
      return;
    }

    if (workerRuntime.isExecutionBusy() || runtimeState.busy) {
      await reply(chatId, "Agent is busy right now. Try again in a moment.");
      return;
    }

    runtimeState.busy = true;
    try {
      log("telegram", `Incoming local chat: ${text}`);
      const hasCloseIntent = /\bclose\b|\bsell\b|\bexit\b|\bwithdraw\b/i.test(text);
      const isDeployRequest = !hasCloseIntent && /\bdeploy\b|\bopen position\b|\blp into\b|\badd liquidity\b/i.test(text);
      const agentRole = isDeployRequest ? "SCREENER" : "GENERAL";
      const history = historyForChat(runtimeState, chatId);
      const { content } = await workerRuntime.runInScope(() => (
        agentLoop(text, config.llm.maxSteps, history, agentRole, config.llm.generalModel)
      ));
      appendHistory(runtimeState, chatId, text, content);
      await reply(chatId, content);
    } catch (error) {
      await reply(chatId, `Error: ${error.message}`);
    } finally {
      runtimeState.busy = false;
      refreshPrompt();
    }
  });
}
