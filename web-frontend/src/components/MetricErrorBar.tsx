// web-frontend/src/components/MetricErrorBar.tsx
import React, { useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

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
  isEn: propIsEn,
}) => {
  // 雙重防禦：優先使用 prop，若未傳入則由 LanguageContext 自動接管
  const { lang } = useLanguage();
  const isEn = propIsEn !== undefined ? propIsEn : lang === 'en';

  // 動態尺度投影計算 (含安全邊界 Padding)
  const minVal = Math.min(actualVal, benchmarkVal, ci95[0]);
  const maxVal = Math.max(actualVal, benchmarkVal, ci95[1]);
  const span = Math.max(1, maxVal - minVal);

  const minRange = Math.max(0, minVal - span * 0.2);
  const maxRange = maxVal + span * 0.2;

  const toPercent = (v: number) => {
    const p = ((v - minRange) / (maxRange - minRange)) * 100;
    return Math.max(3, Math.min(97, p));
  };

  const actualPos = toPercent(actualVal);
  const benchPos = toPercent(benchmarkVal);
  const ciLeft = toPercent(ci95[0]);
  const ciRight = toPercent(ci95[1]);

  // 統計顯著性分析
  const effectEvaluation = useMemo(() => {
    if (actualVal < ci95[0]) {
      return {
        label: isEn ? '⚡ Superior Performance' : '⚡ 顯著超越常模',
        color: 'text-emerald-400 bg-emerald-950/80 border-emerald-500/60',
      };
    }
    if (actualVal > ci95[1]) {
      return {
        label: isEn ? '⚠️ High Cognitive Load' : '⚠️ 認知負荷偏高',
        color: 'text-rose-400 bg-rose-950/80 border-rose-500/60',
      };
    }
    return {
      label: isEn ? '✓ Within Normal Curve' : '✓ 常模區間內',
      color: 'text-cyan-400 bg-cyan-950/80 border-cyan-500/60',
    };
  }, [actualVal, ci95, isEn]);

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-lg p-2 font-mono text-[7px] select-none shadow-inner">
      <div className="flex justify-between items-center text-slate-400 font-bold mb-1">
        <div className="flex items-center gap-1.5">
          <span>{isEn ? 'PSYCHOMETRIC 95% CI BENCHMARK' : '心理計量 95% 信賴區間對照'}</span>
          <span className={`px-1 py-0.2 rounded border text-[6px] font-bold ${effectEvaluation.color}`}>
            {effectEvaluation.label}
          </span>
        </div>
        <span className="text-cyan-400 font-bold">SEM: ±{sem}{unit}</span>
      </div>

      <div className="relative h-6 w-full flex items-center">
        {/* 基準水平軸線 */}
        <div className="absolute inset-x-0 h-0.5 bg-slate-800 rounded-full" />

        {/* 95% CI 範圍帶 */}
        <div
          className="absolute h-2.5 bg-cyan-950/70 border-t border-b border-cyan-500/60 rounded-xs"
          style={{ left: `${ciLeft}%`, width: `${Math.max(2, ciRight - ciLeft)}%` }}
        />
        {/* CI 左鬚線 (Left Bound) */}
        <div
          className="absolute h-3.5 w-0.5 bg-cyan-400/90 rounded-full"
          style={{ left: `${ciLeft}%`, transform: 'translateX(-50%)' }}
        />
        {/* CI 右鬚線 (Right Bound) */}
        <div
          className="absolute h-3.5 w-0.5 bg-cyan-400/90 rounded-full"
          style={{ left: `${ciRight}%`, transform: 'translateX(-50%)' }}
        />

        {/* 期望常模錨點 (Benchmark: 圓形) */}
        <div
          className="absolute w-2 h-2 rounded-full bg-amber-400 shadow-sm shadow-amber-400/80 z-10 cursor-help"
          style={{ left: `${benchPos}%`, transform: 'translateX(-50%)' }}
          title={`${isEn ? 'Norm Benchmark' : '常模基準'}: ${benchmarkVal}${unit}`}
        />

        {/* 實際作答錨點 (Actual: 帶白邊十字準星光環，具高對比無障礙識別) */}
        <div
          className="absolute w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white shadow-md shadow-emerald-400/90 z-20 cursor-help ring-2 ring-emerald-500/40"
          style={{ left: `${actualPos}%`, transform: 'translateX(-50%)' }}
          title={`${isEn ? 'Actual Attempt' : '實際作答'}: ${actualVal}${unit}`}
        />
      </div>

      {/* 底部數據與圖例 */}
      <div className="flex justify-between items-center text-[6.5px] text-slate-500 mt-1">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 border border-white/60 inline-block" />
          <span>
            {isEn ? 'Actual' : '實際'}: <strong className="text-slate-200">{actualVal}{unit}</strong>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
          <span>
            {isEn ? 'Norm' : '常模'}: <strong className="text-slate-200">{benchmarkVal}{unit}</strong>
          </span>
        </div>
        <div>
          <span>CI: [{ci95[0]} - {ci95[1]}{unit}]</span>
        </div>
      </div>
    </div>
  );
};
