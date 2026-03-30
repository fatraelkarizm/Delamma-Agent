import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("./data");
const SAAS_USERS_PATH = path.join(DATA_DIR, "saas-users.json");

function nowIso() {
  return new Date().toISOString();
}

function trialExpiryIso(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function defaultUser({ telegramUserId, chatId, username, firstName, lastName }) {
  const ts = nowIso();
  return {
    telegramUserId,
    chatId,
    username: username || null,
    firstName: firstName || null,
    lastName: lastName || null,
    walletAddress: null,
    pendingAction: null,
    subscription: {
      plan: "trial",
      status: "active",
      startedAt: ts,
      expiresAt: trialExpiryIso(7),
    },
    usage: {
      interactions: 0,
      menuClicks: 0,
      startCount: 0,
      lastActiveAt: null,
    },
    createdAt: ts,
    updatedAt: ts,
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadDb() {
  ensureDataDir();
  let raw = { version: 1, users: {} };
  if (fs.existsSync(SAAS_USERS_PATH)) {
    try {
      raw = JSON.parse(fs.readFileSync(SAAS_USERS_PATH, "utf8"));
    } catch {
      raw = { version: 1, users: {} };
    }
  }
  return {
    version: raw.version || 1,
    users: raw.users || {},
  };
}

function saveDb(db) {
  ensureDataDir();
  fs.writeFileSync(SAAS_USERS_PATH, JSON.stringify(db, null, 2));
}

export function upsertTelegramUser({ chatId, user }) {
  if (!user?.id) return null;

  const db = loadDb();
  const key = String(user.id);
  const existing = db.users[key];

  if (!existing) {
    db.users[key] = defaultUser({
      telegramUserId: key,
      chatId: String(chatId),
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
    });
  } else {
    db.users[key] = {
      ...existing,
      chatId: String(chatId),
      username: user.username || existing.username || null,
      firstName: user.first_name || existing.firstName || null,
      lastName: user.last_name || existing.lastName || null,
      updatedAt: nowIso(),
    };
  }

  saveDb(db);
  return db.users[key];
}

export function getSaasUser(telegramUserId) {
  const db = loadDb();
  return db.users[String(telegramUserId)] || null;
}

export function setPendingAction(telegramUserId, action) {
  const db = loadDb();
  const key = String(telegramUserId);
  const u = db.users[key];
  if (!u) return null;
  u.pendingAction = action || null;
  u.updatedAt = nowIso();
  saveDb(db);
  return u;
}

export function setWalletAddress(telegramUserId, walletAddress) {
  const db = loadDb();
  const key = String(telegramUserId);
  const u = db.users[key];
  if (!u) return null;
  u.walletAddress = walletAddress;
  u.pendingAction = null;
  u.updatedAt = nowIso();
  saveDb(db);
  return u;
}

export function touchUsage(telegramUserId, counterField = "interactions") {
  const db = loadDb();
  const key = String(telegramUserId);
  const u = db.users[key];
  if (!u) return null;

  if (!u.usage) {
    u.usage = {
      interactions: 0,
      menuClicks: 0,
      startCount: 0,
      lastActiveAt: null,
    };
  }

  if (counterField && typeof u.usage[counterField] === "number") {
    u.usage[counterField] += 1;
  }

  u.usage.lastActiveAt = nowIso();
  u.updatedAt = nowIso();
  saveDb(db);
  return u;
}

export function setSubscription(telegramUserId, patch) {
  const db = loadDb();
  const key = String(telegramUserId);
  const u = db.users[key];
  if (!u) return null;

  u.subscription = {
    ...(u.subscription || {}),
    ...(patch || {}),
  };
  u.updatedAt = nowIso();
  saveDb(db);
  return u;
}
