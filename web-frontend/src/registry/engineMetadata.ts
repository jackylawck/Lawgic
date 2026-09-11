// web-frontend/src/registry/engineMetadata.ts
import { CognitiveDimension } from '../types/cognitive';

export interface EngineMeta {
  readonly primaryDimension: CognitiveDimension;
  readonly aliases: readonly string[];
  readonly ui: {
    readonly nameZh: string;
    readonly nameEn: string;
    readonly icon: string;
  };
}

export interface PuzzleMeta {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly icon: string;
}

export const ENGINE_METADATA = {
  maze: {
    primaryDimension: 'spatial',
    aliases: [],
    ui: { nameZh: '空間迷宮', nameEn: 'Maze', icon: '🌀' },
  },
  skyscraper: {
    primaryDimension: 'spatial',
    aliases: ['skyscrapers'],
    ui: { nameZh: '摩天大樓', nameEn: 'Skyscraper', icon: '🏙️' },
  },
  masyu: {
    primaryDimension: 'spatial',
    aliases: ['pearl'],
    ui: { nameZh: '珍珠迴路', nameEn: 'Masyu', icon: '⚪' },
  },
  lightup: {
    primaryDimension: 'spatial',
    aliases: ['akari'],
    ui: { nameZh: '點亮燈泡', nameEn: 'Light Up', icon: '💡' },
  },
  yajilin: {
    primaryDimension: 'spatial',
    aliases: ['arrow_loop'],
    ui: { nameZh: '箭頭迴圈', nameEn: 'Yajilin', icon: '🔁' },
  },
  dominoes: {
    primaryDimension: 'spatial',
    aliases: ['domino'],
    ui: { nameZh: '骨牌密碼', nameEn: 'Dominoes', icon: '🀄' },
  },
  sudoku: {
    primaryDimension: 'numeric',
    aliases: [],
    ui: { nameZh: '數獨魔陣', nameEn: 'Sudoku', icon: '🔢' },
  },
  kakuro: {
    primaryDimension: 'numeric',
    aliases: ['cross_sums'],
    ui: { nameZh: '交叉十和', nameEn: 'Kakuro', icon: '➕' },
  },
  hashi: {
    primaryDimension: 'numeric',
    aliases: ['bridges', 'hashiwokakero'],
    ui: { nameZh: '星際數橋', nameEn: 'Hashi', icon: '🌉' },
  },
  shikaku: {
    primaryDimension: 'numeric',
    aliases: ['divide_by_squares'],
    ui: { nameZh: '方塊分割', nameEn: 'Shikaku', icon: '🔲' },
  },
  kropki: {
    primaryDimension: 'numeric',
    aliases: ['kropki_dots'],
    ui: { nameZh: '點距數論', nameEn: 'Kropki', icon: '⚫' },
  },
  futoshiki: {
    primaryDimension: 'numeric',
    aliases: ['futo', 'hutosiki'],
    ui: { nameZh: '不等之境', nameEn: 'Futoshiki', icon: '⚖️' },
  },
  nonogram: {
    primaryDimension: 'workingMemory',
    aliases: ['picross', 'griddlers'],
    ui: { nameZh: '數織像素', nameEn: 'Nonogram', icon: '🎨' },
  },
  slitherlink: {
    primaryDimension: 'workingMemory',
    aliases: ['fences', 'loop'],
    ui: { nameZh: '線索巡迴', nameEn: 'Slitherlink', icon: '➰' },
  },
  heyawake: {
    primaryDimension: 'workingMemory',
    aliases: ['heya'],
    ui: { nameZh: '隔間透視', nameEn: 'Heyawake', icon: '🚪' },
  },
  nurikabe: {
    primaryDimension: 'inhibition',
    aliases: [],
    ui: { nameZh: '黑海連橫', nameEn: 'Nurikabe', icon: '🌊' },
  },
  hitori: {
    primaryDimension: 'inhibition',
    aliases: [],
    ui: { nameZh: '孤芳自賞', nameEn: 'Hitori', icon: '👤' },
  },
  tents: {
    primaryDimension: 'processingSpeed',
    aliases: ['tentstrees', 'tents_and_trees'],
    ui: { nameZh: '營地之樹', nameEn: 'Tents & Trees', icon: '⛺' },
  },
} as const satisfies Record<string, EngineMeta>;

export type EngineTypeKey = keyof typeof ENGINE_METADATA;

export function normalizeAlias(raw: string): string {
  return raw.toLowerCase().trim().replace(/[\s-]+/g, '_');
}

export const ENGINE_ALIASES: Readonly<Record<string, EngineTypeKey>> = (() => {
  const map: Record<string, EngineTypeKey> = {};
  for (const [canonical, meta] of Object.entries(ENGINE_METADATA)) {
    for (const alias of meta.aliases) {
      map[normalizeAlias(alias)] = canonical as EngineTypeKey;
    }
  }
  return Object.freeze(map);
})();

export const ENGINE_PRIMARY_DIMENSION: Readonly<Record<string, CognitiveDimension>> = (() => {
  const map: Record<string, CognitiveDimension> = {};
  for (const [canonical, meta] of Object.entries(ENGINE_METADATA)) {
    map[canonical] = meta.primaryDimension;
  }
  return Object.freeze(map);
})();

export function normalizeEngineType(raw: string): string {
  const sanitized = normalizeAlias(raw);
  return ENGINE_ALIASES[sanitized] ?? sanitized;
}

/**
 * P1 行為契約：產生大小寫與符號無感的引擎比對函式
 */
export function createEngineMatcher(canonical: EngineTypeKey): (raw: string) => boolean {
  return (raw: string) => normalizeEngineType(raw) === canonical;
}

/**
 * P0 閉環：全域唯一選單清單，由 ENGINE_METADATA 100% 自動衍生
 */
export const ALL_GAMES: readonly PuzzleMeta[] = Object.freeze(
  Object.entries(ENGINE_METADATA).map(([id, meta]) => ({
    id,
    nameZh: meta.ui.nameZh,
    nameEn: meta.ui.nameEn,
    icon: meta.ui.icon,
  }))
);
