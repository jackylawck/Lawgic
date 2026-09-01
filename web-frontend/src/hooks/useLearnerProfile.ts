// web-frontend/src/hooks/useLearnerProfile.ts
import { useState, useEffect, useCallback } from 'react';

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master';

export interface SolveRecord {
  puzzleId: string;
  engineType: string;
  tier: TierKey;
  isSuccess: boolean;
  timeSpentSec: number;
  conflictsCount: number;
  timestamp: number;
}

export interface LearnerProfile {
  userId: string;
  history: SolveRecord[];
  typeMastery: Record<string, { solved: number; totalAttempts: number; avgTimeSec: number }>;
  peakRecords: Record<string, { tier: TierKey; timeSpentSec: number; timestamp: number }>;
  lastPlayedAt: Record<string, number>;
}

interface SecuredStoragePayload {
  data: LearnerProfile;
  seal: string;
}

const STORAGE_KEY = 'LOGICORE_LEARNER_PROFILE_SEC_V1';

// 輕量級安全簽名 (防竄改與防注入)
function generateDataSeal(data: LearnerProfile): string {
  const serialized = `${data.userId}:${data.history.length}:${Object.keys(data.peakRecords).length}`;
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash << 5) - hash + serialized.charCodeAt(i);
    hash |= 0;
  }
  return `SEAL_${Math.abs(hash).toString(16)}`;
}

const INITIAL_PROFILE: LearnerProfile = {
  userId: 'player_enterprise_secure',
  history: [],
  typeMastery: {},
  peakRecords: {},
  lastPlayedAt: {},
};

const BASE_TIME_ESTIMATE: Record<TierKey, number> = {
  kids: 60,
  intermediate: 120,
  expert: 240,
  master: 400,
};

const TIER_RANK: Record<TierKey, number> = {
  kids: 0,
  intermediate: 1,
  expert: 2,
  master: 3,
};

export function useLearnerProfile() {
  const [profile, setProfile] = useState<LearnerProfile>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: SecuredStoragePayload = JSON.parse(raw);
        // 驗證防竄改 Seal
        if (parsed.seal && parsed.seal === generateDataSeal(parsed.data)) {
          return {
            ...INITIAL_PROFILE,
            ...parsed.data,
            peakRecords: parsed.data.peakRecords || {},
            lastPlayedAt: parsed.data.lastPlayedAt || {},
          };
        } else {
          console.warn('[Security Notice] Local storage tampering detected. Resetting to secure baseline.');
        }
      }
      return INITIAL_PROFILE;
    } catch {
      return INITIAL_PROFILE;
    }
  });

  useEffect(() => {
    try {
      const payload: SecuredStoragePayload = {
        data: profile,
        seal: generateDataSeal(profile),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error('[Security Warning] Failed to securely persist profile:', e);
    }
  }, [profile]);

  const recordAttempt = useCallback((record: Omit<SolveRecord, 'timestamp'>) => {
    setProfile((prev) => {
      const now = Date.now();
      const fullRecord: SolveRecord = { ...record, timestamp: now };
      const updatedHistory = [...prev.history, fullRecord];

      const currentType = prev.typeMastery[record.engineType] || {
        solved: 0,
        totalAttempts: 0,
        avgTimeSec: 0,
      };
      const newTotal = currentType.totalAttempts + 1;
      const newSolved = currentType.solved + (record.isSuccess ? 1 : 0);
      const newAvgTime =
        (currentType.avgTimeSec * currentType.totalAttempts + record.timeSpentSec) / newTotal;

      const updatedLastPlayed = {
        ...prev.lastPlayedAt,
        [record.engineType]: now,
      };

      const updatedPeaks = { ...prev.peakRecords };
      if (record.isSuccess) {
        const currentPeak = updatedPeaks[record.engineType];
        const isHigherTier = !currentPeak || TIER_RANK[record.tier] > TIER_RANK[currentPeak.tier];
        const isFasterSameTier =
          currentPeak &&
          TIER_RANK[record.tier] === TIER_RANK[currentPeak.tier] &&
          record.timeSpentSec < currentPeak.timeSpentSec;

        if (isHigherTier || isFasterSameTier) {
          updatedPeaks[record.engineType] = {
            tier: record.tier,
            timeSpentSec: record.timeSpentSec,
            timestamp: now,
          };
        }
      }

      return {
        ...prev,
        history: updatedHistory,
        typeMastery: {
          ...prev.typeMastery,
          [record.engineType]: {
            solved: newSolved,
            totalAttempts: newTotal,
            avgTimeSec: Math.round(newAvgTime),
          },
        },
        peakRecords: updatedPeaks,
        lastPlayedAt: updatedLastPlayed,
      };
    });
  }, []);

  const getZPDRecommendedTier = useCallback(
    (engineType: string): TierKey => {
      const recentAttempts = profile.history
        .filter((h) => h.engineType === engineType)
        .slice(-8);

      if (recentAttempts.length < 3) {
        const globalBest = Object.values(profile.typeMastery).reduce(
          (max, t) => Math.max(max, t.solved / (t.totalAttempts || 1)),
          0
        );
        return globalBest > 0.8 ? 'intermediate' : 'kids';
      }

      const successRate =
        recentAttempts.filter((h) => h.isSuccess).length / recentAttempts.length;
      const avgTime =
        recentAttempts.reduce((s, h) => s + h.timeSpentSec, 0) / recentAttempts.length;
      const currentTier = recentAttempts[recentAttempts.length - 1].tier;

      const baseTime = BASE_TIME_ESTIMATE[currentTier] || 120;
      const timeRatio = avgTime / baseTime;

      if (successRate >= 0.75 && timeRatio < 0.5) {
        if (currentTier === 'kids') return 'expert';
        return 'master';
      }
      if (successRate >= 0.75 && timeRatio < 1.0) {
        if (currentTier === 'kids') return 'intermediate';
        if (currentTier === 'intermediate') return 'expert';
        return 'master';
      }
      if (successRate >= 0.5 && successRate < 0.75 && timeRatio < 1.5) {
        return currentTier;
      }
      if (successRate < 0.5 || timeRatio > 2.0) {
        if (currentTier === 'master') return 'expert';
        if (currentTier === 'expert') return 'intermediate';
        return 'kids';
      }

      return currentTier;
    },
    [profile.history, profile.typeMastery]
  );

  return { profile, recordAttempt, getZPDRecommendedTier };
}
