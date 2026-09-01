// web-frontend/src/contexts/AccessibilityContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';

interface AccessibilitySettings {
  highContrast: boolean;
  focusMode: boolean; // 專注模式（自閉症/過動友善：關閉非必要動畫與干擾）
  largeText: boolean;
}

interface AccessibilityContextType {
  settings: AccessibilitySettings;
  toggleHighContrast: () => void;
  toggleFocusMode: () => void;
  toggleLargeText: () => void;
}

const STORAGE_KEY = 'LOGICORE_A11Y_SETTINGS';

const DEFAULT_SETTINGS: AccessibilitySettings = {
  highContrast: false,
  focusMode: false,
  largeText: false,
};

const AccessibilityContext = createContext<AccessibilityContextType | undefined>(undefined);

export const AccessibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AccessibilitySettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save a11y settings', e);
    }
  }, [settings]);

  const toggleHighContrast = () => setSettings((s) => ({ ...s, highContrast: !s.highContrast }));
  const toggleFocusMode = () => setSettings((s) => ({ ...s, focusMode: !s.focusMode }));
  const toggleLargeText = () => setSettings((s) => ({ ...s, largeText: !s.largeText }));

  return (
    <AccessibilityContext.Provider
      value={{ settings, toggleHighContrast, toggleFocusMode, toggleLargeText }}
    >
      {children}
    </AccessibilityContext.Provider>
  );
};

export const useAccessibility = () => {
  const context = useContext(AccessibilityContext);
  if (!context) throw new Error('useAccessibility must be used within AccessibilityProvider');
  return context;
};
