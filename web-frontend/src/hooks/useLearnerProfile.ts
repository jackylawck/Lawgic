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
  times: number[]; // 儲存歷史時間計算精確標準誤
}

export interface BenchmarkMetrics {
  benchmarkTime: number;
  sem: number;
  ci95: [number, number];
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
        times: [],
      };

      const newAttempts = prevStat.attempts + 1;
      const newTimes = [...(prevStat.times || []), payload.timeSpentSec].slice(-30);
      const newAvgTime = Math.round(newTimes.reduce((a, b) => a + b, 0) / newTimes.length);
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
            times: newTimes,
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

  // 取得基準時間並計算 95% 信賴區間與標準誤 (SEM)
  const getBenchmarkMetrics = useCallback(
    (technique: string, defaultTime: number): BenchmarkMetrics => {
      const stat = profile.techniqueStats[technique];
      if (!stat || stat.attempts < 3 || !stat.times || stat.times.length < 3) {
        return {
          benchmarkTime: defaultTime,
          sem: Math.round(defaultTime * 0.15),
          ci95: [Math.max(10, defaultTime - Math.round(defaultTime * 0.3)), defaultTime + Math.round(defaultTime * 0.3)],
        };
      }

      const n = stat.times.length;
      const mean = stat.avgTimeSec;
      const variance = stat.times.reduce((acc, t) => acc + Math.pow(t - mean, 2), 0) / (n - 1);
      const sd = Math.sqrt(variance);
      const sem = Math.max(1, Math.round(sd / Math.sqrt(n)));
      const weightedBench = Math.round(mean * 0.75 + defaultTime * 0.25);

      return {
        benchmarkTime: weightedBench,
        sem,
        ci95: [Math.max(5, weightedBench - Math.round(1.96 * sem)), weightedBench + Math.round(1.96 * sem)],
      };
    },
    [profile]
  );

  return { profile, recordAttempt, getBenchmarkMetrics };
};
