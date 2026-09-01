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

// 各階層客觀預期基準時間（秒）
const BASE_TIME_ESTIMATE: Record<TierKey, number> = {
  kids: 60,
  intermediate: 120,
  expert: 240,
  master: 400,
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

  const recordAttempt = useCallback((record: Omit<SolveRecord, 'timestamp'>) => {
    setProfile((prev) => {
      const fullRecord: SolveRecord = { ...record, timestamp: Date.now() };
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
  }, []);

  // 🚀 進化版 ZPD 調度器（結合勝率、解題流暢度與遷移學習）
  const getZPDRecommendedTier = useCallback(
    (engineType: string): TierKey => {
      const recentAttempts = profile.history
        .filter((h) => h.engineType === engineType)
        .slice(-8);

      // 1. 遷移學習 (Transfer Learning)：新題型若在其他題型表現極佳，直接從中階起跳
      if (recentAttempts.length < 3) {
        const globalBest = Object.values(profile.typeMastery).reduce(
          (max, t) => Math.max(max, t.solved / (t.totalAttempts || 1)),
          0
        );
        return globalBest > 0.8 ? 'intermediate' : 'kids';
      }

      // 2. 核心指標計算
      const successRate = recentAttempts.filter((h) => h.isSuccess).length / recentAttempts.length;
      const avgTime = recentAttempts.reduce((s, h) => s + h.timeSpentSec, 0) / recentAttempts.length;
      const currentTier = recentAttempts[recentAttempts.length - 1].tier;

      // 3. 認知流暢度比率 (Time Ratio)
      const baseTime = BASE_TIME_ESTIMATE[currentTier] || 120;
      const timeRatio = avgTime / baseTime;

      // 4. 決策矩陣 (ZPD Decision Matrix)
      // 高勝率 + 極速完成 -> 流暢度突破，跳 2 級
      if (successRate >= 0.75 && timeRatio < 0.5) {
        if (currentTier === 'kids') return 'expert';
        if (currentTier === 'intermediate') return 'master';
        return 'master';
      }

      // 高勝率 + 正常節奏 -> 紮實掌握，跳 1 級
      if (successRate >= 0.75 && timeRatio < 1.0) {
        if (currentTier === 'kids') return 'intermediate';
        if (currentTier === 'intermediate') return 'expert';
        return 'master';
      }

      // 中等勝率 + 慢速探索 (掙扎區) -> 留在原難度進行心流鞏固
      if (successRate >= 0.5 && successRate < 0.75 && timeRatio < 1.5) {
        return currentTier;
      }

      // 超越負荷 -> 降 1 級保護自信
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
