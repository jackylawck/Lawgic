// web-frontend/src/components/MetricErrorBar.tsx
import React from 'react';

interface Props {
  actualVal: number;
  benchmarkVal: number;
  ci95: [number, number];
  sem: number;
  unit?: string;
  isEn?: boolean;
}

export const MetricErrorBar: React.FC<Props> = ({
  actualVal,
  benchmarkVal,
  ci95,
  sem,
  unit = 's',
  isEn = false,
}) => {
  const minRange = Math.max(0, Math.min(actualVal, benchmarkVal, ci95[0]) * 0.75);
  const maxRange = Math.max(actualVal, benchmarkVal, ci95[1]) * 1.25 || 1;

  const toPercent = (v: number) => {
    const p = ((v - minRange) / (maxRange - minRange)) * 100;
    return Math.max(0, Math.min(100, p));
  };

  const actualPos = toPercent(actualVal);
  const benchPos = toPercent(benchmarkVal);
  const ciLeft = toPercent(ci95[0]);
  const ciRight = toPercent(ci95[1]);

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-lg p-2 font-mono text-[7px] select-none">
      <div className="flex justify-between items-center text-slate-400 font-bold mb-1">
        <span>{isEn ? 'PSYCHOMETRIC 95% CI BENCHMARK' : '心理計量 95% 信賴區間對照'}</span>
        <span className="text-cyan-400">SEM: ±{sem}{unit}</span>
      </div>

      <div className="relative h-6 w-full flex items-center">
        {/* 基準水平線 */}
        <div className="absolute inset-x-0 h-0.5 bg-slate-800 rounded-full" />

        {/* 95% CI 範圍條 */}
        <div
          className="absolute h-2.5 bg-cyan-950/80 border-t border-b border-cyan-500/60 rounded-xs"
          style={{ left: `${ciLeft}%`, width: `${Math.max(2, ciRight - ciLeft)}%` }}
        />
        {/* CI 左鬚線 */}
        <div
          className="absolute h-3.5 w-0.5 bg-cyan-400"
          style={{ left: `${ciLeft}%`, transform: 'translateX(-50%)' }}
        />
        {/* CI 右鬚線 */}
        <div
          className="absolute h-3.5 w-0.5 bg-cyan-400"
          style={{ left: `${ciRight}%`, transform: 'translateX(-50%)' }}
        />

        {/* 期望常模點 (Benchmark) */}
        <div
          className="absolute w-2 h-2 rounded-full bg-amber-400 shadow-sm shadow-amber-400/80 z-10"
          style={{ left: `${benchPos}%`, transform: 'translateX(-50%)' }}
          title={`Benchmark: ${benchmarkVal}${unit}`}
        />

        {/* 實際作答點 (Actual) */}
        <div
          className="absolute w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-md shadow-emerald-400/90 z-20"
          style={{ left: `${actualPos}%`, transform: 'translateX(-50%)' }}
          title={`Actual: ${actualVal}${unit}`}
        />
      </div>

      <div className="flex justify-between text-[6.5px] text-slate-500 mt-1">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          <span>{isEn ? 'Actual' : '實際'}: <strong className="text-slate-200">{actualVal}{unit}</strong></span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
          <span>{isEn ? 'Norm' : '常模'}: <strong className="text-slate-200">{benchmarkVal}{unit}</strong></span>
        </div>
        <div>
          <span>CI: [{ci95[0]}-{ci95[1]}{unit}]</span>
        </div>
      </div>
    </div>
  );
};
