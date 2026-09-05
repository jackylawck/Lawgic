// web-frontend/src/hooks/useLongTermScheduler.ts
import { useMemo } from 'react';
import { PuzzleEntity } from '../generated';
import { LearnerProfileState, TierKey, CognitiveDimension } from './useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';

export function useLongTermScheduler(
  profile: LearnerProfileState,
  catalog: Record<string, PuzzleEntity[]>
) {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

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

  // 2. 智能輪換與弱點對標排程器 (Smart Cognitive Adaptive Scheduler)
  const getRecommendedSchedulePuzzle = useMemo(() => {
    return (): { puzzleId: string; type: string; reason: string } | null => {
      const types = Object.keys(catalog).filter((k) => (catalog[k]?.length || 0) > 0);
      if (types.length === 0) return null;

      // 映射引擎類型到 CHC 認知維度
      const engineDimensionMap: Record<string, CognitiveDimension> = {
        maze: 'spatial',
        skyscraper: 'spatial',
        masyu: 'spatial',
        lightup: 'spatial',
        sudoku: 'numeric',
        kakuro: 'numeric',
        hashi: 'numeric',
        nonogram: 'workingMemory',
        slitherlink: 'workingMemory',
        nurikabe: 'inhibition',
        hitori: 'inhibition',
        tents: 'processingSpeed',
        shikaku: 'numeric',
        yajilin: 'spatial',
        kropki: 'numeric',
        futoshiki: 'numeric',
        dominoes: 'spatial',
        heyawake: 'workingMemory',
      };

      // 找出玩家五維中表現最弱的維度
      const dims = profile.cognitiveDimensions;
      const weakestDim = (Object.keys(dims) as CognitiveDimension[]).reduce((prev, curr) =>
        dims[curr] < dims[prev] ? curr : prev
      , 'spatial' as CognitiveDimension);

      // 統計各題型練習次數
      const counts: Record<string, number> = {};
      types.forEach((t) => (counts[t] = 0));

      profile.history.forEach((h) => {
        if (counts[h.engineType] !== undefined) {
          counts[h.engineType]++;
        }
      });

      // 優先挑選「對應最弱認知維度」且「練習次數相對較少」的題型
      let targetType = types[0];
      let lowestScore = Infinity;

      types.forEach((t) => {
        const playCount = counts[t] ?? 0;
        const dimMatchBonus = engineDimensionMap[t] === weakestDim ? -3 : 0;
        const score = playCount * 2 + dimMatchBonus;

        if (score < lowestScore) {
          lowestScore = score;
          targetType = t;
        }
      });

      const targetList = catalog[targetType] || [];
      const chosen = targetList[Math.floor(Math.random() * targetList.length)];

      if (!chosen) return null;

      const isNew = (counts[targetType] ?? 0) === 0;
      const isWeaknessTarget = engineDimensionMap[targetType] === weakestDim;

      let reason = '';
      if (isEn) {
        reason = isNew ? 'Brand new exploration' : isWeaknessTarget ? `Targeting weakest dimension (${weakestDim})` : 'Reinforcing neural loop';
      } else {
        reason = isNew ? '全新探索' : isWeaknessTarget ? `針對最弱認知維度 (${weakestDim}) 強化` : '強化最弱迴路';
      }

      return {
        puzzleId: chosen.id,
        type: targetType,
        reason,
      };
    };
  }, [catalog, profile.history, profile.cognitiveDimensions, isEn]);

  return {
    overallPeakTier,
    getRecommendedSchedulePuzzle,
  };
}
