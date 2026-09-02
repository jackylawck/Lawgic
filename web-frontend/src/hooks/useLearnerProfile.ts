// web-frontend/src/hooks/useLearnerProfile.ts
import { useState, useCallback } from 'react';

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master';

export interface AttemptPayload {
  puzzleId: string;
  engineType: string;
  tier: TierKey;
  cognitiveLoad: {
    spatial: number;
    numeric: number;
    workingMemory: number;
    inhibition: number;
  };
  isSuccess: boolean;
  timeSpentSec: number;
  conflictsCount: number;
  technique?: string;
}

export interface TechniqueStats {
  attempts: number;
  avgTimeSec: number;
  accuracy: number;
}

export const useLearnerProfile = () => {
  const [profile, setProfile] = useState(() => {
    try {
      const stored = localStorage.getItem('logicore_learner_profile');
      return stored
        ? JSON.parse(stored)
        : {
            totalAttempts: 0,
            techniqueStats: {} as Record<string, TechniqueStats>,
            recentRecords: [] as AttemptPayload[],
          };
    } catch {
      return { totalAttempts: 0, techniqueStats: {}, recentRecords: [] };
    }
  });

  const recordAttempt = useCallback((payload: AttemptPayload) => {
    setProfile((prev: any) => {
      const tech = payload.technique || 'General';
      const prevStat: TechniqueStats = prev.techniqueStats[tech] || {
        attempts: 0,
        avgTimeSec: payload.timeSpentSec,
        accuracy: 1.0,
      };

      const newAttempts = prevStat.attempts + 1;
      const newAvgTime = Math.round((prevStat.avgTimeSec * prevStat.attempts + payload.timeSpentSec) / newAttempts);
      const newAccuracy = Number(
        ((prevStat.accuracy * prevStat.attempts + (payload.conflictsCount === 0 ? 1 : 0.8)) / newAttempts).toFixed(2)
      );

      const updated = {
        totalAttempts: prev.totalAttempts + 1,
        techniqueStats: {
          ...prev.techniqueStats,
          [tech]: {
            attempts: newAttempts,
            avgTimeSec: newAvgTime,
            accuracy: newAccuracy,
          },
        },
        recentRecords: [payload, ...(prev.recentRecords || [])].slice(0, 50),
      };

      try {
        localStorage.setItem('logicore_learner_profile', JSON.stringify(updated));
      } catch (e) {
        console.warn('Storage quota exceeded', e);
      }
      return updated;
    });
  }, []);

  const getBenchmarkTime = useCallback(
    (technique: string, defaultTime: number) => {
      const stat = profile.techniqueStats[technique];
      if (!stat || stat.attempts < 2) return defaultTime;
      // 結合個人歷史平均（70% 權重）與題目理論基準（30% 權重）
      return Math.round(stat.avgTimeSec * 0.7 + defaultTime * 0.3);
    },
    [profile]
  );

  return { profile, recordAttempt, getBenchmarkTime };
};
