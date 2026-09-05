// web-frontend/src/utils/vaultStorage.ts

export interface VaultItem {
  id: string;
  engine: string;
  tier: string;
  seed: number;
  rhythmType?: string;
  steps: number;
  timeSpentSec: number;
  iqScore?: number;
  edgeConnected?: boolean;
  date: string; // ISO 8601
}

export interface VaultFilter {
  tier?: string;
  rhythmType?: string;
  engine?: string;
  searchSeed?: number;
}

const VAULT_KEY = 'lawgic_legendary_vault';
const MAX_VAULT_CAPACITY = 250;

export class VaultManager {
  /**
   * 取得並過濾收藏題目
   */
  public static getVault(filter?: VaultFilter): VaultItem[] {
    try {
      const raw = localStorage.getItem(VAULT_KEY);
      let list: VaultItem[] = raw ? JSON.parse(raw) : [];

      if (filter) {
        if (filter.tier && filter.tier !== 'all') {
          list = list.filter((x) => x.tier.toLowerCase() === filter.tier!.toLowerCase());
        }
        if (filter.engine && filter.engine !== 'all') {
          list = list.filter((x) => x.engine.toLowerCase() === filter.engine!.toLowerCase());
        }
        if (filter.rhythmType && filter.rhythmType !== 'all') {
          list = list.filter((x) => x.rhythmType === filter.rhythmType);
        }
        if (filter.searchSeed !== undefined && !isNaN(filter.searchSeed)) {
          list = list.filter((x) => x.seed === filter.searchSeed);
        }
      }

      return list;
    } catch {
      return [];
    }
  }

  public static isFavorited(id: string): boolean {
    if (!id) return false;
    const list = this.getVault();
    return list.some((item) => item.id === id);
  }

  /**
   * 切換收藏狀態
   */
  public static toggleFavorite(item: VaultItem): boolean {
    const list = this.getVault();
    const idx = list.findIndex((x) => x.id === item.id);
    let isFav = false;

    if (idx >= 0) {
      list.splice(idx, 1);
      isFav = false;
    } else {
      const sanitizedItem: VaultItem = {
        ...item,
        date: item.date || new Date().toISOString(),
      };
      list.unshift(sanitizedItem);
      isFav = true;
    }

    try {
      localStorage.setItem(VAULT_KEY, JSON.stringify(list.slice(0, MAX_VAULT_CAPACITY)));
    } catch (e) {
      console.error('[VaultManager] Storage quota exceeded', e);
    }

    return isFav;
  }

  /**
   * 精準對齊的 Discord / 社群 ASCII 戰績卡（確保任何數據長度下邊框絕對筆直）
   */
  public static generateAsciiBadge(item: {
    engine: string;
    tier: string;
    seed: number;
    steps: number;
    timeSpentSec: number;
    iq: number;
    rhythm?: string;
  }): string {
    const CARD_INNER_WIDTH = 34; // 邊框內部標準字元寬度

    const padRow = (content: string): string => {
      const remaining = Math.max(0, CARD_INNER_WIDTH - content.length);
      return `║ ${content}${' '.repeat(remaining)} ║`;
    };

    const header = '   🏆  LAWGIC LEGENDARY CLEAR';
    const gameRow = `Game: ${item.engine.toUpperCase()}`;
    const tierSeedRow = `Tier: ${item.tier.toUpperCase()} | Seed: #${item.seed}`;
    const rhythmRow = `Rhythm: ${(item.rhythm || 'STANDARD').toUpperCase()} | 2-Edge`;
    const statsRow = `Steps: ${item.steps} | ${item.timeSpentSec}s | IQ: ${item.iq}`;

    const topBorder = `╔${'═'.repeat(CARD_INNER_WIDTH + 2)}╗`;
    const bottomBorder = `╚${'═'.repeat(CARD_INNER_WIDTH + 2)}╝`;

    return [
      topBorder,
      padRow(header),
      padRow(''),
      padRow(gameRow),
      padRow(tierSeedRow),
      padRow(rhythmRow),
      padRow(statsRow),
      bottomBorder,
    ].join('\n');
  }

  /**
   * 匯出收藏庫為 JSON 檔案
   */
  public static exportVaultJson(): string {
    const list = this.getVault();
    return JSON.stringify(
      {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        totalItems: list.length,
        items: list,
      },
      null,
      2
    );
  }

  /**
   * 匯入並合併收藏庫
   */
  public static importVaultJson(jsonStr: string): boolean {
    try {
      const parsed = JSON.parse(jsonStr);
      const incoming: VaultItem[] = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(incoming)) return false;

      const current = this.getVault();
      const map = new Map<string, VaultItem>();

      current.forEach((item) => map.set(item.id, item));
      incoming.forEach((item) => {
        if (item && item.id) map.set(item.id, item);
      });

      const merged = Array.from(map.values()).slice(0, MAX_VAULT_CAPACITY);
      localStorage.setItem(VAULT_KEY, JSON.stringify(merged));
      return true;
    } catch {
      return false;
    }
  }
}
