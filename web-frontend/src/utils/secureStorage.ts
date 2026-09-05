// web-frontend/src/utils/secureStorage.ts

/**
 * 企業級防篡改客戶端儲存管理器 (HMAC-like Envelope with Device Salt)
 */
export class SecureStorage {
  private static readonly APP_SALT = 'LOGICORE_ENT_SEC_SALT_v2';
  private static cachedDeviceSalt: string | null = null;

  /**
   * 取得動態設備指紋鹽值（增加純前端偽造難度）
   */
  private static getDynamicSalt(): string {
    if (this.cachedDeviceSalt) return this.cachedDeviceSalt;
    if (typeof window === 'undefined') return this.APP_SALT;

    const nav = window.navigator;
    const screen = window.screen;
    const rawFingerprint = [
      nav.userAgent || '',
      nav.language || '',
      screen.width || 0,
      screen.height || 0,
      screen.colorDepth || 0,
      this.APP_SALT,
    ].join('###');

    this.cachedDeviceSalt = rawFingerprint;
    return rawFingerprint;
  }

  /**
   * 遞迴排序物件鍵，確保序列化字串絕對確定（Deterministic Canonical JSON）
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
   * 計算防篡改雜湊
   */
  private static async computeHash(dataStr: string): Promise<string> {
    const salt = this.getDynamicSalt();
    const payload = `${dataStr}::${salt}`;

    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      const encoder = new TextEncoder();
      const hashBuf = await window.crypto.subtle.digest('SHA-256', encoder.encode(payload));
      return Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }

    // 輕量純 JS 備援（強制 64-bit 雜湊，不回傳容易被偽造的常數字串）
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < payload.length; i++) {
      const ch = payload.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `FALLBACK_${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
  }

  /**
   * 安全寫入本地儲存
   */
  static async setItemSafe(key: string, value: any): Promise<void> {
    try {
      const canonical = this.canonicalStringify(value);
      const hash = await this.computeHash(canonical);
      const envelope = {
        payload: value,
        signature: hash,
        savedAt: Date.now(),
        version: 2,
      };
      localStorage.setItem(key, JSON.stringify(envelope));
    } catch (err) {
      console.warn('[SecureStorage] Write failed:', err);
    }
  }

  /**
   * 安全讀取本地儲存（具備防降級與篡改防禦）
   */
  static async getItemSafe<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultValue;

      const envelope = JSON.parse(raw);

      // 嚴格結構驗證：拒絕無簽名或非信封結構
      if (!envelope || typeof envelope !== 'object' || !envelope.signature || !('payload' in envelope)) {
        console.warn(`[Security Alert] Unsigned or legacy data detected for key "${key}". Resetting.`);
        localStorage.removeItem(key);
        return defaultValue;
      }

      // 使用規範化序列化重新驗算，杜絕鍵序問題造成的誤判
      const canonical = this.canonicalStringify(envelope.payload);
      const recomputed = await this.computeHash(canonical);

      if (recomputed !== envelope.signature) {
        console.warn(`[Security Alert] Data tampering detected for key "${key}". Resetting to defaults.`);
        localStorage.removeItem(key);
        return defaultValue;
      }

      return envelope.payload as T;
    } catch {
      return defaultValue;
    }
  }
}
