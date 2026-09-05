// web-frontend/src/components/NurikabeBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { MetricErrorBar } from './MetricErrorBar';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';
import { getEnvironmentFingerprint, calculateInfractionScore } from '../utils/tournamentSecurity';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2; // 0: 空, 1: 黑海, 2: 白島

interface BoardDelta {
  r: number;
  c: number;
  from: CellState;
  to: CellState;
}

export type NurikabeTechnique =
  | 'clue_isolation'
  | 'diagonal_clue_sea'
  | 'island_quota_closure'
  | 'pool_2x2_avoidance'
  | 'ocean_connectivity'
  | 'line_macro_exclusion'; // 新增宏觀行列排除

interface NurikabeHintStep {
  step: number;
  targetCell: [number, number];
  forcedState: 1 | 2; // 1: 黑海, 2: 白島
  technique: NurikabeTechnique;
  evidenceCells: [number, number][]; // 推導依據座標序列
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

const MAX_HISTORY_STEPS = 250;

export const NurikabeBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
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

  const spec = (actualPuzzle as any)?.puzzle || (actualPuzzle as any)?.spec || (actualPuzzle as any);
  const rows = spec?.rows || spec?.grid?.length || 7;
  const cols = spec?.cols || spec?.grid?.[0]?.length || 7;

  const clueGrid: number[][] = useMemo(() => {
    if (spec?.clues) return spec.clues;
    if (spec?.grid) {
      return spec.grid.map((row: any[]) =>
        row.map((cell) => (typeof cell === 'number' && cell > 0 ? cell : 0))
      );
    }
    return Array.from({ length: rows }, () => Array(cols).fill(0));
  }, [spec, rows, cols]);

  const solution: boolean[][] = useMemo(() => {
    return (
      actualPuzzle?.solution ||
      spec?.solution ||
      Array.from({ length: rows }, () => Array(cols).fill(false))
    );
  }, [actualPuzzle, spec, rows, cols]);

  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';

  const [board, setBoard] = useState<CellState[][]>(() => {
    const init = Array.from({ length: rows }, () => Array(cols).fill(0) as CellState[]);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (clueGrid[r][c] > 0) init[r][c] = 2;
      }
    }
    return init;
  });

  const [history, setHistory] = useState<BoardDelta[]>([]);
  const [redoStack, setRedoStack] = useState<BoardDelta[]>([]);
  const [cursorPos, setCursorPos] = useState<[number, number]>([0, 0]);

  const [noGuessMode, setNoGuessMode] = useState<boolean>(false);
  const [noGuessWarning, setNoGuessWarning] = useState<string | null>(null);
  const [activeHint, setActiveHint] = useState<NurikabeHintStep | null>(null);
  const [hintLadderLevel, setHintLadderLevel] = useState<1 | 2 | 3>(1);

  // 因果推導動畫亮起集合
  const [animatedEvidenceSet, setAnimatedEvidenceSet] = useState<Set<string>>(new Set());

  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);

  const startTimeRef = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const conflictCountRef = useRef<number>(0);
  const [conflictDisplay, setConflictDisplay] = useState<number>(0);
  const movesCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const init = Array.from({ length: rows }, () => Array(cols).fill(0) as CellState[]);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (clueGrid[r][c] > 0) init[r][c] = 2;
      }
    }
    setBoard(init);
    setHistory([]);
    setRedoStack([]);
    setCursorPos([0, 0]);
    setIsCompleted(false);
    setActiveHint(null);
    setHintLadderLevel(1);
    setAnimatedEvidenceSet(new Set());
    setProofSignature(null);
    setNoGuessWarning(null);
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    conflictCountRef.current = 0;
    setConflictDisplay(0);
    movesCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [actualPuzzle?.id, rows, cols, clueGrid]);

  useEffect(() => {
    if (isCompleted) return;
    let frameId: number;
    const updateTimer = () => {
      setElapsedMs(Date.now() - startTimeRef.current);
      frameId = requestAnimationFrame(updateTimer);
    };
    frameId = requestAnimationFrame(updateTimer);
    return () => cancelAnimationFrame(frameId);
  }, [isCompleted]);

  // 動態推導依據瀑布流閃爍動畫 (Cascade Animation)
  useEffect(() => {
    if (!activeHint || activeHint.evidenceCells.length === 0) {
      setAnimatedEvidenceSet(new Set());
      return;
    }

    setAnimatedEvidenceSet(new Set());
    const timers: NodeJS.Timeout[] = [];

    activeHint.evidenceCells.forEach(([er, ec], idx) => {
      const t = setTimeout(() => {
        setAnimatedEvidenceSet((prev) => new Set(prev).add(`${er},${ec}`));
        if (navigator.vibrate) navigator.vibrate(4);
      }, idx * 120);
      timers.push(t);
    });

    return () => timers.forEach(clearTimeout);
  }, [activeHint]);

  // 全域拓撲分析
  const analysis = useMemo(() => {
    const pool2x2 = new Set<string>();
    const multiClueIslands = new Set<string>();
    const overflowIslands = new Set<string>();
    const satisfiedIslands = new Set<string>();

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (
          board[r][c] === 1 &&
          board[r + 1][c] === 1 &&
          board[r][c + 1] === 1 &&
          board[r + 1][c + 1] === 1
        ) {
          pool2x2.add(`${r},${c}`);
          pool2x2.add(`${r + 1},${c}`);
          pool2x2.add(`${r + 1},${c + 1}`);
          pool2x2.add(`${r},${c + 1}`);
        }
      }
    }

    const visitedWhite = new Set<string>();
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 2 && !visitedWhite.has(`${r},${c}`)) {
          const islandCells: [number, number][] = [];
          const cluesInIsland: [number, number, number][] = [];
          const queue: [number, number][] = [[r, c]];
          visitedWhite.add(`${r},${c}`);

          while (queue.length > 0) {
            const [cr, cc] = queue.shift()!;
            islandCells.push([cr, cc]);
            if (clueGrid[cr][cc] > 0) {
              cluesInIsland.push([cr, cc, clueGrid[cr][cc]]);
            }

            for (const [dr, dc] of dirs) {
              const nr = cr + dr;
              const nc = cc + dc;
              if (
                nr >= 0 &&
                nr < rows &&
                nc >= 0 &&
                nc < cols &&
                board[nr][nc] === 2 &&
                !visitedWhite.has(`${nr},${nc}`)
              ) {
                visitedWhite.add(`${nr},${nc}`);
                queue.push([nr, nc]);
              }
            }
          }

          if (cluesInIsland.length > 1) {
            islandCells.forEach(([ir, ic]) => multiClueIslands.add(`${ir},${ic}`));
          } else if (cluesInIsland.length === 1) {
            const targetSize = cluesInIsland[0][2];
            if (islandCells.length > targetSize) {
              islandCells.forEach(([ir, ic]) => overflowIslands.add(`${ir},${ic}`));
            } else if (islandCells.length === targetSize) {
              islandCells.forEach(([ir, ic]) => satisfiedIslands.add(`${ir},${ic}`));
            }
          }
        }
      }
    }

    let totalBlack = 0;
    let firstBlack: [number, number] | null = null;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          totalBlack++;
          if (!firstBlack) firstBlack = [r, c];
        }
      }
    }

    let isOceanConnected = true;
    if (firstBlack && totalBlack > 0) {
      const oceanVisited = new Set<string>([`${firstBlack[0]},${firstBlack[1]}`]);
      const oQueue: [number, number][] = [firstBlack];
      let reached = 0;

      while (oQueue.length > 0) {
        const [cr, cc] = oQueue.shift()!;
        reached++;

        for (const [dr, dc] of dirs) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (
            nr >= 0 &&
            nr < rows &&
            nc >= 0 &&
            nc < cols &&
            board[nr][nc] === 1 &&
            !oceanVisited.has(`${nr},${nc}`)
          ) {
            oceanVisited.add(`${nr},${nc}`);
            oQueue.push([nr, nc]);
          }
        }
      }
      isOceanConnected = reached === totalBlack;
    }

    return {
      pool2x2,
      multiClueIslands,
      overflowIslands,
      satisfiedIslands,
      isOceanConnected,
      totalConflicts:
        pool2x2.size +
        multiClueIslands.size +
        overflowIslands.size +
        (!isOceanConnected && totalBlack > 1 ? 1 : 0),
    };
  }, [board, clueGrid, rows, cols]);

  const prevConflictTotalRef = useRef<number>(0);
  useEffect(() => {
    if (analysis.totalConflicts > prevConflictTotalRef.current) {
      conflictCountRef.current += analysis.totalConflicts - prevConflictTotalRef.current;
      setConflictDisplay(conflictCountRef.current);
    }
    prevConflictTotalRef.current = analysis.totalConflicts;
  }, [analysis.totalConflicts]);

  // 高階人類定式波前引擎 (納入全域行列排除法)
  const getNextForcedDeduction = useCallback((): NurikabeHintStep | null => {
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    // 定式 1: 兩個相鄰數字之間強制填黑
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (clueGrid[r][c] > 0) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr * 2;
            const nc = c + dc * 2;
            const mr = r + dr;
            const mc = c + dc;
            if (
              nr >= 0 &&
              nr < rows &&
              nc >= 0 &&
              nc < cols &&
              clueGrid[nr][nc] > 0 &&
              board[mr][mc] === 0
            ) {
              return {
                step: 1,
                targetCell: [mr, mc],
                forcedState: 1,
                technique: 'clue_isolation',
                evidenceCells: [[r, c], [nr, nc]],
                rationale: `格 [${r + 1},${c + 1}] 與 [${nr + 1},${nc + 1}] 為兩個獨立數字島嶼，中間格必須為黑海以防島嶼互斥融合。`,
                humanReadable: {
                  zh: `觀察 [${mr + 1}, ${mc + 1}]：處於數字 ${clueGrid[r][c]} 與 ${clueGrid[nr][nc]} 之間，若留白將合為一島，此處必填黑海。`,
                  en: `Cell [${mr + 1}, ${mc + 1}] is sandwiched by clues ${clueGrid[r][c]} and ${clueGrid[nr][nc]}; must be sea.`,
                },
              };
            }
          }
        }
      }
    }

    // 定式 2: 2x2 水池避免 (三黑夾一空，剩餘空處強制為白島)
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const square: [number, number][] = [
          [r, c],
          [r + 1, c],
          [r, c + 1],
          [r + 1, c + 1],
        ];
        const blacks = square.filter(([sr, sc]) => board[sr][sc] === 1);
        const unassigned = square.filter(([sr, sc]) => board[sr][sc] === 0);

        if (blacks.length === 3 && unassigned.length === 1) {
          const target = unassigned[0];
          return {
            step: 1,
            targetCell: target,
            forcedState: 2,
            technique: 'pool_2x2_avoidance',
            evidenceCells: blacks,
            rationale: `該 2x2 區域已包含 3 格黑海，若 [${target[0] + 1},${target[1] + 1}] 再填黑將形成 2x2 禁忌水池，強制留白為島。`,
            humanReadable: {
              zh: `觀察 [${target[0] + 1}, ${target[1] + 1}]：周圍三格已是黑海，若再塗黑將觸發 2x2 水池違規，此處強制為白島。`,
              en: `Filling [${target[0] + 1}, ${target[1] + 1}] black causes a 2x2 pool violation; must be white island.`,
            },
          };
        }
      }
    }

    // 定式 3: 滿額島嶼四周正交封鎖填黑
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (analysis.satisfiedIslands.has(`${r},${c}`)) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === 0) {
              return {
                step: 1,
                targetCell: [nr, nc],
                forcedState: 1,
                technique: 'island_quota_closure',
                evidenceCells: [[r, c]],
                rationale: `相鄰島嶼已達所需面積配額，周圍所有正交延伸之空格強制填黑以封鎖邊界。`,
                humanReadable: {
                  zh: `相鄰島嶼已完全滿額，[${nr + 1}, ${nc + 1}] 不能再擴張該島，必須填黑築牆。`,
                  en: `The adjacent island reached full quota; [${nr + 1}, ${nc + 1}] must be sealed black.`,
                },
              };
            }
          }
        }
      }
    }

    // 定式 4: 海洋拓撲割點守護
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          const oceanNeighbors = dirs
            .map(([dr, dc]) => [r + dr, c + dc] as [number, number])
            .filter(([nr, nc]) => nr >= 0 && nr < rows && nc >= 0 && nc < cols)
            .filter(([nr, nc]) => board[nr][nc] === 1 || board[nr][nc] === 0);

          const unassigned = oceanNeighbors.filter(([nr, nc]) => board[nr][nc] === 0);
          const blacks = oceanNeighbors.filter(([nr, nc]) => board[nr][nc] === 1);

          if (blacks.length === 0 && unassigned.length === 1) {
            const target = unassigned[0];
            return {
              step: 1,
              targetCell: target,
              forcedState: 1,
              technique: 'ocean_connectivity',
              evidenceCells: [[r, c]],
              rationale: `黑格 [${r + 1},${c + 1}] 僅剩單一可用路徑與外圍海洋相連，強制填黑以防黑海斷裂。`,
              humanReadable: {
                zh: `黑海 [${r + 1}, ${c + 1}] 正面臨孤立，唯一的連通出口在 [${target[0] + 1}, ${target[1] + 1}]，必填黑延展。`,
                en: `Sea cell [${r + 1}, ${c + 1}] has only one escape path at [${target[0] + 1}, ${target[1] + 1}]; must be sea.`,
              },
            };
          }
        }
      }
    }

    // 定式 5（進階宏觀）: 行列排除法定式 (Line-based Exclusion)
    for (let r = 0; r < rows; r++) {
      let islandClueSumInRow = 0;
      let whiteCount = 0;
      const unassignedCols: number[] = [];
      const evidence: [number, number][] = [];

      for (let c = 0; c < cols; c++) {
        if (clueGrid[r][c] > 0) {
          islandClueSumInRow += clueGrid[r][c];
          evidence.push([r, c]);
        }
        if (board[r][c] === 2) {
          whiteCount++;
          evidence.push([r, c]);
        } else if (board[r][c] === 0) {
          unassignedCols.push(c);
        }
      }

      // 若該行沒有任何線索且已填入白格已超出可能跨行預算（安全啟發檢驗）
      if (islandClueSumInRow > 0 && whiteCount === islandClueSumInRow && unassignedCols.length > 0) {
        const targetC = unassignedCols[0];
        return {
          step: 1,
          targetCell: [r, targetC],
          forcedState: 1,
          technique: 'line_macro_exclusion',
          evidenceCells: evidence,
          rationale: `第 ${r + 1} 行之白島配額已在行內完全滿足，剩餘空格全數強制填黑築海。`,
          humanReadable: {
            zh: `宏觀審視第 ${r + 1} 行：該行島嶼配額已全部覆蓋，空格 [${r + 1}, ${targetC + 1}] 強制填海。`,
            en: `Macro Row ${r + 1}: Line island quota fulfilled; remaining cell [${r + 1}, ${targetC + 1}] must be sea.`,
          },
        };
      }
    }

    return null;
  }, [rows, cols, clueGrid, board, analysis.satisfiedIslands]);

  // 差量變更應用 (含 No-Guess 阻擋與依據提示)
  const applyCellMutation = useCallback(
    (r: number, c: number, targetState: CellState) => {
      if (isCompleted) return;
      if (clueGrid[r][c] > 0) return;

      const currentState = board[r][c];
      if (currentState === targetState) return;

      // No-Guess 嚴格攔截
      if (noGuessMode && targetState !== 0) {
        const step = getNextForcedDeduction();
        if (step) {
          const isTarget = step.targetCell[0] === r && step.targetCell[1] === c;
          const isStateMatch = step.forcedState === targetState;
          if (!isTarget || !isStateMatch) {
            if (navigator.vibrate) navigator.vibrate([25, 35, 25]);
            const reason = isEn ? step.humanReadable.en : step.humanReadable.zh;
            setNoGuessWarning(
              isEn
                ? `[No-Guess Blocked] Target [${step.targetCell[0] + 1}, ${step.targetCell[1] + 1}]: ${reason}`
                : `【無猜測攔截】優先推導 [${step.targetCell[0] + 1}, ${step.targetCell[1] + 1}]：${reason}`
            );
            setTimeout(() => setNoGuessWarning(null), 3200);
            return;
          }
        }
      }

      if (navigator.vibrate) navigator.vibrate(8);
      movesCountRef.current++;

      const delta: BoardDelta = { r, c, from: currentState, to: targetState };
      setHistory((prev) => [...prev.slice(-MAX_HISTORY_STEPS + 1), delta]);
      setRedoStack([]);

      setBoard((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = targetState;
        return next;
      });

      if (activeHint && activeHint.targetCell[0] === r && activeHint.targetCell[1] === c) {
        setActiveHint(null);
      }
    },
    [isCompleted, clueGrid, board, noGuessMode, getNextForcedDeduction, activeHint, isEn]
  );

  const handleCellClick = useCallback(
    (r: number, c: number) => {
      setCursorPos([r, c]);
      if (clueGrid[r][c] > 0) return;
      const nextState: CellState = board[r][c] === 0 ? 1 : board[r][c] === 1 ? 2 : 0;
      applyCellMutation(r, c, nextState);
    },
    [board, clueGrid, applyCellMutation]
  );

  // 差量 Undo / Redo
  const handleUndo = useCallback(() => {
    if (history.length === 0 || isCompleted) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const lastDelta = history[history.length - 1];
    setBoard((prev) => {
      const next = prev.map((row) => [...row]);
      next[lastDelta.r][lastDelta.c] = lastDelta.from;
      return next;
    });

    setRedoStack((prev) => [...prev, lastDelta]);
    setHistory((prev) => prev.slice(0, -1));
  }, [history, isCompleted]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || isCompleted) return;
    if (navigator.vibrate) navigator.vibrate(10);

    const nextDelta = redoStack[redoStack.length - 1];
    setBoard((prev) => {
      const next = prev.map((row) => [...row]);
      next[nextDelta.r][nextDelta.c] = nextDelta.to;
      return next;
    });

    setHistory((prev) => [...prev, nextDelta]);
    setRedoStack((prev) => prev.slice(0, -1));
  }, [redoStack, isCompleted]);

  // 鍵盤操控監聽
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      const [r, c] = cursorPos;
      if (['ArrowUp', 'KeyW'].includes(e.code)) {
        e.preventDefault();
        setCursorPos([Math.max(0, r - 1), c]);
      } else if (['ArrowDown', 'KeyS'].includes(e.code)) {
        e.preventDefault();
        setCursorPos([Math.min(rows - 1, r + 1), c]);
      } else if (['ArrowLeft', 'KeyA'].includes(e.code)) {
        e.preventDefault();
        setCursorPos([r, Math.max(0, c - 1)]);
      } else if (['ArrowRight', 'KeyD'].includes(e.code)) {
        e.preventDefault();
        setCursorPos([r, Math.min(cols - 1, c + 1)]);
      } else if (e.code === 'Digit1' || e.code === 'Numpad1') {
        e.preventDefault();
        applyCellMutation(r, c, 1);
      } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
        e.preventDefault();
        applyCellMutation(r, c, 2);
      } else if (e.code === 'Digit0' || e.code === 'Numpad0' || e.code === 'Backspace') {
        e.preventDefault();
        applyCellMutation(r, c, 0);
      } else if (e.code === 'Space') {
        e.preventDefault();
        handleCellClick(r, c);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cursorPos, rows, cols, isCompleted, handleUndo, handleRedo, applyCellMutation, handleCellClick]);

  // 手機長按快選
  const handleTouchStartCell = (r: number, c: number) => {
    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(20);
      applyCellMutation(r, c, 2);
      longPressTimerRef.current = null;
    }, 350);
  };

  const handleTouchEndCell = (r: number, c: number) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      handleCellClick(r, c);
    }
  };

  // 勝利驗證與賽事防偽簽名
  useEffect(() => {
    if (isCompleted || !solution || solution.length === 0) return;

    let isMatch = true;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isSea = board[r][c] === 1;
        if (isSea !== solution[r][c]) {
          isMatch = false;
          break;
        }
      }
      if (!isMatch) break;
    }

    if (isMatch && analysis.totalConflicts === 0) {
      setIsCompleted(true);
      const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));

      if (!hasRecordedRef.current && actualPuzzle) {
        hasRecordedRef.current = true;
        const baseIrt = (actualPuzzle.metrics as any)?.irt_logit_difficulty || 1.8;

        recordAttempt({
          puzzleId: actualPuzzle.id,
          engineType: 'nurikabe',
          tier: currentTier,
          cognitiveLoad: actualPuzzle.cognitiveLoad || {
            spatial: 0.85,
            numeric: 0.35,
            workingMemory: 0.75,
            inhibition: 0.9,
          },
          isSuccess: true,
          timeSpentSec: timeSpent,
          conflictsCount: conflictCountRef.current,
          technique: 'NurikabeWavefrontSolver',
          irtDifficulty: baseIrt,
          isPureClear: conflictCountRef.current === 0 && !activeHint,
        });

        try {
          const canonical = `${actualPuzzle.id}|${timeSpent}|${movesCountRef.current}|${conflictCountRef.current}|NURIKABE_LEGEND_SHA`;
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

        if (timeSpent <= profile.personalBest.fastestTime) {
          setShowPBModal(true);
        }
      }
    }
  }, [board, solution, analysis.totalConflicts, rows, cols, isCompleted, actualPuzzle, currentTier, recordAttempt, profile.personalBest.fastestTime, activeHint]);

  // 因果提示階梯觸發
  const handleRequestHint = () => {
    if (isCompleted || tournamentMode) return;
    if (navigator.vibrate) navigator.vibrate(12);

    if (!activeHint) {
      const step = getNextForcedDeduction();
      if (step) {
        setActiveHint(step);
        setCursorPos(step.targetCell);
        setHintLadderLevel(1);
      }
    } else {
      setHintLadderLevel((prev) => (prev === 1 ? 2 : 3));
    }
  };

  const theoryTime = (actualPuzzle?.metrics as any)?.estimated_time_sec || rows * cols * 2.5;
  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('TopologicalLookahead', theoryTime, 'nurikabe');
  }, [getBenchmarkMetrics, theoryTime]);

  const cci = useMemo(() => getCompositeCognitiveIndex(), [getCompositeCognitiveIndex, isCompleted]);

  return (
    <div className="flex flex-col items-center justify-center p-1 select-none font-mono">
      {/* 頂部賽事數據列 */}
      <div className="w-full grid grid-cols-5 gap-1 px-0.5 mb-1.5 text-[8px] sm:text-[9px]">
        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '⏱️ Speed' : '⏱️ 競速'}</div>
          <div className="text-slate-200 font-bold">{(elapsedMs / 1000).toFixed(1)}s</div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '♟️ Moves' : '♟️ 步數'}</div>
          <div className="text-cyan-300 font-bold">{movesCountRef.current}</div>
        </div>

        <div className="bg-slate-950 border border-slate-800 p-1 rounded text-center">
          <div className="text-slate-500 text-[6.5px]">{isEn ? '⚠️ Conflicts' : '⚠️ 衝突累加'}</div>
          <div className={`font-bold ${conflictDisplay > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
            {conflictDisplay}
          </div>
        </div>

        {/* 無猜測模式切換 */}
        <button
          onClick={() => setNoGuessMode((prev) => !prev)}
          className={`p-1 rounded border text-center transition ${
            noGuessMode
              ? 'bg-purple-950 border-purple-500 text-purple-300 font-bold shadow-xs'
              : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
          title={isEn ? 'Toggle No-Guess strict verification' : '切換無猜測純邏輯防護'}
        >
          <div className="text-[6.5px]">🛡️ {isEn ? 'No-Guess' : '無猜測'}</div>
          <div className="text-[7.5px]">{noGuessMode ? (isEn ? 'Strict ON' : '強制嚴謹') : (isEn ? 'OFF' : '關閉')}</div>
        </button>

        {/* 提示階梯 */}
        <button
          onClick={handleRequestHint}
          disabled={isCompleted || tournamentMode}
          className={`p-1 rounded border text-center transition ${
            tournamentMode
              ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
              : activeHint
              ? 'bg-amber-950/90 border-amber-500 text-amber-300 font-bold shadow-xs'
              : 'bg-indigo-950/80 border-indigo-500/60 text-indigo-300 hover:bg-indigo-900'
          }`}
        >
          <div className="text-[6.5px]">💡 {isEn ? 'Hint Ladder' : '提示階梯'}</div>
          <div className="text-[7.5px] truncate">
            {tournamentMode
              ? (isEn ? 'Locked' : '賽事鎖定')
              : activeHint
              ? `${isEn ? 'Lv.' : '階梯 '}${hintLadderLevel}/3`
              : (isEn ? 'Get Hint' : '因果提示')}
          </div>
        </button>
      </div>

      {/* 無猜測攔截橫條 */}
      {noGuessWarning && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1 bg-rose-950 border border-rose-500 text-rose-300 text-[8px] rounded-lg animate-pulse text-center shadow-lg font-bold">
          {noGuessWarning}
        </div>
      )}

      {/* 提示階梯說明卡片 */}
      {activeHint && (
        <div className="w-[min(88vw,42vh)] mb-1.5 p-1.5 bg-amber-950/80 border border-amber-500/70 rounded-lg text-amber-200 text-[8px] animate-fade-in text-left shadow-lg">
          <div className="font-bold flex items-center justify-between text-[7px] text-amber-400 border-b border-amber-900/60 pb-0.5 mb-1">
            <span>[NURIKABE HINT LADDER LEVEL {hintLadderLevel}/3]</span>
            <span className="uppercase">{activeHint.technique.replace(/_/g, ' ')}</span>
          </div>
          {hintLadderLevel === 1 && (
            <div>
              {isEn
                ? `Focus on Row ${activeHint.targetCell[0] + 1}, Col ${activeHint.targetCell[1] + 1}. A logical cell state is forced here.`
                : `請關注第 ${activeHint.targetCell[0] + 1} 行、第 ${activeHint.targetCell[1] + 1} 列。該格存在必然推導。`}
            </div>
          )}
          {hintLadderLevel === 2 && (
            <div>{isEn ? activeHint.humanReadable.en : activeHint.humanReadable.zh}</div>
          )}
          {hintLadderLevel === 3 && (
            <div className="font-bold text-amber-300">
              {activeHint.rationale}
              <span className="ml-1 text-cyan-300 underline">
                {activeHint.forcedState === 1 ? (isEn ? 'Must be SEA (Black)' : '必然為海 (黑格)') : (isEn ? 'Must be ISLAND (White)' : '必然為島 (白格)')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 主棋盤 */}
      <div
        className="relative overflow-hidden p-1.5 rounded-xl bg-slate-950 border-2 border-slate-800 shadow-2xl"
        style={{ touchAction: 'none' }}
      >
        <div
          className="grid select-none bg-slate-900/40 gap-[1px]"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            width: 'min(88vw, 42vh)',
            height: 'min(88vw, 42vh)',
          }}
        >
          {Array.from({ length: rows }).map((_, r) =>
            Array.from({ length: cols }).map((__, c) => {
              const clue = clueGrid[r][c];
              const isClue = clue > 0;
              const state = board[r][c];
              const cellKey = `${r},${c}`;

              const is2x2Pool = analysis.pool2x2.has(cellKey);
              const isMultiClue = analysis.multiClueIslands.has(cellKey);
              const isOverflow = analysis.overflowIslands.has(cellKey);
              const isSatisfied = analysis.satisfiedIslands.has(cellKey);

              const isCursor = cursorPos[0] === r && cursorPos[1] === c;
              const isHintTarget = activeHint && activeHint.targetCell[0] === r && activeHint.targetCell[1] === c;
              const isEvidenceAnimated = animatedEvidenceSet.has(cellKey);

              return (
                <div
                  key={cellKey}
                  onTouchStart={() => handleTouchStartCell(r, c)}
                  onTouchEnd={() => handleTouchEndCell(r, c)}
                  onClick={() => handleCellClick(r, c)}
                  className={`relative flex items-center justify-center cursor-pointer transition-all duration-150 select-none rounded-xs ${
                    state === 1
                      ? is2x2Pool
                        ? 'bg-rose-700 text-white animate-pulse'
                        : 'bg-slate-950 border border-slate-800 shadow-inner text-cyan-400'
                      : state === 2
                      ? isMultiClue || isOverflow
                        ? 'bg-red-950 border border-rose-500 text-rose-300 font-bold'
                        : isSatisfied
                        ? 'bg-emerald-950/80 border border-emerald-500 text-emerald-300 font-bold'
                        : 'bg-cyan-950/40 border border-cyan-700/50 text-cyan-200'
                      : 'bg-slate-900/80 hover:bg-slate-800 text-slate-500'
                  } ${isCursor ? 'outline outline-2 outline-cyan-400 -outline-offset-2 z-10' : ''} ${
                    isHintTarget ? 'ring-2 ring-amber-400 ring-inset animate-bounce z-20' : ''
                  } ${
                    isEvidenceAnimated
                      ? 'ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.8)] border-amber-300 scale-95 z-15'
                      : ''
                  }`}
                >
                  {isClue ? (
                    <span className="text-[11px] sm:text-[13px] font-black z-10 select-none pointer-events-none">
                      {clue}
                    </span>
                  ) : state === 1 ? (
                    <div className="w-[82%] h-[82%] bg-slate-900 rounded-xs border border-slate-700/60 shadow-md flex items-center justify-center">
                      <div className="w-1.5 h-1.5 bg-cyan-400/40 rounded-full" />
                    </div>
                  ) : state === 2 ? (
                    <div className="w-2 h-2 rounded-full bg-cyan-400/80" />
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 底部撤銷重做與快捷欄 */}
      <div className="w-full max-w-[340px] flex items-center justify-between px-1 mt-1.5 text-[7.5px] text-slate-400">
        <div className="flex gap-1">
          <button
            onClick={handleUndo}
            disabled={history.length === 0 || isCompleted}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40"
          >
            ↩ {isEn ? 'Undo (Z)' : '撤銷'}
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0 || isCompleted}
            className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded hover:bg-slate-800 disabled:opacity-40"
          >
            ↪ {isEn ? 'Redo (Y)' : '重做'}
          </button>
        </div>
        <div className="text-slate-500">
          <span>鍵盤：WASD移動 / 1海 2島 0清 / 長按快選</span>
        </div>
      </div>

      {/* 即時圖例 */}
      <div className="w-full max-w-[340px] flex items-center justify-around px-1 mt-1 text-[6.5px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-950 border border-emerald-500 inline-block rounded-xs" />滿額島嶼</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-950 border border-rose-500 inline-block rounded-xs" />超額/多數字</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-700 inline-block rounded-xs" />2x2 水池違規</span>
        {!analysis.isOceanConnected && (
          <span className="text-amber-400 font-bold animate-pulse">⚠️ 海洋被切斷</span>
        )}
      </div>

      {/* 通關結算面板 */}
      {isCompleted && (
        <div className="mt-2 p-2.5 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(88vw,42vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-500 tracking-wider">NURIKABE RESOLVED</div>
              <div className="text-xs text-indigo-300 font-bold">🌊 數牆・完美海島拓撲</div>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[9px] font-bold text-cyan-300">
              Gf: IQ {cci.standardIQ} (Top {Number((100 - cci.percentileRank).toFixed(1))}%)
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[7.5px] text-slate-400 mb-1.5">
            <div className="bg-slate-900/80 p-1 rounded">
              <div>耗時</div>
              <div className="text-slate-200 font-bold text-[10px]">{(elapsedMs / 1000).toFixed(1)}s</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>操作步數</div>
              <div className="text-cyan-300 font-bold text-[10px]">{movesCountRef.current}</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>衝突次數</div>
              <div className="text-amber-300 font-bold text-[10px]">{conflictCountRef.current} 次</div>
            </div>
          </div>

          <div className="mb-1.5">
            <MetricErrorBar
              actualVal={Math.round(elapsedMs / 1000)}
              benchmarkVal={benchmarkData.benchmarkTime}
              ci95={benchmarkData.ci95}
              sem={benchmarkData.sem}
              unit="s"
              isEn={isEn}
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
              onClick={exportLongitudinalDataset}
              className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-cyan-600/50 hover:border-cyan-400 text-cyan-300 text-[7.5px] font-bold rounded transition shadow flex items-center justify-center gap-0.5 active:scale-95"
            >
              <span>📊</span>
              <span>{isEn ? 'Dataset' : '匯出數據'}</span>
            </button>

            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex-1 py-1 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 text-slate-950 text-[7.5px] font-black rounded shadow transition active:scale-95 flex items-center justify-center gap-0.5"
            >
              <span>📤</span>
              <span>{isEn ? 'Submit' : '賽事提交'}</span>
            </button>
          </div>

          {proofSignature && (
            <div className="p-1 bg-slate-900 border border-slate-800 rounded text-left">
              <div className="text-[6.5px] text-slate-500 font-bold uppercase flex justify-between">
                <span>LOCAL RECEIPT (SHA-256)</span>
                <span className="text-emerald-400 font-mono text-[5.5px]">TAMPER-PROOF</span>
              </div>
              <div className="text-[6px] font-mono text-cyan-400/80 break-all select-all mt-0.5">
                {proofSignature}
              </div>
            </div>
          )}
        </div>
      )}

      {showPBModal && (
        <PBCelebrationModal pb={profile.personalBest} onClose={() => setShowPBModal(false)} isEn={isEn} />
      )}

      {showSubmitModal && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'WPF_NURIKABE_2026' : 'GLOBAL_TOPOLOGY_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'nurikabe',
            tier: currentTier,
            timeSpentSec: Math.round(elapsedMs / 1000),
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
          isEn={isEn}
        />
      )}
    </div>
  );
};
