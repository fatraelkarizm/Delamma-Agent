/**
 * Persistent agent state stored on disk.
 *
 * Default behavior stays backward compatible with data/state.json, while
 * worker runtimes can bind a wallet-scoped store under data/tenants/... .
 */

import fs from "fs";
import path from "path";
import { getRuntimeScope } from "../core/runtime-scope.js";
import { log } from "./logger.js";
import { dataPath, walletDataPath } from "./paths.js";
import { createSnapshotWriter } from "./storage-snapshot.js";

const DEFAULT_STATE_FILE = dataPath("state.json");
const MAX_RECENT_EVENTS = 20;
const SYNC_GRACE_MS = 5 * 60_000;

function createEmptyState() {
  return { positions: {}, recentEvents: [], lastUpdated: null };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function createStateStore({ filePath = DEFAULT_STATE_FILE, snapshotWriter = null } = {}) {
  function load() {
    if (!fs.existsSync(filePath)) {
      return createEmptyState();
    }

    try {
      const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        positions: state.positions || {},
        recentEvents: state.recentEvents || [],
        lastUpdated: state.lastUpdated || null,
        _lastBriefingDate: state._lastBriefingDate || null,
      };
    } catch (err) {
      log("state_error", `Failed to read ${path.basename(filePath)}: ${err.message}`);
      return createEmptyState();
    }
  }

  function save(state) {
    try {
      ensureParentDir(filePath);
      state.lastUpdated = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
      if (snapshotWriter) {
        void snapshotWriter(state);
      }
    } catch (err) {
      log("state_error", `Failed to write ${path.basename(filePath)}: ${err.message}`);
    }
  }

  function pushEvent(state, event) {
    if (!state.recentEvents) state.recentEvents = [];
    state.recentEvents.push({ ts: new Date().toISOString(), ...event });
    if (state.recentEvents.length > MAX_RECENT_EVENTS) {
      state.recentEvents = state.recentEvents.slice(-MAX_RECENT_EVENTS);
    }
  }

  function minutesOutOfRange(positionAddress) {
    const state = load();
    const pos = state.positions[positionAddress];
    if (!pos || !pos.out_of_range_since) return 0;
    const ms = Date.now() - new Date(pos.out_of_range_since).getTime();
    return Math.floor(ms / 60000);
  }

  function trackPosition({
    position,
    pool,
    pool_name,
    strategy,
    bin_range = {},
    amount_sol,
    amount_x = 0,
    active_bin,
    bin_step,
    volatility,
    fee_tvl_ratio,
    organic_score,
    initial_value_usd,
  }) {
    const state = load();
    state.positions[position] = {
      position,
      pool,
      pool_name,
      strategy,
      bin_range,
      amount_sol,
      amount_x,
      active_bin_at_deploy: active_bin,
      bin_step,
      volatility,
      fee_tvl_ratio,
      initial_fee_tvl_24h: fee_tvl_ratio,
      organic_score,
      initial_value_usd,
      deployed_at: new Date().toISOString(),
      out_of_range_since: null,
      last_claim_at: null,
      total_fees_claimed_usd: 0,
      rebalance_count: 0,
      closed: false,
      closed_at: null,
      notes: [],
    };
    pushEvent(state, { action: "deploy", position, pool_name: pool_name || pool });
    save(state);
    log("state", `Tracked new position: ${position} in pool ${pool}`);
  }

  function markOutOfRange(positionAddress) {
    const state = load();
    const pos = state.positions[positionAddress];
    if (!pos) return;
    if (!pos.out_of_range_since) {
      pos.out_of_range_since = new Date().toISOString();
      save(state);
      log("state", `Position ${positionAddress} marked out of range`);
    }
  }

  function markInRange(positionAddress) {
    const state = load();
    const pos = state.positions[positionAddress];
    if (!pos) return;
    if (pos.out_of_range_since) {
      pos.out_of_range_since = null;
      save(state);
      log("state", `Position ${positionAddress} back in range`);
    }
  }

  function recordClaim(positionAddress, feesUsd) {
    const state = load();
    const pos = state.positions[positionAddress];
    if (!pos) return;
    pos.last_claim_at = new Date().toISOString();
    pos.total_fees_claimed_usd = (pos.total_fees_claimed_usd || 0) + (feesUsd || 0);
    pos.notes.push(`Claimed ~$${feesUsd?.toFixed(2) || "?"} fees at ${pos.last_claim_at}`);
    save(state);
  }

  function recordClose(positionAddress, reason) {
    const state = load();
    const pos = state.positions[positionAddress];
    if (!pos) return;
    pos.closed = true;
    pos.closed_at = new Date().toISOString();
    pos.notes.push(`Closed at ${pos.closed_at}: ${reason}`);
    pushEvent(state, {
      action: "close",
      position: positionAddress,
      pool_name: pos.pool_name || pos.pool,
      reason,
    });
    save(state);
    log("state", `Position ${positionAddress} marked closed: ${reason}`);
  }

  function recordRebalance(oldPosition, newPosition) {
    const state = load();
    const old = state.positions[oldPosition];
    if (old) {
      old.closed = true;
      old.closed_at = new Date().toISOString();
      old.notes.push(`Rebalanced into ${newPosition} at ${old.closed_at}`);
    }
    const nextPosition = state.positions[newPosition];
    if (nextPosition) {
      nextPosition.rebalance_count = (old?.rebalance_count || 0) + 1;
      nextPosition.notes.push(`Rebalanced from ${oldPosition}`);
    }
    save(state);
  }

  function setPositionInstruction(positionAddress, instruction) {
    const state = load();
    const pos = state.positions[positionAddress];
    if (!pos) return false;
    pos.instruction = instruction || null;
    save(state);
    log("state", `Position ${positionAddress} instruction set: ${instruction}`);
    return true;
  }

  function getTrackedPositions(openOnly = false) {
    const state = load();
    const all = Object.values(state.positions);
    return openOnly ? all.filter((p) => !p.closed) : all;
  }

  function getTrackedPosition(positionAddress) {
    const state = load();
    return state.positions[positionAddress] || null;
  }

  function getStateSummary() {
    const state = load();
    const allPositions = Object.values(state.positions);
    const open = allPositions.filter((p) => !p.closed);
    const closed = allPositions.filter((p) => p.closed);
    const totalFeesClaimed = allPositions.reduce(
      (sum, positionEntry) => sum + (positionEntry.total_fees_claimed_usd || 0),
      0
    );

    return {
      open_positions: open.length,
      closed_positions: closed.length,
      total_fees_claimed_usd: Math.round(totalFeesClaimed * 100) / 100,
      positions: open.map((p) => ({
        position: p.position,
        pool: p.pool,
        strategy: p.strategy,
        deployed_at: p.deployed_at,
        out_of_range_since: p.out_of_range_since,
        minutes_out_of_range: minutesOutOfRange(p.position),
        total_fees_claimed_usd: p.total_fees_claimed_usd,
        initial_fee_tvl_24h: p.initial_fee_tvl_24h,
        rebalance_count: p.rebalance_count,
        instruction: p.instruction || null,
      })),
      last_updated: state.lastUpdated,
      recent_events: (state.recentEvents || []).slice(-10),
    };
  }

  function getLastBriefingDate() {
    const state = load();
    return state._lastBriefingDate || null;
  }

  function setLastBriefingDate() {
    const state = load();
    state._lastBriefingDate = new Date().toISOString().slice(0, 10);
    save(state);
  }

  function syncOpenPositions(activeAddresses) {
    const state = load();
    const activeSet = new Set(activeAddresses);
    let changed = false;

    for (const posId in state.positions) {
      const pos = state.positions[posId];
      if (pos.closed || activeSet.has(posId)) continue;

      const deployedAt = pos.deployed_at ? new Date(pos.deployed_at).getTime() : 0;
      if (Date.now() - deployedAt < SYNC_GRACE_MS) {
        log("state", `Position ${posId} not on-chain yet - within grace period, skipping auto-close`);
        continue;
      }

      pos.closed = true;
      pos.closed_at = new Date().toISOString();
      pos.notes.push("Auto-closed during state sync (not found on-chain)");
      changed = true;
      log("state", `Position ${posId} auto-closed (missing from on-chain data)`);
    }

    if (changed) save(state);
  }

  return {
    filePath,
    load,
    save,
    trackPosition,
    markOutOfRange,
    markInRange,
    minutesOutOfRange,
    recordClaim,
    recordClose,
    recordRebalance,
    setPositionInstruction,
    getTrackedPositions,
    getTrackedPosition,
    getStateSummary,
    getLastBriefingDate,
    setLastBriefingDate,
    syncOpenPositions,
  };
}

export function createWorkerStateStore(workerContext = {}) {
  return createStateStore({
    filePath: walletDataPath(workerContext, "state.json"),
    snapshotWriter: createSnapshotWriter(workerContext, "state"),
  });
}

const defaultStateStore = createStateStore();

export function getDefaultStateStore() {
  return defaultStateStore;
}

function resolveStateStore() {
  return getRuntimeScope()?.stateStore || defaultStateStore;
}

export function trackPosition(input) {
  return resolveStateStore().trackPosition(input);
}

export function markOutOfRange(positionAddress) {
  return resolveStateStore().markOutOfRange(positionAddress);
}

export function markInRange(positionAddress) {
  return resolveStateStore().markInRange(positionAddress);
}

export function minutesOutOfRange(positionAddress) {
  return resolveStateStore().minutesOutOfRange(positionAddress);
}

export function recordClaim(positionAddress, feesUsd) {
  return resolveStateStore().recordClaim(positionAddress, feesUsd);
}

export function recordClose(positionAddress, reason) {
  return resolveStateStore().recordClose(positionAddress, reason);
}

export function recordRebalance(oldPosition, newPosition) {
  return resolveStateStore().recordRebalance(oldPosition, newPosition);
}

export function setPositionInstruction(positionAddress, instruction) {
  return resolveStateStore().setPositionInstruction(positionAddress, instruction);
}

export function getTrackedPositions(openOnly = false) {
  return resolveStateStore().getTrackedPositions(openOnly);
}

export function getTrackedPosition(positionAddress) {
  return resolveStateStore().getTrackedPosition(positionAddress);
}

export function getStateSummary() {
  return resolveStateStore().getStateSummary();
}

export function getStateData() {
  return resolveStateStore().load();
}

export function getLastBriefingDate() {
  return resolveStateStore().getLastBriefingDate();
}

export function setLastBriefingDate() {
  return resolveStateStore().setLastBriefingDate();
}

export function syncOpenPositions(activeAddresses) {
  return resolveStateStore().syncOpenPositions(activeAddresses);
}
