/**
 * Offline smoke test for Telegram binding/session state.
 * Run: node test/test-telegram-state.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  bindTelegramChat,
  clearTelegramSession,
  getTelegramSession,
  listTelegramBindings,
  listTelegramScopesForChat,
  resolveTelegramChatIdsForScope,
  touchTelegramSession,
  unbindTelegramChat,
  upsertTelegramSession,
} from "../lib/telegram-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const telegramDir = path.join(repoRoot, "data", "telegram");
const bindingsFile = path.join(telegramDir, "chat-bindings.json");
const sessionsFile = path.join(telegramDir, "chat-sessions.json");

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

function restoreFile(filePath, originalContent) {
  if (originalContent === null) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, originalContent);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const originalBindings = readIfExists(bindingsFile);
  const originalSessions = readIfExists(sessionsFile);

  const chatId = "telegram-smoke-chat";
  const scopeA = { tenantId: "tenant-a", walletId: "wallet-a" };
  const scopeB = { tenantId: "tenant-a", walletId: "wallet-b" };

  try {
    // Ensure clean slate for this chat.
    unbindTelegramChat({ chatId });
    clearTelegramSession(chatId);

    const first = bindTelegramChat({
      chatId,
      tenantId: scopeA.tenantId,
      walletId: scopeA.walletId,
      notificationsEnabled: true,
      metadata: { source: "smoke" },
    });
    assert(first?.chat_id === chatId, "bindTelegramChat should create binding");

    const second = bindTelegramChat({
      chatId,
      tenantId: scopeB.tenantId,
      walletId: scopeB.walletId,
      notificationsEnabled: true,
      metadata: { source: "smoke-2" },
    });
    assert(second?.wallet_id === scopeB.walletId, "second scope binding should be saved");

    const allForChat = listTelegramBindings({ chatId });
    assert(allForChat.length >= 2, "listTelegramBindings(chatId) should include both scopes");

    const scopedChats = resolveTelegramChatIdsForScope(scopeA);
    assert(scopedChats.includes(chatId), "resolveTelegramChatIdsForScope should return bound chat");

    const session = upsertTelegramSession({
      chatId,
      tenantId: scopeA.tenantId,
      walletId: scopeA.walletId,
      metadata: { updated_by: "smoke" },
    });
    assert(session?.tenant_id === scopeA.tenantId, "upsertTelegramSession should persist scope");

    const touched = touchTelegramSession(chatId, { ping: "ok" });
    assert(touched?.metadata?.ping === "ok", "touchTelegramSession should merge metadata");

    const fetched = getTelegramSession(chatId);
    assert(fetched?.wallet_id === scopeA.walletId, "getTelegramSession should return latest session");

    const scopes = listTelegramScopesForChat(chatId);
    assert(scopes.some((scope) => scope.wallet_id === scopeA.walletId), "listTelegramScopesForChat should include scopeA");

    const removedOne = unbindTelegramChat({
      chatId,
      tenantId: scopeB.tenantId,
      walletId: scopeB.walletId,
    });
    assert(removedOne.removed >= 1, "unbindTelegramChat scoped remove should remove one binding");

    const removedAll = unbindTelegramChat({ chatId });
    assert(removedAll.removed >= 1, "unbindTelegramChat(chatId) should remove remaining bindings");
    clearTelegramSession(chatId);

    console.log("Telegram state smoke test passed.");
  } finally {
    restoreFile(bindingsFile, originalBindings);
    restoreFile(sessionsFile, originalSessions);
  }
}

main();
