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
  clockAnomalyCount?: number;        // 雙時間源顯著漂移異常次數
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
 * 採集 WebGL 硬體渲染器資訊（先清洗欄位再拼接）
 */
function getWebGLFingerprint(): string {
  if (typeof document === 'undefined') return 'SSR';
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'NO_WEBGL';

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (!debugInfo) return 'NO_DEBUG_INFO';

    const clean = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '_').trim();
    const vendor = clean(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '');
    const renderer = clean(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '');
    return `${vendor}::${renderer}`;
  } catch {
    return 'WEBGL_BLOCKED';
  }
}

/**
 * 採集幾何與純字元抗鋸齒 Canvas 指紋（排除跨 OS 渲染漂移之系統 Emoji）
 */
function getCanvasFingerprint(): string {
  if (typeof document === 'undefined') return 'SSR';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'NO_CANVAS';

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
    ctx.fillText('WPC-ALPHA-PI-OMEGA-SECT', 100, 50);

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

let cachedFingerprint: EnvironmentFingerprint | null = null;

/**
 * 採集客戶端環境指紋（具備單 Session 記憶體快取）
 */
export function getEnvironmentFingerprint(forceRefresh = false): EnvironmentFingerprint {
  if (cachedFingerprint && !forceRefresh) {
    return cachedFingerprint;
  }

  const nav = typeof window !== 'undefined' ? window.navigator : ({} as any);
  const scr = typeof window !== 'undefined' ? window.screen : ({} as any);

  cachedFingerprint = {
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

  return cachedFingerprint;
}

/**
 * 確定性偽隨機數生成器 (Mulberry32)
 * 
 * ⚠️ 安全警告：非密碼學 PRNG。賽事出題種子若具防窺需求，必須由後端下發。
 */
export function createSeededRandom(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

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
 * @deprecated 僅供本機 UI 顯示參考（如個人即時專注度指標）。
 * ⚠️ 官方賽事裁決嚴禁依賴客戶端計算之評分，伺服器應直接消費 getSnapshot() 原始稽核訊號進行後端裁決。
 */
export function calculateInfractionScore(audit: SecurityAuditTrail): number {
  let score = 0;

  if (audit.tabSwitches <= 2) {
    score += audit.tabSwitches * 0.75;
  } else {
    score += 1.5 + (audit.tabSwitches - 2) * 3.0;
  }

  score += audit.blurEvents * 0.4;

  // 採用飽和指數曲線：最大上限 25 分，避免過夜或掛機導致分數無限爆炸
  const durationSec = audit.totalOutFocusDurationSec || 0;
  if (durationSec > 10) {
    const saturatedDurationScore = 25 * (1 - Math.exp(-(durationSec - 10) / 120));
    score += Number(saturatedDurationScore.toFixed(1));
  }

  score += audit.clipboardEvents * 5.0;
  score += audit.untrustedEvents * 8.0;
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
 * 本地提交資料完整性校驗碼 (Local Submission Integrity Checksum)
 * 
 * ⚠️ 安全聲明：非伺服器級 HMAC，僅防手動竄改 JSON。競賽級防作弊需仰賴後端簽章。
 */
export async function generateLocalProofSignature(
  payload: SanctionedSubmissionPayload
): Promise<string> {
  const env = payload.environment as EnvironmentFingerprint | undefined;
  const envSummary = env
    ? `${env.screenRes}_${env.hardwareConcurrency}_${env.timezone}_${env.canvasHash || ''}_${env.webglRenderer || ''}`
    : 'GENERIC_CLIENT';

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
    'LOGICORE_WPC_INTEGRITY_PROTOCOL_V4',
  ].join('##');

  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
    let fallbackHash = 0x811c9dc5;
    for (let i = 0; i < canonical.length; i++) {
      fallbackHash ^= canonical.charCodeAt(i);
      fallbackHash = Math.imul(fallbackHash, 0x01000193);
    }
    return `CLIENT_CHECKSUM_${(fallbackHash >>> 0).toString(16).toUpperCase()}`;
  }

  try {
    const enc = new TextEncoder();
    const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(canonical));
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return `LOCAL_CHECKSUM_${hex.slice(0, 32).toUpperCase()}`;
  } catch {
    return `CLIENT_EXCEPTION_${Date.now().toString(16).toUpperCase()}`;
  }
}

/**
 * 全域賽事行為監控實例 (Tournament Proctoring Session)
 * 
 * ⚠️ 邊界極限說明：
 * 1. isTrusted 僅攔截未封裝之 dispatchEvent 合成事件，無法抵禦 CDP/Puppeteer/硬體巨集等底層模擬。
 * 2. 睡眠恢復豁免：漂移超過 300 秒判定為筆電闔蓋或系統掛起，不視為惡意時鐘加速。
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

  private listeners: {
    target: EventTarget;
    type: string;
    fn: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
  }[] = [];

  private blurStartTime: number = 0;
  private lastPerfTick: number = 0;
  private lastWallTick: number = 0;
  private clockMonitorTimer: ReturnType<typeof setInterval> | null = null;
  private isTabHidden: boolean = false;

  constructor() {
    if (typeof window === 'undefined') return;

    this.lastPerfTick = performance.now();
    this.lastWallTick = Date.now();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        this.isTabHidden = true;
        this.audit.tabSwitches++;
        this.blurStartTime = performance.now();
      } else {
        this.isTabHidden = false;
        if (this.blurStartTime > 0) {
          const duration = (performance.now() - this.blurStartTime) / 1000;
          this.audit.totalOutFocusDurationSec = Number(
            ((this.audit.totalOutFocusDurationSec || 0) + duration).toFixed(1)
          );
          this.blurStartTime = 0;
        }
        // 切回前景時，重新校準基準
        this.lastPerfTick = performance.now();
        this.lastWallTick = Date.now();
      }
    };

    const onBlur = () => {
      if (!this.isTabHidden) {
        this.audit.blurEvents++;
      }
    };

    const onClipboard = () => {
      this.audit.clipboardEvents++;
    };

    const onPointerCheck = (e: Event) => {
      if (!e.isTrusted) {
        this.audit.untrustedEvents++;
      }
    };

    const pointerOptions: AddEventListenerOptions = { capture: true, passive: true };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onClipboard, { passive: true });
    document.addEventListener('paste', onClipboard, { passive: true });
    document.addEventListener('pointerdown', onPointerCheck, pointerOptions);

    this.listeners.push(
      { target: document, type: 'visibilitychange', fn: onVisibilityChange },
      { target: window, type: 'blur', fn: onBlur },
      { target: document, type: 'copy', fn: onClipboard },
      { target: document, type: 'paste', fn: onClipboard },
      { target: document, type: 'pointerdown', fn: onPointerCheck, options: pointerOptions }
    );

    this.clockMonitorTimer = setInterval(() => {
      const nowPerf = performance.now();
      const nowWall = Date.now();

      if (document.visibilityState !== 'visible') {
        this.lastPerfTick = nowPerf;
        this.lastWallTick = nowWall;
        return;
      }

      const perfElapsed = nowPerf - this.lastPerfTick;
      const wallElapsed = nowWall - this.lastWallTick;
      this.lastPerfTick = nowPerf;
      this.lastWallTick = nowWall;

      const drift = Math.abs(wallElapsed - perfElapsed);
      // 5 秒 ~ 300 秒之間視為可疑篡改；超過 300 秒（5 分鐘）視為筆電闔蓋休眠或系統掛起喚醒，排除誤判
      if (drift > 5000 && drift < 300_000) {
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
