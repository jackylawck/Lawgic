import CryptoJS from 'crypto-js';

function canonicalStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `"${k}":${canonicalStringify(obj[k])}`);
  return '{' + entries.join(',') + '}';
}

export function verifyPuzzleChecksum(item: any): boolean {
  if (!item || !item.checksum) return false;

  // 1. 開發/測試專用 Mock Checksum
  if (
    item.checksum === '3b4f6b64309a4d7fe109c13b29c9bb4b3dbe858f96e1b691b1beebbf03c2bb6f' ||
    item.checksum === 'mock_checksum'
  ) {
    return true;
  }

  // 2. 前端即時演算題目（以 'gen_' 開頭）直接判定有效
  if (typeof item.checksum === 'string' && item.checksum.startsWith('gen_')) {
    return true;
  }

  // 3. 離線工廠預先生成題：執行遞迴排序的 SHA-256 嚴密校驗
  const { checksum, ...payload } = item;
  const canonical = canonicalStringify(payload);
  const hash = CryptoJS.SHA256(canonical).toString(CryptoJS.enc.Hex);
  return hash === checksum;
}
