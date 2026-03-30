const runtimeTimers = {
  managementLastRun: null,
  screeningLastRun: null,
};

function nextRunIn(lastRun, intervalMin) {
  if (!lastRun) return intervalMin * 60;
  const elapsed = (Date.now() - lastRun) / 1000;
  return Math.max(0, intervalMin * 60 - elapsed);
}

function formatCountdown(seconds) {
  if (seconds <= 0) return "now";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function buildRuntimePrompt(schedule) {
  const management = formatCountdown(nextRunIn(runtimeTimers.managementLastRun, schedule.managementIntervalMin));
  const screening = formatCountdown(nextRunIn(runtimeTimers.screeningLastRun, schedule.screeningIntervalMin));
  return `[manage: ${management} | screen: ${screening}]\n> `;
}

export function markManagementRun(ts = Date.now()) {
  runtimeTimers.managementLastRun = ts;
}

export function markScreeningRun(ts = Date.now()) {
  runtimeTimers.screeningLastRun = ts;
}

export function seedRuntimeTimers(ts = Date.now()) {
  markManagementRun(ts);
  markScreeningRun(ts);
}
