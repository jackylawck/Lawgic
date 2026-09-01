// web-frontend/src/hooks/useLongTermScheduler.ts
import { useMemo } from 'react';
import { LearnerProfile, TierKey } from './useLearnerProfile';
import { PuzzleEntity } from '../generated';

export function useLongTermScheduler(
  profile: LearnerProfile,
  catalog: Record<string, PuzzleEntity[]>
) {
  // 1. 基於個人化指數衰減之急迫度排行 (S_now = S_old * e^(-lambda * dt))
  const sortedForgottenTypes = useMemo(() => {
    const now = Date.now();
    const list: { type: string; urgency: number; currentStrength: number; daysInactive: number }[] = [];

    Object.keys(profile.typeStates || {}).forEach((engineType) => {
      const state = profile.typeStates[engineType];
      const lastPlayed = profile.lastPlayedAt[engineType] || now;
      const daysInactive = Math.max(0, Math.floor((now - lastPlayed) / (1000 * 60 * 60 * 24)));

      // 個人化衰減速率 lambda (穩固度 F 越高，衰減越慢)
      const lambda = 0.15 / Math.max(1.0, state.stability);
      const currentStrength = state.strength * Math.exp(-lambda * daysInactive);

      // 當記憶強度跌破安全閾值 (3.0) 且有閒置天數時觸發急迫排程
      if (currentStrength < 3.0 && daysInactive >= 3) {
        const urgencyScore = (10.0 / (currentStrength + 0.1)) * (1 + daysInactive * 0.1);
        list.push({
          type: engineType,
          urgency: Number(urgencyScore.toFixed(2)),
          currentStrength: Number(currentStrength.toFixed(2)),
          daysInactive,
        });
      }
    });

    return list.sort((a, b) => b.urgency - a.urgency);
  }, [profile.typeStates, profile.lastPlayedAt]);

  // 2. 全域大腦段位
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

  // 3. 取出記憶衰退最嚴重題目的溫手感複習題
  const getTopForgottenReview = (): { targetType: string; days: number; strength: number; puzzle: PuzzleEntity } | null => {
    if (sortedForgottenTypes.length === 0) return null;

    const top = sortedForgottenTypes[0];
    const pool = catalog[top.type] || [];
    const reviewPool = pool.filter((p) => p.tier === 'intermediate' || p.tier === 'kids');
    if (reviewPool.length === 0) return null;

    return {
      targetType: top.type,
      days: top.daysInactive,
      strength: top.currentStrength,
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
