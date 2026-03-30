import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function migrateLegacyFile(legacyPath, targetPath) {
  if (!fs.existsSync(legacyPath) || fs.existsSync(targetPath)) return;
  try {
    fs.renameSync(legacyPath, targetPath);
  } catch {
    fs.copyFileSync(legacyPath, targetPath);
    fs.unlinkSync(legacyPath);
  }
}

export function getDataFilePath(fileName) {
  ensureDataDir();
  const targetPath = path.join(DATA_DIR, fileName);
  const legacyPath = path.join(ROOT_DIR, fileName);
  migrateLegacyFile(legacyPath, targetPath);
  return targetPath;
}