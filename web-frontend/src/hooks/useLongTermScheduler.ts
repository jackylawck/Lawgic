// web-frontend/src/hooks/useLongTermScheduler.ts
import { useMemo } from 'react';
import { PuzzleEntity } from '../generated';
import { LearnerProfileState, TierKey, CognitiveDimension } from './useLearnerProfile';

export function useLongTermScheduler(
  profile: LearnerProfileState,
  catalog: Record<string, PuzzleEntity[]>
) {
  // 1. 計算全局巔峰階梯 (Overall Peak Tier)
  const overallPeakTier: TierKey = useMemo(() => {
    if (!profile.history || profile.history.length === 0) return 'kids';

    const tierRank: Record<TierKey, number> = {
      kids: 0,
      intermediate: 1,
      expert: 2,
      master: 3,
    };

    let maxRank = 0;
    let peak: TierKey = 'kids';

    profile.history.forEach((h) => {
      if (h.isSuccess && h.tier) {
        const rank = tierRank[h.tier as TierKey] ?? 0;
        if (rank >= maxRank) {
          maxRank = rank;
          peak = h.tier as TierKey;
        }
      }
    });

    return peak;
  }, [profile.history]);

  // 2. 獲取推薦排程謎題 (Get Recommended Schedule Puzzle)
  const getRecommendedSchedulePuzzle = useMemo(() => {
    return (): { puzzleId: string; type: string; reason: string } | null => {
      const types = Object.keys(catalog).filter((k) => (catalog[k]?.length || 0) > 0);
      if (types.length === 0) return null;

      // 找出練習次數最少的題型
      const counts: Record<string, number> = {};
      types.forEach((t) => (counts[t] = 0));

      profile.history.forEach((h) => {
        if (counts[h.engineType] !== undefined) {
          counts[h.engineType]++;
        }
      });

      let minType = types[0];
      let minCount = counts[minType] ?? 0;

      types.forEach((t) => {
        if ((counts[t] ?? 0) < minCount) {
          minCount = counts[t] ?? 0;
          minType = t;
        }
      });

      const targetList = catalog[minType] || [];
      const chosen = targetList[Math.floor(Math.random() * targetList.length)];

      if (!chosen) return null;

      return {
        puzzleId: chosen.id,
        type: minType,
        reason: minCount === 0 ? '全新探索' : '強化最弱迴路',
      };
    };
  }, [catalog, profile.history]);

  return {
    overallPeakTier,
    getRecommendedSchedulePuzzle,
  };
}
