// web-frontend/src/hooks/useLearnerProfile.ts
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

export interface TypeCognitiveState {
  theta: number;        // Rasch IRT 潛在特質能力值 (-3.0 ~ +3.0)
  strength: number;     // 記憶強度 S (0.0 ~ 10.0)
  stability: number;    // 記憶穩固度 F (1.0 ~ 10.0)
  solved: number;
  totalAttempts: number;
  avgTimeSec: number;   // EWMA 平滑解題時長
  consecutivePlateau: number;
}

export interface LearnerProfile {
  userId: string;
  morale: number;       // 動機/士氣指數 (0.6 ~ 1.4)
  history: SolveRecord[];
  typeStates: Record<string, TypeCognitiveState>;
  peakRecords: Record<string, { tier: TierKey; timeSpentSec: number; timestamp: number }>;
  lastPlayedAt: Record<string, number>;
  lastGlobalActiveAt: number;
}

interface SecuredStoragePayload {
  data: LearnerProfile;
  seal: string;
}

const STORAGE_KEY = 'LOGICORE_LEARNER_PROFILE_SEC_V5';

function generateDataSeal(data: LearnerProfile): string {
  const serialized = `${data.userId}:${data.history.length}:${data.morale.toFixed(2)}:${Object.keys(data.peakRecords).length}`;
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash << 5) - hash + serialized.charCodeAt(i);
    hash |= 0;
  }
  return `SEAL_V5_${Math.abs(hash).toString(16)}`;
}

const BASE_TIER_DELTA: Record<TierKey, number> = {
  kids: -1.5,
  intermediate: -0.2,
  expert: 1.0,
  master: 2.2,
};

const BASE_TIME_ESTIMATE: Record<TierKey, number> = {
  kids: 60,
  intermediate: 120,
  expert: 240,
  master: 400,
};

const INITIAL_PROFILE: LearnerProfile = {
  userId: 'player_neuro_v5_sealed',
  morale: 1.0,
  history: [],
  typeStates: {},
  peakRecords: {},
  lastPlayedAt: {},
  lastGlobalActiveAt: Date.now(),
};

/**
 * 雙相神經記憶動力學 (Biphasic Memory Dynamics)
 * 結合「離線睡眠固化增益」與「遠期指數遺忘衰退」
 */
export function calculateDynamicStrength(rawStrength: number, stability: number, elapsedDays: number): {
  strength: number;
  isConsolidated: boolean;
} {
  // 1. 離線黃金固化窗口 (0.6 天 ~ 2.0 天，約 15 ~ 48 小時)
  if (elapsedDays >= 0.6 && elapsedDays <= 2.0) {
    // 高斯鐘形睡眠增益：在 1 天 (24 小時) 時達到最高 +20% 增益
    const consolidationBoost = 0.20 * Math.exp(-Math.pow(elapsedDays - 1.0, 2) / 0.35);
    const boosted = Math.min(10.0, rawStrength * (1 + consolidationBoost));
    return { strength: Number(boosted.toFixed(2)), isConsolidated: true };
  }

  // 2. 超過 2 天未練習：被動指數衰減接管
  if (elapsedDays > 2.0) {
    const daysBeyondWindow = elapsedDays - 2.0;
    const lambda = 0.15 / Math.max(1.0, stability);
    const decayed = Math.max(0.5, rawStrength * Math.exp(-lambda * daysBeyondWindow));
    return { strength: Number(decayed.toFixed(2)), isConsolidated: false };
  }

  // 3. 0.6 天內 (短期連續遊玩)：維持原強度
  return { strength: rawStrength, isConsolidated: false };
}

export function useLearnerProfile() {
  const [profile, setProfile] = useState<LearnerProfile>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: SecuredStoragePayload = JSON.parse(raw);
        if (parsed.seal && parsed.seal === generateDataSeal(parsed.data)) {
          return {
            ...INITIAL_PROFILE,
            ...parsed.data,
            typeStates: parsed.data.typeStates || {},
            peakRecords: parsed.data.peakRecords || {},
            lastPlayedAt: parsed.data.lastPlayedAt || {},
            lastGlobalActiveAt: parsed.data.lastGlobalActiveAt || Date.now(),
          };
        }
      }
      return INITIAL_PROFILE;
    } catch {
      return INITIAL_PROFILE;
    }
  });

  useEffect(() => {
    try {
      const payload: SecuredStoragePayload = {
        data: profile,
        seal: generateDataSeal(profile),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error('[Security Warning] Failed to persist V5 profile:', e);
    }
  }, [profile]);

  const recordAttempt = useCallback((record: Omit<SolveRecord, 'timestamp'>) => {
    setProfile((prev) => {
      const now = Date.now();
      const fullRecord: SolveRecord = { ...record, timestamp: now };
      const updatedHistory = [...prev.history, fullRecord];

      const rawState = prev.typeStates[record.engineType] || {
        theta: 0.0,
        strength: 5.0,
        stability: 1.5,
        solved: 0,
        totalAttempts: 0,
        avgTimeSec: record.timeSpentSec,
        consecutivePlateau: 0,
      };

      // 1. 🔥【神經動力學前置校準】：套用睡眠固化增益或被動衰退
      const lastTime = prev.lastPlayedAt[record.engineType] || now;
      const elapsedDays = Math.max(0, (now - lastTime) / (1000 * 60 * 60 * 24));
      const { strength: baseStrength } = calculateDynamicStrength(rawState.strength, rawState.stability, elapsedDays);

      // 2. 題目級 Rasch IRT 參數校正
      const baseDelta = BASE_TIER_DELTA[record.tier] || 0.0;
      const baseTime = BASE_TIME_ESTIMATE[record.tier] || 120;
      const itemDifficultyOffset = Math.log(Math.max(0.2, Math.min(3.0, record.timeSpentSec / baseTime)));
      const fineGrainedDelta = baseDelta + itemDifficultyOffset * 0.3;

      // 3. 貝氏線上更新 \theta
      const expectedProb = 1 / (1 + Math.exp(-(rawState.theta - fineGrainedDelta)));
      const actualScore = record.isSuccess ? 1.0 : 0.0;
      const learningRate = 0.25;
      const newTheta = Math.max(-3.0, Math.min(3.0, rawState.theta + learningRate * (actualScore - expectedProb)));

      // 4. 記憶強度更新（以 baseStrength 為神經基底）
      let newStrength = baseStrength;
      let newStability = rawState.stability;
      if (record.isSuccess) {
        newStrength = Math.min(10.0, baseStrength + 1.2 * Math.exp(-baseStrength / 10));
        newStability = Math.min(10.0, rawState.stability + 0.25);
      } else {
        newStrength = Math.max(0.5, baseStrength * 0.7);
      }

      // 5. EWMA 平滑解題時長
      const smoothedTime = rawState.avgTimeSec > 0
        ? Math.round(rawState.avgTimeSec * 0.65 + record.timeSpentSec * 0.35)
        : record.timeSpentSec;

      // 6. 士氣均值回歸與挫折保護
      const inactiveDaysGlobal = Math.max(0, (now - (prev.lastGlobalActiveAt || now)) / (1000 * 60 * 60 * 24));
      let currentMorale = prev.morale;
      if (inactiveDaysGlobal > 3) {
        currentMorale = 1.0 + (prev.morale - 1.0) * Math.exp(-0.2 * (inactiveDaysGlobal - 3));
      }

      const recentThree = updatedHistory.filter((h) => h.engineType === record.engineType).slice(-3);
      if (recentThree.length === 3 && recentThree.every((h) => !h.isSuccess)) {
        currentMorale = Math.max(0.6, currentMorale - 0.15);
      } else if (record.isSuccess) {
        currentMorale = Math.min(1.4, currentMorale + 0.05);
      }

      // 7. 巔峰段位紀錄
      const updatedPeaks = { ...prev.peakRecords };
      if (record.isSuccess) {
        const currentPeak = updatedPeaks[record.engineType];
        const tierRanks: Record<TierKey, number> = { kids: 0, intermediate: 1, expert: 2, master: 3 };
        const isHigherTier = !currentPeak || tierRanks[record.tier] > tierRanks[currentPeak.tier];
        const isFasterSameTier =
          currentPeak &&
          tierRanks[record.tier] === tierRanks[currentPeak.tier] &&
          record.timeSpentSec < currentPeak.timeSpentSec;

        if (isHigherTier || isFasterSameTier) {
          updatedPeaks[record.engineType] = {
            tier: record.tier,
            timeSpentSec: record.timeSpentSec,
            timestamp: now,
          };
        }
      }

      return {
        ...prev,
        morale: Number(currentMorale.toFixed(2)),
        lastGlobalActiveAt: now,
        history: updatedHistory,
        typeStates: {
          ...prev.typeStates,
          [record.engineType]: {
            theta: Number(newTheta.toFixed(3)),
            strength: Number(newStrength.toFixed(2)),
            stability: Number(newStability.toFixed(2)),
            solved: rawState.solved + (record.isSuccess ? 1 : 0),
            totalAttempts: rawState.totalAttempts + 1,
            avgTimeSec: smoothedTime,
            consecutivePlateau: rawState.consecutivePlateau,
          },
        },
        peakRecords: updatedPeaks,
        lastPlayedAt: {
          ...prev.lastPlayedAt,
          [record.engineType]: now,
        },
      };
    });
  }, []);

  const getZPDRecommendedTier = useCallback(
    (engineType: string): TierKey => {
      const state = profile.typeStates[engineType];
      if (!state || state.totalAttempts < 2) return 'kids';

      const effectiveTheta = state.theta * profile.morale;
      let recommended: TierKey = 'kids';
      if (effectiveTheta >= 1.6) recommended = 'master';
      else if (effectiveTheta >= 0.5) recommended = 'expert';
      else if (effectiveTheta >= -0.8) recommended = 'intermediate';
      else recommended = 'kids';

      const recentFive = profile.history.filter((h) => h.engineType === engineType).slice(-5);
      if (recentFive.length === 5) {
        const successCount = recentFive.filter((h) => h.isSuccess).length;
        if (successCount === 2 || successCount === 3) {
          const perturb = Math.random() > 0.5;
          if (perturb && recommended === 'intermediate') return 'expert';
          if (!perturb && recommended === 'expert') return 'intermediate';
        }
      }

      return recommended;
    },
    [profile.typeStates, profile.morale, profile.history]
  );

  const exportProfileJSON = useCallback(() => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(profile, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `logicore_neuro_v5_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }, [profile]);

  const importProfileJSON = useCallback((jsonString: string): boolean => {
    try {
      const imported: LearnerProfile = JSON.parse(jsonString);
      if (imported.userId && Array.isArray(imported.history)) {
        setProfile(imported);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  return {
    profile,
    recordAttempt,
    getZPDRecommendedTier,
    exportProfileJSON,
    importProfileJSON,
  };
}
