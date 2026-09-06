// web-frontend/src/hooks/useAntiCheatMonitor.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { SecurityAuditTrail } from '../utils/tournamentSecurity';
import { useLanguage } from '../contexts/LanguageContext';

export interface ExtendedSecurityAuditTrail extends SecurityAuditTrail {
  devToolsOpenEvents: number;
  clockAnomalies: number;
  unnaturalSpeedEvents: number;
  contextMenuBlocks: number;
  auditSignature?: string;
}

export const useAntiCheatMonitor = (isActive: boolean) => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const [auditTrail, setAuditTrail] = useState<ExtendedSecurityAuditTrail>({
    tabSwitches: 0,
    blurEvents: 0,
    clipboardEvents: 0,
    untrustedEvents: 0,
    devToolsOpenEvents: 0,
    clockAnomalies: 0,
    unnaturalSpeedEvents: 0,
    contextMenuBlocks: 0,
  });

  const [violationAlert, setViolationAlert] = useState<string | null>(null);

  const isTabSwitchRef = useRef<boolean>(false);
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActionTimeRef = useRef<number>(0);
  const consecutiveFastActionsRef = useRef<number>(0);
  const devToolsOpenRef = useRef<boolean>(false);

  // 警報觸發器（含觸覺回饋）
  const triggerAlert = useCallback((msg: string) => {
    setViolationAlert(msg);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([80, 40, 80, 40, 120]);
    }
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    alertTimerRef.current = setTimeout(() => setViolationAlert(null), 3500);
  }, []);

  // 1. 核心環境安全監控（分頁切換、失焦、剪貼簿、快捷鍵與右鍵選單）
  useEffect(() => {
    if (!isActive) return;

    // A. 分頁切換監控
    const handleVisibility = () => {
      if (document.hidden) {
        isTabSwitchRef.current = true;
        setAuditTrail((prev) => ({ ...prev, tabSwitches: prev.tabSwitches + 1 }));
        triggerAlert(
          isEn
            ? '⚠️ Tournament Violation: Tab Switch Detected'
            : '⚠️ 賽事違規：偵測到分頁切換 (Tab Switch)'
        );
      } else {
        setTimeout(() => {
          isTabSwitchRef.current = false;
        }, 200);
      }
    };

    // B. 視窗失焦監控（排除切分頁伴隨失焦，避免雙重疊加）
    const handleBlur = () => {
      if (isTabSwitchRef.current) return;
      setAuditTrail((prev) => ({ ...prev, blurEvents: prev.blurEvents + 1 }));
      triggerAlert(
        isEn
          ? '⚠️ Tournament Violation: Window Focus Lost'
          : '⚠️ 賽事違規：視窗焦點喪失 (Window Blur)'
      );
    };

    // C. 剪貼簿操作阻斷
    const handleClipboard = (e: ClipboardEvent) => {
      e.preventDefault();
      setAuditTrail((prev) => ({ ...prev, clipboardEvents: prev.clipboardEvents + 1 }));
      triggerAlert(
        isEn
          ? '🚫 Tournament Violation: Clipboard Prohibited'
          : '🚫 賽事違規：嚴禁使用剪貼簿複製貼上'
      );
    };

    // D. 右鍵選單阻斷
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setAuditTrail((prev) => ({ ...prev, contextMenuBlocks: prev.contextMenuBlocks + 1 }));
      triggerAlert(
        isEn
          ? '🚫 Context Menu / Inspection Prohibited'
          : '🚫 賽事環境：已禁用右鍵檢查功能'
      );
    };

    // E. 攔截常見開發者除錯快捷鍵 (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U)
    const handleKeyDown = (e: KeyboardEvent) => {
      const isF12 = e.key === 'F12';
      const isInspect =
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key);
      const isViewSource = (e.ctrlKey || e.metaKey) && ['U', 'u'].includes(e.key);

      if (isF12 || isInspect || isViewSource) {
        e.preventDefault();
        e.stopPropagation();
        setAuditTrail((prev) => ({ ...prev, devToolsOpenEvents: prev.devToolsOpenEvents + 1 }));
        triggerAlert(
          isEn
            ? '🚫 Security Alert: Developer Hotkey Intercepted'
            : '🚫 安全警報：攔截到除錯快捷鍵'
        );
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
    };
  }, [isActive, triggerAlert, isEn]);

  // 2. DevTools 控制台探針與視窗幾何差值監控
  useEffect(() => {
    if (!isActive) return;

    let devToolsTimer: ReturnType<typeof setInterval>;

    const checkDevTools = () => {
      // 方式 1: 幾何寬高比對（桌面端 DevTools 側欄或底欄開啟時會形成差值）
      const threshold = 160;
      const widthDiff = window.outerWidth - window.innerWidth > threshold;
      const heightDiff = window.outerHeight - window.innerHeight > threshold;

      if (widthDiff || heightDiff) {
        if (!devToolsOpenRef.current) {
          devToolsOpenRef.current = true;
          setAuditTrail((prev) => ({ ...prev, devToolsOpenEvents: prev.devToolsOpenEvents + 1 }));
          triggerAlert(
            isEn
              ? '⚠️ Security Alert: Inspection Console Detected'
              : '⚠️ 賽事警報：檢測到 DevTools 視窗開啟'
          );
        }
      } else {
        devToolsOpenRef.current = false;
      }
    };

    devToolsTimer = setInterval(checkDevTools, 1500);
    return () => clearInterval(devToolsTimer);
  }, [isActive, triggerAlert, isEn]);

  // 3. 時鐘偏差與加速器異常檢測 (Clock Skew / Speed-hack Defense)
  useEffect(() => {
    if (!isActive) return;

    let lastTick = performance.now();
    let clockTimer: ReturnType<typeof setInterval>;

    clockTimer = setInterval(() => {
      const now = performance.now();
      const delta = now - lastTick;
      lastTick = now;

      // 如果 1 秒的定時器偏差超過 ±700ms，說明發生定時器劫持或背景凍結
      if (delta > 2000 || delta < 300) {
        setAuditTrail((prev) => ({ ...prev, clockAnomalies: prev.clockAnomalies + 1 }));
      }
    }, 1000);

    return () => clearInterval(clockTimer);
  }, [isActive]);

  // 4. 輸入行為生物力學校驗：驗證 isTrusted 與超人類點擊速度（Bot/Macro 檢驗）
  const verifyTrustedInput = useCallback(
    (e?: UIEvent): boolean => {
      if (!isActive) return true;

      // A. 合成事件 (Synthetic Event) 攔截
      if (e && !e.isTrusted) {
        setAuditTrail((prev) => ({ ...prev, untrustedEvents: prev.untrustedEvents + 1 }));
        triggerAlert(
          isEn
            ? '🚫 Rejected Synthetic Input Source (Untrusted Event)'
            : '🚫 拒絕非人類輸入源 (Untrusted Synthetic Event)'
        );
        return false;
      }

      // B. 超人類輸入頻率異常（連點器 / 自動巨集檢測）
      const now = performance.now();
      const timeSinceLastAction = now - lastActionTimeRef.current;
      lastActionTimeRef.current = now;

      // 連續兩次填數/點擊間隔低於 35ms（神經傳導與物理按鍵的生理極限）
      if (timeSinceLastAction < 35) {
        consecutiveFastActionsRef.current += 1;
        if (consecutiveFastActionsRef.current >= 3) {
          setAuditTrail((prev) => ({
            ...prev,
            unnaturalSpeedEvents: prev.unnaturalSpeedEvents + 1,
          }));
          triggerAlert(
            isEn
              ? '⚠️ Unnatural Input Cadence (Automated Input Suspected)'
              : '⚠️ 輸入頻率異常（疑似自動化外掛腳本）'
          );
          return false;
        }
      } else {
        consecutiveFastActionsRef.current = 0;
      }

      return true;
    },
    [isActive, triggerAlert, isEn]
  );

  // 重置審計狀態
  const resetAudit = useCallback(() => {
    setAuditTrail({
      tabSwitches: 0,
      blurEvents: 0,
      clipboardEvents: 0,
      untrustedEvents: 0,
      devToolsOpenEvents: 0,
      clockAnomalies: 0,
      unnaturalSpeedEvents: 0,
      contextMenuBlocks: 0,
    });
    setViolationAlert(null);
    isTabSwitchRef.current = false;
    devToolsOpenRef.current = false;
    consecutiveFastActionsRef.current = 0;
    lastActionTimeRef.current = performance.now();
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
  }, []);

  return {
    auditTrail,
    violationAlert,
    verifyTrustedInput,
    resetAudit,
  };
};
