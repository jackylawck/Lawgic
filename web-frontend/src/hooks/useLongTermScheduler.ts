// web-frontend/src/hooks/useLongTermScheduler.ts
import { useMemo } from 'react';
import { LearnerProfile, TierKey } from './useLearnerProfile';
import { PuzzleEntity } from '../generated';

const TIER_WEIGHT: Record<TierKey, number> = {
  kids: 1.0,
  intermediate: 1.8,
  expert: 2.8,
  master: 4.0,
};

export function useLongTermScheduler(
  profile: LearnerProfile,
  catalog: Record<string, PuzzleEntity[]>
) {
  // 1. 計算具有遺忘急迫性 (Urgency) 排序的題型清單
  const sortedForgottenTypes = useMemo(() => {
    const now = Date.now();
    const list: { type: string; urgency: number; daysInactive: number }[] = [];

    Object.keys(profile.lastPlayedAt || {}).forEach((engineType) => {
      const lastPlayed = profile.lastPlayedAt[engineType];
      const daysInactive = Math.floor((now - lastPlayed) / (1000 * 60 * 60 * 24));
      const peak = profile.peakRecords?.[engineType];

      // 超過 14 天未練習且曾解過題目，納入加權排程
      if (daysInactive >= 14 && peak) {
        const weight = TIER_WEIGHT[peak.tier] || 1.0;
        const urgencyScore = daysInactive * weight;
        list.push({ type: engineType, urgency: urgencyScore, daysInactive });
      }
    });

    // 依急迫度由高到低排序
    return list.sort((a, b) => b.urgency - a.urgency);
  }, [profile]);

  // 2. 全域大腦段位（所有題型的最高突破點）
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

  // 3. 取出急迫度最高的複習題目（溫手感難度）
  const getTopForgottenReview = (): { targetType: string; days: number; puzzle: PuzzleEntity } | null => {
    if (sortedForgottenTypes.length === 0) return null;

    const top = sortedForgottenTypes[0];
    const pool = catalog[top.type] || [];
    const reviewPool = pool.filter((p) => p.tier === 'intermediate' || p.tier === 'kids');
    if (reviewPool.length === 0) return null;

    return {
      targetType: top.type,
      days: top.daysInactive,
      puzzle: reviewPool[Math.floor(Math.random() * reviewPool.length)],
    };
  };

  return {
    sortedForgottenTypes,
    overallPeakTier,
    getTopForgottenReview,
    hasForgotten: sortedForgottenTypes.length > 0,
  };
}
