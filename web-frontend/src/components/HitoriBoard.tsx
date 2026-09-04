// web-frontend/src/components/HitoriBoard.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import {
  HitoriSpec,
  HitoriHintStep,
  WebHitoriGenerator,
  HITORI_SYMBOLIC_SETS,
  calibrateHitoriIrt,
} from '../engines/hitoriGenerator';
import { VaultManager } from '../utils/vaultStorage';

interface Props {
  puzzle?: PuzzleEntity;
  puzzleData?: PuzzleEntity;
  tournamentMode?: boolean;
}

type CellState = 0 | 1 | 2; // 0: 未定, 1: 塗黑 (■), 2: 圈白 (•)

export const HitoriBoard: React.FC<Props> = ({ puzzle, puzzleData, tournamentMode = false }) => {
  const actualPuzzle = puzzleData || puzzle;
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const { recordAttempt, getCompositeCognitiveIndex } = useLearnerProfile();

  const spec = (actualPuzzle?.puzzle || actualPuzzle) as unknown as HitoriSpec;
  const size = spec?.size || 4;
  const board = spec?.board || [];
  const solution = spec?.solution || [];
  const cruxCoords = (actualPuzzle?.metrics as any)?.cruxCoordinates || [0, 0];
  const depthProfile = (actualPuzzle?.metrics as any)?.depthProfile || [1, 2, 3, 2, 1];
  const eqClassCount = (actualPuzzle?.metrics as any)?.equivalenceClassCount || spec?.equivalenceClassCount || 4;
  const maxDecisionDepth = (actualPuzzle?.metrics as any)?.maxDecisionDepth || spec?.maxDecisionDepth || 2;
  const seed = (actualPuzzle?.metrics as any)?.seed || spec?.seed || 12345;
  const isSymmetric = (actualPuzzle?.metrics as any)?.isSymmetric ?? true;
  const edgeConnectivity = (actualPuzzle?.metrics as any)?.edgeConnectivity || spec?.edgeConnectivity || 2;
  const rhythmType = (actualPuzzle?.metrics as any)?.rhythmType || spec?.rhythmType || 'peaked';

  const [displayMode, setDisplayMode] = useState<'numeric' | 'symbolic_dots' | 'symbolic_geo'>('numeric');
  const [pureInferenceMode, setPureInferenceMode] = useState<boolean>(false);

  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CellState[][]>(() =>
    Array.from({ length: size }, () => Array(size).fill(0))
  );
  const [selectedCell, setSelectedCell] = useState<[number, number]>([0, 0]);
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  const [isTimeOut, setIsTimeOut] = useState<boolean>(false);

  const [cruxBreakthrough, setCruxBreakthrough] = useState<boolean>(false);
  const [seedCopied, setSeedCopied] = useState<boolean>(false);
  const [badgeCopied, setBadgeCopied] = useState<boolean>(false);
  const [isFav, setIsFav] = useState<boolean>(false);

  const estSteps = actualPuzzle?.metrics?.human_sim_steps || maxDecisionDepth * 3 || 12;

  const [hintsTriggeredCount, setHintsTriggeredCount] = useState<number>(0);
  const timeLimit = actualPuzzle?.metrics?.estimated_time_sec || 150;
  const [remainingSec, setRemainingSec] = useState<number>(timeLimit);
  const [accumulatedMs, setAccumulatedMs] = useState<number>(0);
  const lastActiveTimestamp = useRef<number>(performance.now());
  const isSuspended = useRef<boolean>(false);

  const [hintLevel, setHintLevel] = useState<number>(0);
  const [activeHint, setActiveHint] = useState<HitoriHintStep | null>(null);

  const renderValue = useCallback(
    (val: number) => {
      if (displayMode === 'symbolic_dots') return HITORI_SYMBOLIC_SETS.dots[val - 1] || `${val}`;
      if (displayMode === 'symbolic_geo') return HITORI_SYMBOLIC_SETS.geometric[val - 1] || `${val}`;
      return `${val}`;
    },
    [displayMode]
  );

  useEffect(() => {
    setState(Array.from({ length: size }, () => Array(size).fill(0)));
    setSelectedCell([0, 0]);
    setIsCompleted(false);
    setIsTimeOut(false);
    setCruxBreakthrough(false);
    setSeedCopied(false);
    setBadgeCopied(false);
    setIsFav(VaultManager.isFavorited(actualPuzzle?.id || ''));
    setRemainingSec(timeLimit);
    setAccumulatedMs(0);
    setHintsTriggeredCount(0);
    lastActiveTimestamp.current = performance.now();
    setHintLevel(0);
    setActiveHint(null);

    requestAnimationFrame(() => {
      boardContainerRef.current?.focus();
    });
  }, [actualPuzzle?.id, size, timeLimit]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) isSuspended.current = true;
      else {
        lastActiveTimestamp.current = performance.now();
        isSuspended.current = false;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (isCompleted || isTimeOut) return;
    const timer = setInterval(() => {
      if (isSuspended.current) return;
      const now = performance.now();
      const delta = now - lastActiveTimestamp.current;
      lastActiveTimestamp.current = now;

      setAccumulatedMs((prev) => {
        const next = prev + delta;
        if (tournamentMode) {
          const spentSec = Math.floor(next / 1000);
          const left = Math.max(0, timeLimit - spentSec);
          setRemainingSec(left);
          if (left === 0) setIsTimeOut(true);
        }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [isCompleted, isTimeOut, tournamentMode, timeLimit]);

  const conflicts = useMemo(() => {
    const set = new Set<string>();
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (state[r][c] === 1) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (WebHitoriGenerator.inBounds(nr, nc, size) && state[nr][nc] === 1) {
              set.add(`${r},${c}`);
