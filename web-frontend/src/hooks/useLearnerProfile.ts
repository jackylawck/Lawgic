// web-frontend/src/hooks/useLearnerProfile.ts
import { useState, useEffect, useCallback } from 'react';
import { CognitiveLoadVector } from '../generated';

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master';
export type CognitiveDimension = 'spatial' | 'numeric' | 'workingMemory' | 'inhibition';

export interface SolveRecord {
  puzzleId: string;
  engineType: string;
  tier: TierKey;
  cognitiveLoad: CognitiveLoadVector;
  isSuccess: boolean;
  timeSpentSec: number;
  conflictsCount: number;
  timestamp: number;
}

export interface TypeCognitiveState {
  // MIRT 4維能力特質向量 \vec{\theta} (-3.0 ~ +3.0)
  theta: Record<CognitiveDimension, number>;
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

const STORAGE_KEY = 'LOGICORE_LEARNER_PROFILE_SEC_V6_1';

function generateDataSeal(data: LearnerProfile): string {
  const serialized = `${data.userId}:${data.history.length}:${data.morale.toFixed(2)}:${Object.keys(data.peakRecords).length}`;
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash << 5) - hash + serialized.charCodeAt(i);
    hash |= 0;
  }
  return `SEAL_V6_1_${Math.abs(hash).toString(16)}`;
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

const INITIAL_THETA: Record<CognitiveDimension, number> = {
  spatial: 0.0,
  numeric: 0.0,
  workingMemory: 0.0,
  inhibition: 0.0,
};

const INITIAL_PROFILE: LearnerProfile = {
  userId: 'player_mirt_v6_1',
  morale: 1.0,
  history: [],
  typeStates: {},
  peakRecords: {},
  lastPlayedAt: {},
  lastGlobalActiveAt: Date.now(),
};

export function calculateDynamicStrength(rawStrength: number, stability: number, elapsedDays: number): {
  strength: number;
  isConsolidated: boolean;
} {
  if (elapsedDays >= 0.6 && elapsedDays <= 2.0) {
    const consolidationBoost = 0.20 * Math.exp(-Math.pow(elapsedDays - 1.0, 2) / 0.35);
    const boosted = Math.min(10.0, rawStrength * (1 + consolidationBoost));
    return { strength: Number(boosted.toFixed(2)), isConsolidated: true };
  }

  if (elapsedDays > 2.0) {
    const daysBeyondWindow = elapsedDays - 2.0;
    const lambda = 0.15 / Math.max(1.0, stability);
    const decayed = Math.max(0.5, rawStrength * Math.exp(-lambda * daysBeyondWindow));
    return { strength: Number(decayed.toFixed(2)), isConsolidated: false };
  }

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
      console.error('[Security Warning] Failed to persist V6.1 profile:', e);
    }
  }, [profile]);

  const recordAttempt = useCallback((record: Omit<SolveRecord, 'timestamp'>) => {
    setProfile((prev) => {
      const now = Date.now();
      const fullRecord: SolveRecord = { ...record, timestamp: now };
      const updatedHistory = [...prev.history, fullRecord];

      const rawState = prev.typeStates[record.engineType] || {
        theta: { ...INITIAL_THETA },
        strength: 5.0,
        stability: 1.5,
        solved: 0,
        totalAttempts: 0,
        avgTimeSec: record.timeSpentSec,
        consecutivePlateau: 0,
      };

      // 1. 神經動力學前置時間校準
      const lastTime = prev.lastPlayedAt[record.engineType] || now;
      const elapsedDays = Math.max(0, (now - lastTime) / (1000 * 60 * 60 * 24));
      const { strength: baseStrength } = calculateDynamicStrength(rawState.strength, rawState.stability, elapsedDays);

      // 2. 題目級難度標定 \delta
      const baseDelta = BASE_TIER_DELTA[record.tier] || 0.0;
      const baseTime = BASE_TIME_ESTIMATE[record.tier] || 120;
      const itemDifficultyOffset = Math.log(Math.max(0.2, Math.min(3.0, record.timeSpentSec / baseTime)));
      const fineGrainedDelta = baseDelta + itemDifficultyOffset * 0.3;

      // 3. 🔥【MIRT 4維能力投影計算】
      const load = record.cognitiveLoad || { spatial: 0.25, numeric: 0.25, workingMemory: 0.25, inhibition: 0.25 };
      const effectiveAbility =
        (rawState.theta.spatial || 0) * load.spatial +
        (rawState.theta.numeric || 0) * load.numeric +
        (rawState.theta.workingMemory || 0) * load.workingMemory +
        (rawState.theta.inhibition || 0) * load.inhibition;

      const expectedProb = 1 / (1 + Math.exp(-(effectiveAbility - fineGrainedDelta)));
      const actualScore = record.isSuccess ? 1.0 : 0.0;
      const residual = actualScore - expectedProb;

      // 4. 🔥【漸進測量動態學習率衰減（信心加權）】
      const adaptiveLR = 0.35 / Math.sqrt(rawState.totalAttempts + 1);

      // 5. 🔥【斯皮爾曼 g 因子多變量貝氏收縮更新（Covariance = 0.35）】
      const COV = 0.35;
      const calcDimUpdate = (directWeight: number, otherWeightsSum: number, currentDimTheta: number) => {
        const effectiveGradient = directWeight + COV * otherWeightsSum;
        const deltaTheta = adaptiveLR * effectiveGradient * residual;
        return Math.max(-3.0, Math.min(3.0, currentDimTheta + deltaTheta));
      };

      const updatedTheta: Record<CognitiveDimension, number> = {
        spatial: calcDimUpdate(
          load.spatial,
          load.numeric + load.workingMemory + load.inhibition,
          rawState.theta.spatial || 0
        ),
        numeric: calcDimUpdate(
          load.numeric,
          load.spatial + load.workingMemory + load.inhibition,
          rawState.theta.numeric || 0
        ),
        workingMemory: calcDimUpdate(
          load.workingMemory,
          load.spatial + load.numeric + load.inhibition,
          rawState.theta.workingMemory || 0
        ),
        inhibition: calcDimUpdate(
          load.inhibition,
          load.spatial + load.numeric + load.workingMemory,
          rawState.theta.inhibition || 0
        ),
      };

      // 6. 雙相記憶更新
      let newStrength = baseStrength;
      let newStability = rawState.stability;
      if (record.isSuccess) {
        newStrength = Math.min(10.0, baseStrength + 1.2 * Math.exp(-baseStrength / 10));
        newStability = Math.min(10.0, rawState.stability + 0.25);
      } else {
        newStrength = Math.max(0.5, baseStrength * 0.7);
      }

      // 7. EWMA 平滑解題時長
      const smoothedTime = rawState.avgTimeSec > 0
        ? Math.round(rawState.avgTimeSec * 0.65 + record.timeSpentSec * 0.35)
        : record.timeSpentSec;

      // 8. 士氣均值回歸與挫折保護
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

      // 9. 巔峰段位更新
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
            theta: {
              spatial: Number(updatedTheta.spatial.toFixed(3)),
              numeric: Number(updatedTheta.numeric.toFixed(3)),
              workingMemory: Number(updatedTheta.workingMemory.toFixed(3)),
              inhibition: Number(updatedTheta.inhibition.toFixed(3)),
            },
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
    (engineType: string, load?: CognitiveLoadVector): TierKey => {
      const state = profile.typeStates[engineType];
      if (!state || state.totalAttempts < 2) return 'kids';

      const weights = load || { spatial: 0.25, numeric: 0.25, workingMemory: 0.25, inhibition: 0.25 };
      const compositeTheta =
        (state.theta.spatial || 0) * weights.spatial +
        (state.theta.numeric || 0) * weights.numeric +
        (state.theta.workingMemory || 0) * weights.workingMemory +
        (state.theta.inhibition || 0) * weights.inhibition;

      const effectiveTheta = compositeTheta * profile.morale;
      let recommended: TierKey = 'kids';
      if (effectiveTheta >= 1.5) recommended = 'master';
      else if (effectiveTheta >= 0.4) recommended = 'expert';
      else if (effectiveTheta >= -0.8) recommended = 'intermediate';
      else recommended = 'kids';

      return recommended;
    },
    [profile.typeStates, profile.morale]
  );

  const globalCognitiveProfile = useCallback((): Record<CognitiveDimension, number> => {
    const types = Object.values(profile.typeStates);
    if (types.length === 0) return { ...INITIAL_THETA };

    const totals: Record<CognitiveDimension, number> = { spatial: 0, numeric: 0, workingMemory: 0, inhibition: 0 };
    types.forEach((t) => {
      totals.spatial += t.theta.spatial || 0;
      totals.numeric += t.theta.numeric || 0;
      totals.workingMemory += t.theta.workingMemory || 0;
      totals.inhibition += t.theta.inhibition || 0;
    });

    const count = types.length;
    return {
      spatial: Number((totals.spatial / count).toFixed(2)),
      numeric: Number((totals.numeric / count).toFixed(2)),
      workingMemory: Number((totals.workingMemory / count).toFixed(2)),
      inhibition: Number((totals.inhibition / count).toFixed(2)),
    };
  }, [profile.typeStates]);

  const exportProfileJSON = useCallback(() => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(profile, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `logicore_mirt_v6_1_${Date.now()}.json`);
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
    globalCognitiveProfile,
    exportProfileJSON,
    importProfileJSON,
  };
}
