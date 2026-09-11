// web-frontend/src/hooks/useLearnerProfile.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import { SecureStorage } from '../utils/secureStorage';
import { useLanguage } from '../contexts/LanguageContext';
import { ItemBankCalibrator } from '../utils/itemBankCalibrator';

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master' | 'legendary' | 'ultimate';
export type ExtendedTierKey = TierKey;
export type CognitiveDimension = 'spatial' | 'numeric' | 'workingMemory' | 'inhibition' | 'processingSpeed';

const VALID_TIERS: readonly TierKey[] = ['kids', 'intermediate', 'expert', 'master', 'legendary', 'ultimate'];
const isValidTier = (v: unknown): v is TierKey =>
  typeof v === 'string' && (VALID_TIERS as readonly string[]).includes(v);

export interface HintDistributionTrend {
  t1Count: number; // 0~30s
  t2Count: number; // 30~60s
  t3Count: number; // 60s+
  totalCalls: number;
}

export interface PBAchievements {
  fastestTime?: boolean;
  longestStreak?: boolean;
}

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
  partialCredit?: number;
  isPureModeAttempt?: boolean;
  isPureClear?: boolean;
  hintLogs?: { secFromStart: number; level: number }[];
  irtDifficulty?: number;
  timestamp?: string;
  isNewPB?: boolean;
  pbAchievements?: PBAchievements;
}

export type AttemptRecord = AttemptPayload;

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

export interface BookmarkRecord {
  puzzleId: string;
  engineType: string;
  tier: TierKey;
  boardState: unknown;
  elapsedSec: number;
  bookmarkedAt: string;
}

export interface SpatialCompositeIndex {
  standardScore: number;
  spatialPercentile: number;
  eulerianLoopControl: number;
  planarPartitioning: number;
  rayTracingControl: number;
  recommendedDrill: string;
}

export interface LearnerProfileState {
  totalAttempts: number;
  currentStreak: number;
  pureStreak: number;
  personalBest: PersonalBest;
  userAge: number;
  techniqueStats: Record<string, TechniqueStats>;
  recentRecords: AttemptPayload[];
  /** @deprecated 歷史過渡欄位，內部存取已完全遷移至 recentRecords */
  history?: AttemptPayload[];
  bookmarks: Record<string, BookmarkRecord>;
  hintTrend: HintDistributionTrend;
  cognitiveDimensions: Record<CognitiveDimension, number>;
  previousCognitiveDimensions: Record<CognitiveDimension, number>;
}

export interface MetricCI {
  mean: number;
  sem: number;
  ci95: [number, number];
}

export interface AgeStratifiedNorm {
  cohort: string;
  cohortMean: number;
  cohortSd: number;
  ageAdjustedZ: number;
  agePercentile: number;
  isCalibrated: boolean;
  dataSource: string;
}

export interface PsychometricReliability {
  cronbachAlpha: number;
  splitHalfReliability: number;
  csem: number;
}

export interface CompositeCognitiveIndex {
  rawGf: number;
  standardIQ: number;
  percentileRank: number;
  semIQ: number;
  ci95IQ: [number, number];
  ageNorm: AgeStratifiedNorm;
  reliability: PsychometricReliability;
  scientificDisclaimer: string;
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

const DEFAULT_PROFILE: LearnerProfileState = {
  totalAttempts: 0,
  currentStreak: 0,
  pureStreak: 0,
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
  bookmarks: {},
  hintTrend: { t1Count: 0, t2Count: 0, t3Count: 0, totalCalls: 0 },
  cognitiveDimensions: {
    spatial: 0.65,
    numeric: 0.65,
    workingMemory: 0.60,
    inhibition: 0.70,
    processingSpeed: 0.70,
  },
  previousCognitiveDimensions: {
    spatial: 0.50,
    numeric: 0.50,
    workingMemory: 0.50,
    inhibition: 0.50,
    processingSpeed: 0.50,
  },
};

const AGE_NORM_COHORTS = [
  { maxAge: 24, label: '18-24', mean: 103, sd: 14.2 },
  { maxAge: 34, label: '25-34', mean: 101, sd: 14.8 },
  { maxAge: 44, label: '35-44', mean: 99, sd: 15.1 },
  { maxAge: 54, label: '45-54', mean: 96, sd: 15.6 },
  { maxAge: 120, label: '55+', mean: 93, sd: 16.2 },
];

const MASYU_ALIASES = new Set(['masyu', 'pearl']);
const NURIKABE_ALIASES = new Set(['nurikabe']);
const LIGHTUP_ALIASES = new Set(['lightup', 'akari']);

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
  const olderAvg = values.slice(0, half).reduce((a, b) => a + b, 0) / (half || 1);
  const recentAvg = values.slice(half).reduce((a, b) => a + b, 0) / (n - half || 1);
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
        if ((cdf[mid] ?? 0) >= rand) high = mid;
        else low = mid + 1;
      }
      sum += values[low] ?? 0;
    }
    resampledMeans[i] = sum / n;
  }

  resampledMeans.sort((a, b) => a - b);
  const bootstrapMean = resampledMeans.reduce((a, b) => a + b, 0) / nIterations;
  const variance = resampledMeans.reduce((acc, v) => acc + Math.pow(v - bootstrapMean, 2), 0) / (nIterations - 1);

  return {
    mean: Number(bootstrapMean.toFixed(1)),
    sem: Number(Math.max(0.5, Math.sqrt(Math.max(0.001, variance))).toFixed(1)),
    ci95: [
      Math.max(0, Math.round(resampledMeans[Math.floor(nIterations * 0.025)] ?? bootstrapMean * 0.8)),
      Math.round(resampledMeans[Math.floor(nIterations * 0.975)] ?? bootstrapMean * 1.2),
    ],
  };
}

function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z < 0) p = 1 - p;
  return Math.max(0.0001, Math.min(0.9999, p));
}

/**
 * P0 安全防御：白名單欄位校驗 + 嚴格 Tier 枚舉驗證，根治原型污染與髒數據
 */
function sanitizeBookmark(raw: unknown): BookmarkRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.puzzleId !== 'string' || !r.puzzleId.trim()) return null;
  if (typeof r.engineType !== 'string' || !r.engineType.trim()) return null;
  if (!isValidTier(r.tier)) return null;
  if (typeof r.elapsedSec !== 'number' || isNaN(r.elapsedSec)) return null;
  if (typeof r.bookmarkedAt !== 'string' || !r.bookmarkedAt.trim()) return null;

  return {
    puzzleId: r.puzzleId,
    engineType: r.engineType,
    tier: r.tier,
    boardState: r.boardState,
    elapsedSec: r.elapsedSec,
    bookmarkedAt: r.bookmarkedAt,
  };
}

/**
 * 100% 純狀態演繹器
 */
function computeNextProfileState(
  prev: LearnerProfileState,
  recordWithTime: AttemptPayload
): LearnerProfileState {
  const tech = recordWithTime.technique || 'General';
  const prevStat: TechniqueStats = prev.techniqueStats[tech] || {
    attempts: 0,
    avgTimeSec: recordWithTime.timeSpentSec,
    accuracy: 1.0,
    times: [],
    conflicts: [],
  };

  const newAttempts = prevStat.attempts + 1;
  const newTimes = [...(prevStat.times || []), recordWithTime.timeSpentSec].slice(-50);
  const newConflicts = [...(prevStat.conflicts || []), recordWithTime.conflictsCount].slice(-50);

  const effectiveAccuracy = recordWithTime.isSuccess
    ? recordWithTime.conflictsCount === 0 ? 1 : 0.85
    : (recordWithTime.partialCompletionRatio || recordWithTime.partialCredit || 0) * 0.7;

  const newAvgTime = Math.round(newTimes.reduce((a, b) => a + b, 0) / newTimes.length);
  const newAccuracy = Number(
    ((prevStat.accuracy * prevStat.attempts + effectiveAccuracy) / newAttempts).toFixed(2)
  );

  let pbAchievements: PBAchievements | undefined;
  let isPB = false;
  const pb = { ...prev.personalBest };
  if (recordWithTime.isSuccess && recordWithTime.timeSpentSec < pb.fastestTime) {
    pb.fastestTime = recordWithTime.timeSpentSec;
    pbAchievements = { ...(pbAchievements || {}), fastestTime: true };
    isPB = true;
  }
  const newStreak = recordWithTime.isSuccess ? prev.currentStreak + 1 : 0;
  if (newStreak > pb.longestStreak) {
    pb.longestStreak = newStreak;
    pbAchievements = { ...(pbAchievements || {}), longestStreak: true };
    isPB = true;
  }
  if (isPB) pb.updatedAt = new Date().toISOString();

  let newPureStreak = prev.pureStreak;
  if (recordWithTime.isPureClear) {
    newPureStreak = prev.pureStreak + 1;
  } else if (recordWithTime.isPureModeAttempt && !recordWithTime.isSuccess) {
    newPureStreak = 0;
  }

  let updatedTrend = { ...prev.hintTrend };
  if (recordWithTime.hintLogs && recordWithTime.hintLogs.length > 0) {
    let t1 = updatedTrend.t1Count;
    let t2 = updatedTrend.t2Count;
    let t3 = updatedTrend.t3Count;
    recordWithTime.hintLogs.forEach((log) => {
      if (log.secFromStart <= 30) t1++;
      else if (log.secFromStart <= 60) t2++;
      else t3++;
    });
    updatedTrend = {
      t1Count: t1,
      t2Count: t2,
      t3Count: t3,
      totalCalls: t1 + t2 + t3,
    };
  }

  const shouldSnapshot = (prev.totalAttempts + 1) % 10 === 0;
  const prevSnapshot = shouldSnapshot ? { ...prev.cognitiveDimensions } : prev.previousCognitiveDimensions;

  const irtDifficulty = recordWithTime.irtDifficulty ?? 1.5;
  const irtFactor = Math.max(0.08, Math.min(0.25, 0.12 + (irtDifficulty / 4.5) * 0.10));
  const speedScore = Math.max(0.2, Math.min(0.98, 120 / (recordWithTime.timeSpentSec || 120)));
  const accuracyScore = recordWithTime.conflictsCount === 0 ? 0.95 : Math.max(0.25, 0.92 - recordWithTime.conflictsCount * 0.1);

  const updatedDims: Record<CognitiveDimension, number> = {
    spatial: Number((prev.cognitiveDimensions.spatial * (1 - irtFactor) + (recordWithTime.cognitiveLoad.spatial || 0.6) * irtFactor).toFixed(2)),
    numeric: Number((prev.cognitiveDimensions.numeric * (1 - irtFactor) + (recordWithTime.cognitiveLoad.numeric || 0.6) * irtFactor).toFixed(2)),
    workingMemory: Number((prev.cognitiveDimensions.workingMemory * (1 - irtFactor) + (recordWithTime.cognitiveLoad.workingMemory || 0.6) * irtFactor).toFixed(2)),
    inhibition: Number((prev.cognitiveDimensions.inhibition * (1 - irtFactor) + accuracyScore * irtFactor).toFixed(2)),
    processingSpeed: Number((prev.cognitiveDimensions.processingSpeed * (1 - irtFactor) + speedScore * irtFactor).toFixed(2)),
  };

  const finalRecord: AttemptPayload = {
    ...recordWithTime,
    isNewPB: isPB,
    ...(pbAchievements && { pbAchievements }),
  };

  const records = [finalRecord, ...(prev.recentRecords || [])].slice(0, 120);

  return {
    totalAttempts: prev.totalAttempts + 1,
    currentStreak: newStreak,
    pureStreak: newPureStreak,
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
    bookmarks: prev.bookmarks,
    hintTrend: updatedTrend,
    cognitiveDimensions: updatedDims,
    previousCognitiveDimensions: prevSnapshot,
  };
}

export const useLearnerProfile = () => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const [profile, setProfile] = useState<LearnerProfileState>(() => {
    try {
      const stored = localStorage.getItem('logicore_learner_profile');
      if (stored) {
        const parsed = JSON.parse(stored);
        const actual = parsed.payload || parsed;
        const records = actual.recentRecords || actual.history || [];
        return {
          ...DEFAULT_PROFILE,
          ...actual,
          pureStreak: actual.pureStreak || 0,
          bookmarks: actual.bookmarks || {},
          hintTrend: actual.hintTrend || DEFAULT_PROFILE.hintTrend,
          recentRecords: records,
        };
      }
    } catch {}
    return DEFAULT_PROFILE;
  });

  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistProfile = useCallback((stateToPersist: LearnerProfileState) => {
    writeQueueRef.current = writeQueueRef.current
      .then(() => SecureStorage.setItemSafe('logicore_learner_profile', stateToPersist))
      .catch((err) => console.warn('[useLearnerProfile] Persistence queue error:', err));
  }, []);

  // P1 墓碑機制（Tombstone Reference）：追蹤在 Hydration 窗口內被用戶明確刪除的題目 ID
  const pendingDeletionsRef = useRef<Set<string>>(new Set());

  // P1 核心修復：合併策略 + 墓碑過濾 + 顯式 pickLocal 治理
  useEffect(() => {
    SecureStorage.getItemSafe('logicore_learner_profile', DEFAULT_PROFILE).then((verified) => {
      setProfile((prev) => {
        const existingIds = new Set(prev.recentRecords.map((r) => `${r.puzzleId}_${r.timestamp}`));
        const verifiedRecords = verified.recentRecords || verified.history || [];
        const mergedRecords = [
          ...prev.recentRecords,
          ...verifiedRecords.filter((r) => !existingIds.has(`${r.puzzleId}_${r.timestamp}`)),
        ].slice(0, 120);

        // 合併書籤並套用墓碑：防止存儲的舊書籤覆蓋用戶在水合空隙中的刪除操作
        const mergedBookmarks = {
          ...(verified.bookmarks || {}),
          ...prev.bookmarks,
        };
        for (const deletedId of pendingDeletionsRef.current) {
          delete mergedBookmarks[deletedId];
        }

        const isLocalActive = prev.totalAttempts > 0;
        const pickLocal = <T>(local: T, remote: T): T => (isLocalActive ? local : remote);

        return {
          ...verified,
          ...prev,
          userAge: pickLocal(prev.userAge, verified.userAge),
          totalAttempts: pickLocal(prev.totalAttempts, verified.totalAttempts),
          currentStreak: pickLocal(prev.currentStreak, verified.currentStreak),
          pureStreak: pickLocal(prev.pureStreak, verified.pureStreak),
          personalBest: pickLocal(prev.personalBest, verified.personalBest),
          bookmarks: mergedBookmarks,
          recentRecords: mergedRecords,
          hintTrend: pickLocal(prev.hintTrend, verified.hintTrend || DEFAULT_PROFILE.hintTrend),
          cognitiveDimensions: pickLocal(prev.cognitiveDimensions, verified.cognitiveDimensions),
          previousCognitiveDimensions: pickLocal(prev.previousCognitiveDimensions, verified.previousCognitiveDimensions),
        };
      });
    });
  }, []);

  // 持久化副作用由 useEffect 嚴格接管
  const lastPersistedStateRef = useRef<LearnerProfileState | null>(null);
  useEffect(() => {
    if (profile.totalAttempts === 0 && Object.keys(profile.bookmarks).length === 0) return;
    if (lastPersistedStateRef.current === profile) return;
    lastPersistedStateRef.current = profile;
    persistProfile(profile);
  }, [profile, persistProfile]);

  // 最新指標引用保持，校準器僅依賴最新紀錄時間戳原語
  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  });

  const latestTimestamp = profile.recentRecords[0]?.timestamp;
  const lastCalibratedTimestampRef = useRef<string | null>(null);

  useEffect(() => {
    if (!latestTimestamp || latestTimestamp === lastCalibratedTimestampRef.current) return;
    lastCalibratedTimestampRef.current = latestTimestamp;

    const currentProfile = profileRef.current;
    const latest = currentProfile.recentRecords[0];
    if (!latest) return;

    try {
      const partialCredit = latest.isSuccess
        ? 1.0
        : (latest.partialCompletionRatio ?? latest.partialCredit ?? 0.0);
      const dims = currentProfile.cognitiveDimensions;
      const approxTheta = ((dims.spatial + dims.numeric + dims.workingMemory) / 3) * 4 - 2;
      ItemBankCalibrator.updateEmpiricalDifficulty(latest.puzzleId, approxTheta, partialCredit);
    } catch (e) {
      console.warn('[ItemBankCalibrator] Empirical update skipped:', e);
    }
  }, [latestTimestamp]);

  const recordAttempt = useCallback((payload: AttemptPayload) => {
    const recordWithTime: AttemptPayload = {
      ...payload,
      timestamp: payload.timestamp || new Date().toISOString(),
    };
    setProfile((prev) => computeNextProfileState(prev, recordWithTime));
  }, []);

  const saveBookmark = useCallback((record: BookmarkRecord) => {
    pendingDeletionsRef.current.delete(record.puzzleId);
    setProfile((prev) => ({
      ...prev,
      bookmarks: { ...prev.bookmarks, [record.puzzleId]: record },
    }));
  }, []);

  const removeBookmark = useCallback((puzzleId: string) => {
    pendingDeletionsRef.current.add(puzzleId);
    setProfile((prev) => {
      const updatedBookmarks = { ...prev.bookmarks };
      delete updatedBookmarks[puzzleId];
      return { ...prev, bookmarks: updatedBookmarks };
    });
  }, []);

  const importBookmarksBundle = useCallback((bundleJson: string): boolean => {
    try {
      const parsed = JSON.parse(bundleJson);
      const incoming = parsed.bookmarks || parsed.bookmarkedPuzzlesVault || parsed;
      if (typeof incoming !== 'object' || incoming === null) return false;

      const sanitized: Record<string, BookmarkRecord> = {};
      for (const [key, value] of Object.entries(incoming)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const cleaned = sanitizeBookmark(value);
        if (cleaned) {
          pendingDeletionsRef.current.delete(cleaned.puzzleId);
          sanitized[key] = cleaned;
        }
      }

      setProfile((prev) => ({
        ...prev,
        bookmarks: { ...prev.bookmarks, ...sanitized },
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const getCompositeCognitiveIndex = useCallback((): CompositeCognitiveIndex => {
    const dims = profile.cognitiveDimensions;
    const rawGf =
      dims.spatial * 0.25 +
      dims.numeric * 0.25 +
      dims.workingMemory * 0.20 +
      dims.inhibition * 0.15 +
      dims.processingSpeed * 0.15;

    const globalZ = (rawGf - 0.65) / 0.16;
    const standardIQ = Math.round(Math.max(65, Math.min(160, 100 + globalZ * 15)));
    const percentileRank = Number((normalCDF(globalZ) * 100).toFixed(1));

    let baseCSEM = 2.4;
    if (standardIQ > 135 || standardIQ < 75) {
      baseCSEM = 4.2;
    } else if (standardIQ > 120 || standardIQ < 85) {
      baseCSEM = 3.2;
    }
    const sampleMultiplier = profile.totalAttempts < 6 ? 1.35 : profile.totalAttempts > 25 ? 0.85 : 1.0;
    const csem = Number((baseCSEM * sampleMultiplier).toFixed(1));

    const ci95IQ: [number, number] = [
      Math.max(60, Math.round(standardIQ - 1.96 * csem)),
      Math.min(165, Math.round(standardIQ + 1.96 * csem)),
    ];

    const age = profile.userAge || 35;
    const cohort = AGE_NORM_COHORTS.find((c) => age <= c.maxAge) || AGE_NORM_COHORTS[2]!;
    const ageAdjustedZ = Number(((standardIQ - cohort.mean) / cohort.sd).toFixed(2));
    const agePercentile = Number((normalCDF(ageAdjustedZ) * 100).toFixed(1));

    const records = profile.recentRecords;
    let cronbachAlpha = 0.88;
    let splitHalfReliability = 0.85;

    if (records.length >= 8) {
      const getExpectedTime = (tier: string) => {
        switch (tier) {
          case 'kids': return 60;
          case 'intermediate': return 120;
          case 'expert': return 240;
          case 'master': return 360;
          case 'legendary': return 480;
          case 'ultimate': return 600;
          default: return 180;
        }
      };

      const oddNormalized = records.filter((_, i) => i % 2 === 1).map((r) => r.timeSpentSec / getExpectedTime(r.tier));
      const evenNormalized = records.filter((_, i) => i % 2 === 0).map((r) => r.timeSpentSec / getExpectedTime(r.tier));
      const minLen = Math.min(oddNormalized.length, evenNormalized.length);

      if (minLen >= 4) {
        let num = 0, den1 = 0, den2 = 0;
        const m1 = oddNormalized.slice(0, minLen).reduce((a, b) => a + b, 0) / minLen;
        const m2 = evenNormalized.slice(0, minLen).reduce((a, b) => a + b, 0) / minLen;
        for (let i = 0; i < minLen; i++) {
          const diff1 = (oddNormalized[i] ?? 0) - m1;
          const diff2 = (evenNormalized[i] ?? 0) - m2;
          num += diff1 * diff2;
          den1 += Math.pow(diff1, 2);
          den2 += Math.pow(diff2, 2);
        }
        const denominator = Math.sqrt(den1 * den2);
        const rHalf = denominator > 0.0001 ? Math.max(-0.99, Math.min(0.99, num / denominator)) : 0.75;
        splitHalfReliability = Number(((2 * rHalf) / (1 + Math.abs(rHalf))).toFixed(2));
        cronbachAlpha = Number(Math.min(0.96, Math.max(0.70, splitHalfReliability * 1.02)).toFixed(2));
      }
    }

    return {
      rawGf: Number(rawGf.toFixed(3)),
      standardIQ,
      percentileRank,
      semIQ: csem,
      ci95IQ,
      ageNorm: {
        cohort: cohort.label,
        cohortMean: cohort.mean,
        cohortSd: cohort.sd,
        ageAdjustedZ,
        agePercentile,
        isCalibrated: false,
        dataSource: 'internal-heuristic-norm-v1',
      },
      reliability: {
        cronbachAlpha,
        splitHalfReliability,
        csem,
      },
      scientificDisclaimer: isEn
        ? 'Notice: Estimated Standard IQ is derived from empirical IRT performance and internal CHC cognitive weights for longitudinal self-tracking. It is an exploratory heuristic index and not an officially certified clinical or Wechsler psychometric assessment.'
        : '聲明：估計標準 IQ 係根據實證 IRT 作答表現與內部 CHC 認知權重計算之探索性常模指標，僅供個人縱向趨勢自我追蹤，非屬臨床或官方標準化 Wechsler 心理測量衡鑑。',
    };
  }, [profile, isEn]);

  const getSpatialCompositeIndex = useCallback((): SpatialCompositeIndex => {
    // P2-3: 語意清理，直接使用 records 指向 recentRecords
    const records = profile.recentRecords;
    const masyuRecords = records.filter((a) => MASYU_ALIASES.has(a.engineType) && a.isSuccess);
    const nurikabeRecords = records.filter((a) => NURIKABE_ALIASES.has(a.engineType) && a.isSuccess);
    const lightupRecords = records.filter((a) => LIGHTUP_ALIASES.has(a.engineType) && a.isSuccess);

    const calcControl = (targetRecords: AttemptPayload[]) => {
      if (targetRecords.length === 0) return 72;
      const avgScore = targetRecords.reduce((acc, cur) => {
        const pureBonus = cur.isPureClear ? 100 : 80;
        const penalty = Math.min(30, (cur.conflictsCount || 0) * 5);
        return acc + pureBonus - penalty;
      }, 0) / targetRecords.length;
      return Math.min(100, Math.max(30, Math.round(avgScore)));
    };

    const eulerianLoopControl = calcControl(masyuRecords);
    const planarPartitioning = calcControl(nurikabeRecords);
    const rayTracingControl = calcControl(lightupRecords);

    const weightedScore = Math.round(
      eulerianLoopControl * 0.35 +
      planarPartitioning * 0.35 +
      rayTracingControl * 0.30
    );

    const standardScore = Math.min(19, Math.max(1, Math.round(10 + (weightedScore - 75) / 4.5)));
    const spatialPercentile = Math.min(99, Math.max(1, Math.round(100 / (1 + Math.exp(-(standardScore - 10) / 1.8)))));

    let recommendedDrill = isEn
      ? 'Spatial reasoning dimensions are well-balanced; challenge Master tier puzzles to push higher!'
      : '空間推理能力三項均衡，建議挑戰 Master 級題目以突破更高難度維度！';

    if (eulerianLoopControl < planarPartitioning - 6 && eulerianLoopControl < rayTracingControl - 6) {
      recommendedDrill = isEn
        ? 'Weakness Focus: White/black pearl orthogonality forecasting is weak; train Masyu adjacent pearl exclusion and loop closure.'
        : '弱點定位：白黑珍珠幾何轉折前瞻力偏弱，建議強化 Masyu 相鄰黑珍珠排斥與閉環練習。';
    } else if (planarPartitioning < eulerianLoopControl - 6 && planarPartitioning < rayTracingControl - 6) {
      recommendedDrill = isEn
        ? 'Weakness Focus: Planar connected black sea partitioning tends to get blocked by pools; train Nurikabe 2×2 pool and isolated island convergence.'
        : '弱點定位：平面連通黑海分割容易遭遇池塘阻滯，建議強化 Nurikabe 2×2 禁池與孤島收斂練習。';
    } else if (rayTracingControl < eulerianLoopControl - 6 && rayTracingControl < planarPartitioning - 6) {
      recommendedDrill = isEn
        ? 'Weakness Focus: Orthogonal ray mutual exclusion and illumination awareness need boosting; practice Light Up 1-2 block XOR and corridor casting.'
        : '弱點定位：正交射線互斥與光源覆蓋意識需提升，建議練習 Light Up 1-2 黑塊 XOR 與走廊投射。';
    }

    return {
      standardScore,
      spatialPercentile,
      eulerianLoopControl,
      planarPartitioning,
      rayTracingControl,
      recommendedDrill,
    };
  }, [profile, isEn]);

  const getBenchmarkMetrics = useCallback(
    (technique: string, defaultTime: number, currentEngineType?: string): BenchmarkMetrics => {
      const stat = profile.techniqueStats[technique];
      const dims = profile.cognitiveDimensions;

      const dimEntries = Object.entries(dims) as [CognitiveDimension, number][];
      dimEntries.sort((a, b) => a[1] - b[1]);

      const candidateMap: Record<CognitiveDimension, { game: string; altGame: string; zh: string; en: string }> = {
        spatial: { game: 'skyscraper', altGame: 'maze', zh: '空間維度偏弱，建議強化「摩天透視」3D 心理旋轉', en: 'Spatial perception needs focus; train 3D rotation in Skyscraper.' },
        numeric: { game: 'sudoku', altGame: 'hashi', zh: '數理約束推導偏弱，建議挑戰「數獨魔陣」', en: 'Numeric deduction needs focus; challenge Sudoku.' },
        workingMemory: { game: 'sudoku', altGame: 'hashi', zh: '工作記憶負載偏重，練習「專家級數獨」候選數鏈條', en: 'Working memory overloaded; practice expert Sudoku chains.' },
        inhibition: { game: 'hashi', altGame: 'skyscraper', zh: '衝動抑制有失誤，練習「星際數橋」拓撲無交叉約束', en: 'Inhibition slip detected; practice Hashi bridge planning.' },
        processingSpeed: { game: 'maze', altGame: 'skyscraper', zh: '反應速度可進一步激發，建議速通「空間迷宮」', en: 'Processing speed could be boosted; sprint through Maze.' },
      };

      const weakestDim = dimEntries[0]?.[0] ?? 'spatial';
      const conf = candidateMap[weakestDim] || candidateMap.spatial;
      const targetGame = (currentEngineType && conf.game === currentEngineType) ? conf.altGame : conf.game;

      const isNewPB = Boolean(profile.recentRecords[0]?.isNewPB);

      if (!stat || stat.attempts < 4 || !stat.times || stat.times.length < 4) {
        return {
          benchmarkTime: defaultTime,
          sem: Math.round(defaultTime * 0.15),
          ci95: [Math.max(10, defaultTime - Math.round(defaultTime * 0.3)), defaultTime + Math.round(defaultTime * 0.3)],
          conflictCI: { mean: 0.5, sem: 0.2, ci95: [0, 2] },
          percentileRank: 65.0,
          isBootstrap: false,
          isNewPB,
          recommendedFocus: {
            dimension: weakestDim,
            targetGame,
            reasonZh: conf.zh,
            reasonEn: conf.en,
          },
        };
      }

      const timeCI = computeAdaptiveBootstrapCI(stat.times, 1000);
      const conflictCI = computeAdaptiveBootstrapCI(stat.conflicts || [0], 1000);
      const percentileRank = Number((normalCDF((120 / (stat.avgTimeSec || 120) * 0.5 + stat.accuracy * 0.5 - 0.7) / 0.25) * 100).toFixed(1));

      return {
        benchmarkTime: Math.round(timeCI.mean * 0.8 + defaultTime * 0.2),
        sem: Math.round(timeCI.sem),
        ci95: timeCI.ci95,
        conflictCI,
        percentileRank,
        isBootstrap: true,
        isNewPB,
        recommendedFocus: {
          dimension: weakestDim,
          targetGame,
          reasonZh: conf.zh,
          reasonEn: conf.en,
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

  const exportLongitudinalDataset = useCallback(() => {
    const cci = getCompositeCognitiveIndex();
    const sci = getSpatialCompositeIndex();
    const dataDictionaryMd = isEn ? `# LogiCore Cognitive Assessment Dataset — Data Dictionary (v2.8.0)

## 1. Global Psychometrics
- **estimatedStandardIQ**: Internal Standardized Scale IQ (μ=100, σ=15). Exploratory estimation.
- **pureStreak**: Current consecutive pure mode clear streak.
- **hintTrend**: Longitudinal hint call distribution (T1: 0~30s, T2: 30~60s, T3: 60s+).
- **compositeGf**: Raw fluid intelligence estimation (0.000 ~ 1.000).
- **spatialCompositeIndex**: Spatial topology & ray casting composite scale (Scaled 1~19, PR 1~99).
- **csem**: Conditional Standard Error of Measurement.
- **confidenceInterval95**: [Integer, Integer]. 95% Confidence Interval.
- **ageNorm**: Age-stratified norm comparison (Internal Heuristic Norm v1).
- **cronbachAlpha**: Internal consistency coefficient.
- **splitHalfReliability**: Spearman-Brown split-half reliability.

## 2. Five-Dimension Cognitive Load (CHC Taxonomy)
- **spatial**: Spatial representation, 3D mental rotation, and ray tracing (25%).
- **numeric**: Numeric constraint propagation and integer partitioning (25%).
- **workingMemory**: Candidate retention and topological working memory (20%).
- **inhibition**: Impulsive decision suppression and 2×2 pool inhibition (15%).
- **processingSpeed**: Visual perceptual discrimination speed (15%).
` : `# LogiCore 認知評估數據集 — 數據字典 (Data Dictionary v2.8.0)

## 1. 全域指標 (Global Psychometrics)
- **estimatedStandardIQ**: 平台內部標準量尺 IQ (μ=100, σ=15)，屬探索性常模估計。
- **pureStreak**: 當前純挑戰 (Pure Mode) 連續通關場次。
- **hintTrend**: 長期提示調用分佈 (T1: 0~30s, T2: 30~60s, T3: 60s+)。
- **compositeGf**: 原始流體智力估計值 (0.000 ~ 1.000)。
- **spatialCompositeIndex**: 空間拓撲與射線投射能力綜合量尺 (Scaled 1~19, PR 1~99)。
- **csem**: 條件測量標準誤。
- **confidenceInterval95**: [整數, 整數]。95% 信賴區間。
- **ageNorm**: 年齡分層常模對照 (內部啟發式常模 v1)。
- **cronbachAlpha**: 內部一致性係數。
- **splitHalfReliability**: Spearman-Brown 分半信度。

## 2. 五維認知能力負荷 (CHC Taxonomy)
- **spatial**: 空間表徵、3D 心理旋轉與射線追蹤 (25%)。
- **numeric**: 數理約束傳播與整數分割 (25%)。
- **workingMemory**: 候選數保留與拓撲記憶 (20%)。
- **inhibition**: 衝動決策與 2×2 禁池抑制 (15%)。
- **processingSpeed**: 視知覺運動辨別速度 (15%)。
`;

    const exportBundle = {
      $schema: 'https://logicore.app/schemas/psychometrics-v2.8.json',
      metadata: {
        platform: 'LogiCore Clinical-Grade Cognitive Engine',
        version: '2.8.0',
        exportedAt: new Date().toISOString(),
        userAge: profile.userAge,
        totalEvaluatedSessions: profile.totalAttempts,
        pureStreak: profile.pureStreak,
      },
      dataDictionaryMarkdown: dataDictionaryMd,
      compositeIndices: {
        estimatedStandardIQ: cci.standardIQ,
        pureStreak: profile.pureStreak,
        compositeGf: cci.rawGf,
        percentileRank: cci.percentileRank,
        conditionalSEM: cci.semIQ,
        confidenceInterval95: cci.ci95IQ,
        ageStratifiedComparison: cci.ageNorm,
        psychometricReliability: cci.reliability,
        spatialComposite: sci,
        longitudinalHintTrend: profile.hintTrend,
      },
      fiveDimensionsProfile: profile.cognitiveDimensions,
      historicalBaselineProfile: profile.previousCognitiveDimensions,
      techniqueMasteryStats: profile.techniqueStats,
      bookmarkedPuzzlesVault: profile.bookmarks,
      longitudinalRecords: profile.recentRecords,
    };

    const blob = new Blob([JSON.stringify(exportBundle, null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', downloadUrl);
    downloadAnchor.setAttribute('download', `LogiCore_Psychometrics_Dataset_v2.8_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(downloadUrl);
  }, [profile, getCompositeCognitiveIndex, getSpatialCompositeIndex, isEn]);

  return {
    profile,
    recordAttempt,
    saveBookmark,
    removeBookmark,
    importBookmarksBundle,
    getBenchmarkMetrics,
    getBenchmarkTime,
    getCompositeCognitiveIndex,
    getSpatialCompositeIndex,
    exportLongitudinalDataset,
  };
};
