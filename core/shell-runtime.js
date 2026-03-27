import readline from "readline";
import { agentLoop } from "./agent.js";
import { log } from "../lib/logger.js";
import { getMyPositions } from "../tools/dlmm.js";
import { getWalletBalances } from "../tools/wallet.js";
import { getTopCandidates } from "../tools/screening.js";
import { config, reloadScreeningThresholds } from "./config.js";
import { evolveThresholds, getPerformanceSummary } from "../memory/lessons.js";
import { generateBriefing } from "../lib/briefing.js";
import { maybeRunMissedBriefing as maybeRunMissedBriefingService } from "./briefing-service.js";
import { buildRuntimePrompt } from "./runtime-prompt.js";

const DEPLOY = config.management.deployAmountSol;

function formatCandidates(candidates) {
  if (!candidates.length) return "  No eligible pools found right now.";

  const lines = candidates.map((p, i) => {
    const name = (p.name || "unknown").padEnd(20);
    const feeTvl = `${p.fee_active_tvl_ratio ?? p.fee_tvl_ratio}%`.padStart(8);
    const volume = `$${((p.volume_24h || 0) / 1000).toFixed(1)}k`.padStart(8);
    const active = `${p.active_pct}%`.padStart(6);
    const organic = String(p.organic_score).padStart(4);
    return `  [${i + 1}]  ${name}  fee/aTVL:${feeTvl}  vol:${volume}  in-range:${active}  organic:${organic}`;
  });

  return [
    "  #   pool                  fee/aTVL     vol    in-range  organic",
    `  ${"-".repeat(68)}`,
    ...lines,
  ].join("\n");
}

export async function startShellRuntime({ shutdown, runtimeState, workerRuntime }) {
  let startupCandidates = [];
  const runScoped = (fn) => workerRuntime.runInScope ? workerRuntime.runInScope(fn) : fn();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildRuntimePrompt(config.schedule),
  });

  function refreshPrompt() {
    rl.setPrompt(buildRuntimePrompt(config.schedule));
    rl.prompt(true);
  }

  async function launchCron() {
    if (!workerRuntime.isCronStarted()) {
      await workerRuntime.ensureCronStarted();
      console.log("Autonomous cycles are now running.\n");
      refreshPrompt();
    }
  }

  async function runBusy(fn) {
    if (runtimeState.busy) {
      console.log("Agent is busy, please wait...");
      rl.prompt();
      return;
    }

    runtimeState.busy = true;
    rl.pause();
    try {
      await runScoped(fn);
    } catch (e) {
      console.error(`Error: ${e.message}`);
    } finally {
      runtimeState.busy = false;
      rl.resume();
      refreshPrompt();
    }
  }

  setInterval(() => {
    if (!runtimeState.busy) refreshPrompt();
  }, 10_000);

  console.log(`
+-------------------------------------------+
|         DLMM LP Agent - Ready             |
+-------------------------------------------+
`);
  console.log("Fetching wallet and top pool candidates...\n");

  runtimeState.busy = true;
  try {
    const [wallet, positions, { candidates, total_eligible, total_screened }] = await runScoped(() => Promise.all([
      getWalletBalances(),
      getMyPositions(),
      getTopCandidates({ limit: 5 }),
    ]));

    startupCandidates = candidates;

    console.log(`Wallet:    ${wallet.sol} SOL  ($${wallet.sol_usd})  |  SOL price: $${wallet.sol_price}`);
    console.log(`Positions: ${positions.total_positions} open\n`);

    if (positions.total_positions > 0) {
      console.log("Open positions:");
      for (const p of positions.positions) {
        const status = p.in_range ? "in-range OK" : "OUT OF RANGE";
        console.log(`  ${p.pair.padEnd(16)} ${status}  fees: $${p.unclaimed_fees_usd}`);
      }
      console.log();
    }

    console.log(`Top pools (${total_eligible} eligible from ${total_screened} screened):\n`);
    console.log(formatCandidates(candidates));
  } catch (e) {
    console.error(`Startup fetch failed: ${e.message}`);
  } finally {
    runtimeState.busy = false;
  }

  await launchCron();
  runScoped(() => maybeRunMissedBriefingService()).catch(() => {});

  console.log(`
Commands:
  1 / 2 / 3 ...  Deploy ${DEPLOY} SOL into that pool
  auto           Let the agent pick and deploy automatically
  /status        Refresh wallet + positions
  /candidates    Refresh top pool list
  /briefing      Show morning briefing (last 24h)
  /learn         Study top LPers from the best current pool and save lessons
  /learn <addr>  Study top LPers from a specific pool address
  /thresholds    Show current screening thresholds + performance stats
  /evolve        Manually trigger threshold evolution from performance data
  /stop          Shut down
`);

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    const pick = parseInt(input, 10);
    if (!Number.isNaN(pick) && pick >= 1 && pick <= startupCandidates.length) {
      await runBusy(async () => {
        const pool = startupCandidates[pick - 1];
        console.log(`\nDeploying ${DEPLOY} SOL into ${pool.name}...\n`);
        const { content: reply } = await agentLoop(
          `Deploy ${DEPLOY} SOL into pool ${pool.pool} (${pool.name}). Call get_active_bin first then deploy_position. Report result.`,
          config.llm.maxSteps,
          [],
          "SCREENER"
        );
        console.log(`\n${reply}\n`);
        await launchCron();
      });
      return;
    }

    if (input.toLowerCase() === "auto") {
      await runBusy(async () => {
        console.log("\nAgent is picking and deploying...\n");
        const { content: reply } = await agentLoop(
          `get_top_candidates, pick the best one, get_active_bin, deploy_position with ${DEPLOY} SOL. Execute now, don't ask.`,
          config.llm.maxSteps,
          [],
          "SCREENER"
        );
        console.log(`\n${reply}\n`);
        await launchCron();
      });
      return;
    }

    if (input.toLowerCase() === "go") {
      await launchCron();
      rl.prompt();
      return;
    }

    if (input === "/stop") {
      await shutdown("user command");
      return;
    }

    if (input === "/status") {
      await runBusy(async () => {
        const [wallet, positions] = await Promise.all([getWalletBalances(), getMyPositions()]);
        console.log(`\nWallet: ${wallet.sol} SOL  ($${wallet.sol_usd})`);
        console.log(`Positions: ${positions.total_positions}`);
        for (const p of positions.positions) {
          const status = p.in_range ? "in-range OK" : "OUT OF RANGE";
          console.log(`  ${p.pair.padEnd(16)} ${status}  fees: $${p.unclaimed_fees_usd}`);
        }
        console.log();
      });
      return;
    }

    if (input === "/briefing") {
      await runBusy(async () => {
        const briefing = await generateBriefing({
          state: workerRuntime.stateStore?.load?.(),
          lessonsData: workerRuntime.lessonsStore?.load?.(),
          perfSummary: workerRuntime.lessonsStore?.getPerformanceSummary?.(),
        });
        console.log(`\n${briefing.replace(/<[^>]*>/g, "")}\n`);
      });
      return;
    }

    if (input === "/candidates") {
      await runBusy(async () => {
        const { candidates, total_eligible, total_screened } = await getTopCandidates({ limit: 5 });
        startupCandidates = candidates;
        console.log(`\nTop pools (${total_eligible} eligible from ${total_screened} screened):\n`);
        console.log(formatCandidates(candidates));
        console.log();
      });
      return;
    }

    if (input === "/thresholds") {
      const screening = config.screening;
      console.log("\nCurrent screening thresholds:");
      console.log(`  minFeeActiveTvlRatio: ${screening.minFeeActiveTvlRatio}`);
      console.log(`  minOrganic:           ${screening.minOrganic}`);
      console.log(`  minHolders:           ${screening.minHolders}`);
      console.log(`  minTvl:               ${screening.minTvl}`);
      console.log(`  maxTvl:               ${screening.maxTvl}`);
      console.log(`  minVolume:            ${screening.minVolume}`);
      console.log(`  minTokenFeesSol:      ${screening.minTokenFeesSol}`);
      console.log(`  maxBundlersPct:       ${screening.maxBundlersPct}`);
      console.log(`  maxTop10Pct:          ${screening.maxTop10Pct}`);
      console.log(`  timeframe:            ${screening.timeframe}`);
      const perf = workerRuntime.lessonsStore?.getPerformanceSummary?.() || getPerformanceSummary();
      if (perf) {
        console.log(`\n  Based on ${perf.total_positions_closed} closed positions`);
        console.log(`  Win rate: ${perf.win_rate_pct}%  |  Avg PnL: ${perf.avg_pnl_pct}%`);
      } else {
        console.log("\n  No closed positions yet - thresholds are preset defaults.");
      }
      console.log();
      rl.prompt();
      return;
    }

    if (input.startsWith("/learn")) {
      await runBusy(async () => {
        const parts = input.split(" ");
        const poolArg = parts[1] || null;

        let poolsToStudy = [];
        if (poolArg) {
          poolsToStudy = [{ pool: poolArg, name: poolArg }];
        } else {
          console.log("\nFetching top pool candidates to study...\n");
          const { candidates } = await getTopCandidates({ limit: 10 });
          if (!candidates.length) {
            console.log("No eligible pools found to study.\n");
            return;
          }
          poolsToStudy = candidates.map((c) => ({ pool: c.pool, name: c.name }));
        }

        console.log(`\nStudying top LPers across ${poolsToStudy.length} pools...\n`);
        for (const p of poolsToStudy) console.log(`  * ${p.name || p.pool}`);
        console.log();

        const poolList = poolsToStudy
          .map((p, i) => `${i + 1}. ${p.name} (${p.pool})`)
          .join("\n");

        const { content: reply } = await agentLoop(
          `Study top LPers across these ${poolsToStudy.length} pools by calling study_top_lpers for each:

${poolList}

For each pool, call study_top_lpers then move to the next. After studying all pools:
1. Identify patterns that appear across multiple pools (hold time, scalping vs holding, win rates).
2. Note pool-specific patterns where behaviour differs significantly.
3. Derive 4-8 concrete, actionable lessons using add_lesson. Prioritize cross-pool patterns - they're more reliable.
4. Summarize what you learned.

Focus on: hold duration, entry/exit timing, what win rates look like, whether scalpers or holders dominate.`,
          config.llm.maxSteps,
          [],
          "GENERAL"
        );
        console.log(`\n${reply}\n`);
      });
      return;
    }

    if (input === "/evolve") {
      await runBusy(async () => {
        const perf = workerRuntime.lessonsStore?.getPerformanceSummary?.() || getPerformanceSummary();
        if (!perf || perf.total_positions_closed < 5) {
          const needed = 5 - (perf?.total_positions_closed || 0);
          console.log(`\nNeed at least 5 closed positions to evolve. ${needed} more needed.\n`);
          return;
        }

        const lessonsData = workerRuntime.lessonsStore?.load?.();
        const result = evolveThresholds(lessonsData?.performance || [], config, {
          lessonsStore: workerRuntime.lessonsStore,
        });
        if (!result || Object.keys(result.changes).length === 0) {
          console.log("\nNo threshold changes needed - current settings already match performance data.\n");
        } else {
          reloadScreeningThresholds();
          console.log("\nThresholds evolved:");
          for (const [key] of Object.entries(result.changes)) {
            console.log(`  ${key}: ${result.rationale[key]}`);
          }
          console.log("\nSaved to user-config.json. Applied immediately.\n");
        }
      });
      return;
    }

    await runBusy(async () => {
      log("user", input);
      const { content } = await agentLoop(input, config.llm.maxSteps, runtimeState.sessionHistory, "GENERAL", config.llm.generalModel);
      runtimeState.appendHistory(input, content);
      console.log(`\n${content}\n`);
    });
  });

  rl.on("close", () => {
    shutdown("stdin closed").catch(() => {});
  });

  return { refreshPrompt };
}
