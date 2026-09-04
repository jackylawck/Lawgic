// web-frontend/src/utils/vaultStorage.ts

export interface VaultItem {
  id: string;
  engine: string;
  tier: string;
  seed: number;
  rhythmType?: string;
  steps: number;
  timeSpentSec?: number;
  iqScore?: number;
  edgeConnected?: boolean;
  date: string;
}

const VAULT_KEY = 'lawgic_legendary_vault';

export class VaultManager {
  public static getVault(filter?: { tier?: string; rhythmType?: string }): VaultItem[] {
    try {
      const raw = localStorage.getItem(VAULT_KEY);
      let list: VaultItem[] = raw ? JSON.parse(raw) : [];
      if (filter?.tier && filter.tier !== 'all') {
        list = list.filter((x) => x.tier === filter.tier);
      }
      if (filter?.rhythmType && filter.rhythmType !== 'all') {
        list = list.filter((x) => x.rhythmType === filter.rhythmType);
      }
      return list;
    } catch {
      return [];
    }
  }

  public static isFavorited(id: string): boolean {
    const list = this.getVault();
    return list.some((item) => item.id === id);
  }

  public static toggleFavorite(item: VaultItem): boolean {
    const list = this.getVault();
    const idx = list.findIndex((x) => x.id === item.id);
    let isFav = false;

    if (idx >= 0) {
      list.splice(idx, 1);
      isFav = false;
    } else {
      list.unshift(item);
      isFav = true;
    }

    try {
      localStorage.setItem(VAULT_KEY, JSON.stringify(list.slice(0, 100)));
    } catch {}

    return isFav;
  }

  // 生成純前端 Discord / 社群 ASCII 戰績卡
  public static generateAsciiBadge(item: {
    engine: string;
    tier: string;
    seed: number;
    steps: number;
    timeSpentSec: number;
    iq: number;
    rhythm: string;
  }): string {
    return [
      '╔═════════════════════════════════╗',
      `║   🏆  LAWGIC LEGENDARY CLEAR    ║`,
      `║   Game: ${item.engine.toUpperCase().padEnd(24)}║`,
      `║   Tier: ${item.tier.toUpperCase().padEnd(10)} Seed: #${String(item.seed).padEnd(8)}║`,
      `║   Rhythm: ${item.rhythm.toUpperCase().padEnd(9)} Topology: 2-Edge║`,
      `║   Steps: ~${String(item.steps).padEnd(3)} | Time: ${String(item.timeSpentSec)}s | IQ: ${item.iq} ║`,
      '╚═════════════════════════════════╝',
    ].join('\n');
  }
}
