// web-frontend/src/components/CognitiveRadarChart.tsx
import React, { useState, useMemo, useId } from 'react';
import { CognitiveDimension } from '../types/cognitive';
import { useLanguage } from '../contexts/LanguageContext';
import { useAccessibilitySettings, ColorBlindMode } from '../contexts/AccessibilityContext';

/**
 * 認知雷達圖屬性契約
 * 
 * @param dimensions 5 維認知構念分數，標準值域 [0.0, 1.0]。
 *                  若數值非有限數值、小於 SAFE_MIN 或缺失，將錨定至 SAFE_MIN (0.12) 邊緣基準，避免偽造 50% 假象。
 * @param previousDimensions 歷史基準分數，標準值域 [0.0, 1.0]。若缺失則成長率為 null，顯示為「無基準」。
 * @param size SVG 正方形畫布邊長 (px)，支援響應式動態縮放
 */
export interface CognitiveRadarChartProps {
  readonly dimensions: Readonly<Record<CognitiveDimension, number>>;
  readonly previousDimensions?: Readonly<Record<CognitiveDimension, number>>;
  readonly size?: number;
}

interface AxisMeta {
  readonly key: CognitiveDimension;
  readonly labelZh: string;
  readonly labelEn: string;
  readonly shortEn: string;
}

interface PaletteTheme {
  readonly currentFill: string;
  readonly currentStroke: string;
  readonly baselineFill: string;
  readonly baselineStroke: string;
  readonly positiveText: string;
  readonly negativeText: string;
  readonly neutralText: string;
  readonly gridStroke: string;
  readonly axisStroke: string;
  readonly labelFill: string;
  readonly labelHoverFill: string;
  readonly activeHalo: string;
}

interface GrowthItem {
  readonly key: CognitiveDimension;
  readonly label: string;
  readonly fullLabel: string;
  readonly val: number;
  readonly rate: number | null;
  readonly glyph: string;
}

const BASE_SIZE = 180;
const SAFE_MIN = 0.12;
const SAFE_MAX = 1.0;
const BASELINE_DISTINCT_THRESHOLD = 0.03;
const MIN_FONT_SIZE = 6.5;
const MAX_FONT_SIZE = 13;

const AXIS_CONFIG: readonly AxisMeta[] = Object.freeze([
  { key: 'spatial', labelZh: '空間視覺', labelEn: 'Spatial (Gv)', shortEn: 'Spatial' },
  { key: 'numeric', labelZh: '數理邏輯', labelEn: 'Quantitative (Gq)', shortEn: 'Numeric' },
  { key: 'workingMemory', labelZh: '工作記憶', labelEn: 'Working Mem (Gsm)', shortEn: 'Memory' },
  { key: 'inhibition', labelZh: '抑制控制', labelEn: 'Inhibition (Gs)', shortEn: 'Inhibit' },
  { key: 'processingSpeed', labelZh: '反應速度', labelEn: 'Speed (Gt)', shortEn: 'Speed' },
]);

const AXIS_MAP: ReadonlyMap<CognitiveDimension, AxisMeta> = new Map(
  AXIS_CONFIG.map((a) => [a.key, a])
);

const TOTAL_AXES = AXIS_CONFIG.length;
const ANGLE_SLICE = (Math.PI * 2) / TOTAL_AXES;

const CHART_TEXT = {
  en: {
    title: 'Cognitive Ability Radar Chart',
    desc: 'Radar chart mapping five cognitive dimensions under CHC theory: Spatial, Numeric, Working Memory, Inhibition, and Processing Speed.',
    emptyTitle: 'No Evaluation Baseline',
    emptySub: 'Complete sessions to build profile',
    breakdownLabel: 'Cognitive dimensions breakdown',
    growth: 'Growth',
    noBaseline: 'No baseline',
    noChange: 'no change',
    baseline: 'Previous Baseline Profile',
    current: 'Current Cognitive Profile',
  },
  zh: {
    title: '認知能力五維雷達圖',
    desc: '依據 CHC 認知架構繪製之五維能力雷達圖：包含空間視覺、數理邏輯、工作記憶、抑制控制與反應速度。',
    emptyTitle: '尚無評估數據基準',
    emptySub: '完成解題後即刻繪製認知雷達',
    breakdownLabel: '認知維度詳細數據',
    growth: '成長率',
    noBaseline: '無基準',
    noChange: '無變化',
    baseline: '歷史基準輪廓',
    current: '當前評估能力輪廓',
  },
} as const;

/**
 * 數值防禦歸一化：非數值、缺失或 0 分一律錨定至 SAFE_MIN (0.12)，
 * 在極坐標多邊形中收縮至核心，杜絕偽造中間值
 */
function sanitizeScore(val: unknown): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    return SAFE_MIN;
  }
  return Math.max(SAFE_MIN, Math.min(SAFE_MAX, val));
}

/**
 * 極坐標轉直角坐標純函數 (頂層常駐，零閉包開銷)
 */
function polarToCartesian(
  axisIndex: number,
  normalizedValue: number,
  center: number,
  radius: number,
  extraRadiusMultiplier = 1.0
): { x: number; y: number } {
  const angle = axisIndex * ANGLE_SLICE - Math.PI / 2;
  const r = radius * normalizedValue * extraRadiusMultiplier;
  return {
    x: center + r * Math.cos(angle),
    y: center + r * Math.sin(angle),
  };
}

/**
 * 構建 SVG 多邊形點字串
 */
function buildPolygonPoints(
  dims: Readonly<Record<CognitiveDimension, number>>,
  center: number,
  radius: number
): string {
  return AXIS_CONFIG.map((axis, i) => {
    const val = sanitizeScore(dims[axis.key]);
    const pt = polarToCartesian(i, val, center, radius);
    return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  }).join(' ');
}

/**
 * 依據色盲模式與高對比偏好動態派發臨床補償配色 (Okabe-Ito 體系)
 */
function resolvePalette(mode: ColorBlindMode, highContrast: boolean): PaletteTheme {
  if (mode === 'achromatopsia') {
    return {
      currentFill: highContrast ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.25)',
      currentStroke: '#ffffff',
      baselineFill: 'rgba(100, 116, 139, 0.1)',
      baselineStroke: '#64748b',
      positiveText: '#ffffff',
      negativeText: '#cbd5e1',
      neutralText: '#94a3b8',
      gridStroke: highContrast ? '#64748b' : '#334155',
      axisStroke: highContrast ? '#475569' : '#1e293b',
      labelFill: highContrast ? '#f8fafc' : '#94a3b8',
      labelHoverFill: '#ffffff',
      activeHalo: '#ffffff',
    };
  }

  if (mode === 'protanopia' || mode === 'deuteranopia') {
    // 藍-琥珀補償體系 (避開長中波紅綠混淆線)
    return {
      currentFill: highContrast ? 'rgba(0, 114, 178, 0.45)' : 'rgba(0, 114, 178, 0.35)',
      currentStroke: highContrast ? '#7dd3fc' : '#56b4e9',
      baselineFill: 'rgba(230, 159, 0, 0.12)',
      baselineStroke: '#e69f00',
      positiveText: highContrast ? '#7dd3fc' : '#38bdf8',
      negativeText: highContrast ? '#fde047' : '#f59e0b',
      neutralText: '#94a3b8',
      gridStroke: highContrast ? '#475569' : '#334155',
      axisStroke: highContrast ? '#334155' : '#1e293b',
      labelFill: highContrast ? '#f8fafc' : '#94a3b8',
      labelHoverFill: '#38bdf8',
      activeHalo: '#38bdf8',
    };
  }

  if (mode === 'tritanopia') {
    // 硃砂紅-藍綠補償體系 (避開短波藍黃混淆線)
    return {
      currentFill: highContrast ? 'rgba(213, 94, 0, 0.45)' : 'rgba(213, 94, 0, 0.35)',
      currentStroke: highContrast ? '#fb923c' : '#d55e00',
      baselineFill: 'rgba(0, 158, 115, 0.12)',
      baselineStroke: '#009e73',
      positiveText: highContrast ? '#5eead4' : '#2dd4bf',
      negativeText: highContrast ? '#fca5a5' : '#f87171',
      neutralText: '#94a3b8',
      gridStroke: highContrast ? '#475569' : '#334155',
      axisStroke: highContrast ? '#334155' : '#1e293b',
      labelFill: highContrast ? '#f8fafc' : '#94a3b8',
      labelHoverFill: '#2dd4bf',
      activeHalo: '#2dd4bf',
    };
  }

  // 預設全色域光譜 (Standard Gamut)
  return {
    currentFill: highContrast ? 'rgba(99, 102, 241, 0.45)' : 'rgba(99, 102, 241, 0.35)',
    currentStroke: highContrast ? '#c7d2fe' : '#818cf8',
    baselineFill: 'rgba(148, 163, 184, 0.08)',
    baselineStroke: '#64748b',
    positiveText: highContrast ? '#6ee7b7' : '#10b981',
    negativeText: highContrast ? '#fda4af' : '#f43f5e',
    neutralText: '#94a3b8',
    gridStroke: highContrast ? '#475569' : '#334155',
    axisStroke: highContrast ? '#334155' : '#1e293b',
    labelFill: highContrast ? '#f8fafc' : '#94a3b8',
    labelHoverFill: '#38bdf8',
    activeHalo: '#38bdf8',
  };
}

export const CognitiveRadarChart: React.FC<CognitiveRadarChartProps> = ({
  dimensions,
  previousDimensions,
  size = BASE_SIZE,
}) => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';
  const t = CHART_TEXT[lang];

  // 深度整合全域無障礙體系
  const { reducedMotion, highContrast, colorBlindMode } = useAccessibilitySettings();

  const [hoveredAxis, setHoveredAxis] = useState<CognitiveDimension | null>(null);

  const uniqueId = useId();
  const titleId = `radar-title-${uniqueId}`;
  const descId = `radar-desc-${uniqueId}`;

  const center = size / 2;
  const radius = center * 0.54;
  const scaleFactor = size / BASE_SIZE;
  // 雙向防夾：下限保護小字清晰度，上限防止超大尺寸字級擠壓
  const responsiveFontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, 7.5 * scaleFactor));

  // 動態補償色票
  const palette = useMemo(
    () => resolvePalette(colorBlindMode, highContrast),
    [colorBlindMode, highContrast]
  );

  // 檢查資料是否具備實質數值
  const hasAnyData = useMemo(() => {
    return AXIS_CONFIG.some((axis) => {
      const v = dimensions[axis.key];
      return typeof v === 'number' && Number.isFinite(v) && v > 0;
    });
  }, [dimensions]);

  // 1. 當前能力多邊形頂點
  const currentPoints = useMemo(
    () => buildPolygonPoints(dimensions, center, radius),
    [dimensions, center, radius]
  );

  // 2. 歷史基準顯著性判斷
  const hasDistinctBaseline = useMemo(() => {
    if (!previousDimensions) return false;
    return AXIS_CONFIG.some((axis) => {
      const cur = sanitizeScore(dimensions[axis.key]);
      const prev = sanitizeScore(previousDimensions[axis.key]);
      return Math.abs(cur - prev) >= BASELINE_DISTINCT_THRESHOLD;
    });
  }, [dimensions, previousDimensions]);

  // 3. 歷史基準多邊形頂點
  const prevPoints = useMemo(() => {
    if (!hasDistinctBaseline || !previousDimensions) return null;
    return buildPolygonPoints(previousDimensions, center, radius);
  }, [hasDistinctBaseline, previousDimensions, center, radius]);

  // 4. 層級 1：純數值成長率計算（不依賴 palette，主題切換零重算）
  const growthValues = useMemo<GrowthItem[]>(() => {
    const hasBaseline = Boolean(previousDimensions);

    return AXIS_CONFIG.map((axis) => {
      const cur = sanitizeScore(dimensions[axis.key]);
      if (!hasBaseline || !previousDimensions) {
        return {
          key: axis.key,
          label: isEn ? axis.shortEn : axis.labelZh.slice(0, 2),
          fullLabel: isEn ? axis.labelEn : axis.labelZh,
          val: Number(cur.toFixed(2)),
          rate: null,
          glyph: '—',
        };
      }

      const prev = sanitizeScore(previousDimensions[axis.key]);
      const rate = Number((((cur - prev) / prev) * 100).toFixed(1));

      return {
        key: axis.key,
        label: isEn ? axis.shortEn : axis.labelZh.slice(0, 2),
        fullLabel: isEn ? axis.labelEn : axis.labelZh,
        val: Number(cur.toFixed(2)),
        rate,
        glyph: rate > 0 ? '▲' : rate < 0 ? '▼' : '—',
      };
    });
  }, [dimensions, previousDimensions, isEn]);

  // 5. 層級 2：結合調色盤派發顏色與無障礙文字（明確標註 string 消除 TS2322）
  const growthRates = useMemo(() => {
    return growthValues.map((item) => {
      let textColor = palette.neutralText;
      let ariaGrowthText: string = t.noChange;

      if (item.rate === null) {
        ariaGrowthText = t.noBaseline;
      } else if (item.rate > 0) {
        textColor = palette.positiveText;
        ariaGrowthText = `+${item.rate}%`;
      } else if (item.rate < 0) {
        textColor = palette.negativeText;
        ariaGrowthText = `${item.rate}%`;
      }

      return {
        ...item,
        textColor,
        ariaGrowthText,
      };
    });
  }, [growthValues, palette, t]);

  const hoveredMeta = hoveredAxis ? AXIS_MAP.get(hoveredAxis) : undefined;

  // 空資料防禦視覺回退
  if (!hasAnyData) {
    return (
      <div className="flex flex-col items-center justify-center p-6 border border-slate-800/80 bg-slate-950/40 rounded-xl font-mono text-center w-full max-w-xs">
        <span className="text-xl mb-1 text-slate-500" aria-hidden="true">📊</span>
        <span className="text-xs font-bold text-slate-400">{t.emptyTitle}</span>
        <span className="text-[9px] text-slate-600 mt-0.5">{t.emptySub}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center font-mono w-full select-none">
      <div className="relative">
        <svg
          width={size}
          height={size}
          className="overflow-visible"
          /* 遵循 ARIA 規範：父層使用 role="group"，內層節點可獨立被螢幕閱讀器感知 */
          role="group"
          aria-labelledby={`${titleId} ${descId}`}
        >
          <title id={titleId}>{t.title}</title>
          <desc id={descId}>{t.desc}</desc>

          {/* 同心多邊形刻度網格 (33%, 66%, 100%) */}
          {[0.33, 0.66, 1.0].map((level, lIdx) => {
            const gridPts = AXIS_CONFIG.map((_, i) => {
              const pt = polarToCartesian(i, level, center, radius);
              return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
            }).join(' ');

            return (
              <polygon
                key={lIdx}
                points={gridPts}
                fill={lIdx === 2 ? 'rgba(15, 23, 42, 0.4)' : 'none'}
                stroke={palette.gridStroke}
                strokeWidth={0.8 * scaleFactor}
                strokeDasharray={lIdx === 2 ? undefined : '2,2'}
                aria-hidden="true"
              />
            );
          })}

          {/* 正交射線軸 */}
          {AXIS_CONFIG.map((_, i) => {
            const pt = polarToCartesian(i, 1.0, center, radius);
            return (
              <line
                key={i}
                x1={center}
                y1={center}
                x2={pt.x}
                y2={pt.y}
                stroke={palette.axisStroke}
                strokeWidth={1 * scaleFactor}
                aria-hidden="true"
              />
            );
          })}

          {/* 歷史對比輪廓 (Previous Baseline) */}
          {prevPoints && (
            <polygon
              points={prevPoints}
              fill={palette.baselineFill}
              stroke={palette.baselineStroke}
              strokeWidth={1.2 * scaleFactor}
              strokeDasharray="3,3"
              aria-label={t.baseline}
            />
          )}

          {/* 當前能力輪廓 (Current Profile) */}
          <polygon
            points={currentPoints}
            fill={palette.currentFill}
            stroke={palette.currentStroke}
            strokeWidth={1.8 * scaleFactor}
            aria-label={t.current}
          />

          {/* 頂點錨點與互動節點 (WCAG 2.2 鍵盤聚焦支援 + 臨床補償聚焦光環) */}
          {AXIS_CONFIG.map((axis, i) => {
            const val = sanitizeScore(dimensions[axis.key]);
            const pt = polarToCartesian(i, val, center, radius);
            const labelPt = polarToCartesian(i, 1.0, center, radius, 1.36);
            const isHovered = hoveredAxis === axis.key;
            const accessibleLabel = `${isEn ? axis.labelEn : axis.labelZh}: ${(val * 100).toFixed(0)}%`;

            return (
              <g
                key={axis.key}
                tabIndex={0}
                role="img"
                aria-label={accessibleLabel}
                onMouseEnter={() => setHoveredAxis(axis.key)}
                onMouseLeave={() => setHoveredAxis(null)}
                onFocus={() => setHoveredAxis(axis.key)}
                onBlur={() => setHoveredAxis(null)}
                className="cursor-pointer outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 focus-visible:outline-offset-2"
              >
                {/* 聚焦光環：若開啟 reducedMotion 則維持靜態虛線 */}
                {isHovered && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={7 * scaleFactor}
                    fill="none"
                    stroke={palette.activeHalo}
                    strokeWidth={1.5 * scaleFactor}
                    strokeDasharray="2,2"
                    className={reducedMotion ? '' : 'animate-spin-slow'}
                    aria-hidden="true"
                  />
                )}

                {/* 數據圓點 */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={(isHovered ? 4.5 : 3) * scaleFactor}
                  fill={isHovered ? palette.activeHalo : palette.currentStroke}
                  stroke={isHovered ? '#082f49' : '#1e1b4b'}
                  strokeWidth={1 * scaleFactor}
                  className="transition-all duration-150"
                  aria-hidden="true"
                />

                {/* 外圍視覺文字標籤 */}
                <text
                  x={labelPt.x}
                  y={labelPt.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={responsiveFontSize}
                  fontWeight="bold"
                  fill={isHovered ? palette.labelHoverFill : palette.labelFill}
                  className="transition-colors"
                  aria-hidden="true"
                >
                  {isEn ? axis.shortEn : axis.labelZh.slice(0, 2)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* 懸停動態 HUD Tooltip (純視覺輔助，aria-hidden 杜絕讀屏語意重複) */}
        {hoveredAxis && hoveredMeta && (
          <div
            className="absolute top-0.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-slate-900/95 border border-cyan-500/80 rounded-full text-[7.5px] text-cyan-300 font-bold shadow-xl animate-fade-in pointer-events-none whitespace-nowrap z-20"
            aria-hidden="true"
          >
            {isEn ? hoveredMeta.labelEn : hoveredMeta.labelZh}:{' '}
            {(sanitizeScore(dimensions[hoveredAxis]) * 100).toFixed(0)}%
          </div>
        )}
      </div>

      {/* 維度具體數值與成長率面板 (語意清單結構 + 雙通道符號) */}
      <ul
        className="grid grid-cols-5 gap-1 w-full max-w-xs mt-2 px-0.5 text-[7px] list-none p-0 m-0"
        aria-label={t.breakdownLabel}
      >
        {growthRates.map((item) => (
          <li
            key={item.key}
            role="listitem"
            className="bg-slate-900/90 border border-slate-800/90 rounded p-1 text-center flex flex-col justify-between"
            /* 顯式 aria-label 覆蓋內部碎片化文字，朗讀完整語意句 */
            aria-label={`${item.fullLabel}: ${(item.val * 100).toFixed(0)}%, ${t.growth}: ${item.ariaGrowthText}`}
          >
            <div className="text-slate-400 text-[6.5px] truncate font-bold">{item.label}</div>
            <div className="text-slate-200 font-bold text-[8.5px] my-0.5">
              {(item.val * 100).toFixed(0)}%
            </div>
            {/* 遵循 WCAG 1.4.1：色彩搭配幾何圖形 (▲/▼/—) 達成雙通道傳達 */}
            <div
              className="font-bold text-[6px] flex items-center justify-center gap-0.5"
              style={{ color: item.textColor }}
            >
              {item.rate === null ? (
                <span className="text-slate-500">{t.noBaseline}</span>
              ) : (
                <>
                  <span aria-hidden="true">{item.glyph}</span>
                  <span>{item.rate > 0 ? `+${item.rate}%` : `${item.rate}%`}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
