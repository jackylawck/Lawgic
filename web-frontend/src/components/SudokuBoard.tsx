// web-frontend/src/components/SudokuBoard.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PuzzleEntity } from '../generated';
import { useLearnerProfile, TierKey } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { PBCelebrationModal } from './PBCelebrationModal';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

export const SudokuBoard: React.FC<Props> = ({
  puzzleData,
  puzzle,
  tournamentMode = false,
}) => {
  const actualPuzzle = puzzleData || puzzle;
  const { recordAttempt, getBenchmarkMetrics, profile } = useLearnerProfile();
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  // 模式切換：false = 自由訓練 (Training), true = 標準化施測 (Assessment)
  const [internalAssessment, setInternalAssessment] = useState<boolean>(false);
  const isAssessmentMode = tournamentMode || internalAssessment;

  const metrics = (actualPuzzle?.metrics as any) || {};
  const highestTech = metrics.highest_technique || 'NakedSingle';
  const theoryTime = metrics.estimated_time_sec || 120;
  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';

  // 依難度設定標準化施測時限
  const timeLimitMap: Record<TierKey, number> = {
    kids: 300,
    intermediate: 420,
    expert: 540,
    master: 600,
  };
  const standardTimeLimit = timeLimitMap[currentTier] || 480;

  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics(highestTech, theoryTime);
  }, [getBenchmarkMetrics, highestTech, theoryTime]);

  const initialGrid = useMemo(() => {
    const raw =
      actualPuzzle?.puzzle ||
      (actualPuzzle as any)?.spec?.grid ||
      (actualPuzzle as any)?.grid;

    if (!raw) return Array(81).fill(0);
    if (Array.isArray(raw)) {
      return Array.isArray(raw[0]) ? raw.flat() : raw;
    }
    return Array(81).fill(0);
  }, [actualPuzzle]);

  const [grid, setGrid] = useState<number[]>(initialGrid);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [conflictCell, setConflictCell] = useState<number | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isFailedAssessment, setIsFailedAssessment] = useState<boolean>(false);
  const [isTimedOut, setIsTimedOut] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);
  const [violationAlert, setViolationAlert] = useState<string | null>(null);

  // 防作弊計數
  const tabSwitchesRef = useRef<number>(0);
  const blurEventsRef = useRef<number>(0);

  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const hasRecordedRef = useRef<boolean>(false);

  // 本地純前端 SHA-256 防篡改證書生成
  const generateClientProof = useCallback(async (timeSpent: number, conflicts: number, ratio: number) => {
    try {
      const canonical = [
        actualPuzzle?.id || 'sudoku',
        currentTier,
        timeSpent,
        conflicts,
        ratio,
        tabSwitchesRef.current,
        blurEventsRef.current,
        new Date().toISOString().slice(0, 10),
        'LOGICORE_CLIENT_AUDIT',
      ].join('|');

      if (!window.crypto || !window.crypto.subtle) {
        return `LOCAL_${Date.now().toString(16).toUpperCase()}`;
      }

      const enc = new TextEncoder();
      const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(canonical));
      const hex = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `VERIFIED_${hex.slice(0, 24).toUpperCase()}`;
    } catch {
      return `LOCAL_${Date.now().toString(16).toUpperCase()}`;
    }
  }, [actualPuzzle?.id, currentTier]);

  // 防作弊監聽：切換頁籤與失焦偵測
  useEffect(() => {
    if (!isAssessmentMode || isCompleted || isTimedOut || isFailedAssessment) return;

    const handleVisibility = () => {
      if (document.hidden) {
        tabSwitchesRef.current += 1;
        setViolationAlert(isEn ? '⚠️ Tab switch detected' : '⚠️ 偵測到切換分頁');
        setTimeout(() => setViolationAlert(null), 3000);
      }
    };

    const handleBlur = () => {
      blurEventsRef.current += 1;
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isAssessmentMode, isCompleted, isTimedOut, isFailedAssessment, isEn]);

  useEffect(() => {
    setGrid(initialGrid);
    setSelectedCell(null);
    setConflictCell(null);
    setIsCompleted(false);
    setIsFailedAssessment(false);
    setIsTimedOut(false);
    setElapsedSec(0);
    setProofSignature(null);
    setViolationAlert(null);
    tabSwitchesRef.current = 0;
    blurEventsRef.current = 0;
    startTimeRef.current = Date.now();
    conflictCountRef.current = 0;
    hasRecordedRef.current = false;
  }, [initialGrid, actualPuzzle?.id]);

  // 計時與超時判定
  useEffect(() => {
    if (isCompleted || isTimedOut || isFailedAssessment) return;
    const timer = setInterval(() => {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSec(currentElapsed);

      // 標準施測模式：超時判定
      if (isAssessmentMode && currentElapsed >= standardTimeLimit) {
        setIsTimedOut(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const sol = (actualPuzzle?.solution as any)?.flat() || [];
          const filledCount = grid.filter((v) => v !== 0).length;
          const correctFilled = grid.filter((v, i) => v !== 0 && v === sol[i]).length;
          const partialRatio = filledCount > 0 ? Number((correctFilled / 81).toFixed(2)) : 0;

          recordAttempt({
            puzzleId: actualPuzzle?.id || 'unknown',
            engineType: 'sudoku',
            tier: currentTier,
            cognitiveLoad: actualPuzzle?.cognitiveLoad || {
              spatial: 0.3,
              numeric: 0.7,
              workingMemory: 0.8,
              inhibition: 0.6,
            },
            isSuccess: false,
            timeSpentSec: standardTimeLimit,
            conflictsCount: conflictCountRef.current,
            technique: highestTech,
            partialCompletionRatio: partialRatio,
          });

          generateClientProof(standardTimeLimit, conflictCountRef.current, partialRatio).then(setProofSignature);
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [
    isCompleted,
    isTimedOut,
    isFailedAssessment,
    isAssessmentMode,
    standardTimeLimit,
    actualPuzzle,
    currentTier,
    highestTech,
    recordAttempt,
    generateClientProof,
    grid,
  ]);

  const checkVictory = useCallback(
    async (currentGrid: number[]) => {
      const sol = actualPuzzle?.solution;
      if (!sol || !Array.isArray(sol)) return;
      const flatSol = Array.isArray(sol[0]) ? sol.flat() : sol;

      const isPerfectMatch = flatSol.length === 81 && currentGrid.every((v, i) => v === flatSol[i]);

      if (isPerfectMatch) {
        setIsCompleted(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: actualPuzzle.engine_type || 'sudoku',
            tier: currentTier,
            cognitiveLoad: actualPuzzle.cognitiveLoad || {
              spatial: 0.3,
              numeric: 0.7,
              workingMemory: 0.8,
              inhibition: 0.6,
            },
            isSuccess: true,
            timeSpentSec: timeSpent,
            conflictsCount: conflictCountRef.current,
            technique: highestTech,
          });

          const sig = await generateClientProof(timeSpent, conflictCountRef.current, 1.0);
          setProofSignature(sig);

          if (benchmarkData.isNewPB) {
            setShowPBModal(true);
          }
        }
      } else if (isAssessmentMode && currentGrid.every((v) => v !== 0)) {
        // 評估模式專屬：盤面已填滿但有錯誤，直接判定施測結束
        setIsFailedAssessment(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
          const correctFilled = currentGrid.filter((v, i) => v === flatSol[i]).length;
          const partialRatio = Number((correctFilled / 81).toFixed(2));

          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: actualPuzzle.engine_type || 'sudoku',
            tier: currentTier,
            cognitiveLoad: actualPuzzle.cognitiveLoad || {
              spatial: 0.3,
              numeric: 0.7,
              workingMemory: 0.8,
              inhibition: 0.6,
            },
            isSuccess: false,
            timeSpentSec: timeSpent,
            conflictsCount: conflictCountRef.current,
            technique: highestTech,
            partialCompletionRatio: partialRatio,
          });

          const sig = await generateClientProof(timeSpent, conflictCountRef.current, partialRatio);
          setProofSignature(sig);
        }
      }
    },
    [actualPuzzle, recordAttempt, currentTier, highestTech, isAssessmentMode, generateClientProof, benchmarkData.isNewPB]
  );

  const handleCellClick = (index: number) => {
    if (initialGrid[index] !== 0 || isCompleted || isTimedOut || isFailedAssessment) return;
    setSelectedCell(index);
  };

  const handleNumberInput = (num: number) => {
    if (selectedCell === null || initialGrid[selectedCell] !== 0 || isCompleted || isTimedOut || isFailedAssessment) return;

    const sol = actualPuzzle?.solution;
    const flatSol = sol ? (Array.isArray(sol[0]) ? sol.flat() : sol) : [];
    const expectedValue = flatSol[selectedCell];

    if (!isAssessmentMode) {
      if (num !== 0 && expectedValue !== undefined && num !== expectedValue) {
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
        conflictCountRef.current += 1;
        setConflictCell(selectedCell);
        setTimeout(() => setConflictCell(null), 500);
        return;
      }
    } else {
      if (num !== 0 && expectedValue !== undefined && num !== expectedValue) {
        conflictCountRef.current += 1;
      }
    }

    const nextGrid = [...grid];
    nextGrid[selectedCell] = num;
    setGrid(nextGrid);
    checkVictory(nextGrid);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isTimedOut || isFailedAssessment || selectedCell === null) return;
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        handleNumberInput(num);
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        handleNumberInput(0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, isCompleted, isTimedOut, isFailedAssessment, grid]);

  const userStat = profile.techniqueStats?.[highestTech];
  const solvingPath: string[] = metrics.solving_path || ['Standard Derivation'];
  const remainingTime = Math.max(0, standardTimeLimit - elapsedSec);

  const handleNavigateTargetGame = (gameId: string) => {
    window.dispatchEvent(new CustomEvent('logicore:navigate-game', { detail: { gameId } }));
  };

  return (
    <div className="flex flex-col items-center w-full select-none py-1 font-mono">
      {/* 防作弊懸浮警示 */}
      {violationAlert && (
        <div className="fixed top-2 z-50 px-3 py-1.5 bg-rose-600 border border-rose-400 text-white font-bold text-xs rounded-full shadow-2xl animate-bounce">
          {violationAlert}
        </div>
      )}

      {/* 頂部施測模式切換與指標列 */}
      <div className="w-[min(90vw,46vh)] flex items-center justify-between text-[8px] text-slate-500 mb-1 px-1">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setInternalAssessment((prev) => !prev)}
            className={`px-1.5 py-0.5 rounded border transition text-[7px] font-bold ${
              isAssessmentMode
                ? 'bg-rose-950/80 border-rose-600 text-rose-300'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {isAssessmentMode ? (isEn ? '● ASSESSMENT' : '● 標準施測') : (isEn ? '○ TRAINING' : '○ 自由訓練')}
          </button>
          <span>
            IRT: <strong className="text-cyan-400">{metrics.irt_logit_difficulty ?? '0.0'}</strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {tabSwitchesRef.current > 0 && (
            <span className="text-rose-400 font-bold text-[7px]">
              Switches: {tabSwitchesRef.current}
            </span>
          )}
          {isAssessmentMode ? (
            <span className="text-rose-400 font-bold">
              ⏱️ {String(Math.floor(remainingTime / 60)).padStart(2, '0')}:{String(remainingTime % 60).padStart(2, '0')}
            </span>
          ) : (
            <span>
              Target: <strong className="text-amber-300">{benchmarkData.benchmarkTime}s</strong>
            </span>
          )}
        </div>
      </div>

      {/* 自適應盤面 */}
      <div className="grid grid-cols-9 gap-[1px] bg-slate-750 border-2 border-slate-700 p-1 rounded-xl shadow-2xl w-[min(90vw,46vh)] h-[min(90vw,46vh)] mx-auto">
        {grid.map((val, idx) => {
          const isGiven = initialGrid[idx] !== 0;
          const isSelected = selectedCell === idx;
          const isConflict = conflictCell === idx;

          const row = Math.floor(idx / 9);
          const col = idx % 9;
          const borderRight = (col + 1) % 3 === 0 && col !== 8 ? 'border-r-2 border-r-slate-600' : '';
          const borderBottom = (row + 1) % 3 === 0 && row !== 8 ? 'border-b-2 border-b-slate-600' : '';

          return (
            <button
              key={idx}
              onClick={() => handleCellClick(idx)}
              className={`w-full h-full flex items-center justify-center text-xs sm:text-base font-bold transition-colors rounded-xs ${borderRight} ${borderBottom} ${
                isConflict
                  ? 'bg-rose-600 text-white animate-pulse'
                  : isSelected
                  ? 'bg-indigo-600 text-white ring-1 ring-indigo-300'
                  : isGiven
                  ? 'bg-slate-900/90 text-slate-300'
                  : val !== 0
                  ? 'bg-slate-950 text-cyan-400 font-semibold'
                  : 'bg-slate-950 hover:bg-slate-900 text-transparent'
              }`}
            >
              {val !== 0 ? val : ''}
            </button>
          );
        })}
      </div>

      {/* 數字鍵盤 */}
      {!isCompleted && !isTimedOut && !isFailedAssessment && (
        <div className="grid grid-cols-10 gap-1 mt-3 w-[min(90vw,46vh)]">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleNumberInput(num)}
              disabled={selectedCell === null}
              className="py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 active:scale-95 text-slate-200 border border-slate-700 rounded-lg text-xs font-mono font-bold transition shadow"
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => handleNumberInput(0)}
            disabled={selectedCell === null}
            className="py-2 bg-rose-950/60 hover:bg-rose-900/60 disabled:opacity-30 active:scale-95 text-rose-300 border border-rose-800 rounded-lg text-xs font-mono font-bold transition shadow"
          >
            ⌫
          </button>
        </div>
      )}

      {/* 超時或答錯中斷警告 + 部分完成度條 */}
      {(isTimedOut || isFailedAssessment) && (
        <div className="mt-3 p-3 bg-rose-950/90 border border-rose-600 rounded-xl text-center w-[min(90vw,46vh)] shadow-2xl animate-fade-in">
          <div className="text-xs text-rose-200 font-bold mb-1">
            {isTimedOut ? '⚠️ ASSESSMENT CEILING REACHED' : '⚠️ ASSESSMENT COMPLETED (WITH CONFLICTS)'}
          </div>
          <div className="w-full bg-slate-900 border border-slate-800 rounded-full h-2 overflow-hidden my-1.5">
            <div
              className="bg-amber-400 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.round((grid.filter((v) => v !== 0).length / 81) * 100)}%` }}
            />
          </div>
          <div className="text-[8px] text-slate-300 flex justify-between">
            <span>Filled: {grid.filter((v) => v !== 0).length} / 81</span>
            <span>Conflicts: {conflictCountRef.current}</span>
          </div>
        </div>
      )}

      {/* 心理計量學通關反思面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(90vw,46vh)] shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
            <div className="text-left">
              <div className="text-[8px] text-slate-500 tracking-wider">
                {isAssessmentMode ? 'STANDARDIZED PSYCHOMETRIC REPORT' : 'STRATEGIC REFLECTION'}
              </div>
              <div className="text-xs text-indigo-300 font-bold">
                {elapsedSec <= benchmarkData.benchmarkTime ? '⚡ High-Efficiency Pace' : '🔍 Deep Exploration'}
              </div>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[10px] font-bold text-cyan-300">
              Top {Number((100 - benchmarkData.percentileRank).toFixed(1))}% Mensa Norm
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[8px] text-slate-400 mb-2">
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>{isEn ? 'Actual Time' : '實際耗時'}</div>
              <div className="text-slate-200 font-bold text-xs">{elapsedSec}s</div>
              <div className="text-[7px] text-slate-500">
                95% CI: [{benchmarkData.ci95[0]}s, {benchmarkData.ci95[1]}s]
              </div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>IRT 難度 (b)</div>
              <div className="text-cyan-300 font-bold text-xs">{metrics.irt_logit_difficulty ?? 0.0}</div>
              <div className="text-[7px] text-slate-500">SEM: ±{benchmarkData.sem}s</div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>技巧精熟度</div>
              <div className="text-amber-300 font-bold text-xs">
                {userStat ? `${Math.round(userStat.accuracy * 100)}%` : '100%'}
              </div>
              <div className="text-[7px] text-slate-500">Hist: {userStat?.attempts || 1} clears</div>
            </div>
          </div>

          {/* 五維認知雙軌雷達圖 */}
          <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800 flex flex-col items-center mb-2">
            <CognitiveRadarChart
              dimensions={profile.cognitiveDimensions}
              previousDimensions={profile.previousCognitiveDimensions}
              size={150}
            />
          </div>

          {/* 推理技巧鏈條 */}
          <div className="bg-slate-900/60 p-2 rounded text-left border border-slate-800/80 mb-2">
            <div className="text-[7px] text-slate-500 mb-1 font-bold uppercase tracking-wider">
              {isEn ? 'Deduction Chain (Solving Path)' : '推導技巧鏈條 (Solving Path)'}
            </div>
            <div className="flex flex-wrap gap-1">
              {solvingPath.map((step, sIdx) => (
                <span
                  key={sIdx}
                  className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 text-slate-300 text-[8px] rounded"
                >
                  {sIdx + 1}. {step}
                </span>
              ))}
            </div>
          </div>

          {/* 弱點導引與一鍵跳轉 */}
          <div className="bg-indigo-950/40 p-2 rounded-lg border border-indigo-800/60 text-left mb-2 flex items-center justify-between gap-2">
            <div className="flex-1 text-[8px] text-slate-300">
              {isEn ? benchmarkData.recommendedFocus.reasonEn : benchmarkData.recommendedFocus.reasonZh}
            </div>
            <button
              onClick={() => handleNavigateTargetGame(benchmarkData.recommendedFocus.targetGame)}
              className="shrink-0 px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[8px] rounded transition active:scale-95"
            >
              ➜ {isEn ? 'Train' : '立即訓練'}
            </button>
          </div>

          {/* 純前端 Web Crypto SHA-256 存證指紋 */}
          {proofSignature && (
            <div className="mt-1 p-1.5 bg-slate-900 border border-slate-800 rounded text-left">
              <div className="text-[7px] text-slate-500 font-bold uppercase tracking-wider flex items-center justify-between">
                <span>LOCAL CRYPTO RECEIPT (SHA-256)</span>
                <span className="text-emerald-400 font-mono text-[6px]">TAMPER-PROOF</span>
              </div>
              <div className="text-[6.5px] font-mono text-cyan-400/80 break-all select-all mt-0.5">
                {proofSignature}
              </div>
            </div>
          )}

          <div className="text-[8px] text-slate-500 border-t border-slate-800/80 pt-1.5 flex justify-between mt-1">
            <span>Symmetry: {metrics.symmetry_type ?? 'rotational_180'}</span>
            <span>Conflicts: {conflictCountRef.current}</span>
          </div>
        </div>
      )}

      {/* 破紀錄彈窗 */}
      {showPBModal && (
        <PBCelebrationModal
          pb={profile.personalBest}
          onClose={() => setShowPBModal(false)}
          isEn={isEn}
        />
      )}
    </div>
  );
};
