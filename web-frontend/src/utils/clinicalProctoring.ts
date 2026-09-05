// web-frontend/src/utils/clinicalProctoring.ts

export interface MouseTrajectoryPoint {
  x: number;
  y: number;
  t: number; // 亞毫秒級高精度相對時間 (performance.now)
  type: 'move' | 'down' | 'up' | 'drag';
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
  };
  integrityDigest: string;
}

export class ClinicalProctoringTracker {
  private trajectory: MouseTrajectoryPoint[] = [];
  private blurCount: number = 0;
  private straightMovesCount: number = 0;
  
  private readonly startPerfTime: number;
  private lastSampleTime: number = 0;
  
  // 輕量級雜湊函數 (DJB2) 用於生成防篡改指紋
  private generateSyncHash(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    return (hash >>> 0).toString(16).toUpperCase();
  }

  constructor() {
    this.startPerfTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this._handleBlur);
    }
  }

  private _handleBlur = () => {
    this.blurCount++;
  };

  public recordPointer(x: number, y: number, type: 'move' | 'down' | 'up' | 'drag') {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const relTime = now - this.startPerfTime;

    // 採樣節流 (Throttling): 移動時最高 40Hz (25ms) 採樣率，減少記憶體崩潰
    // 點擊與釋放 (down/up) 則強制記錄以確保關鍵決策點不遺漏
    if (type === 'move' || type === 'drag') {
      if (now - this.lastSampleTime < 25) return; 
    }
    this.lastSampleTime = now;

    if (this.trajectory.length >= 2) {
      const p1 = this.trajectory[this.trajectory.length - 2];
      const p2 = this.trajectory[this.trajectory.length - 1];
      
      // 腳本防弊優化：檢查較長距離的移動是否呈現異常完美的直線
      // 排除了微小移動的噪聲誤判
      const dist1 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const dist2 = Math.hypot(x - p2.x, y - p2.y);
      
      if (dist1 > 20 && dist2 > 20) {
        const d1 = (p2.y - p1.y) * (x - p2.x);
        const d2 = (y - p2.y) * (p2.x - p1.x);
        if (Math.abs(d1 - d2) < 0.5) { 
          this.straightMovesCount++;
        }
      }
    }

    // 採樣保留最多 3000 個高價值點位 (相當於連續劇烈移動 75 秒的濃縮精華)
    if (this.trajectory.length < 3000) {
      this.trajectory.push({ x: Math.round(x), y: Math.round(y), t: Number(relTime.toFixed(1)), type });
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

    for (let i = 1; i < this.trajectory.length; i++) {
      const dt = this.trajectory[i].t - this.trajectory[i - 1].t;
      if (dt > 700) {
        // 停頓思考超過 700ms 記為決策凝視 (Fixation Pause)
        fixationTime += dt; 
      }
      
      const dx = Math.abs(this.trajectory[i].x - this.trajectory[i - 1].x);
      const dy = Math.abs(this.trajectory[i].y - this.trajectory[i - 1].y);
      
      // 檢測極短時間內的微幅抖動 (生理震顫特徵)
      if (dt < 40 && (dx > 0 && dx < 5) && (dy > 0 && dy < 5)) {
        jitterDeviations++;
      }
    }

    const fovScale = this.getNormalizedFOVScale();
    const jitterRate = Number((jitterDeviations / Math.max(1, this.trajectory.length)).toFixed(4));
    
    // 生成混淆特徵與單向雜湊，防止玩家直接竄改 Payload
    const rawPayload = `${puzzleId}|FOV:${fovScale}|BLUR:${this.blurCount}|JIT:${jitterRate}|DUR:${Math.round(fixationTime)}`;
    const digest = `PROC_V2_${this.generateSyncHash(rawPayload)}`;

    return {
      screenPhysicalEstimate: {
        devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1920,
        viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 1080,
        dpiEstimated: 96 * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
        fovNormalizedScale: fovScale,
      },
      behavioralMetrics: {
        totalFixationPauseMs: Math.round(fixationTime),
        trajectoryJitterRate: jitterRate,
        anomalousStraightMoves: this.straightMovesCount,
        tabBlurEvents: this.blurCount,
      },
      integrityDigest: digest,
    };
  }

  public destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this._handleBlur);
    }
    this.trajectory = [];
  }
}
