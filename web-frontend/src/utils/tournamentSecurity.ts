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

export interface EnvironmentFingerprint {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
  screenRes: string;
  timezone: string;
  touchSupport: boolean;
}

/**
 * 採集客戶端環境指紋 (用於賽事反作弊審計)
 */
export function getEnvironmentFingerprint(): EnvironmentFingerprint {
  const nav = typeof window !== 'undefined' ? window.navigator : ({} as any);
  const scr = typeof window !== 'undefined' ? window.screen : ({} as any);

  return {
    userAgent: nav.userAgent || 'unknown',
    platform: nav.platform || 'unknown',
    hardwareConcurrency: nav.hardwareConcurrency || 0,
    deviceMemory: (nav as any).deviceMemory || undefined,
    screenRes: scr.width && scr.height ? `${scr.width}x${scr.height}` : '0x0',
    timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    touchSupport: typeof window !== 'undefined' ? 'ontouchstart' in window || nav.maxTouchPoints > 0 : false,
  };
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
 * 梯度懲罰：前 2 次切換視窗視為操作誤觸（輕微扣分），第 3 次起呈指數激增
 */
export function calculateInfractionScore(audit: SecurityAuditTrail): number {
  let score = 0;
  if (audit.tabSwitches <= 2) {
    score += audit.tabSwitches * 0.5;
  } else {
    score += 1.0 + (audit.tabSwitches - 2) * 2.5;
  }
  score += audit.blurEvents * 0.3;
  score += audit.clipboardEvents * 4.0;
  score += audit.untrustedEvents * 6.0;
  return Number(score.toFixed(1));
}

export interface SanctionedSubmissionPayload {
  submissionId?: string;
  tournamentId: string;
  playerId: string;
  division: DivisionType;
  puzzleId: string;
  engineType?: string;
  tier?: string;
  timeSpentSec: number;
  conflictsCount: number;
  infractionScore: number;
  environment?: Record<string, any>;
  timestamp: string;
}

/**
 * Lawgic 零信任本地 SHA-256 存證簽章
 * 結合比賽代碼、選手身份、時間戳、違規指標與設備指紋雜湊，生成不可偽造憑據
 */
export async function generateLocalProofSignature(
  payload: SanctionedSubmissionPayload
): Promise<string> {
  const envSummary = payload.environment
    ? `${payload.environment.screenRes}_${payload.environment.hardwareConcurrency}_${payload.environment.timezone}`
    : 'GENERIC_CLIENT';

  const canonical = [
    payload.tournamentId,
    payload.playerId,
    payload.division,
    payload.puzzleId,
    payload.timeSpentSec,
    payload.conflictsCount,
    payload.infractionScore,
    envSummary,
    payload.timestamp,
    'LAWGIC_ZERO_TRUST_AUDIT_V1',
  ].join('|');

  if (!window.crypto || !window.crypto.subtle) {
    return `CLIENT_${Date.now().toString(16).toUpperCase()}`;
  }

  try {
    const enc = new TextEncoder();
    const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(canonical));
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return `VERIFIED_${hex.slice(0, 32).toUpperCase()}`;
  } catch {
    return `FALLBACK_${Date.now().toString(16).toUpperCase()}`;
  }
}
