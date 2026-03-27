import { log } from "../lib/logger.js";
import {
  bindTelegramChat,
  getTelegramSession,
  listTelegramScopesForChat,
  resolveTelegramChatIdsForScope,
  touchTelegramSession,
  upsertTelegramSession,
} from "../lib/telegram-state.js";
import { getRuntimeScope } from "./runtime-scope.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;
const BASE = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;
const ALLOWED_CHAT_IDS = new Set(
  String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

let offset = 0;
let polling = false;

function defaultScope() {
  return {
    tenantId: process.env.TENANT_ID || "local",
    walletId: process.env.WALLET_ID || process.env.WALLET_ADDRESS || "primary",
  };
}

function markdownToHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^###\s+(.*$)/gim, "<b>$1</b>")
    .replace(/^##\s+(.*$)/gim, "<b>$1</b>")
    .replace(/^#\s+(.*$)/gim, "<b>$1</b>")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function resolveScopeFromRuntime(options = {}) {
  if (options.tenantId && options.walletId) {
    return {
      tenantId: String(options.tenantId),
      walletId: String(options.walletId),
    };
  }

  const runtimeScope = getRuntimeScope();
  const workerContext = runtimeScope?.workerContext || null;
  if (workerContext?.tenantId && workerContext?.walletId) {
    return {
      tenantId: workerContext.tenantId,
      walletId: workerContext.walletId,
    };
  }

  return null;
}

function resolveChatTargets(options = {}) {
  if (options.chatId) {
    return [String(options.chatId)];
  }

  const scope = resolveScopeFromRuntime(options);
  const targets = new Set();

  if (scope?.tenantId && scope?.walletId) {
    for (const chatId of resolveTelegramChatIdsForScope(scope)) {
      targets.add(String(chatId));
    }
  }

  if (targets.size === 0 && process.env.TELEGRAM_CHAT_ID) {
    targets.add(String(process.env.TELEGRAM_CHAT_ID));
  }

  return [...targets];
}

async function postToTelegram(method, payload) {
  if (!BASE) return null;

  try {
    const response = await fetch(`${BASE}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log("telegram_error", `${method} ${response.status}: ${errorText.slice(0, 160)}`);
      return null;
    }

    return response.json();
  } catch (error) {
    log("telegram_error", `${method} failed: ${error.message}`);
    return null;
  }
}

async function sendHtmlToChat(chatId, html) {
  if (!TOKEN || !chatId) return false;

  const result = await postToTelegram("sendMessage", {
    chat_id: String(chatId),
    text: String(html).slice(0, 4096),
    parse_mode: "HTML",
  });

  return Boolean(result);
}

function isAuthorizedChat(chatId) {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) return false;

  if (ALLOWED_CHAT_IDS.size > 0) {
    return ALLOWED_CHAT_IDS.has(normalizedChatId);
  }

  if (process.env.TELEGRAM_CHAT_ID && normalizedChatId === String(process.env.TELEGRAM_CHAT_ID)) {
    return true;
  }

  if (getTelegramSession(normalizedChatId)) {
    return true;
  }

  return listTelegramScopesForChat(normalizedChatId).length > 0;
}

function ensureAuthorizedSession(chatId) {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) return null;
  if (!isAuthorizedChat(normalizedChatId)) return null;

  const existingSession = getTelegramSession(normalizedChatId);
  if (existingSession) {
    return touchTelegramSession(normalizedChatId) || existingSession;
  }

  const existingScopes = listTelegramScopesForChat(normalizedChatId);
  const scope = existingScopes[0] || defaultScope();
  const session = upsertTelegramSession({
    chatId: normalizedChatId,
    tenantId: scope.tenant_id || scope.tenantId,
    walletId: scope.wallet_id || scope.walletId,
    metadata: {
      initialized_by: existingScopes.length > 0 ? "binding" : "default_scope",
    },
  });

  if (!existingScopes.length && process.env.TELEGRAM_CHAT_ID && normalizedChatId === String(process.env.TELEGRAM_CHAT_ID)) {
    bindTelegramChat({
      chatId: normalizedChatId,
      tenantId: session?.tenant_id || defaultScope().tenantId,
      walletId: session?.wallet_id || defaultScope().walletId,
      notificationsEnabled: true,
      metadata: { source: "legacy_env_chat_id" },
    });
  }

  return session;
}

async function poll(onMessage) {
  while (polling) {
    try {
      const response = await fetch(
        `${BASE}/getUpdates?offset=${offset}&timeout=30`,
        { signal: AbortSignal.timeout(35_000) }
      );

      if (!response.ok) {
        await sleep(5000);
        continue;
      }

      const data = await response.json();
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        const message = update.message;
        if (!message?.text) continue;

        const chatId = String(message.chat.id);
        const session = ensureAuthorizedSession(chatId);

        if (!session) {
          await sendHtmlToChat(
            chatId,
            "Unauthorized chat. Bind this chat to a tenant/wallet scope from CLI before using the bot."
          );
          continue;
        }

        await onMessage({
          text: message.text,
          chatId,
          update,
          message,
          session,
          bindings: listTelegramScopesForChat(chatId),
          from: {
            id: message.from?.id ? String(message.from.id) : null,
            username: message.from?.username || null,
            first_name: message.from?.first_name || null,
            last_name: message.from?.last_name || null,
          },
        });
      }
    } catch (error) {
      if (!String(error?.message || "").includes("aborted")) {
        log("telegram_error", `Poll error: ${error.message}`);
      }
      await sleep(5000);
    }
  }
}

export function isEnabled() {
  return Boolean(TOKEN);
}

export async function sendMessage(text, options = {}) {
  const chatIds = resolveChatTargets(options);
  if (!TOKEN || chatIds.length === 0) return { sent: 0, chat_ids: [] };

  let sent = 0;
  for (const chatId of chatIds) {
    const ok = await sendHtmlToChat(chatId, markdownToHtml(text));
    if (ok) sent += 1;
  }

  return { sent, chat_ids: chatIds };
}

export async function sendHTML(html, options = {}) {
  const chatIds = resolveChatTargets(options);
  if (!TOKEN || chatIds.length === 0) return { sent: 0, chat_ids: [] };

  let sent = 0;
  for (const chatId of chatIds) {
    const ok = await sendHtmlToChat(chatId, html);
    if (ok) sent += 1;
  }

  return { sent, chat_ids: chatIds };
}

export function startPolling(onMessage) {
  if (!TOKEN || polling) return false;
  polling = true;
  void poll(onMessage);
  log("telegram", "Bot polling started");
  return true;
}

export function stopPolling() {
  polling = false;
}

export async function notifyDeploy({ pair, amountSol, position, tx, priceRange, binStep, baseFee }, options = {}) {
  const priceStr = priceRange
    ? `Price range: ${priceRange.min < 0.0001 ? priceRange.min.toExponential(3) : priceRange.min.toFixed(6)} - ${priceRange.max < 0.0001 ? priceRange.max.toExponential(3) : priceRange.max.toFixed(6)}\n`
    : "";
  const poolStr = (binStep || baseFee)
    ? `Bin step: ${binStep ?? "?"} | Base fee: ${baseFee != null ? `${baseFee}%` : "?"}\n`
    : "";

  return sendHTML(
    `Deployed <b>${pair}</b>\n` +
    `Amount: ${amountSol} SOL\n` +
    priceStr +
    poolStr +
    `Position: <code>${position?.slice(0, 8) || "?"}...</code>\n` +
    `Tx: <code>${tx?.slice(0, 16) || "?"}...</code>`,
    options
  );
}

export async function notifyClose({ pair, pnlUsd, pnlPct }, options = {}) {
  const sign = pnlUsd >= 0 ? "+" : "";
  return sendHTML(
    `Closed <b>${pair}</b>\n` +
    `PnL: ${sign}$${(pnlUsd ?? 0).toFixed(2)} (${sign}${(pnlPct ?? 0).toFixed(2)}%)`,
    options
  );
}

export async function notifySwap({ inputSymbol, outputSymbol, amountIn, amountOut, tx }, options = {}) {
  return sendHTML(
    `Swapped <b>${inputSymbol}</b> to <b>${outputSymbol}</b>\n` +
    `In: ${amountIn ?? "?"} | Out: ${amountOut ?? "?"}\n` +
    `Tx: <code>${tx?.slice(0, 16) || "?"}...</code>`,
    options
  );
}

export async function notifyOutOfRange({ pair, minutesOOR }, options = {}) {
  return sendHTML(
    `Out of range <b>${pair}</b>\n` +
    `Been out of range for ${minutesOOR} minutes`,
    options
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
