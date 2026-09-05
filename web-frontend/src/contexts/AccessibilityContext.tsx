// web-frontend/src/contexts/AccessibilityContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from './LanguageContext';

export type ColorBlindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export interface AccessibilitySettings {
  highContrast: boolean;
  focusMode: boolean; // 專注/減弱動態模式 (Reduced Motion & Distraction Free)
  largeText: boolean; // 大字體無障礙增強
  colorBlindMode: ColorBlindMode; // 色弱輔助過濾
  soundFeedback: boolean; // 觸覺與音效反饋
}

export interface ColorBlindOptionMeta {
  key: ColorBlindMode;
  label: string;
  description: string;
}

interface AccessibilityContextType {
  settings: AccessibilitySettings;
  toggleHighContrast: () => void;
  toggleFocusMode: () => void;
  toggleLargeText: () => void;
  setColorBlindMode: (mode: ColorBlindMode) => void;
  toggleSoundFeedback: () => void;
  resetSettings: () => void;
  colorBlindOptions: ColorBlindOptionMeta[];
}

const STORAGE_KEY = 'LOGICORE_A11Y_SETTINGS';

const DEFAULT_SETTINGS: AccessibilitySettings = {
  highContrast: false,
  focusMode: false,
  largeText: false,
  colorBlindMode: 'none',
  soundFeedback: true,
};

const AccessibilityContext = createContext<AccessibilityContextType | undefined>(undefined);

// 醫學標準色盲模擬矩陣 (Brettel/Viénot 演算法簡化版)
const COLORBLIND_SVG_FILTERS_ID = 'logicore-a11y-svg-filters';

function injectColorBlindFilters() {
  if (typeof document === 'undefined' || document.getElementById(COLORBLIND_SVG_FILTERS_ID)) return;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.id = COLORBLIND_SVG_FILTERS_ID;
  svg.setAttribute('style', 'display:none');

  svg.innerHTML = `
    <defs>
      <!-- 紅色盲 Protanopia -->
      <filter id="a11y-protanopia">
        <feColorMatrix type="matrix" values="
          0.567, 0.433, 0,     0, 0
          0.558, 0.442, 0,     0, 0
          0,     0.242, 0.758, 0, 0
          0,     0,     0,     1, 0" />
      </filter>
      <!-- 綠色盲 Deuteranopia -->
      <filter id="a11y-deuteranopia">
        <feColorMatrix type="matrix" values="
          0.625, 0.375, 0,   0, 0
          0.700, 0.300, 0,   0, 0
          0,     0.300, 0.7, 0, 0
          0,     0,     0,   1, 0" />
      </filter>
      <!-- 藍黃色盲 Tritanopia -->
      <filter id="a11y-tritanopia">
        <feColorMatrix type="matrix" values="
          0.95, 0.05,  0,     0, 0
          0,    0.433, 0.567, 0, 0
          0,    0.475, 0.525, 0, 0
          0,    0,     0,     1, 0" />
      </filter>
    </defs>
  `;
  document.body.appendChild(svg);
}

export const AccessibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const [settings, setSettings] = useState<AccessibilitySettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to parse a11y settings from localStorage', e);
    }

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

  // 1. 動態注入 SVG 濾鏡實體
  useEffect(() => {
    injectColorBlindFilters();
  }, []);

  // 2. 跨視窗/分頁同步設定
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

  // 3. 根節點樣式與濾鏡連動
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    // 高對比
    root.classList.toggle('a11y-high-contrast', settings.highContrast);

    // 專注/無動畫模式
    root.classList.toggle('a11y-focus-mode', settings.focusMode);

    // 大字體
    root.classList.toggle('a11y-large-text', settings.largeText);

    // 色弱輔助
    root.dataset.colorblind = settings.colorBlindMode;
    if (settings.colorBlindMode !== 'none') {
      root.style.filter = `url(#a11y-${settings.colorBlindMode})`;
    } else {
      root.style.filter = '';
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save a11y settings', e);
    }
  }, [settings]);

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

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  // 4. 動態雙語標籤與說明字典
  const colorBlindOptions = useMemo<ColorBlindOptionMeta[]>(() => [
    {
      key: 'none',
      label: isEn ? 'Standard (Full Spectrum)' : '標準全彩 (無濾鏡)',
      description: isEn ? 'Default vibrant spectrum' : '預設高飽和度色彩體系',
    },
    {
      key: 'protanopia',
      label: isEn ? 'Protanopia (Red-Weak)' : '紅色盲 / 紅色弱 (Protanopia)',
      description: isEn ? 'Adjusts red/green confusion lines' : '強化紅綠交界對比，修正長波長辨識',
    },
    {
      key: 'deuteranopia',
      label: isEn ? 'Deuteranopia (Green-Weak)' : '綠色盲 / 綠色弱 (Deuteranopia)',
      description: isEn ? 'Optimizes mid-wavelength perception' : '優化中波長頻譜，提升綠黃色階區別',
    },
    {
      key: 'tritanopia',
      label: isEn ? 'Tritanopia (Blue-Weak)' : '藍黃色盲 (Tritanopia)',
      description: isEn ? 'Enhances blue/yellow distinction' : '強化短波長頻譜，區隔藍黃與青紫色調',
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
        resetSettings,
        colorBlindOptions,
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
