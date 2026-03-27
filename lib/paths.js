import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PATH_SEGMENT_PATTERN = /[^a-zA-Z0-9._-]+/g;

export const REPO_ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const LOG_DIR = path.join(REPO_ROOT, "logs");
export const USER_CONFIG_PATH = path.join(REPO_ROOT, "user-config.json");

export function repoPath(...segments) {
  return path.join(REPO_ROOT, ...segments);
}

export function dataPath(...segments) {
  return path.join(DATA_DIR, ...segments);
}

export function sanitizePathSegment(value, fallback = "default") {
  const normalized = String(value ?? "").trim().replace(PATH_SEGMENT_PATTERN, "-");
  const cleaned = normalized.replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

export function tenantDataDir(tenantId = "local") {
  return dataPath("tenants", sanitizePathSegment(tenantId, "local"));
}

export function walletDataDir({ tenantId = "local", walletId = "primary" } = {}) {
  return path.join(
    tenantDataDir(tenantId),
    "wallets",
    sanitizePathSegment(walletId, "primary")
  );
}

export function walletDataPath(context = {}, ...segments) {
  return path.join(walletDataDir(context), ...segments);
}
