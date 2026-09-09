// web-frontend/src/components/SkyscraperBoard.tsx
import React, { useState, useEffect, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLanguage } from '../contexts/LanguageContext';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useSkyscraperGame, QWERTY_NUMBER_MAP } from '../hooks/useSkyscraperGame';
import { MetricErrorBar } from './MetricErrorBar';
import { CognitiveRadarChart } from './CognitiveRadarChart';
import { TournamentSubmissionModal } from './TournamentSubmissionModal';
import { calculateInfractionScore, getEnvironmentFingerprint } from '../utils/tournamentSecurity';

interface Props {
  puzzleData?: PuzzleEntity;
  puzzle?: PuzzleEntity;
  tournamentMode?: boolean;
}

export const SkyscraperBoard: React.FC<Props> = ({ puzzleData, puzzle, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { profile, getCompositeCognitiveIndex, exportLongitudinalDataset } = useLearnerProfile();
  const boardRef = useRef<HTMLDivElement>(null);

  if (!actualPuzzle) {
    return (
      <div className="flex items-center justify-center p-8 text-xs font-mono text-slate-500">
        {isEn ? 'Initializing Skyscraper Cockpit...' : '初始化摩天競技座艙中...'}
      </div>
    );
  }

  const {
    size,
    clues,
    grid,
    pencilMarks,
    isPencilMode,
    setIsPencilMode,
    selected,
    setSelected,
    preflightPreview,
    setPreflightPreview,
    computePreflightRayImpact,
    isCompleted,
    isResigned,
    isTimedOut,
    elapsedSec,
    theoryTime,
    splitPacing,
    remainingTime,
    isAssessmentMode,
    setInternalAssessment,
    detectedStrategy,
    lineValidityStatus,
    duplicateConflictSet,
    proofSignature,
    bookmarkToast,
    activeHint,
    hintTierLevel,
    lineDiagnostic,
    setLineDiagnostic,
    advanceMetacognitiveHint,
    undo,
    redo,
    moveCursor,
    handleNumberInput,
    handleBookmarkPuzzle,
    handleGracefulResign,
    benchmarkData,
    replayScript,
  } = useSkyscraperGame({ puzzle: actualPuzzle, tournamentMode, isEn });

  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const keyPressTimestampsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    boardRef.current?.focus();
  }, []);

  // 無模態鍵盤時間判定與全主鍵區映射 (Vim / QWERTY Home-row)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isCompleted || isTimedOut || isResigned) return;

    const key = e.key.toLowerCase();
    if (!keyPressTimestampsRef.current.has(key)) {
      keyPressTimestampsRef.current.set(key, performance.now());
    }

    // 撤銷 / 重做
    if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'y') {
      e.preventDefault();
      redo();
      return;
    }

    // 方向鍵與 Vim 盲打導航 (HJKL / WASD)
    if (e.key === 'ArrowUp' || key === 'k' || key === 'w') { e.preventDefault(); moveCursor(-1, 0); return; }
    if (e.key === 'ArrowDown' || key === 'j' || key === 's') { e.preventDefault(); moveCursor(1, 0); return; }
    if (e.key === 'ArrowLeft' || key === 'h' || key === 'a') { e.preventDefault(); moveCursor(0, -1); return; }
    if (e.key === 'ArrowRight' || key === 'l' || key === 'd') { e.preventDefault(); moveCursor(0, 1); return; }

    // 空白鍵切換預設鉛筆狀態
    if (e.key === ' ') {
      e.preventDefault();
      setIsPencilMode((prev) => !prev);
      return;
    }

    // 預測性虛擬沙盤透視 (當前按住數字鍵未放開時產生透視預覽)
    const previewNum = parseInt(key, 10) || QWERTY_NUMBER_MAP[key];
    if (previewNum && previewNum >= 1 && previewNum <= size && selected) {
      const impact = computePreflightRayImpact(selected[0], selected[1], previewNum);
      setPreflightPreview(impact);
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isCompleted || isTimedOut || isResigned) return;

    const key = e.key.toLowerCase();
    const startPress = keyPressTimestampsRef.current.get(key) || performance.now();
    keyPressTimestampsRef.current.delete(key);
    const duration = performance.now() - startPress;

    const num = parseInt(key, 10) || QWERTY_NUMBER_MAP[key];
    if (num && num >= 1 && num <= size) {
      e.preventDefault();
      // 無模態判定：按壓時間 >= 200ms 或附帶 Shift 視為鉛筆候選標記；短促敲擊 (<200ms) 視為確信落子
      const isPencilIntent = e.shiftKey || duration >= 200 || isPencilMode;
      handleNumberInput(num, isPencilIntent);
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      e.preventDefault();
      handleNumberInput(0, false);
    }
  };

  const cci = getCompositeCognitiveIndex();

  // 實時三幕式節奏指標計算
  const filledCells = grid.flat().filter((v) => v !== 0).length;
  const currentPacingPhase = filledCells < size * size * 0.25 ? 1 : filledCells < size * size * 0.75 ? 2 : 3;
  const targetPhaseSec = currentPacingPhase === 1 ? theoryTime * 0.2 : currentPacingPhase === 2 ? theoryTime * 0.55 : theoryTime * 0.25;
  const phasePacingDelta = Number((elapsedSec - targetPhaseSec).toFixed(1));

  return (
    <div
      ref={boardRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      className="flex flex-col items-center w-full select-none py-1 font-mono outline-none"
    >
      {/* 浮動提示與診斷 */}
      {bookmarkToast && (
        <div className="fixed top-2 z-50 px-3 py-1 bg-indigo-600 border border-indigo-400 text-white font-bold text-[10px] rounded-full shadow-lg animate-bounce">
          {bookmarkToast}
        </div>
      )}

      {lineDiagnostic && (
        <div className="fixed top-2 z-50 px-3 py-1.5 bg-slate-900 border border-rose-500 text-rose-200 font-bold text-[9px] rounded-lg shadow-2xl flex items-center gap-2 animate-fade-in">
          <span>⚠️ {lineDiagnostic}</span>
          <button onClick={() => setLineDiagnostic(null)} className="text-rose-400 hover:text-white ml-2 cursor-pointer">✕</button>
        </div>
      )}

      {/* 頂部三幕式認知節奏光條 (Real-Time Pacing Metronome) */}
      <div className="w-[min(92vw,48vh)] mb-1 px-1 flex flex-col gap-0.5">
        <div className="flex items-center justify-between text-[7px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className={currentPacingPhase === 1 ? 'text-cyan-400 font-bold' : 'text-slate-500'}>I. 開局</span>
            <span className="text-slate-600">/</span>
            <span className={currentPacingPhase === 2 ? 'text-amber-400 font-bold' : 'text-slate-500'}>II. 中局轉折</span>
            <span className="text-slate-600">/</span>
            <span className={currentPacingPhase === 3 ? 'text-emerald-400 font-bold' : 'text-slate-500'}>III. 終局連鎖</span>
          </span>
          <span className={phasePacingDelta <= 0 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
            {phasePacingDelta <= 0 ? `${phasePacingDelta}s (Flow Ahead)` : `+${phasePacingDelta}s (Pacing Lag)`}
          </span>
        </div>
        <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden flex border border-slate-800">
          <div
            className={`h-full transition-all duration-300 ${
              phasePacingDelta <= 0 ? 'bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.6)]' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.min(100, Math.round((filledCells / (size * size)) * 100))}%` }}
          />
        </div>
      </div>

      {/* 精簡控制列 */}
      <div className="w-[min(92vw,48vh)] flex items-center justify-between text-[8px] text-slate-400 mb-1 px-1">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setInternalAssessment((p) => !p)}
            className={`px-1.5 py-0.5 rounded border text-[7.5px] font-bold cursor-pointer transition ${
              isAssessmentMode ? 'bg-rose-950/80 border-rose-600 text-rose-300' : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
          >
            {isAssessmentMode ? (isEn ? '● ASSESSMENT' : '● 標準施測') : (isEn ? '○ PRACTICE' : '○ 自由練習')}
          </button>
          <span className="font-bold text-slate-300">
            ⏱️ {isAssessmentMode
              ? `${String(Math.floor(remainingTime / 60)).padStart(2, '0')}:${String(remainingTime % 60).padStart(2, '0')}`
              : `${elapsedSec}s`}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={undo} className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[7.5px] rounded cursor-pointer" title="Undo (Ctrl+Z)">↩</button>
          <button onClick={redo} className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[7.5px] rounded cursor-pointer" title="Redo (Ctrl+Y)">↪</button>
          <button
            onClick={() => setIsPencilMode((p) => !p)}
            className={`px-2 py-0.5 rounded border text-[7.5px] font-bold cursor-pointer transition flex items-center gap-1 ${
              isPencilMode
                ? 'bg-amber-950 border-amber-500 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
            title="Toggle Pencil (Space / Hold Key)"
          >
            <span>✎</span>
            <span>{isEn ? 'Pencil' : '候選標記'}</span>
          </button>
          <button
            onClick={advanceMetacognitiveHint}
            className={`px-2 py-0.5 border text-[7.5px] font-bold rounded flex items-center gap-1 transition cursor-pointer ${
              hintTierLevel > 0
                ? 'bg-amber-600 border-amber-400 text-white animate-pulse'
                : 'bg-amber-950/80 hover:bg-amber-900 border-amber-600 text-amber-300'
            }`}
          >
            <span>💡</span>
            <span>{hintTierLevel === 0 ? (isEn ? 'Hint' : '提示') : `L${hintTierLevel}`}</span>
          </button>
          <button onClick={handleBookmarkPuzzle} className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 text-[7.5px] rounded cursor-pointer" title="Save">📌</button>
          <button onClick={handleGracefulResign} className="px-1.5 py-0.5 bg-slate-900 hover:bg-rose-950/60 border border-slate-700 text-slate-400 hover:text-rose-300 text-[7.5px] rounded cursor-pointer" title="Resign">🕊️</button>
        </div>
      </div>

      {/* 漸進式元認知提示卡 */}
      {hintTierLevel > 0 && activeHint && (
        <div className="w-[min(92vw,48vh)] bg-slate-900/95 border border-amber-500/80 text-amber-200 text-[8px] p-2 rounded-lg mb-1.5 shadow-xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1">
            <span className="font-bold text-amber-400 tracking-wider">
              {hintTierLevel === 1 ? 'LEVEL 1: MACRO STRATEGY' : hintTierLevel === 2 ? 'LEVEL 2: TACTICAL REASONING' : 'LEVEL 3: ACTIONABLE PLACEMENT'}
            </span>
            <button onClick={advanceMetacognitiveHint} className="text-[7px] text-cyan-400 underline cursor-pointer">
              {hintTierLevel < 3 ? (isEn ? 'Deeper Hint ➔' : '進一步提示 ➔') : (isEn ? 'Close' : '關閉')}
            </button>
          </div>
          {hintTierLevel === 1 && <div>{isEn ? activeHint.macro.strategicIntentEn : activeHint.macro.strategicIntentZh}</div>}
          {hintTierLevel === 2 && <div><span className="text-cyan-300 font-bold">[{activeHint.tactical.technique}]: </span>{isEn ? activeHint.tactical.reasoningMechanismEn : activeHint.tactical.reasoningMechanismZh}</div>}
          {hintTierLevel === 3 && <div className="text-emerald-300 font-bold">👉 {isEn ? 'Confirm cell' : '鎖定座標'} ({activeHint.micro.targetCell[0] + 1}, {activeHint.micro.targetCell[1] + 1}) ➔ {activeHint.micro.val}</div>}
        </div>
      )}

      {/* 棋盤幾何核心 */}
      <div
        className="relative bg-slate-950 border border-slate-800 rounded-xl shadow-2xl p-2.5 flex flex-col items-center justify-center"
        style={{ width: 'min(92vw, 48vh)', height: 'min(92vw, 48vh)' }}
      >
        {/* 上方線索 */}
        <div
          className="grid gap-1 w-full mb-1"
          style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`, paddingLeft: '1.75rem', paddingRight: '1.75rem' }}
        >
          {clues.top.map((val, idx) => {
            const status = lineValidityStatus.top[idx];
            const isRayActive = selected && selected[1] === idx;
            const isPreflightViolate = preflightPreview && preflightPreview.predictedOutcome === 'WILL_VIOLATE' && isRayActive;

            return (
              <button
                key={idx}
                onClick={() => status.violated && setLineDiagnostic(status.reason)}
                className={`text-center text-[10px] sm:text-xs font-bold transition-all cursor-pointer ${
                  status.satisfied
                    ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]'
                    : status.violated
                    ? 'text-rose-500 font-black animate-pulse underline decoration-rose-500'
                    : isPreflightViolate
                    ? 'text-purple-400 font-black animate-ping'
                    : isRayActive
                    ? 'text-cyan-300 font-black scale-105'
                    : 'text-cyan-400/80'
                }`}
              >
                {val > 0 ? `↓${val}` : ''}
              </button>
            );
          })}
        </div>

        {/* 核心盤面 + 左右線索 */}
        <div className="w-full flex-1 flex flex-col justify-between gap-1">
          {grid.map((row, rIdx) => (
            <div key={rIdx} className="flex items-center w-full gap-1 flex-1">
              {/* 左側線索 */}
              <button
                onClick={() => lineValidityStatus.left[rIdx].violated && setLineDiagnostic(lineValidityStatus.left[rIdx].reason)}
                className={`w-6 text-right pr-1 text-[10px] sm:text-xs font-bold transition-all cursor-pointer ${
                  lineValidityStatus.left[rIdx].satisfied
                    ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]'
                    : lineValidityStatus.left[rIdx].violated
                    ? 'text-rose-500 font-black animate-pulse underline decoration-rose-500'
                    : selected && selected[0] === rIdx
                    ? 'text-cyan-300 font-black scale-105'
                    : 'text-cyan-400/80'
                }`}
              >
                {clues.left[rIdx] > 0 ? `→${clues.left[rIdx]}` : ''}
              </button>

              {/* 網格 */}
              <div className="flex-1 grid gap-1 h-full" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
                {row.map((val, cIdx) => {
                  const isSelected = selected && selected[0] === rIdx && selected[1] === cIdx;
                  const isGiven = (actualPuzzle.puzzle as any)?.grid?.[rIdx]?.[cIdx] > 0;
                  const isDuplicate = duplicateConflictSet.has(`${rIdx},${cIdx}`);
                  const isLineViolated =
                    lineValidityStatus.left[rIdx].violated ||
                    lineValidityStatus.right[rIdx].violated ||
                    lineValidityStatus.top[cIdx].violated ||
                    lineValidityStatus.bottom[cIdx].violated;
                  const marks = pencilMarks[rIdx][cIdx];

                  return (
                    <button
                      key={cIdx}
                      onClick={() => {
                        setSelected([rIdx, cIdx]);
                        setPreflightPreview(null);
                      }}
                      className={`relative w-full h-full flex items-center justify-center font-bold rounded-lg border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-950/80 border-cyan-400 ring-2 ring-cyan-400 z-10'
                          : isDuplicate
                          ? 'bg-rose-950/80 border-rose-500 text-rose-300 animate-pulse'
                          : isLineViolated && val !== 0
                          ? 'bg-rose-950/30 border-rose-800/80 text-rose-300'
                          : isGiven
                          ? 'bg-slate-900 border-slate-700 text-slate-400'
                          : val !== 0
                          ? 'bg-slate-950 border-cyan-900 text-cyan-300'
                          : 'bg-slate-950 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      {val !== 0 ? (
                        <span className="text-xs sm:text-base">{val}</span>
                      ) : (
                        <div
                          className="w-full h-full p-0.5 grid gap-0 pointer-events-none"
                          style={{ gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(size))}, 1fr)` }}
                        >
                          {Array.from({ length: size }, (_, i) => i + 1).map((n) => (
                            <span
                              key={n}
                              className={`flex items-center justify-center text-[6px] sm:text-[7px] font-mono leading-none ${
                                marks.has(n) ? 'text-amber-400 font-bold' : 'opacity-0'
                              }`}
                            >
                              {n}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 右側線索 */}
              <button
                onClick={() => lineValidityStatus.right[rIdx].violated && setLineDiagnostic(lineValidityStatus.right[rIdx].reason)}
                className={`w-6 text-left pl-1 text-[10px] sm:text-xs font-bold transition-all cursor-pointer ${
                  lineValidityStatus.right[rIdx].satisfied
                    ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]'
                    : lineValidityStatus.right[rIdx].violated
                    ? 'text-rose-500 font-black animate-pulse underline decoration-rose-500'
                    : selected && selected[0] === rIdx
                    ? 'text-cyan-300 font-black scale-105'
                    : 'text-cyan-400/80'
                }`}
              >
                {clues.right[rIdx] > 0 ? `${clues.right[rIdx]}←` : ''}
              </button>
            </div>
          ))}
        </div>

        {/* 下方線索 */}
        <div
          className="grid gap-1 w-full mt-1"
          style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`, paddingLeft: '1.75rem', paddingRight: '1.75rem' }}
        >
          {clues.bottom.map((val, idx) => {
            const status = lineValidityStatus.bottom[idx];
            const isRayActive = selected && selected[1] === idx;

            return (
              <button
                key={idx}
                onClick={() => status.violated && setLineDiagnostic(status.reason)}
                className={`text-center text-[10px] sm:text-xs font-bold transition-all cursor-pointer ${
                  status.satisfied
                    ? 'text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]'
                    : status.violated
                    ? 'text-rose-500 font-black animate-pulse underline decoration-rose-500'
                    : isRayActive
                    ? 'text-cyan-300 font-black scale-105'
                    : 'text-cyan-400/80'
                }`}
              >
                {val > 0 ? `↑${val}` : ''}
              </button>
            );
          })}
        </div>
      </div>

      {/* 底部按鈕輸入板 */}
      {!isCompleted && !isTimedOut && !isResigned && (
        <div className="flex gap-1.5 mt-2.5 justify-center w-[min(92vw,48vh)]">
          {Array.from({ length: size }, (_, i) => i + 1).map((num) => (
            <button
              key={num}
              onClick={() => handleNumberInput(num)}
              disabled={!selected}
              className={`flex-1 py-2 border rounded-lg font-bold text-xs transition shadow active:scale-95 cursor-pointer ${
                isPencilMode
                  ? 'bg-amber-950/60 hover:bg-amber-900 border-amber-600 text-amber-300'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => handleNumberInput(0)}
            disabled={!selected}
            className="px-3 py-2 bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-lg font-bold text-xs transition shadow active:scale-95 cursor-pointer"
            title="Clear (Backspace)"
          >
            ⌫
          </button>
        </div>
      )}

      {/* 結算面板 (覆盤破局點與三段式計時) */}
      {(isCompleted || isResigned) && (
        <div className="mt-3 p-3 bg-slate-950/95 border border-indigo-500/60 rounded-xl text-center w-[min(92vw,48vh)] shadow-2xl animate-fade-in font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
            <div className="text-left">
              <div className="text-[7.5px] text-slate-400">TACTICAL PROFILE: <span className="text-indigo-300 font-bold">{detectedStrategy}</span></div>
              <div className="text-xs text-indigo-300 font-bold">{isResigned ? (isEn ? '🕊️ Official Review' : '🕊️ 官方解答覆盤') : (isEn ? '✨ Solved' : '✨ 成功推導')}</div>
            </div>
            <div className="px-2 py-0.5 border border-cyan-500 bg-cyan-950/80 rounded text-[10px] font-bold text-cyan-300">
              IQ {cci.standardIQ}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[7.5px] text-slate-400 mb-2">
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Opening (25%)' : '開局階段'}</div>
              <div className="text-cyan-300 font-bold text-[10px]">{splitPacing.openingSec}s</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Midgame (50%)' : '中局轉折'}</div>
              <div className="text-amber-300 font-bold text-[10px]">{splitPacing.midgameSec}s</div>
            </div>
            <div className="bg-slate-900/80 p-1 rounded">
              <div>{isEn ? 'Endgame (25%)' : '終局連鎖'}</div>
              <div className="text-emerald-300 font-bold text-[10px]">{splitPacing.endgameSec}s</div>
            </div>
          </div>

          {replayScript.length > 0 && (
            <div className="mb-2 p-1.5 bg-slate-900/60 border border-slate-800 rounded text-left">
              <div className="text-[7px] text-amber-400 font-bold tracking-wider mb-1">⭐ THE CRUX DEDUCTIONS</div>
              <div className="max-h-24 overflow-y-auto space-y-1 pr-1 text-[7px]">
                {replayScript
                  .filter((s: any) => s.isCrux)
                  .map((crux: any, idx: number) => (
                    <div key={idx} className="p-1 bg-amber-950/40 border border-amber-600/50 rounded flex items-start gap-1">
                      <span className="text-amber-400 font-black">Step {crux.step}</span>
                      <span className="text-slate-300">{isEn ? crux.commentaryEn : crux.commentaryZh}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="mb-2">
            <MetricErrorBar
              actualVal={elapsedSec}
              benchmarkVal={benchmarkData.benchmarkTime}
              ci95={benchmarkData.ci95}
              sem={benchmarkData.sem}
              unit="s"
              isEn={isEn}
            />
          </div>

          <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800 flex flex-col items-center mb-2">
            <CognitiveRadarChart
              dimensions={profile.cognitiveDimensions}
              previousDimensions={profile.previousCognitiveDimensions}
              size={135}
            />
          </div>

          <div className="flex gap-1.5">
            <button onClick={exportLongitudinalDataset} className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 border border-cyan-600/50 text-cyan-300 text-[8px] font-bold rounded-lg transition">
              📊 {isEn ? 'Export Data' : '匯出數據'}
            </button>
            <button onClick={() => setShowSubmitModal(true)} className="flex-1 py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 text-slate-950 text-[8px] font-black rounded-lg transition">
              📤 {isEn ? 'Submit' : '賽事提交'}
            </button>
          </div>

          {proofSignature && (
            <div className="mt-2 p-1 bg-slate-900 border border-slate-800 rounded text-left text-[6.5px] text-cyan-400/80 break-all select-all font-mono">
              {proofSignature}
            </div>
          )}
        </div>
      )}

      {showSubmitModal && (
        <TournamentSubmissionModal
          payload={{
            submissionId: `SUB-${actualPuzzle.id}-${Date.now().toString(36)}`,
            tournamentId: tournamentMode ? 'WPF_SKYSCRAPER_2026' : 'GLOBAL_SPATIAL_STAGE',
            playerId: profile.personalBest.updatedAt ? 'CONTENDER_VERIFIED' : 'LOCAL_PLAYER_1',
            division: 'open',
            puzzleId: actualPuzzle.id,
            engineType: 'skyscraper',
            tier: actualPuzzle.tier as TierKey,
            timeSpentSec: elapsedSec,
            conflictsCount: 0,
            infractionScore: calculateInfractionScore({ tabSwitches: 0, blurEvents: 0, clipboardEvents: 0, untrustedEvents: 0 }),
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
