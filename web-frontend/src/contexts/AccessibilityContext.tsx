// web-frontend/src/contexts/AccessibilityContext.tsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useLanguage } from './LanguageContext';

export type ColorBlindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';
export type TextScaleRatio = 100 | 125 | 150 | 200; // 遵循 WCAG 1.4.4: 支援 200% 等比縮放

export interface AccessibilitySettings {
  highContrast: boolean;
  reducedMotion: boolean; // 遵循 WCAG 2.3.3
  textScale: TextScaleRatio; // 遵循 WCAG 1.4.4: 4 檔等比縮放階梯
  colorBlindMode: ColorBlindMode; // 補償性高對比調色板與幾何雙通道 (WCAG 1.4.1)
  soundFeedback: boolean;
  hapticFeedback: boolean;
  screenReaderOptimized: boolean;
}

export interface ColorBlindOptionMeta {
  key: ColorBlindMode;
  label: string;
  description: string;
}

export type SoundEffectType = 'click' | 'step' | 'success' | 'conflict' | 'alert' | 'hint';

export interface A11yAuditRecord {
  readonly timestamp: number;
  readonly source: 'user' | 'system' | 'storage' | 'migration' | 'reset';
  readonly key: keyof AccessibilitySettings | 'motionOverride' | 'contrastOverride';
  readonly from: unknown;
  readonly to: unknown;
}

export interface AccessibilityActions {
  toggleHighContrast: () => void;
  toggleReducedMotion: () => void;
  setTextScale: (scale: TextScaleRatio) => void;
  cycleTextScale: () => void;
  setColorBlindMode: (mode: ColorBlindMode) => void;
  toggleSoundFeedback: () => void;
  toggleHapticFeedback: () => void;
  toggleScreenReaderOptimized: () => void;
  resetSettings: () => void;
  clearMotionOverride: () => void;
  clearContrastOverride: () => void;
  playSound: (type: SoundEffectType) => void;
  announce: (message: string, priority?: 'polite' | 'assertive') => void;
  getAuditLog: () => readonly A11yAuditRecord[];
  clearAuditLog: () => void;
}

interface StoredOverrides {
  motion: boolean;
  contrast: boolean;
}

interface PersistedState {
  version: 6;
  settings: AccessibilitySettings;
  overrides: StoredOverrides;
}

const AccessibilitySettingsContext = createContext<AccessibilitySettings | undefined>(undefined);
const AccessibilityActionsContext = createContext<AccessibilityActions | undefined>(undefined);

// 單一原子存儲 Key 與向後相容遷移鏈
const ATOMIC_STORAGE_KEY = 'LOGICORE_A11Y_STATE_V6';
const LEGACY_STORAGE_KEYS = [
  'LOGICORE_A11Y_SETTINGS',
  'LOGICORE_A11Y_SETTINGS_V5',
  'LOGICORE_A11Y_SETTINGS_V4',
  'LOGICORE_A11Y_SETTINGS_V3',
];
const LEGACY_OVERRIDES_KEY = 'LOGICORE_A11Y_OVERRIDES';

const LIVE_POLITE_ID = 'logicore-live-polite';
const LIVE_ASSERTIVE_ID = 'logicore-live-assertive';
const MAX_QUEUE_SIZE = 5;
const MAX_AUDIT_LOG_SIZE = 50;
const TEXT_SCALE_STEPS: readonly TextScaleRatio[] = [100, 125, 150, 200] as const;

const DEFAULT_SETTINGS: AccessibilitySettings = {
  highContrast: false,
  reducedMotion: false,
  textScale: 100,
  colorBlindMode: 'none',
  soundFeedback: true,
  hapticFeedback: true,
  screenReaderOptimized: false,
};

/**
 * 載入並遷移歷史版本的存儲設定，具備原子化結構與智慧意圖仲裁
 */
function loadPersistedState(): PersistedState {
  let rawAtomic: string | null = null;
  if (typeof localStorage !== 'undefined') {
    rawAtomic = localStorage.getItem(ATOMIC_STORAGE_KEY);
  }

  const systemPrefersReducedMotion = Boolean(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
  const systemPrefersHighContrast = Boolean(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-contrast: more)').matches
  );

  // 1. 若已有 V6 原子存檔，直接解析
  if (rawAtomic) {
    try {
      const parsed: PersistedState = JSON.parse(rawAtomic);
      if (parsed.version === 6 && parsed.settings && parsed.overrides) {
        const nextSettings = { ...DEFAULT_SETTINGS, ...parsed.settings };
        if (!parsed.overrides.motion) {
          nextSettings.reducedMotion = systemPrefersReducedMotion;
        }
        if (!parsed.overrides.contrast) {
          nextSettings.highContrast = systemPrefersHighContrast;
        }
        return {
          version: 6,
          settings: nextSettings,
          overrides: {
            motion: Boolean(parsed.overrides.motion),
            contrast: Boolean(parsed.overrides.contrast),
          },
        };
      }
    } catch {}
  }

  // 2. 舊版非原子化資料遷移
  let migratedSettings = { ...DEFAULT_SETTINGS };
  let migratedOverrides: StoredOverrides = { motion: false, contrast: false };

  if (typeof localStorage !== 'undefined') {
    // 嘗試讀取舊版 overrides
    const rawLegacyOverrides = localStorage.getItem(LEGACY_OVERRIDES_KEY);
    if (rawLegacyOverrides) {
      try {
        const parsed = JSON.parse(rawLegacyOverrides);
        migratedOverrides = {
          motion: Boolean(parsed.motion),
          contrast: Boolean(parsed.contrast),
        };
      } catch {}
    }

    // 嘗試讀取舊版 settings
    let rawLegacySettings: string | null = null;
    for (const key of LEGACY_STORAGE_KEYS) {
      rawLegacySettings = localStorage.getItem(key);
      if (rawLegacySettings) break;
    }

    if (rawLegacySettings) {
      try {
        const parsed = JSON.parse(rawLegacySettings);
        if (typeof parsed.largeText === 'boolean' && !parsed.textScale) {
          parsed.textScale = parsed.largeText ? 125 : 100;
        }

        // 若無舊版 overrides 記錄，比對當前系統偏好
        if (!rawLegacyOverrides) {
          if (typeof parsed.reducedMotion === 'boolean') {
            migratedOverrides.motion = parsed.reducedMotion !== systemPrefersReducedMotion;
          }
          if (typeof parsed.highContrast === 'boolean') {
            migratedOverrides.contrast = parsed.highContrast !== systemPrefersHighContrast;
          }
        }

        migratedSettings = { ...migratedSettings, ...parsed };
      } catch {}
    } else {
      migratedSettings.reducedMotion = systemPrefersReducedMotion;
      migratedSettings.highContrast = systemPrefersHighContrast;
    }
  }

  if (!migratedOverrides.motion) {
    migratedSettings.reducedMotion = systemPrefersReducedMotion;
  }
  if (!migratedOverrides.contrast) {
    migratedSettings.highContrast = systemPrefersHighContrast;
  }

  return {
    version: 6,
    settings: migratedSettings,
    overrides: migratedOverrides,
  };
}

function ensureLiveRegions() {
  if (typeof document === 'undefined') return;

  const createRegion = (id: string, role: string, live: string) => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.setAttribute('role', role);
      el.setAttribute('aria-live', live);
      el.setAttribute('aria-atomic', 'true');
      el.setAttribute('aria-relevant', 'additions text');
      el.style.cssText =
        'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;pointer-events:none;';
      document.body.appendChild(el);
    }
  };

  createRegion(LIVE_POLITE_ID, 'status', 'polite');
  createRegion(LIVE_ASSERTIVE_ID, 'alert', 'assertive');
}

export const AccessibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. 狀態初始化（以 useState 惰性回呼保證生命週期只執行一次）
  const [initialData] = useState(() => loadPersistedState());
  const [settings, setSettings] = useState<AccessibilitySettings>(initialData.settings);

  // 使用者覆寫意圖標記
  const userOverrodeMotionRef = useRef<boolean>(initialData.overrides.motion);
  const userOverrodeContrastRef = useRef<boolean>(initialData.overrides.contrast);

  const settingsRef = useRef<AccessibilitySettings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // 本地記憶體審計日誌（恪守隱私，絕不上傳）
  const auditLogRef = useRef<A11yAuditRecord[]>([]);
  const logA11yEvent = useCallback(
    (source: A11yAuditRecord['source'], key: A11yAuditRecord['key'], from: unknown, to: unknown) => {
      if (auditLogRef.current.length >= MAX_AUDIT_LOG_SIZE) {
        auditLogRef.current.shift();
      }
      auditLogRef.current.push({
        timestamp: Date.now(),
        source,
        key,
        from,
        to,
      });
    },
    []
  );

  // 2. DOM 雙通道 Live Regions 初始化
  useEffect(() => {
    ensureLiveRegions();
  }, []);

  // 3. 系統偏好動態即時監聽（純函數先算後設，受人本覆寫保護）
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const contrastQuery = window.matchMedia('(prefers-contrast: more)');

    const handleMotionChange = (e: MediaQueryListEvent) => {
      if (userOverrodeMotionRef.current) return;
      const prev = settingsRef.current;
      if (prev.reducedMotion === e.matches) return;

      const next = { ...prev, reducedMotion: e.matches };
      settingsRef.current = next;
      logA11yEvent('system', 'reducedMotion', prev.reducedMotion, e.matches);
      setSettings(next);
    };

    const handleContrastChange = (e: MediaQueryListEvent) => {
      if (userOverrodeContrastRef.current) return;
      const prev = settingsRef.current;
      if (prev.highContrast === e.matches) return;

      const next = { ...prev, highContrast: e.matches };
      settingsRef.current = next;
      logA11yEvent('system', 'highContrast', prev.highContrast, e.matches);
      setSettings(next);
    };

    motionQuery.addEventListener('change', handleMotionChange);
    contrastQuery.addEventListener('change', handleContrastChange);

    return () => {
      motionQuery.removeEventListener('change', handleMotionChange);
      contrastQuery.removeEventListener('change', handleContrastChange);
    };
  }, [logA11yEvent]);

  // 4. 跨分頁原子化即時同步（原子解析 + 逐欄位真實差分日誌）
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== ATOMIC_STORAGE_KEY || !e.newValue) return;

      try {
        const payload: PersistedState = JSON.parse(e.newValue);
        if (payload.version !== 6 || !payload.settings || !payload.overrides) return;

        // 同步遠端分頁的 overrides 意圖
        userOverrodeMotionRef.current = payload.overrides.motion;
        userOverrodeContrastRef.current = payload.overrides.contrast;

        const prev = settingsRef.current;
        const incoming = payload.settings;

        const nextReducedMotion = userOverrodeMotionRef.current
          ? incoming.reducedMotion
          : prev.reducedMotion;
        const nextHighContrast = userOverrodeContrastRef.current
          ? incoming.highContrast
          : prev.highContrast;

        const merged: AccessibilitySettings = {
          ...prev,
          ...incoming,
          reducedMotion: nextReducedMotion,
          highContrast: nextHighContrast,
        };

        // 逐欄位差分審計，廢除硬編碼 textScale 偽日誌
        (Object.keys(merged) as (keyof AccessibilitySettings)[]).forEach((k) => {
          if (prev[k] !== merged[k]) {
            logA11yEvent('storage', k, prev[k], merged[k]);
          }
        });

        settingsRef.current = merged;
        setSettings(merged);
      } catch {}
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [logA11yEvent]);

  // 5. WCAG 樣式連動與防抖原子持久化
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    root.classList.toggle('a11y-high-contrast', settings.highContrast);
    root.classList.toggle('a11y-reduced-motion', settings.reducedMotion);
    root.classList.toggle('a11y-screen-reader', settings.screenReaderOptimized);

    root.style.setProperty('--a11y-font-scale', `${settings.textScale / 100}`);
    root.dataset.textScale = String(settings.textScale);
    root.dataset.colorblind = settings.colorBlindMode;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      try {
        const stateToPersist: PersistedState = {
          version: 6,
          settings,
          overrides: {
            motion: userOverrodeMotionRef.current,
            contrast: userOverrodeContrastRef.current,
          },
        };
        localStorage.setItem(ATOMIC_STORAGE_KEY, JSON.stringify(stateToPersist));
      } catch {}
    }, 250);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [settings]);

  // 6. 音訊上下文生命週期：前背景自動掛起與恢復
  useEffect(() => {
    const handleVisibility = () => {
      if (!audioCtxRef.current) return;
      if (document.hidden && audioCtxRef.current.state === 'running') {
        audioCtxRef.current.suspend().catch(() => {});
      } else if (!document.hidden && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  // 7. 零依賴程序化音效合成
  const playSound = useCallback((type: SoundEffectType) => {
    if (!settingsRef.current.soundFeedback || typeof window === 'undefined') return;

    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContextClass();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      switch (type) {
        case 'click':
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.exponentialRampToValueAtTime(880, now + 0.04);
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.04);
          osc.start(now);
          osc.stop(now + 0.04);
          break;

        case 'step':
          osc.type = 'sine';
          osc.frequency.setValueAtTime(523.25, now);
          gain.gain.setValueAtTime(0.06, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.06);
          osc.start(now);
          osc.stop(now + 0.06);
          break;

        case 'hint':
          osc.type = 'sine';
          osc.frequency.setValueAtTime(587.33, now);
          osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
          gain.gain.setValueAtTime(0.09, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.12);
          osc.start(now);
          osc.stop(now + 0.12);
          break;

        case 'conflict':
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(160, now);
          osc.frequency.linearRampToValueAtTime(110, now + 0.18);
          gain.gain.setValueAtTime(0.12, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.18);
          osc.start(now);
          osc.stop(now + 0.18);
          break;

        case 'alert':
          osc.type = 'square';
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.setValueAtTime(330, now + 0.08);
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.22);
          osc.start(now);
          osc.stop(now + 0.22);
          break;

        case 'success':
          [523.25, 659.25, 783.99, 1046.50].forEach((f, idx) => {
            const toneOsc = ctx.createOscillator();
            const toneGain = ctx.createGain();
            toneOsc.type = 'sine';
            toneOsc.frequency.setValueAtTime(f, now + idx * 0.06);
            toneGain.gain.setValueAtTime(0.08, now + idx * 0.06);
            toneGain.gain.linearRampToValueAtTime(0.001, now + idx * 0.06 + 0.2);
            toneOsc.connect(toneGain);
            toneGain.connect(ctx.destination);
            toneOsc.start(now + idx * 0.06);
            toneOsc.stop(now + idx * 0.06 + 0.2);
          });
          break;
      }
    } catch {}
  }, []);

  // 8. 雙獨立通道 ARIA Live Region 佇列架構
  const politeQueueRef = useRef<string[]>([]);
  const assertiveQueueRef = useRef<string[]>([]);
  const isPoliteBusyRef = useRef<boolean>(false);
  const isAssertiveBusyRef = useRef<boolean>(false);

  const politeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assertiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processPoliteQueue = useCallback(() => {
    if (isPoliteBusyRef.current || politeQueueRef.current.length === 0) return;

    isPoliteBusyRef.current = true;
    const msg = politeQueueRef.current.shift()!;
    const el = document.getElementById(LIVE_POLITE_ID);

    if (el) {
      el.textContent = '';
      if (politeTimerRef.current) clearTimeout(politeTimerRef.current);
      politeTimerRef.current = setTimeout(() => {
        el.textContent = msg;
        politeTimerRef.current = setTimeout(() => {
          isPoliteBusyRef.current = false;
          processPoliteQueue();
        }, 200);
      }, 50);
    } else {
      isPoliteBusyRef.current = false;
    }
  }, []);

  const processAssertiveQueue = useCallback(() => {
    if (isAssertiveBusyRef.current || assertiveQueueRef.current.length === 0) return;

    isAssertiveBusyRef.current = true;
    const msg = assertiveQueueRef.current.shift()!;
    const el = document.getElementById(LIVE_ASSERTIVE_ID);

    // 插播中斷：清空 DOM 並銷毀 Polite 佇列掛起的計時排程
    const politeEl = document.getElementById(LIVE_POLITE_ID);
    if (politeEl) politeEl.textContent = '';
    if (politeTimerRef.current) {
      clearTimeout(politeTimerRef.current);
      politeTimerRef.current = null;
    }
    isPoliteBusyRef.current = false;

    if (el) {
      el.textContent = '';
      if (assertiveTimerRef.current) clearTimeout(assertiveTimerRef.current);
      assertiveTimerRef.current = setTimeout(() => {
        el.textContent = msg;
        assertiveTimerRef.current = setTimeout(() => {
          isAssertiveBusyRef.current = false;
          processAssertiveQueue();
        }, 150);
      }, 30);
    } else {
      isAssertiveBusyRef.current = false;
    }
  }, []);

  const announce = useCallback(
    (message: string, priority: 'polite' | 'assertive' = 'polite') => {
      if (priority === 'polite' && !settingsRef.current.screenReaderOptimized) return;
      const clean = message.trim();
      if (!clean) return;

      if (priority === 'assertive') {
        if (assertiveQueueRef.current.length >= MAX_QUEUE_SIZE) {
          assertiveQueueRef.current.shift();
        }
        assertiveQueueRef.current.push(clean);
        processAssertiveQueue();
      } else {
        if (politeQueueRef.current.length >= MAX_QUEUE_SIZE) {
          politeQueueRef.current.shift();
        }
        politeQueueRef.current.push(clean);
        processPoliteQueue();
      }
    },
    [processPoliteQueue, processAssertiveQueue]
  );

  // 9. 狀態切換方法（純函數模式：外層計算並派發日誌，Updater 保持絕對無副作用）
  const toggleHighContrast = useCallback(() => {
    userOverrodeContrastRef.current = true;
    const prev = settingsRef.current;
    const next = { ...prev, highContrast: !prev.highContrast };
    settingsRef.current = next;
    logA11yEvent('user', 'highContrast', prev.highContrast, next.highContrast);
    setSettings(next);
  }, [logA11yEvent]);

  const toggleReducedMotion = useCallback(() => {
    userOverrodeMotionRef.current = true;
    const prev = settingsRef.current;
    const next = { ...prev, reducedMotion: !prev.reducedMotion };
    settingsRef.current = next;
    logA11yEvent('user', 'reducedMotion', prev.reducedMotion, next.reducedMotion);
    setSettings(next);
  }, [logA11yEvent]);

  const clearMotionOverride = useCallback(() => {
    userOverrodeMotionRef.current = false;
    const systemPrefers = Boolean(
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
    const prev = settingsRef.current;
    const next = { ...prev, reducedMotion: systemPrefers };
    settingsRef.current = next;
    logA11yEvent('user', 'motionOverride', true, false);
    setSettings(next);

    // 立即原子持久化，重新整理絕對不復發
    try {
      const stateToPersist: PersistedState = {
        version: 6,
        settings: next,
        overrides: {
          motion: false,
          contrast: userOverrodeContrastRef.current,
        },
      };
      localStorage.setItem(ATOMIC_STORAGE_KEY, JSON.stringify(stateToPersist));
    } catch {}
  }, [logA11yEvent]);

  const clearContrastOverride = useCallback(() => {
    userOverrodeContrastRef.current = false;
    const systemPrefers = Boolean(
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-contrast: more)').matches
    );
    const prev = settingsRef.current;
    const next = { ...prev, highContrast: systemPrefers };
    settingsRef.current = next;
    logA11yEvent('user', 'contrastOverride', true, false);
    setSettings(next);

    // 立即原子持久化
    try {
      const stateToPersist: PersistedState = {
        version: 6,
        settings: next,
        overrides: {
          motion: userOverrodeMotionRef.current,
          contrast: false,
        },
      };
      localStorage.setItem(ATOMIC_STORAGE_KEY, JSON.stringify(stateToPersist));
    } catch {}
  }, [logA11yEvent]);

  const setTextScale = useCallback(
    (scale: TextScaleRatio) => {
      const prev = settingsRef.current;
      if (prev.textScale === scale) return;
      const next = { ...prev, textScale: scale };
      settingsRef.current = next;
      logA11yEvent('user', 'textScale', prev.textScale, scale);
      setSettings(next);
    },
    [logA11yEvent]
  );

  const cycleTextScale = useCallback(() => {
    const prev = settingsRef.current;
    const curIdx = TEXT_SCALE_STEPS.indexOf(prev.textScale);
    const nextScale = TEXT_SCALE_STEPS[(curIdx + 1) % TEXT_SCALE_STEPS.length] ?? 100;
    const next = { ...prev, textScale: nextScale };
    settingsRef.current = next;
    logA11yEvent('user', 'textScale', prev.textScale, nextScale);
    setSettings(next);
  }, [logA11yEvent]);

  const setColorBlindMode = useCallback(
    (mode: ColorBlindMode) => {
      const prev = settingsRef.current;
      if (prev.colorBlindMode === mode) return;
      const next = { ...prev, colorBlindMode: mode };
      settingsRef.current = next;
      logA11yEvent('user', 'colorBlindMode', prev.colorBlindMode, mode);
      setSettings(next);
    },
    [logA11yEvent]
  );

  const toggleSoundFeedback = useCallback(() => {
    const prev = settingsRef.current;
    const next = { ...prev, soundFeedback: !prev.soundFeedback };
    settingsRef.current = next;
    logA11yEvent('user', 'soundFeedback', prev.soundFeedback, next.soundFeedback);
    setSettings(next);
  }, [logA11yEvent]);

  const toggleHapticFeedback = useCallback(() => {
    const prev = settingsRef.current;
    const next = { ...prev, hapticFeedback: !prev.hapticFeedback };
    settingsRef.current = next;
    logA11yEvent('user', 'hapticFeedback', prev.hapticFeedback, next.hapticFeedback);
    setSettings(next);
  }, [logA11yEvent]);

  const toggleScreenReaderOptimized = useCallback(() => {
    const prev = settingsRef.current;
    const next = { ...prev, screenReaderOptimized: !prev.screenReaderOptimized };
    settingsRef.current = next;
    logA11yEvent('user', 'screenReaderOptimized', prev.screenReaderOptimized, next.screenReaderOptimized);
    setSettings(next);
  }, [logA11yEvent]);

  const resetSettings = useCallback(() => {
    userOverrodeMotionRef.current = false;
    userOverrodeContrastRef.current = false;
    settingsRef.current = DEFAULT_SETTINGS;
    logA11yEvent('reset', 'highContrast', 'custom', 'default');
    setSettings(DEFAULT_SETTINGS);

    try {
      const resetPayload: PersistedState = {
        version: 6,
        settings: DEFAULT_SETTINGS,
        overrides: { motion: false, contrast: false },
      };
      localStorage.setItem(ATOMIC_STORAGE_KEY, JSON.stringify(resetPayload));
    } catch {}

    politeQueueRef.current = [];
    assertiveQueueRef.current = [];
    isPoliteBusyRef.current = false;
    isAssertiveBusyRef.current = false;
    if (politeTimerRef.current) clearTimeout(politeTimerRef.current);
    if (assertiveTimerRef.current) clearTimeout(assertiveTimerRef.current);

    const pEl = document.getElementById(LIVE_POLITE_ID);
    const aEl = document.getElementById(LIVE_ASSERTIVE_ID);
    if (pEl) pEl.textContent = '';
    if (aEl) aEl.textContent = '';
  }, [logA11yEvent]);

  // 10. 本地審計日誌檢視與清除（隱私保證）
  const getAuditLog = useCallback((): readonly A11yAuditRecord[] => {
    return Object.freeze([...auditLogRef.current]);
  }, []);

  const clearAuditLog = useCallback(() => {
    auditLogRef.current = [];
  }, []);

  const actionsValue = useMemo<AccessibilityActions>(
    () => ({
      toggleHighContrast,
      toggleReducedMotion,
      setTextScale,
      cycleTextScale,
      setColorBlindMode,
      toggleSoundFeedback,
      toggleHapticFeedback,
      toggleScreenReaderOptimized,
      resetSettings,
      clearMotionOverride,
      clearContrastOverride,
      playSound,
      announce,
      getAuditLog,
      clearAuditLog,
    }),
    [
      toggleHighContrast,
      toggleReducedMotion,
      setTextScale,
      cycleTextScale,
      setColorBlindMode,
      toggleSoundFeedback,
      toggleHapticFeedback,
      toggleScreenReaderOptimized,
      resetSettings,
      clearMotionOverride,
      clearContrastOverride,
      playSound,
      announce,
      getAuditLog,
      clearAuditLog,
    ]
  );

  return (
    <AccessibilityActionsContext.Provider value={actionsValue}>
      <AccessibilitySettingsContext.Provider value={settings}>
        {children}
      </AccessibilitySettingsContext.Provider>
    </AccessibilityActionsContext.Provider>
  );
};

export const useAccessibilitySettings = (): AccessibilitySettings => {
  const context = useContext(AccessibilitySettingsContext);
  if (!context) throw new Error('useAccessibilitySettings must be used within AccessibilityProvider');
  return context;
};

export const useAccessibilityActions = (): AccessibilityActions => {
  const context = useContext(AccessibilityActionsContext);
  if (!context) throw new Error('useAccessibilityActions must be used within AccessibilityProvider');
  return context;
};

/**
 * 完整相容 Hook (適合設定面板等同時需要狀態與修改方法的 UI)
 * ⚠️ 效能警告：若在高頻解題畫布中只需呼叫 playSound 或 announce，請優先使用 useAccessibilityActions()，杜絕不必要的畫布重新渲染。
 */
export const useAccessibility = () => {
  const settings = useAccessibilitySettings();
  const actions = useAccessibilityActions();
  return { settings, ...actions };
};

export const useColorBlindOptions = (): ColorBlindOptionMeta[] => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  return useMemo<ColorBlindOptionMeta[]>(
    () => [
      {
        key: 'none',
        label: isEn ? 'Standard (Full Spectrum)' : '標準全彩 (無輔助)',
        description: isEn ? 'Default balanced RGB gamut' : '標準全色域光譜',
      },
      {
        key: 'protanopia',
        label: isEn ? 'Protanopia Compensatory' : '紅色弱/盲 強化補償',
        description: isEn
          ? 'Blue/Amber palette mapping with geometric hashing'
          : '採用藍-琥珀補償色票，以幾何紋理補足長波混淆',
      },
      {
        key: 'deuteranopia',
        label: isEn ? 'Deuteranopia Compensatory' : '綠色弱/盲 強化補償',
        description: isEn
          ? 'Violet/Yellow spectrum separation with dotted patterns'
          : '採用紫羅蘭-亮黃高對比色階，強化中波段分辨',
      },
      {
        key: 'tritanopia',
        label: isEn ? 'Tritanopia Compensatory' : '藍黃色弱/盲 強化補償',
        description: isEn
          ? 'Crimson/Cyan distinct luminance pairs'
          : '採用深紅-青綠雙色對比，消除短波色調誤判',
      },
      {
        key: 'achromatopsia',
        label: isEn ? 'High-Luminance Monochromacy' : '極致全色盲/純明度紋理',
        description: isEn
          ? 'Strict luminance ratios with dual-stroke tactile shapes'
          : '嚴格純灰階明度梯度，全面啟用幾何符號雙通道',
      },
    ],
    [isEn]
  );
};
