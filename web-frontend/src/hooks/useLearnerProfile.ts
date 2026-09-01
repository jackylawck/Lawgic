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
}

const STORAGE_KEY = 'LOGICORE_LEARNER_PROFILE_V1';

const INITIAL_PROFILE: LearnerProfile = {
  userId: 'player_default',
  history: [],
  typeMastery: {},
};

export function useLearnerProfile() {
  const [profile, setProfile] = useState<LearnerProfile>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : INITIAL_PROFILE;
    } catch {
      return INITIAL_PROFILE;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
      console.error('Failed to save profile:', e);
    }
  }, [profile]);

  // 記錄一次作答
  const recordAttempt = useCallback(
    (record: Omit<SolveRecord, 'timestamp'>) => {
      setProfile((prev) => {
        const fullRecord: SolveRecord = { ...record, timestamp: Date.now() };
        const updatedHistory = [...prev.history, fullRecord];

        // 更新各題型掌握度
        const currentType = prev.typeMastery[record.engineType] || {
          solved: 0,
          totalAttempts: 0,
          avgTimeSec: 0,
        };

        const newTotal = currentType.totalAttempts + 1;
        const newSolved = currentType.solved + (record.isSuccess ? 1 : 0);
        const newAvgTime =
          (currentType.avgTimeSec * currentType.totalAttempts + record.timeSpentSec) / newTotal;

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
        };
      });
    },
    []
  );

  // 計算特定題型的近側發展區 (ZPD) 推薦難度
  const getZPDRecommendedTier = useCallback(
    (engineType: string): TierKey => {
      const recentAttempts = profile.history
        .filter((h) => h.engineType === engineType)
        .slice(-10); // 取最近 10 次嘗試

      if (recentAttempts.length < 3) return 'kids';

      const successRate =
        recentAttempts.filter((h) => h.isSuccess).length / recentAttempts.length;

      // 認知階梯調度：成功率 > 80% 晉級；< 40% 降級
      if (successRate >= 0.8) {
        const currentMax = recentAttempts[recentAttempts.length - 1].tier;
        if (currentMax === 'kids') return 'intermediate';
        if (currentMax === 'intermediate') return 'expert';
        return 'master';
      } else if (successRate <= 0.4) {
        return 'kids';
      }
      return 'intermediate';
    },
    [profile.history]
  );

  return {
    profile,
    recordAttempt,
    getZPDRecommendedTier,
  };
}
