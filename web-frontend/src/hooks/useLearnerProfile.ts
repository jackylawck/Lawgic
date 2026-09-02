// web-frontend/src/hooks/useLearnerProfile.ts
import { useState, useCallback } from 'react';

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master';
export type CognitiveDimension = 'spatial' | 'numeric' | 'workingMemory' | 'inhibition' | 'processingSpeed';

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
  hypothesisCount?: number;
  technique?: string;
  partialCompletionRatio?: number;
}

export interface TechniqueStats {
  attempts: number;
  avgTimeSec: number;
  accuracy: number;
  times?: number[];
  conflicts?: number[];
}

export interface PersonalBest {
  fastestTime: number;
  highestAccuracy: number;
  longestStreak: number;
  bestPercentile: number;
  updatedAt: string;
}

export interface LearnerProfileState {
  totalAttempts: number;
  currentStreak: number;
  personalBest: PersonalBest;
  userAge: number;
  techniqueStats: Record<string, TechniqueStats>;
  recentRecords: AttemptPayload[];
  history: AttemptPayload[]; // 保證向後兼容 useLongTermScheduler
  cognitiveDimensions: Record<CognitiveDimension, number>;
  previousCognitiveDimensions: Record<CognitiveDimension, number>;
}

export interface MetricCI {
  mean: number;
  sem: number;
  ci95: [number, number];
}

export interface BenchmarkMetrics {
  benchmarkTime: number;
  sem: number;
  ci95: [number, number];
  conflictCI: MetricCI;
  percentileRank: number;
  isBootstrap: boolean;
  isNewPB: boolean;
  recommendedFocus: {
    dimension: CognitiveDimension;
    targetGame: string;
    reasonZh: string;
    reasonEn: string;
  };
}

function computeAdaptiveBootstrapCI(values: number[], nIterations = 1000): MetricCI {
  const n = values.length;
  if (n < 3) {
    const mean = values.reduce((a, b) => a + b, 0) / (n || 1);
    return {
      mean: Number(mean.toFixed(1)),
      sem: Math.max(1, Math.round(mean * 0.15)),
      ci95: [Math.max(0, Math.round(mean * 0.7)), Math.round(mean * 1.3)],
    };
  }

  const half = Math.floor(n / 2);
  const olderAvg = values.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const recentAvg = values.slice(half).reduce((a, b) => a + b, 0) / (n - half);
  const speedGain = olderAvg > 0 ? (olderAvg - recentAvg) / olderAvg : 0;
  const adaptiveDecay = Math.max(0.04, Math.min(0.16, 0.06 + speedGain * 0.4));

  const cdf: number[] = new Array(n);
  let cumulative = 0;
  for (let i = 0; i < n; i++) {
    cumulative += Math.exp(adaptiveDecay * i);
    cdf[i] = cumulative;
  }

  const resampledMeans: number[] = new Array(nIterations);
  for (let i = 0; i < nIterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const rand = Math.random() * cumulative;
      let low = 0, high = n - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (cdf[mid] >= rand) high = mid;
        else low = mid + 1;
      }
      sum += values[low];
    }
    resampledMeans[i] = sum / n;
  }

  resampledMeans.sort((a, b) => a - b);
  const bootstrapMean = resampledMeans.reduce((a, b) => a + b, 0) / nIterations;
  const variance = resampledMeans.reduce((acc, v) => acc + Math.pow(v - bootstrapMean, 2), 0) / (nIterations - 1);

  return {
    mean: Number(bootstrapMean.toFixed(1)),
    sem: Number(Math.max(0.5, Math.sqrt(variance)).toFixed(1)),
    ci95: [
      Math.max(0, Math.round(resampledMeans[Math.floor(nIterations * 0.025)])),
      Math.round(resampledMeans[Math.floor(nIterations * 0.975)]),
    ],
  };
}

function estimateAgeAdjustedMensaPercentile(
  accuracy: number,
  avgTime: number,
  totalAttempts: number,
  age: number
): number {
  if (totalAttempts === 0) return 50.0;
  const ageWeight = age < 25 ? 0.96 : age < 45 ? 1.0 : age < 60 ? 1.08 : 1.18;
  const timeFactor = Math.max(0, Math.min(2.2, 120 / (avgTime || 120)));
  const composite = (accuracy * 0.6 + timeFactor * 0.4) * ageWeight;

  const z = (composite - 0.98) / 0.34;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z < 0) p = 1 - p;
  return Number(Math.max(1.0, Math.min(99.9, p * 100)).toFixed(1));
}

export const useLearnerProfile = () => {
  const [profile, setProfile] = useState<LearnerProfileState>(() => {
    try {
      const stored = localStorage.getItem('logicore_learner_profile');
      if (stored) {
        const parsed = JSON.parse(stored);
        const records = parsed.recentRecords || parsed.history || [];
        return {
          totalAttempts: parsed.totalAttempts || 0,
          currentStreak: parsed.currentStreak || 0,
          userAge: parsed.userAge || 35,
          personalBest: parsed.personalBest || {
            fastestTime: 9999,
            highestAccuracy: 1.0,
            longestStreak: 0,
            bestPercentile: 50.0,
            updatedAt: new Date().toISOString(),
          },
          techniqueStats: parsed.techniqueStats || {},
          recentRecords: records,
          history: records,
          cognitiveDimensions: parsed.cognitiveDimensions || {
            spatial: 0.65,
            numeric: 0.65,
            workingMemory: 0.6,
            inhibition: 0.7,
            processingSpeed: 0.7,
          },
          previousCognitiveDimensions: parsed.previousCognitiveDimensions || {
            spatial: 0.5,
            numeric: 0.5,
            workingMemory: 0.5,
            inhibition: 0.5,
            processingSpeed: 0.5,
          },
        };
      }
    } catch (e) {
      console.warn('Storage parsing failed', e);
    }
    return {
      totalAttempts: 0,
      currentStreak: 0,
      userAge: 35,
      personalBest: {
        fastestTime: 9999,
        highestAccuracy: 1.0,
        longestStreak: 0,
        bestPercentile: 50.0,
        updatedAt: new Date().toISOString(),
      },
      techniqueStats: {},
      recentRecords: [],
      history: [],
      cognitiveDimensions: {
        spatial: 0.65,
        numeric: 0.65,
        workingMemory: 0.6,
        inhibition: 0.7,
        processingSpeed: 0.7,
      },
      previousCognitiveDimensions: {
        spatial: 0.5,
        numeric: 0.5,
        workingMemory: 0.5,
        inhibition: 0.5,
        processingSpeed: 0.5,
      },
    };
  });

  const recordAttempt = useCallback((payload: AttemptPayload) => {
    setProfile((prev) => {
      const tech = payload.technique || 'General';
      const prevStat: TechniqueStats = prev.techniqueStats[tech] || {
        attempts: 0,
        avgTimeSec: payload.timeSpentSec,
        accuracy: 1.0,
        times: [],
        conflicts: [],
      };

      const newAttempts = prevStat.attempts + 1;
      const newTimes = [...(prevStat.times || []), payload.timeSpentSec].slice(-40);
      const newConflicts = [...(prevStat.conflicts || []), payload.conflictsCount].slice(-40);

      const effectiveAccuracy = payload.isSuccess
        ? payload.conflictsCount === 0 ? 1 : 0.85
        : (payload.partialCompletionRatio || 0) * 0.7;

      const newAvgTime = Math.round(newTimes.reduce((a, b) => a + b, 0) / newTimes.length);
      const newAccuracy = Number(
        ((prevStat.accuracy * prevStat.attempts + effectiveAccuracy) / newAttempts).toFixed(2)
      );

      let isPB = false;
      const pb = { ...prev.personalBest };
      if (payload.isSuccess && payload.timeSpentSec < pb.fastestTime) {
        pb.fastestTime = payload.timeSpentSec;
        isPB = true;
      }
      const newStreak = payload.isSuccess ? prev.currentStreak + 1 : 0;
      if (newStreak > pb.longestStreak) {
        pb.longestStreak = newStreak;
        isPB = true;
      }
      if (isPB) pb.updatedAt = new Date().toISOString();

      const shouldSnapshot = (prev.totalAttempts + 1) % 10 === 0;
      const prevSnapshot = shouldSnapshot ? { ...prev.cognitiveDimensions } : prev.previousCognitiveDimensions;

      const speedScore = Math.max(0.2, Math.min(0.98, 120 / (payload.timeSpentSec || 120)));
      const accuracyScore = payload.conflictsCount === 0 ? 0.95 : Math.max(0.3, 0.9 - payload.conflictsCount * 0.1);

      const updatedDims: Record<CognitiveDimension, number> = {
        spatial: Number((prev.cognitiveDimensions.spatial * 0.85 + (payload.cognitiveLoad.spatial || 0.6) * 0.15).toFixed(2)),
        numeric: Number((prev.cognitiveDimensions.numeric * 0.85 + (payload.cognitiveLoad.numeric || 0.6) * 0.15).toFixed(2)),
        workingMemory: Number((prev.cognitiveDimensions.workingMemory * 0.85 + (payload.cognitiveLoad.workingMemory || 0.6) * 0.15).toFixed(2)),
        inhibition: Number((prev.cognitiveDimensions.inhibition * 0.85 + accuracyScore * 0.15).toFixed(2)),
        processingSpeed: Number((prev.cognitiveDimensions.processingSpeed * 0.85 + speedScore * 0.15).toFixed(2)),
      };

      const records = [payload, ...(prev.recentRecords || prev.history || [])].slice(0, 50);

      const updated: LearnerProfileState = {
        totalAttempts: prev.totalAttempts + 1,
        currentStreak: newStreak,
        personalBest: pb,
        userAge: prev.userAge,
        techniqueStats: {
          ...prev.techniqueStats,
          [tech]: {
            attempts: newAttempts,
            avgTimeSec: newAvgTime,
            accuracy: newAccuracy,
            times: newTimes,
            conflicts: newConflicts,
          },
        },
        recentRecords: records,
        history: records,
        cognitiveDimensions: updatedDims,
        previousCognitiveDimensions: prevSnapshot,
      };

      try {
        localStorage.setItem('logicore_learner_profile', JSON.stringify(updated));
      } catch (e) {
        console.warn('Quota exceeded', e);
      }
      return updated;
    });
  }, []);

  const getBenchmarkMetrics = useCallback(
    (technique: string, defaultTime: number): BenchmarkMetrics => {
      const stat = profile.techniqueStats[technique];
      const dims = profile.cognitiveDimensions;

      const dimEntries = Object.entries(dims) as [CognitiveDimension, number][];
      dimEntries.sort((a, b) => a[1] - b[1]);
      const weakestDim = dimEntries[0][0];

      const suggestionMap: Record<CognitiveDimension, { game: string; zh: string; en: string }> = {
        spatial: { game: 'skyscraper', zh: '空間透視略低，建議強化「摩天透視」3D 心理旋轉', en: 'Spatial perspective low; train 3D mental rotation in Skyscraper.' },
        numeric: { game: 'sudoku', zh: '數理約束推導需加強，建議挑戰「數獨魔陣」', en: 'Numeric deduction needs focus; challenge Sudoku.' },
        workingMemory: { game: 'sudoku', zh: '工作記憶負載較重，練習「專家級數獨」候選數鏈條', en: 'Working memory overloaded; practice expert Sudoku chains.' },
        inhibition: { game: 'skyscraper', zh: '衝動抑制有失誤，練習透視極值交叉定位', en: 'Inhibition slip detected; practice extreme visibility constraint.' },
        processingSpeed: { game: 'maze', zh: '反應速度可進一步激發，建議速通「空間迷宮」', en: 'Processing speed could be boosted; sprint through Maze.' },
      };

      const rec = suggestionMap[weakestDim] || suggestionMap.spatial;

      if (!stat || stat.attempts < 4 || !stat.times || stat.times.length < 4) {
        return {
          benchmarkTime: defaultTime,
          sem: Math.round(defaultTime * 0.15),
          ci95: [Math.max(10, defaultTime - Math.round(defaultTime * 0.3)), defaultTime + Math.round(defaultTime * 0.3)],
          conflictCI: { mean: 0.5, sem: 0.2, ci95: [0, 2] },
          percentileRank: 65.0,
          isBootstrap: false,
          isNewPB: false,
          recommendedFocus: {
            dimension: weakestDim,
            targetGame: rec.game,
            reasonZh: rec.zh,
            reasonEn: rec.en,
          },
        };
      }

      const timeCI = computeAdaptiveBootstrapCI(stat.times, 1000);
      const conflictCI = computeAdaptiveBootstrapCI(stat.conflicts || [0], 1000);
      const percentileRank = estimateAgeAdjustedMensaPercentile(stat.accuracy, stat.avgTimeSec, stat.attempts, profile.userAge);

      return {
        benchmarkTime: Math.round(timeCI.mean * 0.8 + defaultTime * 0.2),
        sem: Math.round(timeCI.sem),
        ci95: timeCI.ci95,
        conflictCI,
        percentileRank,
        isBootstrap: true,
        isNewPB: profile.recentRecords[0]?.timeSpentSec <= profile.personalBest.fastestTime,
        recommendedFocus: {
          dimension: weakestDim,
          targetGame: rec.game,
          reasonZh: rec.zh,
          reasonEn: rec.en,
        },
      };
    },
    [profile]
  );

  const getBenchmarkTime = useCallback(
    (technique: string, defaultTime: number): number => {
      return getBenchmarkMetrics(technique, defaultTime).benchmarkTime;
    },
    [getBenchmarkMetrics]
  );

  return { profile, recordAttempt, getBenchmarkMetrics, getBenchmarkTime };
};
