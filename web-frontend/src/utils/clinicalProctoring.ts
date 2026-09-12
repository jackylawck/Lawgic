// web-frontend/src/utils/clinicalProctoring.ts

export type PointerEventType = 'move' | 'down' | 'up' | 'drag';

export interface MouseTrajectoryPoint {
  readonly x: number;
  readonly y: number;
  readonly t: number; // 亞毫秒級相對時間戳 (performance.now 或自訂時鐘)
  readonly type: PointerEventType;
  readonly v?: number; // 瞬時像素速度 (px/ms)
}

export interface ProctoringTelemetry {
  readonly screenPhysicalEstimate: {
    readonly devicePixelRatio: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    /** CSS 像素密度估計 (96 * DPR)，非真實螢幕硬體物理 DPI */
    readonly cssPixelDensityEstimate: number;
    readonly fovNormalizedScale: number;
  };
  readonly behavioralMetrics: {
    readonly totalFixationPauseMs: number;
    readonly trajectoryJitterRate: number;
    readonly anomalousStraightMoves: number;
    readonly tabBlurEvents: number;
    /** 啟發式人體運動學分數 (Heuristic Kinematic Score)，非嚴格 Shannon 運動熵 */
    readonly kinematicEntropy: number;
    readonly meanVelocityPxMs: number;
    /** 採樣週期內累計位移像素量 (用於軌跡效率比計算) */
    readonly totalDistancePx: number;
  };
  /** 客戶端非加密確定性校驗摘要，僅用於傳輸損壞與關聯 ID，不具防篡改能力 */
  readonly integrityDigest: string;
}

/**
 * 臨床級行為遠測追蹤器 (Clinical Proctoring Tracker)
 * 
 * ⚠️ 安全與架構邊界說明：
 * 1. 本模組所有產出僅代表「客戶端採樣特徵」，不具備端到端不可否認性（Non-repudiation）。
 * 2. 嚴禁在無伺服器重放校驗的情況下，單純依賴本模組的 `integrityDigest` 判定作弊。
 * 3. 賽事結算應以服務端接收之原始軌跡重放、HMAC 簽章與模型特徵評估為準。
 * 4. 支援時鐘依賴注入 (Dependency Injection)，便於高並發單元測試精確控制採樣節流與環形緩衝。
 */
export class ClinicalProctoringTracker {
  private static readonly MAX_TRAJECTORY = 3000;
  private static readonly SAMPLING_INTERVAL_MS = 24; // ~40Hz 節流
  private static readonly REFERENCE_DIAGONAL = Math.sqrt(1920 * 1920 + 1080 * 1080); // 基準視窗 1080p

  private readonly clock: () => number;

  private trajectory: MouseTrajectoryPoint[] = [];
  private trajectoryHead: number = 0; // 環形緩衝區覆寫游標
  private isBufferFull: boolean = false;

  private blurCount: number = 0;
  private straightMovesCount: number = 0;
  private totalDistance: number = 0;
  private velocityCurvatureDeviations: number = 0; // 違反人體運動學 2/3 冪次定律計數

  private readonly startPerfTime: number;
  private lastSampleTime: number = 0;

  constructor(
    clock: () => number = () =>
      typeof performance !== 'undefined' ? performance.now() : Date.now()
  ) {
    this.clock = clock;
    this.startPerfTime = this.clock();
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this._handleBlur, { passive: true });
    }
  }

  private _handleBlur = () => {
    this.blurCount++;
  };

  /**
   * 計算點到直線的正交投影距離，避免斜率外積數值漂移
   */
  private static getPointToLineDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const lineLen = Math.hypot(x2 - x1, y2 - y1);
    if (lineLen < 0.001) return 0;
    return Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1) / lineLen;
  }

  /**
   * 64-bit 確定性 FNV-1a 校驗摘要
   * ⚠️ 非密碼學安全雜湊，不具備防篡改能力，僅用於傳輸完整性檢查與唯一識別派生。
   */
  private static computeDeterministicDigest(str: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0xcbf29ce4;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 0x01000193);
      h2 = Math.imul(h2 ^ ch, 0x01000193);
    }
    const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
    const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
    return `FNV_${hex1}${hex2}`.toUpperCase();
  }

  /**
   * 取得最後一個有效記錄點（考慮環形緩衝區邊界）
   */
  private getLastPoint(): MouseTrajectoryPoint | undefined {
    if (this.trajectory.length === 0) return undefined;
    if (!this.isBufferFull) {
      return this.trajectory[this.trajectory.length - 1];
    }
    const lastIndex =
      (this.trajectoryHead - 1 + ClinicalProctoringTracker.MAX_TRAJECTORY) %
      ClinicalProctoringTracker.MAX_TRAJECTORY;
    return this.trajectory[lastIndex];
  }

  /**
   * 取得倒數第二個有效記錄點
   */
  private getSecondLastPoint(): MouseTrajectoryPoint | undefined {
    if (this.trajectory.length < 2) return undefined;
    if (!this.isBufferFull) {
      return this.trajectory[this.trajectory.length - 2];
    }
    const secondLastIndex =
      (this.trajectoryHead - 2 + ClinicalProctoringTracker.MAX_TRAJECTORY) %
      ClinicalProctoringTracker.MAX_TRAJECTORY;
    return this.trajectory[secondLastIndex];
  }

  public recordPointer(x: number, y: number, type: PointerEventType): void {
    const now = this.clock();
    const relTime = now - this.startPerfTime;

    /**
     * 設計決策：所有事件類型（包含 down / up）無條件更新 lastSampleTime。
     * 這意味著 down / up 等關鍵決策點會主動重置連續 move 事件的節流視窗，
     * 確保使用者「按下後立即拖曳」或「鬆開前最後微調」的起筆特徵完整保留。
     */
    if (type === 'move' || type === 'drag') {
      if (now - this.lastSampleTime < ClinicalProctoringTracker.SAMPLING_INTERVAL_MS) return;
    }
    this.lastSampleTime = now;

    let instantaneousVelocity: number | undefined;
    const prev = this.getLastPoint();

    if (prev !== undefined) {
      const dt = Math.max(1, relTime - prev.t);
      const ds = Math.hypot(x - prev.x, y - prev.y);
      instantaneousVelocity = Number((ds / dt).toFixed(3));
      this.totalDistance += ds;

      const p0 = this.getSecondLastPoint();
      if (p0 !== undefined) {
        const segDist = Math.hypot(x - p0.x, y - p0.y);

        // 人手在長距離移動中，垂直微偏離通常 > 1.2px；連續完全小於 0.35px 判定為自動線性插值
        if (segDist > 40) {
          const orthoDist = ClinicalProctoringTracker.getPointToLineDistance(
            prev.x,
            prev.y,
            p0.x,
            p0.y,
            x,
            y
          );
          if (orthoDist < 0.35) {
            this.straightMovesCount++;
          }
        }

        // 人體運動學檢查：手部大曲率轉彎時速度必然驟降；曲率突變速度仍恆定則計入異常
        const v0 = p0.v ?? 0;
        const v1 = instantaneousVelocity;
        const turnAngle = Math.abs(
          Math.atan2(y - prev.y, x - prev.x) -
          Math.atan2(prev.y - p0.y, prev.x - p0.x)
        );

        if (turnAngle > 0.8 && Math.abs(v1 - v0) < 0.05 && v1 > 0.4) {
          this.velocityCurvatureDeviations++;
        }
      }
    }

    const currentPoint: MouseTrajectoryPoint = {
      x: Math.round(x),
      y: Math.round(y),
      t: Number(relTime.toFixed(1)),
      type,
      v: instantaneousVelocity,
    };

    // 環形緩衝區 (Ring Buffer)，保證超過 3000 點時持續無延遲覆寫最新視窗
    if (!this.isBufferFull) {
      this.trajectory.push(currentPoint);
      if (this.trajectory.length >= ClinicalProctoringTracker.MAX_TRAJECTORY) {
        this.isBufferFull = true;
      }
    } else {
      this.trajectory[this.trajectoryHead] = currentPoint;
      this.trajectoryHead = (this.trajectoryHead + 1) % ClinicalProctoringTracker.MAX_TRAJECTORY;
    }
  }

  /**
   * 視野歸一化係數（相對於 1920×1080 標準桌機畫布）
   * ⚠️ 僅作為 UI 渲染尺度歸一化參考，不代表跨硬體絕對物理視角
   */
  public getNormalizedFOVScale(): number {
    if (typeof window === 'undefined') return 1.0;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const effectiveDiagonal = Math.sqrt(w * w + h * h) * dpr;
    return Number(
      (ClinicalProctoringTracker.REFERENCE_DIAGONAL / Math.max(720, effectiveDiagonal)).toFixed(3)
    );
  }

  /**
   * 產出行為遙測報告（具備唯讀冪等性，不破壞內部緩衝區狀態）
   */
  public finalizeTelemetry(puzzleId: string): ProctoringTelemetry {
    let fixationTime = 0;
    let jitterDeviations = 0;
    let totalVelocity = 0;
    let validVelocityPoints = 0;

    const totalPoints = this.trajectory.length;

    // 按時間拓撲順序遍歷環形緩衝區，杜絕跨界時間戳錯亂
    for (let step = 1; step < totalPoints; step++) {
      const idx1 = this.isBufferFull
        ? (this.trajectoryHead + step - 1) % ClinicalProctoringTracker.MAX_TRAJECTORY
        : step - 1;
      const idx2 = this.isBufferFull
        ? (this.trajectoryHead + step) % ClinicalProctoringTracker.MAX_TRAJECTORY
        : step;

      const p1 = this.trajectory[idx1];
      const p2 = this.trajectory[idx2];
      const dt = p2.t - p1.t;

      // 決策停頓 (500ms ~ 12000ms)
      if (dt >= 500 && dt <= 12000) {
        fixationTime += dt;
      }

      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);

      // 生理微震顫 (Tremor Jitter: 15~60ms 內 1~4px 微顫)
      if (dt >= 15 && dt <= 60 && dx >= 1 && dx <= 4 && dy >= 1 && dy <= 4) {
        jitterDeviations++;
      }

      if (p2.v !== undefined) {
        totalVelocity += p2.v;
        validVelocityPoints++;
      }
    }

    const fovScale = this.getNormalizedFOVScale();
    const sampleCount = Math.max(1, totalPoints);
    const jitterRate = Number((jitterDeviations / sampleCount).toFixed(4));
    const meanVelocity = validVelocityPoints > 0 ? Number((totalVelocity / validVelocityPoints).toFixed(3)) : 0;
    const roundedDistance = Math.round(this.totalDistance);

    /**
     * 啟發式人體運動分數 (Heuristic Kinematic Score: 0.05 ~ 0.99)
     * ⚠️ 設計決策：此為經驗啟發式評分，尚未經大規模人體實驗標定。權重主要用於捕捉「完全直線插值」或「異常平滑」
     */
    const kinematicEntropy = Number(
      Math.max(
        0.05,
        Math.min(
          0.99,
          0.85 -
            (this.straightMovesCount / sampleCount) * 2.5 -
            (this.velocityCurvatureDeviations / sampleCount) * 1.5
        )
      ).toFixed(3)
    );

    const rawPayload = [
      puzzleId,
      `FOV:${fovScale}`,
      `BLUR:${this.blurCount}`,
      `JIT:${jitterRate}`,
      `FIX:${Math.round(fixationTime)}`,
      `ENT:${kinematicEntropy}`,
      `VEL:${meanVelocity}`,
      `DST:${roundedDistance}`,
    ].join('|');

    const digest = `PROC_V3_${ClinicalProctoringTracker.computeDeterministicDigest(rawPayload)}`;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    return {
      screenPhysicalEstimate: {
        devicePixelRatio: dpr,
        viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1920,
        viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 1080,
        cssPixelDensityEstimate: Math.round(96 * dpr),
        fovNormalizedScale: fovScale,
      },
      behavioralMetrics: {
        totalFixationPauseMs: Math.round(fixationTime),
        trajectoryJitterRate: jitterRate,
        anomalousStraightMoves: this.straightMovesCount,
        tabBlurEvents: this.blurCount,
        kinematicEntropy,
        meanVelocityPxMs: meanVelocity,
        totalDistancePx: roundedDistance,
      },
      integrityDigest: digest,
    };
  }

  /**
   * 徹底釋放監聽並重置內部所有計數狀態
   */
  public destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this._handleBlur);
    }
    this.trajectory = [];
    this.trajectoryHead = 0;
    this.isBufferFull = false;
    this.totalDistance = 0;
    this.straightMovesCount = 0;
    this.velocityCurvatureDeviations = 0;
    this.blurCount = 0;
    this.lastSampleTime = 0;
  }
}
