// web-frontend/src/utils/secureStorage.ts

export interface StorageResult<T = void> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export interface SecureStorageLogger {
  warn(message: string, context?: unknown): void;
  info?(message: string, context?: unknown): void;
}

const MASTER_KEY_SEED_STORAGE_KEY = 'LOGICORE_KEY_VAULT_V3';
const FALLBACK_SEED_STORAGE_KEY = 'LOGICORE_FALLBACK_SEED_V3';
const MAX_MASTER_KEY_ATTEMPTS = 3;
const DEFAULT_LOGGER: SecureStorageLogger = console;

// 預計算十六進位查表
const HEX_TABLE: readonly string[] = Object.freeze(
  Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))
);

const HEX_REGEX = /^[0-9a-fA-F]+$/;

/**
 * 混淆與完整性校驗儲存管理器 (Obfuscated & Integrity-Verified Storage - Production Grade)
 * 
 * ⚠️ 架構設計與已知邊界保證 (Security & Reliability Statement)：
 * 1. 本機混淆本質：金鑰種子與密文同源存放於 LocalStorage。防禦本機肉眼瀏覽與欄位竄改，
 *    在密碼學意義上不防禦擁有 XSS、惡意擴充套件或 DevTools 讀取權限之攻擊者。
 * 2. 失敗優先原則：若持久化種子無法落盤，拒絕寫入不可驗證之資料，杜絕「寫入成功但下次丟失」。
 * 3. 規範化落盤：V2 信封落盤資料與簽章計算嚴格基於同一 canonical 規格，杜絕 Symbol 等序列化裂痕。
 * 4. 熔斷機制：金鑰初始化失敗累積達 3 次自動熔斷，避免重複引發無效計算與 Log 泛濫。
 */
export class SecureStorage {
  private static cachedCryptoKey: CryptoKey | null = null;
  private static masterKeyPromise: Promise<CryptoKey | null> | null = null;
  private static masterKeyAttempts = 0;
  private static cachedRawFallbackKey: string | null = null;
  private static logger: SecureStorageLogger = DEFAULT_LOGGER;

  private static upgradeAttempted = new Set<string>();

  public static setLogger(customLogger: SecureStorageLogger): void {
    this.logger = customLogger;
  }

  public static bytesToHex(bytes: Uint8Array): string {
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      result += HEX_TABLE[bytes[i]];
    }
    return result;
  }

  /**
   * P3-1 修復：明確拒絕空字串，嚴格校驗有效十六進位字元
   */
  public static hexToBytes(hex: string): Uint8Array | null {
    if (!hex || hex.length % 2 !== 0 || !HEX_REGEX.test(hex)) {
      return null;
    }
    const len = hex.length / 2;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  /**
   * 取得或派生本機主混淆金鑰（P2-1 修復：含最大重試次數熔斷）
   */
  private static getOrCreateMasterKey(): Promise<CryptoKey | null> {
    if (this.cachedCryptoKey) {
      return Promise.resolve(this.cachedCryptoKey);
    }
    if (this.masterKeyPromise) {
      return this.masterKeyPromise;
    }
    if (this.masterKeyAttempts >= MAX_MASTER_KEY_ATTEMPTS) {
      return Promise.resolve(null);
    }

    this.masterKeyPromise = (async () => {
      if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
        return null;
      }

      this.masterKeyAttempts++;

      try {
        let rawSeed = localStorage.getItem(MASTER_KEY_SEED_STORAGE_KEY);
        if (!rawSeed) {
          const randomBytes = new Uint8Array(32);
          window.crypto.getRandomValues(randomBytes);
          rawSeed = this.bytesToHex(randomBytes);
          localStorage.setItem(MASTER_KEY_SEED_STORAGE_KEY, rawSeed);
        }

        const keyBuffer = this.hexToBytes(rawSeed);
        if (!keyBuffer || keyBuffer.length !== 32) {
          throw new Error('Corrupted master key seed in storage');
        }

        // TS2769 修復：顯式轉型為 BufferSource，相容 TS 5.x 嚴格 DOM 型別庫
        const cryptoKey = await window.crypto.subtle.importKey(
          'raw',
          keyBuffer as BufferSource,
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        );

        this.cachedCryptoKey = cryptoKey;
        return cryptoKey;
      } catch (err) {
        this.logger.warn(`[SecureStorage] Master key init failed (attempt ${this.masterKeyAttempts})`, err);
        this.masterKeyPromise = null;
        return null;
      }
    })();

    return this.masterKeyPromise;
  }

  /**
   * P1 修復：Fallback 種子無法落盤時回傳 null，杜絕記憶體孤兒種子引發的靜默資料蒸發
   */
  private static getFallbackKey(): string | null {
    if (this.cachedRawFallbackKey) return this.cachedRawFallbackKey;

    let seed = localStorage.getItem(FALLBACK_SEED_STORAGE_KEY);
    if (!seed) {
      if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
        const buf = new Uint8Array(16);
        window.crypto.getRandomValues(buf);
        seed = this.bytesToHex(buf);
      } else {
        seed = `${Date.now().toString(36)}_${Math.random().toString(36).substring(2)}`;
      }
      try {
        localStorage.setItem(FALLBACK_SEED_STORAGE_KEY, seed);
      } catch (e) {
        this.logger.warn('[SecureStorage] Failed to persist fallback seed; refusing unverified write', e);
        return null;
      }
    }

    this.cachedRawFallbackKey = seed;
    return seed;
  }

  /**
   * 規範化確定性 JSON 序列化
   */
  public static canonicalStringify(obj: unknown, seen = new WeakSet<object>()): string {
    if (obj === null) return 'null';
    if (typeof obj === 'undefined') return 'null';
    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return Number.isFinite(obj as number) ? JSON.stringify(obj) : 'null';
    }
    if (typeof obj === 'string') {
      return JSON.stringify(obj);
    }
    if (typeof obj === 'bigint') {
      throw new TypeError('[SecureStorage] BigInt serialization is not supported');
    }
    if (typeof obj === 'function' || typeof obj === 'symbol') {
      return 'null';
    }
    // P2-2 修復：無效 Date 拋出精確 TypeError
    if (obj instanceof Date) {
      if (Number.isNaN(obj.getTime())) {
        throw new TypeError('[SecureStorage] Invalid Date object cannot be serialized');
      }
      return JSON.stringify(obj.toISOString());
    }

    if (Array.isArray(obj)) {
      if (seen.has(obj)) {
        throw new TypeError('[SecureStorage] Circular reference detected in array payload');
      }
      seen.add(obj);
      const items = obj.map((item) => this.canonicalStringify(item, seen));
      seen.delete(obj);
      return '[' + items.join(',') + ']';
    }

    if (typeof obj === 'object') {
      const tag = Object.prototype.toString.call(obj);
      if (tag !== '[object Object]') {
        throw new TypeError(`[SecureStorage] Unsupported object type for serialization: ${tag}`);
      }

      if (seen.has(obj)) {
        throw new TypeError('[SecureStorage] Circular reference detected in object payload');
      }
      seen.add(obj);

      const record = obj as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined && typeof record[k] !== 'function')
        .sort();

      const entries = keys.map((k) => `${JSON.stringify(k)}:${this.canonicalStringify(record[k], seen)}`);
      seen.delete(obj);
      return '{' + entries.join(',') + '}';
    }

    return 'null';
  }

  /**
   * 安全寫入本地儲存
   */
  public static async setItemSafe(key: string, value: unknown): Promise<StorageResult> {
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      return { success: false, error: 'InvalidKey' };
    }

    try {
      const canonicalPayload = this.canonicalStringify(value);
      const masterKey = await this.getOrCreateMasterKey();

      if (masterKey && typeof window !== 'undefined' && window.crypto?.subtle) {
        const iv = new Uint8Array(12); // 96-bit AES-GCM IV
        window.crypto.getRandomValues(iv);

        const encoder = new TextEncoder();
        // 嚴格轉型為 BufferSource，避免 TS 檢查報錯
        const encryptedBuf = await window.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: iv as BufferSource },
          masterKey,
          encoder.encode(canonicalPayload) as BufferSource
        );

        const envelope = {
          v: 3,
          t: Date.now(),
          iv: this.bytesToHex(iv),
          d: this.bytesToHex(new Uint8Array(encryptedBuf)),
        };

        localStorage.setItem(key, JSON.stringify(envelope));
      } else {
        // P1 修復：若無法取得已落盤之種子，堅決拒絕寫入
        const fallbackSalt = this.getFallbackKey();
        if (!fallbackSalt) {
          return { success: false, error: 'FallbackKeyUnavailable' };
        }

        const signature = this.quickHash(`${canonicalPayload}::${fallbackSalt}`);
        // P2 修復：存入規範化反序列化物件，消弭 Symbol 欄位等序列化差異
        const envelope = {
          v: 2,
          t: Date.now(),
          payload: JSON.parse(canonicalPayload),
          signature,
        };
        localStorage.setItem(key, JSON.stringify(envelope));
      }

      return { success: true };
    } catch (err) {
      this.logger.warn(`[SecureStorage] Write failed for key "${key}"`, err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'UnknownWriteError',
      };
    }
  }

  /**
   * 安全讀取本地儲存
   */
  public static async getItemSafe<T>(key: string, defaultValue: T): Promise<T> {
    if (!key || typeof key !== 'string') return defaultValue;

    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
      if (!raw) return defaultValue;

      const envelope = JSON.parse(raw);
      if (!envelope || typeof envelope !== 'object') {
        this.archiveCorruptedData(key, raw);
        return defaultValue;
      }

      // 1. 處理 AES-GCM V3 加密信封
      if (envelope.v === 3 && typeof envelope.iv === 'string' && typeof envelope.d === 'string') {
        const masterKey = await this.getOrCreateMasterKey();
        if (!masterKey || !window.crypto?.subtle) {
          this.logger.warn(`[SecureStorage] WebCrypto unavailable to decrypt key "${key}"`);
          return defaultValue;
        }

        const iv = this.hexToBytes(envelope.iv);
        const cipherBytes = this.hexToBytes(envelope.d);

        if (!iv || !cipherBytes) {
          this.archiveCorruptedData(key, raw);
          return defaultValue;
        }

        // TS2322 修復：將 iv 與 cipherBytes 轉型為 BufferSource
        const decryptedBuf = await window.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource },
          masterKey,
          cipherBytes as BufferSource
        );

        const decoder = new TextDecoder();
        const jsonStr = decoder.decode(decryptedBuf);
        try {
          return JSON.parse(jsonStr) as T;
        } catch (jsonErr) {
          // P3-5: 解密成功但 JSON 解析失敗之明確可觀測性
          this.logger.warn(`[SecureStorage] Decryption succeeded but JSON parsing failed for "${key}"`, jsonErr);
          this.archiveCorruptedData(key, raw);
          return defaultValue;
        }
      }

      // 2. 處理 V2 降級明文校驗信封
      if (envelope.v === 2 && envelope.payload !== undefined && typeof envelope.signature === 'string') {
        const canonical = this.canonicalStringify(envelope.payload);
        const fallbackSalt = this.getFallbackKey();
        if (!fallbackSalt) {
          return defaultValue;
        }

        const recomputed = this.quickHash(`${canonical}::${fallbackSalt}`);
        if (recomputed !== envelope.signature) {
          this.logger.warn(`[SecureStorage] Tamper detected for fallback key "${key}"`);
          this.archiveCorruptedData(key, raw);
          return defaultValue;
        }

        if (!this.upgradeAttempted.has(key)) {
          this.upgradeAttempted.add(key);
          this.setItemSafe(key, envelope.payload).catch(() => {});
        }
        return envelope.payload as T;
      }

      this.archiveCorruptedData(key, raw);
      return defaultValue;
    } catch (err) {
      this.logger.warn(`[SecureStorage] Read/Decrypt failed for key "${key}", archiving payload`, err);
      if (raw) {
        this.archiveCorruptedData(key, raw);
      }
      return defaultValue;
    }
  }

  /**
   * P3-4 修復：防止已歸檔鍵堆疊 __corrupted_latest 後綴
   */
  private static archiveCorruptedData(key: string, rawPayload: string): void {
    if (key.endsWith('__corrupted_latest')) {
      try {
        localStorage.removeItem(key);
      } catch {}
      return;
    }

    try {
      const archiveKey = `${key}__corrupted_latest`;
      localStorage.setItem(archiveKey, rawPayload);
      localStorage.removeItem(key);
      this.logger.warn(`[SecureStorage] Corrupted data for "${key}" moved to "${archiveKey}"`);
    } catch (e) {
      this.logger.warn(`[SecureStorage] Failed to archive corrupted data for "${key}"`, e);
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  }

  private static quickHash(str: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `FALL_${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`.toUpperCase();
  }

  public static dispose(): void {
    this.cachedCryptoKey = null;
    this.masterKeyPromise = null;
    this.masterKeyAttempts = 0;
    this.cachedRawFallbackKey = null;
    this.upgradeAttempted.clear();
  }

  public static resetForTesting(): void {
    this.dispose();
    this.logger = DEFAULT_LOGGER;

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k === MASTER_KEY_SEED_STORAGE_KEY || k === FALLBACK_SEED_STORAGE_KEY || k.endsWith('__corrupted_latest'))) {
            toRemove.push(k);
          }
        }
        toRemove.forEach((k) => localStorage.removeItem(k));
      } catch {}
    }
  }
}
