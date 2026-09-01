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

// 題型專屬認知特質與記憶強度
export interface TypeCognitiveState {
  theta: number;        // Rasch IRT 潛在特質能力值 (-3.0 ~ +3.0，預設 0.0)
  strength: number;     // 當前記憶強度 S (0.0 ~ 10.0，反映當下提取容易度)
  stability: number;    // 記憶穩固度 F (1.0 ~ 10.0，反映抗遺忘能力)
  solved: number;
  totalAttempts: number;
  avgTimeSec: number;   // EWMA 平滑解題時長
  consecutivePlateau: number; // 高原滯留計數器
}

export interface LearnerProfile {
  userId: string;
  morale: number;       // 動機/士氣指數 (0.5 ~ 1.5，預設 1.0)
  history: SolveRecord[];
  typeStates: Record<string, TypeCognitiveState>;
  peakRecords: Record<string, { tier: TierKey; timeSpentSec: number; timestamp: number }>;
  lastPlayedAt: Record<string, number>;
}

interface SecuredStoragePayload {
  data: LearnerProfile;
  seal: string;
}

const STORAGE_KEY = 'LOGICORE_LEARNER_PROFILE_SEC_V4';

function generateDataSeal(data: LearnerProfile): string {
  const serialized = `${data.userId}:${data.history.length}:${data.morale.toFixed(2)}:${Object.keys(data.peakRecords).length}`;
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash << 5) - hash + serialized.charCodeAt(i);
    hash |= 0;
  }
  return `SEAL_V4_${Math.abs(hash).toString(16)}`;
}

// 題目難度客觀標定值 \delta (IRT Item Difficulty)
const TIER_DELTA: Record<TierKey, number> = {
  kids: -1.5,
  intermediate: -0.2,
  expert: 1.0,
  master: 2.2,
};

const INITIAL_PROFILE: LearnerProfile = {
  userId: 'player_neuro_v4',
  morale: 1.0,
  history: [],
  typeStates: {},
  peakRecords: {},
  lastPlayedAt: {},
};

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
      console.error('[Security Warning] Failed to persist V4 profile:', e);
    }
  }, [profile]);

  const recordAttempt = useCallback((record: Omit<SolveRecord, 'timestamp'>) => {
    setProfile((prev) => {
      const now = Date.now();
      const fullRecord: SolveRecord = { ...record, timestamp: now };
      const updatedHistory = [...prev.history, fullRecord];

      // 取得或初始化該題型認知狀態
      const state = prev.typeStates[record.engineType] || {
        theta: 0.0,
        strength: 5.0,
        stability: 1.5,
        solved: 0,
        totalAttempts: 0,
        avgTimeSec: record.timeSpentSec,
        consecutivePlateau: 0,
      };

      // 1. Rasch IRT 線上更新: P(correct) = 1 / (1 + e^-(theta - delta))
      const delta = TIER_DELTA[record.tier] || 0.0;
      const expectedProb = 1 / (1 + Math.exp(-(state.theta - delta)));
      const actualScore = record.isSuccess ? 1.0 : 0.0;
      const learningRate = 0.25; // 貝氏步長
      const newTheta = Math.max(-3.0, Math.min(3.0, state.theta + learningRate * (actualScore - expectedProb)));

      // 2. 雙參數記憶衰退模型 (Memory Strength S & Stability F)
      let newStrength = state.strength;
      let newStability = state.stability;
      if (record.isSuccess) {
        newStrength = Math.min(10.0, state.strength + 1.2 * Math.exp(-state.strength / 10));
        newStability = Math.min(10.0, state.stability + 0.3);
      } else {
        newStrength = Math.max(0.5, state.strength * 0.7);
      }

      // 3. EWMA 平滑解題時長
      const smoothedTime = state.avgTimeSec > 0
        ? Math.round(state.avgTimeSec * 0.65 + record.timeSpentSec * 0.35)
        : record.timeSpentSec;

      // 4. 動機與士氣通道 (Morale Channel)
      const recentThree = updatedHistory.filter((h) => h.engineType === record.engineType).slice(-3);
      let newMorale = prev.morale;
      if (recentThree.length === 3 && recentThree.every((h) => !h.isSuccess)) {
        newMorale = Math.max(0.6, prev.morale - 0.15); // 觸發抗挫折保護
      } else if (record.isSuccess) {
        newMorale = Math.min(1.4, prev.morale + 0.05);
      }

      // 5. 顛峰紀錄
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
        morale: Number(newMorale.toFixed(2)),
        history: updatedHistory,
        typeStates: {
          ...prev.typeStates,
          [record.engineType]: {
            theta: Number(newTheta.toFixed(3)),
            strength: Number(newStrength.toFixed(2)),
            stability: Number(newStability.toFixed(2)),
            solved: state.solved + (record.isSuccess ? 1 : 0),
            totalAttempts: state.totalAttempts + 1,
            avgTimeSec: smoothedTime,
            consecutivePlateau: state.consecutivePlateau,
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

  // 6. 貝氏 IRT + 動機調節 + 高原隨機擾動之 ZPD 核心
  const getZPDRecommendedTier = useCallback(
    (engineType: string): TierKey => {
      const state = profile.typeStates[engineType];
      if (!state || state.totalAttempts < 2) {
        return 'kids';
      }

      const effectiveTheta = state.theta * profile.morale; // 經動機加權之有效特質值

      // 基底認知階梯對映
      let recommended: TierKey = 'kids';
      if (effectiveTheta >= 1.6) recommended = 'master';
      else if (effectiveTheta >= 0.5) recommended = 'expert';
      else if (effectiveTheta >= -0.8) recommended = 'intermediate';
      else recommended = 'kids';

      // 高原破除微擾動 (Learning Plateau Perturbation)
      const recentFive = profile.history.filter((h) => h.engineType === engineType).slice(-5);
      if (recentFive.length === 5) {
        const successCount = recentFive.filter((h) => h.isSuccess).length;
        if (successCount === 2 || successCount === 3) {
          // 陷入 40%~60% 停滯區，執行 ±1 階微擾動探索真實邊界
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
    downloadAnchor.setAttribute("download", `logicore_neuro_profile_${Date.now()}.json`);
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
