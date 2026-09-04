// web-frontend/src/contexts/AccessibilityContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ColorBlindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export interface AccessibilitySettings {
  highContrast: boolean;
  focusMode: boolean; // 專注模式（關閉全域呼吸光環、震動與微動畫干擾）
  largeText: boolean; // 大字體模式
  colorBlindMode: ColorBlindMode; // 色弱輔助過濾
  soundFeedback: boolean; // 觸覺/音效反饋輔助
}

interface AccessibilityContextType {
  settings: AccessibilitySettings;
  toggleHighContrast: () => void;
  toggleFocusMode: () => void;
  toggleLargeText: () => void;
  setColorBlindMode: (mode: ColorBlindMode) => void;
  toggleSoundFeedback: () => void;
  resetSettings: () => void;
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

export const AccessibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AccessibilitySettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to parse a11y settings from localStorage', e);
    }
    
    // 預設偵測系統原生偏好
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

  // 核心：將無障礙設定同步至 HTML 根節點，驅動全域樣式與 Tailwind 生效
  useEffect(() => {
    const root = document.documentElement;

    // 1. 高對比度模式
    if (settings.highContrast) {
      root.classList.add('a11y-high-contrast');
    } else {
      root.classList.remove('a11y-high-contrast');
    }

    // 2. 專注模式 (強制禁用全域過渡效果與 CSS 動畫)
    if (settings.focusMode) {
      root.classList.add('a11y-focus-mode');
    } else {
      root.classList.remove('a11y-focus-mode');
    }

    // 3. 大字體模式
    if (settings.largeText) {
      root.classList.add('a11y-large-text');
    } else {
      root.classList.remove('a11y-large-text');
    }

    // 4. 色弱模式標籤
    root.dataset.colorblind = settings.colorBlindMode;

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
