/**
 * Pool memory persists deploy history per pool.
 *
 * Default behavior stays on data/pool-memory.json, while worker runtimes can
 * bind a wallet-scoped store under data/tenants/... .
 */

import fs from "fs";
import path from "path";
import { getRuntimeScope } from "../core/runtime-scope.js";
import { log } from "../lib/logger.js";
import { dataPath, walletDataPath } from "../lib/paths.js";
import { createSnapshotWriter } from "../lib/storage-snapshot.js";

const DEFAULT_POOL_MEMORY_FILE = dataPath("pool-memory.json");

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function createPoolMemoryStore({ filePath = DEFAULT_POOL_MEMORY_FILE, snapshotWriter = null } = {}) {
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

  function ensurePoolEntry(db, poolAddress, seed = {}) {
    if (!db[poolAddress]) {
      db[poolAddress] = {
        name: seed.name || seed.pool_name || poolAddress.slice(0, 8),
        base_mint: seed.base_mint || null,
        deploys: [],
        total_deploys: 0,
        avg_pnl_pct: 0,
        win_rate: 0,
        last_deployed_at: null,
        last_outcome: null,
        notes: [],
      };
    }
    return db[poolAddress];
  }

  function recordPoolDeploy(poolAddress, deployData) {
    if (!poolAddress) return;

    const db = load();
    const entry = ensurePoolEntry(db, poolAddress, deployData);

    const deploy = {
      deployed_at: deployData.deployed_at || null,
      closed_at: deployData.closed_at || new Date().toISOString(),
      pnl_pct: deployData.pnl_pct ?? null,
      pnl_usd: deployData.pnl_usd ?? null,
      range_efficiency: deployData.range_efficiency ?? null,
      minutes_held: deployData.minutes_held ?? null,
      close_reason: deployData.close_reason || null,
      strategy: deployData.strategy || null,
      volatility_at_deploy: deployData.volatility ?? null,
    };

    entry.deploys.push(deploy);
    entry.total_deploys = entry.deploys.length;
    entry.last_deployed_at = deploy.closed_at;
    entry.last_outcome = (deploy.pnl_pct ?? 0) >= 0 ? "profit" : "loss";

    const withPnl = entry.deploys.filter((record) => record.pnl_pct != null);
    if (withPnl.length > 0) {
      entry.avg_pnl_pct = Math.round(
        (withPnl.reduce((sum, record) => sum + record.pnl_pct, 0) / withPnl.length) * 100
      ) / 100;
      entry.win_rate = Math.round(
        (withPnl.filter((record) => record.pnl_pct >= 0).length / withPnl.length) * 100
      ) / 100;
    }

    if (deployData.base_mint && !entry.base_mint) {
      entry.base_mint = deployData.base_mint;
    }

    save(db);
    log(
      "pool-memory",
      `Recorded deploy for ${entry.name} (${poolAddress.slice(0, 8)}): PnL ${deploy.pnl_pct}%`
    );
  }

  function getPoolMemory({ pool_address }) {
    if (!pool_address) return { error: "pool_address required" };

    const db = load();
    const entry = db[pool_address];

    if (!entry) {
      return {
        pool_address,
        known: false,
        message: "No history for this pool - first time deploying here.",
      };
    }

    return {
      pool_address,
      known: true,
      name: entry.name,
      base_mint: entry.base_mint,
      total_deploys: entry.total_deploys,
      avg_pnl_pct: entry.avg_pnl_pct,
      win_rate: entry.win_rate,
      last_deployed_at: entry.last_deployed_at,
      last_outcome: entry.last_outcome,
      notes: entry.notes,
      history: entry.deploys.slice(-10),
    };
  }

  function recordPositionSnapshot(poolAddress, snapshot) {
    if (!poolAddress) return;
    const db = load();
    const entry = ensurePoolEntry(db, poolAddress, { name: snapshot.pair });

    if (!entry.snapshots) entry.snapshots = [];

    entry.snapshots.push({
      ts: new Date().toISOString(),
      position: snapshot.position,
      pnl_pct: snapshot.pnl_pct ?? null,
      pnl_usd: snapshot.pnl_usd ?? null,
      in_range: snapshot.in_range ?? null,
      unclaimed_fees_usd: snapshot.unclaimed_fees_usd ?? null,
      minutes_out_of_range: snapshot.minutes_out_of_range ?? null,
      age_minutes: snapshot.age_minutes ?? null,
    });

    if (entry.snapshots.length > 48) {
      entry.snapshots = entry.snapshots.slice(-48);
    }

    save(db);
  }

  function recallForPool(poolAddress) {
    if (!poolAddress) return null;
    const db = load();
    const entry = db[poolAddress];
    if (!entry) return null;

    const lines = [];

    if (entry.total_deploys > 0) {
      lines.push(
        `POOL MEMORY [${entry.name}]: ${entry.total_deploys} past deploy(s), avg PnL ${entry.avg_pnl_pct}%, win rate ${entry.win_rate}%, last outcome: ${entry.last_outcome}`
      );
    }

    const snapshots = (entry.snapshots || []).slice(-6);
    if (snapshots.length >= 2) {
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const pnlTrend = last.pnl_pct != null && first.pnl_pct != null
        ? (last.pnl_pct - first.pnl_pct).toFixed(2)
        : null;
      const outOfRangeCount = snapshots.filter((snapshot) => snapshot.in_range === false).length;
      lines.push(
        `RECENT TREND: PnL drift ${pnlTrend !== null ? `${pnlTrend >= 0 ? "+" : ""}${pnlTrend}%` : "unknown"} over last ${snapshots.length} cycles, OOR in ${outOfRangeCount}/${snapshots.length} cycles`
      );
    }

    if (entry.notes?.length > 0) {
      const lastNote = entry.notes[entry.notes.length - 1];
      lines.push(`NOTE: ${lastNote.note}`);
    }

    return lines.length > 0 ? lines.join("\n") : null;
  }

  function addPoolNote({ pool_address, note }) {
    if (!pool_address) return { error: "pool_address required" };
    if (!note) return { error: "note required" };

    const db = load();
    const entry = ensurePoolEntry(db, pool_address);
    entry.notes.push({
      note,
      added_at: new Date().toISOString(),
    });

    save(db);
    log("pool-memory", `Note added to ${pool_address.slice(0, 8)}: ${note}`);
    return { saved: true, pool_address, note };
  }

  return {
    filePath,
    load,
    save,
    recordPoolDeploy,
    getPoolMemory,
    recordPositionSnapshot,
    recallForPool,
    addPoolNote,
  };
}

export function createWorkerPoolMemoryStore(workerContext = {}) {
  return createPoolMemoryStore({
    filePath: walletDataPath(workerContext, "pool-memory.json"),
    snapshotWriter: createSnapshotWriter(workerContext, "pool-memory"),
  });
}

const defaultPoolMemoryStore = createPoolMemoryStore();

export function getDefaultPoolMemoryStore() {
  return defaultPoolMemoryStore;
}

function resolvePoolMemoryStore() {
  return getRuntimeScope()?.poolMemoryStore || defaultPoolMemoryStore;
}

export function recordPoolDeploy(poolAddress, deployData) {
  return resolvePoolMemoryStore().recordPoolDeploy(poolAddress, deployData);
}

export function getPoolMemory(input) {
  return resolvePoolMemoryStore().getPoolMemory(input);
}

export function getPoolMemoryData() {
  return resolvePoolMemoryStore().load();
}

export function recordPositionSnapshot(poolAddress, snapshot) {
  return resolvePoolMemoryStore().recordPositionSnapshot(poolAddress, snapshot);
}

export function recallForPool(poolAddress) {
  return resolvePoolMemoryStore().recallForPool(poolAddress);
}

export function addPoolNote(input) {
  return resolvePoolMemoryStore().addPoolNote(input);
}
