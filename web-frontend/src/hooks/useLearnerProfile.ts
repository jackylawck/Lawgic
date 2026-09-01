// web-frontend/src/hooks/useLearnerProfile.ts
import { useState, useEffect, useCallback, useMemo } from 'react';
import { CognitiveLoadVector } from '../generated';

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master';
export type CognitiveDimension = 'spatial' | 'numeric' | 'workingMemory' | 'inhibition';
export type LearnerPersona = 'explorer' | 'deliberate' | 'struggler' | 'neutral';

export interface AttemptLog {
  puzzleId: string;
  engineType: string;
  tier: TierKey;
  cognitiveLoad: CognitiveLoadVector;
  isSuccess: boolean;
  timeSpentSec: number;
  conflictsCount: number;
  timestamp: number;
}

export interface LearnerProfileState {
  version: number;
  theta: Record<CognitiveDimension, number>;
  history: AttemptLog[];
  streak: number;
  morale: number;
  lastActiveDate: string;
}

const STORAGE_KEY = 'LOGICORE_LEARNER_PROFILE_V8';

const INITIAL_PROFILE: LearnerProfileState = {
  version: 8,
  theta: {
    spatial: 0.5,
    numeric: 0.5,
    workingMemory: 0.5,
    inhibition: 0.5,
  },
  history: [],
  streak: 0,
  morale: 1.0,
  lastActiveDate: new Date().toISOString().split('T')[0],
};

const TIER_ORDER: TierKey[] = ['kids', 'intermediate', 'expert', 'master'];

export function useLearnerProfile() {
  const [profile, setProfile] = useState<LearnerProfileState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // 降級使用預設狀態
    }
    return INITIAL_PROFILE;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
      console.error('Failed to persist learner profile:', e);
    }
  }, [profile]);

  // 1. 🧠 隱含人格推導 (Persona Inference)
  const persona: LearnerPersona = useMemo(() => {
    const recent = profile.history.slice(-20);
    if (recent.length < 5) return 'neutral';

    const totalConflicts = recent.reduce((acc, h) => acc + h.conflictsCount, 0);
    const totalTime = recent.reduce((acc, h) => acc + h.timeSpentSec, 0);
    const successes = recent.filter((h) => h.isSuccess);

    const avgConflicts = totalConflicts / recent.length;
    const avgTime = totalTime / recent.length;
    const successRate = successes.length / recent.length;

    if (successRate < 0.55) return 'struggler';
    if (avgConflicts < 0.8 && avgTime < 50 && successRate >= 0.85) return 'explorer';
    if (avgConflicts <= 1.8 && avgTime > 80 && successRate >= 0.75) return 'deliberate';

    return 'neutral';
  }, [profile.history]);

  // 2. 🎯 動態 ZPD 調度策略 (結合人格加權)
  const getZPDRecommendedTier = useCallback(
    (engineType: string, defaultLoad: CognitiveLoadVector): TierKey => {
      const engineHistory = profile.history.filter((h) => h.engineType === engineType);
      if (engineHistory.length === 0) return 'kids';

      const recentEngine = engineHistory.slice(-10);
      const currentTier = recentEngine[recentEngine.length - 1].tier;
      const currentTierIdx = TIER_ORDER.indexOf(currentTier);

      const successRate =
        recentEngine.filter((h) => h.isSuccess).length / recentEngine.length;

      // 計算認知效率指數 CEI (Cognitive Efficiency Index)
      const avgTime =
        recentEngine.reduce((acc, h) => acc + h.timeSpentSec, 0) / recentEngine.length;
      const avgConflicts =
        recentEngine.reduce((acc, h) => acc + h.conflictsCount, 0) / recentEngine.length;

      // 根據 Persona 動態設定升降階閾值
      let promoteThreshold = 0.8;
      let demoteThreshold = 0.45;

      if (persona === 'explorer') {
        promoteThreshold = 0.7; // 冒險型：放寬升階門檻
      } else if (persona === 'deliberate') {
        promoteThreshold = 0.85; // 審慎型：嚴格升階，強調穩定度
      } else if (persona === 'struggler') {
        demoteThreshold = 0.6; // 掙扎型：及早觸發降階防禦
      }

      // 升階判斷
      if (
        successRate >= promoteThreshold &&
        avgConflicts < 2.0 &&
        avgTime < 90 &&
        currentTierIdx < TIER_ORDER.length - 1
      ) {
        return TIER_ORDER[currentTierIdx + 1];
      }

      // 降階判斷
      if (successRate <= demoteThreshold && currentTierIdx > 0) {
        return TIER_ORDER[currentTierIdx - 1];
      }

      return currentTier;
    },
    [profile.history, persona]
  );

  // 3. 採樣記錄與 Elo/IRT 能力值更新
  const recordAttempt = useCallback((log: Omit<AttemptLog, 'timestamp'>) => {
    const timestamp = Date.now();
    const fullLog: AttemptLog = { ...log, timestamp };

    setProfile((prev) => {
      const today = new Date().toISOString().split('T')[0];
      const isNewDay = prev.lastActiveDate !== today;
      const newStreak = log.isSuccess ? (isNewDay ? prev.streak + 1 : prev.streak) : 0;

      // IRT 更新步長 (K-factor)
      const kFactor = 0.04;
      const deltaTheta = log.isSuccess ? kFactor : -kFactor * 0.8;

      const newTheta = { ...prev.theta };
      (Object.keys(newTheta) as CognitiveDimension[]).forEach((dim) => {
        const load = log.cognitiveLoad[dim] || 0.5;
        newTheta[dim] = Math.max(0.1, Math.min(1.0, newTheta[dim] + deltaTheta * load));
      });

      // 士氣值更新
      const newMorale = log.isSuccess
        ? Math.min(2.0, prev.morale + 0.05)
        : Math.max(0.5, prev.morale - 0.1);

      return {
        ...prev,
        history: [...prev.history, fullLog],
        theta: newTheta,
        streak: newStreak,
        morale: Number(newMorale.toFixed(2)),
        lastActiveDate: today,
      };
    });
  }, []);

  const globalCognitiveProfile = useCallback(() => {
    return {
      spatial: Number(profile.theta.spatial.toFixed(2)),
      numeric: Number(profile.theta.numeric.toFixed(2)),
      workingMemory: Number(profile.theta.workingMemory.toFixed(2)),
      inhibition: Number(profile.theta.inhibition.toFixed(2)),
    };
  }, [profile.theta]);

  const exportProfileJSON = useCallback(() => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(profile, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `logicore_profile_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }, [profile]);

  const importProfileJSON = useCallback((jsonStr: string): boolean => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && parsed.theta && Array.isArray(parsed.history)) {
        setProfile(parsed);
        return true;
      }
    } catch (e) {
      console.error('Import failed:', e);
    }
    return false;
  }, []);

  return {
    profile,
    persona,
    getZPDRecommendedTier,
    recordAttempt,
    globalCognitiveProfile,
    exportProfileJSON,
    importProfileJSON,
  };
}
