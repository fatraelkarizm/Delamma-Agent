import {
  createWorkerControlRequest,
  listWorkerControlRequests,
  listWorkerRuntimeState,
} from "../lib/db.js";
import { runBriefing } from "./briefing-service.js";

export const TELEGRAM_CONTROL_COMMAND_MAP = {
  "/launch": "launch_worker",
  "/restartworker": "restart_worker",
  "/start": "start_cron",
  "/restart": "restart_cron",
  "/stop": "stop_cron",
  "/manage": "run_management_cycle",
  "/screen": "run_screening_cycle",
  "/briefingrun": "run_briefing",
  "/shutdown": "shutdown_worker",
};

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

function supportsLocalExecution(workerRuntime) {
  return workerRuntime?.supportsLocalExecution !== false;
}

export async function showControlPlaneStatus({
  chatId,
  scope,
  workerRuntime,
  reply,
  deps = {},
}) {
  const {
    listWorkerRuntimeState: listWorkerRuntimeStateFn = listWorkerRuntimeState,
    listWorkerControlRequests: listWorkerControlRequestsFn = listWorkerControlRequests,
  } = deps || {};

  const runtime = await listWorkerRuntimeStateFn();
  const requests = await listWorkerControlRequestsFn({
    tenant_id: scope.tenantId,
    wallet_id: scope.walletId,
    limit: 5,
  });

  const workers =
    runtime?.workers?.filter(
      (worker) =>
        worker.tenant_id === scope.tenantId && worker.wallet_id === scope.walletId
    ) || [];
  const leases =
    runtime?.wallet_leases?.filter(
      (lease) =>
        lease.tenant_id === scope.tenantId && lease.wallet_id === scope.walletId
    ) || [];

  const lines = [
    `Scope: ${formatScope(scope)}`,
    `Local worker attached: ${
      sameScope(scope, workerRuntime.context) && supportsLocalExecution(workerRuntime)
        ? "yes"
        : "no"
    }`,
    `Workers visible: ${workers.length}`,
    `Leases visible: ${leases.length}`,
  ];

  if (workers.length > 0) {
    lines.push("");
    lines.push("Workers:");
    for (const worker of workers.slice(0, 4)) {
      lines.push(
        `- ${worker.worker_id} | ${worker.status || "unknown"} | seen ${
          worker.last_seen_at || "unknown"
        }`
      );
    }
  }

  if (requests?.length > 0) {
    lines.push("");
    lines.push("Recent requests:");
    for (const request of requests.slice(0, 4)) {
      lines.push(`- #${request.id} ${request.command} | ${request.status}`);
    }
  }

  if (!runtime) {
    lines.push("");
    lines.push(
      "Runtime DB state unavailable here. Local control still works for the attached scope."
    );
  }

  await reply(chatId, lines.join("\n"));
}

export async function queueOrRunControlCommand({
  chatId,
  scope,
  command,
  workerRuntime,
  reply,
  deps = {},
}) {
  const {
    createWorkerControlRequest: createWorkerControlRequestFn = createWorkerControlRequest,
    runBriefing: runBriefingFn = runBriefing,
  } = deps || {};

  if (supportsLocalExecution(workerRuntime) && sameScope(scope, workerRuntime.context)) {
    switch (command) {
      case "start_cron":
        await workerRuntime.ensureCronStarted();
        await reply(chatId, `Started cron for local scope ${formatScope(scope)}.`);
        return;
      case "restart_cron":
        await workerRuntime.restartCronJobsIfStarted();
        await reply(chatId, `Restarted cron for local scope ${formatScope(scope)}.`);
        return;
      case "stop_cron":
        await workerRuntime.stopCronJobs();
        await reply(chatId, `Stopped cron for local scope ${formatScope(scope)}.`);
        return;
      case "run_management_cycle": {
        const report = await workerRuntime.runManagementCycle({ silent: true });
        await reply(
          chatId,
          report || `Management cycle finished for ${formatScope(scope)}.`
        );
        return;
      }
      case "run_screening_cycle": {
        const report = await workerRuntime.runScreeningCycle({ silent: true });
        await reply(
          chatId,
          report || `Screening cycle finished for ${formatScope(scope)}.`
        );
        return;
      }
      case "run_briefing":
        await workerRuntime.runInScope(() => runBriefingFn());
        await reply(chatId, `Ran briefing locally for ${formatScope(scope)}.`);
        return;
      case "shutdown_worker":
        await reply(chatId, "Shutdown requested for the local attached worker.");
        process.nextTick(() => {
          workerRuntime.destroy().finally(() => process.exit(0));
        });
        return;
      case "launch_worker":
        await reply(
          chatId,
          "This chat is already attached to the local worker. Use /start or /restart instead."
        );
        return;
      case "restart_worker":
        await reply(
          chatId,
          "Full restart_worker needs the supervisor loop. Use /restart for the local attached worker."
        );
        return;
      default:
        break;
    }
  }

  const queued = await createWorkerControlRequestFn({
    tenant_id: scope.tenantId,
    wallet_id: scope.walletId,
    requested_by: `telegram:${chatId}`,
    command,
    payload: {
      source: "telegram",
      chat_id: chatId,
    },
  });

  if (!queued) {
    await reply(
      chatId,
      `Failed to queue ${command} for ${formatScope(
        scope
      )}. DB-backed control plane is unavailable here.`
    );
    return;
  }

  await reply(
    chatId,
    `Queued ${command} for ${formatScope(scope)} as request #${queued.id}.`
  );
}

