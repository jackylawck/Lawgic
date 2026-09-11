import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { PUZZLE_CATALOG, PuzzleEntity, TierKey } from '../generated';
import { ExtendedTierKey } from './useLearnerProfile';
import { ChallengeCodec } from '../utils/challengeCodec';

import { WebMazeGenerator } from '../engines/mazeGenerator';
import { WebSudokuGenerator } from '../engines/sudokuGenerator';
import { WebNonogramGenerator } from '../engines/nonogramGenerator';
import { WebNurikabeGenerator } from '../engines/nurikabeGenerator';
import { WebSkyscraperGenerator } from '../engines/skyscraperGenerator';
import { WebHashiGenerator } from '../engines/hashiGenerator';
import { WebKropkiGenerator } from '../engines/kropkiGenerator';
import { WebSlitherlinkGenerator } from '../engines/slitherlinkGenerator';
import { WebTentsGenerator } from '../engines/tentsGenerator';
import { WebLightUpGenerator } from '../engines/lightupGenerator';
import { WebFutoshikiGenerator } from '../engines/futoshikiGenerator';
import { WebHitoriGenerator } from '../engines/hitoriGenerator';
import { WebKakuroGenerator } from '../engines/kakuroGenerator';
import { WebMasyuGenerator } from '../engines/masyuGenerator';
import { WebDominoesGenerator } from '../engines/dominoesGenerator';
import { WebHeyawakeGenerator } from '../engines/heyawakeGenerator';
import { WebYajilinGenerator } from '../engines/yajilinGenerator';
import { WebShikakuGenerator } from '../engines/shikakuGenerator';

// 修復 TS2741：允許生成器為同步或非同步實作
export interface PuzzleGenerator {
  generate?(tier: TierKey): PuzzleEntity;
  generateAsync?(tier: TierKey): Promise<PuzzleEntity>;
}

const GENERATOR_REGISTRY: Record<string, any> = {
  maze: WebMazeGenerator,
  sudoku: WebSudokuGenerator,
  nonogram: WebNonogramGenerator,
  nurikabe: WebNurikabeGenerator,
  skyscraper: WebSkyscraperGenerator,
  hashi: WebHashiGenerator,
  kropki: WebKropkiGenerator,
  slitherlink: WebSlitherlinkGenerator,
  tents: WebTentsGenerator,
  lightup: WebLightUpGenerator,
  futoshiki: WebFutoshikiGenerator,
  hitori: WebHitoriGenerator,
  kakuro: WebKakuroGenerator,
  masyu: WebMasyuGenerator,
  dominoes: WebDominoesGenerator,
  heyawake: WebHeyawakeGenerator,
  yajilin: WebYajilinGenerator,
  shikaku: WebShikakuGenerator,
};

export const VALID_TIERS: ExtendedTierKey[] = [
  'kids',
  'intermediate',
  'expert',
  'master',
  'legendary',
  'ultimate',
];

const TIER_IRT_BASELINE: Record<ExtendedTierKey, number> = {
  kids: 0.65,
  intermediate: 1.45,
  expert: 2.35,
  master: 3.15,
  legendary: 3.75,
  ultimate: 4.35,
};

const MAX_CACHED_PER_TIER = 25;

async function generateEnginePuzzleAsync(gameId: string, tier: ExtendedTierKey): Promise<PuzzleEntity | null> {
  try {
    const genClass = GENERATOR_REGISTRY[gameId];
    if (!genClass) return null;

    let puzzle: any = null;
    if (typeof genClass.generateAsync === 'function') {
      puzzle = await genClass.generateAsync(tier as TierKey);
    } else if (typeof genClass.generate === 'function') {
      puzzle = await new Promise((resolve) => {
        setTimeout(() => resolve(genClass.generate(tier as TierKey)), 0);
      });
    }

    if (!puzzle) return null;
    if (!puzzle.engine_type) puzzle.engine_type = gameId;

    if (!puzzle.puzzle) {
      puzzle.puzzle = {
        rows: puzzle.rows || puzzle.size || 6,
        cols: puzzle.cols || puzzle.size || 6,
        clues: puzzle.clues,
        grid: puzzle.grid,
        solution: puzzle.solution,
        seed: puzzle.seed,
        pureDeductionRate: puzzle.pureDeductionRate || 1.0,
      };
    }

    puzzle.tier = tier;

    // 修復 TS2741：安全初始化 metrics
    const baselineIrt = TIER_IRT_BASELINE[tier];
    if (!puzzle.metrics) {
      puzzle.metrics = {
        irt_logit_difficulty: baselineIrt,
      };
    } else {
      puzzle.metrics.irt_logit_difficulty = Number(
        (puzzle.metrics.irt_logit_difficulty ? Math.max(puzzle.metrics.irt_logit_difficulty, baselineIrt) : baselineIrt).toFixed(2)
      );
    }

    return puzzle as PuzzleEntity;
  } catch (e) {
    console.error(`[Generator Error] ${gameId} @ ${tier}:`, e);
    return null;
  }
}

export function usePuzzlePool(
  selectedType: string,
  currentLevel: ExtendedTierKey,
  onChallengeLoaded?: (puzzle: PuzzleEntity) => void
) {
  const [puzzleIndex, setPuzzleIndex] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const isGeneratingRef = useRef<boolean>(false);
  const isManualGenRef = useRef<boolean>(false);
  const failureCountRef = useRef<number>(0);

  const [dynamicPool, setDynamicPool] = useState<Record<string, Record<ExtendedTierKey, PuzzleEntity[]>>>(() => ({}));

  useEffect(() => {
    failureCountRef.current = 0;
  }, [selectedType, currentLevel]);

  const currentTierDynamicPool = dynamicPool[selectedType]?.[currentLevel];

  const activeList = useMemo(() => {
    const staticCatalog = PUZZLE_CATALOG[selectedType] || [];
    const staticFiltered = staticCatalog.filter((p) => ((p.tier as ExtendedTierKey) || 'kids') === currentLevel);
    const liveList = currentTierDynamicPool || [];
    return [...liveList, ...staticFiltered];
  }, [selectedType, currentLevel, currentTierDynamicPool]);

  const activePuzzle = useMemo(() => {
    if (activeList.length === 0) return null;
    return activeList[puzzleIndex % activeList.length];
  }, [activeList, puzzleIndex]);

  const appendBatchPuzzles = useCallback(
    async (gameId: string, tier: ExtendedTierKey, count: number = 3) => {
      if (isGeneratingRef.current || failureCountRef.current >= 3) return;
      isGeneratingRef.current = true;
      setIsGenerating(true);

      try {
        const generated: PuzzleEntity[] = [];
        for (let i = 0; i < count; i++) {
          try {
            const p = await generateEnginePuzzleAsync(gameId, tier);
            if (p) {
              p.id = `${gameId}_${tier}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
              generated.push(p);
            }
          } catch (err) {
            console.warn(`Engine ${gameId} batch gen error:`, err);
          }
        }

        if (generated.length > 0) {
          failureCountRef.current = 0;
          setDynamicPool((prev) => {
            const gameBucket = prev[gameId] || {
              kids: [], intermediate: [], expert: [], master: [], legendary: [], ultimate: []
            };
            const tierBucket = gameBucket[tier] || [];
            
            const updated = [...tierBucket, ...generated];
            const bounded = updated.length > MAX_CACHED_PER_TIER 
              ? updated.slice(updated.length - MAX_CACHED_PER_TIER) 
              : updated;

            return {
              ...prev,
              [gameId]: {
                ...gameBucket,
                [tier]: bounded,
              },
            };
          });
        } else {
          failureCountRef.current += 1;
        }
      } finally {
        isGeneratingRef.current = false;
        setIsGenerating(false);
      }
    },
    []
  );

  useEffect(() => {
    if (activeList.length < 2 && !isGeneratingRef.current) {
      appendBatchPuzzles(selectedType, currentLevel, 3);
    }
  }, [selectedType, currentLevel, activeList.length, appendBatchPuzzles]);

  useEffect(() => {
    if (activeList.length > 0 && puzzleIndex >= activeList.length - 1 && !isGeneratingRef.current) {
      appendBatchPuzzles(selectedType, currentLevel, 3);
    }
  }, [puzzleIndex, activeList.length, selectedType, currentLevel, appendBatchPuzzles]);

  const triggerManualGenerate = useCallback(async () => {
    if (isManualGenRef.current) return false;
    isManualGenRef.current = true;
    setIsGenerating(true);

    try {
      const newPuzzle = await generateEnginePuzzleAsync(selectedType, currentLevel);
      if (newPuzzle) {
        failureCountRef.current = 0;
        newPuzzle.id = `${selectedType}_${currentLevel}_manual_${Date.now().toString(36)}`;
        setDynamicPool((prev) => {
          const gameBucket = prev[selectedType] || {
            kids: [], intermediate: [], expert: [], master: [], legendary: [], ultimate: []
          };
          const tierBucket = gameBucket[currentLevel] || [];
          
          return {
            ...prev,
            [selectedType]: {
              ...gameBucket,
              [currentLevel]: [newPuzzle, ...tierBucket],
            },
          };
        });
        setPuzzleIndex(0);
        return true;
      }
      failureCountRef.current += 1;
      return false;
    } finally {
      isManualGenRef.current = false;
      setIsGenerating(false);
    }
  }, [selectedType, currentLevel]);

  const onChallengeLoadedRef = useRef(onChallengeLoaded);
  useEffect(() => {
    onChallengeLoadedRef.current = onChallengeLoaded;
  }, [onChallengeLoaded]);

  useEffect(() => {
    const checkHashChallenge = () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#challenge=') && !hash.startsWith('#c=')) return;
      const code = hash.replace(/^#(challenge|c)=/, '');
      const imported = ChallengeCodec.decode(code);

      history.replaceState(null, '', window.location.pathname + window.location.search);

      if (!imported) return;

      const rawTier = imported.tier as ExtendedTierKey;
      const targetTier = VALID_TIERS.includes(rawTier) ? rawTier : 'kids';
      imported.tier = targetTier;

      setDynamicPool((prev) => {
        const gameBucket = prev[imported.engine_type] || {
          kids: [], intermediate: [], expert: [], master: [], legendary: [], ultimate: []
        };
        const currentList = gameBucket[targetTier] || [];
        return {
          ...prev,
          [imported.engine_type]: {
            ...gameBucket,
            [targetTier]: [imported, ...currentList],
          },
        };
      });
      setPuzzleIndex(0);
      onChallengeLoadedRef.current?.(imported);
    };

    checkHashChallenge();
    window.addEventListener('hashchange', checkHashChallenge);
    return () => window.removeEventListener('hashchange', checkHashChallenge);
  }, []);

  return {
    activeList,
    activePuzzle,
    puzzleIndex,
    setPuzzleIndex,
    isGenerating,
    triggerManualGenerate,
  };
}
