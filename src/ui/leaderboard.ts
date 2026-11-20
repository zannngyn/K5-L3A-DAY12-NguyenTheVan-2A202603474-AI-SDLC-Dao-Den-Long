export interface LeaderboardEntry {
  name: string;
  score: number;
  nights_won: number;
  achieved_at: string;
  seed: number;
}

export type LeaderboardStore = "server" | "local";

export interface LeaderboardLoadResult {
  entries: LeaderboardEntry[];
  store: LeaderboardStore;
}

export interface LeaderboardSubmitResult {
  ok: boolean;
  entries: LeaderboardEntry[];
  store: LeaderboardStore;
  error?: string;
}

const LOCAL_STORAGE_KEY = "dao_den_long_leaderboard_v1";
const MAX_ENTRIES = 10;

// 3-12 chars: A-Za-z0-9_ plus Vietnamese Latin letters (diacritics)
const NAME_PATTERN = /^[A-Za-z0-9_\u00C0-\u024F\u1E00-\u1EFF]{3,12}$/;

export function validateLeaderboardName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) {
    return "Vui lòng nhập tên (3–12 ký tự).";
  }
  if (name.length < 3) {
    return "Tên phải có ít nhất 3 ký tự.";
  }
  if (name.length > 12) {
    return "Tên tối đa 12 ký tự.";
  }
  if (!NAME_PATTERN.test(name)) {
    return "Chỉ cho phép chữ cái (có dấu tiếng Việt), số và dấu gạch dưới (_).";
  }
  return null;
}

export function formatLocalIsoTimestamp(date = new Date()): string {
  const pad = (n: number): string => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const tzMin = -date.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-";
  const tzH = pad(tzMin / 60);
  const tzM = pad(tzMin % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${tzH}:${tzM}`
  );
}

export function formatEntryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10) || "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function sortAndTrimEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.achieved_at.localeCompare(b.achieved_at);
    })
    .slice(0, MAX_ENTRIES);
}

function readLocalEntries(): LeaderboardEntry[] {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
        ? (parsed as { entries: unknown[] }).entries
        : [];
    const valid: LeaderboardEntry[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Partial<LeaderboardEntry>;
      if (
        typeof obj.name === "string" &&
        typeof obj.score === "number" &&
        typeof obj.nights_won === "number" &&
        typeof obj.achieved_at === "string"
      ) {
        valid.push({
          name: obj.name,
          score: Math.max(0, Math.floor(obj.score)),
          nights_won: Math.min(3, Math.max(0, Math.floor(obj.nights_won))),
          achieved_at: obj.achieved_at,
          seed: typeof obj.seed === "number" ? obj.seed : 0,
        });
      }
    }
    return sortAndTrimEntries(valid);
  } catch {
    return [];
  }
}

function writeLocalEntries(entries: LeaderboardEntry[]): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ entries }));
  } catch {
    // Ignore storage errors
  }
}

export async function fetchLeaderboard(): Promise<LeaderboardLoadResult> {
  try {
    const res = await fetch("/api/leaderboard", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { entries?: LeaderboardEntry[] };
      if (Array.isArray(data.entries)) {
        return {
          entries: sortAndTrimEntries(data.entries),
          store: "server",
        };
      }
    }
  } catch {
    // Fall back to localStorage below
  }
  return {
    entries: readLocalEntries(),
    store: "local",
  };
}

export async function submitLeaderboardEntry(payload: {
  name: string;
  score: number;
  nights_won: number;
  seed: number;
}): Promise<LeaderboardSubmitResult> {
  const trimmedName = payload.name.trim();
  const validationError = validateLeaderboardName(trimmedName);
  if (validationError) {
    return { ok: false, entries: [], store: "local", error: validationError };
  }

  const cleanPayload = {
    name: trimmedName,
    score: Math.max(0, Math.floor(payload.score)),
    nights_won: Math.min(3, Math.max(0, Math.floor(payload.nights_won))),
    seed: Math.floor(payload.seed),
  };

  try {
    const res = await fetch("/api/leaderboard", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(cleanPayload),
    });
    if (res.status === 400) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        entries: [],
        store: "server",
        error: errData.error || "Tên hoặc dữ liệu không hợp lệ.",
      };
    }
    if (res.ok) {
      const data = (await res.json()) as { entries?: LeaderboardEntry[] };
      if (Array.isArray(data.entries)) {
        return {
          ok: true,
          entries: sortAndTrimEntries(data.entries),
          store: "server",
        };
      }
    }
  } catch {
    // Fall back to localStorage below
  }

  const nextEntries = sortAndTrimEntries([
    ...readLocalEntries(),
    {
      ...cleanPayload,
      achieved_at: formatLocalIsoTimestamp(),
    },
  ]);
  writeLocalEntries(nextEntries);
  return {
    ok: true,
    entries: nextEntries,
    store: "local",
  };
}

export function describeStore(store: LeaderboardStore): string {
  return store === "server"
    ? "Máy chủ cục bộ (data/leaderboard.json)"
    : "Trình duyệt (localStorage)";
}
