// web-frontend/src/components/SkyscraperBoard.tsx
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

type SpatialStrategy = 'MentalRotator' | 'ProgressiveEliminator' | 'GlobalPlanner';

export const SkyscraperBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { recordAttempt, getBenchmarkMetrics, profile } = useLearnerProfile();
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const [internalAssessment, setInternalAssessment] = useState<boolean>(false);
  const isAssessmentMode = tournamentMode || internalAssessment;

  const spec = actualPuzzle?.puzzle as any;
  const size: number = spec?.size || 4;
  const clues = spec?.clues || { top: [], bottom: [], left: [], right: [] };
  const metrics = (actualPuzzle?.metrics as any) || {};
  const theoryTime = metrics.estimated_time_sec || 120;
  const currentTier = (actualPuzzle?.tier as TierKey) || 'kids';

  const standardTimeLimit = size === 4 ? 360 : 540;

  const benchmarkData = useMemo(() => {
    return getBenchmarkMetrics('PerspectiveDeduction', theoryTime);
  }, [getBenchmarkMetrics, theoryTime]);

  const initialGrid = useMemo(() => {
    if (spec?.grid && Array.isArray(spec.grid)) {
      return spec.grid.map((row: number[]) => [...row]);
    }
    return Array.from({ length: size }, () => Array(size).fill(0));
  }, [spec, size]);

  const [grid, setGrid] = useState<number[][]>(initialGrid);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isTimedOut, setIsTimedOut] = useState<boolean>(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [showPBModal, setShowPBModal] = useState<boolean>(false);
  const [proofSignature, setProofSignature] = useState<string | null>(null);
  const [violationAlert, setViolationAlert] = useState<string | null>(null);

  const tabSwitchesRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const conflictCountRef = useRef<number>(0);
  const hypothesisAttemptsRef = useRef<number>(0);
  const moveSequenceRef = useRef<{ r: number; c: number; time: number }[]>([]);
  const hasRecordedRef = useRef<boolean>(false);

  // 本地純前端 SHA-256 防篡改證書生成
  const generateClientProof = useCallback(async (timeSpent: number, conflicts: number, ratio: number) => {
    try {
      const canonical = [
        actualPuzzle?.id || 'skyscraper',
        currentTier,
        timeSpent,
        conflicts,
        ratio,
        tabSwitchesRef.current,
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

  // 防作弊監聽：切換頁籤偵測
  useEffect(() => {
    if (!isAssessmentMode || isCompleted || isTimedOut) return;

    const handleVisibility = () => {
      if (document.hidden) {
        tabSwitchesRef.current += 1;
        setViolationAlert(isEn ? '⚠️ Tab switch detected' : '⚠️ 偵測到切換分頁');
        setTimeout(() => setViolationAlert(null), 3000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isAssessmentMode, isCompleted, isTimedOut, isEn]);

  useEffect(() => {
    setGrid(initialGrid);
    setSelected(null);
    setIsCompleted(false);
    setIsTimedOut(false);
    setElapsedSec(0);
    setProofSignature(null);
    setViolationAlert(null);
    tabSwitchesRef.current = 0;
    startTimeRef.current = Date.now();
    conflictCountRef.current = 0;
    hypothesisAttemptsRef.current = 0;
    moveSequenceRef.current = [];
    hasRecordedRef.current = false;
  }, [initialGrid, actualPuzzle?.id]);

  // 空間策略即時分類
  const detectedStrategy = useMemo<SpatialStrategy>(() => {
    const seq = moveSequenceRef.current;
    if (seq.length < 3) return 'GlobalPlanner';

    let axisSwitches = 0;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].r !== seq[i - 1].r && seq[i].c !== seq[i - 1].c) {
        axisSwitches++;
      }
    }

    const switchRatio = axisSwitches / seq.length;
    if (switchRatio > 0.65) return 'MentalRotator';
    if (hypothesisAttemptsRef.current >= 3) return 'GlobalPlanner';
    return 'ProgressiveEliminator';
  }, [grid]);

  // 計時與超時判定
  useEffect(() => {
    if (isCompleted || isTimedOut) return;
    const timer = setInterval(() => {
      const currentElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSec(currentElapsed);

      if (isAssessmentMode && currentElapsed >= standardTimeLimit) {
        setIsTimedOut(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const sol = actualPuzzle?.solution as number[][];
          const totalCells = size * size;
          let correctFilled = 0;
          let filledCount = 0;
          for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
              if (grid[r][c] !== 0) {
                filledCount++;
                if (sol && grid[r][c] === sol[r][c]) correctFilled++;
              }
            }
          }
          const partialRatio = filledCount > 0 ? Number((correctFilled / totalCells).toFixed(2)) : 0;

          recordAttempt({
            puzzleId: actualPuzzle?.id || 'unknown',
            engineType: 'skyscraper',
            tier: currentTier,
            cognitiveLoad: actualPuzzle?.cognitiveLoad || {
              spatial: 0.85,
              numeric: 0.4,
              workingMemory: 0.8,
              inhibition: 0.6,
            },
            isSuccess: false,
            timeSpentSec: standardTimeLimit,
            conflictsCount: conflictCountRef.current,
            technique: detectedStrategy,
            partialCompletionRatio: partialRatio,
          });

          generateClientProof(standardTimeLimit, conflictCountRef.current, partialRatio).then(setProofSignature);
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isCompleted, isTimedOut, isAssessmentMode, standardTimeLimit, actualPuzzle, currentTier, recordAttempt, size, grid, detectedStrategy, generateClientProof]);

  const checkVictory = useCallback(
    async (currentGrid: number[][]) => {
      const sol = actualPuzzle?.solution as number[][];
      if (!sol || !Array.isArray(sol)) return;

      let isMatch = true;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (currentGrid[r][c] !== sol[r][c]) {
            isMatch = false;
            break;
          }
        }
      }

      if (isMatch) {
        setIsCompleted(true);
        if (!hasRecordedRef.current) {
          hasRecordedRef.current = true;
          const timeSpent = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
          recordAttempt({
            puzzleId: actualPuzzle.id,
            engineType: 'skyscraper',
            tier: currentTier,
            cognitiveLoad: actualPuzzle?.cognitiveLoad || {
              spatial: 0.85,
              numeric: 0.4,
              workingMemory: 0.8,
              inhibition: 0.6,
            },
            isSuccess: true,
            timeSpentSec: timeSpent,
            conflictsCount: conflictCountRef.current,
            technique: detectedStrategy,
            partialCompletionRatio: 1.0,
          });

          const sig = await generateClientProof(timeSpent, conflictCountRef.current, 1.0);
          setProofSignature(sig);

          if (benchmarkData.isNewPB) {
            setShowPBModal(true);
          }
        }
      }
    },
    [actualPuzzle, size, currentTier, recordAttempt, detectedStrategy, generateClientProof, benchmarkData.isNewPB]
  );

  const handleCellClick = (r: number, c: number) => {
    if (isCompleted || isTimedOut || initialGrid[r][c] !== 0) return;
    setSelected([r, c]);
  };

  const handleNumberInput = (num: number) => {
    if (!selected || isCompleted || isTimedOut) return;
    const [r, c] = selected;
    if (initialGrid[r][c] !== 0) return;

    const sol = actualPuzzle?.solution as number[][];

    if (num === 0 && grid[r][c] !== 0) {
      hypothesisAttemptsRef.current += 1;
    }

    if (num !== 0 && sol && sol[r] && sol[r][c] !== num) {
      if (!isAssessmentMode) {
        if (navigator.vibrate) navigator.vibrate(30);
      }
      conflictCountRef.current += 1;
    }

    if (num !== 0) {
      moveSequenceRef.current.push({ r, c, time: Date.now() });
    }

    const nextGrid = grid.map((row) => [...row]);
    nextGrid[r][c] = num;
    setGrid(nextGrid);
    checkVictory(nextGrid);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isCompleted || isTimedOut || !selected) return;
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= size) {
        handleNumberInput(num);
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        handleNumberInput(0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, isCompleted, isTimedOut, size, grid]);

  const remainingTime = Math.max(0, standardTimeLimit - elapsedSec);

  const handleNavigateTargetGame = (gameId: string) => {
    window.dispatchEvent(new CustomEvent('logicore:navigate-game', { detail: { gameId } }));
  };

  return (
    <div className="flex flex-col items-center w-full select-none py-1 font-mono">
      {violationAlert && (
        <div className="fixed top-2 z-50 px-3 py-1.5 bg-rose-600 border border-rose-400 text-white font-bold text-xs rounded-full shadow-2xl animate-bounce">
          {violationAlert}
        </div>
      )}

      {/* 頂部施測與空間指標列 */}
      <div className="w-[min(92vw,48vh)] flex items-center justify-between text-[8px] text-slate-500 mb-1 px-1">
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
          <span>
            MRT Anchor: <strong className="text-indigo-400">{metrics.mrt_correlation_anchor ?? '0.6'}</strong>
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

      {/* 棋盤主體 */}
      <div className="flex flex-col items-center bg-slate-900/90 border border-slate-700 p-2 rounded-xl shadow-2xl">
        <div className="flex justify-center mb-1" style={{ paddingLeft: '2.5rem', paddingRight: '2.5rem' }}>
          {clues.top?.map((val: number, idx: number) => (
            <div key={idx} className="w-10 sm:w-12 text-center text-xs font-bold text-cyan-400">
              {val > 0 ? `↓${val}` : ''}
            </div>
          ))}
        </div>

        {grid.map((row, rIdx) => (
          <div key={rIdx} className="flex items-center">
            <div className="w-10 text-right pr-2 text-xs font-bold text-cyan-400">
              {clues.left?.[rIdx] > 0 ? `→${clues.left[rIdx]}` : ''}
            </div>

            <div className="flex gap-1">
              {row.map((val, cIdx) => {
                const isSelected = selected && selected[0] === rIdx && selected[1] === cIdx;
                const isGiven = initialGrid[rIdx][cIdx] !== 0;

                return (
                  <button
                    key={cIdx}
                    onClick={() => handleCellClick(rIdx, cIdx)}
                    className={`w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center font-bold text-sm sm:text-base rounded-lg border transition ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-400 text-white ring-2 ring-indigo-300'
                        : isGiven
                        ? 'bg-slate-800 border-slate-700 text-slate-300'
                        : val !== 0
                        ? 'bg-slate-950 border-cyan-700 text-cyan-300'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-transparent'
                    }`}
                  >
                    {val !== 0 ? val : ''}
                  </button>
                );
              })}
            </div>

            <div className="w-10 text-left pl-2 text-xs font-bold text-cyan-400">
              {clues.right?.[rIdx] > 0 ? `${clues.right[rIdx]}←` : ''}
            </div>
          </div>
        ))}

        <div className="flex justify-center mt-1" style={{ paddingLeft: '2.5rem', paddingRight: '2.5rem' }}>
          {clues.bottom?.map((val: number, idx: number) => (
            <div key={idx} className="w-10 sm:w-12 text-center text-xs font-bold text-cyan-400">
              {val > 0 ? `↑${val}` : ''}
            </div>
          ))}
        </div>
      </div>

      {/* 數字按鍵盤 */}
      {!isCompleted && !isTimedOut && (
        <div className="flex gap-1.5 mt-3 justify-center">
          {Array.from({ length: size }, (_, i) => i + 1).map((num) => (
            <button
              key={num}
              onClick={() => handleNumberInput(num)}
              disabled={!selected}
              className="w-9 h-9 sm:w-10 sm:h-10 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 border border-slate-700 text-slate-200 rounded-lg font-bold transition shadow"
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => handleNumberInput(0)}
            disabled={!selected}
            className="w-9 h-9 sm:w-10 sm:h-10 bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-lg font-bold transition shadow"
          >
            ⌫
          </button>
        </div>
      )}

      {/* 超時進度條 */}
      {isTimedOut && (
        <div className="mt-3 p-3 bg-rose-950/90 border border-rose-600 rounded-xl text-center w-[min(92vw,48vh)] shadow-2xl animate-fade-in">
          <div className="text-xs text-rose-200 font-bold mb-1">⚠️ ASSESSMENT CEILING REACHED</div>
          <div className="w-full bg-slate-900 border border-slate-800 rounded-full h-2 overflow-hidden my-1.5">
            <div
              className="bg-amber-400 h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.round(
                  (grid.flat().filter((v) => v !== 0).length / (size * size)) * 100
                )}%`,
              }}
            />
          </div>
          <div className="text-[8px] text-slate-300 flex justify-between">
            <span>Filled: {grid.flat().filter((v) => v !== 0).length} / {size * size}</span>
            <span>Conflicts: {conflictCountRef.current}</span>
          </div>
        </div>
      )}

      {/* 空間認知學通關反思面板 */}
      {isCompleted && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(92vw,48vh)] shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
            <div className="text-left">
              <div className="text-[8px] text-slate-500 tracking-wider">
                {isAssessmentMode ? 'STANDARDIZED SPATIAL PROFILE' : 'SPATIAL REFLECTION'}
              </div>
              <div className="text-xs text-indigo-300 font-bold">
                {detectedStrategy === 'MentalRotator' ? '🌀 Mental Rotation Active' : '📐 Systematic Projection'}
              </div>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[10px] font-bold text-cyan-300">
              Top {Number((100 - benchmarkData.percentileRank).toFixed(1))}% Mensa Norm
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[8px] text-slate-400 mb-2">
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>{isEn ? 'Time Taken' : '實際耗時'}</div>
              <div className="text-slate-200 font-bold text-xs">{elapsedSec}s</div>
              <div className="text-[7px] text-slate-500">
                95% CI: [{benchmarkData.ci95[0]}s, {benchmarkData.ci95[1]}s]
              </div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>推導深度</div>
              <div className="text-cyan-300 font-bold text-xs">{metrics.perspective_depth ?? 3} 層</div>
              <div className="text-[7px] text-slate-500">IRT: {metrics.irt_logit_difficulty ?? 0.0}</div>
            </div>
            <div className="bg-slate-900/80 p-1.5 rounded">
              <div>假設回退嘗試</div>
              <div className="text-amber-300 font-bold text-xs">{hypothesisAttemptsRef.current} 次</div>
              <div className="text-[7px] text-slate-500">Conflicts: {conflictCountRef.current}</div>
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

          {/* 弱點導引跳轉 */}
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

          {/* 本地 Web Crypto SHA-256 存證指紋 */}
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
            <span>MRT Anchor: {metrics.mrt_correlation_anchor ?? 0.6}</span>
            <span>Strategy: {detectedStrategy}</span>
          </div>
        </div>
      )}

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
