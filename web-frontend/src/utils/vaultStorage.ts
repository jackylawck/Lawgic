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
  challengeUrl?: string;
}

export interface VaultFilter {
  tier?: string;
  rhythmType?: string;
  engine?: string;
  searchSeed?: number;
  sortBy?: 'date_desc' | 'date_asc' | 'time_asc' | 'iq_desc';
}

export interface VaultStatsSummary {
  totalCount: number;
  avgTimeSec: number;
  avgIqScore: number;
  favoriteEngine: string;
  tierDistribution: Record<string, number>;
}

const VAULT_KEY = 'logicore_legendary_vault_v3';
const MAX_VAULT_CAPACITY = 300;

export class VaultManager {
  /**
   * 計算 East Asian 文字與 Emoji 的等寬字元物理渲染寬度
   */
  private static getCharWidth(char: string): number {
    const code = char.codePointAt(0);
    if (!code) return 1;

    // 常見 Emoji 與全角字元 Unicode 區段
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) || // Misc Symbols & Pictographs
      (code >= 0x1f680 && code <= 0x1f6ff) || // Transport & Map
      (code >= 0x2600 && code <= 0x26ff)   || // Misc Symbols
      (code >= 0x2700 && code <= 0x27bf)      // Dingbats
    ) {
      return 2;
    }
    return 1;
  }

  /**
   * 取得字串真實等寬顯示寬度
   */
  public static getStringDisplayWidth(str: string): number {
    let width = 0;
    // 透過 Array.from 精準拆解 Unicode 代理對 (Surrogate Pairs)
    for (const char of Array.from(str)) {
      width += this.getCharWidth(char);
    }
    return width;
  }

  /**
   * 生成可直接載入指定謎題的 Challenge Deep Link
   */
  public static generateChallengeLink(engine: string, tier: string, seed: number): string {
    const origin = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : 'https://logicore.app';
    const payload = `${engine.toLowerCase()}:${tier.toLowerCase()}:${seed}`;
    const token = btoa(payload).replace(/=/g, '');
    return `${origin}#c=${token}`;
  }

  /**
   * 取得並過濾、排序收藏題目
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

        // 智慧排序
        if (filter.sortBy) {
          switch (filter.sortBy) {
            case 'date_asc':
              list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
              break;
            case 'time_asc':
              list.sort((a, b) => a.timeSpentSec - b.timeSpentSec);
              break;
            case 'iq_desc':
              list.sort((a, b) => (b.iqScore || 100) - (a.iqScore || 100));
              break;
            case 'date_desc':
            default:
              list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
              break;
          }
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
   * 切換收藏狀態（自動補齊挑戰深層連結與時間戳）
   */
  public static toggleFavorite(item: VaultItem): boolean {
    const list = this.getVault();
    const idx = list.findIndex((x) => x.id === item.id);
    let isFav = false;

    if (idx >= 0) {
      list.splice(idx, 1);
      isFav = false;
    } else {
      const challengeUrl = item.challengeUrl || this.generateChallengeLink(item.engine, item.tier, item.seed);
      const sanitizedItem: VaultItem = {
        ...item,
        challengeUrl,
        date: item.date || new Date().toISOString(),
      };
      list.unshift(sanitizedItem);
      isFav = true;
    }

    try {
      localStorage.setItem(VAULT_KEY, JSON.stringify(list.slice(0, MAX_VAULT_CAPACITY)));
      this.dispatchVaultChangeEvent();
    } catch (e) {
      console.error('[VaultManager] Storage quota exceeded', e);
    }

    return isFav;
  }

  /**
   * 聚合金庫數據概覽
   */
  public static getVaultSummary(): VaultStatsSummary {
    const list = this.getVault();
    if (list.length === 0) {
      return {
        totalCount: 0,
        avgTimeSec: 0,
        avgIqScore: 100,
        favoriteEngine: 'None',
        tierDistribution: {},
      };
    }

    let totalTime = 0;
    let totalIq = 0;
    const engineCount: Record<string, number> = {};
    const tierDistribution: Record<string, number> = {};

    list.forEach((item) => {
      totalTime += item.timeSpentSec;
      totalIq += item.iqScore || 100;
      engineCount[item.engine] = (engineCount[item.engine] || 0) + 1;
      tierDistribution[item.tier] = (tierDistribution[item.tier] || 0) + 1;
    });

    const favoriteEngine = Object.entries(engineCount).sort((a, b) => b[1] - a[1])[0][0];

    return {
      totalCount: list.length,
      avgTimeSec: Math.round(totalTime / list.length),
      avgIqScore: Math.round(totalIq / list.length),
      favoriteEngine,
      tierDistribution,
    };
  }

  /**
   * 幾何精確對齊的 Discord / Terminal ASCII 戰績卡
   * （透過東亞字寬演算法，徹底消弭 Emoji 與漢字造成的邊框扭曲）
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
    const CARD_INNER_WIDTH = 38; // 邊框內部標準字元寬度

    const padRow = (content: string): string => {
      const realWidth = VaultManager.getStringDisplayWidth(content);
      const remaining = Math.max(0, CARD_INNER_WIDTH - realWidth);
      return `║ ${content}${' '.repeat(remaining)} ║`;
    };

    const header = '🏆 LOGICORE CERTIFIED RECORD';
    const gameRow = `Game: ${item.engine.toUpperCase()}`;
    const tierSeedRow = `Tier: ${item.tier.toUpperCase()} | Seed: #${item.seed}`;
    const rhythmRow = `Rhythm: ${(item.rhythm || 'STANDARD').toUpperCase()} | Topology Verified`;
    const statsRow = `Steps: ${item.steps} | ${item.timeSpentSec}s | IQ: ${item.iq}`;
    const linkRow = `Link: logicore.app/#c=${item.engine.slice(0, 3)}:${item.seed}`;

    const topBorder = `╔${'═'.repeat(CARD_INNER_WIDTH + 2)}╗`;
    const bottomBorder = `╚${'═'.repeat(CARD_INNER_WIDTH + 2)}╝`;
    const divider = `╟${'─'.repeat(CARD_INNER_WIDTH + 2)}╢`;

    return [
      topBorder,
      padRow(header),
      divider,
      padRow(gameRow),
      padRow(tierSeedRow),
      padRow(rhythmRow),
      padRow(statsRow),
      padRow(linkRow),
      bottomBorder,
    ].join('\n');
  }

  /**
   * 匯出金庫為規範化 JSON 封包
   */
  public static exportVaultJson(): string {
    const list = this.getVault();
    const summary = this.getVaultSummary();
    return JSON.stringify(
      {
        $schema: 'https://logicore.app/schemas/vault-v3.json',
        version: '3.0',
        exportedAt: new Date().toISOString(),
        summary,
        items: list,
      },
      null,
      2
    );
  }

  /**
   * 具備嚴格結構與數值防禦的 JSON 匯入
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
        // 嚴格結構防禦：過濾缺少核心屬性或包含非法負數的畸形項目
        if (
          item &&
          typeof item.id === 'string' &&
          typeof item.engine === 'string' &&
          typeof item.seed === 'number' &&
          typeof item.timeSpentSec === 'number' &&
          item.timeSpentSec > 0
        ) {
          const sanitized: VaultItem = {
            id: item.id,
            engine: item.engine.toLowerCase(),
            tier: (item.tier || 'kids').toLowerCase(),
            seed: item.seed,
            steps: Math.max(0, item.steps || 0),
            timeSpentSec: Math.round(item.timeSpentSec),
            iqScore: Math.min(180, Math.max(60, item.iqScore || 100)),
            rhythmType: item.rhythmType,
            edgeConnected: item.edgeConnected,
            date: item.date || new Date().toISOString(),
            challengeUrl: item.challengeUrl || this.generateChallengeLink(item.engine, item.tier || 'kids', item.seed),
          };
          map.set(item.id, sanitized);
        }
      });

      const merged = Array.from(map.values()).slice(0, MAX_VAULT_CAPACITY);
      localStorage.setItem(VAULT_KEY, JSON.stringify(merged));
      this.dispatchVaultChangeEvent();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 廣播跨組件與跨分頁金庫同步事件
   */
  private static dispatchVaultChangeEvent() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('logicore:vault-updated'));
    }
  }
}
