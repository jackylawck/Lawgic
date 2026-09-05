// web-frontend/src/utils/clinicalProctoring.ts

export interface MouseTrajectoryPoint {
  x: number;
  y: number;
  t: number; // 毫秒相對時間
  type: 'move' | 'down' | 'up' | 'drag';
}

export interface ProctoringTelemetry {
  screenPhysicalEstimate: {
    devicePixelRatio: number;
    viewportWidth: number;
    viewportHeight: number;
    dpiEstimated: number;
    fovNormalizedScale: number; // 歸一化視野縮放因子
  };
  behavioralMetrics: {
    totalFixationPauseMs: number; // 決策停頓總時長（工作記憶思考時間）
    trajectoryJitterRate: number; // 游標微抖動率（生理焦慮/非腳本自然軌跡）
    anomalousStraightMoves: number; // 機械直線移動（自動化腳本作弊偵測）
    tabBlurEvents: number; // 切屏次數
  };
  integrityDigest: string;
}

export class ClinicalProctoringTracker {
  private trajectory: MouseTrajectoryPoint[] = [];
  private lastTime: number = Date.now();
  private blurCount: number = 0;
  private startTime: number = Date.now();
  private straightMovesCount: number = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this._handleBlur);
    }
  }

  private _handleBlur = () => {
    this.blurCount++;
  };

  public recordPointer(x: number, y: number, type: 'move' | 'down' | 'up' | 'drag') {
    const now = Date.now();
    const relTime = now - this.startTime;

    if (this.trajectory.length >= 2) {
      const p1 = this.trajectory[this.trajectory.length - 2];
      const p2 = this.trajectory[this.trajectory.length - 1];
      // 檢測是否為完美數學直線移動（外掛腳本特徵）
      const d1 = (p2.y - p1.y) * (x - p2.x);
      const d2 = (y - p2.y) * (p2.x - p1.x);
      if (Math.abs(d1 - d2) < 0.001 && Math.abs(x - p1.x) > 10) {
        this.straightMovesCount++;
      }
    }

    // 取樣保留最多 1200 個高價值點位
    if (this.trajectory.length < 1200) {
      this.trajectory.push({ x, y, t: relTime, type });
    }
  }

  public getNormalizedFOVScale(): number {
    if (typeof window === 'undefined') return 1.0;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    // 基準為標準 1080p (1920x1080 @ 1.0 DPR)
    const effectiveDiagonal = Math.sqrt(w * w + h * h) * dpr;
    const standardDiagonal = Math.sqrt(1920 * 1920 + 1080 * 1080);
    return Number((standardDiagonal / Math.max(720, effectiveDiagonal)).toFixed(2));
  }

  public finalizeTelemetry(puzzleId: string): ProctoringTelemetry {
    let fixationTime = 0;
    let jitterDeviations = 0;

    for (let i = 1; i < this.trajectory.length; i++) {
      const dt = this.trajectory[i].t - this.trajectory[i - 1].t;
      if (dt > 700) {
        fixationTime += dt; // 停頓思考超過 700ms 記為決策固定時間
      }
      const dx = Math.abs(this.trajectory[i].x - this.trajectory[i - 1].x);
      const dy = Math.abs(this.trajectory[i].y - this.trajectory[i - 1].y);
      if (dt < 40 && (dx > 0 || dy > 0)) {
        jitterDeviations++;
      }
    }

    const payload = `${puzzleId}|FOV_${this.getNormalizedFOVScale()}|BLUR_${this.blurCount}|JIT_${jitterDeviations}`;
    return {
      screenPhysicalEstimate: {
        devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1920,
        viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 1080,
        dpiEstimated: 96 * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
        fovNormalizedScale: this.getNormalizedFOVScale(),
      },
      behavioralMetrics: {
        totalFixationPauseMs: fixationTime,
        trajectoryJitterRate: Number((jitterDeviations / Math.max(1, this.trajectory.length)).toFixed(3)),
        anomalousStraightMoves: this.straightMovesCount,
        tabBlurEvents: this.blurCount,
      },
      integrityDigest: `PROC_${btoa(payload).slice(0, 20)}`,
    };
  }

  public destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this._handleBlur);
    }
  }
}
