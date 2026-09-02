// web-frontend/src/utils/tournamentSecurity.ts

export type DivisionType = 'kids' | 'junior' | 'open' | 'senior';

export interface PlayerIdentity {
  id: string;
  name: string;
  age: number;
  country: string;
  division: DivisionType;
  verifiedBadge: boolean;
}

export interface SecurityAuditTrail {
  tabSwitches: number;
  blurEvents: number;
  clipboardEvents: number;
  untrustedEvents: number;
}

/**
 * 確定性偽隨機數生成器 (Mulberry32)
 */
export function createSeededRandom(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * 智慧違規評分引擎 (Smart Infraction Grading)
 */
export function calculateInfractionScore(audit: SecurityAuditTrail): number {
  let score = 0;
  if (audit.tabSwitches <= 2) {
    score += audit.tabSwitches * 0.5;
  } else {
    score += 1.0 + (audit.tabSwitches - 2) * 2.0;
  }
  score += audit.blurEvents * 0.2;
  score += audit.clipboardEvents * 3.0;
  score += audit.untrustedEvents * 5.0;
  return Number(score.toFixed(1));
}

export interface SanctionedSubmissionPayload {
  tournamentId: string;
  playerId: string;
  division: DivisionType;
  puzzleId: string;
  timeSpentSec: number;
  conflictsCount: number;
  infractionScore: number;
  timestamp: string;
}

/**
 * 純前端 SHA-256 本地存證簽名 (無需任何後端或 Cloudflare)
 */
export async function generateLocalProofSignature(
  payload: SanctionedSubmissionPayload
): Promise<string> {
  const canonical = [
    payload.tournamentId,
    payload.playerId,
    payload.division,
    payload.puzzleId,
    payload.timeSpentSec,
    payload.conflictsCount,
    payload.infractionScore,
    payload.timestamp,
    'LOGICORE_CLIENT_AUDIT',
  ].join('|');

  if (!window.crypto || !window.crypto.subtle) {
    return `CLIENT_${Date.now().toString(16)}`;
  }

  const enc = new TextEncoder();
  const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(canonical));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `VERIFIED_${hex.slice(0, 32).toUpperCase()}`;
}
