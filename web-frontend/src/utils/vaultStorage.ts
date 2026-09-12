// web-frontend/src/utils/vaultStorage.ts

export interface VaultItem {
  readonly id: string;
  readonly engine: string;
  readonly tier: string;
  readonly seed: number;
  readonly rhythmType?: string;
  readonly steps: number;
  readonly timeSpentSec: number;
  readonly iqScore?: number;
  readonly edgeConnected?: boolean;
  readonly date: string; // ISO 8601
  readonly challengeUrl?: string;
}

export interface VaultFilter {
  readonly tier?: string;
  readonly rhythmType?: string;
  readonly engine?: string;
  readonly searchSeed?: number;
  readonly sortBy?: 'date_desc' | 'date_asc' | 'time_asc' | 'iq_desc';
}

export interface VaultStatsSummary {
  readonly totalCount: number;
  readonly avgTimeSec: number;
  readonly avgIqScore: number;
  readonly favoriteEngine: string;
  readonly tierDistribution: Record<string, number>;
}

export interface ToggleFavoriteResult {
  readonly success: boolean;
  readonly isFav: boolean;
  readonly error?: 'InvalidInput' | 'StorageQuotaExceeded';
}

export interface ImportVaultResult {
  readonly success: boolean;
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly error?: 'InvalidFormat' | 'StorageQuotaExceeded';
}

export interface VaultLogger {
  warn(message: string, context?: unknown): void;
  error?(message: string, context?: unknown): void;
}

const VAULT_KEY = 'logicore_legendary_vault_v3';
const MAX_VAULT_CAPACITY = 300;
const MAX_ID_LENGTH = 128;
const VAULT_BROADCAST_CHANNEL = 'logicore:vault-updated';
const DEFAULT_LOGGER: VaultLogger = console;

export class VaultManager {
  private static broadcastChannel: BroadcastChannel | null = null;
  private static isBroadcastInitialized = false;
  private static logger: VaultLogger = DEFAULT_LOGGER;

  private static vaultCache: readonly VaultItem[] | null = null;
  private static idSetCache: Set<string> | null = null;

  public static setLogger(customLogger: VaultLogger): void {
    this.logger = customLogger;
  }

  private static ensureBroadcastInitialized(): void {
    if (this.isBroadcastInitialized) return;

    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      this.isBroadcastInitialized = true;
      return;
    }

    try {
      this.broadcastChannel = new BroadcastChannel('logicore:vault');
      this.broadcastChannel.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'update') {
          this.invalidateCache();
          window.dispatchEvent(new CustomEvent(VAULT_BROADCAST_CHANNEL));
        }
      });
      this.isBroadcastInitialized = true;
    } catch {
      this.broadcastChannel = null;
    }
  }

  private static invalidateCache(): void {
    this.vaultCache = null;
    this.idSetCache = null;
  }

  public static isSafeUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();

    if (trimmed.startsWith('#')) {
      return true;
    }
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
      return true;
    }

    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  private static getCharWidth(char: string): number {
    const code = char.codePointAt(0);
    if (!code) return 0;

    if (code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef)) {
      return 0;
    }

    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x1f680 && code <= 0x1f6ff) ||
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x2700 && code <= 0x27bf)
    ) {
      return 2;
    }
    return 1;
  }

  public static getStringDisplayWidth(str: string): number {
    if (!str) return 0;
    let width = 0;
    for (const char of Array.from(str)) {
      width += this.getCharWidth(char);
    }
    return width;
  }

  private static utf8ToBase64(str: string): string {
    if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
      const bytes = new TextEncoder().encode(str);
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    }
    return Buffer.from(str, 'utf-8').toString('base64');
  }

  public static generateChallengeLink(engine: string, tier: string, seed: number): string {
    if (!Number.isFinite(seed)) {
      this.logger.warn('[VaultManager] Non-finite seed provided in generateChallengeLink', { seed });
      seed = 0;
    }

    const origin = typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : 'https://logicore.app';

    const safeEngine = typeof engine === 'string' ? engine.trim().toLowerCase() : 'sudoku';
    const safeTier = typeof tier === 'string' ? tier.trim().toLowerCase() : 'kids';
    const payload = `${encodeURIComponent(safeEngine)}:${encodeURIComponent(safeTier)}:${Math.floor(seed)}`;
    const token = this.utf8ToBase64(payload).replace(/=/g, '');

    return `${origin}#c=${token}`;
  }

  private static loadVault(): readonly VaultItem[] {
    if (this.vaultCache) {
      return this.vaultCache;
    }

    try {
      const raw = localStorage.getItem(VAULT_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        this.vaultCache = Object.freeze([]);
        return this.vaultCache;
      }

      const deeplyFrozen = parsed.map((item) => Object.freeze({ ...item }));
      this.vaultCache = Object.freeze(deeplyFrozen);
      return this.vaultCache;
    } catch (e) {
      this.logger.warn('[VaultManager] Failed to read or parse vault from storage', e);
      return Object.freeze([]);
    }
  }

  public static getVault(filter?: VaultFilter): readonly VaultItem[] {
    const rawList = this.loadVault();
    let list: VaultItem[] = [...rawList];

    if (filter) {
      if (filter.tier && filter.tier !== 'all') {
        const t = filter.tier.toLowerCase();
        list = list.filter((x) => x.tier.toLowerCase() === t);
      }
      if (filter.engine && filter.engine !== 'all') {
        const e = filter.engine.toLowerCase();
        list = list.filter((x) => x.engine.toLowerCase() === e);
      }
      if (filter.rhythmType && filter.rhythmType !== 'all') {
        list = list.filter((x) => x.rhythmType === filter.rhythmType);
      }
      if (filter.searchSeed !== undefined && Number.isFinite(filter.searchSeed)) {
        list = list.filter((x) => x.seed === filter.searchSeed);
      }

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

    return Object.freeze(list.map((item) => Object.freeze({ ...item })));
  }

  public static isFavorited(id: string): boolean {
    if (!id || typeof id !== 'string') return false;
    if (!this.idSetCache) {
      this.idSetCache = new Set(this.loadVault().map((x) => x.id));
    }
    return this.idSetCache.has(id);
  }

  public static toggleFavorite(item: VaultItem): ToggleFavoriteResult {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > MAX_ID_LENGTH) {
      return { success: false, isFav: false, error: 'InvalidInput' };
    }
    if (
      typeof item.engine !== 'string' ||
      !item.engine.trim() ||
      item.engine === '__proto__' ||
      item.engine === 'constructor' ||
      item.engine === 'prototype'
    ) {
      return { success: false, isFav: false, error: 'InvalidInput' };
    }
    if (
      typeof item.tier === 'string' &&
      (item.tier === '__proto__' || item.tier === 'constructor' || item.tier === 'prototype')
    ) {
      return { success: false, isFav: false, error: 'InvalidInput' };
    }

    const rawList = this.loadVault();
    const list: VaultItem[] = [...rawList];
    const idx = list.findIndex((x) => x.id === item.id);
    let targetIsFav = false;

    if (idx >= 0) {
      list.splice(idx, 1);
      targetIsFav = false;
    } else {
      const rawUrl = item.challengeUrl;
      const challengeUrl = rawUrl && this.isSafeUrl(rawUrl)
        ? rawUrl
        : this.generateChallengeLink(item.engine, item.tier || 'kids', item.seed);

      const sanitizedItem: VaultItem = Object.freeze({
        ...item,
        engine: item.engine.toLowerCase(),
        tier: (item.tier && typeof item.tier === 'string' ? item.tier : 'kids').toLowerCase(),
        steps: Math.max(0, Number.isFinite(item.steps) ? Math.floor(item.steps) : 0),
        timeSpentSec: Math.max(0, Number.isFinite(item.timeSpentSec) ? Math.round(item.timeSpentSec) : 0),
        iqScore: Math.min(180, Math.max(60, Number.isFinite(item.iqScore) ? Math.round(item.iqScore!) : 100)),
        challengeUrl,
        date: item.date && !isNaN(new Date(item.date).getTime()) ? item.date : new Date().toISOString(),
      });
      list.unshift(sanitizedItem);
      targetIsFav = true;
    }

    try {
      localStorage.setItem(VAULT_KEY, JSON.stringify(list.slice(0, MAX_VAULT_CAPACITY)));
      this.invalidateCache();
      this.dispatchVaultChangeEvent();
      return { success: true, isFav: targetIsFav };
    } catch (e) {
      this.logger.warn('[VaultManager] Storage quota exceeded while toggling favorite', e);
      return { success: false, isFav: !targetIsFav, error: 'StorageQuotaExceeded' };
    }
  }

  public static getVaultSummary(): VaultStatsSummary {
    const list = this.loadVault();
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
    const engineCount: Record<string, number> = Object.create(null);
    const tierDistribution: Record<string, number> = Object.create(null);

    list.forEach((item) => {
      totalTime += item.timeSpentSec;
      totalIq += item.iqScore || 100;
      engineCount[item.engine] = (engineCount[item.engine] || 0) + 1;
      tierDistribution[item.tier] = (tierDistribution[item.tier] || 0) + 1;
    });

    const sortedEngines = Object.entries(engineCount).sort((a, b) => b[1] - a[1]);
    const favoriteEngine = sortedEngines[0] ? sortedEngines[0][0] : 'None';

    return {
      totalCount: list.length,
      avgTimeSec: Math.round(totalTime / list.length),
      avgIqScore: Math.round(totalIq / list.length),
      favoriteEngine,
      tierDistribution: { ...tierDistribution },
    };
  }

  public static generateAsciiBadge(item: {
    engine: string;
    tier: string;
    seed: number;
    steps: number;
    timeSpentSec: number;
    iq: number;
    rhythm?: string;
  }): string {
    const CARD_INNER_WIDTH = 38;

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
   * P2 修復：分離 JSON 解析異常 (InvalidFormat) 與 LocalStorage 配額異常 (StorageQuotaExceeded)
   */
  public static importVaultJson(jsonStr: string): ImportVaultResult {
    if (!jsonStr || typeof jsonStr !== 'string') {
      return { success: false, importedCount: 0, skippedCount: 0, error: 'InvalidFormat' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      this.logger.warn('[VaultManager] JSON parsing failed during import', parseError);
      return { success: false, importedCount: 0, skippedCount: 0, error: 'InvalidFormat' };
    }

    let incoming: unknown[] = [];
    if (Array.isArray(parsed)) {
      incoming = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).items)) {
      incoming = (parsed as any).items;
    } else {
      return { success: false, importedCount: 0, skippedCount: 0, error: 'InvalidFormat' };
    }

    const safeIncoming = incoming.slice(0, MAX_VAULT_CAPACITY);
    const rawList = this.loadVault();
    
    const newItemsMap = new Map<string, VaultItem>();
    let skippedCount = 0;

    for (const item of safeIncoming) {
      if (!item || typeof item !== 'object') {
        skippedCount++;
        continue;
      }
      const it = item as Record<string, unknown>;

      if (
        typeof it.id !== 'string' ||
        !it.id.trim() ||
        it.id.length > MAX_ID_LENGTH ||
        it.id === '__proto__' ||
        it.id === 'constructor' ||
        it.id === 'prototype'
      ) {
        skippedCount++;
        continue;
      }

      if (
        typeof it.engine !== 'string' ||
        !it.engine.trim() ||
        it.engine === '__proto__' ||
        it.engine === 'constructor' ||
        it.engine === 'prototype'
      ) {
        skippedCount++;
        continue;
      }

      if (
        typeof it.tier === 'string' &&
        (it.tier === '__proto__' || it.tier === 'constructor' || it.tier === 'prototype')
      ) {
        skippedCount++;
        continue;
      }

      if (typeof it.seed !== 'number' || !Number.isFinite(it.seed)) {
        skippedCount++;
        continue;
      }
      if (typeof it.timeSpentSec !== 'number' || !Number.isFinite(it.timeSpentSec) || it.timeSpentSec <= 0) {
        skippedCount++;
        continue;
      }

      const rawUrl = typeof it.challengeUrl === 'string' ? it.challengeUrl : undefined;
      const challengeUrl = rawUrl && this.isSafeUrl(rawUrl)
        ? rawUrl
        : this.generateChallengeLink(it.engine, (it.tier as string) || 'kids', it.seed);

      const sanitized: VaultItem = Object.freeze({
        id: it.id,
        engine: it.engine.toLowerCase(),
        tier: typeof it.tier === 'string' ? it.tier.toLowerCase() : 'kids',
        seed: Math.floor(it.seed),
        steps: Math.max(0, typeof it.steps === 'number' && Number.isFinite(it.steps) ? Math.floor(it.steps) : 0),
        timeSpentSec: Math.round(it.timeSpentSec),
        iqScore: Math.min(180, Math.max(60, typeof it.iqScore === 'number' && Number.isFinite(it.iqScore) ? Math.round(it.iqScore) : 100)),
        rhythmType: typeof it.rhythmType === 'string' ? it.rhythmType : undefined,
        edgeConnected: typeof it.edgeConnected === 'boolean' ? it.edgeConnected : undefined,
        date: typeof it.date === 'string' && !isNaN(new Date(it.date).getTime()) ? it.date : new Date().toISOString(),
        challengeUrl,
      });

      newItemsMap.set(sanitized.id, sanitized);
    }

    const mergedMap = new Map<string, VaultItem>();
    newItemsMap.forEach((val, key) => mergedMap.set(key, val));
    rawList.forEach((val) => {
      if (!mergedMap.has(val.id)) {
        mergedMap.set(val.id, val);
      }
    });

    const merged = Array.from(mergedMap.values()).slice(0, MAX_VAULT_CAPACITY);

    try {
      localStorage.setItem(VAULT_KEY, JSON.stringify(merged));
      this.invalidateCache();
      this.dispatchVaultChangeEvent();

      return {
        success: true,
        importedCount: newItemsMap.size,
        skippedCount,
      };
    } catch (e) {
      this.logger.warn('[VaultManager] Storage quota exceeded during import', e);
      return { success: false, importedCount: 0, skippedCount: 0, error: 'StorageQuotaExceeded' };
    }
  }

  private static dispatchVaultChangeEvent(): void {
    this.ensureBroadcastInitialized();
    if (typeof window !== 'undefined') {
      this.broadcastChannel?.postMessage({ type: 'update' });
      window.dispatchEvent(new CustomEvent(VAULT_BROADCAST_CHANNEL));
    }
  }

  public static dispose(): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    this.isBroadcastInitialized = false;
    this.invalidateCache();
  }

  public static resetForTesting(): void {
    this.dispose();
    this.logger = DEFAULT_LOGGER;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.removeItem(VAULT_KEY);
      } catch {}
    }
  }
}
