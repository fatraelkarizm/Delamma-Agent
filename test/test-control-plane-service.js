/**
 * Offline smoke test for control-plane service.
 * Run: node test/test-control-plane-service.js
 */

import { queueOrRunControlCommand, showControlPlaneStatus } from "../core/control-plane-service.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createReplyRecorder() {
  const calls = [];
  async function reply(chatId, text) {
    calls.push({ chatId, text });
  }
  return { calls, reply };
}

async function testLocalExecutionPath() {
  const { calls, reply } = createReplyRecorder();
  const chatId = "chat-local";
  const scope = { tenantId: "local", walletId: "primary" };

  let startCronCalls = 0;
  const workerRuntime = {
    context: { tenantId: "local", walletId: "primary" },
    supportsLocalExecution: true,
    async ensureCronStarted() {
      startCronCalls += 1;
    },
  };

  await queueOrRunControlCommand({
    chatId,
    scope,
    command: "start_cron",
    workerRuntime,
    reply,
    deps: {
      createWorkerControlRequest() {
        throw new Error("should not hit DB in local path");
      },
    },
  });

  assert(startCronCalls === 1, "local start_cron should call ensureCronStarted once");
  assert(calls.length === 1, "local start_cron should reply once");
  assert(calls[0].text.includes("Started cron"), "local reply should confirm start");
}

async function testRemoteQueuePath() {
  const { calls, reply } = createReplyRecorder();
  const chatId = "chat-remote";
  const scope = { tenantId: "tenant-a", walletId: "wallet-a" };

  const workerRuntime = {
    context: { tenantId: "local", walletId: "primary" },
    supportsLocalExecution: false,
  };

  let queuedArgs = null;
  await queueOrRunControlCommand({
    chatId,
    scope,
    command: "launch_worker",
    workerRuntime,
    reply,
    deps: {
      async createWorkerControlRequest(payload) {
        queuedArgs = payload;
        return { id: 42 };
      },
    },
  });

  assert(queuedArgs?.tenant_id === scope.tenantId, "queue should include tenant_id");
  assert(queuedArgs?.wallet_id === scope.walletId, "queue should include wallet_id");
  assert(queuedArgs?.requested_by === `telegram:${chatId}`, "queue should include requested_by");
  assert(calls.length === 1, "remote queue should reply once");
  assert(calls[0].text.includes("#42"), "remote reply should include request id");
}

async function testShowStatusWithDeps() {
  const { calls, reply } = createReplyRecorder();
  const chatId = "chat-status";
  const scope = { tenantId: "tenant-a", walletId: "wallet-a" };
  const workerRuntime = {
    context: { tenantId: "local", walletId: "primary" },
    supportsLocalExecution: false,
  };

  await showControlPlaneStatus({
    chatId,
    scope,
    workerRuntime,
    reply,
    deps: {
      async listWorkerRuntimeState() {
        return {
          workers: [
            { tenant_id: "tenant-a", wallet_id: "wallet-a", worker_id: "w1", status: "running", last_seen_at: "now" },
            { tenant_id: "tenant-a", wallet_id: "wallet-b", worker_id: "w2", status: "running", last_seen_at: "now" },
          ],
          wallet_leases: [{ tenant_id: "tenant-a", wallet_id: "wallet-a" }],
        };
      },
      async listWorkerControlRequests() {
        return [{ id: 7, command: "launch_worker", status: "queued" }];
      },
    },
  });

  assert(calls.length === 1, "status should reply once");
  assert(calls[0].text.includes("Scope: tenant-a/wallet-a"), "status should include scope");
  assert(calls[0].text.includes("Workers visible: 1"), "status should filter workers by scope");
  assert(calls[0].text.includes("Leases visible: 1"), "status should filter leases by scope");
  assert(calls[0].text.includes("#7"), "status should include recent request");
}

async function main() {
  await testLocalExecutionPath();
  await testRemoteQueuePath();
  await testShowStatusWithDeps();
  console.log("Control-plane service smoke test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

