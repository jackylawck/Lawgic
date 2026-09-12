import init, { SudokuEngine, InitOutput } from './sudoku_wasm';

export interface PerformanceTelemetry {
  readonly operation: string;
  readonly elapsedMs: number;
  readonly timestamp: number;
}

export type SetCellResult =
  | { status: 'ok' }
  | { status: 'rejected'; reason: 'conflict' | 'immutable' | 'out-of-bounds' }
  | { status: 'crashed'; error: Error };

export class SudokuWasmBridge {
  private engine: SudokuEngine;
  private wasmExports: InitOutput;
  private rawPtr: number;
  private isDestroyed = false;
  private static onTelemetry?: (data: PerformanceTelemetry) => void;

  private constructor(engine: SudokuEngine, wasmExports: InitOutput) {
    this.engine = engine;
    this.wasmExports = wasmExports;
    this.rawPtr = engine.get_cells_ptr();
  }

  public static setTelemetryHandler(handler?: (data: PerformanceTelemetry) => void): void {
    this.onTelemetry = handler;
  }

  public static async create(clues: Uint8Array): Promise<SudokuWasmBridge> {
    const t0 = performance.now();
    const wasmExports = await init();
    this.emitTelemetry('wasm_init', performance.now() - t0);

    const t1 = performance.now();
    const engine = new SudokuEngine(clues);
    this.emitTelemetry('initial_propagate', performance.now() - t1);

    const t2 = performance.now();
    // 直接呼叫 engine，避免經過 bridge.verifySolutionCount() 引發重複 emitTelemetry
    const count = engine.verify_solution_count();
    const elapsedVerification = performance.now() - t2;
    this.emitTelemetry('verify_solution_count_on_load', elapsedVerification);

    if (count !== 1) {
      engine.free();
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(
          '/api/puzzle-integrity-violation',
          JSON.stringify({ solutionCount: count, clues: Array.from(clues), timestamp: Date.now() })
        );
      }
      throw new Error(`PUZZLE_INTEGRITY_VIOLATION: Expected exactly 1 solution, but found ${count}`);
    }

    return new SudokuWasmBridge(engine, wasmExports);
  }

  private static emitTelemetry(operation: string, elapsedMs: number): void {
    if (this.onTelemetry) {
      this.onTelemetry({ operation, elapsedMs, timestamp: Date.now() });
    }
    if (import.meta.env.DEV && elapsedMs > 50) {
      console.warn(`[WASM-TELEMETRY] ${operation} exceeded budget: ${elapsedMs.toFixed(2)}ms`);
    }
  }

  public getCandidatesView(): Uint16Array {
    if (this.isDestroyed) {
      throw new Error('SudokuWasmBridge: Attempted to access candidates view after destruction');
    }
    return new Uint16Array(this.wasmExports.memory.buffer, this.rawPtr, 81);
  }

  public setCellValue(idx: number, val: number): SetCellResult {
    if (this.isDestroyed) {
      return { status: 'crashed', error: new Error('Bridge already destroyed') };
    }
    const t0 = performance.now();
    try {
      const ok = this.engine.set_cell_value(idx, val);
      SudokuWasmBridge.emitTelemetry('set_cell_value', performance.now() - t0);
      return ok ? { status: 'ok' } : { status: 'rejected', reason: 'conflict' };
    } catch (err) {
      return { status: 'crashed', error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  public isFullyDeduced(): boolean {
    if (this.isDestroyed) return false;
    return this.engine.is_fully_deduced();
  }

  public getUnsolvedCount(): number {
    if (this.isDestroyed) return 81;
    return this.engine.get_unsolved_count();
  }

  public verifySolutionCount(): number {
    if (this.isDestroyed) return 0;
    const t0 = performance.now();
    const count = this.engine.verify_solution_count();
    SudokuWasmBridge.emitTelemetry('verify_solution_count', performance.now() - t0);
    return count;
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.engine.free();
    this.isDestroyed = true;
  }
}
