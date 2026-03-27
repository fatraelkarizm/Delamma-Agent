import { generateBriefing } from "../lib/briefing.js";
import { getMyPositions, closePosition } from "../tools/dlmm.js";

function formatScope(scope) {
  return `${scope.tenantId}/${scope.walletId}`;
}

function sameScope(left, right) {
  return Boolean(
    left?.tenantId &&
      left?.walletId &&
      right?.tenantId &&
      right?.walletId &&
      left.tenantId === right.tenantId &&
      left.walletId === right.walletId
  );
}

export function supportsLocalExecution(workerRuntime) {
  return workerRuntime?.supportsLocalExecution !== false;
}

export function canUseLiveWallet(scope, workerRuntime) {
  return (
    supportsLocalExecution(workerRuntime) &&
    sameScope(scope, workerRuntime.context) &&
    Boolean(process.env.WALLET_PRIVATE_KEY)
  );
}

export async function showPositions({ chatId, scope, workerRuntime, scopedRunner, reply }) {
  if (canUseLiveWallet(scope, workerRuntime)) {
    const { positions, total_positions } = await workerRuntime.runInScope(() =>
      getMyPositions({ force: true })
    );
    if (total_positions === 0) {
      await reply(chatId, `No live open positions for ${formatScope(scope)}.`);
      return;
    }

    const lines = positions.map((position, index) => {
      const age = position.age_minutes != null ? `${position.age_minutes}m` : "?";
      const fees = position.unclaimed_fees_usd ?? 0;
      return `${index + 1}. ${position.pair} | fees $${fees} | age ${age} | ${
        position.in_range ? "in-range" : "out-of-range"
      }`;
    });

    await reply(chatId, `Live positions for ${formatScope(scope)}:\n\n${lines.join("\n")}`);
    return;
  }

  const scopedState = scopedRunner.getScopeRuntime(scope).stateStore.load();
  const openPositions = Object.values(scopedState.positions || {}).filter((position) => !position.closed);

  if (openPositions.length === 0) {
    await reply(chatId, `No tracked positions for ${formatScope(scope)}.`);
    return;
  }

  const lines = openPositions.map((position, index) => {
    const deployedAt = position.deployed_at
      ? position.deployed_at.slice(0, 16).replace("T", " ")
      : "unknown";
    return `${index + 1}. ${position.pool_name || position.pool} | strategy ${
      position.strategy || "?"
    } | deployed ${deployedAt}`;
  });

  await reply(chatId, `Tracked positions for ${formatScope(scope)}:\n\n${lines.join("\n")}`);
}

export async function showBriefing({ chatId, scope, scopedRunner, reply }) {
  const scopedRuntime = scopedRunner.getScopeRuntime(scope);
  const briefing = await scopedRunner.run(scope, () =>
    generateBriefing({
      state: scopedRuntime.stateStore.load(),
      lessonsData: scopedRuntime.lessonsStore.load(),
      perfSummary: scopedRuntime.lessonsStore.getPerformanceSummary(),
    })
  );

  await reply(chatId, briefing, { html: true });
}

export async function setPositionNote({ chatId, scope, scopedRunner, index, note, reply }) {
  const scopedRuntime = scopedRunner.getScopeRuntime(scope);
  const openPositions = Object.values(scopedRuntime.stateStore.load().positions || {}).filter(
    (position) => !position.closed
  );
  const position = openPositions[index];

  if (!position) {
    await reply(chatId, "Invalid number. Use /positions first.");
    return;
  }

  scopedRuntime.stateStore.setPositionInstruction(position.position, note);
  await reply(
    chatId,
    `Note set for ${position.pool_name || position.pool} in ${formatScope(scope)}:\n"${note}"`
  );
}

export async function closeScopedPosition({ chatId, scope, workerRuntime, index, reply }) {
  if (!canUseLiveWallet(scope, workerRuntime)) {
    await reply(
      chatId,
      "Direct /close only works for the local attached wallet scope. Use control commands for remote SaaS workers."
    );
    return;
  }

  const { positions } = await workerRuntime.runInScope(() => getMyPositions({ force: true }));
  const position = positions[index];
  if (!position) {
    await reply(chatId, "Invalid number. Use /positions first.");
    return;
  }

  await reply(chatId, `Closing ${position.pair} on ${formatScope(scope)}...`);
  const result = await workerRuntime.runInScope(() =>
    closePosition({ position_address: position.position })
  );
  if (result.success) {
    await reply(chatId, `Closed ${position.pair}\nPnL: $${result.pnl_usd ?? "?"}`);
    return;
  }

  await reply(chatId, `Close failed: ${JSON.stringify(result)}`);
}

