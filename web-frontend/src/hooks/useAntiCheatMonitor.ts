// web-frontend/src/hooks/useAntiCheatMonitor.ts
import { useEffect } from 'react';
import {
  useAntiCheatActions,
  useAntiCheatAlert,
  ExtendedSecurityAuditTrail,
} from '../contexts/AntiCheatContext';

export type { ExtendedSecurityAuditTrail };

/**
 * 舊版相容適配層
 * ⚠️ 效能指引：高頻解題元件請優先直接使用 `useAntiCheatActions()`，避免告警觸發造成畫布重繪。
 */
export const useAntiCheatMonitor = (isActive: boolean) => {
  const {
    verifyTrustedInput,
    getAuditSnapshot,
    getAuditSnapshotSync,
    resetAudit,
    setMonitoringActive,
  } = useAntiCheatActions();

  const { violationAlert, violationCode } = useAntiCheatAlert();

  useEffect(() => {
    setMonitoringActive(isActive);
    return () => {
      setMonitoringActive(false);
    };
  }, [isActive, setMonitoringActive]);

  return {
    auditTrail: getAuditSnapshotSync(),
    violationAlert,
    violationCode,
    verifyTrustedInput,
    getAuditSnapshot,
    resetAudit,
  };
};
