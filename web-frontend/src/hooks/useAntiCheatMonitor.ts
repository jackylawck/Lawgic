// web-frontend/src/hooks/useAntiCheatMonitor.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { SecurityAuditTrail } from '../utils/tournamentSecurity';
import { useLanguage } from '../contexts/LanguageContext';

export const useAntiCheatMonitor = (isActive: boolean) => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const [auditTrail, setAuditTrail] = useState<SecurityAuditTrail>({
    tabSwitches: 0,
    blurEvents: 0,
    clipboardEvents: 0,
    untrustedEvents: 0,
  });

  const [violationAlert, setViolationAlert] = useState<string | null>(null);
  const isTabSwitchRef = useRef<boolean>(false);
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerAlert = useCallback((msg: string) => {
    setViolationAlert(msg);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    alertTimerRef.current = setTimeout(() => setViolationAlert(null), 3500);
  }, []);

  useEffect(() => {
    if (!isActive) return;

    // 1. 監控切換分頁
    const handleVisibility = () => {
      if (document.hidden) {
        isTabSwitchRef.current = true;
        setAuditTrail((prev) => ({ ...prev, tabSwitches: prev.tabSwitches + 1 }));
        triggerAlert(
          isEn
            ? '⚠️ Tournament Alert: Tab Switch Detected'
            : '⚠️ 賽事警報：偵測到分頁切換 (Tab Switch)'
        );
      } else {
        // 重回頁面後延遲重置，避免接續的 blur 事件重複計數
        setTimeout(() => {
          isTabSwitchRef.current = false;
        }, 150);
      }
    };

    // 2. 監控視窗失焦 (排查切分頁時伴隨發生的 blur，防止雙重懲罰)
    const handleBlur = () => {
      if (isTabSwitchRef.current) return;
      setAuditTrail((prev) => ({ ...prev, blurEvents: prev.blurEvents + 1 }));
      triggerAlert(
        isEn
          ? '⚠️ Tournament Alert: Window Focus Lost (Window Blur)'
          : '⚠️ 賽事警報：視窗焦點喪失 (Window Blur)'
      );
    };

    // 3. 阻斷剪貼簿操作
    const handleClipboard = (e: ClipboardEvent) => {
      e.preventDefault();
      setAuditTrail((prev) => ({ ...prev, clipboardEvents: prev.clipboardEvents + 1 }));
      triggerAlert(
        isEn
          ? '⚠️ Tournament Alert: Clipboard Transfer Prohibited'
          : '⚠️ 賽事警報：禁用剪貼簿傳輸 (Clipboard Blocked)'
      );
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('paste', handleClipboard);
    document.addEventListener('copy', handleClipboard);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('paste', handleClipboard);
      document.removeEventListener('copy', handleClipboard);
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    };
  }, [isActive, triggerAlert, isEn]);

  const verifyTrustedInput = useCallback(
    (e: UIEvent): boolean => {
      if (!isActive) return true;
      if (!e.isTrusted) {
        setAuditTrail((prev) => ({ ...prev, untrustedEvents: prev.untrustedEvents + 1 }));
        triggerAlert(
          isEn
            ? '🚫 Rejected Synthetic Input Source (Untrusted Event)'
            : '🚫 拒絕非人類輸入源 (Untrusted Synthetic Event)'
        );
        return false;
      }
      return true;
    },
    [isActive, triggerAlert, isEn]
  );

  const resetAudit = useCallback(() => {
    setAuditTrail({
      tabSwitches: 0,
      blurEvents: 0,
      clipboardEvents: 0,
      untrustedEvents: 0,
    });
    setViolationAlert(null);
    isTabSwitchRef.current = false;
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
  }, []);

  return {
    auditTrail,
    violationAlert,
    verifyTrustedInput,
    resetAudit,
  };
};
