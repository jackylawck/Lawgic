// web-frontend/src/hooks/useLongTermScheduler.ts
import { useMemo, useCallback } from 'react';
import { PuzzleEntity } from '../generated';
import { LearnerProfileState, TierKey, CognitiveDimension } from './useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';

export interface ScheduledRecommendation {
  puzzleId: string;
  type: string;
  tier: TierKey;
  reason: string;
  urgencyScore: number;
}

// 完整 6 階難度排程權重映射，徹底消除 TS2739
const TIER_RANK_MAP: Record<TierKey, number> = {
  kids: 0,
  intermediate: 1,
  expert: 2,
  master: 3,
  legendary: 4,
  ultimate: 5,
};

// 18 款核心引擎精確 CHC 認知構念主次映射
const ENGINE_PRIMARY_DIMENSION: Record<string, CognitiveDimension> = {
  maze: 'spatial',
  skyscraper: 'spatial',
  masyu: 'spatial',
  lightup: 'spatial',
  yajilin: 'spatial',
  dominoes: 'spatial',
  sudoku: 'numeric',
  kakuro: 'numeric',
  hashi: 'numeric',
  shikaku: 'numeric',
  kropki: 'numeric',
  futoshiki: 'numeric',
  nonogram: 'workingMemory',
  slitherlink: 'workingMemory',
  heyawake: 'workingMemory',
  nurikabe: 'inhibition',
  hitori: 'inhibition',
  tents: 'processingSpeed',
};

export function useLongTermScheduler(
  profile: LearnerProfileState,
  catalog: Record<string, PuzzleEntity[]>
) {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  // 1. 計算全局巔峰階梯 (Overall Peak Tier)
  const overallPeakTier: TierKey = useMemo(() => {
    if (!profile.history || profile.history.length === 0) return 'kids';

    let maxRank = 0;
    let peak: TierKey = 'kids';

    profile.history.forEach((h) => {
      if (h.isSuccess && h.tier) {
        const rank = TIER_RANK_MAP[h.tier as TierKey] ?? 0;
        if (rank >= maxRank) {
          maxRank = rank;
          peak = h.tier as TierKey;
        }
      }
    });

    return peak;
  }, [profile.history]);

  // 2. 艾賓浩斯間隔遺忘衰減與近側發展區間 (ZPD) 排程引擎
  const getRecommendedSchedulePuzzle = useCallback((): ScheduledRecommendation | null => {
    const types = Object.keys(catalog).filter((k) => (catalog[k]?.length || 0) > 0);
    if (types.length === 0) return null;

    const now = Date.now();
    const dims = profile.cognitiveDimensions;

    // 尋找最弱認知維度
    const weakestDim = (Object.keys(dims) as CognitiveDimension[]).reduce(
      (prev, curr) => (dims[curr] < dims[prev] ? curr : prev),
      'spatial'
    );

    // 統計題型的練習歷程（作答次數、最近一次練習距今小時數、成功率）
    const stats: Record<string, { count: number; lastTrainedHoursAgo: number; successRate: number }> = {};
    types.forEach((t) => {
      stats[t] = { count: 0, lastTrainedHoursAgo: 240, successRate: 1.0 }; // 預設 10 天前
    });

    const successes: Record<string, number> = {};
    types.forEach((t) => (successes[t] = 0));

    profile.history.forEach((h) => {
      const t = h.engineType;
      if (stats[t]) {
        stats[t].count++;
        if (h.isSuccess) successes[t]++;
        const recordTime = h.timestamp ? new Date(h.timestamp).getTime() : 0;
        if (recordTime > 0) {
          const hoursAgo = Math.max(0, (now - recordTime) / (1000 * 3600));
          if (hoursAgo < stats[t].lastTrainedHoursAgo) {
            stats[t].lastTrainedHoursAgo = hoursAgo;
          }
        }
      }
    });

    types.forEach((t) => {
      if (stats[t].count > 0) {
        stats[t].successRate = successes[t] / stats[t].count;
      }
    });

    // 綜合緊急度打分 (Urgency Scoring)
    // 因子 1: 最弱認知維度對應補償 (Weakness Boost)
    // 因子 2: 遺忘衰減時間 (Memory Half-life Decay: hoursAgo 越長分數越高)
    // 因子 3: 練習飢餓度 (探索全新題型優先)
    let bestType = types[0];
    let highestUrgency = -Infinity;

    types.forEach((t) => {
      const dim = ENGINE_PRIMARY_DIMENSION[t] || 'spatial';
      const isWeakest = dim === weakestDim;
      const { count, lastTrainedHoursAgo, successRate } = stats[t];

      // 遺忘曲線指數權重: R = e^(-t/S)
      const forgetFactor = Math.min(10, lastTrainedHoursAgo / 24); // 最多加 10 分
      const weaknessBonus = isWeakest ? 8 : 0;
      const unpracticedBonus = count === 0 ? 12 : Math.max(0, 6 - count);
      const struggleBonus = successRate < 0.7 ? 4 : 0; // 遇到瓶頸需要溫故知新

      const urgency = forgetFactor + weaknessBonus + unpracticedBonus + struggleBonus;

      if (urgency > highestUrgency) {
        highestUrgency = urgency;
        bestType = t;
      }
    });

    const targetList = catalog[bestType] || [];
    if (targetList.length === 0) return null;

    // 依據玩家當前巔峰階梯（ZPD 近側發展區）過濾最佳難度
    const candidateList = targetList.filter((p) => p.tier === overallPeakTier);
    const chosen = candidateList.length > 0
      ? candidateList[Math.floor(Math.random() * candidateList.length)]
      : targetList[Math.floor(Math.random() * targetList.length)];

    if (!chosen) return null;

    // 組裝智慧推薦理由
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
  }, [catalog, profile.history, profile.cognitiveDimensions, overallPeakTier, isEn]);

  return {
    overallPeakTier,
    getRecommendedSchedulePuzzle,
  };
}
