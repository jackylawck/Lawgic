// web-frontend/src/hooks/useLongTermScheduler.ts
import { useMemo } from 'react';
import { LearnerProfile, TierKey, calculateDynamicStrength } from './useLearnerProfile';
import { PuzzleEntity } from '../generated';

export interface MemoryScheduleItem {
  type: string;
  urgency: number;
  currentStrength: number;
  daysInactive: number;
  isConsolidated: boolean;
}

export function useLongTermScheduler(
  profile: LearnerProfile,
  catalog: Record<string, PuzzleEntity[]>
) {
  // 分析所有題型的神經動力學狀態（固化增益 vs 衰退急迫性）
  const scheduledItems = useMemo(() => {
    const now = Date.now();
    const list: MemoryScheduleItem[] = [];

    Object.keys(profile.typeStates || {}).forEach((engineType) => {
      const state = profile.typeStates[engineType];
      const lastPlayed = profile.lastPlayedAt[engineType] || now;
      const daysInactive = Math.max(0, (now - lastPlayed) / (1000 * 60 * 60 * 24));

      const { strength: currentStrength, isConsolidated } = calculateDynamicStrength(
        state.strength,
        state.stability,
        daysInactive
      );

      // 1. 處於睡眠固化黃金窗口 (16h~48h)
      if (isConsolidated) {
        list.push({
          type: engineType,
          urgency: 0,
          currentStrength,
          daysInactive: Math.round(daysInactive * 10) / 10,
          isConsolidated: true,
        });
      }
      // 2. 記憶強度跌破安全門檻 (S < 3.5 且閒置 > 2天)
      else if (currentStrength < 3.5 && daysInactive > 2.0) {
        const urgencyScore = (10.0 / (currentStrength + 0.1)) * (1 + daysInactive * 0.1);
        list.push({
          type: engineType,
          urgency: Number(urgencyScore.toFixed(2)),
          currentStrength,
          daysInactive: Math.round(daysInactive),
          isConsolidated: false,
        });
      }
    });

    // 🔥【機會窗口優先策略】：消除優先級反轉，黃金固化期永遠置頂
    return list.sort((a, b) => {
      if (a.isConsolidated && !b.isConsolidated) return -1;
      if (!a.isConsolidated && b.isConsolidated) return 1;
      return b.urgency - a.urgency;
    });
  }, [profile.typeStates, profile.lastPlayedAt]);

  const overallPeakTier = useMemo((): TierKey => {
    const tiers = Object.values(profile.peakRecords || {}).map((r) => r.tier);
    if (tiers.length === 0) return 'kids';

    const rank: Record<TierKey, number> = { kids: 0, intermediate: 1, expert: 2, master: 3 };
    const maxRank = Math.max(...tiers.map((t) => rank[t] ?? 0));
    const tierMap: Record<number, TierKey> = {
      0: 'kids',
      1: 'intermediate',
      2: 'expert',
      3: 'master',
    };
    return tierMap[maxRank] || 'kids';
  }, [profile.peakRecords]);

  // 取出最推薦的調度題目
  const getRecommendedSchedulePuzzle = (): {
    targetType: string;
    item: MemoryScheduleItem;
    puzzle: PuzzleEntity;
  } | null => {
    if (scheduledItems.length === 0) return null;

    const top = scheduledItems[0];
    const pool = catalog[top.type] || [];
    const targetTier = top.isConsolidated ? 'intermediate' : 'kids';
    const reviewPool = pool.filter((p) => p.tier === targetTier || p.tier === 'intermediate');
    if (reviewPool.length === 0) return null;

    return {
      targetType: top.type,
      item: top,
      puzzle: reviewPool[Math.floor(Math.random() * reviewPool.length)],
    };
  };

  return {
    scheduledItems,
    overallPeakTier,
    getRecommendedSchedulePuzzle,
    hasScheduledItems: scheduledItems.length > 0,
  };
}
