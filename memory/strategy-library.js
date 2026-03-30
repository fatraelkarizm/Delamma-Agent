/**
 * Strategy Library - persistent store of LP strategies.
 *
 * Default behavior stays on data/strategy-library.json, while worker runtimes
 * can bind a wallet-scoped store under data/tenants/... .
 */

import fs from "fs";
import path from "path";
import { getRuntimeScope } from "../core/runtime-scope.js";
import { log } from "../lib/logger.js";
import { dataPath, walletDataPath } from "../lib/paths.js";
import { createSnapshotWriter } from "../lib/storage-snapshot.js";

const DEFAULT_STRATEGY_FILE = dataPath("strategy-library.json");

function createEmptyStrategyData() {
  return { active: null, strategies: {} };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function createStrategyLibraryStore({ filePath = DEFAULT_STRATEGY_FILE, snapshotWriter = null } = {}) {
  function load() {
    if (!fs.existsSync(filePath)) return createEmptyStrategyData();
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        active: data.active || null,
        strategies: data.strategies || {},
      };
    } catch {
      return createEmptyStrategyData();
    }
  }

  function save(data) {
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    if (snapshotWriter) {
      void snapshotWriter(data);
    }
  }

  function addStrategy({
    id,
    name,
    author = "unknown",
    lp_strategy = "bid_ask",
    token_criteria = {},
    entry = {},
    range = {},
    exit = {},
    best_for = "",
    raw = "",
  }) {
    if (!id || !name) return { error: "id and name are required" };

    const db = load();
    const slug = id.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

    db.strategies[slug] = {
      id: slug,
      name,
      author,
      lp_strategy,
      token_criteria,
      entry,
      range,
      exit,
      best_for,
      raw,
      added_at: db.strategies[slug]?.added_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!db.active) db.active = slug;

    save(db);
    log("strategy", `Strategy saved: ${name} (${slug})`);
    return { saved: true, id: slug, name, active: db.active === slug };
  }

  function listStrategies() {
    const db = load();
    const strategies = Object.values(db.strategies).map((strategy) => ({
      id: strategy.id,
      name: strategy.name,
      author: strategy.author,
      lp_strategy: strategy.lp_strategy,
      best_for: strategy.best_for,
      active: db.active === strategy.id,
      added_at: strategy.added_at?.slice(0, 10),
    }));
    return { active: db.active, count: strategies.length, strategies };
  }

  function getStrategy({ id }) {
    if (!id) return { error: "id required" };
    const db = load();
    const strategy = db.strategies[id];
    if (!strategy) {
      return { error: `Strategy "${id}" not found`, available: Object.keys(db.strategies) };
    }
    return { ...strategy, is_active: db.active === id };
  }

  function setActiveStrategy({ id }) {
    if (!id) return { error: "id required" };
    const db = load();
    if (!db.strategies[id]) {
      return { error: `Strategy "${id}" not found`, available: Object.keys(db.strategies) };
    }
    db.active = id;
    save(db);
    log("strategy", `Active strategy set to: ${db.strategies[id].name}`);
    return { active: id, name: db.strategies[id].name };
  }

  function removeStrategy({ id }) {
    if (!id) return { error: "id required" };
    const db = load();
    if (!db.strategies[id]) return { error: `Strategy "${id}" not found` };
    const name = db.strategies[id].name;
    delete db.strategies[id];
    if (db.active === id) db.active = Object.keys(db.strategies)[0] || null;
    save(db);
    log("strategy", `Strategy removed: ${name}`);
    return { removed: true, id, name, new_active: db.active };
  }

  function getActiveStrategy() {
    const db = load();
    if (!db.active || !db.strategies[db.active]) return null;
    return db.strategies[db.active];
  }

  return {
    filePath,
    load,
    save,
    addStrategy,
    listStrategies,
    getStrategy,
    setActiveStrategy,
    removeStrategy,
    getActiveStrategy,
  };
}

export function createWorkerStrategyLibraryStore(workerContext = {}) {
  return createStrategyLibraryStore({
    filePath: walletDataPath(workerContext, "strategy-library.json"),
    snapshotWriter: createSnapshotWriter(workerContext, "strategy-library"),
  });
}

const defaultStrategyLibraryStore = createStrategyLibraryStore();

export function getDefaultStrategyLibraryStore() {
  return defaultStrategyLibraryStore;
}

function resolveStrategyLibraryStore() {
  return getRuntimeScope()?.strategyLibraryStore || defaultStrategyLibraryStore;
}

export function addStrategy(input) {
  return resolveStrategyLibraryStore().addStrategy(input);
}

export function listStrategies() {
  return resolveStrategyLibraryStore().listStrategies();
}

export function getStrategy(input) {
  return resolveStrategyLibraryStore().getStrategy(input);
}

export function setActiveStrategy(input) {
  return resolveStrategyLibraryStore().setActiveStrategy(input);
}

export function removeStrategy(input) {
  return resolveStrategyLibraryStore().removeStrategy(input);
}

export function getActiveStrategy() {
  return resolveStrategyLibraryStore().getActiveStrategy();
}
