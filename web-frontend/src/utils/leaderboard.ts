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
  isoDate: string; // ISO 8601 標準時間
}

const STORAGE_PREFIX = 'lawgic_lb_puzzle_';
const GLOBAL_INDEX_KEY = 'lawgic_lb_index';
const MAX_ENTRIES_PER_PUZZLE = 50;

export class LeaderboardManager {
  /**
   * 基於 IRT 難度、時間效率與提示懲罰的非線性計分模型
   */
  public static calculateScore(
    irtDifficulty: number,
    timeSpentSec: number,
    timeLimitSec: number,
    hintsUsed: number
  ): number {
    const safeIrt = Math.max(-3, Math.min(3.5, irtDifficulty));
    const base = Math.max(50, Math.round(100 + safeIrt * 40));
    
    // 時間非線性衰減加成
    const timeRatio = Math.max(0, Math.min(1, (timeLimitSec - timeSpentSec) / Math.max(1, timeLimitSec)));
    const speedBonus = Math.round(Math.pow(timeRatio, 1.2) * 60);
    
    // 提示懲罰階梯：第 1 階 15 分，後續階梯遞增
    const hintPenalty = hintsUsed <= 1 ? hintsUsed * 15 : 15 + (hintsUsed - 1) * 25;
    
    return Math.max(20, base + speedBonus - hintPenalty);
  }

  /**
   * 輕量級 64-bit 雙軌雜湊簽名 (防整數溢位與符號反轉)
   */
  public static generateSignature(
    checksum: string,
    points: number,
    time: number,
    hintsUsed: number
  ): string {
    const salt = 'LAWGIC_INTEGRITY_SALT_V2';
    const raw = `${checksum}:${points}:${time}:${hintsUsed}:${salt}`;

    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;

    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    // 強制轉為正整數 16 進位字串
    const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
    const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
    return `SIG_${part1}${part2}`.toUpperCase();
  }

  private static getStorageKey(checksum: string): string {
    // 截取前 24 碼作為儲存分區鍵值，防止 Key 過長
    return `${STORAGE_PREFIX}${checksum.slice(0, 24)}`;
  }

  /**
   * 獲取指定題目的排行榜紀錄（附帶嚴格完整性驗證）
   */
  public static getEntriesForPuzzle(checksum: string, pureOnly: boolean = false): LeaderboardEntry[] {
    if (!checksum) return [];
    try {
      const key = this.getStorageKey(checksum);
      const raw = localStorage.getItem(key);
      if (!raw) return [];

      const list: LeaderboardEntry[] = JSON.parse(raw);
      return list
        .filter((item) => {
          if (item.checksum !== checksum) return false;
          if (pureOnly && !item.isPure) return false;
          
          const expectedSig = this.generateSignature(
            item.checksum,
            item.points,
            item.timeSpentSec,
            item.hintsUsed ?? 0
          );
          return item.signature === expectedSig;
        })
        .sort((a, b) => b.points - a.points || a.timeSpentSec - b.timeSpentSec);
    } catch {
      return [];
    }
  }

  /**
   * 寫入成績並維護單題隔離儲存池
   */
  public static addEntry(
    checksum: string,
    entry: Omit<LeaderboardEntry, 'id' | 'checksum' | 'signature' | 'isoDate'>
  ): LeaderboardEntry {
    const key = this.getStorageKey(checksum);
    let list: LeaderboardEntry[] = [];
    
    try {
      const raw = localStorage.getItem(key);
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
      id: `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      signature,
      isoDate: new Date().toISOString(),
    };

    // 單題保留前 50 筆最高效成績，徹底擺脫全局 100 筆互相擠壓問題
    const updated = [...list, newRecord]
      .sort((a, b) => b.points - a.points || a.timeSpentSec - b.timeSpentSec)
      .slice(0, MAX_ENTRIES_PER_PUZZLE);

    try {
      localStorage.setItem(key, JSON.stringify(updated));
      
      // 更新全域已記錄題目索引清單
      const indexRaw = localStorage.getItem(GLOBAL_INDEX_KEY);
      const indexSet = new Set<string>(indexRaw ? JSON.parse(indexRaw) : []);
      indexSet.add(key);
      localStorage.setItem(GLOBAL_INDEX_KEY, JSON.stringify(Array.from(indexSet).slice(-200)));
    } catch {}

    return newRecord;
  }
}
