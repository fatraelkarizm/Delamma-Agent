import { log } from "./logger.js";
import { getStateData } from "./state.js";
import { getLessonsData, getPerformanceSummary } from "../memory/lessons.js";

export async function generateBriefing({ state: providedState = null, lessonsData: providedLessonsData = null, perfSummary: providedPerfSummary = null } = {}) {
  let state = providedState;
  let lessonsData = providedLessonsData;

  try {
    state = state || getStateData() || { positions: {}, recentEvents: [] };
    lessonsData = lessonsData || getLessonsData() || { lessons: [], performance: [] };
  } catch (err) {
    log("briefing_error", `Failed to load briefing data: ${err.message}`);
    state = { positions: {}, recentEvents: [] };
    lessonsData = { lessons: [], performance: [] };
  }

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const allPositions = Object.values(state.positions || {});
  const openedLast24h = allPositions.filter((position) => position.deployed_at && new Date(position.deployed_at) > last24h);
  const closedLast24h = allPositions.filter((position) => position.closed && position.closed_at && new Date(position.closed_at) > last24h);

  const perfLast24h = (lessonsData.performance || []).filter((entry) => entry.recorded_at && new Date(entry.recorded_at) > last24h);
  const totalPnlUsd = perfLast24h.reduce((sum, entry) => sum + (entry.pnl_usd || 0), 0);
  const totalFeesUsd = perfLast24h.reduce((sum, entry) => sum + (entry.fees_earned_usd || 0), 0);

  const lessonsLast24h = (lessonsData.lessons || []).filter((lesson) => lesson.created_at && new Date(lesson.created_at) > last24h);
  const openPositions = allPositions.filter((position) => !position.closed);
  const perfSummary = providedPerfSummary || getPerformanceSummary();

  const lines = [
    "Morning Briefing (Last 24h)",
    "----------------",
    "<b>Activity:</b>",
    `Positions Opened: ${openedLast24h.length}`,
    `Positions Closed: ${closedLast24h.length}`,
    "",
    "<b>Performance:</b>",
    `Net PnL: ${totalPnlUsd >= 0 ? "+" : ""}$${totalPnlUsd.toFixed(2)}`,
    `Fees Earned: $${totalFeesUsd.toFixed(2)}`,
    perfLast24h.length > 0
      ? `Win Rate (24h): ${Math.round((perfLast24h.filter((entry) => entry.pnl_usd > 0).length / perfLast24h.length) * 100)}%`
      : "Win Rate (24h): N/A",
    "",
    "<b>Lessons Learned:</b>",
    lessonsLast24h.length > 0
      ? lessonsLast24h.map((lesson) => `- ${lesson.rule}`).join("\n")
      : "- No new lessons recorded overnight.",
    "",
    "<b>Current Portfolio:</b>",
    `Open Positions: ${openPositions.length}`,
    perfSummary
      ? `All-time PnL: $${perfSummary.total_pnl_usd.toFixed(2)} (${perfSummary.win_rate_pct}% win)`
      : "",
    "----------------",
  ];

  return lines.join("\n");
}
