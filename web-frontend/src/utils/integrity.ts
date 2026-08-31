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
  const { checksum, ...payload } = item;
  const canonical = canonicalStringify(payload);
  const hash = CryptoJS.SHA256(canonical).toString(CryptoJS.enc.Hex);
  return hash === checksum;
}
