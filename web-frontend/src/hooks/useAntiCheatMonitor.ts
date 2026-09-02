// web-frontend/src/hooks/useAntiCheatMonitor.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { SecurityAuditTrail } from '../utils/tournamentSecurity';

export const useAntiCheatMonitor = (isActive: boolean) => {
  const auditRef = useRef<SecurityAuditTrail>({
    tabSwitches: 0,
    blurEvents: 0,
    clipboardEvents: 0,
    untrustedEvents: 0,
  });

  const [violationAlert, setViolationAlert] = useState<string | null>(null);

  const triggerAlert = useCallback((msg: string) => {
    setViolationAlert(msg);
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    setTimeout(() => setViolationAlert(null), 3500);
  }, []);

  useEffect(() => {
    if (!isActive) return;

    // 1. 監控切換分頁
    const handleVisibility = () => {
      if (document.hidden) {
        auditRef.current.tabSwitches += 1;
        triggerAlert('⚠️ 賽事警報：偵測到分頁切換 (Tab Switch)');
      }
    };

    // 2. 監控視窗失焦 (分屏/彈出外部程式)
    const handleBlur = () => {
      auditRef.current.blurEvents += 1;
      triggerAlert('⚠️ 賽事警報：視窗焦點喪失 (Window Blur)');
    };

    // 3. 攔截並阻斷剪貼簿操作
    const handleClipboard = (e: ClipboardEvent) => {
      e.preventDefault();
      auditRef.current.clipboardEvents += 1;
      triggerAlert('⚠️ 賽事警報：禁用剪貼簿傳輸 (Clipboard Blocked)');
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
    };
  }, [isActive, triggerAlert]);

  const verifyTrustedInput = useCallback(
    (e: UIEvent): boolean => {
      if (!isActive) return true;
      if (!e.isTrusted) {
        auditRef.current.untrustedEvents += 1;
        triggerAlert('🚫 拒絕非人類輸入源 (Untrusted Synthetic Event)');
        return false;
      }
      return true;
    },
    [isActive, triggerAlert]
  );

  const resetAudit = useCallback(() => {
    auditRef.current = { tabSwitches: 0, blurEvents: 0, clipboardEvents: 0, untrustedEvents: 0 };
    setViolationAlert(null);
  }, []);

  return {
    auditTrail: auditRef.current,
    violationAlert,
    verifyTrustedInput,
    resetAudit,
  };
};
