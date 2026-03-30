import { generateBriefing } from "../lib/briefing.js";
import { log } from "../lib/logger.js";
import { getLastBriefingDate, setLastBriefingDate } from "../lib/state.js";
import { isEnabled as telegramEnabled, sendHTML } from "./telegram.js";

export async function runBriefing() {
  log("cron", "Starting morning briefing");
  try {
    const briefing = await generateBriefing();
    if (telegramEnabled()) {
      await sendHTML(briefing);
    }
    setLastBriefingDate();
  } catch (error) {
    log("cron_error", `Morning briefing failed: ${error.message}`);
  }
}

export async function maybeRunMissedBriefing() {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const lastSent = getLastBriefingDate();

  if (lastSent === todayUtc) return;

  const nowUtc = new Date();
  const briefingHourUtc = 1;
  if (nowUtc.getUTCHours() < briefingHourUtc) return;

  log("cron", `Missed briefing detected (last sent: ${lastSent || "never"}) - sending now`);
  await runBriefing();
}
