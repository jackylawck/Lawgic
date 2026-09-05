/**
 * 醫學與賽事級題目完整性校驗核心
 */

// 排除 undefined、函數並強制鍵排序的深層規範化字串化
export function canonicalStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => (item === undefined ? 'null' : canonicalStringify(item))).join(',') + ']';
  }
  
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
    .sort();
    
  const entries = keys.map((k) => `"${k}":${canonicalStringify(obj[k])}`);
  return '{' + entries.join(',') + '}';
}

/**
 * 常數時間比對（Constant-time comparison），防止時序旁路攻擊
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 完整性雜湊計算（採用 Web Crypto API 原生硬體加速）
 */
export async function computePuzzleDigest(payload: Record<string, any>): Promise<string> {
  const canonical = canonicalStringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // 輕量級純 JS 備援（若處於非 HTTPS / 不支援 SubtleCrypto 的極端舊環境）
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 判斷是否為生產環境（相容 Vite 與 Node 環境，絕不觸發未定義全域變數例外）
 */
function isProductionEnv(): boolean {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    return (import.meta as any).env.PROD === true || (import.meta as any).env.MODE === 'production';
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) {
    return (globalThis as any).process.env.NODE_ENV === 'production';
  }
  return true;
}

/**
 * 賽事題目防篡改完整性校驗
 * @param item 包含 checksum 的題目物件
 * @param allowDevMock 是否允許開發環境模擬特徵（生產環境強制關閉）
 */
export async function verifyPuzzleChecksum(
  item: any,
  allowDevMock: boolean = false
): Promise<boolean> {
  if (!item || typeof item.checksum !== 'string') return false;

  const targetChecksum = item.checksum.toLowerCase().trim();

  // 僅在明確傳入 allowDevMock 且非生產環境時放行
  if (allowDevMock && !isProductionEnv()) {
    if (targetChecksum === 'mock_checksum' || targetChecksum.startsWith('dev_')) {
      return true;
    }
  }

  // 提取有效負載並重算雜湊
  const { checksum, ...payload } = item;
  const calculatedHash = await computePuzzleDigest(payload);

  return constantTimeEquals(calculatedHash, targetChecksum);
}
