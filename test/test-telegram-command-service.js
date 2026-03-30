/**
 * Offline smoke test for telegram command service.
 * Run: node test/test-telegram-command-service.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { handleScopeBindingCommands } from "../core/telegram-command-service.js";

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
  if (!condition) throw new Error(message);
}

function createReplyRecorder() {
  const calls = [];
  async function reply(chatId, text) {
    calls.push({ chatId, text });
  }
  return { calls, reply };
}

async function main() {
  const originalBindings = readIfExists(bindingsFile);
  const originalSessions = readIfExists(sessionsFile);
  const chatId = "telegram-command-smoke-chat";

  try {
    const { calls, reply } = createReplyRecorder();
    const scope = { tenantId: "tenant-a", walletId: "wallet-a" };

    let handled = await handleScopeBindingCommands({
      text: "/scope",
      chatId,
      scope,
      reply,
    });
    assert(handled === true, "/scope should be handled");
    assert(calls.at(-1).text.includes("tenant-a/wallet-a"), "/scope should show current scope");

    handled = await handleScopeBindingCommands({
      text: "/bind",
      chatId,
      scope,
      reply,
    });
    assert(handled === true, "/bind should be handled");
    assert(calls.at(-1).text.includes("Bound this chat"), "/bind should confirm binding");

    handled = await handleScopeBindingCommands({
      text: "/bindings",
      chatId,
      scope,
      reply,
    });
    assert(handled === true, "/bindings should be handled");
    assert(calls.at(-1).text.includes("Bindings for this chat"), "/bindings should list bindings");

    handled = await handleScopeBindingCommands({
      text: "/scope tenant-b wallet-b",
      chatId,
      scope,
      reply,
    });
    assert(handled === true, "/scope tenant wallet should be handled");
    assert(calls.at(-1).text.includes("tenant-b/wallet-b"), "scope switch should be reflected");

    handled = await handleScopeBindingCommands({
      text: "/unbind tenant-a wallet-a",
      chatId,
      scope: { tenantId: "tenant-b", walletId: "wallet-b" },
      reply,
    });
    assert(handled === true, "/unbind should be handled");
    assert(
      calls.at(-1).text.includes("Removed binding") || calls.at(-1).text.includes("No binding found"),
      "/unbind should return a result message"
    );

    handled = await handleScopeBindingCommands({
      text: "/not_a_command",
      chatId,
      scope,
      reply,
    });
    assert(handled === false, "unknown command should return false");

    console.log("Telegram command service smoke test passed.");
  } finally {
    restoreFile(bindingsFile, originalBindings);
    restoreFile(sessionsFile, originalSessions);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

