// web-frontend/src/utils/itemBankCalibrator.ts

export interface EmpiricalItem {
  puzzleId: string;
  engineType: string;
  theoreticalB: number;     // 初始理論先驗難度
  empiricalB: number;       // 動態校準後的難度位置參數 (Location b)
  discriminationA: number;  // 區分度參數 a (預設 1.2 ~ 1.5)
  stepThresholds: number[]; // 各類別轉換步階閾值 (Thresholds d_k)
  sampleN: number;          // 累積施測樣本數
  lastCalibratedAt: string;
}

const STORAGE_KEY = 'LOGICORE_CALIBRATED_ITEM_BANK';

export class ItemBankCalibrator {
  private static itemCache: Map<string, EmpiricalItem> = new Map();
  private static isInitialized = false;

  private static ensureInitialized() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          Object.entries(parsed).forEach(([id, item]) => {
            this.itemCache.set(id, item as EmpiricalItem);
          });
        }
      }
    } catch (e) {
      console.warn('[ItemBankCalibrator] Failed to hydrate cache from storage', e);
    }
  }

  private static persistCache() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const serialized: Record<string, EmpiricalItem> = {};
        this.itemCache.forEach((item, id) => {
          serialized[id] = item;
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
      }
    } catch {}
  }

  /**
   * 取得或初始化註冊題目
   */
  public static getCalibratedItem(puzzleId: string, engineType: string, theoryB: number): EmpiricalItem {
    this.ensureInitialized();
    const clampedTheory = Math.max(-3.0, Math.min(3.0, theoryB));

    if (this.itemCache.has(puzzleId)) {
      return this.itemCache.get(puzzleId)!;
    }

    const defaultItem: EmpiricalItem = {
      puzzleId,
      engineType,
      theoreticalB: Number(clampedTheory.toFixed(2)),
      empiricalB: Number(clampedTheory.toFixed(2)),
      discriminationA: 1.35,
      // 3 個步階代表 4 個認知反應層級：0:探索, 1:局部佈局, 2:拓撲閉合, 3:完整通關
      stepThresholds: [
        Number((clampedTheory - 0.75).toFixed(2)),
        Number(clampedTheory.toFixed(2)),
        Number((clampedTheory + 0.65).toFixed(2)),
      ],
      sampleN: 1,
      lastCalibratedAt: new Date().toISOString(),
    };

    this.itemCache.set(puzzleId, defaultItem);
    this.persistCache();
    return defaultItem;
  }

  /**
   * 在線隨機梯度/貝氏題目難度校準 (Online Stochastic Calibration)
   * 難度更新時同步平移類別閾值
   */
  public static updateEmpiricalDifficulty(
    puzzleId: string,
    userTheta: number,
    partialCredit: number // 0.0 ~ 1.0 (連續部分計分或等級分比例)
  ) {
    this.ensureInitialized();
    const item = this.itemCache.get(puzzleId);
    if (!item) return;

    const clampedCredit = Math.max(0, Math.min(1, partialCredit));
    const clampedTheta = Math.max(-3.5, Math.min(3.5, userTheta));

    // 計算邏輯斯諦期望得分
    const a = item.discriminationA;
    const expectedScore = 1 / (1 + Math.exp(-a * (clampedTheta - item.empiricalB)));
    const residual = clampedCredit - expectedScore;

    // 自適應收斂學習率 (Robbins-Monro 條件)
    const learningRate = Math.max(0.02, 0.45 / Math.sqrt(item.sampleN + 5));
    const deltaB = learningRate * residual;

    const oldB = item.empiricalB;
    const newB = Math.max(-3.5, Math.min(3.5, oldB - deltaB));
    const shift = newB - oldB;

    item.empiricalB = Number(newB.toFixed(3));
    // 關鍵修復：題目整體難度遷移時，步階閾值同步平移
    item.stepThresholds = item.stepThresholds.map((th) => Number((th + shift).toFixed(3)));
    item.sampleN += 1;
    item.lastCalibratedAt = new Date().toISOString();

    this.persistCache();
  }

  /**
   * 部分得分模型 (PCM) 精確 Fisher 資訊量計算
   * I(theta) = a^2 * [ Var(Score) ] = a^2 * ( sum(k^2 * P_k) - [sum(k * P_k)]^2 )
   */
  public static getItemInformation(theta: number, item: EmpiricalItem): number {
    const a = item.discriminationA;
    const thresholds = item.stepThresholds;
    const m = thresholds.length; // 步階數 (此處為 3，代表 0, 1, 2, 3 共 4 個等級)

    // 計算非標準化分子項
    const numerators: number[] = [1.0]; // k = 0
    let cumulativeSum = 0;

    for (let k = 1; k <= m; k++) {
      cumulativeSum += a * (theta - thresholds[k - 1]);
      numerators.push(Math.exp(Math.max(-20, Math.min(20, cumulativeSum))));
    }

    const denominator = numerators.reduce((acc, val) => acc + val, 0);
    const probs = numerators.map((v) => v / denominator);

    // 計算預期值 E(X) 與 E(X^2)
    let expectedX = 0;
    let expectedX2 = 0;

    for (let k = 0; k <= m; k++) {
      expectedX += k * probs[k];
      expectedX2 += k * k * probs[k];
    }

    // 多項類別反應模型之 Fisher 資訊量 = a^2 * Var(X)
    const variance = expectedX2 - expectedX * expectedX;
    const info = a * a * Math.max(0.001, variance);

    return Number(info.toFixed(3));
  }
}
