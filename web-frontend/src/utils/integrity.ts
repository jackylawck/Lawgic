// web-frontend/src/utils/integrity.ts

/**
 * 醫學與賽事級題目完整性校驗核心
 * 
 * ⚠️ 安全與架構邊界說明：
 * 1. 規範化邏輯：`canonicalStringify` 支援 plain object、array、primitive 及 Date。不支援 Map/Set 或循環引用。
 * 2. 雜湊一致性：透過顯式前綴（`sha256:` / `fnv1a:`）標記演算法，防止非安全環境降級時發生靜默比對失敗。
 * 3. 時序防禦：常數時間比對避免時序側信道攻擊；長度不同時進行固定 dummy 迭代防止洩漏。
 */

/**
 * 排除 undefined、函數並強制鍵排序與 Date ISO 轉換的深層規範化字串化
 */
export function canonicalStringify(obj: unknown): string {
  if (obj === null) return 'null';
  if (typeof obj === 'undefined') return 'null';
  if (typeof obj === 'symbol') return JSON.stringify(String(obj));
  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (obj instanceof Date) {
    return JSON.stringify(obj.toISOString());
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => (item === undefined ? 'null' : canonicalStringify(item))).join(',') + ']';
  }

  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined && typeof record[k] !== 'function')
    .sort();

  const entries = keys.map((k) => `"${k}":${canonicalStringify(record[k])}`);
  return '{' + entries.join(',') + '}';
}

/**
 * 常數時間字串比對（Constant-time comparison），防止時序旁路攻擊
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // 執行等長 dummy 迴圈打亂時序，防止透過早期返回推測長度
    let dummy = 0;
    for (let i = 0; i < a.length; i++) {
      dummy |= a.charCodeAt(i) ^ a.charCodeAt(i);
    }
    return false && dummy === 0;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 完整性雜湊計算（首選 Web Crypto API 原生硬體加速，帶有顯式演算法標籤）
 */
export async function computePuzzleDigest(payload: Record<string, unknown>): Promise<string> {
  const canonical = canonicalStringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex}`;
  }

  // 輕量級純 JS 備援（極端舊環境或非安全上下文），顯式標明 fnv1a，絕不靜默冒充 sha256
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * 判斷是否為生產環境（未知環境預設為生產環境以防誤放行）
 */
function isProductionEnv(): boolean {
  if (typeof import.meta !== 'undefined' && (import.meta as Record<string, unknown>).env) {
    const env = (import.meta as Record<string, unknown>).env as Record<string, unknown>;
    return env.PROD === true || env.MODE === 'production';
  }
  if (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>).process) {
    const proc = (globalThis as Record<string, unknown>).process as { env?: Record<string, unknown> };
    return proc.env?.NODE_ENV === 'production';
  }
  return true;
}

/**
 * 賽事題目防篡改完整性校驗
 * @param item 包含 checksum 的題目物件
 * @param allowDevMock 是否允許開發環境模擬特徵（生產環境強制關閉）
 */
export async function verifyPuzzleChecksum(
  item: Record<string, unknown> | null | undefined,
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

  try {
    const { checksum, ...payload } = item;
    const calculated = await computePuzzleDigest(payload);

    // 若 target 帶有演算法前綴，強制進行演算法匹配
    if (targetChecksum.includes(':')) {
      const targetAlgo = targetChecksum.split(':')[0];
      const calculatedAlgo = calculated.split(':')[0];
      if (targetAlgo !== calculatedAlgo) {
        return false;
      }
      return constantTimeEquals(calculated, targetChecksum);
    }

    // 相容歷史無前綴之純 sha256 hex
    const calculatedHex = calculated.replace(/^sha256:/, '');
    return constantTimeEquals(calculatedHex, targetChecksum);
  } catch {
    return false;
  }
}
