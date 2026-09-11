// web-frontend/src/contexts/AntiCheatContext.tsx
import React, { createContext, useContext, useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useLanguage } from './LanguageContext';
import { SecurityAuditTrail } from '../utils/tournamentSecurity';

export type ViolationCategory =
  | 'tab_switch'
  | 'window_blur'
  | 'clipboard'
  | 'context_menu'
  | 'devtools_hotkey'
  | 'devtools_geometry'
  | 'clock_anomaly'
  | 'untrusted_input'
  | 'cadence_speed';

export type CadenceHistogram = readonly [number, number, number, number, number, number];

export interface AuditEventEntry {
  readonly seq: number;
  readonly t: number; // 相對開賽的精確單調毫秒 (monotonic time)
  readonly category: ViolationCategory;
  readonly prevHash: string;
  readonly eventHash: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface EnvironmentFingerprint {
  readonly userAgent: string;
  readonly language: string;
  readonly timeZone: string;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly devicePixelRatio: number;
  readonly hardwareConcurrency: number;
  readonly maxTouchPoints: number;
}

export interface ExtendedSecurityAuditTrail extends SecurityAuditTrail {
  devToolsOpenEvents: number;
  clockAnomalies: number;
  unnaturalSpeedEvents: number;
  contextMenuBlocks: number;
  sessionStartTime: number;
  eventStream: readonly AuditEventEntry[];
  totalEventCount: number;
  rollingHash: string;
  cadenceHistogram: CadenceHistogram;
  cadenceBaselineMedian?: number;
  environment: EnvironmentFingerprint;
  submissionAttestation: string;
}

interface AntiCheatActionsContextValue {
  verifyTrustedInput: (e?: UIEvent) => boolean;
  getAuditSnapshot: () => Promise<ExtendedSecurityAuditTrail>;
  getAuditSnapshotSync: () => ExtendedSecurityAuditTrail;
  resetAudit: () => void;
  setMonitoringActive: (active: boolean) => void;
  setSessionNonce: (nonce: string) => void;
}

interface AntiCheatAlertContextValue {
  violationAlert: string | null;
  violationCode: ViolationCategory | null;
}

const AntiCheatActionsContext = createContext<AntiCheatActionsContextValue | null>(null);
const AntiCheatAlertContext = createContext<AntiCheatAlertContextValue | null>(null);

const INSPECT_KEYS = new Set(['I', 'i', 'J', 'j', 'C', 'c']);
const DEVTOOLS_DIMENSION_THRESHOLD = 160;
const VIBRATION_PATTERN = [80, 40, 80, 40, 120];
const CATEGORY_THROTTLE_MS = 1000;
const CADENCE_BASELINE_SAMPLES = 20;
const MAX_EVENT_STREAM_SIZE = 1000;
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

const VIOLATION_MESSAGES: Record<ViolationCategory, { zh: string; en: string }> = {
  tab_switch: {
    zh: '⚠️ 賽事違規：偵測到分頁切換 (Tab Switch)',
    en: '⚠️ Tournament Violation: Tab Switch Detected',
  },
  window_blur: {
    zh: '⚠️ 賽事違規：視窗焦點喪失 (Window Blur)',
    en: '⚠️ Tournament Violation: Window Focus Lost',
  },
  clipboard: {
    zh: '🚫 賽事違規：嚴禁使用剪貼簿',
    en: '🚫 Tournament Violation: Clipboard Prohibited',
  },
  context_menu: {
    zh: '🚫 賽事環境：已禁用右鍵檢查功能',
    en: '🚫 Context Menu / Inspection Prohibited',
  },
  devtools_hotkey: {
    zh: '🚫 安全警報：攔截到除錯快捷鍵',
    en: '🚫 Security Alert: Developer Hotkey Intercepted',
  },
  devtools_geometry: {
    zh: '⚠️ 賽事警報：檢測到 DevTools 視窗開啟',
    en: '⚠️ Security Alert: Inspection Console Detected',
  },
  clock_anomaly: {
    zh: '⚠️ 異常警報：偵測到本機時鐘持續異常或加速',
    en: '⚠️ Security Alert: Persistent Clock Skew Detected',
  },
  untrusted_input: {
    zh: '🚫 拒絕非人類輸入源 (Untrusted Synthetic Event)',
    en: '🚫 Rejected Synthetic Input Source (Untrusted Event)',
  },
  cadence_speed: {
    zh: '⚠️ 輸入頻率異常（疑似自動化外掛腳本）',
    en: '⚠️ Unnatural Input Cadence (Automated Input Suspected)',
  },
};

function captureEnvironmentFingerprint(): EnvironmentFingerprint {
  if (typeof window === 'undefined') {
    return {
      userAgent: 'SERVER_ENV',
      language: 'en',
      timeZone: 'UTC',
      screenWidth: 0,
      screenHeight: 0,
      devicePixelRatio: 1,
      hardwareConcurrency: 1,
      maxTouchPoints: 0,
    };
  }

  return Object.freeze({
    userAgent: navigator.userAgent || 'UNKNOWN',
    language: navigator.language || 'en',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    screenWidth: window.screen?.width || window.innerWidth || 0,
    screenHeight: window.screen?.height || window.innerHeight || 0,
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
    maxTouchPoints: navigator.maxTouchPoints || 0,
  });
}

async function computeSha256(payload: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return `NOCRYPTO_${Date.now().toString(36)}`;
  }
  try {
    const data = new TextEncoder().encode(payload);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return `HASH_FAILED_${Date.now().toString(36)}`;
  }
}

function fastMurmur32(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const AntiCheatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const [violationCode, setViolationCode] = useState<ViolationCategory | null>(null);

  const isActiveRef = useRef<boolean>(false);
  const sessionNonceRef = useRef<string>('INIT_LOCAL_NONCE');
  const sessionMonotonicOriginRef = useRef<number>(performance.now());
  const sessionEpochStartRef = useRef<number>(Date.now());

  const eventStreamRef = useRef<AuditEventEntry[]>([]);
  const totalEventCountRef = useRef<number>(0);
  const rollingHashRef = useRef<string>(GENESIS_HASH);

  const auditCountersRef = useRef({
    tabSwitches: 0,
    blurEvents: 0,
    clipboardEvents: 0,
    untrustedEvents: 0,
    devToolsOpenEvents: 0,
    clockAnomalies: 0,
    unnaturalSpeedEvents: 0,
    contextMenuBlocks: 0,
  });

  const isTabSwitchRef = useRef<boolean>(false);
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const devToolsOpenRef = useRef<boolean>(false);
  const consecutiveClockSkewRef = useRef<number>(0);

  const cadenceHistogramRef = useRef<[number, number, number, number, number, number]>([0, 0, 0, 0, 0, 0]);
  const initialCadenceSamplesRef = useRef<number[]>([]);
  const lockedBaselineMedianRef = useRef<number | null>(null);
  const lastActionTimeRef = useRef<number>(0);
  const consecutiveOutliersRef = useRef<number>(0);

  const categoryThrottleMapRef = useRef<Map<ViolationCategory, number>>(new Map());

  const appendAuditEvent = useCallback((category: ViolationCategory, meta?: Record<string, unknown>) => {
    totalEventCountRef.current += 1;
    const seq = totalEventCountRef.current;
    const t = Math.max(0, Math.round(performance.now() - sessionMonotonicOriginRef.current));
    const prevHash = rollingHashRef.current;

    const safeMeta = meta ? Object.freeze({ ...meta }) : undefined;
    const rawPayload = `${seq}:${t}:${category}:${JSON.stringify(safeMeta || {})}:${prevHash}`;
    const eventHash = fastMurmur32(rawPayload);
    rollingHashRef.current = eventHash;

    if (eventStreamRef.current.length < MAX_EVENT_STREAM_SIZE) {
      eventStreamRef.current.push({
        seq,
        t,
        category,
        prevHash,
        eventHash,
        meta: safeMeta,
      });
    }
  }, []);

  const triggerAlert = useCallback((category: ViolationCategory, meta?: Record<string, unknown>) => {
    appendAuditEvent(category, meta);

    switch (category) {
      case 'tab_switch': auditCountersRef.current.tabSwitches++; break;
      case 'window_blur': auditCountersRef.current.blurEvents++; break;
      case 'clipboard': auditCountersRef.current.clipboardEvents++; break;
      case 'context_menu': auditCountersRef.current.contextMenuBlocks++; break;
      case 'devtools_hotkey':
      case 'devtools_geometry': auditCountersRef.current.devToolsOpenEvents++; break;
      case 'clock_anomaly': auditCountersRef.current.clockAnomalies++; break;
      case 'untrusted_input': auditCountersRef.current.untrustedEvents++; break;
      case 'cadence_speed': auditCountersRef.current.unnaturalSpeedEvents++; break;
    }

    const now = performance.now();
    const lastTriggered = categoryThrottleMapRef.current.get(category) ?? 0;
    if (now - lastTriggered < CATEGORY_THROTTLE_MS) return;
    categoryThrottleMapRef.current.set(category, now);

    setViolationCode(category);

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (!prefersReducedMotion) {
          navigator.vibrate(VIBRATION_PATTERN);
        }
      } catch {
        // 忽略受安全策略限制的振動拒絕
      }
    }

    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    alertTimerRef.current = setTimeout(() => {
      setViolationCode(null);
      alertTimerRef.current = null;
    }, 3500);
  }, [appendAuditEvent]);

  useEffect(() => {
    const handleVisibility = () => {
      if (!isActiveRef.current) return;

      if (document.hidden) {
        isTabSwitchRef.current = true;
        triggerAlert('tab_switch');
      } else {
        if (tabResetTimerRef.current) clearTimeout(tabResetTimerRef.current);
        tabResetTimerRef.current = setTimeout(() => {
          isTabSwitchRef.current = false;
        }, 200);
      }
    };

    const handleBlur = () => {
      if (!isActiveRef.current || isTabSwitchRef.current || document.hidden) return;
      triggerAlert('window_blur');
    };

    const handleClipboard = (e: ClipboardEvent) => {
      if (!isActiveRef.current) return;
      e.preventDefault();
      triggerAlert('clipboard');
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (!isActiveRef.current) return;
      e.preventDefault();
      triggerAlert('context_menu');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveRef.current) return;

      const isF12 = e.key === 'F12';
      const isInspect =
        (e.ctrlKey || e.metaKey) && e.shiftKey && INSPECT_KEYS.has(e.key);
      const isViewSource =
        (e.ctrlKey || e.metaKey) && (e.key === 'U' || e.key === 'u');

      if (isF12 || isInspect || isViewSource) {
        e.preventDefault();
        e.stopPropagation();
        triggerAlert('devtools_hotkey', { key: e.key });
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('paste', handleClipboard);
    document.addEventListener('copy', handleClipboard);
    document.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('paste', handleClipboard);
      document.removeEventListener('copy', handleClipboard);
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown, true);

      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
      if (tabResetTimerRef.current) clearTimeout(tabResetTimerRef.current);
    };
  }, [triggerAlert]);

  const [monitoringEnabled, setMonitoringEnabled] = useState<boolean>(false);

  useEffect(() => {
    if (!monitoringEnabled) return;

    const devToolsTimer = setInterval(() => {
      if (!isActiveRef.current || typeof window === 'undefined') return;

      const isFinePointer = window.matchMedia?.('(pointer: fine)').matches ?? true;
      if (!isFinePointer) return;

      const widthDiff = window.outerWidth - window.innerWidth > DEVTOOLS_DIMENSION_THRESHOLD;
      const heightDiff = window.outerHeight - window.innerHeight > DEVTOOLS_DIMENSION_THRESHOLD;

      if (widthDiff || heightDiff) {
        if (!devToolsOpenRef.current) {
          devToolsOpenRef.current = true;
          triggerAlert('devtools_geometry', {
            wDiff: window.outerWidth - window.innerWidth,
            hDiff: window.outerHeight - window.innerHeight,
          });
        }
      } else {
        devToolsOpenRef.current = false;
      }
    }, 2000);

    let lastTick = performance.now();
    const clockTimer = setInterval(() => {
      const now = performance.now();
      const delta = now - lastTick;
      lastTick = now;

      if (!isActiveRef.current || document.hidden) {
        consecutiveClockSkewRef.current = 0;
        return;
      }

      if (delta > 2200 || delta < 250) {
        consecutiveClockSkewRef.current += 1;
        if (consecutiveClockSkewRef.current >= 3) {
          consecutiveClockSkewRef.current = 0;
          triggerAlert('clock_anomaly', { deltaMs: Math.round(delta) });
        }
      } else {
        consecutiveClockSkewRef.current = 0;
      }
    }, 1000);

    return () => {
      clearInterval(devToolsTimer);
      clearInterval(clockTimer);
    };
  }, [monitoringEnabled, triggerAlert]);

  const verifyTrustedInput = useCallback(
    (e?: UIEvent): boolean => {
      if (!isActiveRef.current) return true;

      if (e && !e.isTrusted) {
        triggerAlert('untrusted_input');
        return false;
      }

      const now = performance.now();
      if (lastActionTimeRef.current > 0) {
        const delta = now - lastActionTimeRef.current;

        if (delta < 20) cadenceHistogramRef.current[0]++;
        else if (delta < 40) cadenceHistogramRef.current[1]++;
        else if (delta < 70) cadenceHistogramRef.current[2]++;
        else if (delta < 120) cadenceHistogramRef.current[3]++;
        else if (delta < 250) cadenceHistogramRef.current[4]++;
        else cadenceHistogramRef.current[5]++;

        if (lockedBaselineMedianRef.current === null) {
          initialCadenceSamplesRef.current.push(delta);
          if (initialCadenceSamplesRef.current.length >= CADENCE_BASELINE_SAMPLES) {
            const sorted = [...initialCadenceSamplesRef.current].sort((a, b) => a - b);
            lockedBaselineMedianRef.current = sorted[Math.floor(sorted.length / 2)] || 100;
          }
        }

        const effectiveBaseline = lockedBaselineMedianRef.current ?? 100;
        const isSpike = delta < 20 || (delta < effectiveBaseline * 0.15 && delta < 45);

        if (isSpike) {
          consecutiveOutliersRef.current += 1;
          if (consecutiveOutliersRef.current >= 4) {
            consecutiveOutliersRef.current = 0;
            triggerAlert('cadence_speed', { deltaMs: Math.round(delta), baseline: effectiveBaseline });
            return false;
          }
        } else {
          consecutiveOutliersRef.current = 0;
        }
      }
      lastActionTimeRef.current = now;
      return true;
    },
    [triggerAlert]
  );

  // 避免數組展開被推導為 number[]，明確約束 6 元 Tuple
  const getAuditSnapshotSync = useCallback((): ExtendedSecurityAuditTrail => {
    const [c0, c1, c2, c3, c4, c5] = cadenceHistogramRef.current;
    return {
      ...auditCountersRef.current,
      sessionStartTime: sessionEpochStartRef.current,
      eventStream: [...eventStreamRef.current],
      totalEventCount: totalEventCountRef.current,
      rollingHash: rollingHashRef.current,
      cadenceHistogram: [c0, c1, c2, c3, c4, c5],
      cadenceBaselineMedian: lockedBaselineMedianRef.current ?? undefined,
      environment: captureEnvironmentFingerprint(),
      submissionAttestation: 'UNVERIFIED_LOCAL_SNAPSHOT',
    };
  }, []);

  const getAuditSnapshot = useCallback(async (): Promise<ExtendedSecurityAuditTrail> => {
    const rawCounters = { ...auditCountersRef.current };
    const totalCount = totalEventCountRef.current;
    const finalRollingHash = rollingHashRef.current;
    const env = captureEnvironmentFingerprint();
    const [c0, c1, c2, c3, c4, c5] = cadenceHistogramRef.current;
    const histogram: CadenceHistogram = [c0, c1, c2, c3, c4, c5];

    const claimPayload = JSON.stringify({
      nonce: sessionNonceRef.current,
      startEpoch: sessionEpochStartRef.current,
      endEpoch: Date.now(),
      totalEvents: totalCount,
      chainHead: finalRollingHash,
      counters: rawCounters,
      cadenceHistogram: histogram,
      envHash: fastMurmur32(JSON.stringify(env)),
    });

    const attestation = await computeSha256(claimPayload);

    return {
      ...rawCounters,
      sessionStartTime: sessionEpochStartRef.current,
      eventStream: [...eventStreamRef.current],
      totalEventCount: totalCount,
      rollingHash: finalRollingHash,
      cadenceHistogram: histogram,
      cadenceBaselineMedian: lockedBaselineMedianRef.current ?? undefined,
      environment: env,
      submissionAttestation: `ATTESTATION_V2_${attestation}`,
    };
  }, []);

  const resetAudit = useCallback(() => {
    sessionEpochStartRef.current = Date.now();
    sessionMonotonicOriginRef.current = performance.now();
    eventStreamRef.current = [];
    totalEventCountRef.current = 0;
    rollingHashRef.current = GENESIS_HASH;
    auditCountersRef.current = {
      tabSwitches: 0,
      blurEvents: 0,
      clipboardEvents: 0,
      untrustedEvents: 0,
      devToolsOpenEvents: 0,
      clockAnomalies: 0,
      unnaturalSpeedEvents: 0,
      contextMenuBlocks: 0,
    };
    cadenceHistogramRef.current = [0, 0, 0, 0, 0, 0];
    categoryThrottleMapRef.current.clear();
    initialCadenceSamplesRef.current = [];
    lockedBaselineMedianRef.current = null;
    consecutiveOutliersRef.current = 0;
    consecutiveClockSkewRef.current = 0;
    lastActionTimeRef.current = 0;
    setViolationCode(null);
    isTabSwitchRef.current = false;
    devToolsOpenRef.current = false;
  }, []);

  const setMonitoringActive = useCallback((active: boolean) => {
    isActiveRef.current = active;
    setMonitoringEnabled(active);
    if (active) {
      sessionEpochStartRef.current = Date.now();
      sessionMonotonicOriginRef.current = performance.now();
    } else {
      setViolationCode(null);
    }
  }, []);

  const setSessionNonce = useCallback((nonce: string) => {
    sessionNonceRef.current = nonce;
  }, []);

  const actionsValue = useMemo<AntiCheatActionsContextValue>(
    () => ({
      verifyTrustedInput,
      getAuditSnapshot,
      getAuditSnapshotSync,
      resetAudit,
      setMonitoringActive,
      setSessionNonce,
    }),
    [
      verifyTrustedInput,
      getAuditSnapshot,
      getAuditSnapshotSync,
      resetAudit,
      setMonitoringActive,
      setSessionNonce,
    ]
  );

  const alertValue = useMemo<AntiCheatAlertContextValue>(() => {
    return {
      violationAlert: violationCode
        ? isEn
          ? VIOLATION_MESSAGES[violationCode].en
          : VIOLATION_MESSAGES[violationCode].zh
        : null,
      violationCode,
    };
  }, [violationCode, isEn]);

  return (
    <AntiCheatActionsContext.Provider value={actionsValue}>
      <AntiCheatAlertContext.Provider value={alertValue}>
        {children}
      </AntiCheatAlertContext.Provider>
    </AntiCheatActionsContext.Provider>
  );
};

export const useAntiCheatActions = () => {
  const context = useContext(AntiCheatActionsContext);
  if (!context) {
    throw new Error('useAntiCheatActions must be used within an AntiCheatProvider');
  }
  return context;
};

export const useAntiCheatAlert = () => {
  const context = useContext(AntiCheatAlertContext);
  if (!context) {
    throw new Error('useAntiCheatAlert must be used within an AntiCheatProvider');
  }
  return context;
};

export const useAntiCheat = () => {
  const actions = useAntiCheatActions();
  const alert = useAntiCheatAlert();
  return { ...actions, ...alert };
};
