// web-frontend/src/components/MetricErrorBar.tsx
import React, { useMemo, useId } from 'react';
import { useLanguage, Language } from '../contexts/LanguageContext';
import { useAccessibilitySettings, ColorBlindMode } from '../contexts/AccessibilityContext';

/**
 * 計量指標極性定義：
 * - 'lower-is-better': 反應時間 (RT)、衝突次數、推導回溯延遲 (數值越低越佳)
 * - 'higher-is-better': 正確率、流體智力估計、工作記憶容量 (數值越高越佳)
 */
export type MetricPolarity = 'lower-is-better' | 'higher-is-better';

export interface MetricErrorBarProps {
  readonly actualVal: number;
  readonly benchmarkVal: number;
  readonly ci95: readonly [number, number];
  readonly sem: number;
  readonly unit?: string;
  readonly polarity?: MetricPolarity;
  readonly metricNameZh?: string;
  readonly metricNameEn?: string;
  /** 可選的語言覆蓋（例如匯出報告特定視圖使用），取代無法擴充的 isEn 布林值 */
  readonly forceLang?: Language;
}

interface EvaluationTheme {
  readonly labelZh: string;
  readonly labelEn: string;
  readonly glyph: string;
  readonly badgeClass: string;
  readonly markerColor: string;
}

function sanitizeNumber(val: unknown, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

/**
 * 依據色盲模式與極性解析臨床統計評價主題 (Okabe-Ito 體系)
 */
function resolveEvaluationTheme(
  actual: number,
  ciLow: number,
  ciHigh: number,
  polarity: MetricPolarity,
  colorBlindMode: ColorBlindMode,
  highContrast: boolean
): EvaluationTheme {
  const isSuperior = polarity === 'lower-is-better' ? actual < ciLow : actual > ciHigh;
  const isInferior = polarity === 'lower-is-better' ? actual > ciHigh : actual < ciLow;

  if (colorBlindMode === 'achromatopsia') {
    if (isSuperior) {
      return {
        labelZh: '顯著優於常模',
        labelEn: 'Superior to Norm',
        glyph: '▲',
        badgeClass: 'text-white bg-slate-900 border-white',
        markerColor: '#ffffff',
      };
    }
    if (isInferior) {
      return {
        labelZh: '認知負荷偏高',
        labelEn: 'High Cognitive Load',
        glyph: '▼',
        badgeClass: 'text-slate-300 bg-slate-950 border-slate-600',
        markerColor: '#94a3b8',
      };
    }
    return {
      labelZh: '常模區間內',
      labelEn: 'Within Normal Curve',
      glyph: '—',
      badgeClass: 'text-slate-400 bg-slate-950 border-slate-700',
      markerColor: '#cbd5e1',
    };
  }

  if (colorBlindMode === 'protanopia' || colorBlindMode === 'deuteranopia') {
    // 藍-琥珀色盲安全補償體系 (避開長中波紅綠混淆線)
    if (isSuperior) {
      return {
        labelZh: '顯著優於常模',
        labelEn: 'Superior to Norm',
        glyph: '▲',
        badgeClass: highContrast
          ? 'text-sky-300 bg-sky-950 border-sky-300'
          : 'text-sky-400 bg-sky-950/80 border-sky-500/60',
        markerColor: highContrast ? '#7dd3fc' : '#38bdf8',
      };
    }
    if (isInferior) {
      return {
        labelZh: '認知負荷偏高',
        labelEn: 'High Cognitive Load',
        glyph: '▼',
        badgeClass: highContrast
          ? 'text-amber-300 bg-amber-950 border-amber-300'
          : 'text-amber-400 bg-amber-950/80 border-amber-500/60',
        markerColor: highContrast ? '#fde047' : '#f59e0b',
      };
    }
    return {
      labelZh: '常模區間內',
      labelEn: 'Within Normal Curve',
      glyph: '—',
      badgeClass: 'text-slate-300 bg-slate-950 border-slate-700',
      markerColor: '#94a3b8',
    };
  }

  // 預設全彩光譜 (Standard Gamut)
  if (isSuperior) {
    return {
      labelZh: '顯著優於常模',
      labelEn: 'Superior to Norm',
      glyph: '▲',
      badgeClass: highContrast
        ? 'text-emerald-300 bg-emerald-950 border-emerald-300'
        : 'text-emerald-400 bg-emerald-950/80 border-emerald-500/60',
      markerColor: highContrast ? '#6ee7b7' : '#34d399',
    };
  }
  if (isInferior) {
    return {
      labelZh: '認知負荷偏高',
      labelEn: 'High Cognitive Load',
      glyph: '▼',
      badgeClass: highContrast
        ? 'text-rose-300 bg-rose-950 border-rose-300'
        : 'text-rose-400 bg-rose-950/80 border-rose-500/60',
      markerColor: highContrast ? '#fda4af' : '#fb7185',
    };
  }
  return {
    labelZh: '常模區間內',
    labelEn: 'Within Normal Curve',
    glyph: '—',
    badgeClass: 'text-cyan-400 bg-cyan-950/80 border-cyan-500/60',
    markerColor: '#38bdf8',
  };
}

export const MetricErrorBar: React.FC<MetricErrorBarProps> = ({
  actualVal,
  benchmarkVal,
  ci95,
  sem,
  unit = 's',
  polarity = 'lower-is-better',
  metricNameZh = '心理計量指標',
  metricNameEn = 'Psychometric Metric',
  forceLang,
}) => {
  const { lang: contextLang } = useLanguage();
  const currentLang = forceLang || contextLang;
  const isEn = currentLang === 'en';

  // 深度整合全域無障礙設定：色盲模式、高對比度與前庭減少動態
  const { colorBlindMode, highContrast, reducedMotion } = useAccessibilitySettings();

  // 唯一 ID 系統，確保標題關聯精確唯一
  const uniqueId = useId();
  const headingId = `metric-heading-${uniqueId}`;

  // 1. Primitive 解構、安全防禦與防禦性排序 (杜絕引用物件擊穿 memo 與上下界顛倒)
  const safeActual = useMemo(() => sanitizeNumber(actualVal, 0), [actualVal]);
  const safeBench = useMemo(() => sanitizeNumber(benchmarkVal, 0), [benchmarkVal]);

  const [rawA, rawB] = ci95;
  const rawLow = Math.min(rawA, rawB);
  const rawHigh = Math.max(rawA, rawB);

  // 設計決策：CI 缺失或無效時，fallback 至實際值與常模兩端邊界，保證圖表範圍合憲
  const safeCiLow = useMemo(
    () => sanitizeNumber(rawLow, Math.min(safeActual, safeBench)),
    [rawLow, safeActual, safeBench]
  );
  const safeCiHigh = useMemo(
    () => sanitizeNumber(rawHigh, Math.max(safeActual, safeBench)),
    [rawHigh, safeActual, safeBench]
  );

  // SEM 資料誠實性保護：開發模式警示負數指標異常，生產環境歸正防禦
  const safeSem = useMemo(() => {
    const raw = sanitizeNumber(sem, 0);
    if (import.meta.env.DEV && raw < 0) {
      console.warn(`[MetricErrorBar] Negative SEM received: ${raw}. Taking absolute value.`);
    }
    return Math.abs(raw);
  }, [sem]);

  // 2. 幾何投影記憶運算 (防禦微小數與零跨距，消除 render body 閉包開銷)
  // 設計決策：使用 left/width 佈局屬性在低頻結算下代碼最精確可控，可接受單次微小 reflow
  const { actualPos, benchPos, ciLeft, ciRight } = useMemo(() => {
    const rawMin = Math.min(safeActual, safeBench, safeCiLow);
    const rawMax = Math.max(safeActual, safeBench, safeCiHigh);
    // 相對動態 span：杜絕微小數被強制撐大，或相等時除以零
    const rawSpan = Math.max(Math.abs(rawMax) * 0.01, rawMax - rawMin) || 1;

    const computedMinRange = Math.max(0, rawMin - rawSpan * 0.2);
    const computedMaxRange = rawMax + rawSpan * 0.2;
    const rangeSpan = Math.max(0.0001, computedMaxRange - computedMinRange);

    const clampPercent = (v: number) => {
      const p = ((v - computedMinRange) / rangeSpan) * 100;
      return Math.max(4, Math.min(96, Number(p.toFixed(2))));
    };

    return {
      actualPos: clampPercent(safeActual),
      benchPos: clampPercent(safeBench),
      ciLeft: clampPercent(safeCiLow),
      ciRight: clampPercent(safeCiHigh),
    };
  }, [safeActual, safeBench, safeCiLow, safeCiHigh]);

  // 3. 領域統計分析與無障礙文字
  const evalTheme = useMemo(
    () => resolveEvaluationTheme(safeActual, safeCiLow, safeCiHigh, polarity, colorBlindMode, highContrast),
    [safeActual, safeCiLow, safeCiHigh, polarity, colorBlindMode, highContrast]
  );

  const metricTitle = isEn ? metricNameEn : metricNameZh;
  const statusLabel = isEn ? evalTheme.labelEn : evalTheme.labelZh;

  // WAI-ARIA 1.2 標準：包含 metricTitle 確保在螢幕閱讀器獨立巡航模式下具備完整語境
  const accessibleMeterText = `${metricTitle}: ${safeActual}${unit}, ${
    isEn ? 'benchmark' : '常模'
  } ${safeBench}${unit}, 95% CI ${safeCiLow}–${safeCiHigh}${unit}, SEM ±${safeSem}${unit}, ${statusLabel}.`;

  return (
    <div
      /* 採用 role="group" 取代過重的 role="region"，避免密集圖表導致頁面 Landmarks 膨脹 */
      role="group"
      aria-labelledby={headingId}
      /* 設計決策：採用固定 7px 字級以維持密集數據佈局的絕對穩定性，大字體模式由外層容器縮放保障 */
      className="w-full bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 font-mono text-[7px] select-none shadow-inner"
    >
      {/* 頂部 Header 與顯著性標籤 */}
      <div className="flex justify-between items-center text-slate-400 font-bold mb-1.5 gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* 修正：<h3> 顯式宣告 min-w-0，消除 flex-item 預設 min-width: auto 阻斷 truncate 的 CSS 缺陷 */}
          <h3 id={headingId} className="truncate min-w-0 text-[7px] font-bold text-slate-300 m-0 p-0">
            {metricTitle} · {isEn ? '95% CI BENCHMARK' : '95% 信賴區間對照'}
          </h3>
          {/* 設計決策：badge 標記 aria-hidden 避免重複播報；聽覺語意已完整融入 accessibleMeterText */}
          <span
            className={`px-1 py-0.5 rounded border text-[6.5px] font-bold flex items-center gap-0.5 shrink-0 ${evalTheme.badgeClass}`}
            aria-hidden="true"
          >
            <span>{evalTheme.glyph}</span>
            <span>{statusLabel}</span>
          </span>
        </div>
        <span className="text-cyan-400 font-bold shrink-0">
          SEM: ±{safeSem}{unit}
        </span>
      </div>

      {/* ARIA Meter 視覺化軌道
          遵循 WAI-ARIA 1.2 規範：
          1. 唯讀展示型元件，嚴禁掛載 tabIndex，不製造偽可互動焦點陷阱
          2. 採用 text-only meter 模式，單一依賴包含 metricTitle 的 aria-valuetext 自我描述 */}
      <div
        role="meter"
        aria-valuetext={accessibleMeterText}
        className="relative h-7 w-full flex items-center"
      >
        {/* 基準水平軸線 */}
        <div className="absolute inset-x-0 h-0.5 bg-slate-800 rounded-full" aria-hidden="true" />

        {/* 95% CI 範圍帶
            設計決策：CI 帶視覺寬度下限設為 2%，平衡極小視窗下的視覺可見性與統計相對精度；
            若啟用 reducedMotion 則移除過渡動畫，杜絕前庭刺激；平常僅針對 left 與 width 插值 */}
        <div
          className={`absolute h-3 bg-cyan-950/60 border-t border-b border-cyan-500/50 rounded-xs ${
            reducedMotion ? '' : 'transition-[left,width] duration-200'
          }`}
          style={{ left: `${ciLeft}%`, width: `${Math.max(2, ciRight - ciLeft)}%` }}
          aria-hidden="true"
        />

        {/* CI 左鬚線 */}
        <div
          className="absolute h-4 w-0.5 bg-cyan-400 rounded-full"
          style={{ left: `${ciLeft}%`, transform: 'translateX(-50%)' }}
          aria-hidden="true"
        />

        {/* CI 右鬚線 */}
        <div
          className="absolute h-4 w-0.5 bg-cyan-400 rounded-full"
          style={{ left: `${ciRight}%`, transform: 'translateX(-50%)' }}
          aria-hidden="true"
        />

        {/* 常模錨點 (WCAG 1.4.1 幾何形狀通道分離：常模使用旋轉 45 度菱形) */}
        <div
          className="absolute w-2.5 h-2.5 bg-amber-400 shadow-sm shadow-amber-400/80 z-10"
          style={{ left: `${benchPos}%`, transform: 'translateX(-50%) rotate(45deg)' }}
          aria-hidden="true"
        />

        {/* 實際表現錨點 (高光實體圓點 + 動態無障礙補償色階光環) */}
        <div
          className={`absolute w-3 h-3 rounded-full border-2 border-slate-950 shadow-md z-20 ${
            reducedMotion ? '' : 'transition-[left,background-color] duration-200'
          }`}
          style={{
            left: `${actualPos}%`,
            backgroundColor: evalTheme.markerColor,
            transform: 'translateX(-50%)',
            boxShadow: `0 0 8px ${evalTheme.markerColor}`,
          }}
          aria-hidden="true"
        />
      </div>

      {/* 底部數據與圖例 (雙通道形狀 + 雙向色票對齊)
          設計決策：保留可讀文字圖例屬於刻意的保守冗餘設計，確保任何螢幕閱讀器與弱視使用者均能獲取精確數值 */}
      <div className="flex justify-between items-center text-[6.5px] text-slate-500 mt-1 border-t border-slate-800/60 pt-1">
        <div className="flex items-center gap-1">
          <span
            className="w-2 h-2 rounded-full inline-block border border-slate-950 shrink-0"
            style={{ backgroundColor: evalTheme.markerColor }}
            aria-hidden="true"
          />
          <span>
            {isEn ? 'Actual' : '實際'}: <strong className="text-slate-200">{safeActual}{unit}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* 幾何形狀通道分離：常模採旋轉 45 度菱形 */}
          <span className="w-1.5 h-1.5 rotate-45 bg-amber-400 inline-block shrink-0" aria-hidden="true" />
          <span>
            {isEn ? 'Norm' : '常模'}: <strong className="text-slate-200">{safeBench}{unit}</strong>
          </span>
        </div>

        <div className="shrink-0 text-slate-400">
          <span>95% CI: [{safeCiLow} - {safeCiHigh}{unit}]</span>
        </div>
      </div>
    </div>
  );
};
