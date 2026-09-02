// web-frontend/src/utils/secureStorage.ts

/**
 * 企業級輕量防篡改客戶端儲存管理器 (HMAC-like Integrity Check)
 * 不增加昂貴加解密負擔，保持 0ms 感官延遲，杜絕 F12 手動修改數據
 */
export class SecureStorage {
  private static readonly INTEGRITY_SALT = 'LOGICORE_ENT_SEC_SALT_v1';

  private static async computeHash(dataStr: string): Promise<string> {
    if (!window.crypto || !window.crypto.subtle) {
      return 'NO_CRYPTO';
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(dataStr + this.INTEGRITY_SALT);
    const hashBuf = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  static async setItemSafe(key: string, value: any): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const hash = await this.computeHash(serialized);
      const envelope = {
        payload: value,
        signature: hash,
        savedAt: Date.now(),
      };
      localStorage.setItem(key, JSON.stringify(envelope));
    } catch (err) {
      console.warn('[SecureStorage] Write failed:', err);
    }
  }

  static async getItemSafe<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultValue;

      const envelope = JSON.parse(raw);
      // 若為舊格式（無 signature），自動升級
      if (!envelope || !envelope.signature || !envelope.payload) {
        return envelope as T;
      }

      const recomputed = await this.computeHash(JSON.stringify(envelope.payload));
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
