import {
  bindTelegramChat,
  listTelegramScopesForChat,
  unbindTelegramChat,
  upsertTelegramSession,
} from "../lib/telegram-state.js";

function formatScope(scope) {
  return `${scope.tenantId}/${scope.walletId}`;
}

function parseScopeInput(text) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 3) return null;
  return {
    tenantId: parts[1],
    walletId: parts[2],
  };
}

export async function handleScopeBindingCommands({ text, chatId, scope, reply }) {
  if (text === "/scope") {
    await reply(chatId, `Current scope: ${formatScope(scope)}`);
    return true;
  }

  if (text.startsWith("/scope ")) {
    const nextScope = parseScopeInput(text);
    if (!nextScope) {
      await reply(chatId, "Usage: /scope <tenant> <wallet>");
      return true;
    }

    upsertTelegramSession({
      chatId,
      tenantId: nextScope.tenantId,
      walletId: nextScope.walletId,
      metadata: { updated_by: "telegram_command" },
    });
    await reply(chatId, `Active scope changed to ${formatScope(nextScope)}.`);
    return true;
  }

  if (text === "/bindings") {
    const bindings = listTelegramScopesForChat(chatId);
    if (bindings.length === 0) {
      await reply(chatId, "No notification bindings saved for this chat.");
      return true;
    }
    const lines = bindings.map(
      (binding, index) =>
        `${index + 1}. ${binding.tenant_id}/${binding.wallet_id} | notifications ${
          binding.notifications_enabled ? "on" : "off"
        }`
    );
    await reply(chatId, `Bindings for this chat:\n\n${lines.join("\n")}`);
    return true;
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
      return true;
    }

    upsertTelegramSession({
      chatId,
      tenantId: targetScope.tenantId,
      walletId: targetScope.walletId,
      metadata: { bound_at: new Date().toISOString() },
    });
    await reply(chatId, `Bound this chat to ${formatScope(targetScope)} notifications.`);
    return true;
  }

  if (text === "/unbind" || text.startsWith("/unbind ")) {
    const explicitScope = parseScopeInput(text);
    const targetScope = explicitScope || scope;
    const result = unbindTelegramChat({
      chatId,
      tenantId: targetScope.tenantId,
      walletId: targetScope.walletId,
    });
    await reply(
      chatId,
      result.removed > 0
        ? `Removed binding for ${formatScope(targetScope)}.`
        : `No binding found for ${formatScope(targetScope)}.`
    );
    return true;
  }

  return false;
}

