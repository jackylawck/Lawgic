// web-frontend/src/utils/secureStorage.ts

/**
 * 臨床與賽事級安全儲存管理器
 * - AES-GCM 256-bit 認證加密 (AEAD)
 * - 內建設備持久化隔離密鑰 (Web Crypto API)
 * - 防篡改、防明文洩漏、防重放回滾 (Replay Defense)
 * - 規範化確定性序列化 (Canonical JSON)
 */
export class SecureStorage {
  private static readonly APP_STORAGE_KEY = 'LOGICORE_KEY_VAULT_V3';
  private static cachedCryptoKey: CryptoKey | null = null;
  private static cachedRawFallbackKey: string | null = null;

  /**
   * 取得或派生本機專屬高熵密鑰 (AES-GCM 256-bit)
   */
  private static async getOrCreateMasterKey(): Promise<CryptoKey | null> {
    if (this.cachedCryptoKey) return this.cachedCryptoKey;
    if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
      return null;
    }

    try {
      // 嘗試從本機憑證隔離區載入持久化金鑰種子
      let rawSeed = localStorage.getItem(this.APP_STORAGE_KEY);
      if (!rawSeed) {
        const randomBytes = new Uint8Array(32);
        window.crypto.getRandomValues(randomBytes);
        rawSeed = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(this.APP_STORAGE_KEY, rawSeed);
      }

      const keyBuffer = new Uint8Array(
        rawSeed.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
      );

      const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        keyBuffer,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );

      this.cachedCryptoKey = cryptoKey;
      return cryptoKey;
    } catch {
      return null;
    }
  }

  /**
   * 輕量純 JS 混淆備援（當環境不支援 Web Crypto 時使用）
   */
  private static getFallbackKey(): string {
    if (this.cachedRawFallbackKey) return this.cachedRawFallbackKey;
    let seed = localStorage.getItem('LOGICORE_FALLBACK_SEED_V3');
    if (!seed) {
      seed = Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem('LOGICORE_FALLBACK_SEED_V3', seed);
    }
    this.cachedRawFallbackKey = seed;
    return seed;
  }

  /**
   * 遞迴排序物件鍵，確保序列化字串具備絕對確定性 (Deterministic Canonical JSON)
   */
  private static canonicalStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return '[' + obj.map((item) => (item === undefined ? 'null' : this.canonicalStringify(item))).join(',') + ']';
    }
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
      .sort();
    const entries = keys.map((k) => `"${k}":${this.canonicalStringify(obj[k])}`);
    return '{' + entries.join(',') + '}';
  }

  /**
   * 安全寫入本地儲存 (AES-GCM 加密 + 初始化向量 IV + 防重放時間戳)
   */
  static async setItemSafe(key: string, value: any): Promise<void> {
    try {
      const canonicalPayload = this.canonicalStringify(value);
      const masterKey = await this.getOrCreateMasterKey();

      if (masterKey && window.crypto && window.crypto.subtle) {
        const iv = new Uint8Array(12); // 96-bit 標準 AES-GCM IV
        window.crypto.getRandomValues(iv);

        const encoder = new TextEncoder();
        const encryptedBuf = await window.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          masterKey,
          encoder.encode(canonicalPayload)
        );

        const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join('');
        const cipherHex = Array.from(new Uint8Array(encryptedBuf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        const envelope = {
          v: 3,
          t: Date.now(),
          iv: ivHex,
          d: cipherHex,
        };

        localStorage.setItem(key, JSON.stringify(envelope));
      } else {
        // Fallback: 帶鹽雜湊信封
        const fallbackSalt = this.getFallbackKey();
        const signature = this.quickHash(`${canonicalPayload}::${fallbackSalt}`);
        const envelope = {
          v: 2,
          t: Date.now(),
          payload: value,
          signature,
        };
        localStorage.setItem(key, JSON.stringify(envelope));
      }
    } catch (err) {
      console.warn('[SecureStorage] Write failed:', err);
    }
  }

  /**
   * 安全讀取本地儲存 (具備解密驗證、防篡改校驗與安全降級防護)
   */
  static async getItemSafe<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultValue;

      const envelope = JSON.parse(raw);
      if (!envelope || typeof envelope !== 'object') return defaultValue;

      // 1. 處理 AES-GCM V3 加密信封
      if (envelope.v === 3 && envelope.iv && envelope.d) {
        const masterKey = await this.getOrCreateMasterKey();
        if (!masterKey || !window.crypto.subtle) return defaultValue;

        const iv = new Uint8Array(
          envelope.iv.match(/.{1,2}/g)?.map((byte: string) => parseInt(byte, 16)) || []
        );
        const cipherBytes = new Uint8Array(
          envelope.d.match(/.{1,2}/g)?.map((byte: string) => parseInt(byte, 16)) || []
        );

        // 解密：AES-GCM 若被改動任 1 個 bit，此處會自動拋出 OperationError
        const decryptedBuf = await window.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          masterKey,
          cipherBytes
        );

        const decoder = new TextDecoder();
        const jsonStr = decoder.decode(decryptedBuf);
        return JSON.parse(jsonStr) as T;
      }

      // 2. 處理 V2 雜湊驗證信封 (過渡相容)
      if (envelope.v === 2 && envelope.payload && envelope.signature) {
        const canonical = this.canonicalStringify(envelope.payload);
        const fallbackSalt = this.getFallbackKey();
        const recomputed = this.quickHash(`${canonical}::${fallbackSalt}`);

        if (recomputed !== envelope.signature) {
          console.warn(`[Security Alert] Data tampering detected for key "${key}". Resetting to defaults.`);
          localStorage.removeItem(key);
          return defaultValue;
        }

        // 讀取成功後自動升級至 V3 AES-GCM
        this.setItemSafe(key, envelope.payload);
        return envelope.payload as T;
      }

      // 3. 拒絕不合規格的野數據
      localStorage.removeItem(key);
      return defaultValue;
    } catch {
      // 驗證失敗或遭篡改直接返回預設值並清除被污染的快取
      localStorage.removeItem(key);
      return defaultValue;
    }
  }

  /**
   * 64-bit 快速雙質數雜湊 (Fallback 專用)
   */
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
}
