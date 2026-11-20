import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addLeaderboardEntry,
  exportLeaderboard,
  formatLocalIso,
  readLeaderboard,
  validateLeaderboardInput,
} from "../scripts/leaderboard.mjs";

describe("Leaderboard module (scripts/leaderboard.mjs)", () => {
  let workDir: string;
  let dataFile: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "ddl-lb-test-"));
    dataFile = join(workDir, "data", "leaderboard.json");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("validates names (3-12 chars, ASCII/digits/underscore + Vietnamese diacritics) and rejects invalid inputs", () => {
    expect(validateLeaderboardInput({ name: "May_01", score: 1200, nights_won: 3, seed: 42 }).ok).toBe(true);
    expect(validateLeaderboardInput({ name: "Mây", score: 500, nights_won: 1, seed: 7 }).ok).toBe(true);
    expect(validateLeaderboardInput({ name: "ÁnhĐèn_99", score: 900, nights_won: 2, seed: 1 }).ok).toBe(true);
    expect(validateLeaderboardInput({ name: "ABCDEFGHIJKL", score: 0, nights_won: 0, seed: 1 }).ok).toBe(true);

    // Too short / too long / bad chars
    expect(validateLeaderboardInput({ name: "ab", score: 100, nights_won: 1, seed: 1 }).ok).toBe(false);
    expect(validateLeaderboardInput({ name: "ABCDEFGHIJKLM", score: 100, nights_won: 1, seed: 1 }).ok).toBe(false);
    expect(validateLeaderboardInput({ name: "Bad Name", score: 100, nights_won: 1, seed: 1 }).ok).toBe(false);
    expect(validateLeaderboardInput({ name: "bad-name", score: 100, nights_won: 1, seed: 1 }).ok).toBe(false);
    expect(validateLeaderboardInput({ name: "bad!", score: 100, nights_won: 1, seed: 1 }).ok).toBe(false);

    // Invalid score / nights_won / seed
    expect(validateLeaderboardInput({ name: "May", score: -1, nights_won: 1, seed: 1 }).ok).toBe(false);
    expect(validateLeaderboardInput({ name: "May", score: 10.5, nights_won: 1, seed: 1 }).ok).toBe(false);
    expect(validateLeaderboardInput({ name: "May", score: 100, nights_won: 4, seed: 1 }).ok).toBe(false);
    expect(validateLeaderboardInput({ name: "May", score: 100, nights_won: -1, seed: 1 }).ok).toBe(false);
    expect(validateLeaderboardInput({ name: "May", score: 100, nights_won: 1, seed: 1.5 }).ok).toBe(false);
  });

  it("formats achieved_at as ISO 8601 with local timezone offset", () => {
    const iso = formatLocalIso(new Date("2026-11-20T10:00:00Z"));
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it("sorts by score desc, breaks ties by earlier achieved_at first, caps at top 10, and persists atomically", () => {
    const baseTime = Date.parse("2026-11-20T01:00:00Z");

    // Add 12 entries including a score tie
    addLeaderboardEntry(dataFile, { name: "TieLate", score: 500, nights_won: 2, seed: 2 }, new Date(baseTime + 20_000));
    addLeaderboardEntry(dataFile, { name: "TieEarly", score: 500, nights_won: 2, seed: 1 }, new Date(baseTime + 10_000));
    for (let i = 1; i <= 10; i++) {
      addLeaderboardEntry(
        dataFile,
        { name: `Player_${i}`, score: i * 100, nights_won: Math.min(3, i % 4), seed: 100 + i },
        new Date(baseTime + i * 1000),
      );
    }

    expect(existsSync(dataFile)).toBe(true);
    const loaded = readLeaderboard(dataFile);
    expect(loaded.entries).toHaveLength(10);

    // Highest score first (1000 down to 300, with 500 appearing 3 times)
    expect(loaded.entries[0].name).toBe("Player_10");
    expect(loaded.entries[0].score).toBe(1000);

    // Check tie order for score === 500: Player_5 (t+5s) < TieEarly (t+10s) < TieLate (t+20s)
    const fiveHundreds = loaded.entries.filter((e: { score: number }) => e.score === 500).map((e: { name: string }) => e.name);
    expect(fiveHundreds).toEqual(["Player_5", "TieEarly", "TieLate"]);

    // Lowest scores (100, 200) trimmed out
    expect(loaded.entries.some((e: { score: number }) => e.score <= 200)).toBe(false);
  });

  it("exports empty {\"entries\":[]} when missing and sorted entries when populated via both API and play.mjs CLI", () => {
    const emptyOut = join(workDir, "empty.json");
    const exportedEmpty = exportLeaderboard(dataFile, emptyOut);
    expect(exportedEmpty).toEqual({ entries: [] });
    expect(JSON.parse(readFileSync(emptyOut, "utf8"))).toEqual({ entries: [] });

    // CLI --export-leaderboard on empty data dir
    const cliEmptyOut = join(workDir, "cli-empty.json");
    const resEmpty = spawnSync(
      "node",
      ["scripts/play.mjs", "--data-dir", join(workDir, "data"), "--export-leaderboard", cliEmptyOut],
      { encoding: "utf8" },
    );
    expect(resEmpty.status).toBe(0);
    expect(JSON.parse(readFileSync(cliEmptyOut, "utf8"))).toEqual({ entries: [] });

    // Populate and export via CLI
    addLeaderboardEntry(dataFile, { name: "Alpha", score: 300, nights_won: 1, seed: 7 });
    addLeaderboardEntry(dataFile, { name: "Beta", score: 800, nights_won: 3, seed: 9 });

    const cliPopOut = join(workDir, "cli-pop.json");
    execFileSync("node", [
      "scripts/play.mjs",
      "--data-dir",
      join(workDir, "data"),
      "--export-leaderboard",
      cliPopOut,
    ]);
    const parsed = JSON.parse(readFileSync(cliPopOut, "utf8"));
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries.map((e: { name: string }) => e.name)).toEqual(["Beta", "Alpha"]);
  });
});
