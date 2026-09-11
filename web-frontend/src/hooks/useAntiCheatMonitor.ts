// web-frontend/src/hooks/useAntiCheatMonitor.ts
import { useEffect } from 'react';
import {
  useAntiCheatActions,
  useAntiCheatAlert,
  ExtendedSecurityAuditTrail,
} from '../contexts/AntiCheatContext';

export type { ExtendedSecurityAuditTrail };

/**
 * 賽事防作弊監控 Hook（輕量相容適配層）
 * 底層接入全域單例 AntiCheatContext，杜絕重複事件註冊與畫布無謂重繪
 */
export const useAntiCheatMonitor = (isActive: boolean) => {
  const {
    verifyTrustedInput,
    getAuditSnapshot,
    getAuditSnapshotSync,
    resetAudit,
    setMonitoringActive,
  } = useAntiCheatActions();

  const { violationAlert } = useAntiCheatAlert();

  useEffect(() => {
    setMonitoringActive(isActive);
    return () => {
      setMonitoringActive(false);
    };
  }, [isActive, setMonitoringActive]);

  return {
    // 提供同步快照取值，維持與原呼叫端介面相容
    auditTrail: getAuditSnapshotSync(),
    violationAlert,
    verifyTrustedInput,
    getAuditSnapshot,
    resetAudit,
  };
};
