import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const MAX_LEADERBOARD_ENTRIES = 10;

// 3-12 characters: ASCII letters, digits, underscore, plus Unicode/Vietnamese letters
export const LEADERBOARD_NAME_RE = /^[\p{L}0-9_]{3,12}$/u;

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Formats a Date as ISO 8601 with local timezone offset (e.g. 2026-11-20T16:50:39+07:00).
 */
export function formatLocalIso(date = new Date()) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOff = Math.abs(offsetMinutes);
  const offHours = pad2(Math.floor(absOff / 60));
  const offMins = pad2(absOff % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offHours}:${offMins}`;
}

export function validateLeaderboardInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  if (typeof body.name !== "string") {
    return { ok: false, error: "name must be a string" };
  }
  const normalizedName = body.name.normalize("NFC");
  if (!LEADERBOARD_NAME_RE.test(normalizedName)) {
    return {
      ok: false,
      error: "name must be 3-12 characters using letters (including Vietnamese), digits, or _",
    };
  }

  if (typeof body.score !== "number" || !Number.isInteger(body.score) || body.score < 0) {
    return { ok: false, error: "score must be a non-negative integer" };
  }

  if (
    typeof body.nights_won !== "number" ||
    !Number.isInteger(body.nights_won) ||
    body.nights_won < 0 ||
    body.nights_won > 3
  ) {
    return { ok: false, error: "nights_won must be an integer between 0 and 3" };
  }

  if (typeof body.seed !== "number" || !Number.isSafeInteger(body.seed)) {
    return { ok: false, error: "seed must be a finite integer" };
  }

  return {
    ok: true,
    value: {
      name: normalizedName,
      score: body.score,
      nights_won: body.nights_won,
      seed: body.seed,
    },
  };
}

function compareEntries(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  const ta = Date.parse(a.achieved_at);
  const tb = Date.parse(b.achieved_at);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
    return ta - tb;
  }
  if (a.achieved_at < b.achieved_at) return -1;
  if (a.achieved_at > b.achieved_at) return 1;
  return 0;
}

export function sortAndTrimEntries(entries) {
  return [...entries].sort(compareEntries).slice(0, MAX_LEADERBOARD_ENTRIES);
}

export function readLeaderboard(filePath) {
  if (!existsSync(filePath)) {
    return { entries: [] };
  }
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
    return { entries: [] };
  }
  return { entries: sortAndTrimEntries(parsed.entries) };
}

export function writeLeaderboardAtomic(filePath, data) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmpPath, filePath);
}

export function addLeaderboardEntry(filePath, body, now = new Date()) {
  const validation = validateLeaderboardInput(body);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const current = readLeaderboard(filePath);
  const entry = {
    name: validation.value.name,
    score: validation.value.score,
    nights_won: validation.value.nights_won,
    achieved_at: formatLocalIso(now),
    seed: validation.value.seed,
  };

  const entries = sortAndTrimEntries([...current.entries, entry]);
  const nextData = { entries };
  writeLeaderboardAtomic(filePath, nextData);
  return { ok: true, entries };
}

export function exportLeaderboard(dataFilePath, outFilePath) {
  const data = readLeaderboard(dataFilePath);
  mkdirSync(dirname(outFilePath), { recursive: true });
  writeFileSync(outFilePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}
