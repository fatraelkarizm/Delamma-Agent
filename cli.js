#!/usr/bin/env node
/**
 * meridian  Solana DLMM LP Agent CLI
 * Direct tool invocation with JSON output. Agent-native.
 */

import "dotenv/config";
import { parseArgs } from "util";
import os from "os";
import fs from "fs";
import path from "path";

//  DRY_RUN must be set before any tool imports 
if (process.argv.includes("--dry-run")) process.env.DRY_RUN = "true";

//  Load .env from ~/.meridian/ if present 
const meridianDir = path.join(os.homedir(), ".meridian");
const meridianEnv = path.join(meridianDir, ".env");
if (fs.existsSync(meridianEnv)) {
  const { config: loadDotenv } = await import("dotenv");
  loadDotenv({ path: meridianEnv, override: false });
}

//  Output helpers 
function out(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function die(msg, extra = {}) {
  process.stderr.write(JSON.stringify({ error: msg, ...extra }) + "\n");
  process.exit(1);
}

//  SKILL.md generation 
const SKILL_MD = `# meridian  Solana DLMM LP Agent CLI

Data dir: ~/.meridian/

## Commands

### meridian balance
Returns wallet SOL and token balances.
\`\`\`
Output: { wallet, sol, sol_usd, usdc, tokens: [{mint, symbol, balance, usd_value}], total_usd }
\`\`\`

### meridian positions
Returns all open DLMM positions.
\`\`\`
Output: { positions: [{position, pool, pair, in_range, age_minutes, ...}], total_positions }
\`\`\`

### meridian pnl <position_address>
Returns PnL for a specific position.
\`\`\`
Output: { pnl_pct, pnl_usd, unclaimed_fee_usd, all_time_fees_usd, current_value_usd, lower_bin, upper_bin, active_bin }
\`\`\`

### meridian screen [--dry-run] [--silent]
Runs one AI screening cycle to find and deploy new positions.
\`\`\`
Output: { done: true, report: "..." }
\`\`\`

### meridian manage [--dry-run] [--silent]
Runs one AI management cycle over open positions.
\`\`\`
Output: { done: true, report: "..." }
\`\`\`

### meridian deploy --pool <addr> --amount <sol> [--bins-below 69] [--bins-above 0] [--strategy bid_ask|spot] [--dry-run]
Deploys a new LP position. All safety checks apply.
\`\`\`
Output: { success, position, pool_name, txs, price_range, bin_step }
\`\`\`

### meridian claim --position <addr>
Claims accumulated swap fees for a position.
\`\`\`
Output: { success, position, txs, base_mint }
\`\`\`

### meridian close --position <addr> [--skip-swap] [--dry-run]
Closes a position. Auto-swaps base token to SOL unless --skip-swap.
\`\`\`
Output: { success, pnl_pct, pnl_usd, txs, base_mint }
\`\`\`

### meridian swap --from <mint> --to <mint> --amount <n> [--dry-run]
Swaps tokens via Jupiter. Use "SOL" as mint shorthand.
\`\`\`
Output: { success, tx, input_amount, output_amount }
\`\`\`

### meridian candidates [--limit 5]
Returns top pool candidates fully enriched: pool metrics, token audit, holders, smart wallets, narrative, active bin, pool memory.
\`\`\`
Output: { candidates: [{name, pool, bin_step, fee_pct, volume, tvl, organic_score, active_bin, smart_wallets, token: {holders, audit, global_fees_sol, ...}, holders, narrative, pool_memory}] }
\`\`\`

### meridian config get
Returns the full runtime config.

### meridian config set <key> <value>
Updates a config key. Parses value as JSON when possible.
\`\`\`
Valid keys: minTvl, maxTvl, minVolume, maxPositions, deployAmountSol, managementIntervalMin, screeningIntervalMin, managementModel, screeningModel, generalModel, autoSwapAfterClaim, minClaimAmount, outOfRangeWaitMinutes
\`\`\`

### meridian start [--dry-run]
Starts the autonomous agent with cron jobs (management + screening).

### meridian scopes
Returns discovered runtime scopes from DB snapshots.

### meridian bootstrap snapshots [--tenant-id <id>] [--wallet-id <id>]
Backfills wallet-scoped JSON stores into PostgreSQL wallet_storage_snapshots.

### meridian rehydrate snapshots [--tenant-id <id>] [--wallet-id <id>] [--store <key>] [--overwrite]
Restores wallet-scoped JSON stores from PostgreSQL snapshots back into local data files.

### meridian control request --tenant-id <id> --wallet-id <id> --command <cmd>
Queues a control-plane command for a worker scope.
Supported examples: launch_worker, restart_worker, start_cron, restart_cron, stop_cron, shutdown_worker, run_management_cycle, run_screening_cycle, run_briefing

### meridian control list [--tenant-id <id>] [--wallet-id <id>] [--limit 20]
Lists recent control-plane requests.

### meridian supervisor once
Processes pending launch_worker and restart_worker requests once.

### meridian supervisor run
Runs a lightweight supervisor loop that spawns workers for pending launch_worker and restart_worker requests.

### meridian telegram run
Runs the Telegram control-plane gateway.

### meridian telegram bindings [--chat-id <id>]
Lists Telegram chat bindings.

### meridian telegram bind --chat-id <id> --tenant-id <id> --wallet-id <id>
Binds a Telegram chat to a wallet scope for notifications and control.

### meridian telegram unbind --chat-id <id> [--tenant-id <id>] [--wallet-id <id>]
Removes Telegram chat bindings.

### meridian telegram session --chat-id <id> --tenant-id <id> --wallet-id <id>
Sets the active Telegram session scope for a chat.

## Flags
--dry-run     Skip all on-chain transactions
--silent      Suppress Telegram notifications for this run
`;

try {
  fs.mkdirSync(meridianDir, { recursive: true });
  fs.writeFileSync(path.join(meridianDir, "SKILL.md"), SKILL_MD);
} catch {
  // Non-fatal in restricted environments where home directory writes are blocked.
}

//  Parse args 
const argv = process.argv.slice(2);
const subcommand = argv.find(a => !a.startsWith("-"));
const sub2 = argv.filter(a => !a.startsWith("-"))[1]; // for "config get/set"
const silent = argv.includes("--silent");

if (!subcommand || subcommand === "help" || argv.includes("--help")) {
  process.stdout.write(SKILL_MD);
  process.exit(0);
}

//  Parse flags 
const { values: flags } = parseArgs({
  args: argv,
  options: {
    pool:       { type: "string" },
    amount:     { type: "string" },
    position:   { type: "string" },
    from:       { type: "string" },
    to:         { type: "string" },
    strategy:   { type: "string" },
    "bins-below": { type: "string" },
    "bins-above": { type: "string" },
    "skip-swap":  { type: "boolean" },
    "dry-run":    { type: "boolean" },
    "silent":     { type: "boolean" },
    limit:        { type: "string" },
    "tenant-id":  { type: "string" },
    "wallet-id":  { type: "string" },
    "no-local":   { type: "boolean" },
    overwrite:    { type: "boolean" },
    store:        { type: "string" },
    command:      { type: "string" },
    "chat-id":    { type: "string" },
  },
  allowPositionals: true,
  strict: false,
});

//  Commands 

let keepProcessAlive = false;

switch (subcommand) {

  //  balance 
  case "balance": {
    const { getWalletBalances } = await import("./tools/wallet.js");
    out(await getWalletBalances({}));
    break;
  }

  //  positions 
  case "positions": {
    const { getMyPositions } = await import("./tools/dlmm.js");
    out(await getMyPositions({ force: true }));
    break;
  }

  //  pnl <position_address> 
  case "pnl": {
    const posAddr = argv.find((a, i) => !a.startsWith("-") && i > 0 && argv[i - 1] !== "--position" && a !== "pnl");
    const positionAddress = flags.position || posAddr;
    if (!positionAddress) die("Usage: meridian pnl <position_address>");

    const { getTrackedPosition } = await import("./storage/state.js");
    const { getPositionPnl, getMyPositions } = await import("./tools/dlmm.js");

    let poolAddress;
    const tracked = getTrackedPosition(positionAddress);
    if (tracked?.pool) {
      poolAddress = tracked.pool;
    } else {
      // Fall back: scan positions to find pool
      const pos = await getMyPositions({ force: true });
      const found = pos.positions?.find(p => p.position === positionAddress);
      if (!found) die("Position not found", { position: positionAddress });
      poolAddress = found.pool;
    }

    out(await getPositionPnl({ pool_address: poolAddress, position_address: positionAddress }));
    break;
  }

  //  candidates 
  case "candidates": {
    const { getTopCandidates } = await import("./tools/screening.js");
    const { getActiveBin } = await import("./tools/dlmm.js");
    const { getTokenInfo, getTokenHolders, getTokenNarrative } = await import("./tools/token.js");
    const { checkSmartWalletsOnPool } = await import("./storage/smart-wallets.js");
    const { recallForPool } = await import("./storage/pool-memory.js");

    const limit = parseInt(flags.limit || "5");
    const raw = await getTopCandidates({ limit });
    const pools = raw.candidates || raw.pools || [];

    const enriched = [];
    for (const pool of pools) {
      const mint = pool.base?.mint;
      const [activeBin, smartWallets, tokenInfo, holders, narrative] = await Promise.allSettled([
        getActiveBin({ pool_address: pool.pool }),
        checkSmartWalletsOnPool({ pool_address: pool.pool }),
        mint ? getTokenInfo({ query: mint }) : Promise.resolve(null),
        mint ? getTokenHolders({ mint }) : Promise.resolve(null),
        mint ? getTokenNarrative({ mint }) : Promise.resolve(null),
      ]);
      const ti = tokenInfo.status === "fulfilled" ? tokenInfo.value?.results?.[0] : null;
      enriched.push({
        pool: pool.pool,
        name: pool.name,
        bin_step: pool.bin_step,
        fee_pct: pool.fee_pct,
        fee_active_tvl_ratio: pool.fee_active_tvl_ratio,
        volume: pool.volume_window,
        tvl: pool.active_tvl,
        volatility: pool.volatility,
        mcap: pool.mcap,
        organic_score: pool.organic_score,
        active_pct: pool.active_pct,
        price_change_pct: pool.price_change_pct,
        active_bin: activeBin.status === "fulfilled" ? activeBin.value?.binId : null,
        smart_wallets: smartWallets.status === "fulfilled" ? (smartWallets.value?.in_pool || []).map(w => w.name) : [],
        token: {
          mint,
          symbol: pool.base?.symbol,
          holders: pool.holders,
          mcap: ti?.mcap,
          launchpad: ti?.launchpad,
          global_fees_sol: ti?.global_fees_sol,
          price_change_1h: ti?.stats_1h?.price_change,
          net_buyers_1h: ti?.stats_1h?.net_buyers,
          audit: {
            top10_pct: ti?.audit?.top_holders_pct,
            bots_pct: ti?.audit?.bot_holders_pct,
          },
        },
        holders: holders.status === "fulfilled" ? holders.value : null,
        narrative: narrative.status === "fulfilled" ? narrative.value?.narrative : null,
        pool_memory: recallForPool(pool.pool) || null,
      });
      await new Promise(r => setTimeout(r, 150)); // avoid 429s
    }

    out({ candidates: enriched, total_screened: raw.total_screened });
    break;
  }

  //  deploy 
  case "deploy": {
    if (!flags.pool) die("Usage: meridian deploy --pool <addr> --amount <sol>");
    if (!flags.amount) die("--amount is required");

    const { executeTool } = await import("./tools/executor.js");
    out(await executeTool("deploy_position", {
      pool_address: flags.pool,
      amount_y: parseFloat(flags.amount),
      strategy: flags.strategy,
      bins_below: flags["bins-below"] ? parseInt(flags["bins-below"]) : undefined,
      bins_above: flags["bins-above"] ? parseInt(flags["bins-above"]) : undefined,
    }));
    break;
  }

  //  claim 
  case "claim": {
    if (!flags.position) die("Usage: meridian claim --position <addr>");
    const { executeTool } = await import("./tools/executor.js");
    out(await executeTool("claim_fees", { position_address: flags.position }));
    break;
  }

  //  close 
  case "close": {
    if (!flags.position) die("Usage: meridian close --position <addr>");
    const { executeTool } = await import("./tools/executor.js");
    out(await executeTool("close_position", {
      position_address: flags.position,
      skip_swap: flags["skip-swap"] ?? false,
    }));
    break;
  }

  //  swap 
  case "swap": {
    if (!flags.from || !flags.to || !flags.amount) die("Usage: meridian swap --from <mint> --to <mint> --amount <n>");
    const { executeTool } = await import("./tools/executor.js");
    out(await executeTool("swap_token", {
      input_mint: flags.from,
      output_mint: flags.to,
      amount: parseFloat(flags.amount),
    }));
    break;
  }

  //  screen 
  case "screen": {
    const { getDefaultWorkerRuntime } = await import("./core/worker-runtime.js");
    const worker = getDefaultWorkerRuntime();
    const report = await worker.runScreeningCycle({ silent });
    out({ done: true, report: report || "No action taken" });
    break;
  }

  //  manage 
  case "manage": {
    const { getDefaultWorkerRuntime } = await import("./core/worker-runtime.js");
    const worker = getDefaultWorkerRuntime();
    const report = await worker.runManagementCycle({ silent });
    out({ done: true, report: report || "No action taken" });
    break;
  }

  //  config 
  case "config": {
    if (sub2 === "get" || !sub2) {
      const { config } = await import("./config.js");
      out(config);
    } else if (sub2 === "set") {
      const key = argv.filter(a => !a.startsWith("-"))[2];
      const rawVal = argv.filter(a => !a.startsWith("-"))[3];
      if (!key || rawVal === undefined) die("Usage: meridian config set <key> <value>");
      let value = rawVal;
      try { value = JSON.parse(rawVal); } catch { /* keep as string */ }
      const { executeTool } = await import("./tools/executor.js");
      out(await executeTool("update_config", { changes: { [key]: value }, reason: "CLI config set" }));
    } else {
      die(`Unknown config subcommand: ${sub2}. Use: get, set`);
    }
    break;
  }

  //  start 
  case "start": {
    const { getDefaultWorkerRuntime } = await import("./core/worker-runtime.js");
    const worker = getDefaultWorkerRuntime();
    keepProcessAlive = true;
    process.stderr.write("[meridian] Starting autonomous agent...\n");
    await worker.ensureCronStarted();
    break;
  }

  // —— scopes —————————————————————————————————————————————————————————————
  case "scopes": {
    const { getDefaultWorkerRegistry } = await import("./core/worker-registry.js");
    const { createWorkerContext, describeWorkerContext } = await import("./core/tenant-context.js");
    const { inspectRuntimeScopes } = await import("./core/storage-bootstrap.js");
    const context = createWorkerContext({
      tenantId: flags["tenant-id"] || "local",
      walletId: flags["wallet-id"] || process.env.WALLET_ADDRESS || "primary",
      workerId: "cli-inspect",
      mode: "cli",
      channel: "scopes",
    });
    const registry = getDefaultWorkerRegistry();
    out({
      worker: describeWorkerContext(context),
      runtime: await registry.snapshot(),
      storage: await inspectRuntimeScopes(),
    });
    break;
  }

  // —— bootstrap snapshots ————————————————————————————————————————————
  case "bootstrap": {
    if (sub2 !== "snapshots") {
      die(`Unknown bootstrap subcommand: ${sub2 || "(missing)"}. Use: meridian bootstrap snapshots`);
    }

    const { bootstrapWalletStorageSnapshots, getExpectedWalletDataDir } = await import("./core/storage-bootstrap.js");
    const tenantId = flags["tenant-id"] || null;
    const walletId = flags["wallet-id"] || null;
    const includeLocal = !flags["no-local"];

    out({
      expected_wallet_dir: getExpectedWalletDataDir({ tenantId: tenantId || "local", walletId: walletId || (process.env.WALLET_ADDRESS || "primary") }),
      result: await bootstrapWalletStorageSnapshots({
        tenantId,
        walletId,
        includeLocal,
      }),
    });
    break;
  }

  // —— rehydrate snapshots ————————————————————————————————————————————
  case "rehydrate": {
    if (sub2 !== "snapshots") {
      die(`Unknown rehydrate subcommand: ${sub2 || "(missing)"}. Use: meridian rehydrate snapshots`);
    }

    const { rehydrateWalletStorageSnapshots, getExpectedWalletDataDir } = await import("./core/storage-bootstrap.js");
    const tenantId = flags["tenant-id"] || null;
    const walletId = flags["wallet-id"] || null;
    const storeKey = flags.store || null;

    out({
      expected_wallet_dir: getExpectedWalletDataDir({
        tenantId: tenantId || "local",
        walletId: walletId || (process.env.WALLET_ADDRESS || "primary"),
      }),
      result: await rehydrateWalletStorageSnapshots({
        tenantId,
        walletId,
        overwrite: Boolean(flags.overwrite),
        storeKey,
      }),
    });
    break;
  }

  // —— control request/list ———————————————————————————————————————————
  case "control": {
    const { createWorkerControlRequest, listWorkerControlRequests } = await import("./lib/db.js");
    const tenantId = flags["tenant-id"] || null;
    const walletId = flags["wallet-id"] || null;

    if (sub2 === "request") {
      if (!tenantId || !walletId || !flags.command) {
        die("Usage: meridian control request --tenant-id <id> --wallet-id <id> --command <cmd>");
      }

      out({
        queued: await createWorkerControlRequest({
          tenant_id: tenantId,
          wallet_id: walletId,
          requested_by: "cli",
          command: flags.command,
          payload: {},
        }),
      });
      break;
    }

    if (sub2 === "list" || !sub2) {
      out({
        requests: await listWorkerControlRequests({
          tenant_id: tenantId,
          wallet_id: walletId,
          limit: parseInt(flags.limit || "20"),
        }),
      });
      break;
    }

    die(`Unknown control subcommand: ${sub2}. Use: request, list`);
    break;
  }

  // —— supervisor once/run ————————————————————————————————————————————
  case "supervisor": {
    const { processSupervisorRequests, startWorkerSupervisor } = await import("./core/worker-supervisor.js");

    if (sub2 === "once" || !sub2) {
      out(await processSupervisorRequests());
      break;
    }

    if (sub2 === "run") {
      keepProcessAlive = true;
      process.stderr.write("[meridian] Supervisor loop running...\n");
      startWorkerSupervisor();
      await new Promise(() => {});
    }

    die(`Unknown supervisor subcommand: ${sub2}. Use: once, run`);
    break;
  }

  case "telegram": {
    const chatId = flags["chat-id"] || null;

    if (sub2 === "run" || !sub2) {
      const { isEnabled: telegramEnabled } = await import("./core/telegram.js");
      if (!telegramEnabled()) {
        die("TELEGRAM_BOT_TOKEN is not configured");
      }

      const { startTelegramRuntime } = await import("./core/telegram-runtime.js");
      const { createWorkerContext, formatWorkerLabel } = await import("./core/tenant-context.js");
      const workerContext = createWorkerContext({
        tenantId: flags["tenant-id"] || process.env.TENANT_ID || "local",
        walletId: flags["wallet-id"] || process.env.WALLET_ID || process.env.WALLET_ADDRESS || "primary",
        workerId: process.env.WORKER_ID || "telegram-gateway",
        mode: "telegram",
        channel: "telegram-gateway",
      });
      const workerRuntime = {
        context: workerContext,
        label: formatWorkerLabel(workerContext),
        supportsLocalExecution: false,
        isExecutionBusy() {
          return false;
        },
        runInScope(fn) {
          return fn();
        },
      };
      const runtimeState = {
        busy: false,
        sessionHistory: [],
        appendHistory() {},
      };

      keepProcessAlive = true;
      process.stderr.write(`[meridian] Telegram gateway running for ${workerRuntime.label}...\n`);
      startTelegramRuntime({ runtimeState, workerRuntime });
      await new Promise(() => {});
    }

    if (sub2 === "bindings") {
      const { listTelegramBindings } = await import("./lib/telegram-state.js");
      out({
        bindings: listTelegramBindings({ chatId }),
      });
      break;
    }

    if (sub2 === "bind") {
      if (!chatId || !flags["tenant-id"] || !flags["wallet-id"]) {
        die("Usage: meridian telegram bind --chat-id <id> --tenant-id <id> --wallet-id <id>");
      }

      const { bindTelegramChat, upsertTelegramSession } = await import("./lib/telegram-state.js");
      const binding = bindTelegramChat({
        chatId,
        tenantId: flags["tenant-id"],
        walletId: flags["wallet-id"],
        notificationsEnabled: true,
        metadata: { source: "cli" },
      });
      const session = upsertTelegramSession({
        chatId,
        tenantId: flags["tenant-id"],
        walletId: flags["wallet-id"],
        metadata: { updated_by: "cli" },
      });

      out({ binding, session });
      break;
    }

    if (sub2 === "unbind") {
      if (!chatId) {
        die("Usage: meridian telegram unbind --chat-id <id> [--tenant-id <id>] [--wallet-id <id>]");
      }

      const { unbindTelegramChat } = await import("./lib/telegram-state.js");
      out(unbindTelegramChat({
        chatId,
        tenantId: flags["tenant-id"] || null,
        walletId: flags["wallet-id"] || null,
      }));
      break;
    }

    if (sub2 === "session") {
      if (!chatId || !flags["tenant-id"] || !flags["wallet-id"]) {
        die("Usage: meridian telegram session --chat-id <id> --tenant-id <id> --wallet-id <id>");
      }

      const { upsertTelegramSession } = await import("./lib/telegram-state.js");
      out({
        session: upsertTelegramSession({
          chatId,
          tenantId: flags["tenant-id"],
          walletId: flags["wallet-id"],
          metadata: { updated_by: "cli" },
        }),
      });
      break;
    }

    die("Unknown telegram subcommand. Use: run, bindings, bind, unbind, session");
    break;
  }

  default:
    die(`Unknown command: ${subcommand}. Run 'meridian help' for usage.`);
}

<<<<<<< HEAD
=======
if (!keepProcessAlive) {
  try {
    const { closeDbPool } = await import("./lib/db.js");
    await closeDbPool();
  } catch {
    // Best-effort shutdown for one-shot CLI commands.
  }
}
>>>>>>> b07f384154085a851f82648b474583c02562a015
