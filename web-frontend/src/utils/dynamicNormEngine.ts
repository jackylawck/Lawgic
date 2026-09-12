// web-frontend/src/utils/dynamicNormEngine.ts

export interface CHCNarrowAbilities {
  readonly I: number;   // Induction (Gf - 歸納推理)
  readonly RG: number;  // General Sequential Reasoning (Gf - 演繹序列推導)
  readonly Vz: number;  // Visualization (Gv - 空間心像旋轉)
  readonly SR: number;  // Spatial Relations (Gv - 空間相鄰排他)
  readonly MS: number;  // Memory Span (Gsm - 邊界工作記憶廣度)
  readonly A3: number;  // Math Reasoning (Gq - 因數分解數量運算)
}

export interface DynamicNormCohort {
  readonly cohortId: string;
  readonly meanIQ: number;
  readonly sdIQ: number;
  /**
   * 世代年化漂移補償量 (IQ 點/年)
   * - 正值 (Flynn Effect)：族群基準逐年上升。當代受試者的原始分數需「下修」，
   *   因其絕對表現對應到更高的世代基準——不修正將高估 IQ。
   * - 負值 (Reverse Flynn Effect)：特定族群呈現退化趨勢，需向上補償。
   */
  readonly flynnAnnualDrift: number;
  readonly lastUpdatedYear: number;
  readonly sampleSize: number;
}

export interface NormedIQResult {
  /** 原始常模映射分數 (未經年代漂移校正) */
  readonly rawIQ: number;
  /** 年代漂移校正後分數 (截斷至計量極限 [40, 160]) */
  readonly adjustedIQ: number;
  /** 
   * 分層常態累積分佈百分位 (0.1 ~ 99.9)
   * ⚠️ 設計決策：截斷至 [0.1, 99.9] 屬於產品顯示層級防禦，避免極端 Z-score 輸出極小雜訊 (如 0.0000287%)。
   * 這與 ci95 保持無偏統計推論的策略有所不同。
   */
  readonly percentile: number;
  /** 累計年代補償扣除值 */
  readonly flynnAdjustment: number;
  /** 基於校正後分數的標準化 Z 分數 */
  readonly zScore: number;
  /**
   * 統計真實 95% 信賴區間 [下限, 上限]
   * ⚠️ 依據真實 SEM 計算，不進行硬性人工截斷，保證覆蓋率統計語意真實
   */
  readonly ci95: readonly [number, number];
  /** 測量標準誤 (Standard Error of Measurement, SEM = thetaSe * sdIQ) */
  readonly sem: number;
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
   * 
   * @param rawTheta IRT 潛在特質估計值 (-3.5 ~ +3.5)
   * @param ageGroup 年齡分層標籤 (預設 '18-29')
   * @param thetaSe IRT 估計標準誤 (預設 0.28)
   * @param referenceYear 評估基準年份 (預設當前年份，支援注入以進行回溯回放測試)
   */
  public static calculateDynamicNormedIQ(
    rawTheta: number,
    ageGroup: string = '18-29',
    thetaSe: number = 0.28,
    referenceYear: number = new Date().getFullYear()
  ): NormedIQResult {
    const cohort = this.cohortNorms[ageGroup] ?? this.cohortNorms['18-29'];

    // 邊界防禦夾取潛在特質值
    const boundedTheta = Math.max(-3.5, Math.min(3.5, rawTheta));

    // 1. 累計弗林效應漂移計算
    // 計量原理：當代受試者若使用歷史常模，因群體素質提升，原始得分必須下修漂移量，否則將高估其當前能力
    const elapsedYears = Math.max(0, referenceYear - cohort.lastUpdatedYear);
    const flynnAdjustment = Number((elapsedYears * cohort.flynnAnnualDrift).toFixed(2));

    // 2. 轉換為連續標準分（保留高精確度，最後再四捨五入）
    const exactRawScore = cohort.meanIQ + boundedTheta * cohort.sdIQ;
    const exactAdjusted = exactRawScore - flynnAdjustment;

    // 3. 計算測量標準誤與 95% 信賴區間（不截斷，保護統計顯著性判斷真實度）
    const sem = Number((thetaSe * cohort.sdIQ).toFixed(1));
    const ciLower = Math.round(exactAdjusted - 1.96 * sem);
    const ciUpper = Math.round(exactAdjusted + 1.96 * sem);

    // 4. 計算 Z-Score 與分層百分位 (基於校正後分數)
    const zScore = Number(((exactAdjusted - cohort.meanIQ) / cohort.sdIQ).toFixed(2));
    const rawPercentile = Number((this._normalCdf(zScore) * 100).toFixed(1));

    // 產品呈現端：IQ 分數規範至 [40, 160]，百分位截斷至 [0.1, 99.9] 防極端雜訊
    const finalAdjustedIQ = Math.max(40, Math.min(160, Math.round(exactAdjusted)));
    const displayPercentile = Math.max(0.1, Math.min(99.9, rawPercentile));

    return {
      rawIQ: Math.round(exactRawScore),
      adjustedIQ: finalAdjustedIQ,
      percentile: displayPercentile,
      flynnAdjustment,
      zScore,
      ci95: [ciLower, ciUpper],
      sem,
    };
  }

  /**
   * 四角分割 (Shikaku) CHC 狹義能力映射
   * 
   * ⚠️ 設計決策與邊界聲明：
   * 本映射架構為「啟發式動態響應模型」，其非線性指數與係數（如 1.2、0.25、0.30 等）
   * 旨在放大遊戲盤面內各維度微操作的相對區隔度（Discriminability），非直接等同臨床智力測驗常模。
   */
  public static extractShikakuNarrowAbilities(params: {
    readonly pureRatio: number;          // 純粹定式推理覆蓋率 (0.0 ~ 1.0)
    readonly factorEntropyAvg: number;   // 候選矩形熵值 (0.0 ~ 4.0)
    readonly timeEfficiency: number;     // 時間達成率 (0.0 ~ 1.0)
    readonly conflictCount?: number;     // 空間衝突重疊次數
    readonly backtrackCount?: number;    // 假設回溯深度/次數
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

    // 4. 空間相鄰排他 (SR): 隨衝突次數呈指數懲罰
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
   * 標準常態累積分佈函數 (CDF)
   * 
   * ⚠️ 實作說明：
   * 採用 Abramowitz-Stegun 26.2.17 多項式近似，理論最大絕對誤差 < 7.5e-8。
   * 完全滿足常模百分位（精確至小數點後一位）之業務要求。
   */
  private static _normalCdf(x: number): number {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp((-x * x) / 2);
    const prob =
      d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
  }
}
