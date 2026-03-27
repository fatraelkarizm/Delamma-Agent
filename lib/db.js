/**
 * db.js — PostgreSQL persistence layer for the DLMM bot.
 * Writes all trade events, position state, and heartbeats to the `delamma-bot` DB.
 */

import pg from "pg";
import { log } from "./logger.js";

const { Pool } = pg;

let pool;
let workerRuntimeTablesReady = null;
let workerRuntimeTablesRetryAt = 0;
let walletStorageSnapshotTableReady = null;
let walletStorageSnapshotRetryAt = 0;

const WORKER_RUNTIME_TABLE_RETRY_MS = 30_000;
const WALLET_STORAGE_SNAPSHOT_RETRY_MS = 30_000;

function getPool() {
  if (!pool) {
    const connStr =
      process.env.DATABASE_URL ||
      `postgresql://postgres:${process.env.DB_PASSWORD || "postgres"}@localhost:5432/delamma-bot`;
    pool = new Pool({ connectionString: connStr });
    pool.on("error", (err) => log("db_error", `PG pool error: ${err.message}`));
  }
  return pool;
}

async function query(sql, params = []) {
  try {
    const res = await getPool().query(sql, params);
    return res;
  } catch (err) {
    log("db_error", `Query failed: ${err.message} | SQL: ${sql.slice(0, 80)}`);
    return null;
  }
}

async function ensureWorkerRuntimeTables() {
  if (workerRuntimeTablesRetryAt > Date.now()) {
    return false;
  }

  if (workerRuntimeTablesReady) return workerRuntimeTablesReady;

  workerRuntimeTablesReady = (async () => {
    const workerTable = await query(`
      CREATE TABLE IF NOT EXISTS worker_processes (
        worker_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        wallet_id TEXT NOT NULL,
        mode TEXT,
        channel TEXT,
        status TEXT,
        metadata JSONB,
        registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lease_expires_at TIMESTAMPTZ
      )
    `);

    if (!workerTable) {
      workerRuntimeTablesReady = null;
      workerRuntimeTablesRetryAt = Date.now() + WORKER_RUNTIME_TABLE_RETRY_MS;
      return false;
    }

    const leaseTable = await query(`
      CREATE TABLE IF NOT EXISTS wallet_leases (
        tenant_id TEXT NOT NULL,
        wallet_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        metadata JSONB,
        PRIMARY KEY (tenant_id, wallet_id)
      )
    `);

    if (!leaseTable) {
      workerRuntimeTablesReady = null;
      workerRuntimeTablesRetryAt = Date.now() + WORKER_RUNTIME_TABLE_RETRY_MS;
      return false;
    }

    const controlTable = await query(`
      CREATE TABLE IF NOT EXISTS worker_control_requests (
        id BIGSERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        wallet_id TEXT NOT NULL,
        worker_id TEXT,
        requested_by TEXT,
        command TEXT NOT NULL,
        payload JSONB,
        status TEXT NOT NULL DEFAULT 'pending',
        result JSONB,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        claimed_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      )
    `);

    if (!controlTable) {
      workerRuntimeTablesReady = null;
      workerRuntimeTablesRetryAt = Date.now() + WORKER_RUNTIME_TABLE_RETRY_MS;
      return false;
    }

    await query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_leases_worker_id
      ON wallet_leases (worker_id)
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_worker_control_requests_scope_status
      ON worker_control_requests (tenant_id, wallet_id, status, created_at)
    `);

    workerRuntimeTablesRetryAt = 0;
    return true;
  })();

  return workerRuntimeTablesReady;
}

async function ensureWalletStorageSnapshotTable() {
  if (walletStorageSnapshotRetryAt > Date.now()) {
    return false;
  }

  if (walletStorageSnapshotTableReady) return walletStorageSnapshotTableReady;

  walletStorageSnapshotTableReady = (async () => {
    const snapshotTable = await query(`
      CREATE TABLE IF NOT EXISTS wallet_storage_snapshots (
        tenant_id TEXT NOT NULL,
        wallet_id TEXT NOT NULL,
        store_key TEXT NOT NULL,
        content JSONB NOT NULL,
        metadata JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, wallet_id, store_key)
      )
    `);

    if (!snapshotTable) {
      walletStorageSnapshotTableReady = null;
      walletStorageSnapshotRetryAt = Date.now() + WALLET_STORAGE_SNAPSHOT_RETRY_MS;
      return false;
    }

    await query(`
      CREATE INDEX IF NOT EXISTS idx_wallet_storage_snapshots_store_updated
      ON wallet_storage_snapshots (store_key, updated_at DESC)
    `);

    walletStorageSnapshotRetryAt = 0;
    return true;
  })();

  return walletStorageSnapshotTableReady;
}

/**
 * Record a trade event (deploy, close, claim, rebalance).
 */
export async function recordEvent({
  action,
  position,
  pool_addr,
  pool_name,
  strategy,
  amount_sol,
  pnl_usd,
  fees_usd,
  reason,
  raw,
}) {
  await query(
    `INSERT INTO trade_events (action, position, pool, pool_name, strategy, amount_sol, pnl_usd, fees_usd, reason, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [action, position, pool_addr, pool_name, strategy, amount_sol, pnl_usd, fees_usd, reason, raw ? JSON.stringify(raw) : null]
  );

  // Update daily_pnl roll-up
  const date = new Date().toISOString().slice(0, 10);
  const isWin = pnl_usd != null && pnl_usd > 0;
  const isLoss = pnl_usd != null && pnl_usd <= 0 && action === "close";
  await query(
    `INSERT INTO daily_pnl (date, pnl_usd, fees_usd, trades, wins, losses)
     VALUES ($1, $2, $3, 1, $4, $5)
     ON CONFLICT (date) DO UPDATE SET
       pnl_usd  = daily_pnl.pnl_usd  + EXCLUDED.pnl_usd,
       fees_usd = daily_pnl.fees_usd + EXCLUDED.fees_usd,
       trades   = daily_pnl.trades   + 1,
       wins     = daily_pnl.wins     + EXCLUDED.wins,
       losses   = daily_pnl.losses   + EXCLUDED.losses`,
    [date, pnl_usd || 0, fees_usd || 0, isWin ? 1 : 0, isLoss ? 1 : 0]
  );
}

/**
 * Upsert a position into the positions table.
 */
export async function upsertPosition(pos) {
  await query(
    `INSERT INTO positions (position, pool, pool_name, strategy, amount_sol, initial_value_usd,
      total_fees_claimed_usd, rebalance_count, volatility, fee_tvl_ratio, organic_score,
      deployed_at, closed, closed_at, out_of_range_since, last_claim_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (position) DO UPDATE SET
       pool_name              = EXCLUDED.pool_name,
       closed                 = EXCLUDED.closed,
       closed_at              = EXCLUDED.closed_at,
       total_fees_claimed_usd = EXCLUDED.total_fees_claimed_usd,
       rebalance_count        = EXCLUDED.rebalance_count,
       out_of_range_since     = EXCLUDED.out_of_range_since,
       last_claim_at          = EXCLUDED.last_claim_at,
       updated_at             = NOW()`,
    [
      pos.position, pos.pool, pos.pool_name, pos.strategy,
      pos.amount_sol, pos.initial_value_usd, pos.total_fees_claimed_usd || 0,
      pos.rebalance_count || 0, pos.volatility, pos.fee_tvl_ratio,
      pos.organic_score,
      pos.deployed_at ? new Date(pos.deployed_at) : null,
      pos.closed || false,
      pos.closed_at ? new Date(pos.closed_at) : null,
      pos.out_of_range_since ? new Date(pos.out_of_range_since) : null,
      pos.last_claim_at ? new Date(pos.last_claim_at) : null,
    ]
  );
}

/**
 * Write a heartbeat so the dashboard can tell if the bot is live.
 */
export async function heartbeat({ dry_run = false, open_positions = 0 } = {}) {
  await query(
    `INSERT INTO bot_status (id, last_seen, is_live, dry_run, open_positions, version)
     VALUES (1, NOW(), TRUE, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       last_seen      = NOW(),
       is_live        = TRUE,
       dry_run        = EXCLUDED.dry_run,
       open_positions = EXCLUDED.open_positions,
       version        = EXCLUDED.version`,
    [dry_run, open_positions, "1.0.0"]
  );
}

export async function upsertWorkerProcess({
  worker_id,
  tenant_id,
  wallet_id,
  mode = null,
  channel = null,
  status = null,
  metadata = {},
  lease_expires_at = null,
}) {
  const ready = await ensureWorkerRuntimeTables();
  if (!ready) return null;

  const res = await query(
    `INSERT INTO worker_processes (
      worker_id, tenant_id, wallet_id, mode, channel, status, metadata, lease_expires_at, registered_at, last_seen_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
    ON CONFLICT (worker_id) DO UPDATE SET
      tenant_id = EXCLUDED.tenant_id,
      wallet_id = EXCLUDED.wallet_id,
      mode = EXCLUDED.mode,
      channel = EXCLUDED.channel,
      status = EXCLUDED.status,
      metadata = EXCLUDED.metadata,
      lease_expires_at = EXCLUDED.lease_expires_at,
      last_seen_at = NOW()
    RETURNING *`,
    [
      worker_id,
      tenant_id,
      wallet_id,
      mode,
      channel,
      status,
      JSON.stringify(metadata || {}),
      lease_expires_at,
    ]
  );

  return res?.rows?.[0] || null;
}

export async function deleteWorkerProcess({ worker_id }) {
  const ready = await ensureWorkerRuntimeTables();
  if (!ready) return null;

  const res = await query(
    `DELETE FROM worker_processes WHERE worker_id = $1 RETURNING worker_id`,
    [worker_id]
  );

  return res?.rows?.[0] || null;
}

export async function acquireWalletLeaseDb({
  tenant_id,
  wallet_id,
  worker_id,
  ttl_ms,
  metadata = {},
}) {
  const ready = await ensureWorkerRuntimeTables();
  if (!ready) return null;

  const res = await query(
    `INSERT INTO wallet_leases (
      tenant_id, wallet_id, worker_id, acquired_at, renewed_at, expires_at, metadata
    )
    VALUES (
      $1, $2, $3, NOW(), NOW(), NOW() + ($4::text || ' milliseconds')::interval, $5::jsonb
    )
    ON CONFLICT (tenant_id, wallet_id) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      acquired_at = CASE
        WHEN wallet_leases.worker_id = EXCLUDED.worker_id THEN wallet_leases.acquired_at
        ELSE NOW()
      END,
      renewed_at = NOW(),
      expires_at = NOW() + ($4::text || ' milliseconds')::interval,
      metadata = EXCLUDED.metadata
    WHERE wallet_leases.expires_at <= NOW()
       OR wallet_leases.worker_id = EXCLUDED.worker_id
    RETURNING
      tenant_id, wallet_id, worker_id, acquired_at, renewed_at, expires_at, metadata`,
    [tenant_id, wallet_id, worker_id, ttl_ms, JSON.stringify(metadata || {})]
  );

  if (res?.rows?.[0]) {
    return { acquired: true, lease: res.rows[0] };
  }

  const held = await getWalletLeaseDb({ tenant_id, wallet_id });
  return { acquired: false, lease: held };
}

export async function getWalletLeaseDb({ tenant_id, wallet_id }) {
  const ready = await ensureWorkerRuntimeTables();
  if (!ready) return null;

  const cleanup = await query(
    `DELETE FROM wallet_leases WHERE expires_at <= NOW()`
  );
  if (cleanup == null) return null;

  const res = await query(
    `SELECT tenant_id, wallet_id, worker_id, acquired_at, renewed_at, expires_at, metadata
     FROM wallet_leases
     WHERE tenant_id = $1 AND wallet_id = $2`,
    [tenant_id, wallet_id]
  );

  return res?.rows?.[0] || null;
}

export async function releaseWalletLeaseDb({ tenant_id, wallet_id, worker_id }) {
  const ready = await ensureWorkerRuntimeTables();
  if (!ready) return null;

  const res = await query(
    `DELETE FROM wallet_leases
     WHERE tenant_id = $1 AND wallet_id = $2 AND worker_id = $3
     RETURNING tenant_id, wallet_id, worker_id`,
    [tenant_id, wallet_id, worker_id]
  );

  return res?.rows?.[0] || null;
}

export async function listWorkerRuntimeState() {
  const ready = await ensureWorkerRuntimeTables();
  if (!ready) return null;

  const workers = await query(`
    SELECT worker_id, tenant_id, wallet_id, mode, channel, status, metadata, registered_at, last_seen_at, lease_expires_at
    FROM worker_processes
    ORDER BY registered_at DESC
  `);

  if (!workers) return null;

  const leases = await query(`
    SELECT tenant_id, wallet_id, worker_id, acquired_at, renewed_at, expires_at, metadata
    FROM wallet_leases
    WHERE expires_at > NOW()
    ORDER BY renewed_at DESC
  `);

  if (!leases) return null;

  return {
    workers: workers.rows,
    wallet_leases: leases.rows,
  };
}

export async function createWorkerControlRequest({
  tenant_id,
  wallet_id,
  requested_by = "dashboard",
  command,
  payload = {},
}) {
  const ready = await ensureWorkerRuntimeTables();
  if (!ready) return null;

  const res = await query(
    `INSERT INTO worker_control_requests (
      tenant_id, wallet_id, requested_by, command, payload, status, created_at
    )
    VALUES ($1,$2,$3,$4,$5::jsonb,'pending',NOW())
    RETURNING *`,
    [tenant_id, wallet_id, requested_by, command, JSON.stringify(payload || {})]
  );

  return res?.rows?.[0] || null;
}

export async function claimNextWorkerControlRequest({
  tenant_id,
  wallet_id,
  worker_id,
}) {
  const ready = await ensureWorkerRuntimeTables();
  if (!ready) return null;

  const res = await query(
    `WITH next_request AS (
      SELECT id
      FROM worker_control_requests
      WHERE tenant_id = $1
        AND wallet_id = $2
        AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE worker_control_requests req
    SET status = 'claimed',
        worker_id = $3,
        claimed_at = NOW()
    FROM next_request
    WHERE req.id = next_request.id
    RETURNING req.*`,
    [tenant_id, wallet_id, worker_id]
  );

  return res?.rows?.[0] || null;
}

export async function completeWorkerControlRequest({
  id,
  worker_id,
  status = "completed",
  result = {},
  error = null,
}) {
  const ready = await ensureWorkerRuntimeTables();
  if (!ready) return null;

  const res = await query(
    `UPDATE worker_control_requests
     SET status = $3,
         result = $4::jsonb,
         error = $5,
         completed_at = NOW()
     WHERE id = $1
       AND ($2::text IS NULL OR worker_id = $2)
     RETURNING *`,
    [id, worker_id || null, status, JSON.stringify(result || {}), error]
  );

  return res?.rows?.[0] || null;
}

export async function listWorkerControlRequests({
  tenant_id = null,
  wallet_id = null,
  status = null,
  limit = 20,
} = {}) {
  const ready = await ensureWorkerRuntimeTables();
  if (!ready) return null;

  const where = [];
  const params = [];

  if (tenant_id) {
    params.push(tenant_id);
    where.push(`tenant_id = $${params.length}`);
  }

  if (wallet_id) {
    params.push(wallet_id);
    where.push(`wallet_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }

  params.push(limit);
  const limitParam = `$${params.length}`;

  const res = await query(
    `SELECT *
     FROM worker_control_requests
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY created_at DESC
     LIMIT ${limitParam}`,
    params
  );

  return res?.rows || null;
}

export async function upsertWalletStorageSnapshot({
  tenant_id,
  wallet_id,
  store_key,
  content,
  metadata = {},
}) {
  const ready = await ensureWalletStorageSnapshotTable();
  if (!ready) return null;

  const res = await query(
    `INSERT INTO wallet_storage_snapshots (
      tenant_id, wallet_id, store_key, content, metadata, updated_at
    )
    VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,NOW())
    ON CONFLICT (tenant_id, wallet_id, store_key) DO UPDATE SET
      content = EXCLUDED.content,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING tenant_id, wallet_id, store_key, content, metadata, updated_at`,
    [
      tenant_id,
      wallet_id,
      store_key,
      JSON.stringify(content ?? {}),
      JSON.stringify(metadata || {}),
    ]
  );

  return res?.rows?.[0] || null;
}

export async function getWalletStorageSnapshot({
  tenant_id,
  wallet_id,
  store_key,
}) {
  const ready = await ensureWalletStorageSnapshotTable();
  if (!ready) return null;

  const res = await query(
    `SELECT tenant_id, wallet_id, store_key, content, metadata, updated_at
     FROM wallet_storage_snapshots
     WHERE tenant_id = $1 AND wallet_id = $2 AND store_key = $3`,
    [tenant_id, wallet_id, store_key]
  );

  return res?.rows?.[0] || null;
}

export async function getLatestWalletStorageSnapshot({
  store_key,
  tenant_id = null,
  wallet_id = null,
} = {}) {
  const ready = await ensureWalletStorageSnapshotTable();
  if (!ready) return null;

  const where = ["store_key = $1"];
  const params = [store_key];

  if (tenant_id) {
    params.push(tenant_id);
    where.push(`tenant_id = $${params.length}`);
  }

  if (wallet_id) {
    params.push(wallet_id);
    where.push(`wallet_id = $${params.length}`);
  }

  const res = await query(
    `SELECT tenant_id, wallet_id, store_key, content, metadata, updated_at
     FROM wallet_storage_snapshots
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC
     LIMIT 1`,
    params
  );

  return res?.rows?.[0] || null;
}

export async function listWalletStorageScopes() {
  const ready = await ensureWalletStorageSnapshotTable();
  if (!ready) return null;

  const res = await query(
    `SELECT tenant_id, wallet_id, MAX(updated_at) AS updated_at, COUNT(*) AS store_count
     FROM wallet_storage_snapshots
     GROUP BY tenant_id, wallet_id
     ORDER BY MAX(updated_at) DESC`
  );

  return res?.rows || null;
}
