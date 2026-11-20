export interface LeaderboardEntry {
  name: string;
  score: number;
  nights_won: number;
  achieved_at: string;
  seed: number;
}

export interface LeaderboardData {
  entries: LeaderboardEntry[];
}

export interface LeaderboardInput {
  name: unknown;
  score: unknown;
  nights_won: unknown;
  seed: unknown;
}

export type ValidationResult =
  | {
      ok: true;
      value: {
        name: string;
        score: number;
        nights_won: number;
        seed: number;
      };
    }
  | {
      ok: false;
      error: string;
    };

export type AddEntryResult =
  | {
      ok: true;
      entries: LeaderboardEntry[];
    }
  | {
      ok: false;
      error: string;
    };

export declare const MAX_LEADERBOARD_ENTRIES: number;
export declare const LEADERBOARD_NAME_RE: RegExp;
export declare function formatLocalIso(date?: Date): string;
export declare function validateLeaderboardInput(body: unknown): ValidationResult;
export declare function sortAndTrimEntries(entries: LeaderboardEntry[]): LeaderboardEntry[];
export declare function readLeaderboard(filePath: string): LeaderboardData;
export declare function writeLeaderboardAtomic(filePath: string, data: LeaderboardData): void;
export declare function addLeaderboardEntry(
  filePath: string,
  body: unknown,
  now?: Date,
): AddEntryResult;
export declare function exportLeaderboard(
  dataFilePath: string,
  outFilePath: string,
): LeaderboardData;
