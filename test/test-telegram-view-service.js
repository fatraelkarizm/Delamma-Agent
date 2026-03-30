/**
 * Offline smoke test for telegram view service.
 * Run: node test/test-telegram-view-service.js
 */

import {
  showPositions,
  setPositionNote,
  closeScopedPosition,
} from "../core/telegram-view-service.js";

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

function createScopedRunnerWithState(state, instructionSink) {
  return {
    getScopeRuntime() {
      return {
        stateStore: {
          load() {
            return state;
          },
          setPositionInstruction(position, note) {
            instructionSink.push({ position, note });
          },
        },
      };
    },
  };
}

async function testShowPositionsTrackedScope() {
  const { calls, reply } = createReplyRecorder();
  const scope = { tenantId: "tenant-a", walletId: "wallet-a" };
  const workerRuntime = {
    context: { tenantId: "other", walletId: "other" },
    supportsLocalExecution: false,
  };
  const state = {
    positions: {
      one: {
        position: "pos-1",
        pool_name: "POOL-1",
        strategy: "spot",
        deployed_at: "2026-03-27T10:00:00Z",
        closed: false,
      },
    },
  };

  await showPositions({
    chatId: "chat1",
    scope,
    workerRuntime,
    scopedRunner: createScopedRunnerWithState(state, []),
    reply,
  });

  assert(calls.length === 1, "showPositions should reply once");
  assert(calls[0].text.includes("Tracked positions"), "showPositions should show tracked positions");
  assert(calls[0].text.includes("POOL-1"), "tracked output should include pool");
}

async function testSetPositionNote() {
  const { calls, reply } = createReplyRecorder();
  const instructionSink = [];
  const scope = { tenantId: "tenant-a", walletId: "wallet-a" };
  const state = {
    positions: {
      one: {
        position: "pos-1",
        pool_name: "POOL-1",
        closed: false,
      },
    },
  };

  await setPositionNote({
    chatId: "chat1",
    scope,
    scopedRunner: createScopedRunnerWithState(state, instructionSink),
    index: 0,
    note: "take profit if fee drops",
    reply,
  });

  assert(instructionSink.length === 1, "setPositionNote should set one instruction");
  assert(instructionSink[0].position === "pos-1", "setPositionNote should target position");
  assert(calls[0].text.includes("Note set"), "setPositionNote should confirm success");
}

async function testCloseScopedPositionRemoteBlocked() {
  const { calls, reply } = createReplyRecorder();
  const workerRuntime = {
    context: { tenantId: "local", walletId: "primary" },
    supportsLocalExecution: false,
    runInScope(fn) {
      return fn();
    },
  };

  await closeScopedPosition({
    chatId: "chat1",
    scope: { tenantId: "tenant-a", walletId: "wallet-a" },
    workerRuntime,
    index: 0,
    reply,
  });

  assert(calls.length === 1, "closeScopedPosition should reply once when blocked");
  assert(
    calls[0].text.includes("only works for the local attached wallet scope"),
    "closeScopedPosition should block remote scope"
  );
}

async function main() {
  await testShowPositionsTrackedScope();
  await testSetPositionNote();
  await testCloseScopedPositionRemoteBlocked();
  console.log("Telegram view service smoke test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

