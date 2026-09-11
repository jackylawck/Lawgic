import { useLanguage } from '../contexts/LanguageContext';

export const TRANSLATIONS = {
  zh: {
    actions: {
      prev: '◀ 上一題',
      next: '下一題 ▶',
      generate: '現場生成',
      tierStepDown: '降階調整 (-1)',
      tierStepUp: '升階挑戰 (+1)',
      smartDrill: '智能靶向',
      mark: '標記',
      close: '關閉',
    },
    status: {
      synthesizing: '神經網絡拓撲生成中...',
      loading: '題目載入生成中...',
      tournamentOn: '🏆 賽事認證模式',
      tournamentOff: '○ 自由訓練模式',
      zeroTrustVerified: 'W3C 零信任密碼學存證就緒',
      complianceNotice: '架構治理與合規聲明',
      vaultCard: '傳奇金庫',
      puzzleProgress: '進度',
      titleSuffix: '羅輯・遊戲',
    },
    toast: {
      dynamicSynthesized: '⚡ 演算法已即時合成全新題目',
      badgeCopied: '📋 認證戰績卡已複製至剪貼簿！',
      clipboardDenied: '⚠️ 剪貼簿存取遭拒',
      clipboardUnsupported: '⚠️ 環境不支援剪貼簿複製',
      challengeLoaded: (name: string, irt: string | number) =>
        `🎯 賽事挑戰載入！【${name} · 難度 IRT ${irt}】`,
    },
    tiers: {
      kids: '兒童',
      intermediate: '進階',
      expert: '專家',
      master: '大師',
      legendary: '傳奇',
      ultimate: '終極',
    },
  },
  en: {
    actions: {
      prev: '◀ Prev',
      next: 'Next ▶',
      generate: 'Generate',
      tierStepDown: 'Tier Step (-1)',
      tierStepUp: 'Tier Jump (+1)',
      smartDrill: 'AI Drill',
      mark: 'MARK',
      close: 'Close',
    },
    status: {
      synthesizing: 'Synthesizing Topology...',
      loading: 'Generating puzzles...',
      tournamentOn: '🏆 TOURNAMENT SANCTIONED',
      tournamentOff: '○ TOURNAMENT OFF',
      zeroTrustVerified: 'W3C Zero-Trust Proof Active',
      complianceNotice: 'Governance & Compliance',
      vaultCard: 'Legendary Vault',
      puzzleProgress: 'Puzzle',
      titleSuffix: 'Logic Arena',
    },
    toast: {
      dynamicSynthesized: '⚡ Dynamic puzzle synthesized',
      badgeCopied: '📋 ASCII Badge copied to clipboard!',
      clipboardDenied: '⚠️ Clipboard access denied',
      clipboardUnsupported: '⚠️ Clipboard API not supported',
      challengeLoaded: (name: string, irt: string | number) =>
        `🎯 Challenge Loaded! [${name} · IRT ${irt}]`,
    },
    tiers: {
      kids: 'Kids',
      intermediate: 'Intermediate',
      expert: 'Expert',
      master: 'Master',
      legendary: 'Legendary',
      ultimate: 'Ultimate',
    },
  },
} as const;

export type TranslationKeys = typeof TRANSLATIONS.zh;

export function useT(): TranslationKeys {
  const { lang } = useLanguage();
  return TRANSLATIONS[lang === 'en' ? 'en' : 'zh'];
}
