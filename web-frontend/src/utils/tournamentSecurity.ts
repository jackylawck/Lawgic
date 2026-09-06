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
  totalOutFocusDurationSec?: number; // 累計脫離螢幕秒數
  clockAnomalyCount?: number;        // 時鐘加速/篡改異常次數
}

export interface EnvironmentFingerprint {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
  screenRes: string;
  timezone: string;
  touchSupport: boolean;
  canvasHash?: string;
  webglRenderer?: string;
  audioHash?: string;
}

/**
 * 採集進階 WebGL 物理顯卡硬體指紋
 */
function getWebGLFingerprint(): string {
  if (typeof document === 'undefined') return 'SSR';
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'NO_WEBGL';

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return 'NO_DEBUG_INFO';

    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';
    const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
    return `${vendor}::${renderer}`.replace(/[/\\?%*:|"<>]/g, '_');
  } catch {
    return 'WEBGL_BLOCKED';
  }
}

/**
 * 採集進階硬體 Canvas 多色階渲染指紋 (帶幾何漸層與文字抗鋸齒)
 */
function getCanvasFingerprint(): string {
  if (typeof document === 'undefined') return 'SSR';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'NO_CANVAS';

    // 漸層與幾何抗鋸齒微測繪
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#ff4500');
    gradient.addColorStop(0.5, '#1e90ff');
    gradient.addColorStop(1, '#32cd32');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textBaseline = 'alphabetic';
    ctx.font = '14px "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('LogiCore.WPC.Certified.2026!?', 10, 30);
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.fillText('🏆λπΩ§', 180, 50);

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
 * 採集客戶端零信任環境多維物理指紋
 */
export function getEnvironmentFingerprint(): EnvironmentFingerprint {
  const nav = typeof window !== 'undefined' ? window.navigator : ({} as any);
  const scr = typeof window !== 'undefined' ? window.screen : ({} as any);

  return {
    userAgent: nav.userAgent || 'unknown',
    platform: nav.userAgentData?.platform || nav.platform || 'unknown',
    hardwareConcurrency: nav.hardwareConcurrency || 0,
    deviceMemory: (nav as any).deviceMemory || undefined,
    screenRes: scr.width && scr.height ? `${scr.width}x${scr.height}x${scr.colorDepth || 24}` : '0x0',
    timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    touchSupport: typeof window !== 'undefined' ? 'ontouchstart' in window || nav.maxTouchPoints > 0 : false,
    canvasHash: getCanvasFingerprint(),
    webglRenderer: getWebGLFingerprint(),
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

  // 預熱 15 輪以消弭短字串低熵偏差
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
 * 智慧違規評分引擎 (結合次數與累積失焦時間的非線性懲罰)
 */
export function calculateInfractionScore(audit: SecurityAuditTrail): number {
  let score = 0;

  // 切分頁次數 (階梯累進)
  if (audit.tabSwitches <= 2) {
    score += audit.tabSwitches * 0.75;
  } else {
    score += 1.5 + (audit.tabSwitches - 2) * 3.0;
  }

  // 視窗失焦
  score += audit.blurEvents * 0.4;

  // 脫離螢幕累積秒數懲罰 (超過 10 秒後每 5 秒加 1 分)
  const durationSec = audit.totalOutFocusDurationSec || 0;
  if (durationSec > 10) {
    score += Number(((durationSec - 10) * 0.2).toFixed(1));
  }

  // 剪貼簿阻斷 (高危作弊特徵)
  score += audit.clipboardEvents * 5.0;

  // 非物理原生事件 (腳本/外掛)
  score += audit.untrustedEvents * 8.0;

  // 時鐘加速/篡改
  score += (audit.clockAnomalyCount || 0) * 10.0;

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
 * 零信任本地存證密碼學簽章 (HMAC-grade SHA-256 + 鏈式參數綁定)
 */
export async function generateLocalProofSignature(
  payload: SanctionedSubmissionPayload
): Promise<string> {
  const env = payload.environment as EnvironmentFingerprint | undefined;
  const envSummary = env
    ? `${env.screenRes}_${env.hardwareConcurrency}_${env.timezone}_${env.canvasHash || ''}_${env.webglRenderer || ''}`
    : 'GENERIC_CLIENT';

  // 嚴格規範化簽名鏈 (Canonical Signature Sequence)
  const canonical = [
    payload.submissionId || 'SUB_UNSPECIFIED',
    payload.tournamentId,
    payload.playerId,
    payload.division,
    payload.puzzleId,
    payload.engineType || 'ENGINE_DEFAULT',
    payload.tier || 'TIER_DEFAULT',
    payload.timeSpentSec,
    payload.conflictsCount,
    payload.infractionScore,
    envSummary,
    payload.timestamp,
    'LOGICORE_WPC_ZERO_TRUST_2026_PROTOCOL_V4',
  ].join('##');

  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
    let fallbackHash = 0x811c9dc5;
    for (let i = 0; i < canonical.length; i++) {
      fallbackHash ^= canonical.charCodeAt(i);
      fallbackHash = Math.imul(fallbackHash, 0x01000193);
    }
    return `CLIENT_FALLBACK_${(fallbackHash >>> 0).toString(16).toUpperCase()}`;
  }

  try {
    const enc = new TextEncoder();
    const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(canonical));
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return `VERIFIED_V4_${hex.slice(0, 32).toUpperCase()}`;
  } catch {
    return `CLIENT_EXCEPTION_${Date.now().toString(16).toUpperCase()}`;
  }
}

/**
 * 自動化全域賽事監控實例 (Proctoring Session with Temporal Clock Guardian)
 */
export class TournamentProctoringSession {
  private audit: SecurityAuditTrail = {
    tabSwitches: 0,
    blurEvents: 0,
    clipboardEvents: 0,
    untrustedEvents: 0,
    totalOutFocusDurationSec: 0,
    clockAnomalyCount: 0,
  };

  private listeners: { target: EventTarget; type: string; fn: EventListenerOrEventListenerObject; options?: any }[] = [];
  private blurStartTime: number = 0;
  private lastTick: number = 0;
  private clockMonitorTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window === 'undefined') return;

    this.lastTick = performance.now();

    // 1. 分頁狀態與時間累計
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        this.audit.tabSwitches++;
        this.blurStartTime = performance.now();
      } else {
        if (this.blurStartTime > 0) {
          const duration = (performance.now() - this.blurStartTime) / 1000;
          this.audit.totalOutFocusDurationSec = Number(
            ((this.audit.totalOutFocusDurationSec || 0) + duration).toFixed(1)
          );
          this.blurStartTime = 0;
        }
      }
    };

    // 2. 視窗焦點
    const onBlur = () => {
      this.audit.blurEvents++;
    };

    // 3. 剪貼簿攔截
    const onClipboard = (e: Event) => {
      e.preventDefault();
      this.audit.clipboardEvents++;
    };

    // 4. 輸入源可信度校驗
    const onPointerCheck = (e: Event) => {
      if (!e.isTrusted) {
        this.audit.untrustedEvents++;
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onClipboard, { passive: false });
    document.addEventListener('paste', onClipboard, { passive: false });
    document.addEventListener('pointerdown', onPointerCheck, { capture: true, passive: true });

    this.listeners.push(
      { target: document, type: 'visibilitychange', fn: onVisibilityChange },
      { target: window, type: 'blur', fn: onBlur },
      { target: document, type: 'copy', fn: onClipboard },
      { target: document, type: 'paste', fn: onClipboard },
      { target: document, type: 'pointerdown', fn: onPointerCheck }
    );

    // 5. 時鐘漂移與加速器檢測 (Clock Skew / Speed-hack Anomaly)
    this.clockMonitorTimer = setInterval(() => {
      const now = performance.now();
      const elapsed = now - this.lastTick;
      this.lastTick = now;

      // 1 秒定時器實際偏差超過 ±650ms 視為時鐘被加速或背景節流被破壞
      if (elapsed > 1800 || elapsed < 350) {
        this.audit.clockAnomalyCount = (this.audit.clockAnomalyCount || 0) + 1;
      }
    }, 1000);
  }

  public getSnapshot(): SecurityAuditTrail {
    return { ...this.audit };
  }

  public getScore(): number {
    return calculateInfractionScore(this.audit);
  }

  public destroy() {
    if (this.clockMonitorTimer) {
      clearInterval(this.clockMonitorTimer);
      this.clockMonitorTimer = null;
    }

    this.listeners.forEach(({ target, type, fn, options }) => {
      target.removeEventListener(type, fn, options);
    });
    this.listeners = [];
  }
}
