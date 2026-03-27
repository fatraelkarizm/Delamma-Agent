import { spawn } from "child_process";
import {
  createWorkerControlRequest,
  claimWorkerControlRequestById,
  completeWorkerControlRequest,
  listWorkerControlRequests,
  listWorkerRuntimeState,
  recordWorkerActivity,
  requeueWorkerControlRequest,
} from "../lib/db.js";
import { repoPath } from "../lib/paths.js";

const DEFAULT_SUPERVISOR_INTERVAL_MS = 15_000;
const SUPERVISOR_COMMANDS = new Set(["launch_worker", "restart_worker"]);
const ACTIVE_WORKER_WINDOW_MS = 90_000;
const SHUTDOWN_REQUEST_RETRY_MS = 30_000;

function createSupervisorWorkerId() {
  return `supervisor:${process.pid}`;
}

function isWorkerActive(worker) {
  if (!worker?.last_seen_at) return false;
  return (Date.now() - new Date(worker.last_seen_at).getTime()) < ACTIVE_WORKER_WINDOW_MS;
}

function findActiveWorker(activeWorkers, { tenant_id, wallet_id }) {
  return activeWorkers.find((worker) => (
    worker.tenant_id === tenant_id &&
    worker.wallet_id === wallet_id &&
    isWorkerActive(worker)
  )) || null;
}

export function launchWorkerProcess({
  tenantId,
  walletId,
  payload = {},
} = {}) {
  if (!tenantId || !walletId) {
    throw new Error("tenantId and walletId are required to launch a worker");
  }

  const workerId = payload.worker_id || `${tenantId}:${walletId}:background:${Date.now()}`;
  const child = spawn(process.execPath, [repoPath("index.js")], {
    cwd: repoPath(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      TENANT_ID: tenantId,
      WALLET_ID: walletId,
      WALLET_ADDRESS: payload.wallet_address || walletId,
      WORKER_ID: workerId,
      WORKER_MODE: "background",
      WORKER_CHANNEL: "supervisor",
      WORKER_PARENT_PID: String(process.pid),
    },
  });

  child.unref();

  return {
    pid: child.pid,
    worker_id: workerId,
    tenant_id: tenantId,
    wallet_id: walletId,
  };
}

export async function processSupervisorRequests({ limit = 5 } = {}) {
  const pending = await listWorkerControlRequests({
    status: "pending",
    limit,
  });

  if (!pending?.length) {
    return { processed: 0, requests: [] };
  }

  const workerId = createSupervisorWorkerId();
  const handled = [];
  const runtimeState = await listWorkerRuntimeState();
  const activeWorkers = [...(runtimeState?.workers || [])];

  for (const request of pending) {
    if (!SUPERVISOR_COMMANDS.has(request.command)) continue;

    const claimed = await claimWorkerControlRequestById({
      id: request.id,
      worker_id: workerId,
    });

    if (!claimed) continue;

    try {
      let result = {};

      if (claimed.command === "launch_worker") {
        const existingWorker = findActiveWorker(activeWorkers, claimed);

        if (existingWorker) {
          throw new Error(`Worker already active for ${claimed.tenant_id}/${claimed.wallet_id}: ${existingWorker.worker_id}`);
        }

        result = launchWorkerProcess({
          tenantId: claimed.tenant_id,
          walletId: claimed.wallet_id,
          payload: claimed.payload || {},
        });
        await recordWorkerActivity({
          tenant_id: claimed.tenant_id,
          wallet_id: claimed.wallet_id,
          worker_id: result.worker_id,
          level: "info",
          event_type: "worker_launched",
          message: `Launched worker ${result.worker_id}`,
          payload: { request_id: claimed.id, pid: result.pid, command: claimed.command },
        });
      }

      if (claimed.command === "restart_worker") {
        const payload = claimed.payload || {};
        const existingWorker = findActiveWorker(activeWorkers, claimed);

        if (existingWorker) {
          const previousWorkerId = payload.previous_worker_id || null;
          const shutdownRequestedAt = payload.shutdown_requested_at
            ? new Date(payload.shutdown_requested_at).getTime()
            : 0;
          const shouldQueueShutdown = (
            previousWorkerId !== existingWorker.worker_id ||
            !shutdownRequestedAt ||
            (Date.now() - shutdownRequestedAt) >= SHUTDOWN_REQUEST_RETRY_MS
          );

          const nextPayload = {
            ...payload,
            restart_stage: "awaiting_shutdown",
            previous_worker_id: existingWorker.worker_id,
            restart_requested_at: payload.restart_requested_at || new Date().toISOString(),
            shutdown_requested_at: shouldQueueShutdown
              ? new Date().toISOString()
              : payload.shutdown_requested_at || null,
          };

          const requeued = await requeueWorkerControlRequest({
            id: claimed.id,
            worker_id: workerId,
            payload: nextPayload,
            error: null,
          });

          if (!requeued) {
            throw new Error(`Failed to requeue restart request ${claimed.id}`);
          }

          if (shouldQueueShutdown) {
            const shutdownRequest = await createWorkerControlRequest({
              tenant_id: claimed.tenant_id,
              wallet_id: claimed.wallet_id,
              requested_by: workerId,
              command: "shutdown_worker",
              payload: {
                target_worker_id: existingWorker.worker_id,
                restart_request_id: claimed.id,
                supervisor_worker_id: workerId,
              },
            });

            if (!shutdownRequest) {
              throw new Error(`Failed to queue shutdown for ${existingWorker.worker_id}`);
            }
          }

          await recordWorkerActivity({
            tenant_id: claimed.tenant_id,
            wallet_id: claimed.wallet_id,
            worker_id: existingWorker.worker_id,
            level: "warn",
            event_type: "worker_restart_waiting_shutdown",
            message: `Restart queued for ${existingWorker.worker_id}; waiting for shutdown`,
            payload: {
              request_id: claimed.id,
              target_worker_id: existingWorker.worker_id,
              shutdown_requeued: shouldQueueShutdown,
            },
          });

          handled.push({
            id: claimed.id,
            command: claimed.command,
            status: "pending",
            stage: "awaiting_shutdown",
            target_worker_id: existingWorker.worker_id,
          });
          continue;
        }

        result = launchWorkerProcess({
          tenantId: claimed.tenant_id,
          walletId: claimed.wallet_id,
          payload: claimed.payload || {},
        });
        await recordWorkerActivity({
          tenant_id: claimed.tenant_id,
          wallet_id: claimed.wallet_id,
          worker_id: result.worker_id,
          level: "info",
          event_type: "worker_restarted",
          message: `Restart launched replacement worker ${result.worker_id}`,
          payload: { request_id: claimed.id, pid: result.pid, previous_worker_id: payload.previous_worker_id || null },
        });
      }

      await completeWorkerControlRequest({
        id: claimed.id,
        worker_id: workerId,
        status: "completed",
        result,
      });

      handled.push({ id: claimed.id, command: claimed.command, status: "completed", result });
      if (result?.worker_id) {
        activeWorkers.unshift({
          worker_id: result.worker_id,
          tenant_id: claimed.tenant_id,
          wallet_id: claimed.wallet_id,
          last_seen_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      await recordWorkerActivity({
        tenant_id: claimed.tenant_id,
        wallet_id: claimed.wallet_id,
        worker_id: claimed.worker_id || workerId,
        level: "error",
        event_type: "supervisor_request_failed",
        message: `Supervisor failed ${claimed.command} for ${claimed.tenant_id}/${claimed.wallet_id}`,
        payload: { request_id: claimed.id, command: claimed.command, error: error.message },
      });
      await completeWorkerControlRequest({
        id: claimed.id,
        worker_id: workerId,
        status: "failed",
        result: {},
        error: error.message,
      });

      handled.push({ id: claimed.id, command: claimed.command, status: "failed", error: error.message });
    }
  }

  return {
    processed: handled.length,
    requests: handled,
  };
}

export function startWorkerSupervisor({
  intervalMs = DEFAULT_SUPERVISOR_INTERVAL_MS,
} = {}) {
  const timer = setInterval(() => {
    processSupervisorRequests().catch(() => {});
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return {
    intervalMs,
    stop() {
      clearInterval(timer);
    },
  };
}
