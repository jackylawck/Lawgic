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
  lastGlobalActiveAt: number; // 用於士氣均值回歸計算
}

interface SecuredStoragePayload {
  data: LearnerProfile;
  seal: string;
}

const STORAGE_KEY = 'LOGICORE_LEARNER_PROFILE_SEC_V4_1';

function generateDataSeal(data: LearnerProfile): string {
  const serialized = `${data.userId}:${data.history.length}:${data.morale.toFixed(2)}:${Object.keys(data.peakRecords).length}`;
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash << 5) - hash + serialized.charCodeAt(i);
    hash |= 0;
  }
  return `SEAL_V4_1_${Math.abs(hash).toString(16)}`;
}

// 基準階層難度參數 \delta
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
  userId: 'player_neuro_v4_1',
  morale: 1.0,
  history: [],
  typeStates: {},
  peakRecords: {},
  lastPlayedAt: {},
  lastGlobalActiveAt: Date.now(),
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
      console.error('[Security Warning] Failed to persist V4.1 profile:', e);
    }
  }, [profile]);

  const recordAttempt = useCallback((record: Omit<SolveRecord, 'timestamp'>) => {
    setProfile((prev) => {
      const now = Date.now();
      const fullRecord: SolveRecord = { ...record, timestamp: now };
      const updatedHistory = [...prev.history, fullRecord];

      // 1. 取得舊狀態
      const rawState = prev.typeStates[record.engineType] || {
        theta: 0.0,
        strength: 5.0,
        stability: 1.5,
        solved: 0,
        totalAttempts: 0,
        avgTimeSec: record.timeSpentSec,
        consecutivePlateau: 0,
      };

      // 2. 🔥【時空同步核心】：在更新前，先套用物理時間衰減，取得當下真實殘存記憶
      const lastTime = prev.lastPlayedAt[record.engineType] || now;
      const elapsedDays = Math.max(0, (now - lastTime) / (1000 * 60 * 60 * 24));
      const lambda = 0.15 / Math.max(1.0, rawState.stability);
      const preDecayedStrength = Math.max(0.5, rawState.strength * Math.exp(-lambda * elapsedDays));

      // 3. 題目層級粒度 \delta 計算 (結合階層標定與解題時間擾動)
      const baseDelta = BASE_TIER_DELTA[record.tier] || 0.0;
      const baseTime = BASE_TIME_ESTIMATE[record.tier] || 120;
      const itemDifficultyOffset = Math.log(Math.max(0.2, Math.min(3.0, record.timeSpentSec / baseTime)));
      const fineGrainedDelta = baseDelta + itemDifficultyOffset * 0.3;

      // 4. Rasch IRT 線上貝氏更新
      const expectedProb = 1 / (1 + Math.exp(-(rawState.theta - fineGrainedDelta)));
      const actualScore = record.isSuccess ? 1.0 : 0.0;
      const learningRate = 0.25;
      const newTheta = Math.max(-3.0, Math.min(3.0, rawState.theta + learningRate * (actualScore - expectedProb)));

      // 5. 雙參數記憶更新（以 preDecayedStrength 為真實基準）
      let newStrength = preDecayedStrength;
      let newStability = rawState.stability;
      if (record.isSuccess) {
        newStrength = Math.min(10.0, preDecayedStrength + 1.2 * Math.exp(-preDecayedStrength / 10));
        newStability = Math.min(10.0, rawState.stability + 0.25);
      } else {
        newStrength = Math.max(0.5, preDecayedStrength * 0.7);
      }

      // 6. EWMA 平滑解題時長
      const smoothedTime = rawState.avgTimeSec > 0
        ? Math.round(rawState.avgTimeSec * 0.65 + record.timeSpentSec * 0.35)
        : record.timeSpentSec;

      // 7. 🔥【士氣時間均值回歸 + 心流反饋】
      const inactiveDaysGlobal = Math.max(0, (now - (prev.lastGlobalActiveAt || now)) / (1000 * 60 * 60 * 24));
      let currentMorale = prev.morale;
      // 超過 3 天未登入，士氣往 1.0 均值回歸
      if (inactiveDaysGlobal > 3) {
        currentMorale = 1.0 + (prev.morale - 1.0) * Math.exp(-0.2 * (inactiveDaysGlobal - 3));
      }

      const recentThree = updatedHistory.filter((h) => h.engineType === record.engineType).slice(-3);
      if (recentThree.length === 3 && recentThree.every((h) => !h.isSuccess)) {
        currentMorale = Math.max(0.6, currentMorale - 0.15); // 挫折保護
      } else if (record.isSuccess) {
        currentMorale = Math.min(1.4, currentMorale + 0.05);
      }

      // 8. 巔峰紀錄更新
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

  // 9. 貝氏 IRT + 動機調節 + 高原隨機擾動
  const getZPDRecommendedTier = useCallback(
    (engineType: string): TierKey => {
      const state = profile.typeStates[engineType];
      if (!state || state.totalAttempts < 2) {
        return 'kids';
      }

      const effectiveTheta = state.theta * profile.morale;

      let recommended: TierKey = 'kids';
      if (effectiveTheta >= 1.6) recommended = 'master';
      else if (effectiveTheta >= 0.5) recommended = 'expert';
      else if (effectiveTheta >= -0.8) recommended = 'intermediate';
      else recommended = 'kids';

      // 40%~60% 停滯區之隨機微擾動探索
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
    downloadAnchor.setAttribute("download", `logicore_neuro_profile_v4_1_${Date.now()}.json`);
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
