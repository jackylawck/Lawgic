import { useMemo } from 'react';
import { LearnerProfile, TierKey } from './useLearnerProfile';
import { PuzzleEntity } from '../generated';

const FORGET_DAYS_THRESHOLD = 30;

export function useLongTermScheduler(
  profile: LearnerProfile,
  catalog: Record<string, PuzzleEntity[]>
) {
  // 檢測超過 30 天未碰且曾達到 intermediate 以上的題型
  const forgottenTypes = useMemo(() => {
    const now = Date.now();
    const result: string[] = [];

    Object.keys(profile.lastPlayedAt).forEach((engineType) => {
      const lastPlayed = profile.lastPlayedAt[engineType];
      const daysDiff = (now - lastPlayed) / (1000 * 60 * 60 * 24);
      const peak = profile.peakRecords[engineType];

      if (daysDiff > FORGET_DAYS_THRESHOLD && peak && peak.tier !== 'kids') {
        result.push(engineType);
      }
    });

    return result;
  }, [profile]);

  // 全域大腦段位（所有題型的最高突破點）
  const overallPeakTier = useMemo((): TierKey => {
    const tiers = Object.values(profile.peakRecords).map((r) => r.tier);
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

  // 取得溫手感的複習題目
  const getNextForgottenPuzzle = (): { targetType: string; puzzle: PuzzleEntity } | null => {
    if (forgottenTypes.length === 0) return null;

    const targetType = forgottenTypes[0];
    const pool = catalog[targetType] || [];
    const reviewPool = pool.filter((p) => p.tier === 'intermediate' || p.tier === 'kids');
    if (reviewPool.length === 0) return null;

    return {
      targetType,
      puzzle: reviewPool[Math.floor(Math.random() * reviewPool.length)],
    };
  };

  return {
    forgottenTypes,
    overallPeakTier,
    getNextForgottenPuzzle,
    hasForgotten: forgottenTypes.length > 0,
  };
}
