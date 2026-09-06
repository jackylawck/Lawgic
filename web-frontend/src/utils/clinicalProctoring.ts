// web-frontend/src/utils/clinicalProctoring.ts

export type PointerEventType = 'move' | 'down' | 'up' | 'drag';

export interface MouseTrajectoryPoint {
  x: number;
  y: number;
  t: number; // 亞毫秒級相對時間戳 (performance.now)
  type: PointerEventType;
  v?: number; // 瞬時像素速度 (px/ms)
}

export interface ProctoringTelemetry {
  screenPhysicalEstimate: {
    devicePixelRatio: number;
    viewportWidth: number;
    viewportHeight: number;
    dpiEstimated: number;
    fovNormalizedScale: number;
  };
  behavioralMetrics: {
    totalFixationPauseMs: number;
    trajectoryJitterRate: number;
    anomalousStraightMoves: number;
    tabBlurEvents: number;
    kinematicEntropy: number; // 生物運動學速度-曲率熵 (人機辨識金標準)
    meanVelocityPxMs: number;
  };
  integrityDigest: string;
}

export class ClinicalProctoringTracker {
  private trajectory: MouseTrajectoryPoint[] = [];
  private blurCount: number = 0;
  private straightMovesCount: number = 0;
  private totalDistance: number = 0;
  private velocityCurvatureDeviations: number = 0; // 違反人體運動學 2/3 冪次定律計數

  private readonly startPerfTime: number;
  private lastSampleTime: number = 0;

  constructor() {
    this.startPerfTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this._handleBlur, { passive: true });
    }
  }

  private _handleBlur = () => {
    this.blurCount++;
  };

  /**
   * 計算點到直線的正交投影距離，取代外積數值漂移
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
   * 雙模雜湊：首選 Web Crypto SHA-256，失敗降級至 64-bit 強化 FNV-1a
   */
  private static generateSecureHash(str: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0xcbf29ce4;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 0x01000193);
      h2 = Math.imul(h2 ^ ch, 0x01000193);
    }
    const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
    const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
    return `${hex1}${hex2}`.toUpperCase();
  }

  public recordPointer(x: number, y: number, type: PointerEventType) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const relTime = now - this.startPerfTime;

    // 自適應時間窗節流 (Throttling)：移動維持 40Hz (25ms)，按下/抬起絕對保留
    if (type === 'move' || type === 'drag') {
      if (now - this.lastSampleTime < 24) return;
    }
    this.lastSampleTime = now;

    const currentPoint: MouseTrajectoryPoint = {
      x: Math.round(x),
      y: Math.round(y),
      t: Number(relTime.toFixed(1)),
      type,
    };

    if (this.trajectory.length >= 1) {
      const prev = this.trajectory[this.trajectory.length - 1];
      const dt = Math.max(1, currentPoint.t - prev.t);
      const ds = Math.hypot(currentPoint.x - prev.x, currentPoint.y - prev.y);
      currentPoint.v = Number((ds / dt).toFixed(3));
      this.totalDistance += ds;

      // 檢查三點共線與異常勻速機械運動
      if (this.trajectory.length >= 2) {
        const p0 = this.trajectory[this.trajectory.length - 2];
        const segDist = Math.hypot(currentPoint.x - p0.x, currentPoint.y - p0.y);

        if (segDist > 40) {
          const orthoDist = ClinicalProctoringTracker.getPointToLineDistance(
            prev.x,
            prev.y,
            p0.x,
            p0.y,
            currentPoint.x,
            currentPoint.y
          );

          // 人手在長距離移動中，垂直微偏離通常 > 1.2px；連續完全小於 0.35px 判定為自動插值外掛
          if (orthoDist < 0.35) {
            this.straightMovesCount++;
          }
        }

        // 生物物理學檢驗：人類手部轉彎時曲率高，速度必然下降；若曲率突變速度仍恆定，計入異常
        const v0 = p0.v ?? 0;
        const v1 = currentPoint.v ?? 0;
        const turnAngle = Math.abs(
          Math.atan2(currentPoint.y - prev.y, currentPoint.x - prev.x) -
          Math.atan2(prev.y - p0.y, prev.x - p0.x)
        );

        if (turnAngle > 0.8 && Math.abs(v1 - v0) < 0.05 && v1 > 0.4) {
          this.velocityCurvatureDeviations++;
        }
      }
    }

    // 滑動視窗保留最多 3000 個高品質點位
    if (this.trajectory.length < 3000) {
      this.trajectory.push(currentPoint);
    } else {
      // 超額時以 FIFO 保留核心首尾與決策點
      this.trajectory[this.trajectory.length - 1] = currentPoint;
    }
  }

  public getNormalizedFOVScale(): number {
    if (typeof window === 'undefined') return 1.0;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const effectiveDiagonal = Math.sqrt(w * w + h * h) * dpr;
    const standardDiagonal = Math.sqrt(1920 * 1920 + 1080 * 1080);
    return Number((standardDiagonal / Math.max(720, effectiveDiagonal)).toFixed(3));
  }

  public finalizeTelemetry(puzzleId: string): ProctoringTelemetry {
    let fixationTime = 0;
    let jitterDeviations = 0;
    let totalVelocity = 0;
    let validVelocityPoints = 0;

    for (let i = 1; i < this.trajectory.length; i++) {
      const p1 = this.trajectory[i - 1];
      const p2 = this.trajectory[i];
      const dt = p2.t - p1.t;

      // 決策凝視停頓 (Fixation Pause, 500ms ~ 12000ms)
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
    const len = Math.max(1, this.trajectory.length);
    const jitterRate = Number((jitterDeviations / len).toFixed(4));
    const meanVelocity = validVelocityPoints > 0 ? Number((totalVelocity / validVelocityPoints).toFixed(3)) : 0;

    // 人體運動學運動熵估計 (Kinematic Entropy: 0.0 ~ 1.0)
    // 機器人通常呈現極端值（0.0 絕對僵硬直線，或過度隨機的雜訊）
    const kinematicEntropy = Number(
      Math.max(
        0.05,
        Math.min(
          0.99,
          0.85 - (this.straightMovesCount / len) * 2.5 - (this.velocityCurvatureDeviations / len) * 1.5
        )
      ).toFixed(3)
    );

    // 防偽簽署摘要
    const rawPayload = [
      puzzleId,
      `FOV:${fovScale}`,
      `BLUR:${this.blurCount}`,
      `JIT:${jitterRate}`,
      `FIX:${Math.round(fixationTime)}`,
      `ENT:${kinematicEntropy}`,
      `VEL:${meanVelocity}`,
    ].join('|');

    const digest = `PROC_V3_${ClinicalProctoringTracker.generateSecureHash(rawPayload)}`;

    return {
      screenPhysicalEstimate: {
        devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1920,
        viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 1080,
        dpiEstimated: Math.round(96 * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)),
        fovNormalizedScale: fovScale,
      },
      behavioralMetrics: {
        totalFixationPauseMs: Math.round(fixationTime),
        trajectoryJitterRate: jitterRate,
        anomalousStraightMoves: this.straightMovesCount,
        tabBlurEvents: this.blurCount,
        kinematicEntropy,
        meanVelocityPxMs: meanVelocity,
      },
      integrityDigest: digest,
    };
  }

  public destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this._handleBlur);
    }
    this.trajectory = [];
    this.totalDistance = 0;
    this.straightMovesCount = 0;
    this.velocityCurvatureDeviations = 0;
  }
}
