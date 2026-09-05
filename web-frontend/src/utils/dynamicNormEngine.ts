// web-frontend/src/utils/dynamicNormEngine.ts

export interface CHCNarrowAbilities {
  I: number;   // Induction (Gf - 歸納推理)
  RG: number;  // General Sequential Reasoning (Gf - 演繹序列推導)
  Vz: number;  // Visualization (Gv - 空間心像旋轉)
  SR: number;  // Spatial Relations (Gv - 空間相鄰排他)
  MS: number;  // Memory Span (Gsm - 邊界工作記憶廣度)
  A3: number;  // Math Reasoning (Gq - 因數分解數量運算)
}

export interface DynamicNormCohort {
  cohortId: string;
  meanIQ: number;
  sdIQ: number;
  flynnAnnualDrift: number; // 世代年化漂移補償量
  lastUpdatedYear: number;
  sampleSize: number;
}

export interface NormedIQResult {
  rawIQ: number;
  adjustedIQ: number;
  percentile: number;
  flynnAdjustment: number;
  zScore: number;
}

export class DynamicNormEngine {
  // 建立動態世代常模庫（對齊現代心理學跨年漂移數據）
  private static cohortNorms: Record<string, DynamicNormCohort> = {
    '12-17': { cohortId: '12-17', meanIQ: 100.0, sdIQ: 15.0, flynnAnnualDrift: 0.15, lastUpdatedYear: 2026, sampleSize: 1200 },
    '18-29': { cohortId: '18-29', meanIQ: 102.0, sdIQ: 15.1, flynnAnnualDrift: 0.10, lastUpdatedYear: 2026, sampleSize: 4500 },
    '30-49': { cohortId: '30-49', meanIQ: 100.8, sdIQ: 15.3, flynnAnnualDrift: 0.05, lastUpdatedYear: 2026, sampleSize: 3800 },
    '50+':   { cohortId: '50+',   meanIQ: 98.2,  sdIQ: 15.8, flynnAnnualDrift: -0.05, lastUpdatedYear: 2026, sampleSize: 1600 },
  };

  /**
   * 動態弗林效應校正與年齡分層常模轉換
   * @param rawTheta 試題反應理論 (IRT) 潛在特質值 (-3.5 ~ +3.5)
   * @param ageGroup 年齡分層標籤
   */
  public static calculateDynamicNormedIQ(
    rawTheta: number,
    ageGroup: string = '18-29'
  ): NormedIQResult {
    const currentYear = new Date().getFullYear();
    const cohort = this.cohortNorms[ageGroup] || this.cohortNorms['18-29'];

    // 限制 Theta 邊界，杜絕無效異常值
    const boundedTheta = Math.max(-3.5, Math.min(3.5, rawTheta));

    // 1. 計算該世代自基準年以來的累計弗林效應漂移
    const elapsedYears = Math.max(0, currentYear - cohort.lastUpdatedYear);
    const flynnAdjustment = Number((elapsedYears * cohort.flynnAnnualDrift).toFixed(2));

    // 2. 基於世代常模的分數轉換：標準分 = CohortMean + Theta * CohortSD
    const rawCohortScore = cohort.meanIQ + boundedTheta * cohort.sdIQ;

    // 3. 扣除時間膨脹效應，並夾取至臨床 Wechsler 標準量表有效範疇 (40 ~ 160)
    const rawAdjusted = rawCohortScore - flynnAdjustment;
    const adjustedIQ = Math.max(40, Math.min(160, Math.round(rawAdjusted)));

    // 4. 計算常模 Z 分數與分層百分位 (Percentile Rank)
    const zScore = Number(((adjustedIQ - cohort.meanIQ) / cohort.sdIQ).toFixed(2));
    const percentile = Number((this._normalCdf(zScore) * 100).toFixed(1));

    return {
      rawIQ: Math.round(rawCohortScore),
      adjustedIQ,
      percentile: Math.max(0.1, Math.min(99.9, percentile)),
      flynnAdjustment,
      zScore,
    };
  }

  /**
   * 四角分割 (Shikaku) 動態映射至 CHC 狹義能力 (Stratum I)
   * 移除寫死常數，將衝突次數與回溯深度真實納入模型
   */
  public static extractShikakuNarrowAbilities(params: {
    pureRatio: number;         // 純粹定式覆蓋率 (0~1)
    factorEntropyAvg: number;  // 矩形因數熵/選擇分歧度 (0~4)
    timeEfficiency: number;    // 時間達成率 (0~1)
    conflictCount?: number;    // 幾何交疊衝突次數
    backtrackCount?: number;   // 假設回溯次數
  }): CHCNarrowAbilities {
    const { pureRatio, factorEntropyAvg, timeEfficiency, conflictCount = 0, backtrackCount = 0 } = params;

    // 空間排他性 (SR): 隨衝突懲罰動態遞減
    const conflictPenalty = Math.min(0.4, conflictCount * 0.08);
    const srScore = Math.max(0.2, 0.95 - conflictPenalty);

    // 工作記憶廣度 (MS): 隨回溯假設負載動態衰減
    const memoryOverhead = Math.min(0.35, backtrackCount * 0.07);
    const msScore = Math.max(0.2, 0.90 - memoryOverhead);

    return {
      I: Number(Math.max(0.1, Math.min(1.0, 0.45 + pureRatio * 0.50)).toFixed(2)),
      RG: Number(Math.max(0.1, Math.min(1.0, 0.35 + timeEfficiency * 0.55)).toFixed(2)),
      Vz: Number(Math.max(0.1, Math.min(1.0, 0.50 + (1 - Math.min(4, factorEntropyAvg) / 4) * 0.45)).toFixed(2)),
      SR: Number(srScore.toFixed(2)),
      MS: Number(msScore.toFixed(2)),
      A3: Number(Math.max(0.1, Math.min(1.0, 0.40 + (Math.min(3, factorEntropyAvg) / 3) * 0.55)).toFixed(2)),
    };
  }

  private static _normalCdf(x: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp((-x * x) / 2);
    const prob =
      d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
  }
}
