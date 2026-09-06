// web-frontend/src/contexts/AccessibilityContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLanguage } from './LanguageContext';

export type ColorBlindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';

export interface AccessibilitySettings {
  highContrast: boolean;
  focusMode: boolean; // 專注/減弱動態模式 (Reduced Motion & Distraction Free)
  largeText: boolean; // 大字體無障礙增強
  colorBlindMode: ColorBlindMode; // 色弱/色盲過濾
  soundFeedback: boolean; // 程序化無障礙音效反饋
  hapticFeedback: boolean; // 實體觸覺反饋
  screenReaderOptimized: boolean; // 虛擬 DOM 語意與 Live Region 增強
}

export interface ColorBlindOptionMeta {
  key: ColorBlindMode;
  label: string;
  description: string;
}

export type SoundEffectType = 'click' | 'step' | 'success' | 'conflict' | 'alert' | 'hint';

interface AccessibilityContextType {
  settings: AccessibilitySettings;
  toggleHighContrast: () => void;
  toggleFocusMode: () => void;
  toggleLargeText: () => void;
  setColorBlindMode: (mode: ColorBlindMode) => void;
  toggleSoundFeedback: () => void;
  toggleHapticFeedback: () => void;
  toggleScreenReaderOptimized: () => void;
  resetSettings: () => void;
  colorBlindOptions: ColorBlindOptionMeta[];
  /**
   * 零依賴程序化音效觸發器 (Web Audio API Synthesizer)
   */
  playSound: (type: SoundEffectType) => void;
  /**
   * 螢幕閱讀器非同步語音播報 (ARIA Live Region)
   */
  announce: (message: string, priority?: 'polite' | 'assertive') => void;
}

const STORAGE_KEY = 'LOGICORE_A11Y_SETTINGS_V3';
const COLORBLIND_SVG_FILTERS_ID = 'logicore-a11y-svg-filters';
const ARIA_LIVE_REGION_ID = 'logicore-a11y-live-announcer';

const DEFAULT_SETTINGS: AccessibilitySettings = {
  highContrast: false,
  focusMode: false,
  largeText: false,
  colorBlindMode: 'none',
  soundFeedback: true,
  hapticFeedback: true,
  screenReaderOptimized: false,
};

const AccessibilityContext = createContext<AccessibilityContextType | undefined>(undefined);

/**
 * 注入臨床標準色盲模擬矩陣 (包含全色盲 Achromatopsia)
 */
function injectA11yDomArtifacts() {
  if (typeof document === 'undefined') return;

  // 1. 注入 SVG 色彩過濾矩陣
  if (!document.getElementById(COLORBLIND_SVG_FILTERS_ID)) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.id = COLORBLIND_SVG_FILTERS_ID;
    svg.setAttribute('style', 'position:absolute; width:0; height:0; pointer-events:none;');
    svg.setAttribute('aria-hidden', 'true');

    svg.innerHTML = `
      <defs>
        <!-- 紅色盲 Protanopia (L-cone absent) -->
        <filter id="a11y-protanopia">
          <feColorMatrix type="matrix" values="
            0.567, 0.433, 0.000, 0, 0
            0.558, 0.442, 0.000, 0, 0
            0.000, 0.242, 0.758, 0, 0
            0.000, 0.000, 0.000, 1, 0" />
        </filter>
        <!-- 綠色盲 Deuteranopia (M-cone absent) -->
        <filter id="a11y-deuteranopia">
          <feColorMatrix type="matrix" values="
            0.625, 0.375, 0.000, 0, 0
            0.700, 0.300, 0.000, 0, 0
            0.000, 0.300, 0.700, 0, 0
            0.000, 0.000, 0.000, 1, 0" />
        </filter>
        <!-- 藍黃色盲 Tritanopia (S-cone absent) -->
        <filter id="a11y-tritanopia">
          <feColorMatrix type="matrix" values="
            0.950, 0.050, 0.000, 0, 0
            0.000, 0.433, 0.567, 0, 0
            0.000, 0.475, 0.525, 0, 0
            0.000, 0.000, 0.000, 1, 0" />
        </filter>
        <!-- 全色盲 Achromatopsia (Rod Monochromacy) -->
        <filter id="a11y-achromatopsia">
          <feColorMatrix type="matrix" values="
            0.299, 0.587, 0.114, 0, 0
            0.299, 0.587, 0.114, 0, 0
            0.299, 0.587, 0.114, 0, 0
            0.000, 0.000, 0.000, 1, 0" />
        </filter>
      </defs>
    `;
    document.body.appendChild(svg);
  }

  // 2. 注入 ARIA Live Region 容器
  if (!document.getElementById(ARIA_LIVE_REGION_ID)) {
    const liveRegion = document.createElement('div');
    liveRegion.id = ARIA_LIVE_REGION_ID;
    liveRegion.className = 'sr-only';
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.style.cssText = 'position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); border:0;';
    document.body.appendChild(liveRegion);
  }
}

export const AccessibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  // 音訊上下文單例快取
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [settings, setSettings] = useState<AccessibilitySettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch {}

    const systemPrefersReducedMotion = typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const systemPrefersHighContrast = typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-contrast: more)').matches;

    return {
      ...DEFAULT_SETTINGS,
      focusMode: Boolean(systemPrefersReducedMotion),
      highContrast: Boolean(systemPrefersHighContrast),
    };
  });

  // 1. 初始化 DOM 基礎設施
  useEffect(() => {
    injectA11yDomArtifacts();
  }, []);

  // 2. 跨分頁即時同步
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setSettings((prev) => ({ ...prev, ...JSON.parse(e.newValue!) }));
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // 3. 根節點樣式與色盲濾鏡連動 (避免將濾鏡直接掛在 html 破壞 fixed 定位)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const body = document.body;

    root.classList.toggle('a11y-high-contrast', settings.highContrast);
    root.classList.toggle('a11y-focus-mode', settings.focusMode);
    root.classList.toggle('a11y-large-text', settings.largeText);
    root.classList.toggle('a11y-screen-reader', settings.screenReaderOptimized);

    root.dataset.colorblind = settings.colorBlindMode;

    // 將濾鏡掛在 body 而非 html，防止破壞 position: fixed 頂層容器
    if (settings.colorBlindMode !== 'none') {
      body.style.filter = `url(#a11y-${settings.colorBlindMode})`;
    } else {
      body.style.filter = '';
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  // 4. 零依賴程序化音效合成器 (Web Audio API)
  const playSound = useCallback((type: SoundEffectType) => {
    if (!settings.soundFeedback || typeof window === 'undefined') return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContextClass();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
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
          osc.frequency.setValueAtTime(523.25, now); // C5
          gain.gain.setValueAtTime(0.06, now);
          gain.gain.linearRampToValueAtTime(0.001, now + 0.06);
          osc.start(now);
          osc.stop(now + 0.06);
          break;

        case 'hint':
          osc.type = 'sine';
          osc.frequency.setValueAtTime(587.33, now); // D5
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
          // 主和弦連續琶音 (C5 -> E5 -> G5 -> C6)
          const freqs = [523.25, 659.25, 783.99, 1046.50];
          freqs.forEach((f, idx) => {
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
  }, [settings.soundFeedback]);

  // 5. 螢幕閱讀器專用即時播報 (ARIA Live Region)
  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(ARIA_LIVE_REGION_ID);
    if (!el) return;

    el.setAttribute('aria-live', priority);
    el.textContent = '';
    // 微延遲以確保螢幕閱讀器能捕捉到文字變化
    setTimeout(() => {
      el.textContent = message;
    }, 50);
  }, []);

  const toggleHighContrast = useCallback(() => {
    setSettings((s) => ({ ...s, highContrast: !s.highContrast }));
  }, []);

  const toggleFocusMode = useCallback(() => {
    setSettings((s) => ({ ...s, focusMode: !s.focusMode }));
  }, []);

  const toggleLargeText = useCallback(() => {
    setSettings((s) => ({ ...s, largeText: !s.largeText }));
  }, []);

  const setColorBlindMode = useCallback((mode: ColorBlindMode) => {
    setSettings((s) => ({ ...s, colorBlindMode: mode }));
  }, []);

  const toggleSoundFeedback = useCallback(() => {
    setSettings((s) => ({ ...s, soundFeedback: !s.soundFeedback }));
  }, []);

  const toggleHapticFeedback = useCallback(() => {
    setSettings((s) => ({ ...s, hapticFeedback: !s.hapticFeedback }));
  }, []);

  const toggleScreenReaderOptimized = useCallback(() => {
    setSettings((s) => ({ ...s, screenReaderOptimized: !s.screenReaderOptimized }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  // 6. 色盲輔助選項字典 (繁體/英文雙語標準定義)
  const colorBlindOptions = useMemo<ColorBlindOptionMeta[]>(() => [
    {
      key: 'none',
      label: isEn ? 'Standard (Full Spectrum)' : '標準全彩 (無濾鏡)',
      description: isEn ? 'Default full-gamut spectrum' : '預設標準色域體系',
    },
    {
      key: 'protanopia',
      label: isEn ? 'Protanopia (Red-Blind)' : '紅色盲 / 紅色弱 (Protanopia)',
      description: isEn ? 'Adjusts red/green confusion lines' : '強化長波長交界對比，校正紅綠混淆線',
    },
    {
      key: 'deuteranopia',
      label: isEn ? 'Deuteranopia (Green-Blind)' : '綠色盲 / 綠色弱 (Deuteranopia)',
      description: isEn ? 'Optimizes mid-wavelength perception' : '優化中波長頻譜，提升綠黃與棕色階對比',
    },
    {
      key: 'tritanopia',
      label: isEn ? 'Tritanopia (Blue-Blind)' : '藍黃色盲 (Tritanopia)',
      description: isEn ? 'Enhances short-wavelength distinction' : '強化短波長頻譜，清楚區隔藍黃與青紫色調',
    },
    {
      key: 'achromatopsia',
      label: isEn ? 'Achromatopsia (Monochromacy)' : '全色盲 / 灰階 (Achromatopsia)',
      description: isEn ? 'High-contrast luminosity mapping' : '極致純明度幾何對比，無色相干擾',
    },
  ], [isEn]);

  return (
    <AccessibilityContext.Provider
      value={{
        settings,
        toggleHighContrast,
        toggleFocusMode,
        toggleLargeText,
        setColorBlindMode,
        toggleSoundFeedback,
        toggleHapticFeedback,
        toggleScreenReaderOptimized,
        resetSettings,
        colorBlindOptions,
        playSound,
        announce,
      }}
    >
      {children}
    </AccessibilityContext.Provider>
  );
};

export const useAccessibility = (): AccessibilityContextType => {
  const context = useContext(AccessibilityContext);
  if (!context) throw new Error('useAccessibility must be used within AccessibilityProvider');
  return context;
};
