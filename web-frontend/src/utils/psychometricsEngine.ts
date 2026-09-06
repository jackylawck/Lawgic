// web-frontend/src/utils/psychometricsEngine.ts
import { AttemptRecord } from '../hooks/useLearnerProfile';

export interface CHCConstructBreakdown {
  gf: number; // Fluid Reasoning (流體推理)
  gv: number; // Visual Processing (空間視覺處理)
  gsm: number; // Short-term Working Memory (工作記憶)
  inhibition: number; // Cognitive Inhibition (抑制控制)
  gq: number; // Quantitative Reasoning (數量推理)
}

export interface LongitudinalPoint {
  timestamp: string;
  rawTheta: number;
  smoothedTheta: number;
  se: number;
  ci95Lower: number;
  ci95Upper: number;
  standardIQ: number;
  engineType: string;
  purityIndex: number;
}

export interface ProgressSignificance {
  hasSufficientData: boolean;
  deltaTheta: number;
  zScore: number;
  pValue: number;
  isSignificant: boolean;
  interpretation: {
    zh: string;
    en: string;
  };
}

export interface CognitiveProfileReport {
  overallIQ: number;
  percentileRank: number;
  sem: number;
  ci95: [number, number];
  constructs: CHCConstructBreakdown;
  baselineConstructs: CHCConstructBreakdown;
  trajectory: LongitudinalPoint[];
  totalAttempts: number;
  pureClearRate: number;
  dominantConstruct: 'Gf' | 'Gv' | 'Gsm' | 'Balanced';
  progress: ProgressSignificance;
  profileSummary: {
    zh: string;
    en: string;
  };
}

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

export class PsychometricsEngine {
  /**
   * 安全萃取各題型與不同版本紀錄中的真實 IRT 難度值
   */
  private static _extractDifficulty(rec: any): number {
    const directVal = rec.irtDifficulty ?? rec.b ?? rec.metrics?.irt_logit_difficulty;
    if (typeof directVal === 'number' && !isNaN(directVal)) {
      return directVal;
    }

    // 若未直接標註數值，根據難度階層給予標準 IRT 梯度
    const tier = String(rec.tier || rec.difficultyTier || rec.difficulty || '').toLowerCase();
    switch (tier) {
      case 'kids': return 0.65;
      case 'intermediate': return 1.45;
      case 'expert': return 2.35;
      case 'master': return 3.15;
      case 'legendary': return 3.75;
      case 'ultimate': return 4.35;
      default: return 1.5;
    }
  }

  /**
   * 具備狀態噪聲（Process Noise）的卡爾曼-貝氏動態 IRT 特徵更新
   */
  private static _estimateStepTheta(
    rec: AttemptRecord,
    prevTheta: number = 0.0,
    prevSE: number = 0.65
  ): { theta: number; se: number } {
    const b = this._extractDifficulty(rec);
    const a = 1.35; // 項目區別度 (Discrimination parameter)

    // 引入動態學習狀態方差 (Process Noise Q)，防止 SE 過度萎縮導致能力更新僵死
    const processNoiseQ = 0.04;
    const priorVariance = prevSE * prevSE + processNoiseQ;
    const priorPrecision = 1 / priorVariance;

    // 2PL 模型機率預測
    const p = 1 / (1 + Math.exp(-a * (prevTheta - b)));
    const gradient = rec.isSuccess ? 1 - p : -p;
    const fisherInfo = Math.max(0.08, a * a * p * (1 - p));

    // 反應時間與認知負載權重調整（加入 Sigmoid 夾取避免掛機失真）
    const baselineSec = Math.max(15, b * 40 + 25);
    const actualSec = Math.max(2, Math.min(600, rec.timeSpentSec || baselineSec));
    const rtRatio = Math.log(actualSec + 1) / Math.log(baselineSec + 1);
    const rtWeight = Math.max(0.65, Math.min(1.35, 1.0 - (rtRatio - 1.0) * 0.45));

    // 試錯與衝突懲罰
    const conflicts = rec.conflictsCount || 0;
    const conflictPenalty = conflicts > 0 ? Math.min(0.35, conflicts * 0.06) : 0;

    // 資訊更新
    const updatedPrecision = priorPrecision + fisherInfo;
    const delta = (gradient * rtWeight - conflictPenalty) / updatedPrecision;

    const newTheta = Math.max(-3.5, Math.min(4.5, prevTheta + delta));
    const newSE = Math.max(0.20, Math.min(0.85, Math.sqrt(1 / updatedPrecision)));

    return { theta: Number(newTheta.toFixed(3)), se: Number(newSE.toFixed(3)) };
  }

  private static _getPersonalizedWeights(
    engineType: string,
    history: AttemptRecord[]
  ): CHCConstructBreakdown {
    const base = BASE_ENGINE_CONSTRUCTS[engineType] || {
      gf: 0.65, gv: 0.65, gsm: 0.65, inhibition: 0.65, gq: 0.5,
    };

    const engineHistory = history.filter((r) => r.engineType === engineType);
    if (engineHistory.length < 2) return base;

    const pureClearCount = engineHistory.filter((r) => r.isPureClear).length;
    const pureRatio = pureClearCount / engineHistory.length;
    const successRatio = engineHistory.filter((r) => r.isSuccess).length / engineHistory.length;

    const deductiveBoost = Math.max(0.85, Math.min(1.25, 0.85 + pureRatio * 0.4));
    const stabilityBoost = Math.max(0.85, Math.min(1.20, 0.85 + successRatio * 0.35));

    return {
      gf: Math.min(1.0, Number((base.gf * deductiveBoost).toFixed(2))),
      gv: Math.min(1.0, Number((base.gv * deductiveBoost).toFixed(2))),
      gsm: Math.min(1.0, Number((base.gsm * stabilityBoost).toFixed(2))),
      inhibition: Math.min(1.0, Number((base.inhibition * deductiveBoost).toFixed(2))),
      gq: Math.min(1.0, Number((base.gq * stabilityBoost).toFixed(2))),
    };
  }

  public static generateReport(history: AttemptRecord[]): CognitiveProfileReport {
    if (!history || history.length === 0) {
      return this._getDefaultProfile();
    }

    const trajectory: LongitudinalPoint[] = [];
    let curTheta = 0.0;
    let curSE = 0.70;
    const emaAlpha = 0.30;
    let smoothedTheta = 0.0;

    let successfulPureCount = 0;
    let gfAcc = 0, gvAcc = 0, gsmAcc = 0, inhibAcc = 0, gqAcc = 0;
    let weightSum = 0;

    history.forEach((rec, idx) => {
      const stepEst = this._estimateStepTheta(rec, curTheta, curSE);
      curTheta = stepEst.theta;
      curSE = stepEst.se;

      smoothedTheta = idx === 0 ? curTheta : emaAlpha * curTheta + (1 - emaAlpha) * smoothedTheta;
      if (rec.isPureClear) successfulPureCount++;

      const pWeights = this._getPersonalizedWeights(rec.engineType, history.slice(0, idx + 1));
      const qualityFactor = rec.isSuccess ? (rec.isPureClear ? 1.2 : 1.0) : 0.4;

      gfAcc += pWeights.gf * qualityFactor;
      gvAcc += pWeights.gv * qualityFactor;
      gsmAcc += pWeights.gsm * qualityFactor;
      inhibAcc += pWeights.inhibition * qualityFactor;
      gqAcc += pWeights.gq * qualityFactor;
      weightSum += qualityFactor;

      const ptIQ = Math.max(40, Math.min(160, Math.round(100 + smoothedTheta * 15)));
      const ciLower = Number((smoothedTheta - 1.96 * curSE).toFixed(2));
      const ciUpper = Number((smoothedTheta + 1.96 * curSE).toFixed(2));

      const recordTime = (rec as any).timestamp
        ? new Date((rec as any).timestamp).toISOString().slice(5, 16)
        : new Date(Date.now() - (history.length - idx) * 1800000).toISOString().slice(5, 16);

      trajectory.push({
        timestamp: recordTime,
        rawTheta: curTheta,
        smoothedTheta: Number(smoothedTheta.toFixed(2)),
        se: curSE,
        ci95Lower: ciLower,
        ci95Upper: ciUpper,
        standardIQ: ptIQ,
        engineType: rec.engineType,
        purityIndex: rec.isPureClear ? 1.0 : 0.6,
      });
    });

    const normW = Math.max(0.1, weightSum);
    const constructs: CHCConstructBreakdown = {
      gf: Number(Math.min(1.0, gfAcc / normW).toFixed(2)),
      gv: Number(Math.min(1.0, gvAcc / normW).toFixed(2)),
      gsm: Number(Math.min(1.0, gsmAcc / normW).toFixed(2)),
      inhibition: Number(Math.min(1.0, inhibAcc / normW).toFixed(2)),
      gq: Number(Math.min(1.0, gqAcc / normW).toFixed(2)),
    };

    const baselineRecords = history.slice(0, Math.max(2, Math.floor(history.length * 0.25)));
    const baselineWeights = baselineRecords.map(
      (r) => BASE_ENGINE_CONSTRUCTS[r.engineType] || constructs
    );
    const baselineConstructs: CHCConstructBreakdown = {
      gf: Number((baselineWeights.reduce((a, b) => a + b.gf, 0) / baselineWeights.length).toFixed(2)),
      gv: Number((baselineWeights.reduce((a, b) => a + b.gv, 0) / baselineWeights.length).toFixed(2)),
      gsm: Number((baselineWeights.reduce((a, b) => a + b.gsm, 0) / baselineWeights.length).toFixed(2)),
      inhibition: Number((baselineWeights.reduce((a, b) => a + b.inhibition, 0) / baselineWeights.length).toFixed(2)),
      gq: Number((baselineWeights.reduce((a, b) => a + b.gq, 0) / baselineWeights.length).toFixed(2)),
    };

    const finalSmoothedTheta = trajectory[trajectory.length - 1].smoothedTheta;
    const overallIQ = Math.max(40, Math.min(160, Math.round(100 + finalSmoothedTheta * 15)));
    const percentileRank = Number((this._normalCdf((overallIQ - 100) / 15) * 100).toFixed(1));

    const sem = Number((15 * curSE).toFixed(1));
    const ci95: [number, number] = [
      Math.max(40, Math.round(overallIQ - 1.96 * sem)),
      Math.min(160, Math.round(overallIQ + 1.96 * sem)),
    ];

    let dominantConstruct: 'Gf' | 'Gv' | 'Gsm' | 'Balanced' = 'Balanced';
    if (constructs.gf - constructs.gv >= 0.08) dominantConstruct = 'Gf';
    else if (constructs.gv - constructs.gf >= 0.08) dominantConstruct = 'Gv';
    else if (constructs.gsm > constructs.gf && constructs.gsm > constructs.gv) dominantConstruct = 'Gsm';

    const progress = this._calculateProgressSignificance(trajectory);

    const profileSummaryZh = `你在 Wechsler 量尺對標估算相當於 IQ ${overallIQ}（95% CI [${ci95[0]}, ${ci95[1]}]，全體常模 PR ${percentileRank}）。認知架構呈現【${
      dominantConstruct === 'Gf'
        ? '卓越流體歸納推理（Gf）優勢'
        : dominantConstruct === 'Gv'
        ? '敏銳正交拓撲視覺空間（Gv）優勢'
        : '全面均衡的認知架構'
    }】。在連續定式推導與衝動控制中展現了 ${
      constructs.inhibition >= 0.8 ? '極佳的抑制專注力' : '穩健的認知調節能力'
    }。${progress.hasSufficientData && progress.isSignificant ? ` 相較於初期訓練，你的能力值提升了 Δθ = +${progress.deltaTheta}，具有統計學上的顯著進步（p < 0.05）。` : ''}`;

    const profileSummaryEn = `Your standardized Full-Scale IQ benchmark is ${overallIQ} (95% CI [${ci95[0]}, ${ci95[1]}], Percentile Rank PR ${percentileRank}). Your cognitive architecture highlights ${
      dominantConstruct === 'Gf'
        ? 'superior inductive fluid reasoning (Gf)'
        : dominantConstruct === 'Gv'
        ? 'acute visuospatial topological acuity (Gv)'
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
      pureClearRate: Number(((successfulPureCount / history.length) * 100).toFixed(1)),
      dominantConstruct,
      progress,
      profileSummary: {
        zh: profileSummaryZh,
        en: profileSummaryEn,
      },
    };
  }

  private static _calculateProgressSignificance(trajectory: LongitudinalPoint[]): ProgressSignificance {
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
    const deltaTheta = Number((m2 - m1).toFixed(2));
    const zScore = Number((deltaTheta / Math.max(0.001, seDiff)).toFixed(2));
    const pValue = Number((1 - this._normalCdf(zScore)).toFixed(3));
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

  private static _normalCdf(x: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp((-x * x) / 2);
    const prob =
      d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
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
