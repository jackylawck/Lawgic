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
  ci95: [number, number];   // 95% 信賴區間 [下限, 上限]
  sem: number;              // 測量標準誤 (Standard Error of Measurement)
}

export class DynamicNormEngine {
  private static cohortNorms: Record<string, DynamicNormCohort> = {
    '12-17': { cohortId: '12-17', meanIQ: 100.0, sdIQ: 15.0, flynnAnnualDrift: 0.15, lastUpdatedYear: 2026, sampleSize: 1200 },
    '18-29': { cohortId: '18-29', meanIQ: 102.0, sdIQ: 15.1, flynnAnnualDrift: 0.10, lastUpdatedYear: 2026, sampleSize: 4500 },
    '30-49': { cohortId: '30-49', meanIQ: 100.8, sdIQ: 15.3, flynnAnnualDrift: 0.05, lastUpdatedYear: 2026, sampleSize: 3800 },
    '50+':   { cohortId: '50+',   meanIQ: 98.2,  sdIQ: 15.8, flynnAnnualDrift: -0.05, lastUpdatedYear: 2026, sampleSize: 1600 },
  };

  /**
   * 允許動態注入或更新世代常模（支援自適應本地校準）
   */
  public static registerCohort(cohort: DynamicNormCohort): void {
    this.cohortNorms[cohort.cohortId] = { ...cohort };
  }

  /**
   * 動態弗林效應校正與年齡分層常模轉換
   * @param rawTheta IRT 潛在特質值 (-3.5 ~ +3.5)
   * @param ageGroup 年齡分層標籤
   * @param thetaSe IRT 估計標準誤 (預設 0.28)
   */
  public static calculateDynamicNormedIQ(
    rawTheta: number,
    ageGroup: string = '18-29',
    thetaSe: number = 0.28
  ): NormedIQResult {
    const currentYear = new Date().getFullYear();
    const cohort = this.cohortNorms[ageGroup] || this.cohortNorms['18-29'];

    // 邊界防禦夾取
    const boundedTheta = Math.max(-3.5, Math.min(3.5, rawTheta));

    // 1. 累計弗林效應漂移
    const elapsedYears = Math.max(0, currentYear - cohort.lastUpdatedYear);
    const flynnAdjustment = Number((elapsedYears * cohort.flynnAnnualDrift).toFixed(2));

    // 2. 轉換為連續標準分（保留高精確度，最後再四捨五入）
    const exactRawScore = cohort.meanIQ + boundedTheta * cohort.sdIQ;
    const exactAdjusted = exactRawScore - flynnAdjustment;

    // 3. 計算測量標準誤與 95% 信賴區間
    const sem = Number((thetaSe * cohort.sdIQ).toFixed(1));
    const ciLower = Math.max(40, Math.round(exactAdjusted - 1.96 * sem));
    const ciUpper = Math.min(160, Math.round(exactAdjusted + 1.96 * sem));

    // 4. 計算 Z-Score 與分層百分位
    const zScore = Number(((exactAdjusted - cohort.meanIQ) / cohort.sdIQ).toFixed(2));
    const percentile = Number((this._normalCdf(zScore) * 100).toFixed(1));

    const finalAdjustedIQ = Math.max(40, Math.min(160, Math.round(exactAdjusted)));

    return {
      rawIQ: Math.round(exactRawScore),
      adjustedIQ: finalAdjustedIQ,
      percentile: Math.max(0.1, Math.min(99.9, percentile)),
      flynnAdjustment,
      zScore,
      ci95: [ciLower, ciUpper],
      sem,
    };
  }

  /**
   * 四角分割 (Shikaku) CHC 狹義能力映射
   * 採用高敏感度動態響應模型，拉大高低水準之間的區隔度
   */
  public static extractShikakuNarrowAbilities(params: {
    pureRatio: number;          // 純粹定式推理覆蓋率 (0.0 ~ 1.0)
    factorEntropyAvg: number;   // 候選矩形熵值 (0.0 ~ 4.0)
    timeEfficiency: number;     // 時間達成率 (0.0 ~ 1.0)
    conflictCount?: number;     // 空間衝突重疊次數
    backtrackCount?: number;    // 假設回溯深度/次數
  }): CHCNarrowAbilities {
    const { pureRatio, factorEntropyAvg, timeEfficiency, conflictCount = 0, backtrackCount = 0 } = params;

    // 1. 歸納推理 (I): 依賴純邏輯推導覆蓋率（非線性強化高階純邏輯推導）
    const rawI = Math.pow(Math.max(0, Math.min(1, pureRatio)), 1.2);

    // 2. 演繹序列推導 (RG): 結合時間效能與低衝突度
    const executionFluidity = Math.max(0, Math.min(1, timeEfficiency)) * Math.exp(-0.15 * conflictCount);
    const rawRG = 0.2 + 0.8 * executionFluidity;

    // 3. 空間心像旋轉 (Vz): 面對高熵幾何時的形狀建構力
    const normalizedEntropy = Math.max(0, Math.min(1, factorEntropyAvg / 3.5));
    const rawVz = 0.15 + 0.85 * (1.0 - 0.5 * normalizedEntropy);

    // 4. 空間相鄰排他 (SR): 隨衝突次數呈指數懲罰，懲罰更具心理學真實性
    const rawSR = Math.max(0.05, 0.98 * Math.exp(-0.25 * conflictCount));

    // 5. 工作記憶廣度 (MS): 回溯次數反映假設驗證的認知負載
    const rawMS = Math.max(0.05, 0.95 * Math.exp(-0.30 * backtrackCount));

    // 6. 數學因數運算 (A3): 考驗因數分解與面積除法能力
    const rawA3 = 0.1 + 0.9 * Math.min(1.0, factorEntropyAvg / 2.8);

    const clamp = (v: number) => Number(Math.max(0.05, Math.min(1.0, v)).toFixed(2));

    return {
      I: clamp(rawI),
      RG: clamp(rawRG),
      Vz: clamp(rawVz),
      SR: clamp(rawSR),
      MS: clamp(rawMS),
      A3: clamp(rawA3),
    };
  }

  /**
   * 標準常態分佈累積分佈函數 (CDF)
   */
  private static _normalCdf(x: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp((-x * x) / 2);
    const prob =
      d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
  }
}
