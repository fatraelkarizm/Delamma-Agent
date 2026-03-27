import { agentLoop } from "./agent.js";
import { log } from "../lib/logger.js";
import { startPolling, sendMessage, sendHTML } from "./telegram.js";
import { config } from "./config.js";
import {
  queueOrRunControlCommand,
  showControlPlaneStatus,
  TELEGRAM_CONTROL_COMMAND_MAP,
} from "./control-plane-service.js";
import {
  showPositions,
  showBriefing,
  setPositionNote,
  closeScopedPosition,
} from "./telegram-view-service.js";
import { handleScopeBindingCommands } from "./telegram-command-service.js";
import { createScopedRunner } from "./scoped-runtime-factory.js";
import { isLocalAttachedScope, isTelegramExecutionBusy } from "./telegram-runtime-guards.js";

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

function getSessionScope(event, workerRuntime) {
  const tenantId = event?.session?.tenant_id || workerRuntime.context.tenantId;
  const walletId = event?.session?.wallet_id || workerRuntime.context.walletId;
  return { tenantId, walletId };
}

async function reply(chatId, text, { html = false } = {}) {
  if (html) {
    return sendHTML(text, { chatId });
  }
  return sendMessage(text, { chatId });
}

export function startTelegramRuntime({ runtimeState, refreshPrompt = () => {}, workerRuntime } = {}) {
  const scopedRunner = createScopedRunner({ workerIdPrefix: "telegram", channel: "telegram-gateway" });

  return startPolling(async (event) => {
    const scope = getSessionScope(event, workerRuntime);
    const text = String(event.text || "").trim();
    const chatId = event.chatId;

    if (!text) return;

    if (text === "/help" || text === "/startbot") {
      await reply(chatId, HELP_TEXT);
      return;
    }

    if (await handleScopeBindingCommands({ text, chatId, scope, reply })) {
      return;
    }

    if (text === "/status") {
      await showControlPlaneStatus({ chatId, scope, workerRuntime, reply });
      return;
    }

    if (text === "/positions") {
      await showPositions({ chatId, scope, workerRuntime, scopedRunner, reply });
      return;
    }

    if (text === "/briefing") {
      await showBriefing({ chatId, scope, scopedRunner, reply });
      return;
    }

    if (TELEGRAM_CONTROL_COMMAND_MAP[text]) {
      await queueOrRunControlCommand({
        chatId,
        scope,
        command: TELEGRAM_CONTROL_COMMAND_MAP[text],
        workerRuntime,
        reply,
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
        reply,
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
        reply,
      });
      return;
    }

    if (!isLocalAttachedScope(scope, workerRuntime)) {
      await reply(chatId, "Free-form chat is only enabled for the local attached wallet. For remote SaaS scopes, use the control commands from /help.");
      return;
    }

    if (isTelegramExecutionBusy(workerRuntime, runtimeState)) {
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
