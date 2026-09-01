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

const STORAGE_KEY = 'LOGICORE_LEARNER_PROFILE_SEC_V2';

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
  userId: 'player_cognitive_v2',
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
        if (parsed.seal && parsed.seal === generateDataSeal(parsed.data)) {
          return {
            ...INITIAL_PROFILE,
            ...parsed.data,
            peakRecords: parsed.data.peakRecords || {},
            lastPlayedAt: parsed.data.lastPlayedAt || {},
          };
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
      console.error('[Security Warning] Failed to persist profile:', e);
    }
  }, [profile]);

  const recordAttempt = useCallback((record: Omit<SolveRecord, 'timestamp'>) => {
    setProfile((prev) => {
      const now = Date.now();
      const fullRecord: SolveRecord = { ...record, timestamp: now };
      const updatedHistory = [...prev.history, fullRecord];

      // 1. EWMA 指數平滑平均時間 (克服極端值)
      const currentType = prev.typeMastery[record.engineType] || {
        solved: 0,
        totalAttempts: 0,
        avgTimeSec: record.timeSpentSec,
      };
      const newTotal = currentType.totalAttempts + 1;
      const newSolved = currentType.solved + (record.isSuccess ? 1 : 0);
      
      const smoothedTime = currentType.avgTimeSec > 0
        ? Math.round(currentType.avgTimeSec * 0.65 + record.timeSpentSec * 0.35)
        : record.timeSpentSec;

      // 2. 更新最後活躍時鐘
      const updatedLastPlayed = {
        ...prev.lastPlayedAt,
        [record.engineType]: now,
      };

      // 3. 更新巔峰紀錄
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
            avgTimeSec: smoothedTime,
          },
        },
        peakRecords: updatedPeaks,
        lastPlayedAt: updatedLastPlayed,
      };
    });
  }, []);

  // 4. 嚴格鷹架 ZPD 調度（單階穩健升降）
  const getZPDRecommendedTier = useCallback(
    (engineType: string): TierKey => {
      const recentAttempts = profile.history
        .filter((h) => h.engineType === engineType)
        .slice(-8);

      if (recentAttempts.length < 3) {
        const globalSuccess = Object.values(profile.typeMastery).reduce(
          (acc, cur) => acc + (cur.solved / (cur.totalAttempts || 1)),
          0
        );
        return globalSuccess > 1.5 ? 'intermediate' : 'kids';
      }

      const successRate =
        recentAttempts.filter((h) => h.isSuccess).length / recentAttempts.length;
      const recentAvgTime =
        recentAttempts.reduce((s, h) => s + h.timeSpentSec, 0) / recentAttempts.length;
      const currentTier = recentAttempts[recentAttempts.length - 1].tier;

      const baseTime = BASE_TIME_ESTIMATE[currentTier] || 120;
      const timeRatio = recentAvgTime / baseTime;

      // 嚴格單階晉級 (Scaffolding Rule)
      if (successRate >= 0.75 && timeRatio <= 1.1) {
        if (currentTier === 'kids') return 'intermediate';
        if (currentTier === 'intermediate') return 'expert';
        if (currentTier === 'expert') return 'master';
        return 'master';
      }

      // 負擔過重時單階降級
      if (successRate < 0.45 || timeRatio > 2.0) {
        if (currentTier === 'master') return 'expert';
        if (currentTier === 'expert') return 'intermediate';
        if (currentTier === 'intermediate') return 'kids';
        return 'kids';
      }

      return currentTier;
    },
    [profile.history, profile.typeMastery]
  );

  // 5. 大腦檔案匯出 / 匯入
  const exportProfileJSON = useCallback(() => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(profile, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `logicore_brain_profile_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }, [profile]);

  const importProfileJSON = useCallback((jsonString: string): boolean => {
    try {
      const imported: LearnerProfile = JSON.parse(jsonString);
      if (imported.userId && Array.isArray(imported.history)) {
        setProfile(imported);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  return {
    profile,
    recordAttempt,
    getZPDRecommendedTier,
    exportProfileJSON,
    importProfileJSON,
  };
}
