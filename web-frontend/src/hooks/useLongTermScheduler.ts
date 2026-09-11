// web-frontend/src/hooks/useLongTermScheduler.ts
import { useMemo, useCallback } from 'react';
import { PuzzleEntity } from '../generated';
import { LearnerProfileState, TierKey } from './useLearnerProfile';
import { CognitiveDimension } from '../types/cognitive';
import { useLanguage } from '../contexts/LanguageContext';
import {
  ENGINE_PRIMARY_DIMENSION,
  normalizeEngineType,
} from '../registry/engineMetadata';

export interface ScheduledRecommendation {
  puzzleId: string;
  type: string;
  tier: TierKey;
  reason: string;
  urgencyScore: number;
}

const TIER_RANK_MAP: Record<TierKey, number> = {
  kids: 0,
  intermediate: 1,
  expert: 2,
  master: 3,
  legendary: 4,
  ultimate: 5,
};

export function useLongTermScheduler(
  profile: LearnerProfileState,
  catalog: Record<string, PuzzleEntity[]>
) {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const overallPeakTier: TierKey = useMemo(() => {
    const records = profile.recentRecords;
    if (!records || records.length === 0) return 'kids';

    let maxRank = -1;
    let peak: TierKey = 'kids';

    records.forEach((h) => {
      if (h.isSuccess && h.tier && h.tier in TIER_RANK_MAP) {
        const rank = TIER_RANK_MAP[h.tier];
        if (rank > maxRank) {
          maxRank = rank;
          peak = h.tier;
        }
      }
    });

    return peak;
  }, [profile.recentRecords]);

  const getRecommendedSchedulePuzzle = useCallback((): ScheduledRecommendation | null => {
    const types = Object.keys(catalog).filter((k) => (catalog[k]?.length || 0) > 0);
    if (types.length === 0) return null;

    const now = Date.now();
    const dims = profile.cognitiveDimensions;

    const weakestDim = (Object.keys(dims) as CognitiveDimension[]).reduce(
      (prev, curr) => (dims[curr] < dims[prev] ? curr : prev),
      'spatial'
    );

    const stats: Record<string, { count: number; lastTrainedHoursAgo: number; successRate: number }> = {};
    const successes: Record<string, number> = {};

    types.forEach((t) => {
      stats[t] = { count: 0, lastTrainedHoursAgo: 240, successRate: 1.0 };
      successes[t] = 0;
    });

    profile.recentRecords.forEach((h) => {
      const canonicalType = normalizeEngineType(h.engineType);
      if (stats[canonicalType]) {
        stats[canonicalType].count++;
        if (h.isSuccess) {
          successes[canonicalType] = (successes[canonicalType] ?? 0) + 1;
        }

        const recordTime = h.timestamp ? Date.parse(h.timestamp) : NaN;
        if (Number.isFinite(recordTime) && recordTime > 0) {
          const hoursAgo = Math.max(0, (now - recordTime) / (1000 * 3600));
          if (hoursAgo < stats[canonicalType].lastTrainedHoursAgo) {
            stats[canonicalType].lastTrainedHoursAgo = hoursAgo;
          }
        }
      }
    });

    types.forEach((t) => {
      if (stats[t].count > 0) {
        stats[t].successRate = (successes[t] ?? 0) / stats[t].count;
      }
    });

    let bestType = types[0];
    let highestUrgency = -Infinity;

    types.forEach((t) => {
      const dim = ENGINE_PRIMARY_DIMENSION[t] || 'spatial';
      const isWeakest = dim === weakestDim;
      const { count, lastTrainedHoursAgo, successRate } = stats[t];

      const weaknessBonus = isWeakest ? 8 : 0;
      let urgency = 0;

      if (count === 0) {
        const unpracticedBonus = 16;
        urgency = unpracticedBonus + weaknessBonus;
      } else {
        const forgetFactor = Math.min(10, lastTrainedHoursAgo / 24);
        const repetitionBonus = Math.max(0, 5 - count);
        const struggleBonus = successRate < 0.7 ? 4 : 0;
        urgency = forgetFactor + weaknessBonus + repetitionBonus + struggleBonus;
      }

      if (urgency > highestUrgency) {
        highestUrgency = urgency;
        bestType = t;
      }
    });

    const targetList = catalog[bestType] || [];
    if (targetList.length === 0) return null;

    const candidateList = targetList.filter((p) => p.tier === overallPeakTier);
    const chosen =
      candidateList.length > 0
        ? candidateList[Math.floor(Math.random() * candidateList.length)]
        : targetList[Math.floor(Math.random() * targetList.length)];

    if (!chosen) return null;

    const targetStat = stats[bestType];
    let reason = '';
    if (isEn) {
      if (targetStat.count === 0) {
        reason = `Explore unchartered mechanics in ${bestType.toUpperCase()}!`;
      } else if (ENGINE_PRIMARY_DIMENSION[bestType] === weakestDim) {
        reason = `Targeted recovery for your weakest CHC construct (${weakestDim.toUpperCase()}).`;
      } else if (targetStat.lastTrainedHoursAgo >= 48) {
        reason = `Spacing retention: ${Math.round(targetStat.lastTrainedHoursAgo / 24)} days since last review.`;
      } else {
        reason = `Adaptive pacing for peak tier consolidation (${overallPeakTier.toUpperCase()}).`;
      }
    } else {
      if (targetStat.count === 0) {
        reason = `全新題型探索：激活 ${bestType.toUpperCase()} 神經突觸！`;
      } else if (ENGINE_PRIMARY_DIMENSION[bestType] === weakestDim) {
        reason = `重點強化：針對當前最弱認知維度 (${weakestDim}) 精準靶向訓練。`;
      } else if (targetStat.lastTrainedHoursAgo >= 48) {
        reason = `間隔複習曲線：距離上次訓練已過 ${Math.round(targetStat.lastTrainedHoursAgo / 24)} 天。`;
      } else {
        reason = `鞏固當前巔峰階梯 (${overallPeakTier}) 認知穩定度。`;
      }
    }

    return {
      puzzleId: chosen.id,
      type: bestType,
      tier: chosen.tier,
      reason,
      urgencyScore: Number(highestUrgency.toFixed(1)),
    };
  }, [catalog, profile.recentRecords, profile.cognitiveDimensions, overallPeakTier, isEn]);

  return {
    overallPeakTier,
    getRecommendedSchedulePuzzle,
  };
}
