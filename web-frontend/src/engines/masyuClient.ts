// web-frontend/src/engines/masyuClient.ts
import { TierKey, PuzzleEntity, MasyuCoreEngine, DynamicFlowTuning, TIER_SPECS } from './masyuCore';

interface PlayerTelemetry {
  tier: TierKey;
  timeSpentSec: number;
  expectedTimeSec: number;
  undoCount: number;
  hintCount: number;
}

export class MasyuReservoirManager {
  private static instance: MasyuReservoirManager;
  private worker: Worker | null = null;
  private memoryQueues: Map<TierKey, PuzzleEntity[]> = new Map();
  private isBatchProducing: Map<TierKey, boolean> = new Map();

  private userThetaEstimate: number = 0.0;
  private historyTelemetry: PlayerTelemetry[] = [];

  private readonly BASE_RESERVE = 3;
  private readonly BURST_RESERVE = 8;

  private constructor() {
    const tiers: TierKey[] = ['kids', 'intermediate', 'expert', 'master', 'legendary', 'ultimate'];
    tiers.forEach((t) => {
      this.memoryQueues.set(t, []);
      this.isBatchProducing.set(t, false);
    });

    if (typeof window !== 'undefined' && window.Worker) {
      this.worker = new Worker(new URL('../workers/masyu.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ status: string; type: string; tier?: TierKey; puzzle?: PuzzleEntity; puzzles?: PuzzleEntity[] }>) => {
        if (e.data.status === 'ok') {
          if (e.data.type === 'single' && e.data.puzzle) {
            this.memoryQueues.get(e.data.puzzle.tier)!.push(e.data.puzzle);
          } else if (e.data.type === 'batch' && e.data.tier && e.data.puzzles) {
            this.memoryQueues.get(e.data.tier)!.push(...e.data.puzzles);
            this.isBatchProducing.set(e.data.tier, false);
          }
        }
      };

      tiers.forEach((t) => this.dispatchRefill(t, this.BASE_RESERVE));
    }
  }

  public static getInstance(): MasyuReservoirManager {
    if (!this.instance) this.instance = new MasyuReservoirManager();
    return this.instance;
  }

  public reportTelemetry(telemetry: PlayerTelemetry): void {
    this.historyTelemetry.push(telemetry);
    if (this.historyTelemetry.length > 8) this.historyTelemetry.shift();

    const speedRatio = telemetry.timeSpentSec / Math.max(1, telemetry.expectedTimeSec);
    let delta = 0;

    if (speedRatio < 0.65 && telemetry.hintCount === 0) {
      delta = +0.25;
    } else if (speedRatio > 1.35 || telemetry.hintCount >= 2 || telemetry.undoCount >= 6) {
      delta = -0.20;
    }

    this.userThetaEstimate = Math.max(-1.0, Math.min(1.0, this.userThetaEstimate * 0.7 + delta * 0.3));

    if (Math.abs(delta) >= 0.2) {
      this.memoryQueues.set(telemetry.tier, []);
      this.dispatchRefill(telemetry.tier, this.BASE_RESERVE);
    }
  }

  private calculateFlowTuning(tier: TierKey): DynamicFlowTuning {
    const baseConfig = TIER_SPECS[tier];
    let clueAdj = 0;
    let lookaheadAdj = 0;

    if (this.userThetaEstimate > 0.2) {
      clueAdj = -0.02;
      lookaheadAdj = +1;
    } else if (this.userThetaEstimate < -0.2) {
      clueAdj = +0.02;
      lookaheadAdj = -1;
    }

    return {
      userThetaDelta: this.userThetaEstimate,
      targetMaxClueRatio: Math.max(0.08, baseConfig.targetMaxClueRatio + clueAdj),
      lookaheadDepth: Math.max(1, baseConfig.lookaheadDepth + lookaheadAdj),
    };
  }

  private dispatchRefill(tier: TierKey, count: number): void {
    if (!this.worker) return;
    this.isBatchProducing.set(tier, true);
    const flowTuning = this.calculateFlowTuning(tier);

    this.worker.postMessage({
      action: 'produce_batch',
      tier,
      batchSize: Math.max(2, count),
      flowTuning,
    });
  }

  public async getOrProduce(tier: TierKey, designatedSeed?: number): Promise<PuzzleEntity> {
    if (designatedSeed !== undefined) {
      return MasyuCoreEngine.produceSinglePuzzle(tier, designatedSeed, this.calculateFlowTuning(tier));
    }

    const q = this.memoryQueues.get(tier)!;
    if (q.length < this.BASE_RESERVE && !this.isBatchProducing.get(tier)) {
      this.dispatchRefill(tier, this.BASE_RESERVE);
    }

    if (q.length > 0) {
      return q.shift()!;
    }

    return MasyuCoreEngine.produceSinglePuzzle(tier, undefined, this.calculateFlowTuning(tier));
  }
}
