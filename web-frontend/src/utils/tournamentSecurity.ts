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
  canvasHash?: string; // 深度硬體 Canvas 特徵
}

/**
 * 採集進階硬體指紋 (Canvas Rendering Digest)
 */
function getCanvasFingerprint(): string {
  if (typeof document === 'undefined') return 'SSR';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 30;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'NO_CANVAS';

    ctx.textBaseline = 'top';
    ctx.font = '12px "Arial", sans-serif';
    ctx.fillStyle = '#f60';
    ctx.fillRect(5, 5, 60, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Lawgic2026!?', 2, 8);

    const b64 = canvas.toDataURL();
    let hash = 0x811c9dc5;
    for (let i = 0; i < b64.length; i++) {
      hash ^= b64.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).toUpperCase();
  } catch {
    return 'CANVAS_BLOCKED';
  }
}

/**
 * 採集客戶端環境指紋
 */
export function getEnvironmentFingerprint(): EnvironmentFingerprint {
  const nav = typeof window !== 'undefined' ? window.navigator : ({} as any);
  const scr = typeof window !== 'undefined' ? window.screen : ({} as any);

  return {
    userAgent: nav.userAgent || 'unknown',
    platform: nav.userAgentData?.platform || nav.platform || 'unknown',
    hardwareConcurrency: nav.hardwareConcurrency || 0,
    deviceMemory: (nav as any).deviceMemory || undefined,
    screenRes: scr.width && scr.height ? `${scr.width}x${scr.height}` : '0x0',
    timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    touchSupport: typeof window !== 'undefined' ? 'ontouchstart' in window || nav.maxTouchPoints > 0 : false,
    canvasHash: getCanvasFingerprint(),
  };
}

/**
 * 帶有充分雪崩預熱的確定性 PRNG (Mulberry32)
 */
export function createSeededRandom(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  // 預熱 15 輪以消弭低熵短字串的非均勻分布
  for (let round = 0; round < 15; round++) {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
  }

  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * 智慧違規評分引擎
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
  environment?: EnvironmentFingerprint | Record<string, any>;
  timestamp: string;
}

/**
 * Lawgic 賽事存證簽章
 */
export async function generateLocalProofSignature(
  payload: SanctionedSubmissionPayload
): Promise<string> {
  const envSummary = payload.environment
    ? `${payload.environment.screenRes}_${payload.environment.hardwareConcurrency}_${payload.environment.timezone}_${payload.environment.canvasHash || ''}`
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
    'LAWGIC_ZERO_TRUST_AUDIT_2026',
  ].join('|');

  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
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

/**
 * 自動化全域賽事監控實例 (Proctoring Session)
 */
export class TournamentProctoringSession {
  private audit: SecurityAuditTrail = {
    tabSwitches: 0,
    blurEvents: 0,
    clipboardEvents: 0,
    untrustedEvents: 0,
  };
  private listeners: { target: EventTarget; type: string; fn: EventListenerOrEventListenerObject }[] = [];

  constructor() {
    if (typeof window === 'undefined') return;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        this.audit.tabSwitches++;
      }
    };

    const onBlur = () => {
      this.audit.blurEvents++;
    };

    const onClipboard = () => {
      this.audit.clipboardEvents++;
    };

    const onPointerCheck = (e: Event) => {
      if (!e.isTrusted) {
        this.audit.untrustedEvents++;
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onClipboard);
    document.addEventListener('paste', onClipboard);
    document.addEventListener('pointerdown', onPointerCheck, { capture: true });

    this.listeners.push(
      { target: document, type: 'visibilitychange', fn: onVisibilityChange },
      { target: window, type: 'blur', fn: onBlur },
      { target: document, type: 'copy', fn: onClipboard },
      { target: document, type: 'paste', fn: onClipboard },
      { target: document, type: 'pointerdown', fn: onPointerCheck }
    );
  }

  public getSnapshot(): SecurityAuditTrail {
    return { ...this.audit };
  }

  public getScore(): number {
    return calculateInfractionScore(this.audit);
  }

  public destroy() {
    this.listeners.forEach(({ target, type, fn }) => {
      target.removeEventListener(type, fn);
    });
    this.listeners = [];
  }
}
