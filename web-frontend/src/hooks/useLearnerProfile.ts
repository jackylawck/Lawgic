// web-frontend/src/hooks/useLearnerProfile.ts
import { useState, useCallback } from 'react';

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master';
export type CognitiveDimension = 'spatial' | 'numeric' | 'workingMemory' | 'inhibition';

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
  times?: number[];
}

export interface LearnerProfileState {
  totalAttempts: number;
  techniqueStats: Record<string, TechniqueStats>;
  recentRecords: AttemptPayload[];
  cognitiveDimensions?: Record<CognitiveDimension, number>;
}

export interface BenchmarkMetrics {
  benchmarkTime: number;
  sem: number;
  ci95: [number, number];
}

export const useLearnerProfile = () => {
  const [profile, setProfile] = useState<LearnerProfileState>(() => {
    try {
      const stored = localStorage.getItem('logicore_learner_profile');
      return stored
        ? JSON.parse(stored)
        : {
            totalAttempts: 0,
            techniqueStats: {},
            recentRecords: [],
            cognitiveDimensions: {
              spatial: 0.5,
              numeric: 0.5,
              workingMemory: 0.5,
              inhibition: 0.5,
            },
          };
    } catch {
      return {
        totalAttempts: 0,
        techniqueStats: {},
        recentRecords: [],
        cognitiveDimensions: {
          spatial: 0.5,
          numeric: 0.5,
          workingMemory: 0.5,
          inhibition: 0.5,
        },
      };
    }
  });

  const recordAttempt = useCallback((payload: AttemptPayload) => {
    setProfile((prev) => {
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

      const updated: LearnerProfileState = {
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
        cognitiveDimensions: prev.cognitiveDimensions,
      };

      try {
        localStorage.setItem('logicore_learner_profile', JSON.stringify(updated));
      } catch (e) {
        console.warn('Storage quota exceeded', e);
      }
      return updated;
    });
  }, []);

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

  // 向後相容既有模組的單一數值讀取呼叫
  const getBenchmarkTime = useCallback(
    (technique: string, defaultTime: number): number => {
      return getBenchmarkMetrics(technique, defaultTime).benchmarkTime;
    },
    [getBenchmarkMetrics]
  );

  return { profile, recordAttempt, getBenchmarkMetrics, getBenchmarkTime };
};
