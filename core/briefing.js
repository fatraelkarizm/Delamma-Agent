import fs from "fs";
import { log } from "../integrations/logger.js";
import { getPerformanceSummary } from "../storage/lessons.js";
import { getDataFilePath } from "../storage/storage-paths.js";

const STATE_FILE = getDataFilePath("state.json");
const LESSONS_FILE = getDataFilePath("lessons.json");

export async function generateBriefing() {
  const state = loadJson(STATE_FILE) || { positions: {}, recentEvents: [] };
  const lessonsData = loadJson(LESSONS_FILE) || { lessons: [], performance: [] };

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const allPositions = Object.values(state.positions || {});
  const openedLast24h = allPositions.filter((p) => new Date(p.deployed_at) > last24h);
  const closedLast24h = allPositions.filter((p) => p.closed && new Date(p.closed_at) > last24h);

  const perfLast24h = (lessonsData.performance || []).filter((p) => new Date(p.recorded_at) > last24h);
  const totalPnLUsd = perfLast24h.reduce((sum, p) => sum + (p.pnl_usd || 0), 0);
  const totalFeesUsd = perfLast24h.reduce((sum, p) => sum + (p.fees_earned_usd || 0), 0);

  const lessonsLast24h = (lessonsData.lessons || []).filter((l) => new Date(l.created_at) > last24h);

  const openPositions = allPositions.filter((p) => !p.closed);
  const perfSummary = getPerformanceSummary();

  const lines = [
    " <b>Morning Briefing</b> (Last 24h)",
    "",
    "<b>Activity:</b>",
    ` Positions Opened: ${openedLast24h.length}`,
    ` Positions Closed: ${closedLast24h.length}`,
    "",
    "<b>Performance:</b>",
    ` Net PnL: ${totalPnLUsd >= 0 ? "+" : ""}$${totalPnLUsd.toFixed(2)}`,
    ` Fees Earned: $${totalFeesUsd.toFixed(2)}`,
    perfLast24h.length > 0
      ? ` Win Rate (24h): ${Math.round((perfLast24h.filter((p) => p.pnl_usd > 0).length / perfLast24h.length) * 100)}%`
      : " Win Rate (24h): N/A",
    "",
    "<b>Lessons Learned:</b>",
    lessonsLast24h.length > 0
      ? lessonsLast24h.map((l) => ` ${l.rule}`).join("\n")
      : " No new lessons recorded overnight.",
    "",
    "<b>Current Portfolio:</b>",
    ` Open Positions: ${openPositions.length}`,
    perfSummary
      ? ` All-time PnL: $${perfSummary.total_pnl_usd.toFixed(2)} (${perfSummary.win_rate_pct}% win)`
      : "",
    "",
  ];

  return lines.join("\n");
}

function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    log("briefing_error", `Failed to read ${file}: ${err.message}`);
    return null;
  }
}
