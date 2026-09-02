// web-frontend/src/components/CognitiveRadarChart.tsx
import React, { useMemo } from 'react';
import { CognitiveDimension } from '../hooks/useLearnerProfile';

interface Props {
  dimensions: Record<CognitiveDimension, number>;
  previousDimensions?: Record<CognitiveDimension, number>;
  size?: number;
}

const AXIS_CONFIG: { key: CognitiveDimension; labelZh: string; labelEn: string }[] = [
  { key: 'spatial', labelZh: '空間', labelEn: 'Spatial' },
  { key: 'numeric', labelZh: '數理', labelEn: 'Numeric' },
  { key: 'workingMemory', labelZh: '記憶', labelEn: 'WM' },
  { key: 'inhibition', labelZh: '抑制', labelEn: 'Inhibit' },
  { key: 'processingSpeed', labelZh: '速度', labelEn: 'Speed' },
];

export const CognitiveRadarChart: React.FC<Props> = ({
  dimensions,
  previousDimensions,
  size = 180,
}) => {
  const center = size / 2;
  const radius = center * 0.68;
  const totalAxes = AXIS_CONFIG.length;
  const angleSlice = (Math.PI * 2) / totalAxes;

  const getCoordinates = (index: number, val: number) => {
    const angle = index * angleSlice - Math.PI / 2;
    return {
      x: center + radius * val * Math.cos(angle),
      y: center + radius * val * Math.sin(angle),
    };
  };

  const currentPoints = AXIS_CONFIG.map((axis, i) => {
    const val = Math.max(0.1, Math.min(1.0, dimensions[axis.key] || 0.5));
    const pt = getCoordinates(i, val);
    return `${pt.x},${pt.y}`;
  }).join(' ');

  const prevPoints = previousDimensions
    ? AXIS_CONFIG.map((axis, i) => {
        const val = Math.max(0.1, Math.min(1.0, previousDimensions[axis.key] || 0.5));
        const pt = getCoordinates(i, val);
        return `${pt.x},${pt.y}`;
      }).join(' ')
    : null;

  // 計算五個維度的成長率 (%)
  const growthRates = useMemo(() => {
    return AXIS_CONFIG.map((axis) => {
      const cur = dimensions[axis.key] || 0.5;
      const prev = previousDimensions ? previousDimensions[axis.key] || cur : cur;
      const rate = prev > 0 ? ((cur - prev) / prev) * 100 : 0;
      return { key: axis.key, label: axis.labelEn, rate: Number(rate.toFixed(1)) };
    });
  }, [dimensions, previousDimensions]);

  return (
    <div className="flex flex-col items-center justify-center font-mono w-full">
      <svg width={size} height={size} className="overflow-visible">
        {[0.33, 0.66, 1.0].map((level, lIdx) => {
          const gridPts = AXIS_CONFIG.map((_, i) => {
            const pt = getCoordinates(i, level);
            return `${pt.x},${pt.y}`;
          }).join(' ');
          return (
            <polygon
              key={lIdx}
              points={gridPts}
              fill="none"
              stroke="#334155"
              strokeWidth="0.8"
              strokeDasharray={lIdx === 2 ? undefined : '2,2'}
            />
          );
        })}

        {AXIS_CONFIG.map((_, i) => {
          const pt = getCoordinates(i, 1.0);
          return <line key={i} x1={center} y1={center} x2={pt.x} y2={pt.y} stroke="#1e293b" strokeWidth="1" />;
        })}

        {prevPoints && (
          <polygon
            points={prevPoints}
            fill="rgba(148, 163, 184, 0.08)"
            stroke="#64748b"
            strokeWidth="1.2"
            strokeDasharray="3,3"
          />
        )}

        <polygon
          points={currentPoints}
          fill="rgba(99, 102, 241, 0.35)"
          stroke="#818cf8"
          strokeWidth="1.8"
        />

        {AXIS_CONFIG.map((axis, i) => {
          const val = dimensions[axis.key] || 0.5;
          const pt = getCoordinates(i, val);
          const labelPt = getCoordinates(i, 1.28);

          return (
            <g key={axis.key}>
              <circle cx={pt.x} cy={pt.y} r="2.5" fill="#38bdf8" />
              <text
                x={labelPt.x}
                y={labelPt.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="8"
                fontWeight="bold"
                fill="#94a3b8"
              >
                {axis.labelEn}
              </text>
            </g>
          );
        })}
      </svg>

      {/* 維度具體成長率進步條標籤 */}
      <div className="grid grid-cols-5 gap-1 w-full max-w-xs mt-2 px-1 text-[7px]">
        {growthRates.map((item) => (
          <div key={item.key} className="bg-slate-900/90 border border-slate-800 rounded p-1 text-center">
            <div className="text-slate-500">{item.label}</div>
            <div className={`font-bold ${item.rate > 0 ? 'text-emerald-400' : item.rate < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
              {item.rate > 0 ? `+${item.rate}%` : `${item.rate}%`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
