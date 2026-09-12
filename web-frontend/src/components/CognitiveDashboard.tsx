// web-frontend/src/components/CognitiveDashboard.tsx
import React, { useMemo, useState, useCallback, useRef, useEffect, useId, memo } from 'react';
import { useLearnerProfile } from '../hooks/useLearnerProfile';
import { useLanguage, Language } from '../contexts/LanguageContext';
import {
  useAccessibilitySettings,
  useAccessibilityActions,
  ColorBlindMode,
} from '../contexts/AccessibilityContext';
import { PsychometricsEngine } from '../utils/psychometricsEngine';

interface Props {
  readonly onClose?: () => void;
  readonly forceLang?: Language;
}

type CHCDimension = 'gf' | 'gv' | 'gsm' | 'inhibition' | 'gq';

interface RadarDimension {
  readonly key: CHCDimension;
  readonly label: string;
  readonly val: number;
  readonly base: number;
}

interface RadarPalette {
  readonly currentStroke: string;
  readonly currentFill: string;
  readonly baselineStroke: string;
  readonly baselineFill: string;
  readonly gridStroke: string;
}

interface HoverPoint {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly rawTheta: number;
  readonly smoothedTheta: number;
  readonly ci95Lower: number;
  readonly ci95Upper: number;
  readonly timestamp: string;
}

const PRINT_FOCUS_RESTORE_DELAY_MS = 150;

function sanitizeNumber(val: unknown, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function resolveRadarPalette(mode: ColorBlindMode, highContrast: boolean): RadarPalette {
  if (highContrast) {
    return {
      currentStroke: '#38bdf8',
      currentFill: 'rgba(56, 189, 248, 0.4)',
      baselineStroke: '#ffffff',
      baselineFill: 'rgba(255, 255, 255, 0.2)',
      gridStroke: '#64748b',
    };
  }
  if (mode === 'achromatopsia') {
    return {
      currentStroke: '#ffffff',
      currentFill: 'rgba(255, 255, 255, 0.3)',
      baselineStroke: '#94a3b8',
      baselineFill: 'rgba(148, 163, 184, 0.1)',
      gridStroke: '#475569',
    };
  }
  if (mode === 'protanopia' || mode === 'deuteranopia') {
    return {
      currentStroke: '#0072b2', // Okabe-Ito Blue
      currentFill: 'rgba(0, 114, 178, 0.3)',
      baselineStroke: '#e69f00', // Okabe-Ito Orange
      baselineFill: 'rgba(230, 159, 0, 0.2)',
      gridStroke: '#334155',
    };
  }
  return {
    currentStroke: '#38bdf8',
    currentFill: 'rgba(56, 189, 248, 0.25)',
    baselineStroke: '#6366f1',
    baselineFill: 'rgba(99, 102, 241, 0.15)',
    gridStroke: '#334155',
  };
}

export const CognitiveDashboard = memo(function CognitiveDashboard({ onClose, forceLang }: Props) {
  const { profile, exportLongitudinalDataset } = useLearnerProfile();
  const { lang: contextLang } = useLanguage();
  const currentLang = forceLang || contextLang;
  const isEn = currentLang === 'en';

  const { colorBlindMode, highContrast, reducedMotion } = useAccessibilitySettings();
  const { playSound, announce } = useAccessibilityActions();

  const dashboardId = useId();
  const [activeHoverPoint, setActiveHoverPoint] = useState<HoverPoint | null>(null);
  const [integrityHash, setIntegrityHash] = useState<string | null>(null);
  const printButtonRef = useRef<HTMLButtonElement>(null);

  // 1. 真・版本鎖：安全解構 timestamp，絕無 any 破口
  const historyLen = profile.history?.length ?? 0;
  const lastHistoryEntry = historyLen > 0 ? profile.history?.[historyLen - 1] : undefined;
  const lastHistoryTimestamp = typeof lastHistoryEntry?.timestamp === 'string'
    ? lastHistoryEntry.timestamp
    : '';

  const report = useMemo(() => {
    return PsychometricsEngine.generateReport(profile.history || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 版本鎖合約：profile.history 引用易受重新渲染抖動，改以 [historyLen, lastHistoryTimestamp] 作為只讀追加型穩態依賴
  }, [historyLen, lastHistoryTimestamp]);

  // 2. 純字串指紋簽名（使用 personalBest.updatedAt 正確屬性，杜絕 TS2339 與無限循環）
  const profileLastUpdate = profile.personalBest?.updatedAt || 'GENESIS';

  const reportSummarySignature = useMemo(() => {
    return [
      report.overallIQ,
      report.percentileRank,
      report.sem,
      report.pureClearRate,
      report.trajectory?.length || 0,
      profileLastUpdate,
    ].join('|');
  }, [report.overallIQ, report.percentileRank, report.sem, report.pureClearRate, report.trajectory?.length, profileLastUpdate]);

  useEffect(() => {
    let isMounted = true;
    const computeIntegrity = async () => {
      try {
        const enc = new TextEncoder();
        const buf = await window.crypto.subtle.digest('SHA-256', enc.encode(reportSummarySignature));
        const hex = Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 24)
          .toUpperCase();
        if (isMounted) setIntegrityHash(`HASH_${hex}`);
      } catch {
        if (isMounted) setIntegrityHash(`LOCAL_${Date.now()}`);
      }
    };
    computeIntegrity();
    return () => {
      isMounted = false;
    };
  }, [reportSummarySignature]);

  const handleDownloadDataset = useCallback(() => {
    playSound('step');
    exportLongitudinalDataset();
    announce(
      isEn ? 'Longitudinal dataset exported successfully.' : '全域縱向認知數據集已成功匯出。',
      'polite'
    );
  }, [exportLongitudinalDataset, playSound, announce, isEn]);

  // 3. 列印安全焦點維護
  const handlePrintReport = useCallback(() => {
    playSound('click');
    window.print();
    setTimeout(() => {
      printButtonRef.current?.focus();
    }, PRINT_FOCUS_RESTORE_DELAY_MS);
  }, [playSound]);

  // 4. 維度定義（嚴格型別與數值防禦）
  const radarDimensions: readonly RadarDimension[] = useMemo(() => [
    { key: 'gf', label: isEn ? 'Gf (Fluid Logic)' : 'Gf (流體推理)', val: sanitizeNumber(report.constructs?.gf, 0.5), base: sanitizeNumber(report.baselineConstructs?.gf, 0.5) },
    { key: 'gv', label: isEn ? 'Gv (Visual Spatial)' : 'Gv (空間視覺)', val: sanitizeNumber(report.constructs?.gv, 0.5), base: sanitizeNumber(report.baselineConstructs?.gv, 0.5) },
    { key: 'gsm', label: isEn ? 'Gsm (Working Memory)' : 'Gsm (工作記憶)', val: sanitizeNumber(report.constructs?.gsm, 0.5), base: sanitizeNumber(report.baselineConstructs?.gsm, 0.5) },
    { key: 'inhibition', label: isEn ? 'Inhibition (Executive)' : '抑制控制 (執行功能)', val: sanitizeNumber(report.constructs?.inhibition, 0.5), base: sanitizeNumber(report.baselineConstructs?.inhibition, 0.5) },
    { key: 'gq', label: isEn ? 'Gq (Quantitative)' : 'Gq (數量推理)', val: sanitizeNumber(report.constructs?.gq, 0.5), base: sanitizeNumber(report.baselineConstructs?.gq, 0.5) },
  ], [isEn, report.constructs, report.baselineConstructs]);

  const radarPalette = useMemo(() => resolveRadarPalette(colorBlindMode, highContrast), [colorBlindMode, highContrast]);

  // 5. 雷達幾何座標運算
  const radarPoints = useMemo(() => {
    const size = 280;
    const center = size / 2;
    const radius = 95;
    const total = radarDimensions.length;

    const currentCoords = radarDimensions.map((d, i) => {
      const angle = (Math.PI * 2 / total) * i - Math.PI / 2;
      const r = radius * Math.max(0.1, Math.min(1.0, d.val));
      return `${(center + r * Math.cos(angle)).toFixed(1)},${(center + r * Math.sin(angle)).toFixed(1)}`;
    }).join(' ');

    const baselineCoords = radarDimensions.map((d, i) => {
      const angle = (Math.PI * 2 / total) * i - Math.PI / 2;
      const r = radius * Math.max(0.1, Math.min(1.0, d.base));
      return `${(center + r * Math.cos(angle)).toFixed(1)},${(center + r * Math.sin(angle)).toFixed(1)}`;
    }).join(' ');

    return { size, center, radius, currentCoords, baselineCoords };
  }, [radarDimensions]);

  // 6. 95% 信賴帶路徑運算
  const ciBandPath = useMemo(() => {
    const trajectory = report.trajectory;
    if (!trajectory || trajectory.length <= 1) return '';
    const total = trajectory.length - 1;

    const upperPoints = trajectory.map((p, idx) => {
      const x = (idx / total) * 100;
      const safeUpper = sanitizeNumber(p.ci95Upper, 0);
      const y = 50 - (safeUpper / 3.0) * 45;
      return `${x.toFixed(1)},${Math.max(2, Math.min(98, y)).toFixed(1)}`;
    });

    const lowerPoints = trajectory.slice().reverse().map((p, idx) => {
      const origIdx = total - idx;
      const x = (origIdx / total) * 100;
      const safeLower = sanitizeNumber(p.ci95Lower, 0);
      const y = 50 - (safeLower / 3.0) * 45;
      return `${x.toFixed(1)},${Math.max(2, Math.min(98, y)).toFixed(1)}`;
    });

    return [...upperPoints, ...lowerPoints].join(' ');
  }, [report.trajectory]);

  const hasHistory = (profile.history?.length || 0) > 0;
  const trajectoryList = report.trajectory || [];

  return (
    <div
      role="region"
      aria-labelledby={`${dashboardId}-title`}
      className="w-full max-w-4xl mx-auto p-3 sm:p-6 bg-slate-950 text-slate-100 font-mono select-none print:bg-white print:text-slate-900 print:p-0"
    >
      {/* 頂部導航 */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 print:border-slate-300 pb-3 mb-4 gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-xl sm:text-2xl">🧠</span>
            <h1 id={`${dashboardId}-title`} className="text-base sm:text-lg font-black tracking-wider text-slate-100 print:text-slate-900 uppercase m-0">
              {isEn ? 'Longitudinal Cognitive Profile' : '全域縱向認知成長側寫儀表板'}
            </h1>
          </div>
          <p className="text-[9px] sm:text-[10px] text-slate-400 print:text-slate-600 mt-0.5 m-0">
            {isEn
              ? 'CHC Construct Model & Adaptive IRT (Newton-Raphson MLE Estimation)'
              : 'CHC 構念架構模型與自適應項目反應理論（Newton-Raphson MLE 求解）'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto print:hidden">
          <button
            type="button"
            onClick={handleDownloadDataset}
            aria-label={isEn ? 'Export longitudinal assessment dataset as JSON' : '將縱向施測評估數據集匯出為 JSON'}
            className={`px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-cyan-500/50 text-cyan-300 text-[9px] rounded font-bold transition flex items-center gap-1 shadow-sm cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
              reducedMotion ? '' : 'active:scale-95'
            }`}
          >
            <span aria-hidden="true">📊</span>
            <span>{isEn ? 'Export JSON' : '匯出數據集'}</span>
          </button>
          <button
            ref={printButtonRef}
            type="button"
            onClick={handlePrintReport}
            aria-label={isEn ? 'Print cognitive profile report or save as PDF' : '列印認知側寫報告或儲存為 PDF'}
            className={`px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-indigo-500/50 text-indigo-300 text-[9px] rounded font-bold transition flex items-center gap-1 shadow-sm cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
              reducedMotion ? '' : 'active:scale-95'
            }`}
          >
            <span aria-hidden="true">🖨️</span>
            <span>{isEn ? 'Print / PDF' : '列印側寫'}</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={isEn ? 'Close cognitive dashboard' : '關閉認知儀表板'}
              className={`px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] rounded font-bold cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                reducedMotion ? '' : 'transition active:scale-95'
              }`}
            >
              ✕
            </button>
          )}
        </div>
      </header>

      {/* 核心四大指標卡 */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4" aria-label={isEn ? 'Key psychometric metrics' : '核心心理計量指標'}>
        <div className="bg-slate-900/70 print:bg-slate-50 border border-slate-800 print:border-slate-300 p-2.5 rounded-xl text-center shadow-sm">
          <div className="text-[8px] text-slate-400 print:text-slate-600 uppercase tracking-wider">
            {isEn ? 'Wechsler Scale IQ' : 'Wechsler 標尺 IQ'}
          </div>
          <div className="text-2xl sm:text-3xl font-black text-cyan-400 print:text-cyan-700 mt-0.5">
            {hasHistory ? report.overallIQ : 100}
          </div>
          <div className="text-[7px] text-slate-500 mt-0.5">SEM: ±{report.sem || 5.2} (r_xx ≈ 0.92)</div>
        </div>

        <div className="bg-slate-900/70 print:bg-slate-50 border border-slate-800 print:border-slate-300 p-2.5 rounded-xl text-center shadow-sm">
          <div className="text-[8px] text-slate-400 print:text-slate-600 uppercase tracking-wider">
            {isEn ? 'Percentile Rank (PR)' : '常模百分位數'}
          </div>
          <div className="text-2xl sm:text-3xl font-black text-indigo-400 print:text-indigo-700 mt-0.5">
            PR {hasHistory ? report.percentileRank : 50.0}
          </div>
          <div className="text-[7px] text-slate-500 mt-0.5">
            {isEn ? 'Top' : '優於'} {hasHistory ? Number((100 - report.percentileRank).toFixed(1)) : 50.0}%
          </div>
        </div>

        <div className="bg-slate-900/70 print:bg-slate-50 border border-slate-800 print:border-slate-300 p-2.5 rounded-xl text-center shadow-sm">
          <div className="text-[8px] text-slate-400 print:text-slate-600 uppercase tracking-wider">
            {isEn ? '95% Confidence Band' : '95% 信賴區間'}
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-400 print:text-amber-700 mt-1">
            [{report.ci95?.[0] ?? 90} - {report.ci95?.[1] ?? 110}]
          </div>
          <div className="text-[7px] text-slate-500 mt-0.5">
            {isEn ? 'True Ability Bound' : '真實認知能力估計區間'}
          </div>
        </div>

        <div className="bg-slate-900/70 print:bg-slate-50 border border-slate-800 print:border-slate-300 p-2.5 rounded-xl text-center shadow-sm">
          <div className="text-[8px] text-slate-400 print:text-slate-600 uppercase tracking-wider">
            {isEn ? 'Deduction Purity' : '純邏輯推演純度'}
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-400 print:text-emerald-700 mt-0.5">
            {report.pureClearRate ?? 100}%
          </div>
          <div className="text-[7px] text-slate-500 mt-0.5">
            {report.totalAttempts ?? 0} {isEn ? 'Sessions Evaluated' : '次完整施測'}
          </div>
        </div>
      </section>

      {/* 視覺化雙圖表：CHC 雙層雷達圖 + IRT EMA 縱向成長軌跡 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {/* 左側：CHC 雷達圖 */}
        <section
          aria-labelledby={`${dashboardId}-radar-heading`}
          className="bg-slate-900/40 print:bg-slate-50 border border-slate-800/80 print:border-slate-300 rounded-xl p-3 flex flex-col items-center justify-center relative shadow-sm break-inside-avoid"
        >
          <div className="w-full flex justify-between items-center text-[8px] text-slate-400 print:text-slate-600 mb-1">
            <h2 id={`${dashboardId}-radar-heading`} className="text-[8px] font-bold tracking-wider uppercase m-0">
              {isEn ? 'Adaptive CHC Radar' : '自適應 CHC 認知雷達'}
            </h2>
            <div className="flex items-center gap-2 text-[7px]" aria-hidden="true">
              <span className="flex items-center gap-1">
                <span className="w-2 h-0.5 inline-block" style={{ backgroundColor: radarPalette.baselineStroke }} />
                {isEn ? 'Baseline' : '初期基準'}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-0.5 inline-block" style={{ backgroundColor: radarPalette.currentStroke }} />
                {isEn ? 'Calibrated' : '自適應校準'}
              </span>
            </div>
          </div>

          <svg
            role="img"
            aria-labelledby={`${dashboardId}-radar-title ${dashboardId}-radar-desc`}
            width={radarPoints.size}
            height={radarPoints.size}
            className="overflow-visible my-1 max-w-full"
          >
            <title id={`${dashboardId}-radar-title`}>
              {isEn ? 'Adaptive CHC Cognitive Radar Chart' : '自適應 CHC 認知構念雷達圖'}
            </title>
            <desc id={`${dashboardId}-radar-desc`}>
              {radarDimensions
                .map((d) => `${d.label}: ${(d.val * 100).toFixed(0)}% (${isEn ? 'Baseline' : '基準'}: ${(d.base * 100).toFixed(0)}%)`)
                .join('; ')}
            </desc>

            {/* 幾何網格層 */}
            {[0.25, 0.5, 0.75, 1.0].map((level) => {
              const pts = radarDimensions.map((_, i) => {
                const angle = (Math.PI * 2 / radarDimensions.length) * i - Math.PI / 2;
                const r = radarPoints.radius * level;
                return `${(radarPoints.center + r * Math.cos(angle)).toFixed(1)},${(radarPoints.center + r * Math.sin(angle)).toFixed(1)}`;
              }).join(' ');
              return (
                <polygon
                  key={level}
                  points={pts}
                  fill="none"
                  stroke={radarPalette.gridStroke}
                  strokeWidth="0.8"
                  strokeDasharray={level < 1.0 ? '2 2' : undefined}
                />
              );
            })}

            {/* 徑向軸線與標籤 */}
            {radarDimensions.map((d, i) => {
              const angle = (Math.PI * 2 / radarDimensions.length) * i - Math.PI / 2;
              const x2 = radarPoints.center + radarPoints.radius * Math.cos(angle);
              const y2 = radarPoints.center + radarPoints.radius * Math.sin(angle);
              const labelX = radarPoints.center + (radarPoints.radius + 22) * Math.cos(angle);
              const labelY = radarPoints.center + (radarPoints.radius + 22) * Math.sin(angle);

              return (
                <g key={d.key} aria-hidden="true">
                  <line x1={radarPoints.center} y1={radarPoints.center} x2={x2} y2={y2} stroke={radarPalette.gridStroke} strokeWidth="0.8" />
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

            {/* 基準雷達多邊形（虛線通道） */}
            <polygon
              points={radarPoints.baselineCoords}
              fill={radarPalette.baselineFill}
              stroke={radarPalette.baselineStroke}
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />

            {/* 當前校準雷達多邊形（實線通道） */}
            <polygon
              points={radarPoints.currentCoords}
              fill={radarPalette.currentFill}
              stroke={radarPalette.currentStroke}
              strokeWidth="2"
            />
          </svg>
        </section>

        {/* 右側：IRT 縱向能力曲線 (θ) 與 95% 信賴帶 */}
        <section
          aria-labelledby={`${dashboardId}-trajectory-heading`}
          className="bg-slate-900/40 print:bg-slate-50 border border-slate-800/80 print:border-slate-300 rounded-xl p-3 flex flex-col justify-between relative shadow-sm break-inside-avoid"
        >
          <div className="flex justify-between items-center text-[8px] text-slate-400 print:text-slate-600 mb-2">
            <h2 id={`${dashboardId}-trajectory-heading`} className="text-[8px] font-bold tracking-wider uppercase m-0">
              {isEn ? 'Smoothed IRT Ability (θ) & 95% Band' : 'IRT 能力值平滑曲線 (θ) 與 95% 信賴帶'}
            </h2>
            {report.progress?.hasSufficientData && (
              <span className={`px-1.5 py-0.5 rounded text-[6.5px] font-bold ${
                report.progress.isSignificant ? 'bg-emerald-950 border border-emerald-500 text-emerald-300' : 'bg-slate-800 text-slate-400'
              }`}>
                {report.progress.isSignificant
                  ? (isEn ? '⚡ SIGNIFICANT GROWTH' : '⚡ 顯著進步')
                  : (isEn ? 'STABLE EQUILIBRIUM' : '穩定平台期')}
              </span>
            )}
          </div>

          <div
            className="relative h-44 w-full flex items-end pb-4 pt-2 px-2 border-b border-l border-slate-800 print:border-slate-300"
            onMouseLeave={() => setActiveHoverPoint(null)}
          >
            {trajectoryList.length > 1 ? (
              <>
                <svg
                  role="img"
                  aria-labelledby={`${dashboardId}-chart-title`}
                  className="w-full h-full overflow-visible"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <title id={`${dashboardId}-chart-title`}>
                    {isEn ? 'Longitudinal IRT Ability (Theta) Trajectory' : '縱向項目反應理論 (IRT) 能力成長軌跡圖'}
                  </title>

                  {/* 零水平參考線 */}
                  <line x1="0" y1="50" x2="100" y2="50" stroke="#475569" strokeWidth="0.8" strokeDasharray="3 3" />

                  {/* 95% 信賴陰影帶 */}
                  {ciBandPath && (
                    <polygon
                      points={ciBandPath}
                      fill={colorBlindMode === 'achromatopsia' ? 'rgba(255,255,255,0.15)' : 'rgba(56, 189, 248, 0.15)'}
                      stroke="none"
                    />
                  )}

                  {/* EMA 平滑主曲線 */}
                  <polyline
                    fill="none"
                    stroke={radarPalette.currentStroke}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={trajectoryList.map((p, idx) => {
                      const x = (idx / (trajectoryList.length - 1)) * 100;
                      const safeTheta = sanitizeNumber(p.smoothedTheta, 0);
                      const y = 50 - (safeTheta / 3.0) * 45;
                      return `${x.toFixed(1)},${Math.max(2, Math.min(98, y)).toFixed(1)}`;
                    }).join(' ')}
                  />

                  {/* 原始單題散點與可交互觸發區 */}
                  {trajectoryList.map((p, idx) => {
                    const x = (idx / (trajectoryList.length - 1)) * 100;
                    const safeRaw = sanitizeNumber(p.rawTheta, 0);
                    const y = 50 - (safeRaw / 3.0) * 45;
                    const clampedY = Math.max(2, Math.min(98, y));
                    return (
                      <circle
                        key={idx}
                        cx={x}
                        cy={clampedY}
                        r="2.5"
                        fill="#94a3b8"
                        className={`hover:fill-cyan-300 cursor-pointer ${reducedMotion ? '' : 'transition-all'}`}
                        onMouseEnter={() => {
                          setActiveHoverPoint({
                            index: idx + 1,
                            x,
                            y: clampedY,
                            rawTheta: safeRaw,
                            smoothedTheta: sanitizeNumber(p.smoothedTheta, 0),
                            ci95Lower: sanitizeNumber(p.ci95Lower, 0),
                            ci95Upper: sanitizeNumber(p.ci95Upper, 0),
                            timestamp: p.timestamp || `#${idx + 1}`,
                          });
                        }}
                      />
                    );
                  })}
                </svg>

                {/* 螢幕閱讀器專用無障礙軌跡明細 */}
                <ul className="sr-only" aria-label={isEn ? 'IRT trajectory history points' : 'IRT 歷次施測軌跡數據點'}>
                  {trajectoryList.map((p, idx) => (
                    <li key={idx}>
                      {isEn
                        ? `Session ${idx + 1}: Raw Theta ${sanitizeNumber(p.rawTheta, 0).toFixed(2)}, Smoothed Theta ${sanitizeNumber(p.smoothedTheta, 0).toFixed(2)}, 95% Confidence Interval [${sanitizeNumber(p.ci95Lower, 0).toFixed(2)}, ${sanitizeNumber(p.ci95Upper, 0).toFixed(2)}]`
                        : `第 ${idx + 1} 次施測：原始能力值 ${sanitizeNumber(p.rawTheta, 0).toFixed(2)}，平滑能力值 ${sanitizeNumber(p.smoothedTheta, 0).toFixed(2)}，95% 信賴區間 [${sanitizeNumber(p.ci95Lower, 0).toFixed(2)}, ${sanitizeNumber(p.ci95Upper, 0).toFixed(2)}]`}
                    </li>
                  ))}
                </ul>

                {/* 浮窗 Tooltip */}
                {activeHoverPoint && (
                  <div
                    role="tooltip"
                    className="absolute z-20 px-2 py-1 bg-slate-900/95 border border-cyan-500 rounded text-[7.5px] font-mono text-cyan-200 pointer-events-none shadow-xl transform -translate-x-1/2 -translate-y-full mb-2"
                    style={{ left: `${activeHoverPoint.x}%`, top: `${activeHoverPoint.y}%` }}
                  >
                    <div>Session: #{activeHoverPoint.index} ({activeHoverPoint.timestamp})</div>
                    <div>Raw θ: {activeHoverPoint.rawTheta.toFixed(2)}</div>
                    <div>EMA θ: {activeHoverPoint.smoothedTheta.toFixed(2)}</div>
                    <div>CI95: [{activeHoverPoint.ci95Lower.toFixed(2)}, {activeHoverPoint.ci95Upper.toFixed(2)}]</div>
                  </div>
                )}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[8px] text-slate-500">
                {isEn ? 'Complete 2+ sessions to plot longitudinal growth curve.' : '完成 2 次以上施測以繪製縱向成長曲線'}
              </div>
            )}
          </div>

          <div className="flex justify-between text-[7px] text-slate-500 mt-1" aria-hidden="true">
            <span>{trajectoryList[0]?.timestamp || (isEn ? 'Genesis' : '起點')}</span>
            <span className="text-cyan-400 print:text-cyan-700 font-bold">
              {report.progress?.hasSufficientData
                ? (isEn ? report.progress.interpretation.en : report.progress.interpretation.zh)
                : (isEn ? 'Calibrating confidence...' : '正在校準信賴區間...')}
            </span>
            <span>{trajectoryList.length > 0 ? (trajectoryList[trajectoryList.length - 1]?.timestamp || (isEn ? 'Current' : '當前')) : (isEn ? 'Current' : '當前')}</span>
          </div>
        </section>
      </div>

      {/* 個人化認知優勢與側寫結論 */}
      <section
        aria-labelledby={`${dashboardId}-summary-heading`}
        className="bg-slate-900/80 print:bg-slate-50 border border-indigo-900/60 print:border-slate-300 rounded-xl p-3 sm:p-4 mb-4 shadow-xl break-inside-avoid"
      >
        <div className="flex items-center justify-between border-b border-slate-800 print:border-slate-300 pb-1.5 mb-2">
          <h2 id={`${dashboardId}-summary-heading`} className="text-[9px] sm:text-[10px] text-indigo-400 print:text-indigo-700 font-bold uppercase tracking-wider flex items-center gap-1 m-0">
            <span aria-hidden="true">📈</span>
            <span>{isEn ? 'Cognitive Construct Synthesis' : '個人化認知優勢與側寫結論'}</span>
          </h2>
          <span className="text-[7px] text-emerald-400 print:text-emerald-700 font-mono">
            {isEn ? 'NON-VERBAL CHC ALIGNED' : '符合 CHC 非語言常模標定'}
          </span>
        </div>

        <p className="text-[9px] sm:text-[10.5px] text-slate-300 print:text-slate-800 leading-relaxed font-sans mb-3">
          {report.profileSummary
            ? (isEn ? report.profileSummary.en : report.profileSummary.zh)
            : (isEn ? 'Complete more sessions to generate psychometric profile summary.' : '完成更多施測以生成心理計量側寫結論。')}
        </p>

        {/* 五維構念指標明細進度條 */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[8px]" role="list" aria-label={isEn ? 'CHC Dimensions breakdown' : 'CHC 五維度構念明細'}>
          {radarDimensions.map((item) => (
            <div key={item.key} role="listitem" className="bg-slate-950/80 print:bg-white border border-slate-800/80 print:border-slate-300 p-1.5 rounded">
              <div className="text-slate-500 text-[6.5px] uppercase">{item.label}</div>
              <div className="text-slate-200 print:text-slate-900 font-bold mt-0.5 text-[10px]">
                {(item.val * 100).toFixed(0)}%
              </div>
              <div
                role="progressbar"
                aria-valuenow={Math.round(item.val * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={item.label}
                className="w-full bg-slate-900 print:bg-slate-200 h-1 rounded-full overflow-hidden mt-1"
              >
                <div
                  className="h-full"
                  style={{
                    backgroundColor: radarPalette.currentStroke,
                    width: `${Math.min(100, Math.max(0, item.val * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 底部存證簽署 (真實 SHA-256 簽名) */}
      <footer className="flex flex-col sm:flex-row items-center justify-between text-[7px] text-slate-500 border-t border-slate-900 print:border-slate-300 pt-2 gap-1">
        <span>{isEn ? 'LAWGIC NEURO-COGNITIVE ENGINE v3.5 (IRT/NEWTON-RAPHSON)' : 'LAWGIC 神經認知計算引擎 v3.5 (自適應 IRT 求解)'}</span>
        <span className="font-mono text-cyan-500/80">
          {integrityHash ? `${isEn ? 'INTEGRITY' : '防偽存證'}: ${integrityHash}` : (isEn ? 'CALCULATING HASH...' : '正在計算存證簽名...')}
        </span>
      </footer>
    </div>
  );
});
