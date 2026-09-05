// web-frontend/src/components/CognitiveRadarChart.tsx
import React, { useState, useMemo } from 'react';
import { CognitiveDimension } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';

interface Props {
  dimensions: Record<CognitiveDimension, number>;
  previousDimensions?: Record<CognitiveDimension, number>;
  size?: number;
}

const AXIS_CONFIG: { key: CognitiveDimension; labelZh: string; labelEn: string; shortEn: string }[] = [
  { key: 'spatial', labelZh: '空間視覺', labelEn: 'Spatial (Gv)', shortEn: 'Spatial' },
  { key: 'numeric', labelZh: '數理邏輯', labelEn: 'Quantitative (Gq)', shortEn: 'Numeric' },
  { key: 'workingMemory', labelZh: '工作記憶', labelEn: 'Working Mem (Gsm)', shortEn: 'Memory' },
  { key: 'inhibition', labelZh: '抑制控制', labelEn: 'Inhibition (Gs)', shortEn: 'Inhibit' },
  { key: 'processingSpeed', labelZh: '反應速度', labelEn: 'Speed (Gt)', shortEn: 'Speed' },
];

export const CognitiveRadarChart: React.FC<Props> = ({
  dimensions,
  previousDimensions,
  size = 180,
}) => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const [hoveredAxis, setHoveredAxis] = useState<CognitiveDimension | null>(null);

  const center = size / 2;
  // 留出 44% 空間給外圍標籤文字，徹底根治文字溢出邊界
  const radius = center * 0.54;
  const totalAxes = AXIS_CONFIG.length;
  const angleSlice = (Math.PI * 2) / totalAxes;

  const getCoordinates = (index: number, val: number, extraRadiusMultiplier = 1.0) => {
    const angle = index * angleSlice - Math.PI / 2;
    const r = radius * val * extraRadiusMultiplier;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  const currentPoints = AXIS_CONFIG.map((axis, i) => {
    const val = Math.max(0.12, Math.min(1.0, dimensions[axis.key] ?? 0.5));
    const pt = getCoordinates(i, val);
    return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  }).join(' ');

  // 判斷歷史資料是否有實質差異
  const hasDistinctBaseline = useMemo(() => {
    if (!previousDimensions) return false;
    return AXIS_CONFIG.some((axis) => {
      const cur = dimensions[axis.key] ?? 0.5;
      const prev = previousDimensions[axis.key] ?? 0.5;
      return Math.abs(cur - prev) >= 0.03;
    });
  }, [dimensions, previousDimensions]);

  const prevPoints = hasDistinctBaseline && previousDimensions
    ? AXIS_CONFIG.map((axis, i) => {
        const val = Math.max(0.12, Math.min(1.0, previousDimensions[axis.key] ?? 0.5));
        const pt = getCoordinates(i, val);
        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
      }).join(' ')
    : null;

  // 計算五個維度的成長率 (%)
  const growthRates = useMemo(() => {
    return AXIS_CONFIG.map((axis) => {
      const cur = dimensions[axis.key] ?? 0.5;
      const prev = previousDimensions ? previousDimensions[axis.key] ?? cur : cur;
      const rate = prev > 0 ? ((cur - prev) / prev) * 100 : 0;
      return {
        key: axis.key,
        label: isEn ? axis.shortEn : axis.labelZh.slice(0, 2),
        fullLabel: isEn ? axis.labelEn : axis.labelZh,
        val: Number(cur.toFixed(2)),
        rate: Number(rate.toFixed(1)),
      };
    });
  }, [dimensions, previousDimensions, isEn]);

  const hoveredMeta = AXIS_CONFIG.find((a) => a.key === hoveredAxis);

  return (
    <div className="flex flex-col items-center justify-center font-mono w-full select-none">
      <div className="relative">
        <svg width={size} height={size} className="overflow-visible">
          {/* 背景同心同質多邊形網格 (33%, 66%, 100%) */}
          {[0.33, 0.66, 1.0].map((level, lIdx) => {
            const gridPts = AXIS_CONFIG.map((_, i) => {
              const pt = getCoordinates(i, level);
              return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
            }).join(' ');
            return (
              <polygon
                key={lIdx}
                points={gridPts}
                fill={lIdx === 2 ? 'rgba(15, 23, 42, 0.4)' : 'none'}
                stroke="#334155"
                strokeWidth="0.8"
                strokeDasharray={lIdx === 2 ? undefined : '2,2'}
              />
            );
          })}

          {/* 正交軸線 */}
          {AXIS_CONFIG.map((_, i) => {
            const pt = getCoordinates(i, 1.0);
            return (
              <line
                key={i}
                x1={center}
                y1={center}
                x2={pt.x}
                y2={pt.y}
                stroke="#1e293b"
                strokeWidth="1"
              />
            );
          })}

          {/* 歷史對比多邊形 (Previous Baseline) */}
          {prevPoints && (
            <polygon
              points={prevPoints}
              fill="rgba(148, 163, 184, 0.08)"
              stroke="#64748b"
              strokeWidth="1.2"
              strokeDasharray="3,3"
            />
          )}

          {/* 當前能力多邊形 (Current Profile) */}
          <polygon
            points={currentPoints}
            fill="rgba(99, 102, 241, 0.35)"
            stroke="#818cf8"
            strokeWidth="1.8"
          />

          {/* 頂點錨點與文字標籤 */}
          {AXIS_CONFIG.map((axis, i) => {
            const val = dimensions[axis.key] ?? 0.5;
            const pt = getCoordinates(i, val);
            const labelPt = getCoordinates(i, 1.0, 1.36);
            const isHovered = hoveredAxis === axis.key;

            return (
              <g
                key={axis.key}
                onMouseEnter={() => setHoveredAxis(axis.key)}
                onMouseLeave={() => setHoveredAxis(null)}
                className="cursor-pointer"
              >
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? '4.5' : '3'}
                  fill={isHovered ? '#38bdf8' : '#818cf8'}
                  className="transition-all duration-150"
                />
                <text
                  x={labelPt.x}
                  y={labelPt.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="7.5"
                  fontWeight="bold"
                  fill={isHovered ? '#38bdf8' : '#94a3b8'}
                  className="transition-colors"
                >
                  {isEn ? axis.shortEn : axis.labelZh.slice(0, 2)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* 懸停動態 Tooltip (支援 100% 雙語標籤切換) */}
        {hoveredAxis && hoveredMeta && (
          <div className="absolute top-0.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-slate-900/95 border border-cyan-500/80 rounded-full text-[7.5px] text-cyan-300 font-bold shadow-xl animate-fade-in pointer-events-none whitespace-nowrap z-20">
            {isEn ? hoveredMeta.labelEn : hoveredMeta.labelZh}:{' '}
            {(((dimensions[hoveredAxis] ?? 0.5)) * 100).toFixed(0)}%
          </div>
        )}
      </div>

      {/* 維度具體數值與成長率微型面板 */}
      <div className="grid grid-cols-5 gap-1 w-full max-w-xs mt-2 px-0.5 text-[7px]">
        {growthRates.map((item) => (
          <div
            key={item.key}
            className="bg-slate-900/90 border border-slate-800/90 rounded p-1 text-center flex flex-col justify-between"
            title={item.fullLabel}
          >
            <div className="text-slate-400 text-[6.5px] truncate font-bold">{item.label}</div>
            <div className="text-slate-200 font-bold text-[8.5px] my-0.5">
              {(item.val * 100).toFixed(0)}%
            </div>
            <div
              className={`font-bold text-[6px] ${
                item.rate > 0 ? 'text-emerald-400' : item.rate < 0 ? 'text-rose-400' : 'text-slate-500'
              }`}
            >
              {item.rate > 0 ? `+${item.rate}%` : `${item.rate}%`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
