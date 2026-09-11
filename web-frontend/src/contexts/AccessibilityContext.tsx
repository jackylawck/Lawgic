// web-frontend/src/contexts/AccessibilityContext.tsx
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  ReactNode,
} from 'react';

export type ColorBlindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';

export type SoundEffectType =
  | 'click'
  | 'step'
  | 'success'
  | 'conflict'
  | 'alert'
  | 'hint'
  | 'celebration';

/** WCAG 1.4.4 離散文字縮放階梯 (百分比) */
export type TextScaleRatio = 100 | 125 | 150 | 200;

export interface AccessibilitySettings {
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly colorBlindMode: ColorBlindMode;
  readonly soundFeedback: boolean;
  readonly hapticFeedback: boolean;
  readonly textScale: TextScaleRatio;
  readonly screenReaderOptimized: boolean;
}

export interface AccessibilityActions {
  readonly updateSetting: <K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K]
  ) => void;
  readonly resetSettings: () => void;
  readonly playSound: (type: SoundEffectType) => Promise<void>;
  readonly announce: (message: string, priority?: 'polite' | 'assertive') => void;
}

const STORAGE_KEY = 'logicore_a11y_settings';
const STORAGE_USER_OVERRIDES_KEY = 'logicore_a11y_overrides';

/** 音訊指數衰減底限閾值 (約 -80 dB，防止 exponentialRamp 趨零引發 RangeError) */
const AUDIO_SILENCE_FLOOR = 0.0001;

/** 螢幕閱讀器訊息間隔（涵蓋 NVDA / JAWS / VoiceOver 消化週期） */
const ANNOUNCE_INTERVAL_MS = 150;
const MAX_QUEUE_SIZE = 5;

/** 慶祝大三和弦琶音譜表 (C5 -> E5 -> G5 -> C6 -> E6) */
const CELEBRATION_NOTES = [
  { f: 523.25, offset: 0.00, dur: 0.35, peakGain: 0.15 }, // C5
  { f: 659.25, offset: 0.10, dur: 0.35, peakGain: 0.18 }, // E5
  { f: 783.99, offset: 0.20, dur: 0.45, peakGain: 0.20 }, // G5
  { f: 1046.50, offset: 0.32, dur: 0.65, peakGain: 0.25 }, // C6
  { f: 1318.51, offset: 0.36, dur: 0.50, peakGain: 0.10 }, // E6
] as const;

const DEFAULT_SETTINGS: AccessibilitySettings = {
  reducedMotion: false,
  highContrast: false,
  colorBlindMode: 'none',
  soundFeedback: true,
  hapticFeedback: true,
  textScale: 100,
  screenReaderOptimized: false,
};

const SettingsContext = createContext<AccessibilitySettings | null>(null);
const ActionsContext = createContext<AccessibilityActions | null>(null);

export const AccessibilityProvider: React.FC<{ readonly children: ReactNode }> = ({ children }) => {
  // 1. 初始化設定（兼顧 Storage 與系統 Preference）
  const [settings, setSettings] = useState<AccessibilitySettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const prefersContrast = window.matchMedia('(prefers-contrast: more)').matches;
      return {
        ...DEFAULT_SETTINGS,
        reducedMotion: prefersReduced,
        highContrast: prefersContrast,
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // 使用 useEffect 於 Commit 階段同步 ref，維護並發純度
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // 使用 useState 惰性工廠安全初始化 Set
  const [initialOverrides] = useState<Set<keyof AccessibilitySettings>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem(STORAGE_USER_OVERRIDES_KEY);
      if (!saved) return new Set();
      const parsed = JSON.parse(saved) as unknown;
      if (!Array.isArray(parsed)) return new Set();
      return new Set(
        parsed.filter((k): k is keyof AccessibilitySettings => typeof k === 'string')
      );
    } catch {
      return new Set();
    }
  });

  const userOverridesRef = useRef<Set<keyof AccessibilitySettings>>(initialOverrides);

  // 2. 儲存防抖 (250ms Debounced Storage) 與清理
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        localStorage.setItem(
          STORAGE_USER_OVERRIDES_KEY,
          JSON.stringify(Array.from(userOverridesRef.current))
        );
      } catch {}
    }, 250);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [settings]);

  // 獨立處理 CSS 變數派發與卸載清理
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--a11y-font-scale',
      (settings.textScale / 100).toString()
    );
    return () => {
      document.documentElement.style.removeProperty('--a11y-font-scale');
    };
  }, [settings.textScale]);

  // 3. 系統 matchMedia 監聽與雙向跨分頁 Storage 同步
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const contrastQuery = window.matchMedia('(prefers-contrast: more)');

    const handleMotion = (e: MediaQueryListEvent) => {
      if (!userOverridesRef.current.has('reducedMotion')) {
        setSettings((prev) => ({ ...prev, reducedMotion: e.matches }));
      }
    };
    const handleContrast = (e: MediaQueryListEvent) => {
      if (!userOverridesRef.current.has('highContrast')) {
        setSettings((prev) => ({ ...prev, highContrast: e.matches }));
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const remote = JSON.parse(e.newValue);
          setSettings((prev) => {
            const merged = { ...prev, ...remote };
            if (userOverridesRef.current.has('reducedMotion')) {
              merged.reducedMotion = prev.reducedMotion;
            }
            if (userOverridesRef.current.has('highContrast')) {
              merged.highContrast = prev.highContrast;
            }
            return merged;
          });
        } catch {}
      }
      if (e.key === STORAGE_USER_OVERRIDES_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as unknown;
          if (Array.isArray(parsed)) {
            userOverridesRef.current = new Set(
              parsed.filter((k): k is keyof AccessibilitySettings => typeof k === 'string')
            );
          }
        } catch {}
      }
    };

    motionQuery.addEventListener('change', handleMotion);
    contrastQuery.addEventListener('change', handleContrast);
    window.addEventListener('storage', handleStorage);

    return () => {
      motionQuery.removeEventListener('change', handleMotion);
      contrastQuery.removeEventListener('change', handleContrast);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // 4. 音訊子系統 (Web Audio API 單例與生命週期安全治理)
  const audioCtxRef = useRef<AudioContext | null>(null);

  const ensureAudioReady = useCallback(async (): Promise<AudioContext | null> => {
    if (typeof window === 'undefined') return null;
    if (!audioCtxRef.current) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        audioCtxRef.current = new AudioCtxClass();
      }
    }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      try {
        // 設置 500ms 超時降級，杜絕特定環境下 Promise 永遠 pending 造成主執行緒掛死
        await Promise.race([
          ctx.resume(),
          new Promise<void>((resolve) => setTimeout(resolve, 500)),
        ]);
      } catch {}
    }
    return ctx;
  }, []);

  // 音訊背景暫停 (Visibility Change) 與卸載清理
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibility = () => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      if (document.hidden && ctx.state === 'running') {
        ctx.suspend().catch(() => {});
      } else if (!document.hidden && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  const playSound = useCallback(
    async (type: SoundEffectType): Promise<void> => {
      if (!settingsRef.current.soundFeedback) return;
      const ctx = await ensureAudioReady();
      if (!ctx) return;

      try {
        const now = ctx.currentTime;

        /* 設計決策：瞬態合成器子圖 (Oscillator -> ToneGain -> MasterGain) 依賴 Web Audio API
           底層音訊線程在 oscillator.stop() 後自動切斷引用並由引擎 GC 回收，無定時器洩漏風險。 */
        switch (type) {
          case 'click': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, now);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(AUDIO_SILENCE_FLOOR, now + 0.04);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.04);
            break;
          }
          case 'step': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440, now);
            gain.gain.setValueAtTime(0.06, now);
            gain.gain.exponentialRampToValueAtTime(AUDIO_SILENCE_FLOOR, now + 0.05);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.05);
            break;
          }
          case 'success': {
            [587.33, 880].forEach((freq, idx) => {
              const toneOsc = ctx.createOscillator();
              const toneGain = ctx.createGain();
              toneOsc.type = 'triangle';
              toneOsc.frequency.setValueAtTime(freq, now + idx * 0.08);
              toneGain.gain.setValueAtTime(0.12, now + idx * 0.08);
              toneGain.gain.exponentialRampToValueAtTime(
                AUDIO_SILENCE_FLOOR,
                now + idx * 0.08 + 0.25
              );
              toneOsc.connect(toneGain);
              toneGain.connect(ctx.destination);
              toneOsc.start(now + idx * 0.08);
              toneOsc.stop(now + idx * 0.08 + 0.25);
            });
            break;
          }
          case 'celebration': {
            const masterGain = ctx.createGain();
            masterGain.gain.setValueAtTime(0.6, now);
            masterGain.connect(ctx.destination);

            CELEBRATION_NOTES.forEach(({ f, offset, dur, peakGain }) => {
              const toneOsc = ctx.createOscillator();
              const toneGain = ctx.createGain();

              toneOsc.type = 'triangle';
              toneOsc.frequency.setValueAtTime(f, now + offset);

              toneGain.gain.setValueAtTime(peakGain, now + offset);
              toneGain.gain.exponentialRampToValueAtTime(
                AUDIO_SILENCE_FLOOR,
                now + offset + dur
              );

              toneOsc.connect(toneGain);
              toneGain.connect(masterGain);

              toneOsc.start(now + offset);
              toneOsc.stop(now + offset + dur);
            });
            break;
          }
          case 'conflict': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(140, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(AUDIO_SILENCE_FLOOR, now + 0.15);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.15);
            break;
          }
          case 'alert': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(220, now);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(AUDIO_SILENCE_FLOOR, now + 0.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.2);
            break;
          }
          case 'hint': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, now);
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.exponentialRampToValueAtTime(AUDIO_SILENCE_FLOOR, now + 0.1);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.1);
            break;
          }
        }
      } catch {}
    },
    [ensureAudioReady]
  );

  // 5. 雙通道零重繪 Live Region 排程引擎 (DOM Direct Mutation + Queue Flush)
  const politeRegionRef = useRef<HTMLDivElement>(null);
  const assertiveRegionRef = useRef<HTMLDivElement>(null);

  const politeQueueRef = useRef<string[]>([]);
  const assertiveQueueRef = useRef<string[]>([]);

  const isPoliteFlushingRef = useRef(false);
  const isAssertiveFlushingRef = useRef(false);

  const politeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assertiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const politeRafRef = useRef<number | null>(null);
  const assertiveRafRef = useRef<number | null>(null);

  const flushPoliteQueue = useCallback(() => {
    // Assertive 優先：若當前有緊急插播正在播放，Polite 佇列嚴格暫停推進
    if (isAssertiveFlushingRef.current) return;

    if (politeQueueRef.current.length === 0) {
      isPoliteFlushingRef.current = false;
      return;
    }

    const region = politeRegionRef.current;
    if (!region) {
      isPoliteFlushingRef.current = false;
      return;
    }

    const nextMsg = politeQueueRef.current.shift();
    if (!nextMsg) {
      isPoliteFlushingRef.current = false;
      return;
    }

    isPoliteFlushingRef.current = true;
    region.textContent = '';

    if (politeRafRef.current) cancelAnimationFrame(politeRafRef.current);
    politeRafRef.current = requestAnimationFrame(() => {
      if (politeRegionRef.current) {
        politeRegionRef.current.textContent = nextMsg;
      }
      politeTimerRef.current = setTimeout(() => {
        isPoliteFlushingRef.current = false;
        flushPoliteQueue();
      }, ANNOUNCE_INTERVAL_MS);
    });
  }, []);

  const flushAssertiveQueue = useCallback(() => {
    if (assertiveQueueRef.current.length === 0) {
      isAssertiveFlushingRef.current = false;
      // Assertive 佇列完全清空後，自動喚醒並接續推進積蓄的 Polite 佇列
      if (politeQueueRef.current.length > 0 && !isPoliteFlushingRef.current) {
        flushPoliteQueue();
      }
      return;
    }

    const region = assertiveRegionRef.current;
    if (!region) {
      isAssertiveFlushingRef.current = false;
      return;
    }

    const nextMsg = assertiveQueueRef.current.shift();
    if (!nextMsg) {
      isAssertiveFlushingRef.current = false;
      return;
    }

    isAssertiveFlushingRef.current = true;
    region.textContent = '';

    if (assertiveRafRef.current) cancelAnimationFrame(assertiveRafRef.current);
    assertiveRafRef.current = requestAnimationFrame(() => {
      if (assertiveRegionRef.current) {
        assertiveRegionRef.current.textContent = nextMsg;
      }
      assertiveTimerRef.current = setTimeout(() => {
        isAssertiveFlushingRef.current = false;
        flushAssertiveQueue();
      }, ANNOUNCE_INTERVAL_MS);
    });
  }, [flushPoliteQueue]);

  const announce = useCallback(
    (message: string, priority: 'polite' | 'assertive' = 'polite') => {
      const clean = message.trim();
      if (!clean) return;

      if (priority === 'assertive') {
        // Assertive 真搶佔：清空視覺、徹底拔除 Polite 掛起的 Timer 與 RAF，重置旗標
        if (politeRegionRef.current) {
          politeRegionRef.current.textContent = '';
        }
        if (politeTimerRef.current) {
          clearTimeout(politeTimerRef.current);
          politeTimerRef.current = null;
        }
        if (politeRafRef.current) {
          cancelAnimationFrame(politeRafRef.current);
          politeRafRef.current = null;
        }
        isPoliteFlushingRef.current = false;

        // 排入緊急佇列並立即推進
        if (assertiveQueueRef.current.length >= MAX_QUEUE_SIZE) {
          assertiveQueueRef.current.shift();
        }
        assertiveQueueRef.current.push(clean);
        if (!isAssertiveFlushingRef.current) {
          flushAssertiveQueue();
        }
      } else {
        // Polite 訊息嚴格受控於 screenReaderOptimized
        if (!settingsRef.current.screenReaderOptimized) return;

        if (politeQueueRef.current.length >= MAX_QUEUE_SIZE) {
          politeQueueRef.current.shift();
        }
        politeQueueRef.current.push(clean);
        if (!isPoliteFlushingRef.current) {
          flushPoliteQueue();
        }
      }
    },
    [flushPoliteQueue, flushAssertiveQueue]
  );

  // 清理所有排程資源
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (politeTimerRef.current) clearTimeout(politeTimerRef.current);
      if (assertiveTimerRef.current) clearTimeout(assertiveTimerRef.current);
      if (politeRafRef.current) cancelAnimationFrame(politeRafRef.current);
      if (assertiveRafRef.current) cancelAnimationFrame(assertiveRafRef.current);
    };
  }, []);

  const updateSetting = useCallback(
    <K extends keyof AccessibilitySettings>(key: K, value: AccessibilitySettings[K]) => {
      // 任何呼叫均標記為使用者顯式介入意圖
      userOverridesRef.current.add(key);
      setSettings((prev) => {
        if (prev[key] === value) return prev;
        return { ...prev, [key]: value };
      });
    },
    []
  );

  const resetSettings = useCallback(() => {
    userOverridesRef.current.clear();
    setSettings(DEFAULT_SETTINGS);
    // 即時持久化：杜絕 250ms 防抖時間差導致刷新後舊覆寫復活
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
      localStorage.setItem(STORAGE_USER_OVERRIDES_KEY, '[]');
    } catch {}
  }, []);

  const actions = useMemo<AccessibilityActions>(
    () => ({
      updateSetting,
      resetSettings,
      playSound,
      announce,
    }),
    [updateSetting, resetSettings, playSound, announce]
  );

  return (
    <SettingsContext.Provider value={settings}>
      <ActionsContext.Provider value={actions}>
        {children}
        {/* 全域無障礙 Live Regions：純 DOM Ref 驅動，零重渲染 */}
        <div
          ref={politeRegionRef}
          role="status"
          aria-atomic="true"
          className="sr-only"
        />
        <div
          ref={assertiveRegionRef}
          role="alert"
          className="sr-only"
        />
      </ActionsContext.Provider>
    </SettingsContext.Provider>
  );
};

export const useAccessibilitySettings = (): AccessibilitySettings => {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useAccessibilitySettings must be used within an AccessibilityProvider');
  }
  return ctx;
};

export const useAccessibilityActions = (): AccessibilityActions => {
  const ctx = useContext(ActionsContext);
  if (!ctx) {
    throw new Error('useAccessibilityActions must be used within an AccessibilityProvider');
  }
  return ctx;
};
