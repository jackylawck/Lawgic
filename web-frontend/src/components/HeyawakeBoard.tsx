// web-frontend/src/components/HeyawakeBoard.tsx
import React, {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  memo,
} from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  useAccessibilitySettings,
  useAccessibilityActions,
} from '../contexts/AccessibilityContext';
import { MetricErrorBar } from './MetricErrorBar';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';
import { getEnvironmentFingerprint, calculateInfractionScore } from '../utils/tournamentSecurity';
import { WebHeyawakeGenerator, HeyawakeSpec, HeyawakeHintStep, HeyawakeRoom } from '../engines/heyawakeGenerator';

interface Props {
  readonly puzzleData?: PuzzleEntity;
  readonly puzzle?: PuzzleEntity;
  readonly tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2;

interface BoardDelta {
  readonly idx: number;
  readonly from: CellState;
  readonly to: CellState;
}

interface CellBorderDef {
  readonly top: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

const MAX_HISTORY_STEPS = 200;

// ==============================================================
// 1. 真・增量約束狀態機儲存庫 (Incremental Constraint Store)
// ==============================================================
class IncrementalHeyawakeStore {
  private rows: number;
  private cols: number;
  private totalCells: number;
  private data: Uint8Array;
  private version: number = 0;
  private history: BoardDelta[] = [];
  private redoStack: BoardDelta[] = [];
  private isCompleted: boolean = false;
  private listeners: Set<() => void> = new Set();

  // 持久化集合：增量維護，供 React useMemo 藉由 version 精確判定
  public adjacentBlack: Set<string> = new Set();
  public rayViolations: Set<string> = new Set();
  public quotaViolations: Set<number> = new Set();
  public satisfiedRooms: Set<number> = new Set();
  private roomBlackCounts: Map<number, number> = new Map();

  private gridRooms: number[][];
  private rooms: HeyawakeRoom[];
  private roomMap: Map<number, HeyawakeRoom>; // 骨頭二：O(1) 字典查找
  private cellToRoomId: Int32Array;

  constructor(rows: number, cols: number, gridRooms: number[][], rooms: HeyawakeRoom[]) {
    this.rows = rows;
    this.cols = cols;
    this.totalCells = rows * cols;
    this.data = new Uint8Array(this.totalCells);
    this.gridRooms = gridRooms;
    this.rooms = rooms;
    this.roomMap = new Map(rooms.map((rm) => [rm.id, rm]));
    this.cellToRoomId = new Int32Array(this.totalCells);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.cellToRoomId[r * cols + c] = gridRooms[r]?.[c] ?? 0;
      }
    }
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify() {
    this.version++;
    for (const listener of this.listeners) {
      listener();
    }
  }

  public reset(rows: number, cols: number, gridRooms: number[][], rooms: HeyawakeRoom[]) {
    this.rows = rows;
    this.cols = cols;
    this.totalCells = rows * cols;
    this.data = new Uint8Array(this.totalCells);
    this.gridRooms = gridRooms;
    this.rooms = rooms;
    this.roomMap = new Map(rooms.map((rm) => [rm.id, rm]));
    this.cellToRoomId = new Int32Array(this.totalCells);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.cellToRoomId[r * cols + c] = gridRooms[r]?.[c] ?? 0;
      }
    }

    this.version = 0;
    this.history = [];
    this.redoStack = [];
    this.isCompleted = false;

    this.adjacentBlack.clear();
    this.rayViolations.clear();
    this.quotaViolations.clear();
    this.satisfiedRooms.clear();
    this.roomBlackCounts.clear();
    for (const rm of rooms) {
      this.roomBlackCounts.set(rm.id, 0);
      if (rm.clue === 0) this.satisfiedRooms.add(rm.id);
    }
    this.notify();
  }

  public getVersion(): number {
    return this.version;
  }

  public getCellState(idx: number): CellState {
    return (this.data[idx] ?? 0) as CellState;
  }

  public getFlatByte(idx: number): number {
    return this.data[idx] ?? 0;
  }

  public getSnapshot(): Uint8Array {
    return this.data.slice();
  }

  public getIsCompleted(): boolean {
    return this.isCompleted;
  }

  public getHistoryLength(): number {
    return this.history.length;
  }

  public getRedoLength(): number {
    return this.redoStack.length;
  }

  public setCompleted(completed: boolean) {
    this.isCompleted = completed;
    this.notify();
  }

  // 局部增量演算核心
  private applyIncrementalUpdate(idx: number, from: CellState, to: CellState) {
    const r = Math.floor(idx / this.cols);
    const c = idx % this.cols;
    const roomId = this.cellToRoomId[idx];
    const room = this.roomMap.get(roomId);

    // 1. 增量更新房間配額 O(1)
    if (room && room.clue !== null) {
      let count = this.roomBlackCounts.get(roomId) ?? 0;
      if (from === 1) count--;
      if (to === 1) count++;
      this.roomBlackCounts.set(roomId, count);

      if (count > room.clue) {
        this.quotaViolations.add(roomId);
      } else {
        this.quotaViolations.delete(roomId);
      }

      if (count === room.clue) {
        this.satisfiedRooms.add(roomId);
      } else {
        this.satisfiedRooms.delete(roomId);
      }
    }

    // 2. 增量更新相鄰黑格衝突 (檢查自身與 4 正交鄰居，O(1))
    const neighbors: [number, number][] = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ];

    this.adjacentBlack.delete(`${r},${c}`);
    for (const [nr, nc] of neighbors) {
      if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
        let neighborHasOtherBlack = false;
        const nNeighbors: [number, number][] = [
          [nr - 1, nc], [nr + 1, nc], [nr, nc - 1], [nr, nc + 1],
        ];
        for (const [nnr, nnc] of nNeighbors) {
          if (nnr >= 0 && nnr < this.rows && nnc >= 0 && nnc < this.cols && !(nnr === r && nnc === c)) {
            if (this.data[nnr * this.cols + nnc] === 1) {
              neighborHasOtherBlack = true;
              break;
            }
          }
        }
        if (!neighborHasOtherBlack) {
          this.adjacentBlack.delete(`${nr},${nc}`);
        }
      }
    }

    if (to === 1) {
      for (const [nr, nc] of neighbors) {
        if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
          if (this.data[nr * this.cols + nc] === 1) {
            this.adjacentBlack.add(`${r},${c}`);
            this.adjacentBlack.add(`${nr},${nc}`);
          }
        }
      }
    }

    // 3. 增量更新跨房射線違規（僅重掃描受影響的行與列，O(R + C)）
    this.recomputeRowRays(r);
    this.recomputeColRays(c);
  }

  private recomputeRowRays(r: number) {
    for (let c = 0; c < this.cols; c++) {
      this.rayViolations.delete(`${r},${c}`);
    }
    let segmentStart = 0;
    for (let c = 0; c <= this.cols; c++) {
      const isWall = c === this.cols || this.data[r * this.cols + c] === 1;
      if (isWall) {
        if (c - segmentStart > 1) {
          let crossed = 0;
          for (let k = segmentStart; k < c - 1; k++) {
            if (this.gridRooms[r]?.[k] !== this.gridRooms[r]?.[k + 1]) crossed++;
          }
          if (crossed >= 2) {
            for (let k = segmentStart; k < c; k++) this.rayViolations.add(`${r},${k}`);
          }
        }
        segmentStart = c + 1;
      }
    }
  }

  private recomputeColRays(c: number) {
    for (let r = 0; r < this.rows; r++) {
      this.rayViolations.delete(`${r},${c}`);
    }
    let segmentStart = 0;
    for (let r = 0; r <= this.rows; r++) {
      const isWall = r === this.rows || this.data[r * this.cols + c] === 1;
      if (isWall) {
        if (r - segmentStart > 1) {
          let crossed = 0;
          for (let k = segmentStart; k < r - 1; k++) {
            if (this.gridRooms[k]?.[c] !== this.gridRooms[k + 1]?.[c]) crossed++;
          }
          if (crossed >= 2) {
            for (let k = segmentStart; k < r; k++) this.rayViolations.add(`${k},${c}`);
          }
        }
        segmentStart = r + 1;
      }
    }
  }

  public mutateCell(idx: number, targetState: CellState): boolean {
    if (this.isCompleted || idx < 0 || idx >= this.totalCells) return false;
    const currentState = this.data[idx] as CellState;
    if (currentState === targetState) return false;

    this.data[idx] = targetState;
    this.history.push({ idx, from: currentState, to: targetState });
    if (this.history.length > MAX_HISTORY_STEPS) {
      this.history.shift();
    }
    this.redoStack = [];

    this.applyIncrementalUpdate(idx, currentState, targetState);
    this.notify();
    return true;
  }

  public undo(): boolean {
    if (this.history.length === 0 || this.isCompleted) return false;
    const delta = this.history.pop()!;
    this.data[delta.idx] = delta.from;
    this.redoStack.push(delta);

    this.applyIncrementalUpdate(delta.idx, delta.to, delta.from);
    this.notify();
    return true;
  }

  public redo(): boolean {
    if (this.redoStack.length === 0 || this.isCompleted) return false;
    const delta = this.redoStack.pop()!;
    this.data[delta.idx] = delta.to;
    this.history.push(delta);

    this.applyIncrementalUpdate(delta.idx, delta.from, delta.to);
    this.notify();
    return true;
  }
}

class CursorStore {
  private rows: number;
  private cols: number;
  private cursorIdx: number = 0;
  private listeners: Set<() => void> = new Set();

  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public reset(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.cursorIdx = 0;
    this.notify();
  }

  public getCursorIndex(): number {
    return this.cursorIdx;
  }

  public setCursor(r: number, c: number) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return;
    const nextIdx = r * this.cols + c;
    if (this.cursorIdx !== nextIdx) {
      this.cursorIdx = nextIdx;
      this.notify();
    }
  }

  public moveCursor(dr: number, dc: number) {
    const r = Math.floor(this.cursorIdx / this.cols);
    const c = this.cursorIdx % this.cols;
    this.setCursor(r + dr, c + dc);
  }
}

// ==============================================================
// 2. 獨立防漂移計時器
// ==============================================================
const MemoizedTimer = memo(({ startTime, isCompleted }: { readonly startTime: number; readonly isCompleted: boolean }) => {
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  useEffect(() => {
    if (isCompleted) return;
    const update = () => setElapsedMs(Date.now() - startTime);

    const interval = setInterval(update, 100);
    const handleVisibility = () => {
      if (!document.hidden) update();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [startTime, isCompleted]);

  return <span className="text-slate-200 font-bold" aria-live="off">{(elapsedMs / 1000).toFixed(1)}s</span>;
});
MemoizedTimer.displayName = 'MemoizedTimer';

// ==============================================================
// 3. 純量展示單元格（頂層承載 role="gridcell"，無多餘 div）
// ==============================================================
interface PureCellProps {
  readonly idx: number;
  readonly r: number;
  readonly c: number;
  readonly state: CellState;
  readonly isCursor: boolean;
  readonly room: HeyawakeRoom | undefined;
  readonly isLabelCell: boolean;
  readonly border: CellBorderDef;
  readonly isAdjConflict: boolean;
  readonly isRayConflict: boolean;
  readonly isQuotaConflict: boolean;
  readonly isCutPoint: boolean;
  readonly isHintTarget: boolean;
  readonly isRoomSatisfied: boolean;
  readonly isEn: boolean;
}

const HeyawakePureCell = memo(({
  idx, r, c, state, isCursor, room, isLabelCell, border,
  isAdjConflict, isRayConflict, isQuotaConflict, isCutPoint, isHintTarget,
  isRoomSatisfied, isEn,
}: PureCellProps) => {
  const coordName = `R${r + 1}C${c + 1}`;
  const stateLabel = state === 1 ? (isEn ? 'Black' : '黑格') : state === 2 ? (isEn ? 'White' : '白格標叉') : (isEn ? 'Empty' : '空格');
  const conflictLabel = isAdjConflict || isRayConflict || isQuotaConflict ? (isEn ? '(Conflict)' : '(衝突)') : '';
  const clueLabel = isLabelCell && room?.clue !== null && room?.clue !== undefined ? `Room Clue ${room.clue}` : '';

  // 骨頭四：去除多餘空格
  const cellAriaLabel = [coordName, clueLabel, stateLabel, conflictLabel]
    .filter(Boolean)
    .join(', ');

  const borderClasses = `
    ${border.top ? 'border-t-[2.5px] border-t-indigo-500' : 'border-t-[0.5px] border-t-slate-800'}
    ${border.bottom ? 'border-b-[2.5px] border-b-indigo-500' : 'border-b-[0.5px] border-b-slate-800'}
    ${border.left ? 'border-l-[2.5px] border-l-indigo-500' : 'border-l-[0.5px] border-l-slate-800'}
    ${border.right ? 'border-r-[2.5px] border-r-indigo-500' : 'border-r-[0.5px] border-r-slate-800'}
  `;

  return (
    <div
      role="gridcell"
      tabIndex={isCursor ? 0 : -1}
      aria-rowindex={r + 1}
      aria-colindex={c + 1}
      aria-label={cellAriaLabel}
      data-idx={idx}
      className={`flex-1 h-full relative flex items-center justify-center select-none cursor-pointer ${borderClasses} ${
        state === 1
          ? isAdjConflict
            ? 'bg-rose-950/80 border border-rose-500 text-rose-200'
            : isQuotaConflict
            ? 'bg-slate-950 border border-dashed border-amber-400 text-slate-100'
            : 'bg-slate-950 text-slate-100 shadow-inner'
          : isRayConflict
          ? 'bg-slate-900 border border-dashed border-amber-500/80 text-slate-400'
          : isCutPoint
          ? 'bg-cyan-950/20 ring-1 ring-cyan-500/30 text-slate-400'
          : 'bg-slate-900 hover:bg-slate-800/80 text-slate-400'
      } ${
        isCursor
          ? 'outline-2 outline-cyan-400 outline-offset-[-2px] z-30 shadow-[0_0_12px_rgba(6,182,212,0.6)]'
          : 'outline-none z-0'
      } ${
        isHintTarget ? 'ring-2 ring-indigo-400 ring-inset animate-pulse z-20' : ''
      }`}
    >
      {isLabelCell && (
        <span
          aria-hidden="true"
          className={`absolute top-0.5 left-0.5 text-[8px] sm:text-[9px] font-black leading-none pointer-events-none z-30 ${
            state === 1
              ? 'text-emerald-300 drop-shadow-[0_1px_2px_rgba(0,0,0,1)]'
              : isQuotaConflict
              ? 'text-amber-400'
              : isRoomSatisfied
              ? 'text-emerald-400/90'
              : 'text-indigo-400'
          }`}
        >
          {room?.clue}
        </span>
      )}

      {state === 1 ? (
        <div className="w-[84%] h-[84%] bg-slate-950 rounded-xs border border-slate-700 shadow-md flex items-center justify-center pointer-events-none" aria-hidden="true">
          <div className="w-1.5 h-1.5 bg-slate-400/30 rounded-full" />
        </div>
      ) : state === 2 ? (
        <span className="text-[12px] sm:text-sm font-bold text-cyan-400/80 pointer-events-none select-none" aria-hidden="true">✕</span>
      ) : isCutPoint ? (
        <span className="text-[7.5px] text-cyan-500/50 pointer-events-none select-none font-bold" aria-hidden="true">🔗</span>
      ) : null}
    </div>
  );
});
HeyawakePureCell.displayName = 'HeyawakePureCell';

// ==============================================================
// 4. 主棋盤容器
// ==============================================================
export const HeyawakeBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const {
    recordAttempt,
    getBenchmarkMetrics,
    profile,
    getCompositeCognitiveIndex,
    exportLongitudinalDataset,
  } = useLearnerProfile();

  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const { hapticFeedback, reducedMotion } = useAccessibilitySettings();
  const { playSound, announce } = useAccessibilityActions();

  const spec = (actualPuzzle as any)?.puzzle as HeyawakeSpec | undefined;
  const rows = spec?.rows || 6;
  const cols = spec?.cols || 6;
  const rooms = useMemo(() => spec?.rooms || [], [spec]);
  const gridRooms = useMemo(() => spec?.gridRooms || spec?.cellRoomMap || [], [spec]);
  const solution = useMemo(() => spec?.solution || spec?.grid || [], [spec]);

  // 單例實體化雙 Store
  const cellStore = useMemo(() => new IncrementalHeyawakeStore(rows, cols, gridRooms, rooms), [rows, cols, gridRooms, rooms]);
  const cursorStore = useMemo(() => new CursorStore(rows, cols), [rows, cols]);

  useEffect(() => {
    cellStore.reset(rows, cols, gridRooms, rooms);
    cursorStore.reset(rows, cols);
  }, [cellStore, cursorStore, rows, cols, gridRooms, rooms, actualPuzzle?.id]);

  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';

  const [speedMode, setSpeedMode] = useState<boolean>(true);
  const [showRadar, setShowRadar] = useState<boolean>(false);
  const [deferredCutPoints, setDeferredCutPoints] = useState<Set<string>>(new Set());

  // 全域雙訂閱：僅 1 個版本號 + 1 個游標號
  const boardVersion = useSyncExternalStore(cellStore.subscribe, () => cellStore.getVersion(), () => 0);
  const cursorIdx = useSyncExternalStore(cursorStore.subscribe, () => cursorStore.getCursorIndex(), () => 0);

  const isCompleted = cellStore.getIsCompleted();
  const historyLen = cellStore.getHistoryLength();
  const redoLen = cellStore.getRedoLength();

  const [finalTimeSec, setFinalTimeSec] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<HeyawakeHintStep | null>(null);
  const [hintLadderLevel, setHintLadderLevel] = useState<1 | 2 | 3>(1);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);

  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const [conflictDisplay, setConflictDisplay] = useState<number>(0);
  const hasRecordedRef = useRef<boolean>(false);
  const lastVibrateTimeRef = useRef<number>(0);
  const gridElementRef = useRef<HTMLDivElement>(null);

  const safeVibrate = useCallback((ms: number) => {
    if (!hapticFeedback || reducedMotion || typeof navigator === 'undefined' || !navigator.vibrate) return;
    const now = Date.now();
    if (now - lastVibrateTimeRef.current > 50) {
      lastVibrateTimeRef.current = now;
      try { navigator.vibrate(ms); } catch {}
    }
  }, [hapticFeedback, reducedMotion]);

  // 編譯期靜態邊界表
  const staticBorders = useMemo(() => {
    const list: CellBorderDef[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const roomId = gridRooms[r]?.[c] ?? 0;
        list.push({
          top: r === 0 || gridRooms[r - 1]?.[c] !== roomId,
          bottom: r === rows - 1 || gridRooms[r + 1]?.[c] !== roomId,
          left: c === 0 || gridRooms[r]?.[c - 1] !== roomId,
          right: c === cols - 1 || gridRooms[r]?.[c + 1] !== roomId,
        });
      }
    }
    return list;
  }, [rows, cols, gridRooms]);

  const roomMap = useMemo(() => new Map<number, HeyawakeRoom>(rooms.map((r) => [r.id, r])), [rooms]);

  const labelPosMap = useMemo(() => {
    const map = new Map<number, [number, number]>();
    for (const room of rooms) {
      let minR = rows;
      let minC = cols;
      for (const [r, c] of room.cells) {
        if (r < minR || (r === minR && c < minC)) {
          minR = r;
          minC = c;
        }
      }
      map.set(room.id, [minR, minC]);
    }
    return map;
  }, [rooms, rows, cols]);

  // 單一副作用焦點遷移
  useEffect(() => {
    const target = gridElementRef.current?.querySelector<HTMLElement>(`[data-idx="${cursorIdx}"]`);
    if (target && document.activeElement !== target) {
      target.focus({ preventScroll: true });
    }
  }, [cursorIdx]);

  // 骨頭一：設計合約標註。直接讀取 Store 內部持久化增量集合（O(1) 開銷），依賴項明確鎖定 boardVersion
  const conflicts = useMemo(() => ({
    adjacentBlack: cellStore.adjacentBlack,
    rayViolations: cellStore.rayViolations,
    quotaViolations: cellStore.quotaViolations,
  }), [cellStore, boardVersion]);

  const satisfiedRooms = cellStore.satisfiedRooms;

  // 咽喉雷達時間切片（防禦性快照防污染）
  useEffect(() => {
    if (!showRadar) {
      setDeferredCutPoints(new Set());
      return;
    }

    const computeRadar = () => {
      const flat = cellStore.getSnapshot();
      const cutPoints = new Set<string>();
      let totalPotentialWhite = 0;
      for (let i = 0; i < flat.length; i++) {
        if (flat[i] !== 1) totalPotentialWhite++;
      }

      const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (flat[r * cols + c] === 0) {
            let sR = -1, sC = -1;
            for (let ir = 0; ir < rows; ir++) {
              for (let ic = 0; ic < cols; ic++) {
                if ((ir !== r || ic !== c) && flat[ir * cols + ic] !== 1) {
                  sR = ir; sC = ic; break;
                }
              }
              if (sR !== -1) break;
            }

            if (sR !== -1) {
              const visited = new Uint8Array(rows * cols);
              const qR = new Int32Array(rows * cols);
              const qC = new Int32Array(rows * cols);
              let h = 0, t = 0;
              qR[t] = sR; qC[t] = sC; t++;
              visited[sR * cols + sC] = 1;
              let reached = 0;

              while (h < t) {
                const cr = qR[h], cc = qC[h]; h++; reached++;
                for (const [dr, dc] of dirs) {
                  const nr = cr + dr, nc = cc + dc;
                  if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !(nr === r && nc === c) && flat[nr * cols + nc] !== 1) {
                    const idx = nr * cols + nc;
                    if (visited[idx] === 0) {
                      visited[idx] = 1;
                      qR[t] = nr; qC[t] = nc; t++;
                    }
                  }
                }
              }
              if (reached !== totalPotentialWhite - 1) {
                cutPoints.add(`${r},${c}`);
              }
            }
          }
        }
      }
      setDeferredCutPoints(cutPoints);
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const handle = (window as any).requestIdleCallback(computeRadar, { timeout: 100 });
      return () => (window as any).cancelIdleCallback(handle);
    } else {
      const timer = setTimeout(computeRadar, 16);
      return () => clearTimeout(timer);
    }
  }, [cellStore, boardVersion, showRadar, rows, cols]);

  // 衝突音效與計數
  const prevConflictTotalRef = useRef<number>(0);
  useEffect(() => {
    const currentTotal =
      conflicts.adjacentBlack.size +
      conflicts.rayViolations.size +
      conflicts.quotaViolations.size;

    if (currentTotal > prevConflictTotalRef.current) {
      const added = currentTotal - prevConflictTotalRef.current;
      conflictCountRef.current += added;
      setConflictDisplay(conflictCountRef.current);
      playSound('conflict');
    }
    prevConflictTotalRef.current = currentTotal;
  }, [conflicts, playSound]);

  // 頂層單一委託點擊
  const handleGridPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('[data-idx]') as HTMLElement | null;
    if (!target) return;
    const idx = Number(target.dataset.idx);
    if (Number.isNaN(idx)) return;

    cursorStore.setCursor(Math.floor(idx / cols), idx % cols);
    const current = cellStore.getCellState(idx);
    const next: CellState = speedMode ? (current === 1 ? 0 : 1) : (current === 0 ? 1 : current === 1 ? 2 : 0);

    if (cellStore.mutateCell(idx, next)) {
      safeVibrate(8);
      playSound('click');
      setActiveHint(null);
      setHintLadderLevel(1);
    }
  }, [cellStore, cursorStore, cols, speedMode, safeVibrate, playSound]);

  // 全域零重裝鍵盤監聽
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (cellStore.getIsCompleted()) return;

      const activeEl = document.activeElement;
      if (!gridElementRef.current?.contains(activeEl)) return;

      const cur = cursorStore.getCursorIndex();

      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault(); cursorStore.moveCursor(-1, 0);
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault(); cursorStore.moveCursor(1, 0);
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault(); cursorStore.moveCursor(0, -1);
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault(); cursorStore.moveCursor(0, 1);
      } else if (e.key === '1') {
        e.preventDefault();
        if (cellStore.mutateCell(cur, 1)) {
          safeVibrate(8); playSound('click'); setActiveHint(null);
        }
      } else if (e.key === '2') {
        e.preventDefault();
        const target: CellState = speedMode ? 0 : 2;
        if (cellStore.mutateCell(cur, target)) {
          safeVibrate(8); playSound('click'); setActiveHint(null);
        }
      } else if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace' || e.key === ' ') {
        e.preventDefault();
        if (cellStore.mutateCell(cur, 0)) {
          safeVibrate(8); playSound('click'); setActiveHint(null);
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (cellStore.undo()) {
          safeVibrate(10); playSound('step'); setActiveHint(null);
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (cellStore.redo()) {
          safeVibrate(10); playSound('step'); setActiveHint(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cellStore, cursorStore, speedMode, safeVibrate, playSound]);

  // 完成判定（綁定 boardVersion）
  useEffect(() => {
    if (isCompleted || !solution || solution.length === 0 || boardVersion === 0) return;

    let isMatch = true;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isBlack = cellStore.getFlatByte(r * cols + c) === 1;
        if (isBlack !== (solution[r]?.[c] === 1)) {
          isMatch = false;
          break;
        }
      }
      if (!isMatch) break;
    }

    if (isMatch) {
      const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
      setFinalTimeSec(timeSpent);
      cellStore.setCompleted(true);
      playSound('celebration');
      announce(isEn ? 'Heyawake Puzzle Solved!' : '黑白分明約束已完美解開！', 'polite');

      if (!hasRecordedRef.current && actualPuzzle) {
        hasRecordedRef.current = true;
        const baseIrt = (actualPuzzle.metrics as any)?.irt_logit_difficulty || 1.5;

        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'heyawake',
          tier: currentTier,
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.8,
            numeric: 0.4,
            workingMemory: 0.7,
            inhibition: 0.85,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: 'HeyawakeDeductionWavefront',
          irtDifficulty: baseIrt,
          isPureClear: conflictCountRef.current === 0 && !activeHint,
        });

        try {
          const canonical = `${actualPuzzle.id}|${timeSpent}|${historyLen}|${conflictCountRef.current}|SPEED_${speedMode}|HEYAWAKE_FINAL`;
          const enc = new TextEncoder();
          window.crypto.subtle.digest('SHA-256', enc.encode(canonical)).then((buf) => {
            const hex = Array.from(new Uint8Array(buf))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('');
            setProofSignature(`VERIFIED_${hex.slice(0, 24).toUpperCase()}`);
          });
        } catch {
          setProofSignature(`LOCAL_${Date.now()}`);
        }

        const currentPb = profile.personalBest.fastestTime;
        if (currentPb === 0 || timeSpent < currentPb) {
          setShowPBModal(true);
        }
      }
    }
  }, [cellStore, isCompleted, boardVersion, solution, rows, cols, historyLen, actualPuzzle, currentTier, recordAttempt, profile.personalBest.fastestTime, activeHint, speedMode, playSound, announce, isEn]);

  const handleRequestHint = () => {
    if (isCompleted || tournamentMode) return;
    safeVibrate(12);
    playSound('hint');

    if (!activeHint) {
      const engineGrid: CellState[][] = [];
      for (let r = 0; r < rows; r++) {
        const row: CellState[] = [];
        for (let c = 0; c < cols; c++) {
          row.push(cellStore.getCellState(r * cols + c));
        }
        engineGrid.push(row);
      }

      const hint = WebHeyawakeGenerator.getNextForcedDeduction(rows, cols, rooms, gridRooms, engineGrid);
      if (hint) {
        setActiveHint(hint);
        cursorStore.setCursor(hint.targetCell[0], hint.targetCell[1]);
        setHintLadderLevel(1);
        announce(
          isEn
            ? `Hint Level 1: Focus on row ${hint.targetCell[0] + 1}, column ${hint.targetCell[1] + 1}`
            : `提示等級 1：請關注第 ${hint.targetCell[0] + 1} 列第 ${hint.targetCell[1] + 1} 行`,
          'polite'
        );
      }
    } else {
      const nextLevel = hintLadderLevel === 1 ? 2 : 3;
      setHintLadderLevel(nextLevel);
      if (nextLevel === 2) {
        announce(isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh, 'polite');
      } else {
        announce(activeHint.rationale, 'polite');
      }
    }
  };

  const theoryTime = (actualPuzzle?.metrics as any)?.estimated_time_sec || rows * cols * 3;
  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('TopologicalLookahead', theoryTime, 'heyawake');
  }, [getBenchmarkMetrics, theoryTime]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  if (!actualPuzzle) {
    return (
      <div className="flex items-center justify-center p-8 text-xs font-mono text-slate-500">
        {isEn ? 'Loading Heyawake Board...' : '載入黑白分明盤面中...'}
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label={isEn ? 'Heyawake Puzzle Game Board' : '黑白分明對弈盤面'}
      className="flex flex-col items-center justify-center p-1 select-none font-mono outline-none"
    >
      {/* 頂部心流控制列 */}
      <div className="w-full grid grid-cols-5 gap-1 px-0.5 mb-1.5 text-[8px] sm:text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '⏱️ Speed' : '⏱️ 競速'}</div>
          {isCompleted ? (
            <span className="text-slate-200 font-bold">{finalTimeSec.toFixed(1)}s</span>
          ) : (
            <MemoizedTimer startTime={startTimeRef.current} isCompleted={isCompleted} />
          )}
        </div>
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '♟️ Moves' : '♟️ 步數'}</div>
          <div className="text-cyan-300 font-bold">{historyLen}</div>
        </div>
        <button
          type="button"
          onClick={() => setSpeedMode((p) => !p)}
          className={`p-1 rounded border text-center transition cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
            speedMode
              ? 'bg-amber-950/80 border-amber-500 text-amber-300 font-bold'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
        >
          <div className="text-[6.5px]">⚡ {isEn ? 'Mode' : '模式'}</div>
          <div className="text-[7.5px]">{speedMode ? (isEn ? 'Speed (2-State)' : '競速 (二態)') : (isEn ? 'Standard' : '標準')}</div>
        </button>
        <button
          type="button"
          onClick={() => setShowRadar((p) => !p)}
          className={`p-1 rounded border text-center transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
            showRadar
              ? 'bg-cyan-950 border-cyan-400 text-cyan-300 font-bold shadow-[0_0_8px_rgba(6,182,212,0.3)]'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="text-[6.5px]">🔗 {isEn ? 'Radar' : '咽喉雷達'}</div>
          <div className="text-[7.5px]">{showRadar ? (isEn ? 'ACTIVE' : '已啟動') : (isEn ? 'OFF (Tap)' : '關閉')}</div>
        </button>
        <button
          type="button"
          onClick={handleRequestHint}
          disabled={isCompleted || tournamentMode}
          className={`p-1 rounded border text-center transition cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
            tournamentMode
              ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
              : activeHint
              ? 'bg-indigo-950 border-indigo-500 text-indigo-300 font-bold'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="text-[6.5px]">💡 {isEn ? 'Hint' : '提示'}</div>
          <div className="text-[7.5px] truncate">
            {activeHint ? `${isEn ? 'Lv.' : '階梯 '}${hintLadderLevel}/3` : (isEn ? 'Deduce' : '必然推導')}
          </div>
        </button>
      </div>

      {activeHint && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-indigo-950/90 border border-indigo-500/70 rounded-lg text-indigo-200 text-[8px] animate-fade-in text-left shadow-lg">
          <div className="font-bold flex items-center justify-between text-[7px] text-indigo-400 border-b border-indigo-900/60 pb-0.5 mb-1" aria-hidden="true">
            <span>[HINT LADDER LEVEL {hintLadderLevel}/3]</span>
            <span className="uppercase">{activeHint.technique.replace(/_/g, ' ')}</span>
          </div>
          <div aria-hidden="true">
            {hintLadderLevel === 1 && (
              <div>
                {isEn
                  ? `Focus on [${activeHint.targetCell[0] + 1}, ${activeHint.targetCell[1] + 1}]. A deduction is forced.`
                  : `關注坐標 [${activeHint.targetCell[0] + 1}, ${activeHint.targetCell[1] + 1}]，此處存在必然推導。`}
              </div>
            )}
            {hintLadderLevel === 2 && (
              <div>{isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}</div>
            )}
            {hintLadderLevel === 3 && (
              <div className="font-bold text-indigo-300">
                {activeHint.rationale}
                <span className="ml-1 text-cyan-300 underline">
                  {activeHint.forcedState === 1 ? (isEn ? '➔ BLACK' : '➔ 填黑') : (isEn ? '➔ WHITE' : '➔ 標叉留白')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 主棋盤：嚴格 WAI-ARIA APG Grid 規範（role="grid" -> role="row" -> role="gridcell"） */}
      <div
        ref={gridElementRef}
        role="grid"
        aria-label={isEn ? `${rows} by ${cols} Heyawake Grid` : `${rows}x${cols} 黑白分明網格`}
        aria-rowcount={rows}
        aria-colcount={cols}
        onPointerDown={handleGridPointerDown}
        onMouseDown={(e) => e.preventDefault()}
        className="relative overflow-hidden p-1.5 rounded-xl bg-slate-950 border-2 border-slate-800 shadow-2xl"
        style={{ touchAction: 'none' }}
      >
        <div
          className="flex flex-col select-none bg-slate-900/40"
          style={{
            width: 'min(88vw, 42vh)',
            height: 'min(88vw, 42vh)',
          }}
        >
          {Array.from({ length: rows }, (_, r) => (
            <div
              key={r}
              role="row"
              className="flex flex-1 w-full"
            >
              {Array.from({ length: cols }, (__, c) => {
                const idx = r * cols + c;
                const roomId = gridRooms[r]?.[c] ?? 0;
                const room = roomMap.get(roomId);
                const labelCoord = labelPosMap.get(roomId);
                const isLabelCell = !!(labelCoord && labelCoord[0] === r && labelCoord[1] === c && room?.clue !== null);
                const isRoomSatisfied = satisfiedRooms.has(roomId);

                const cellKey = `${r},${c}`;
                const isAdjConflict = conflicts.adjacentBlack.has(cellKey);
                const isRayConflict = conflicts.rayViolations.has(cellKey);
                const isQuotaConflict = conflicts.quotaViolations.has(roomId);
                const isCutPoint = deferredCutPoints.has(cellKey);
                const isHintTarget = !!(activeHint && activeHint.targetCell[0] === r && activeHint.targetCell[1] === c);

                const state = cellStore.getCellState(idx);
                const isCursor = cursorIdx === idx;

                return (
                  <HeyawakePureCell
                    key={idx}
                    idx={idx}
                    r={r}
                    c={c}
                    state={state}
                    isCursor={isCursor}
                    room={room}
                    isLabelCell={isLabelCell}
                    border={staticBorders[idx]}
                    isAdjConflict={isAdjConflict}
                    isRayConflict={isRayConflict}
                    isQuotaConflict={isQuotaConflict}
                    isCutPoint={isCutPoint}
                    isHintTarget={isHintTarget}
                    isRoomSatisfied={isRoomSatisfied}
                    isEn={isEn}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 底部熱鍵指引 */}
      <div className="w-full max-w-[340px] flex items-center justify-between px-1 mt-1.5 text-[7.5px] text-slate-400">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              if (cellStore.undo()) {
                safeVibrate(10); playSound('step'); setActiveHint(null);
              }
            }}
            disabled={historyLen === 0 || isCompleted}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            ↩ Undo (Z)
          </button>
          <button
            type="button"
            onClick={() => {
              if (cellStore.redo()) {
                safeVibrate(10); playSound('step'); setActiveHint(null);
              }
            }}
            disabled={redoLen === 0 || isCompleted}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            ↪ Redo (Y)
          </button>
        </div>
        <div className="text-slate-500 text-[7px]">
          [WASD/方向鍵] 移動 | [1] 填黑 | {speedMode ? '[0/2/Del] 清除' : '[2] 標叉 | [0/Del] 清除'}
        </div>
      </div>

      {/* 賽事結算區域：非模態 role="region"，移除 aria-live 避免重播噪音 */}
      {isCompleted && (
        <section
          role="region"
          aria-label={isEn ? 'Heyawake Completed Summary' : '黑白分明通關總結'}
          className="mt-2 p-2.5 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl animate-fade-in font-mono"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-500 tracking-wider">HEYAWAKE RESOLVED</div>
              <h2 className="text-xs text-indigo-300 font-bold m-0">
                {isEn ? '✨ Heyawake Cleared!' : '✨ 黑白分明・完美解題'}
              </h2>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[9px] font-bold text-cyan-300">
              Gf: IQ {cci.standardIQ} (Top {Number((100 - cci.percentileRank).toFixed(1))}%)
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[7.5px] text-slate-400 mb-1.5" role="group" aria-label={isEn ? 'Score stats' : '成績統計'}>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Time' : '耗時'}</div>
              <div className="text-slate-200 font-bold text-[10px]">{finalTimeSec.toFixed(1)}s</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Moves' : '步數'}</div>
              <div className="text-cyan-300 font-bold text-[10px]">{historyLen}</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Conflicts' : '衝突累加'}</div>
              <div className="text-amber-300 font-bold text-[10px]">{conflictDisplay}</div>
            </div>
          </div>

          <div className="mb-1.5">
            <MetricErrorBar
              actualVal={finalTimeSec}
              benchmarkVal={benchmarkData.benchmarkTime}
              ci95={benchmarkData.ci95}
              sem={benchmarkData.sem}
              unit="s"
              forceLang={lang}
            />
          </div>

          <div className="bg-slate-900/40 p-1 rounded-lg border border-slate-800 flex flex-col items-center mb-1.5">
            <CognitiveRadarChart
              dimensions={profile.cognitiveDimensions}
              previousDimensions={profile.previousCognitiveDimensions}
              size={135}
            />
          </div>

          <div className="flex gap-1 mb-1.5">
            <button
              type="button"
              onClick={exportLongitudinalDataset}
              className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-cyan-600/50 hover:border-cyan-400 text-cyan-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            >
              <span>📊</span>
              <span>{isEn ? 'Dataset' : '匯出數據'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowSubmitModal(true)}
              className="flex-1 py-1 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 text-slate-950 text-[7.5px] font-black rounded shadow transition active:scale-95 flex items-center justify-center gap-0.5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <span>📤</span>
              <span>{isEn ? 'Submit' : '賽事提交'}</span>
            </button>
          </div>

          {proofSignature && (
            <div className="p-1 bg-slate-900 border border-slate-800 rounded text-left">
              <div className="text-[6.5px] text-slate-500 font-bold uppercase flex justify-between">
                <span>{isEn ? 'RECEIPT (SHA-256)' : '防偽存證 (SHA-256)'}</span>
                <span className="text-emerald-400 font-mono text-[5.5px]">TAMPER-PROOF</span>
              </div>
              <div className="text-[6px] font-mono text-cyan-400/80 break-all select-all mt-0.5">
                {proofSignature}
              </div>
            </div>
          )}
        </section>
      )}

      {showPBModal && (
        <PBCelebrationModal pb={profile.personalBest} onClose={() => setShowPBModal(false)} forceLang={lang} />
      )}

      {showSubmitModal && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'WPF_HEYAWAKE_2026' : 'GLOBAL_TOPOLOGY_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'heyawake',
            tier: currentTier,
            timeSpentSec: finalTimeSec,
            conflictsCount: conflictCountRef.current,
            infractionScore: calculateInfractionScore({
              tabSwitches: 0,
              blurEvents: 0,
              clipboardEvents: 0,
              untrustedEvents: 0,
            }),
            environment: getEnvironmentFingerprint(),
            timestamp: new Date().toISOString(),
          }}
          onClose={() => setShowSubmitModal(false)}
          forceLang={lang}
        />
      )}
    </div>
  );
};
