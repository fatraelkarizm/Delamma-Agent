import cron from "node-cron";
import { heartbeat } from "../lib/db.js";
import { log } from "../lib/logger.js";
import { createWorkerStateStore, getTrackedPosition, getTrackedPositions } from "../lib/state.js";
import { agentLoop } from "./agent.js";
import { config, computeDeployAmount } from "./config.js";
import { runBriefing, maybeRunMissedBriefing } from "./briefing-service.js";
import { markManagementRun, markScreeningRun, seedRuntimeTimers } from "./runtime-prompt.js";
import { getMyPositions, getPositionPnl } from "../tools/dlmm.js";
import { getWalletBalances } from "../tools/wallet.js";
import { getTopCandidates } from "../tools/screening.js";
import { sendMessage, notifyOutOfRange, isEnabled as telegramEnabled } from "./telegram.js";
import { createWorkerStrategyLibraryStore, getActiveStrategy } from "../memory/strategy-library.js";
import { createWorkerLessonsStore } from "../memory/lessons.js";
import { createWorkerPoolMemoryStore, recordPositionSnapshot, recallForPool } from "../memory/pool-memory.js";
import { createWorkerSmartWalletStore, checkSmartWalletsOnPool } from "../memory/smart-wallets.js";
import { createWorkerTokenBlacklistStore } from "../memory/token-blacklist.js";
import { getTokenHolders, getTokenNarrative, getTokenInfo } from "../tools/token.js";
import { createWorkerContext, formatWorkerLabel } from "./tenant-context.js";
import { getDefaultWorkerRegistry } from "./worker-registry.js";
import { runWithRuntimeScope } from "./runtime-scope.js";

const DEFAULT_LEASE_METADATA = { scope: "wallet-runtime" };

export function createExecutionService(
  workerContext = createWorkerContext(),
  { registry = getDefaultWorkerRegistry(), leaseTtlMs = registry.defaultLeaseMs } = {}
) {
  const workerLabel = formatWorkerLabel(workerContext);
  const stateStore = createWorkerStateStore(workerContext);
  const strategyLibraryStore = createWorkerStrategyLibraryStore(workerContext);
  const lessonsStore = createWorkerLessonsStore(workerContext);
  const poolMemoryStore = createWorkerPoolMemoryStore(workerContext);
  const smartWalletStore = createWorkerSmartWalletStore(workerContext);
  const tokenBlacklistStore = createWorkerTokenBlacklistStore(workerContext);
  const runtimeScope = {
    workerContext,
    stateStore,
    strategyLibraryStore,
    lessonsStore,
    poolMemoryStore,
    smartWalletStore,
    tokenBlacklistStore,
  };

  let cronTasks = [];
  let managementBusy = false;
  let screeningBusy = false;
  let screeningLastTriggered = 0;
  let cronStarted = false;

  void registry.registerWorker(workerContext, { status: "created" });

  function workerLog(channel, message) {
    log(channel, `${workerLabel} ${message}`);
  }

  function withWorkerScope(fn) {
    return runWithRuntimeScope(runtimeScope, fn);
  }

  async function touchWorker(status, metadata = {}) {
    await registry.touchWorker(workerContext, { status, ...metadata });
  }

  async function ensureWalletLease(reason) {
    await touchWorker(reason);

    if (await registry.hasWalletLease(workerContext)) {
      await registry.renewWalletLease(workerContext, {
        ttlMs: leaseTtlMs,
        metadata: { ...DEFAULT_LEASE_METADATA, reason },
      });
      return true;
    }

    const result = await registry.acquireWalletLease(workerContext, {
      ttlMs: leaseTtlMs,
      metadata: { ...DEFAULT_LEASE_METADATA, reason },
    });

    if (!result.acquired) {
      const lease = result.lease;
      workerLog(
        "lease",
        `Wallet lease busy for ${reason} - held by ${lease?.worker_id || "unknown"} until ${lease?.expires_at || "unknown"}`
      );
      return false;
    }

    workerLog("lease", `Wallet lease acquired for ${reason}`);
    return true;
  }

  async function renewWalletLease(reason) {
    if (!(await registry.hasWalletLease(workerContext))) {
      return ensureWalletLease(reason);
    }

    await registry.renewWalletLease(workerContext, {
      ttlMs: leaseTtlMs,
      metadata: { ...DEFAULT_LEASE_METADATA, reason },
    });
    await touchWorker(reason);
    return true;
  }

  async function releaseWalletLease(reason = "release") {
    const released = await registry.releaseWalletLease(workerContext);
    if (released) {
      workerLog("lease", `Wallet lease released after ${reason}`);
    }
    await touchWorker(reason);
    return released;
  }

  async function getWalletLease() {
    return registry.getWalletLease(workerContext);
  }

  function isExecutionBusy() {
    return managementBusy || screeningBusy;
  }

  function isCronStarted() {
    return cronStarted;
  }

  async function stopCronJobs({ releaseLease = true } = {}) {
    for (const task of cronTasks) task.stop();
    cronTasks = [];
    cronStarted = false;
    if (releaseLease) {
      await releaseWalletLease("stop_cron_jobs");
    }
  }

  async function runManagementCycle({ silent = false } = {}) {
    if (!(await renewWalletLease("management_cycle"))) {
      return "Management cycle skipped: wallet lease is held by another worker.";
    }

    return withWorkerScope(async () => {
      workerLog("cron", `Starting management cycle [model: ${config.llm.managementModel}]`);
      let mgmtReport = null;
      let positions = [];

      try {
        const livePositions = await getMyPositions().catch(() => null);
        positions = livePositions?.positions || [];

        if (positions.length === 0) {
          workerLog("cron", "No open positions - triggering screening cycle");
          runScreeningCycle().catch((e) => workerLog("cron_error", `Triggered screening failed: ${e.message}`));
          return;
        }

        const maxVolatility = positions.reduce((max, p) => {
          const tracked = getTrackedPosition(p.position);
          return Math.max(max, tracked?.volatility ?? 0);
        }, 0);
        const targetInterval = maxVolatility >= 5 ? 3 : maxVolatility >= 2 ? 5 : 10;
        if (config.schedule.managementIntervalMin !== targetInterval) {
          config.schedule.managementIntervalMin = targetInterval;
          workerLog("cron", `Management interval adjusted to ${targetInterval}m (max volatility: ${maxVolatility})`);
          if (cronStarted) await startCronJobs();
        }

        const screeningCooldownMs = 5 * 60 * 1000;
        if (positions.length < config.risk.maxPositions && Date.now() - screeningLastTriggered > screeningCooldownMs) {
          screeningLastTriggered = Date.now();
          workerLog("cron", `Positions (${positions.length}/${config.risk.maxPositions}) - triggering screening in background`);
          runScreeningCycle().catch((e) => workerLog("cron_error", `Triggered screening failed: ${e.message}`));
        }

        const positionData = await Promise.all(positions.map(async (p) => {
          recordPositionSnapshot(p.pool, p);
          const pnl = await getPositionPnl({ pool_address: p.pool, position_address: p.position }).catch(() => null);
          const recall = recallForPool(p.pool);
          return { ...p, pnl, recall };
        }));

        const positionBlocks = positionData.map((p) => {
          const pnl = p.pnl;
          const lines = [
            `POSITION: ${p.pair} (${p.position})`,
            `  pool: ${p.pool}`,
            `  age: ${p.age_minutes ?? "?"}m | in_range: ${p.in_range} | oor_minutes: ${p.minutes_out_of_range ?? 0}`,
            pnl ? `  pnl_pct: ${pnl.pnl_pct}% | pnl_usd: $${pnl.pnl_usd} | unclaimed_fees: $${pnl.unclaimed_fee_usd} | claimed_fees: $${Math.max(0, (pnl.all_time_fees_usd || 0) - (pnl.unclaimed_fee_usd || 0)).toFixed(2)} | value: $${pnl.current_value_usd} | fee_per_tvl_24h: ${pnl.fee_per_tvl_24h ?? "?"}%` : "  pnl: fetch failed",
            pnl ? `  bins: lower=${pnl.lower_bin} upper=${pnl.upper_bin} active=${pnl.active_bin}` : null,
            p.instruction ? `  instruction: "${p.instruction}"` : null,
            p.recall ? `  memory: ${p.recall}` : null,
          ].filter(Boolean);
          return lines.join("\n");
        }).join("\n\n");

        let hivePatterns = "";
        try {
          const hiveMind = await import("../memory/hive-mind.js");
          if (hiveMind.isEnabled()) {
            const patterns = await hiveMind.queryPatternConsensus();
            const significant = (patterns || []).filter((p) => p.count >= 10);
            if (significant.length > 0) {
              hivePatterns = `\nHIVE MIND PATTERNS (supplementary):\n${significant.slice(0, 3).map((p) => `[HIVE] ${p.strategy}: ${p.win_rate}% win, ${p.avg_pnl}% avg PnL (${p.count} deploys)`).join("\n")}\n`;
            }
          }
        } catch { /* hive is best-effort */ }

        const { content } = await agentLoop(`
MANAGEMENT CYCLE - ${positions.length} position(s)

PRE-LOADED POSITION DATA (no fetching needed):
${positionBlocks}${hivePatterns}

HARD CLOSE RULES - apply in order, first match wins:
1. instruction set AND condition met -> CLOSE (highest priority)
2. instruction set AND condition NOT met -> HOLD, skip remaining rules
3. pnl_pct <= ${config.management.emergencyPriceDropPct}% -> CLOSE (stop loss)
4. pnl_pct >= ${config.management.takeProfitFeePct}% -> CLOSE (take profit)
5. active_bin > upper_bin + ${config.management.outOfRangeBinsToClose} -> CLOSE (pumped far above range)
6. active_bin > upper_bin AND oor_minutes >= ${config.management.outOfRangeWaitMinutes} -> CLOSE (stale above range)
7. fee_per_tvl_24h < ${config.management.minFeePerTvl24h} AND age_minutes >= 60 -> CLOSE (fee yield too low)

CLAIM RULE: If unclaimed_fee_usd >= ${config.management.minClaimAmount}, call claim_fees. Do not use any other threshold.

INSTRUCTIONS:
All data is pre-loaded above - do NOT call get_my_positions or get_position_pnl.
Apply the rules to each position and write your report immediately.
Only call tools if a position needs to be CLOSED, FLIPPED, or fees need to be CLAIMED.
If all positions STAY and no fees to claim, just write the report with no tool calls.

REPORT FORMAT (one per position):
**[PAIR]** | Age: [X]m | Unclaimed: $[X] | PnL: [X]% | [STAY/CLOSE]
Range: [########............] (20 chars: # = bins up to active, . = bins above active)
Only add: **Rule [N]:** [reason] - if a close rule triggered. Omit rule line if STAY with no rule.

After all positions, add one summary line:
[N] positions | $[total_value] | fees today: $[sum_unclaimed] | [any notable action taken]
      `, config.llm.maxSteps, [], "MANAGER", config.llm.managementModel, config.llm.maxTokens);
        mgmtReport = content;
      } catch (error) {
        workerLog("cron_error", `Management cycle failed: ${error.message}`);
        mgmtReport = `Management cycle failed: ${error.message}`;
      } finally {
        if (!silent && telegramEnabled()) {
          if (mgmtReport) sendMessage(`${workerLabel} Management Cycle\n\n${mgmtReport}`).catch(() => {});
          for (const p of positions) {
            if (!p.in_range && p.minutes_out_of_range >= config.management.outOfRangeWaitMinutes) {
              notifyOutOfRange({ pair: p.pair, minutesOOR: p.minutes_out_of_range }).catch(() => {});
            }
          }
        }
      }

      return mgmtReport;
    });
  }

  async function runScreeningCycle({ silent = false } = {}) {
    if (screeningBusy) return;
    if (!(await renewWalletLease("screening_cycle"))) {
      return "Screening cycle skipped: wallet lease is held by another worker.";
    }

    return withWorkerScope(async () => {
      let prePositions;
      let preBalance;
      try {
        [prePositions, preBalance] = await Promise.all([getMyPositions(), getWalletBalances()]);
        if (prePositions.total_positions >= config.risk.maxPositions) {
          workerLog("cron", `Screening skipped - max positions reached (${prePositions.total_positions}/${config.risk.maxPositions})`);
          return;
        }
        const minRequired = config.management.deployAmountSol + config.management.gasReserve;
        if (preBalance.sol < minRequired) {
          workerLog("cron", `Screening skipped - insufficient SOL (${preBalance.sol.toFixed(3)} < ${minRequired} needed for deploy + gas)`);
          return;
        }
      } catch (e) {
        workerLog("cron_error", `Screening pre-check failed: ${e.message}`);
        return;
      }

      screeningBusy = true;
      markScreeningRun();
      workerLog("cron", `Starting screening cycle [model: ${config.llm.screeningModel}]`);
      let screenReport = null;

      try {
        const currentBalance = preBalance;
        const deployAmount = computeDeployAmount(currentBalance.sol);
        workerLog("cron", `Computed deploy amount: ${deployAmount} SOL (wallet: ${currentBalance.sol} SOL)`);

        const activeStrategy = getActiveStrategy();
        const strategyBlock = activeStrategy
          ? `ACTIVE STRATEGY: ${activeStrategy.name} - LP: ${activeStrategy.lp_strategy} | bins_above: ${activeStrategy.range?.bins_above ?? 0} (FIXED - never change) | deposit: ${activeStrategy.entry?.single_side === "sol" ? "SOL only (amount_y, amount_x=0)" : "dual-sided"} | best for: ${activeStrategy.best_for}`
          : "No active strategy - use default bid_ask, bins_above: 0, SOL only.";

        const topCandidates = await getTopCandidates({ limit: 5 }).catch(() => null);
        const candidates = topCandidates?.candidates || topCandidates?.pools || [];

        const candidateBlocks = [];
        for (const pool of candidates.slice(0, 5)) {
          const mint = pool.base?.mint;
          const [smartWallets, holders, narrative, tokenInfo, poolMemory] = await Promise.allSettled([
            checkSmartWalletsOnPool({ pool_address: pool.pool }),
            mint ? getTokenHolders({ mint, limit: 100 }) : Promise.resolve(null),
            mint ? getTokenNarrative({ mint }) : Promise.resolve(null),
            mint ? getTokenInfo({ query: mint }) : Promise.resolve(null),
            Promise.resolve(recallForPool(pool.pool)),
          ]);

          const sw = smartWallets.status === "fulfilled" ? smartWallets.value : null;
          const h = holders.status === "fulfilled" ? holders.value : null;
          const n = narrative.status === "fulfilled" ? narrative.value : null;
          const ti = tokenInfo.status === "fulfilled" ? tokenInfo.value?.results?.[0] : null;
          const mem = poolMemory.value;

          const priceChange = ti?.stats_1h?.price_change;
          const netBuyers = ti?.stats_1h?.net_buyers;
          const botPct = ti?.audit?.bot_holders_pct ?? h?.bundlers_pct_in_top_100 ?? "?";
          const top10Pct = ti?.audit?.top_holders_pct ?? h?.top_10_real_holders_pct ?? "?";
          const launchpad = ti?.launchpad ?? null;
          const feesSol = ti?.global_fees_sol ?? h?.global_fees_sol ?? "?";

          if (launchpad && config.screening.blockedLaunchpads.length > 0 && config.screening.blockedLaunchpads.includes(launchpad)) {
            workerLog("screening", `Skipping ${pool.name} - blocked launchpad: ${launchpad}`);
            continue;
          }

          const lines = [
            `POOL: ${pool.name} (${pool.pool})`,
            `  metrics: bin_step=${pool.bin_step}, fee_pct=${pool.fee_pct}%, fee_tvl=${pool.fee_active_tvl_ratio}, vol=$${pool.volume_window}, tvl=$${pool.active_tvl}, volatility=${pool.volatility}, mcap=$${pool.mcap}, organic=${pool.organic_score}`,
            `  audit: top10=${top10Pct}%, bots=${botPct}%, fees=${feesSol}SOL${launchpad ? `, launchpad=${launchpad}` : ""}`,
            `  smart_wallets: ${sw?.in_pool?.length ?? 0} present${sw?.in_pool?.length ? ` -> CONFIDENCE BOOST (${sw.in_pool.map((w) => w.name).join(", ")})` : ""}`,
            priceChange != null ? `  1h: price${priceChange >= 0 ? "+" : ""}${priceChange}%, net_buyers=${netBuyers ?? "?"}` : null,
            n?.narrative ? `  narrative: ${n.narrative.slice(0, 500)}` : "  narrative: none",
            mem ? `  memory: ${mem}` : null,
          ].filter(Boolean);

          candidateBlocks.push(lines.join("\n"));
        }

        let candidateContext = candidateBlocks.length > 0
          ? `\nPRE-LOADED CANDIDATE ANALYSIS (smart wallets, holders, narrative already fetched):\n${candidateBlocks.join("\n\n")}\n`
          : "";

        try {
          const hiveMind = await import("../memory/hive-mind.js");
          if (hiveMind.isEnabled()) {
            const poolAddrs = candidates.map((c) => c.pool).filter(Boolean);
            if (poolAddrs.length > 0) {
              const hive = await hiveMind.formatPoolConsensusForPrompt(poolAddrs);
              if (hive) candidateContext += `\n${hive}\n`;
            }
          }
        } catch { /* hive is best-effort */ }

        const { content } = await agentLoop(`
SCREENING CYCLE
${strategyBlock}
Positions: ${prePositions.total_positions}/${config.risk.maxPositions} | SOL: ${currentBalance.sol.toFixed(3)} | Deploy: ${deployAmount} SOL
${candidateContext}
DECISION RULES:
- HARD SKIP if fees < ${config.screening.minTokenFeesSol} SOL (bundled/scam)
- HARD SKIP if top10 > ${config.screening.maxTop10Pct}% OR bots > ${config.screening.maxBundlersPct}%
${config.screening.blockedLaunchpads.length ? `- HARD SKIP if launchpad is any of: ${config.screening.blockedLaunchpads.join(", ")}` : ""}
- SKIP if narrative is empty/null or pure hype with no specific story (unless smart wallets present)
- Bots 5-25% are normal, not a skip reason on their own
- Smart wallets present -> strong confidence boost

STEPS:
1. Pick the best candidate. If none pass, report why and stop.
2. Call deploy_position with ${deployAmount} SOL. Set bins_below = round(35 + (volatility/5)*34) clamped to [35,69].
3. Report result.
      `, config.llm.maxSteps, [], "SCREENER", config.llm.screeningModel, config.llm.maxTokens);
        screenReport = content;
      } catch (error) {
        workerLog("cron_error", `Screening cycle failed: ${error.message}`);
        screenReport = `Screening cycle failed: ${error.message}`;
      } finally {
        screeningBusy = false;
        if (!silent && telegramEnabled()) {
          if (screenReport) sendMessage(`${workerLabel} Screening Cycle\n\n${screenReport}`).catch(() => {});
        }
      }

      return screenReport;
    });
  }

  async function startCronJobs() {
    if (!(await ensureWalletLease("start_cron_jobs"))) {
      await stopCronJobs({ releaseLease: false });
      cronStarted = false;
      return false;
    }

    await stopCronJobs({ releaseLease: false });
    cronStarted = true;

    const mgmtTask = cron.schedule(`*/${Math.max(1, config.schedule.managementIntervalMin)} * * * *`, async () => {
      if (managementBusy) return;
      if (!(await renewWalletLease("cron_management_tick"))) return;

      managementBusy = true;
      markManagementRun();
      try {
        await runManagementCycle();
      } finally {
        managementBusy = false;
      }
    });

    const screenTask = cron.schedule(`*/${Math.max(1, config.schedule.screeningIntervalMin)} * * * *`, async () => {
      if (!(await renewWalletLease("cron_screening_tick"))) return;
      await runScreeningCycle();
    });

    const healthTask = cron.schedule("0 * * * *", async () => {
      if (managementBusy) return;
      if (!(await renewWalletLease("cron_health_tick"))) return;

      managementBusy = true;
      await withWorkerScope(async () => {
        workerLog("cron", "Starting health check");
        try {
          await agentLoop(`
HEALTH CHECK

Summarize the current portfolio health, total fees earned, and performance of all open positions. Recommend any high-level adjustments if needed.
        `, config.llm.maxSteps, [], "MANAGER");
        } catch (error) {
          workerLog("cron_error", `Health check failed: ${error.message}`);
        } finally {
          managementBusy = false;
        }
      });
    });

    const briefingTask = cron.schedule("0 1 * * *", async () => {
      if (!(await renewWalletLease("cron_briefing_tick"))) return;
      await withWorkerScope(() => runBriefing());
    }, { timezone: "UTC" });

    const briefingWatchdog = cron.schedule("0 */6 * * *", async () => {
      if (!(await renewWalletLease("cron_briefing_watchdog"))) return;
      await withWorkerScope(() => maybeRunMissedBriefing());
    }, { timezone: "UTC" });

    const heartbeatTask = cron.schedule("* * * * *", async () => {
      if (!(await renewWalletLease("cron_heartbeat"))) return;

      await withWorkerScope(async () => {
        try {
          const positions = getTrackedPositions(true);
          await heartbeat({ dry_run: process.env.DRY_RUN === "true", open_positions: positions.length });
        } catch { /* best-effort */ }
      });
    });

    cronTasks = [mgmtTask, screenTask, healthTask, briefingTask, briefingWatchdog, heartbeatTask];
    workerLog("cron", `Cycles started - management every ${config.schedule.managementIntervalMin}m, screening every ${config.schedule.screeningIntervalMin}m`);
    return true;
  }

  async function ensureCronStarted() {
    if (cronStarted) return false;
    if (!(await ensureWalletLease("ensure_cron_started"))) return false;

    cronStarted = true;
    seedRuntimeTimers();
    return startCronJobs();
  }

  async function restartCronJobsIfStarted() {
    if (!cronStarted) return false;
    return startCronJobs();
  }

  async function destroy() {
    await stopCronJobs();
    await registry.unregisterWorker(workerContext);
  }

  return {
    context: workerContext,
    label: workerLabel,
    registry,
    stateStore,
    strategyLibraryStore,
    lessonsStore,
    poolMemoryStore,
    smartWalletStore,
    tokenBlacklistStore,
    runInScope: withWorkerScope,
    isExecutionBusy,
    isCronStarted,
    getWalletLease,
    ensureWalletLease,
    renewWalletLease,
    releaseWalletLease,
    stopCronJobs,
    runManagementCycle,
    runScreeningCycle,
    startCronJobs,
    ensureCronStarted,
    restartCronJobsIfStarted,
    destroy,
  };
}

const defaultExecutionService = createExecutionService(
  createWorkerContext({
    tenantId: "local",
    walletId: process.env.WALLET_ADDRESS || "primary",
    workerId: "local-default",
    mode: process.stdin.isTTY ? "interactive" : "background",
    channel: "default-runtime",
  })
);

export function getDefaultExecutionService() {
  return defaultExecutionService;
}

export function isExecutionBusy() {
  return defaultExecutionService.isExecutionBusy();
}

export function isCronStarted() {
  return defaultExecutionService.isCronStarted();
}

export function getWalletLease() {
  return defaultExecutionService.getWalletLease();
}

export async function ensureWalletLease(reason) {
  return defaultExecutionService.ensureWalletLease(reason);
}

export async function renewWalletLease(reason) {
  return defaultExecutionService.renewWalletLease(reason);
}

export async function releaseWalletLease(reason) {
  return defaultExecutionService.releaseWalletLease(reason);
}

export async function stopCronJobs(options) {
  return defaultExecutionService.stopCronJobs(options);
}

export async function runManagementCycle(options) {
  return defaultExecutionService.runManagementCycle(options);
}

export async function runScreeningCycle(options) {
  return defaultExecutionService.runScreeningCycle(options);
}

export async function startCronJobs() {
  return defaultExecutionService.startCronJobs();
}

export async function ensureCronStarted() {
  return defaultExecutionService.ensureCronStarted();
}

export async function restartCronJobsIfStarted() {
  return defaultExecutionService.restartCronJobsIfStarted();
}
