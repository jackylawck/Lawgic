// web-frontend/src/utils/itemBankCalibrator.ts

export interface EmpiricalItem {
  puzzleId: string;
  engineType: string;
  theoreticalB: number;   // 初步理論因數熵推導值
  empiricalB: number;     // 經過受試者大數據校準後的真實難度
  discriminationA: number;// 試題區分度 a
  stepThresholds: number[];// 部分得分模型 (PCM) 步階閾值
  sampleN: number;        // 已施測樣本數
}

export class ItemBankCalibrator {
  private static itemCache: Map<string, EmpiricalItem> = new Map();

  /**
   * 獲取或註冊題目，若無歷史實測則以理論推導值作為先驗
   */
  public static getCalibratedItem(puzzleId: string, engineType: string, theoryB: number): EmpiricalItem {
    if (this.itemCache.has(puzzleId)) {
      return this.itemCache.get(puzzleId)!;
    }

    const defaultItem: EmpiricalItem = {
      puzzleId,
      engineType,
      theoreticalB: theoryB,
      empiricalB: theoryB, // 初始以先驗難度為準
      discriminationA: 1.35,
      // 劃分為 3 個認知層級閾值：0-40% 探索, 40-80% 拓撲收斂, 80-100% 完整鋪砌
      stepThresholds: [theoryB - 0.7, theoryB, theoryB + 0.6],
      sampleN: 1,
    };
    this.itemCache.set(puzzleId, defaultItem);
    return defaultItem;
  }

  /**
   * 在線貝氏更新題目難度參數 (Online Bayesian Item Calibration)
   * 隨著玩家群體作答不斷自我修正 b 參數
   */
  public static updateEmpiricalDifficulty(
    puzzleId: string,
    userTheta: number,
    partialCredit: number // 0.0 ~ 1.0 (PCM 實際得分比)
  ) {
    const item = this.itemCache.get(puzzleId);
    if (!item) return;

    // 依據受試者能力 theta 與部分得分，反向修正題目難度 b
    const expectedScore = 1 / (1 + Math.exp(-item.discriminationA * (userTheta - item.empiricalB)));
    const residual = partialCredit - expectedScore;

    // 學習率隨施測樣本數增加而收斂
    const learningRate = Math.max(0.04, 0.4 / Math.sqrt(item.sampleN));
    item.empiricalB = Number((item.empiricalB - learningRate * residual).toFixed(3));
    item.sampleN += 1;
  }

  /**
   * 等級反應模型 (Samejima's GRM) 資訊量精算
   */
  public static getItemInformation(theta: number, item: EmpiricalItem): number {
    const a = item.discriminationA;
    let totalInfo = 0;
    for (const threshold of item.stepThresholds) {
      const p = 1 / (1 + Math.exp(-a * (theta - threshold)));
      totalInfo += a * a * p * (1 - p);
    }
    return Number(totalInfo.toFixed(3));
  }
}
