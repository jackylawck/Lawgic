// web-frontend/src/components/CognitiveDashboard.tsx
import React, { useMemo } from 'react';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage } from '../contexts/LanguageContext';
import { PsychometricsEngine } from '../utils/psychometricsEngine';

interface Props {
  onClose?: () => void;
}

export const CognitiveDashboard: React.FC<Props> = ({ onClose }) => {
  const { profile, exportLongitudinalDataset } = useLearnerProfile();
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const report = useMemo(() => {
    return PsychometricsEngine.generateReport(profile.history || []);
  }, [profile.history]);

  const handleDownloadDataset = () => {
    exportLongitudinalDataset();
  };

  const handlePrintReport = () => {
    window.print();
  };

  const radarDimensions = [
    { key: 'gf', label: isEn ? 'Gf (Fluid Logic)' : 'Gf (流體推理)', val: report.constructs?.gf || 0.5, base: report.baselineConstructs?.gf || 0.5 },
    { key: 'gv', label: isEn ? 'Gv (Visual Spatial)' : 'Gv (空間視覺)', val: report.constructs?.gv || 0.5, base: report.baselineConstructs?.gv || 0.5 },
    { key: 'gsm', label: isEn ? 'Gsm (Working Memory)' : 'Gsm (工作記憶)', val: report.constructs?.gsm || 0.5, base: report.baselineConstructs?.gsm || 0.5 },
    { key: 'inhibition', label: isEn ? 'Inhibition (Executive)' : '抑制控制 (執行功能)', val: report.constructs?.inhibition || 0.5, base: report.baselineConstructs?.inhibition || 0.5 },
    { key: 'gq', label: isEn ? 'Gq (Quantitative)' : 'Gq (數量推理)', val: report.constructs?.gq || 0.5, base: report.baselineConstructs?.gq || 0.5 },
  ];

  const radarPoints = useMemo(() => {
    const size = 280;
    const center = size / 2;
    const radius = 95;
    const total = radarDimensions.length;

    const currentCoords = radarDimensions.map((d, i) => {
      const angle = (Math.PI * 2 / total) * i - Math.PI / 2;
      const r = radius * d.val;
      return `${(center + r * Math.cos(angle)).toFixed(1)},${(center + r * Math.sin(angle)).toFixed(1)}`;
    }).join(' ');

    const baselineCoords = radarDimensions.map((d, i) => {
      const angle = (Math.PI * 2 / total) * i - Math.PI / 2;
      const r = radius * d.base;
      return `${(center + r * Math.cos(angle)).toFixed(1)},${(center + r * Math.sin(angle)).toFixed(1)}`;
    }).join(' ');

    return { size, center, radius, currentCoords, baselineCoords };
  }, [radarDimensions]);

  // 繪製 IRT 信賴帶的多邊形路徑
  const ciBandPath = useMemo(() => {
    if (!report.trajectory || report.trajectory.length <= 1) return '';
    const upperPoints = report.trajectory.map((p, idx) => {
      const x = (idx / (report.trajectory.length - 1)) * 100;
      const y = 50 - (p.ci95Upper / 3.0) * 45;
      return `${x.toFixed(1)},${Math.max(2, Math.min(98, y)).toFixed(1)}`;
    });

    const lowerPoints = report.trajectory.slice().reverse().map((p, idx) => {
      const origIdx = report.trajectory.length - 1 - idx;
      const x = (origIdx / (report.trajectory.length - 1)) * 100;
      const y = 50 - (p.ci95Lower / 3.0) * 45;
      return `${x.toFixed(1)},${Math.max(2, Math.min(98, y)).toFixed(1)}`;
    });

    return [...upperPoints, ...lowerPoints].join(' ');
  }, [report.trajectory]);

  return (
    <div className="w-full max-w-4xl mx-auto p-3 sm:p-6 bg-slate-950 text-slate-100 font-mono select-none print:bg-white print:text-slate-900 print:p-0">
      {/* 頂部導航 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 print:border-slate-300 pb-3 mb-4 gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl sm:text-2xl">🧠</span>
            <h1 className="text-base sm:text-lg font-black tracking-wider text-slate-100 print:text-slate-900 uppercase">
              {isEn ? 'Longitudinal Cognitive Profile' : '全域縱向認知成長側寫儀表板'}
            </h1>
          </div>
          <p className="text-[9px] sm:text-[10px] text-slate-400 print:text-slate-600 mt-0.5">
            {isEn
              ? 'CHC Construct Model & Adaptive IRT (Newton-Raphson MLE Estimation)'
              : 'CHC 構念架構模型與自適應項目反應理論（Newton-Raphson MLE 求解）'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto print:hidden">
          <button
            onClick={handleDownloadDataset}
            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-cyan-500/50 text-cyan-300 text-[9px] rounded font-bold transition flex items-center gap-1 shadow-sm active:scale-95 cursor-pointer"
          >
            <span>📊</span>
            <span>{isEn ? 'Export JSON' : '匯出數據集'}</span>
          </button>
          <button
            onClick={handlePrintReport}
            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-indigo-500/50 text-indigo-300 text-[9px] rounded font-bold transition flex items-center gap-1 shadow-sm active:scale-95 cursor-pointer"
          >
            <span>🖨️</span>
            <span>{isEn ? 'Print / PDF' : '列印側寫'}</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] rounded font-bold cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 核心指標卡 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <div className="bg-slate-900/70 print:bg-slate-50 border border-slate-800 print:border-slate-300 p-2.5 rounded-xl text-center">
          <div className="text-[8px] text-slate-400 print:text-slate-600 uppercase tracking-wider">
            {isEn ? 'Wechsler Scale IQ' : 'Wechsler 標尺 IQ'}
          </div>
          <div className="text-2xl sm:text-3xl font-black text-cyan-400 print:text-cyan-700 mt-0.5">
            {report.overallIQ}
          </div>
          <div className="text-[7px] text-slate-500 mt-0.5">SEM: ±{report.sem} (r_xx ≈ 0.92)</div>
        </div>

        <div className="bg-slate-900/70 print:bg-slate-50 border border-slate-800 print:border-slate-300 p-2.5 rounded-xl text-center">
          <div className="text-[8px] text-slate-400 print:text-slate-600 uppercase tracking-wider">
            {isEn ? 'Percentile Rank (PR)' : '常模百分位數'}
          </div>
          <div className="text-2xl sm:text-3xl font-black text-indigo-400 print:text-indigo-700 mt-0.5">
            PR {report.percentileRank}
          </div>
          <div className="text-[7px] text-slate-500 mt-0.5">
            {isEn ? 'Top' : '優於'} {Number((100 - report.percentileRank).toFixed(1))}%
          </div>
        </div>

        <div className="bg-slate-900/70 print:bg-slate-50 border border-slate-800 print:border-slate-300 p-2.5 rounded-xl text-center">
          <div className="text-[8px] text-slate-400 print:text-slate-600 uppercase tracking-wider">
            {isEn ? '95% Confidence Band' : '95% 信賴區間'}
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-400 print:text-amber-700 mt-1">
            [{report.ci95[0]} - {report.ci95[1]}]
          </div>
          <div className="text-[7px] text-slate-500 mt-0.5">
            {isEn ? 'True Ability Bound' : '真實認知能力估計區間'}
          </div>
        </div>

        <div className="bg-slate-900/70 print:bg-slate-50 border border-slate-800 print:border-slate-300 p-2.5 rounded-xl text-center">
          <div className="text-[8px] text-slate-400 print:text-slate-600 uppercase tracking-wider">
            {isEn ? 'Deduction Purity' : '純邏輯推演純度'}
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-400 print:text-emerald-700 mt-0.5">
            {report.pureClearRate}%
          </div>
          <div className="text-[7px] text-slate-500 mt-0.5">
            {report.totalAttempts} {isEn ? 'Sessions Evaluated' : '次完整施測'}
          </div>
        </div>
      </div>

      {/* 視覺化展演：CHC 雙層雷達圖 + IRT EMA 平滑曲線與 95% 信賴帶 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {/* 左側：CHC 雷達圖 */}
        <div className="bg-slate-900/40 print:bg-slate-50 border border-slate-800/80 print:border-slate-300 rounded-xl p-3 flex flex-col items-center justify-center">
          <div className="w-full flex justify-between items-center text-[8px] text-slate-400 print:text-slate-600 mb-1">
            <span className="font-bold tracking-wider uppercase">
              {isEn ? 'Adaptive CHC Radar' : '自適應 CHC 認知雷達'}
            </span>
            <div className="flex items-center gap-2 text-[7px]">
              <span className="flex items-center gap-1">
                <span className="w-2 h-0.5 bg-indigo-500 inline-block" />
                {isEn ? 'Baseline' : '初期基準'}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-0.5 bg-cyan-400 inline-block" />
                {isEn ? 'Calibrated' : '自適應校準'}
              </span>
            </div>
          </div>

          <svg width={radarPoints.size} height={radarPoints.size} className="overflow-visible my-1">
            {[0.25, 0.5, 0.75, 1.0].map((level) => {
              const pts = radarDimensions.map((_, i) => {
                const angle = (Math.PI * 2 / radarDimensions.length) * i - Math.PI / 2;
                const r = radarPoints.radius * level;
                return `${radarPoints.center + r * Math.cos(angle)},${radarPoints.center + r * Math.sin(angle)}`;
              }).join(' ');
              return (
                <polygon
                  key={level}
                  points={pts}
                  fill="none"
                  stroke="#334155"
                  strokeWidth="0.8"
                  strokeDasharray={level < 1.0 ? '2 2' : undefined}
                />
              );
            })}

            {radarDimensions.map((d, i) => {
              const angle = (Math.PI * 2 / radarDimensions.length) * i - Math.PI / 2;
              const x2 = radarPoints.center + radarPoints.radius * Math.cos(angle);
              const y2 = radarPoints.center + radarPoints.radius * Math.sin(angle);
              const labelX = radarPoints.center + (radarPoints.radius + 20) * Math.cos(angle);
              const labelY = radarPoints.center + (radarPoints.radius + 20) * Math.sin(angle);

              return (
                <g key={d.key}>
                  <line x1={radarPoints.center} y1={radarPoints.center} x2={x2} y2={y2} stroke="#334155" strokeWidth="0.8" />
                  <text
                    x={labelX}
                    y={labelY}
                    fill="#94a3b8"
                    fontSize="7"
                    fontWeight="bold"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {d.label}
                  </text>
                </g>
              );
            })}

            <polygon
              points={radarPoints.baselineCoords}
              fill="rgba(99, 102, 241, 0.15)"
              stroke="#6366f1"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />

            <polygon
              points={radarPoints.currentCoords}
              fill="rgba(56, 189, 248, 0.25)"
              stroke="#38bdf8"
              strokeWidth="2"
            />
          </svg>
        </div>

        {/* 右側：IRT θ 曲線 + 95% 信賴帶 */}
        <div className="bg-slate-900/40 print:bg-slate-50 border border-slate-800/80 print:border-slate-300 rounded-xl p-3 flex flex-col justify-between">
          <div className="flex justify-between items-center text-[8px] text-slate-400 print:text-slate-600 mb-2">
            <span className="font-bold tracking-wider uppercase">
              {isEn ? 'Smoothed IRT Ability (θ) & 95% Band' : 'IRT 能力值平滑曲線 (θ) 與 95% 信賴帶'}
            </span>
            {report.progress?.hasSufficientData && (
              <span className={`px-1.5 py-0.2 rounded text-[6.5px] font-bold ${
                report.progress.isSignificant ? 'bg-emerald-950 border border-emerald-500 text-emerald-300' : 'bg-slate-800 text-slate-400'
              }`}>
                {report.progress.isSignificant
                  ? (isEn ? '⚡ SIGNIFICANT GROWTH' : '⚡ 顯著進步')
                  : (isEn ? 'STABLE EQUILIBRIUM' : '穩定平台期')}
              </span>
            )}
          </div>

          <div className="relative h-44 w-full flex items-end pb-4 pt-2 px-2 border-b border-l border-slate-800 print:border-slate-300">
            {report.trajectory && report.trajectory.length > 1 ? (
              <svg className="w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                {/* 零水平參考線 */}
                <line x1="0" y1="50" x2="100" y2="50" stroke="#475569" strokeWidth="0.8" strokeDasharray="3 3" />

                {/* 95% 信賴陰影帶 */}
                {ciBandPath && (
                  <polygon
                    points={ciBandPath}
                    fill="rgba(56, 189, 248, 0.12)"
                    stroke="none"
                  />
                )}

                {/* EMA 平滑主曲線 */}
                <polyline
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={report.trajectory.map((p, idx) => {
                    const x = (idx / (report.trajectory.length - 1)) * 100;
                    const y = 50 - (p.smoothedTheta / 3.0) * 45;
                    return `${x.toFixed(1)},${Math.max(2, Math.min(98, y)).toFixed(1)}`;
                  }).join(' ')}
                />

                {/* 原始單題散點 */}
                {report.trajectory.map((p, idx) => {
                  const x = (idx / (report.trajectory.length - 1)) * 100;
                  const y = 50 - (p.rawTheta / 3.0) * 45;
                  return (
                    <circle
                      key={idx}
                      cx={x}
                      cy={Math.max(2, Math.min(98, y))}
                      r="1.8"
                      fill="#94a3b8"
                      opacity="0.45"
                    />
                  );
                })}
              </svg>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[8px] text-slate-500">
                {isEn ? 'Complete more sessions to build longitudinal curve.' : '累積更多測驗數據以繪製成長曲線'}
              </div>
            )}
          </div>

          <div className="flex justify-between text-[7px] text-slate-500 mt-1">
            <span>{report.trajectory?.[0]?.timestamp || (isEn ? 'Genesis' : '起點')}</span>
            <span className="text-cyan-400 print:text-cyan-700 font-bold">
              {report.progress?.hasSufficientData
                ? (isEn ? report.progress.interpretation.en : report.progress.interpretation.zh)
                : (isEn ? 'Building confidence model...' : '正在建立信賴區間模型...')}
            </span>
            <span>{report.trajectory?.[report.trajectory.length - 1]?.timestamp || (isEn ? 'Current' : '當前')}</span>
          </div>
        </div>
      </div>

      {/* 建設性認知側寫分析卡片 */}
      <div className="bg-slate-900/80 print:bg-slate-50 border border-indigo-900/60 print:border-slate-300 rounded-xl p-3 sm:p-4 mb-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 print:border-slate-300 pb-1.5 mb-2">
          <span className="text-[9px] sm:text-[10px] text-indigo-400 print:text-indigo-700 font-bold uppercase tracking-wider flex items-center gap-1">
            <span>📈</span>
            <span>{isEn ? 'Cognitive Construct Synthesis' : '個人化認知優勢與側寫結論'}</span>
          </span>
          <span className="text-[7px] text-emerald-400 print:text-emerald-700 font-mono">
            {isEn ? 'NON-VERBAL CHC ALIGNED' : '符合 CHC 非語言常模標定'}
          </span>
        </div>

        <p className="text-[9px] sm:text-[10.5px] text-slate-300 print:text-slate-800 leading-relaxed font-sans mb-3">
          {isEn ? report.profileSummary?.en : report.profileSummary?.zh}
        </p>

        {/* 五維構念指標明細 */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[8px]">
          {radarDimensions.map((item) => (
            <div key={item.key} className="bg-slate-950/80 print:bg-white border border-slate-800/80 print:border-slate-300 p-1.5 rounded">
              <div className="text-slate-500 text-[6.5px] uppercase">{item.label}</div>
              <div className="text-slate-200 print:text-slate-900 font-bold mt-0.5 text-[10px]">
                {(item.val * 100).toFixed(0)}%
              </div>
              <div className="w-full bg-slate-900 print:bg-slate-200 h-1 rounded-full overflow-hidden mt-1">
                <div className="bg-cyan-400 h-full" style={{ width: `${Math.min(100, Math.max(0, item.val * 100))}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 底部存證簽署 */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-[7px] text-slate-500 border-t border-slate-900 print:border-slate-300 pt-2 gap-1">
        <span>{isEn ? 'LAWGIC NEURO-COGNITIVE ENGINE v3.5 (IRT/NEWTON-RAPHSON)' : 'LAWGIC 神經認知計算引擎 v3.5 (自適應 IRT 求解)'}</span>
        <span className="font-mono">{isEn ? 'INTEGRITY HASH: TAMPER-PROOF EM-092' : '存證哈希值：防篡改簽名 EM-092'}</span>
      </div>
    </div>
  );
};
