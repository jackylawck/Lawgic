// web-frontend/src/utils/psychometricsEngine.ts
import { AttemptRecord } from '../hooks/useLearnerProfile';

export interface CHCConstructBreakdown {
  readonly gf: number; // Fluid Reasoning (流體推理)
  readonly gv: number; // Visual Processing (空間視覺處理)
  readonly gsm: number; // Short-term Working Memory (工作記憶)
  readonly inhibition: number; // Cognitive Inhibition (抑制控制)
  readonly gq: number; // Quantitative Reasoning (數量推理)
}

export interface LongitudinalPoint {
  readonly timestamp: string;
  readonly rawTheta: number;
  readonly smoothedTheta: number;
  readonly se: number;
  readonly ci95Lower: number;
  readonly ci95Upper: number;
  readonly standardIQ: number;
  readonly engineType: string;
  readonly purityIndex: number;
}

export interface ProgressSignificance {
  readonly hasSufficientData: boolean;
  readonly deltaTheta: number;
  readonly zScore: number;
  readonly pValue: number;
  readonly isSignificant: boolean;
  readonly interpretation: {
    readonly zh: string;
    readonly en: string;
  };
}

export interface CognitiveProfileReport {
  readonly overallIQ: number;
  readonly percentileRank: number;
  readonly sem: number;
  readonly ci95: readonly [number, number];
  readonly constructs: CHCConstructBreakdown;
  readonly baselineConstructs: CHCConstructBreakdown;
  readonly trajectory: readonly LongitudinalPoint[];
  readonly totalAttempts: number;
  readonly pureClearRate: number;
  readonly dominantConstruct: 'Gf' | 'Gv' | 'Gsm' | 'Balanced';
  readonly progress: ProgressSignificance;
  readonly profileSummary: {
    readonly zh: string;
    readonly en: string;
  };
}

interface DifficultySource {
  readonly irtDifficulty?: number;
  readonly b?: number;
  readonly tier?: string;
  readonly difficultyTier?: string;
  readonly difficulty?: string;
  readonly metrics?: {
    readonly irt_logit_difficulty?: number;
  };
  readonly timestamp?: string | number;
}

type ExtendedAttemptRecord = AttemptRecord & DifficultySource;

interface EngineStats {
  readonly total: number;
  readonly pureClearCount: number;
  readonly successCount: number;
}

/**
 * 心理計量學與貝氏濾波超參數契約
 *
 * - IRT_ITEM_DISCRIMINATION (a = 1.35): 項目區別度，反映題型對能力變化的敏感度斜率 (Lord, 1980)。
 * - KALMAN_PROCESS_NOISE_Q (Q = 0.04): 動態學習狀態方差，避免先驗精度過度膨脹導致收斂僵死 (Kalman, 1960)。
 * - THETA_MIN / THETA_MAX ([-3.5, 4.5]): 能力值截斷邊界，映射至 Wechsler 標尺約 [47.5, 167.5]。
 * - SE_MIN / SE_MAX ([0.20, 0.85]): 測量標準誤邊界保護。
 * - EMA_ALPHA (0.30): 指數加權移動平均平滑因子，當前 session 權重 30%，歷史佔 70% (Hunter, 1986)。
 * - SYNTHETIC_INTERVAL_MS: 30 分鐘施測間隔基準，供無歷史時間戳之記錄合成真實時間軸。
 */
const IRT_ITEM_DISCRIMINATION = 1.35;
const KALMAN_PROCESS_NOISE_Q = 0.04;
const THETA_MIN = -3.5;
const THETA_MAX = 4.5;
const SE_MIN = 0.20;
const SE_MAX = 0.85;
const RT_WEIGHT_MIN = 0.65;
const RT_WEIGHT_MAX = 1.35;
const RT_PENALTY_FACTOR = 0.45;
const CONFLICT_PENALTY_MAX = 0.35;
const CONFLICT_PENALTY_PER_EVENT = 0.06;
const FISHER_INFO_FLOOR = 0.08;
const EMA_ALPHA = 0.30;
const SYNTHETIC_INTERVAL_MS = 30 * 60 * 1000;

const TIER_IRT_DIFFICULTY: Record<string, number> = {
  kids: 0.65,
  intermediate: 1.45,
  expert: 2.35,
  master: 3.15,
  legendary: 3.75,
  ultimate: 4.35,
};

const DEFAULT_CONSTRUCTS: CHCConstructBreakdown = {
  gf: 0.65,
  gv: 0.65,
  gsm: 0.65,
  inhibition: 0.65,
  gq: 0.5,
};

const BASE_ENGINE_CONSTRUCTS: Record<string, CHCConstructBreakdown> = {
  sudoku: { gf: 0.85, gv: 0.3, gsm: 0.7, inhibition: 0.75, gq: 0.4 },
  maze: { gf: 0.4, gv: 0.9, gsm: 0.8, inhibition: 0.6, gq: 0.1 },
  skyscraper: { gf: 0.7, gv: 0.95, gsm: 0.75, inhibition: 0.8, gq: 0.3 },
  hashi: { gf: 0.75, gv: 0.88, gsm: 0.6, inhibition: 0.7, gq: 0.6 },
  kropki: { gf: 0.8, gv: 0.5, gsm: 0.65, inhibition: 0.85, gq: 0.7 },
  slitherlink: { gf: 0.7, gv: 0.95, gsm: 0.6, inhibition: 0.9, gq: 0.5 },
  tents: { gf: 0.75, gv: 0.7, gsm: 0.65, inhibition: 0.85, gq: 0.6 },
  lightup: { gf: 0.7, gv: 0.8, gsm: 0.6, inhibition: 0.8, gq: 0.5 },
  kakuro: { gf: 0.85, gv: 0.4, gsm: 0.8, inhibition: 0.7, gq: 0.95 },
  nonogram: { gf: 0.8, gv: 0.85, gsm: 0.7, inhibition: 0.8, gq: 0.7 },
  masyu: { gf: 0.7, gv: 0.9, gsm: 0.6, inhibition: 0.85, gq: 0.2 },
  nurikabe: { gf: 0.75, gv: 0.9, gsm: 0.8, inhibition: 0.92, gq: 0.4 },
  heyawake: { gf: 0.8, gv: 0.85, gsm: 0.75, inhibition: 0.85, gq: 0.4 },
  dominoes: { gf: 0.85, gv: 0.75, gsm: 0.85, inhibition: 0.88, gq: 0.5 },
  yajilin: { gf: 0.85, gv: 0.92, gsm: 0.8, inhibition: 0.92, gq: 0.5 },
  shikaku: { gf: 0.88, gv: 0.92, gsm: 0.75, inhibition: 0.85, gq: 0.75 },
  futoshiki: { gf: 0.85, gv: 0.45, gsm: 0.75, inhibition: 0.8, gq: 0.7 },
  hitori: { gf: 0.8, gv: 0.6, gsm: 0.8, inhibition: 0.9, gq: 0.3 },
};

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export class PsychometricsEngine {
  /**
   * 安全萃取各題型與不同版本紀錄中的真實 IRT 難度值 (b)
   */
  private static _extractDifficulty(rec: ExtendedAttemptRecord): number {
    const directVal = rec.irtDifficulty ?? rec.b ?? rec.metrics?.irt_logit_difficulty;
    if (typeof directVal === 'number' && Number.isFinite(directVal)) {
      return directVal;
    }

    const tier = String(rec.tier || rec.difficultyTier || rec.difficulty || '').toLowerCase();
    return TIER_IRT_DIFFICULTY[tier] ?? 1.5;
  }

  /**
   * 具備狀態噪聲（Process Noise）的卡爾曼-貝氏動態 IRT 特徵更新
   *
   * 數學推導：
   * 2PL 對數似然梯度為 ∂log L / ∂θ = a * (X - P)
   * 費雪訊息量 I(θ) = a^2 * P * (1 - P)
   */
  private static _estimateStepTheta(
    rec: ExtendedAttemptRecord,
    prevTheta: number,
    prevSE: number
  ): { theta: number; se: number } {
    const b = this._extractDifficulty(rec);
    const a = IRT_ITEM_DISCRIMINATION;

    // 動態學習狀態方差 (Process Noise Q)，防止 SE 過度萎縮
    const priorVariance = prevSE * prevSE + KALMAN_PROCESS_NOISE_Q;
    const priorPrecision = 1 / priorVariance;

    // 2PL 模型機率預測
    const p = 1 / (1 + Math.exp(-a * (prevTheta - b)));

    // 梯度計算：標準 2PL 形式
    const gradient = a * (rec.isSuccess ? 1 - p : -p);
    const fisherInfo = Math.max(FISHER_INFO_FLOOR, a * a * p * (1 - p));

    // 反應時間與認知負載權重調整
    const baselineSec = Math.max(15, b * 40 + 25);
    const actualSec = Math.max(2, Math.min(600, rec.timeSpentSec || baselineSec));
    const rtRatio = Math.log(actualSec + 1) / Math.log(baselineSec + 1);
    const rtWeight = Math.max(RT_WEIGHT_MIN, Math.min(RT_WEIGHT_MAX, 1.0 - (rtRatio - 1.0) * RT_PENALTY_FACTOR));

    // 試錯與衝突懲罰
    const conflicts = rec.conflictsCount || 0;
    const conflictPenalty = conflicts > 0 ? Math.min(CONFLICT_PENALTY_MAX, conflicts * CONFLICT_PENALTY_PER_EVENT) : 0;

    // 資訊精度更新
    const updatedPrecision = priorPrecision + fisherInfo;
    const delta = (gradient * rtWeight - conflictPenalty) / updatedPrecision;

    const newTheta = Math.max(THETA_MIN, Math.min(THETA_MAX, prevTheta + delta));
    const newSE = Math.max(SE_MIN, Math.min(SE_MAX, Math.sqrt(1 / updatedPrecision)));

    return { theta: round2(newTheta), se: round2(newSE) };
  }

  /**
   * 基於題型累計統計的高效權重調整（不可變更新與 O(1) 計算）
   */
  private static _getPersonalizedWeightsFromStats(
    engineType: string,
    stats: EngineStats
  ): CHCConstructBreakdown {
    const base = BASE_ENGINE_CONSTRUCTS[engineType] ?? DEFAULT_CONSTRUCTS;
    if (stats.total < 2) return base;

    const pureRatio = stats.pureClearCount / stats.total;
    const successRatio = stats.successCount / stats.total;

    const deductiveBoost = Math.max(0.85, Math.min(1.25, 0.85 + pureRatio * 0.4));
    const stabilityBoost = Math.max(0.85, Math.min(1.20, 0.85 + successRatio * 0.35));

    return {
      gf: Math.min(1.0, round2(base.gf * deductiveBoost)),
      gv: Math.min(1.0, round2(base.gv * deductiveBoost)),
      gsm: Math.min(1.0, round2(base.gsm * stabilityBoost)),
      inhibition: Math.min(1.0, round2(base.inhibition * deductiveBoost)),
      gq: Math.min(1.0, round2(base.gq * stabilityBoost)),
    };
  }

  public static generateReport(history: AttemptRecord[]): CognitiveProfileReport {
    if (!history || history.length === 0) {
      return this._getDefaultProfile();
    }

    const trajectory: LongitudinalPoint[] = [];
    let curTheta = 0.0;
    let curSE = 0.70;
    let smoothedTheta = 0.0;

    let successfulPureCount = 0;
    let gfAcc = 0, gvAcc = 0, gsmAcc = 0, inhibAcc = 0, gqAcc = 0;
    let weightSum = 0;

    // 線性快取題型累計統計，消除 O(n^2) 重複過濾
    const engineStatsMap = new Map<string, EngineStats>();

    const totalCount = history.length;
    const baseTimeAnchor = Date.now();

    for (let idx = 0; idx < totalCount; idx++) {
      const rec = history[idx] as ExtendedAttemptRecord;

      const stepEst = this._estimateStepTheta(rec, curTheta, curSE);
      curTheta = stepEst.theta;
      curSE = stepEst.se;

      smoothedTheta = idx === 0 ? curTheta : EMA_ALPHA * curTheta + (1 - EMA_ALPHA) * smoothedTheta;
      if (rec.isPureClear) successfulPureCount++;

      // 不可變計數更新
      const prev = engineStatsMap.get(rec.engineType) ?? { total: 0, pureClearCount: 0, successCount: 0 };
      const currentStats: EngineStats = {
        total: prev.total + 1,
        pureClearCount: prev.pureClearCount + (rec.isPureClear ? 1 : 0),
        successCount: prev.successCount + (rec.isSuccess ? 1 : 0),
      };
      engineStatsMap.set(rec.engineType, currentStats);

      const pWeights = this._getPersonalizedWeightsFromStats(rec.engineType, currentStats);
      const qualityFactor = rec.isSuccess ? (rec.isPureClear ? 1.2 : 1.0) : 0.4;

      gfAcc += pWeights.gf * qualityFactor;
      gvAcc += pWeights.gv * qualityFactor;
      gsmAcc += pWeights.gsm * qualityFactor;
      inhibAcc += pWeights.inhibition * qualityFactor;
      gqAcc += pWeights.gq * qualityFactor;
      weightSum += qualityFactor;

      const ptIQ = Math.max(40, Math.min(160, Math.round(100 + smoothedTheta * 15)));
      const ciLower = round2(smoothedTheta - 1.96 * curSE);
      const ciUpper = round2(smoothedTheta + 1.96 * curSE);

      const recordTime = typeof rec.timestamp === 'string' && rec.timestamp.length >= 10
        ? new Date(rec.timestamp).toISOString().slice(5, 16)
        : new Date(baseTimeAnchor - (totalCount - idx) * SYNTHETIC_INTERVAL_MS).toISOString().slice(5, 16);

      trajectory.push({
        timestamp: recordTime,
        rawTheta: curTheta,
        smoothedTheta: round2(smoothedTheta),
        se: curSE,
        ci95Lower: ciLower,
        ci95Upper: ciUpper,
        standardIQ: ptIQ,
        engineType: rec.engineType,
        purityIndex: rec.isPureClear ? 1.0 : 0.6,
      });
    }

    const normW = Math.max(0.1, weightSum);
    const constructs: CHCConstructBreakdown = {
      gf: Math.min(1.0, round2(gfAcc / normW)),
      gv: Math.min(1.0, round2(gvAcc / normW)),
      gsm: Math.min(1.0, round2(gsmAcc / normW)),
      inhibition: Math.min(1.0, round2(inhibAcc / normW)),
      gq: Math.min(1.0, round2(gqAcc / normW)),
    };

    const baselineRecords = history.slice(0, Math.max(2, Math.floor(history.length * 0.25)));
    const baselineWeights = baselineRecords.map(
      (r) => BASE_ENGINE_CONSTRUCTS[r.engineType] ?? constructs
    );
    const baselineCount = baselineWeights.length || 1;
    const baselineConstructs: CHCConstructBreakdown = {
      gf: round2(baselineWeights.reduce((a, b) => a + b.gf, 0) / baselineCount),
      gv: round2(baselineWeights.reduce((a, b) => a + b.gv, 0) / baselineCount),
      gsm: round2(baselineWeights.reduce((a, b) => a + b.gsm, 0) / baselineCount),
      inhibition: round2(baselineWeights.reduce((a, b) => a + b.inhibition, 0) / baselineCount),
      gq: round2(baselineWeights.reduce((a, b) => a + b.gq, 0) / baselineCount),
    };

    const finalSmoothedTheta = trajectory[trajectory.length - 1].smoothedTheta;
    const overallIQ = Math.max(40, Math.min(160, Math.round(100 + finalSmoothedTheta * 15)));
    const percentileRank = round2(this._normalCdf((overallIQ - 100) / 15) * 100);

    const sem = round2(15 * curSE);
    const ci95: [number, number] = [
      Math.max(40, Math.round(overallIQ - 1.96 * sem)),
      Math.min(160, Math.round(overallIQ + 1.96 * sem)),
    ];

    /* 設計決策：dominantConstruct 專注於核心推理與表徵構念 (Gf / Gv / Gsm)。
       依序排序後若第 1 名領先第 2 名達 0.08 以上，判定為顯著主導構念；否則判定為均衡 (Balanced)。 */
    const coreConstructEntries: { key: 'Gf' | 'Gv' | 'Gsm'; val: number }[] = [
      { key: 'Gf', val: constructs.gf },
      { key: 'Gv', val: constructs.gv },
      { key: 'Gsm', val: constructs.gsm },
    ];
    coreConstructEntries.sort((a, b) => b.val - a.val);

    const dominantConstruct: 'Gf' | 'Gv' | 'Gsm' | 'Balanced' =
      coreConstructEntries[0].val - coreConstructEntries[1].val >= 0.08
        ? coreConstructEntries[0].key
        : 'Balanced';

    const progress = this._calculateProgressSignificance(trajectory);

    const profileSummaryZh = `你在 Wechsler 量尺對標估算相當於 IQ ${overallIQ}（95% CI [${ci95[0]}, ${ci95[1]}]，全體常模 PR ${percentileRank}）。認知架構呈現【${
      dominantConstruct === 'Gf'
        ? '卓越流體歸納推理（Gf）優勢'
        : dominantConstruct === 'Gv'
        ? '敏銳正交拓撲視覺空間（Gv）優勢'
        : dominantConstruct === 'Gsm'
        ? '出色工作記憶容量（Gsm）優勢'
        : '全面均衡的認知架構'
    }】。在連續定式推導與衝動控制中展現了 ${
      constructs.inhibition >= 0.8 ? '極佳的抑制專注力' : '穩健的認知調節能力'
    }。${progress.hasSufficientData && progress.isSignificant ? ` 相較於初期訓練，你的能力值提升了 Δθ = +${progress.deltaTheta}，具有統計學上的顯著進步（p < 0.05）。` : ''}`;

    const profileSummaryEn = `Your standardized Full-Scale IQ benchmark is ${overallIQ} (95% CI [${ci95[0]}, ${ci95[1]}], Percentile Rank PR ${percentileRank}). Your cognitive architecture highlights ${
      dominantConstruct === 'Gf'
        ? 'superior inductive fluid reasoning (Gf)'
        : dominantConstruct === 'Gv'
        ? 'acute visuospatial topological acuity (Gv)'
        : dominantConstruct === 'Gsm'
        ? 'exceptional working memory bandwidth (Gsm)'
        : 'a highly balanced cognitive architecture'
    }, backed by robust inhibitory control. ${progress.hasSufficientData && progress.isSignificant ? ` Longitudinal trajectory indicates statistically significant ability growth of Δθ = +${progress.deltaTheta} (p < 0.05).` : ''}`;

    return {
      overallIQ,
      percentileRank,
      sem,
      ci95,
      constructs,
      baselineConstructs,
      trajectory,
      totalAttempts: history.length,
      pureClearRate: round2((successfulPureCount / history.length) * 100),
      dominantConstruct,
      progress,
      profileSummary: {
        zh: profileSummaryZh,
        en: profileSummaryEn,
      },
    };
  }

  private static _calculateProgressSignificance(trajectory: readonly LongitudinalPoint[]): ProgressSignificance {
    if (trajectory.length < 6) {
      return {
        hasSufficientData: false,
        deltaTheta: 0,
        zScore: 0,
        pValue: 1.0,
        isSignificant: false,
        interpretation: {
          zh: '需累積至少 6 筆評測紀錄以啟動認知軌跡成長檢定。',
          en: 'Requires at least 6 assessment points to evaluate cognitive growth.',
        },
      };
    }

    const half = Math.floor(trajectory.length / 2);
    const firstHalf = trajectory.slice(0, half);
    const secondHalf = trajectory.slice(half);

    const n1 = firstHalf.length;
    const n2 = secondHalf.length;

    const m1 = firstHalf.reduce((a, b) => a + b.rawTheta, 0) / n1;
    const m2 = secondHalf.reduce((a, b) => a + b.rawTheta, 0) / n2;

    const varMean1 = firstHalf.reduce((a, b) => a + b.se * b.se, 0) / (n1 * n1);
    const varMean2 = secondHalf.reduce((a, b) => a + b.se * b.se, 0) / (n2 * n2);

    const seDiff = Math.sqrt(varMean1 + varMean2);
    const deltaTheta = round2(m2 - m1);
    const zScore = round2(deltaTheta / Math.max(0.001, seDiff));
    const pValue = round2(1 - this._normalCdf(zScore));
    const isSignificant = zScore >= 1.645 && deltaTheta > 0;

    return {
      hasSufficientData: true,
      deltaTheta,
      zScore,
      pValue,
      isSignificant,
      interpretation: {
        zh: isSignificant
          ? `統計檢定顯著（Z = ${zScore}, p = ${pValue}）：能力增長具有統計學顯著性（超越隨機測量誤差）。`
          : `能力表現平穩（Z = ${zScore}）：目前處於能力盤整期或常態測量波動範圍內。`,
        en: isSignificant
          ? `Significant progress verified (Z = ${zScore}, p = ${pValue}): growth reliably exceeds measurement error.`
          : `Stable performance (Z = ${zScore}): currently within standard error plateau.`,
      },
    };
  }

  /**
   * 標準常態累積分布函數近似 (Standard Normal Cumulative Distribution Function)
   *
   * 演算法依據：Abramowitz & Stegun 26.2.17 (Hart 1968 近似式)
   * 精度範圍：|x| <= 7.5 時絕對誤差 |ε| < 7.5 × 10^-8
   * 參考文獻：Handbook of Mathematical Functions with Formulas, Graphs, and Mathematical Tables, p. 932
   */
  private static _normalCdf(x: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327 * Math.exp((-x * x) / 2); // 1 / sqrt(2 * π) ≈ 0.39894228...
    const prob =
      d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x > 0 ? 1 - prob : prob;
  }

  private static _getDefaultProfile(): CognitiveProfileReport {
    return {
      overallIQ: 100,
      percentileRank: 50.0,
      sem: 4.2,
      ci95: [92, 108],
      constructs: { gf: 0.65, gv: 0.65, gsm: 0.6, inhibition: 0.7, gq: 0.55 },
      baselineConstructs: { gf: 0.55, gv: 0.55, gsm: 0.5, inhibition: 0.6, gq: 0.45 },
      trajectory: [],
      totalAttempts: 0,
      pureClearRate: 0,
      dominantConstruct: 'Balanced',
      progress: {
        hasSufficientData: false,
        deltaTheta: 0,
        zScore: 0,
        pValue: 1.0,
        isSignificant: false,
        interpretation: {
          zh: '尚無足夠數據。',
          en: 'No assessment data available.',
        },
      },
      profileSummary: {
        zh: '完成 3 款以上不同的邏輯謎題評測後，系統將為你建立完整的 CHC 認知側寫與成長軌跡。',
        en: 'Complete at least 3 logic puzzle assessments to activate your CHC cognitive profile.',
      },
    };
  }
}
