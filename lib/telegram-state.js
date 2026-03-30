import fs from "fs";
import path from "path";
import { dataPath } from "./paths.js";
import { log } from "./logger.js";

const TELEGRAM_DIR = dataPath("telegram");
const BINDINGS_FILE = path.join(TELEGRAM_DIR, "chat-bindings.json");
const SESSIONS_FILE = path.join(TELEGRAM_DIR, "chat-sessions.json");

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeId(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeScope({ tenantId = null, walletId = null } = {}) {
  const normalizedTenantId = normalizeId(tenantId);
  const normalizedWalletId = normalizeId(walletId);
  return {
    tenantId: normalizedTenantId,
    walletId: normalizedWalletId,
  };
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    log("telegram_state_error", `Failed to read ${path.basename(filePath)}: ${error.message}`);
    return fallback;
  }
}

function saveJson(filePath, data) {
  try {
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    log("telegram_state_error", `Failed to write ${path.basename(filePath)}: ${error.message}`);
  }
}

function loadBindingsState() {
  const data = loadJson(BINDINGS_FILE, { bindings: [] });
  return {
    bindings: Array.isArray(data.bindings) ? data.bindings : [],
  };
}

function saveBindingsState(data) {
  saveJson(BINDINGS_FILE, {
    bindings: Array.isArray(data?.bindings) ? data.bindings : [],
  });
}

function loadSessionsState() {
  const data = loadJson(SESSIONS_FILE, { sessions: {} });
  return {
    sessions: typeof data.sessions === "object" && data.sessions ? data.sessions : {},
  };
}

function saveSessionsState(data) {
  saveJson(SESSIONS_FILE, {
    sessions: typeof data?.sessions === "object" && data.sessions ? data.sessions : {},
  });
}

export function listTelegramBindings({
  chatId = null,
  tenantId = null,
  walletId = null,
} = {}) {
  const normalizedChatId = normalizeId(chatId);
  const normalizedScope = normalizeScope({ tenantId, walletId });
  const { bindings } = loadBindingsState();

  return bindings
    .filter((binding) => (
      (!normalizedChatId || binding.chat_id === normalizedChatId) &&
      (!normalizedScope.tenantId || binding.tenant_id === normalizedScope.tenantId) &&
      (!normalizedScope.walletId || binding.wallet_id === normalizedScope.walletId)
    ))
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
}

export function listTelegramScopesForChat(chatId) {
  return listTelegramBindings({ chatId }).map((binding) => ({
    tenant_id: binding.tenant_id,
    wallet_id: binding.wallet_id,
    notifications_enabled: binding.notifications_enabled !== false,
    updated_at: binding.updated_at || binding.created_at || null,
  }));
}

export function resolveTelegramChatIdsForScope({ tenantId, walletId } = {}) {
  const normalizedScope = normalizeScope({ tenantId, walletId });
  if (!normalizedScope.tenantId || !normalizedScope.walletId) return [];

  const chatIds = new Set();
  for (const binding of listTelegramBindings({
    tenantId: normalizedScope.tenantId,
    walletId: normalizedScope.walletId,
  })) {
    if (binding.notifications_enabled === false) continue;
    if (binding.chat_id) {
      chatIds.add(binding.chat_id);
    }
  }

  return [...chatIds];
}

export function bindTelegramChat({
  chatId,
  tenantId,
  walletId,
  notificationsEnabled = true,
  metadata = {},
} = {}) {
  const normalizedChatId = normalizeId(chatId);
  const normalizedScope = normalizeScope({ tenantId, walletId });
  if (!normalizedChatId || !normalizedScope.tenantId || !normalizedScope.walletId) {
    return null;
  }

  const now = new Date().toISOString();
  const state = loadBindingsState();
  const existing = state.bindings.find((binding) => (
    binding.chat_id === normalizedChatId &&
    binding.tenant_id === normalizedScope.tenantId &&
    binding.wallet_id === normalizedScope.walletId
  ));

  if (existing) {
    existing.notifications_enabled = notificationsEnabled !== false;
    existing.metadata = { ...(existing.metadata || {}), ...(metadata || {}) };
    existing.updated_at = now;
    saveBindingsState(state);
    return existing;
  }

  const record = {
    chat_id: normalizedChatId,
    tenant_id: normalizedScope.tenantId,
    wallet_id: normalizedScope.walletId,
    notifications_enabled: notificationsEnabled !== false,
    metadata: { ...(metadata || {}) },
    created_at: now,
    updated_at: now,
  };

  state.bindings.push(record);
  saveBindingsState(state);
  return record;
}

export function unbindTelegramChat({
  chatId,
  tenantId = null,
  walletId = null,
} = {}) {
  const normalizedChatId = normalizeId(chatId);
  if (!normalizedChatId) return { removed: 0 };

  const normalizedScope = normalizeScope({ tenantId, walletId });
  const state = loadBindingsState();
  const beforeCount = state.bindings.length;

  state.bindings = state.bindings.filter((binding) => {
    if (binding.chat_id !== normalizedChatId) return true;
    if (normalizedScope.tenantId && binding.tenant_id !== normalizedScope.tenantId) return true;
    if (normalizedScope.walletId && binding.wallet_id !== normalizedScope.walletId) return true;
    return false;
  });

  const removed = beforeCount - state.bindings.length;
  if (removed > 0) {
    saveBindingsState(state);
  }

  return { removed };
}

export function getTelegramSession(chatId) {
  const normalizedChatId = normalizeId(chatId);
  if (!normalizedChatId) return null;

  const state = loadSessionsState();
  return state.sessions[normalizedChatId] || null;
}

export function upsertTelegramSession({
  chatId,
  tenantId,
  walletId,
  metadata = {},
} = {}) {
  const normalizedChatId = normalizeId(chatId);
  const normalizedScope = normalizeScope({ tenantId, walletId });
  if (!normalizedChatId || !normalizedScope.tenantId || !normalizedScope.walletId) {
    return null;
  }

  const state = loadSessionsState();
  const now = new Date().toISOString();
  const existing = state.sessions[normalizedChatId] || {};
  const next = {
    chat_id: normalizedChatId,
    tenant_id: normalizedScope.tenantId,
    wallet_id: normalizedScope.walletId,
    metadata: { ...(existing.metadata || {}), ...(metadata || {}) },
    created_at: existing.created_at || now,
    updated_at: now,
    last_seen_at: now,
  };

  state.sessions[normalizedChatId] = next;
  saveSessionsState(state);
  return next;
}

export function touchTelegramSession(chatId, metadata = {}) {
  const session = getTelegramSession(chatId);
  if (!session) return null;

  return upsertTelegramSession({
    chatId,
    tenantId: session.tenant_id,
    walletId: session.wallet_id,
    metadata: { ...(session.metadata || {}), ...(metadata || {}) },
  });
}

export function clearTelegramSession(chatId) {
  const normalizedChatId = normalizeId(chatId);
  if (!normalizedChatId) return false;

  const state = loadSessionsState();
  if (!state.sessions[normalizedChatId]) return false;

  delete state.sessions[normalizedChatId];
  saveSessionsState(state);
  return true;
}
