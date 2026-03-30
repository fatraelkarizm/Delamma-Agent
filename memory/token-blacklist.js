/**
 * Token blacklist - mints the agent should never deploy into.
 *
 * Default behavior stays on data/token-blacklist.json, while worker runtimes
 * can bind a wallet-scoped store under data/tenants/... .
 */

import fs from "fs";
import path from "path";
import { getRuntimeScope } from "../core/runtime-scope.js";
import { log } from "../lib/logger.js";
import { dataPath, walletDataPath } from "../lib/paths.js";
import { createSnapshotWriter } from "../lib/storage-snapshot.js";

const DEFAULT_BLACKLIST_FILE = dataPath("token-blacklist.json");

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function createTokenBlacklistStore({ filePath = DEFAULT_BLACKLIST_FILE, snapshotWriter = null } = {}) {
  function load() {
    if (!fs.existsSync(filePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return {};
    }
  }

  function save(data) {
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    if (snapshotWriter) {
      void snapshotWriter(data);
    }
  }

  function isBlacklisted(mint) {
    if (!mint) return false;
    const db = load();
    return !!db[mint];
  }

  function addToBlacklist({ mint, symbol, reason }) {
    if (!mint) return { error: "mint required" };

    const db = load();
    if (db[mint]) {
      return {
        already_blacklisted: true,
        mint,
        symbol: db[mint].symbol,
        reason: db[mint].reason,
      };
    }

    db[mint] = {
      symbol: symbol || "UNKNOWN",
      reason: reason || "no reason provided",
      added_at: new Date().toISOString(),
      added_by: "agent",
    };

    save(db);
    log("blacklist", `Blacklisted ${symbol || mint}: ${reason}`);
    return { blacklisted: true, mint, symbol, reason };
  }

  function removeFromBlacklist({ mint }) {
    if (!mint) return { error: "mint required" };

    const db = load();
    if (!db[mint]) {
      return { error: `Mint ${mint} not found on blacklist` };
    }

    const entry = db[mint];
    delete db[mint];
    save(db);
    log("blacklist", `Removed ${entry.symbol || mint} from blacklist`);
    return { removed: true, mint, was: entry };
  }

  function listBlacklist() {
    const db = load();
    const entries = Object.entries(db).map(([mint, info]) => ({
      mint,
      ...info,
    }));

    return {
      count: entries.length,
      blacklist: entries,
    };
  }

  return {
    filePath,
    load,
    save,
    isBlacklisted,
    addToBlacklist,
    removeFromBlacklist,
    listBlacklist,
  };
}

export function createWorkerTokenBlacklistStore(workerContext = {}) {
  return createTokenBlacklistStore({
    filePath: walletDataPath(workerContext, "token-blacklist.json"),
    snapshotWriter: createSnapshotWriter(workerContext, "token-blacklist"),
  });
}

const defaultTokenBlacklistStore = createTokenBlacklistStore();

export function getDefaultTokenBlacklistStore() {
  return defaultTokenBlacklistStore;
}

function resolveTokenBlacklistStore() {
  return getRuntimeScope()?.tokenBlacklistStore || defaultTokenBlacklistStore;
}

export function isBlacklisted(mint) {
  return resolveTokenBlacklistStore().isBlacklisted(mint);
}

export function addToBlacklist(input) {
  return resolveTokenBlacklistStore().addToBlacklist(input);
}

export function removeFromBlacklist(input) {
  return resolveTokenBlacklistStore().removeFromBlacklist(input);
}

export function listBlacklist() {
  return resolveTokenBlacklistStore().listBlacklist();
}
