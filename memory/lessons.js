/**
 * Agent learning system.
 *
 * Default behavior stays on data/lessons.json, while worker runtimes can
 * bind a wallet-scoped store under data/tenants/... .
 */

import fs from "fs";
import path from "path";
import { getRuntimeScope } from "../core/runtime-scope.js";
import { log } from "../lib/logger.js";
import { USER_CONFIG_PATH, dataPath, walletDataPath } from "../lib/paths.js";
import { createSnapshotWriter } from "../lib/storage-snapshot.js";

const DEFAULT_LESSONS_FILE = dataPath("lessons.json");
const MIN_EVOLVE_POSITIONS = 5;
const MAX_CHANGE_PER_STEP = 0.2;

const ROLE_TAGS = {
  SCREENER: ["screening", "narrative", "strategy", "deployment", "token", "volume", "entry", "bundler", "holders", "organic"],
  MANAGER: ["management", "risk", "oor", "fees", "position", "hold", "close", "pnl", "rebalance", "claim"],
  GENERAL: [],
};

function createEmptyLessonsData() {
  return { lessons: [], performance: [] };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function deriveLesson(perf) {
  const tags = [];

  const outcome = perf.pnl_pct >= 5 ? "good"
    : perf.pnl_pct >= 0 ? "neutral"
    : perf.pnl_pct >= -5 ? "poor"
    : "bad";

  if (outcome === "neutral") return null;

  const context = [
    `${perf.pool_name}`,
    `strategy=${perf.strategy}`,
    `bin_step=${perf.bin_step}`,
    `volatility=${perf.volatility}`,
    `fee_tvl_ratio=${perf.fee_tvl_ratio}`,
    `organic=${perf.organic_score}`,
    `bin_range=${typeof perf.bin_range === "object" ? JSON.stringify(perf.bin_range) : perf.bin_range}`,
  ].join(", ");

  let rule = "";

  if (outcome === "good" || outcome === "bad") {
    if (perf.range_efficiency < 30 && outcome === "bad") {
      rule = `AVOID: ${perf.pool_name}-type pools (volatility=${perf.volatility}, bin_step=${perf.bin_step}) with strategy="${perf.strategy}" - went OOR ${100 - perf.range_efficiency}% of the time. Consider wider bin_range or bid_ask strategy.`;
      tags.push("oor", perf.strategy, `volatility_${Math.round(perf.volatility)}`);
    } else if (perf.range_efficiency > 80 && outcome === "good") {
      rule = `PREFER: ${perf.pool_name}-type pools (volatility=${perf.volatility}, bin_step=${perf.bin_step}) with strategy="${perf.strategy}" - ${perf.range_efficiency}% in-range efficiency, PnL +${perf.pnl_pct}%.`;
      tags.push("efficient", perf.strategy);
    } else if (outcome === "bad" && perf.close_reason?.includes("volume")) {
      rule = `AVOID: Pools with fee_tvl_ratio=${perf.fee_tvl_ratio} that showed volume collapse - fees evaporated quickly. Minimum sustained volume check needed before deploying.`;
      tags.push("volume_collapse");
    } else if (outcome === "good") {
      rule = `WORKED: ${context} -> PnL +${perf.pnl_pct}%, range efficiency ${perf.range_efficiency}%.`;
      tags.push("worked");
    } else {
      rule = `FAILED: ${context} -> PnL ${perf.pnl_pct}%, range efficiency ${perf.range_efficiency}%. Reason: ${perf.close_reason}.`;
      tags.push("failed");
    }
  }

  if (!rule) return null;

  return {
    id: Date.now(),
    rule,
    tags,
    outcome,
    context,
    pnl_pct: perf.pnl_pct,
    range_efficiency: perf.range_efficiency,
    pool: perf.pool,
    created_at: new Date().toISOString(),
  };
}

function isFiniteNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function avg(arr) {
  return arr.reduce((sum, value) => sum + value, 0) / arr.length;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function nudge(current, target, maxChange) {
  const delta = target - current;
  const maxDelta = current * maxChange;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function formatLessons(lessons) {
  return lessons.map((lesson) => {
    const date = lesson.created_at ? lesson.created_at.slice(0, 16).replace("T", " ") : "unknown";
    const pin = lesson.pinned ? "[PINNED] " : "";
    const outcome = lesson.outcome ? lesson.outcome.toUpperCase() : "INFO";
    return `${pin}[${outcome}] [${date}] ${lesson.rule}`;
  }).join("\n");
}

function resolveLessonStoreApi(storeApi) {
  if (storeApi?.load && storeApi?.save) return storeApi;
  return resolveLessonsStore();
}

export function evolveThresholds(perfData, config, { lessonsStore } = {}) {
  if (!perfData || perfData.length < MIN_EVOLVE_POSITIONS) return null;

  const winners = perfData.filter((p) => p.pnl_pct > 0);
  const losers = perfData.filter((p) => p.pnl_pct < -5);
  const hasSignal = winners.length >= 2 || losers.length >= 2;
  if (!hasSignal) return null;

  const changes = {};
  const rationale = {};

  {
    const winnerVols = winners.map((p) => p.volatility).filter(isFiniteNum);
    const loserVols = losers.map((p) => p.volatility).filter(isFiniteNum);
    const current = config.screening.maxVolatility;

    if (loserVols.length >= 2) {
      const loserP25 = percentile(loserVols, 25);
      if (loserP25 < current) {
        const target = loserP25 * 1.15;
        const newVal = clamp(nudge(current, target, MAX_CHANGE_PER_STEP), 1.0, 20.0);
        const rounded = Number(newVal.toFixed(1));
        if (rounded < current) {
          changes.maxVolatility = rounded;
          rationale.maxVolatility = `Losers clustered at volatility ~${loserP25.toFixed(1)} - tightened from ${current} to ${rounded}`;
        }
      }
    } else if (winnerVols.length >= 3 && losers.length === 0) {
      const winnerP75 = percentile(winnerVols, 75);
      if (winnerP75 > current * 1.1) {
        const target = winnerP75 * 1.1;
        const newVal = clamp(nudge(current, target, MAX_CHANGE_PER_STEP), 1.0, 20.0);
        const rounded = Number(newVal.toFixed(1));
        if (rounded > current) {
          changes.maxVolatility = rounded;
          rationale.maxVolatility = `All ${winners.length} positions profitable - loosened from ${current} to ${rounded}`;
        }
      }
    }
  }

  {
    const winnerFees = winners.map((p) => p.fee_tvl_ratio).filter(isFiniteNum);
    const loserFees = losers.map((p) => p.fee_tvl_ratio).filter(isFiniteNum);
    const current = config.screening.minFeeTvlRatio;

    if (winnerFees.length >= 2) {
      const minWinnerFee = Math.min(...winnerFees);
      if (minWinnerFee > current * 1.2) {
        const target = minWinnerFee * 0.85;
        const newVal = clamp(nudge(current, target, MAX_CHANGE_PER_STEP), 0.05, 10.0);
        const rounded = Number(newVal.toFixed(2));
        if (rounded > current) {
          changes.minFeeTvlRatio = rounded;
          rationale.minFeeTvlRatio = `Lowest winner fee_tvl=${minWinnerFee.toFixed(2)} - raised floor from ${current} to ${rounded}`;
        }
      }
    }

    if (loserFees.length >= 2) {
      const maxLoserFee = Math.max(...loserFees);
      if (maxLoserFee < current * 1.5 && winnerFees.length > 0) {
        const minWinnerFee = Math.min(...winnerFees);
        if (minWinnerFee > maxLoserFee) {
          const target = maxLoserFee * 1.2;
          const newVal = clamp(nudge(current, target, MAX_CHANGE_PER_STEP), 0.05, 10.0);
          const rounded = Number(newVal.toFixed(2));
          if (rounded > current && !changes.minFeeTvlRatio) {
            changes.minFeeTvlRatio = rounded;
            rationale.minFeeTvlRatio = `Losers had fee_tvl<=${maxLoserFee.toFixed(2)}, winners higher - raised floor from ${current} to ${rounded}`;
          }
        }
      }
    }
  }

  {
    const loserOrganics = losers.map((p) => p.organic_score).filter(isFiniteNum);
    const winnerOrganics = winners.map((p) => p.organic_score).filter(isFiniteNum);
    const current = config.screening.minOrganic;

    if (loserOrganics.length >= 2 && winnerOrganics.length >= 1) {
      const avgLoserOrganic = avg(loserOrganics);
      const avgWinnerOrganic = avg(winnerOrganics);
      if (avgWinnerOrganic - avgLoserOrganic >= 10) {
        const minWinnerOrganic = Math.min(...winnerOrganics);
        const target = Math.max(minWinnerOrganic - 3, current);
        const newVal = clamp(Math.round(nudge(current, target, MAX_CHANGE_PER_STEP)), 60, 90);
        if (newVal > current) {
          changes.minOrganic = newVal;
          rationale.minOrganic = `Winner avg organic ${avgWinnerOrganic.toFixed(0)} vs loser avg ${avgLoserOrganic.toFixed(0)} - raised from ${current} to ${newVal}`;
        }
      }
    }
  }

  if (Object.keys(changes).length === 0) return { changes: {}, rationale: {} };

  let userConfig = {};
  if (fs.existsSync(USER_CONFIG_PATH)) {
    try {
      userConfig = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
    } catch {
      userConfig = {};
    }
  }

  Object.assign(userConfig, changes);
  userConfig._lastEvolved = new Date().toISOString();
  userConfig._positionsAtEvolution = perfData.length;
  fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(userConfig, null, 2));

  const screening = config.screening;
  if (changes.maxVolatility != null) screening.maxVolatility = changes.maxVolatility;
  if (changes.minFeeTvlRatio != null) screening.minFeeTvlRatio = changes.minFeeTvlRatio;
  if (changes.minOrganic != null) screening.minOrganic = changes.minOrganic;

  const store = resolveLessonStoreApi(lessonsStore);
  const data = store.load();
  data.lessons.push({
    id: Date.now(),
    rule: `[AUTO-EVOLVED @ ${perfData.length} positions] ${Object.entries(changes).map(([key, value]) => `${key}=${value}`).join(", ")} - ${Object.values(rationale).join("; ")}`,
    tags: ["evolution", "config_change"],
    outcome: "manual",
    created_at: new Date().toISOString(),
  });
  store.save(data);

  return { changes, rationale };
}

export function createLessonsStore({ filePath = DEFAULT_LESSONS_FILE, snapshotWriter = null } = {}) {
  function load() {
    if (!fs.existsSync(filePath)) {
      return createEmptyLessonsData();
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return {
        lessons: Array.isArray(data.lessons) ? data.lessons : [],
        performance: Array.isArray(data.performance) ? data.performance : [],
      };
    } catch {
      return createEmptyLessonsData();
    }
  }

  function save(data) {
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    if (snapshotWriter) {
      void snapshotWriter(data);
    }
  }

  async function recordPerformance(perf) {
    const data = load();

    const pnlUsd = (perf.final_value_usd + perf.fees_earned_usd) - perf.initial_value_usd;
    const pnlPct = perf.initial_value_usd > 0 ? (pnlUsd / perf.initial_value_usd) * 100 : 0;
    const rangeEfficiency = perf.minutes_held > 0 ? (perf.minutes_in_range / perf.minutes_held) * 100 : 0;

    const entry = {
      ...perf,
      pnl_usd: Math.round(pnlUsd * 100) / 100,
      pnl_pct: Math.round(pnlPct * 100) / 100,
      range_efficiency: Math.round(rangeEfficiency * 10) / 10,
      recorded_at: new Date().toISOString(),
    };

    data.performance.push(entry);

    const lesson = deriveLesson(entry);
    if (lesson) {
      data.lessons.push(lesson);
      log("lessons", `New lesson: ${lesson.rule}`);
    }

    save(data);

    if (perf.pool) {
      const { recordPoolDeploy } = await import("./pool-memory.js");
      recordPoolDeploy(perf.pool, {
        pool_name: perf.pool_name,
        base_mint: perf.base_mint,
        deployed_at: perf.deployed_at,
        closed_at: entry.recorded_at,
        pnl_pct: entry.pnl_pct,
        pnl_usd: entry.pnl_usd,
        range_efficiency: entry.range_efficiency,
        minutes_held: perf.minutes_held,
        close_reason: perf.close_reason,
        strategy: perf.strategy,
        volatility: perf.volatility,
      });
    }

    if (data.performance.length % MIN_EVOLVE_POSITIONS === 0) {
      const { config, reloadScreeningThresholds } = await import("../core/config.js");
      const result = evolveThresholds(data.performance, config, { lessonsStore: { load, save } });
      if (result?.changes && Object.keys(result.changes).length > 0) {
        reloadScreeningThresholds();
        log("evolve", `Auto-evolved thresholds: ${JSON.stringify(result.changes)}`);
      }
    }

    import("./hive-mind.js").then((module) => module.syncToHive()).catch(() => {});
  }

  function addLesson(rule, tags = [], { pinned = false, role = null } = {}) {
    const data = load();
    data.lessons.push({
      id: Date.now(),
      rule,
      tags,
      outcome: "manual",
      pinned: !!pinned,
      role: role || null,
      created_at: new Date().toISOString(),
    });
    save(data);
    log("lessons", `Manual lesson added${pinned ? " [PINNED]" : ""}${role ? ` [${role}]` : ""}: ${rule}`);
  }

  function pinLesson(id) {
    const data = load();
    const lesson = data.lessons.find((item) => item.id === id);
    if (!lesson) return { found: false };
    lesson.pinned = true;
    save(data);
    log("lessons", `Pinned lesson ${id}: ${lesson.rule.slice(0, 60)}`);
    return { found: true, pinned: true, id, rule: lesson.rule };
  }

  function unpinLesson(id) {
    const data = load();
    const lesson = data.lessons.find((item) => item.id === id);
    if (!lesson) return { found: false };
    lesson.pinned = false;
    save(data);
    return { found: true, pinned: false, id, rule: lesson.rule };
  }

  function listLessons({ role = null, pinned = null, tag = null, limit = 30 } = {}) {
    const data = load();
    let lessons = [...data.lessons];

    if (pinned !== null) lessons = lessons.filter((lesson) => !!lesson.pinned === pinned);
    if (role) lessons = lessons.filter((lesson) => !lesson.role || lesson.role === role);
    if (tag) lessons = lessons.filter((lesson) => lesson.tags?.includes(tag));

    return {
      total: lessons.length,
      lessons: lessons.slice(-limit).map((lesson) => ({
        id: lesson.id,
        rule: lesson.rule.slice(0, 120),
        tags: lesson.tags,
        outcome: lesson.outcome,
        pinned: !!lesson.pinned,
        role: lesson.role || "all",
        created_at: lesson.created_at?.slice(0, 10),
      })),
    };
  }

  function removeLesson(id) {
    const data = load();
    const before = data.lessons.length;
    data.lessons = data.lessons.filter((lesson) => lesson.id !== id);
    save(data);
    return before - data.lessons.length;
  }

  function removeLessonsByKeyword(keyword) {
    const data = load();
    const before = data.lessons.length;
    const lowerKeyword = keyword.toLowerCase();
    data.lessons = data.lessons.filter((lesson) => !lesson.rule.toLowerCase().includes(lowerKeyword));
    save(data);
    return before - data.lessons.length;
  }

  function clearAllLessons() {
    const data = load();
    const count = data.lessons.length;
    data.lessons = [];
    save(data);
    return count;
  }

  function clearPerformance() {
    const data = load();
    const count = data.performance.length;
    data.performance = [];
    save(data);
    return count;
  }

  function getLessonsForPrompt(opts = {}) {
    const normalizedOpts = typeof opts === "number" ? { maxLessons: opts } : opts;
    const { agentType = "GENERAL", maxLessons } = normalizedOpts;

    const data = load();
    if (data.lessons.length === 0) return null;

    const isAutoCycle = agentType === "SCREENER" || agentType === "MANAGER";
    const pinnedCap = isAutoCycle ? 5 : 10;
    const roleCap = isAutoCycle ? 6 : 15;
    const recentCap = maxLessons ?? (isAutoCycle ? 10 : 35);

    const outcomePriority = { bad: 0, poor: 1, failed: 1, good: 2, worked: 2, manual: 1, neutral: 3, evolution: 2 };
    const byPriority = (a, b) => (outcomePriority[a.outcome] ?? 3) - (outcomePriority[b.outcome] ?? 3);

    const pinned = data.lessons
      .filter((lesson) => lesson.pinned && (!lesson.role || lesson.role === agentType || agentType === "GENERAL"))
      .sort(byPriority)
      .slice(0, pinnedCap);

    const usedIds = new Set(pinned.map((lesson) => lesson.id));
    const roleTags = ROLE_TAGS[agentType] || [];

    const roleMatched = data.lessons
      .filter((lesson) => {
        if (usedIds.has(lesson.id)) return false;
        const roleOk = !lesson.role || lesson.role === agentType || agentType === "GENERAL";
        const tagOk = roleTags.length === 0 || !lesson.tags?.length || lesson.tags.some((tag) => roleTags.includes(tag));
        return roleOk && tagOk;
      })
      .sort(byPriority)
      .slice(0, roleCap);

    roleMatched.forEach((lesson) => usedIds.add(lesson.id));

    const remainingBudget = recentCap - pinned.length - roleMatched.length;
    const recent = remainingBudget > 0
      ? data.lessons
          .filter((lesson) => !usedIds.has(lesson.id))
          .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
          .slice(0, remainingBudget)
      : [];

    const selected = [...pinned, ...roleMatched, ...recent];
    if (selected.length === 0) return null;

    const sections = [];
    if (pinned.length) sections.push(`-- PINNED (${pinned.length}) --\n${formatLessons(pinned)}`);
    if (roleMatched.length) sections.push(`-- ${agentType} (${roleMatched.length}) --\n${formatLessons(roleMatched)}`);
    if (recent.length) sections.push(`-- RECENT (${recent.length}) --\n${formatLessons(recent)}`);
    return sections.join("\n\n");
  }

  function getPerformanceHistory({ hours = 24, limit = 50 } = {}) {
    const data = load();
    const performance = data.performance;
    if (performance.length === 0) return { positions: [], count: 0, hours };

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const filtered = performance
      .filter((record) => record.recorded_at >= cutoff)
      .slice(-limit)
      .map((record) => ({
        pool_name: record.pool_name,
        pool: record.pool,
        strategy: record.strategy,
        pnl_usd: record.pnl_usd,
        pnl_pct: record.pnl_pct,
        fees_earned_usd: record.fees_earned_usd,
        range_efficiency: record.range_efficiency,
        minutes_held: record.minutes_held,
        close_reason: record.close_reason,
        closed_at: record.recorded_at,
      }));

    const totalPnl = filtered.reduce((sum, record) => sum + (record.pnl_usd ?? 0), 0);
    const wins = filtered.filter((record) => record.pnl_usd > 0).length;

    return {
      hours,
      count: filtered.length,
      total_pnl_usd: Math.round(totalPnl * 100) / 100,
      win_rate_pct: filtered.length > 0 ? Math.round((wins / filtered.length) * 100) : null,
      positions: filtered,
    };
  }

  function getPerformanceSummary() {
    const data = load();
    const performance = data.performance;
    if (performance.length === 0) return null;

    const totalPnl = performance.reduce((sum, record) => sum + record.pnl_usd, 0);
    const avgPnlPct = performance.reduce((sum, record) => sum + record.pnl_pct, 0) / performance.length;
    const avgRangeEfficiency = performance.reduce((sum, record) => sum + record.range_efficiency, 0) / performance.length;
    const wins = performance.filter((record) => record.pnl_usd > 0).length;

    return {
      total_positions_closed: performance.length,
      total_pnl_usd: Math.round(totalPnl * 100) / 100,
      avg_pnl_pct: Math.round(avgPnlPct * 100) / 100,
      avg_range_efficiency_pct: Math.round(avgRangeEfficiency * 10) / 10,
      win_rate_pct: Math.round((wins / performance.length) * 100),
      total_lessons: data.lessons.length,
    };
  }

  return {
    filePath,
    load,
    save,
    recordPerformance,
    addLesson,
    pinLesson,
    unpinLesson,
    listLessons,
    removeLesson,
    removeLessonsByKeyword,
    clearAllLessons,
    clearPerformance,
    getLessonsForPrompt,
    getPerformanceHistory,
    getPerformanceSummary,
  };
}

export function createWorkerLessonsStore(workerContext = {}) {
  return createLessonsStore({
    filePath: walletDataPath(workerContext, "lessons.json"),
    snapshotWriter: createSnapshotWriter(workerContext, "lessons"),
  });
}

const defaultLessonsStore = createLessonsStore();

export function getDefaultLessonsStore() {
  return defaultLessonsStore;
}

function resolveLessonsStore() {
  return getRuntimeScope()?.lessonsStore || defaultLessonsStore;
}

export async function recordPerformance(perf) {
  return resolveLessonsStore().recordPerformance(perf);
}

export function addLesson(rule, tags = [], options = {}) {
  return resolveLessonsStore().addLesson(rule, tags, options);
}

export function pinLesson(id) {
  return resolveLessonsStore().pinLesson(id);
}

export function unpinLesson(id) {
  return resolveLessonsStore().unpinLesson(id);
}

export function listLessons(options = {}) {
  return resolveLessonsStore().listLessons(options);
}

export function removeLesson(id) {
  return resolveLessonsStore().removeLesson(id);
}

export function removeLessonsByKeyword(keyword) {
  return resolveLessonsStore().removeLessonsByKeyword(keyword);
}

export function clearAllLessons() {
  return resolveLessonsStore().clearAllLessons();
}

export function clearPerformance() {
  return resolveLessonsStore().clearPerformance();
}

export function getLessonsForPrompt(options = {}) {
  return resolveLessonsStore().getLessonsForPrompt(options);
}

export function getPerformanceHistory(options = {}) {
  return resolveLessonsStore().getPerformanceHistory(options);
}

export function getPerformanceSummary() {
  return resolveLessonsStore().getPerformanceSummary();
}

export function getLessonsData() {
  return resolveLessonsStore().load();
}
