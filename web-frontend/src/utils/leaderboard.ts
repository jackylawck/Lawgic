// web-frontend/src/utils/leaderboard.ts

export interface LeaderboardEntry {
  id: string;
  checksum: string;
  nickname: string;
  engine: string;
  tier: string;
  timeSpentSec: number;
  points: number;
  hintsUsed: number;
  isPure: boolean;
  signature: string;
  date: string;
}

const STORAGE_KEY = 'lawgic_per_puzzle_records';

export class LeaderboardManager {
  public static calculateScore(
    irtDifficulty: number,
    timeSpentSec: number,
    timeLimitSec: number,
    hintsUsed: number
  ): number {
    const base = Math.max(50, Math.round(100 + irtDifficulty * 40));
    const speedRatio = Math.max(0, (timeLimitSec - timeSpentSec) / timeLimitSec);
    const speedBonus = Math.round(speedRatio * 50);
    const penalty = hintsUsed * 15;
    return Math.max(30, base + speedBonus - penalty);
  }

  public static generateSignature(
    checksum: string,
    points: number,
    time: number,
    hintsUsed: number
  ): string {
    const salt = 'LAWGIC_PURITY_SALT_2026';
    let hash = 0;
    const raw = `${checksum}:${points}:${time}:${hintsUsed}:${salt}`;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  public static getEntriesForPuzzle(checksum: string, pureOnly: boolean = false): LeaderboardEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const list: LeaderboardEntry[] = JSON.parse(raw);
      return list
        .filter((item) => {
          if (item.checksum !== checksum) return false;
          if (pureOnly && !item.isPure) return false;
          return (
            item.signature ===
            this.generateSignature(item.checksum, item.points, item.timeSpentSec, item.hintsUsed ?? 0)
          );
        })
        .sort((a, b) => b.points - a.points || a.timeSpentSec - b.timeSpentSec);
    } catch {
      return [];
    }
  }

  public static addEntry(
    checksum: string,
    entry: Omit<LeaderboardEntry, 'id' | 'checksum' | 'signature' | 'date'>
  ): LeaderboardEntry {
    let list: LeaderboardEntry[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) list = JSON.parse(raw);
    } catch {}

    const signature = this.generateSignature(
      checksum,
      entry.points,
      entry.timeSpentSec,
      entry.hintsUsed
    );
    const newRecord: LeaderboardEntry = {
      ...entry,
      checksum,
      id: `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      signature,
      date: new Date().toLocaleDateString(),
    };

    const updated = [...list, newRecord].slice(-100);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {}

    return newRecord;
  }
}
