// web-frontend/src/utils/clinicalProctoring.ts
export interface TelemetrySummary {
  integrityDigest: string;
  totalEvents: number;
}

export class ClinicalProctoringTracker {
  private events: Array<{ x: number; y: number; type: string; t: number }> = [];

  public recordPointer(clientX: number, clientY: number, type: 'down' | 'drag' | 'up') {
    this.events.push({ x: clientX, y: clientY, type, t: Date.now() });
  }

  public finalizeTelemetry(puzzleId: string): TelemetrySummary {
    const raw = `${puzzleId}_${this.events.length}_${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0;
    }
    return {
      integrityDigest: Math.abs(hash).toString(16).padStart(8, '0'),
      totalEvents: this.events.length,
    };
  }

  public destroy() {
    this.events = [];
  }
}
