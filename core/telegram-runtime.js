import { agentLoop } from "./agent.js";
import { log } from "../lib/logger.js";
import { getMyPositions, closePosition } from "../tools/dlmm.js";
import { startPolling, sendMessage, sendHTML } from "./telegram.js";
import { generateBriefing } from "../lib/briefing.js";
import { setPositionInstruction } from "../lib/state.js";
import { config } from "./config.js";

export function startTelegramRuntime({ runtimeState, refreshPrompt = () => {}, workerRuntime } = {}) {
  const runScoped = (fn) => workerRuntime.runInScope ? workerRuntime.runInScope(fn) : fn();

  startPolling(async (text) => {
    if (workerRuntime.isExecutionBusy() || runtimeState.busy) {
      sendMessage("Agent is busy right now - try again in a moment.").catch(() => {});
      return;
    }

    if (text === "/briefing") {
      try {
        const briefing = await runScoped(() => generateBriefing());
        await sendHTML(briefing);
      } catch (e) {
        await sendMessage(`Error: ${e.message}`).catch(() => {});
      }
      return;
    }

    if (text === "/positions") {
      try {
        const { positions, total_positions } = await runScoped(() => getMyPositions({ force: true }));
        if (total_positions === 0) {
          await sendMessage("No open positions.");
          return;
        }

        const lines = positions.map((p, i) => {
          const pnl = p.pnl_usd >= 0 ? `+$${p.pnl_usd}` : `-$${Math.abs(p.pnl_usd)}`;
          const age = p.age_minutes != null ? `${p.age_minutes}m` : "?";
          const oor = !p.in_range ? " OOR" : "";
          return `${i + 1}. ${p.pair} | $${p.total_value_usd} | PnL: ${pnl} | fees: $${p.unclaimed_fees_usd} | ${age}${oor}`;
        });

        await sendMessage(`Open Positions (${total_positions}):\n\n${lines.join("\n")}\n\n/close <n> to close | /set <n> <note> to set instruction`);
      } catch (e) {
        await sendMessage(`Error: ${e.message}`).catch(() => {});
      }
      return;
    }

    const closeMatch = text.match(/^\/close\s+(\d+)$/i);
    if (closeMatch) {
      try {
        const idx = parseInt(closeMatch[1], 10) - 1;
        const { positions } = await runScoped(() => getMyPositions({ force: true }));
        if (idx < 0 || idx >= positions.length) {
          await sendMessage("Invalid number. Use /positions first.");
          return;
        }

        const pos = positions[idx];
        await sendMessage(`Closing ${pos.pair}...`);
        const result = await runScoped(() => closePosition({ position_address: pos.position }));
        if (result.success) {
          await sendMessage(`Closed ${pos.pair}\nPnL: $${result.pnl_usd ?? "?"} | txs: ${result.txs?.join(", ")}`);
        } else {
          await sendMessage(`Close failed: ${JSON.stringify(result)}`);
        }
      } catch (e) {
        await sendMessage(`Error: ${e.message}`).catch(() => {});
      }
      return;
    }

    const setMatch = text.match(/^\/set\s+(\d+)\s+(.+)$/i);
    if (setMatch) {
      try {
        const idx = parseInt(setMatch[1], 10) - 1;
        const note = setMatch[2].trim();
        const { positions } = await runScoped(() => getMyPositions({ force: true }));
        if (idx < 0 || idx >= positions.length) {
          await sendMessage("Invalid number. Use /positions first.");
          return;
        }

        const pos = positions[idx];
        await runScoped(() => Promise.resolve(setPositionInstruction(pos.position, note)));
        await sendMessage(`Note set for ${pos.pair}:\n"${note}"`);
      } catch (e) {
        await sendMessage(`Error: ${e.message}`).catch(() => {});
      }
      return;
    }

    runtimeState.busy = true;
    try {
      log("telegram", `Incoming: ${text}`);
      const hasCloseIntent = /\bclose\b|\bsell\b|\bexit\b|\bwithdraw\b/i.test(text);
      const isDeployRequest = !hasCloseIntent && /\bdeploy\b|\bopen position\b|\blp into\b|\badd liquidity\b/i.test(text);
      const agentRole = isDeployRequest ? "SCREENER" : "GENERAL";
      const { content } = await runScoped(() => agentLoop(text, config.llm.maxSteps, runtimeState.sessionHistory, agentRole, config.llm.generalModel));
      runtimeState.appendHistory(text, content);
      await sendMessage(content);
    } catch (e) {
      await sendMessage(`Error: ${e.message}`).catch(() => {});
    } finally {
      runtimeState.busy = false;
      refreshPrompt();
    }
  });
}
