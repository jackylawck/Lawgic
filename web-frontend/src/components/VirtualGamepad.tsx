// web-frontend/src/components/VirtualGamepad.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  JoystickManagerInstance,
  JoystickCallback,
  ActionCallback,
  DirectionStepCallback,
} from '../utils/joystickManager';

interface Props {
  onMove?: JoystickCallback;
  onRotate?: JoystickCallback;
  onAction?: ActionCallback;
  onMoveStep?: DirectionStepCallback;
  actionLabel?: string;
}

export const VirtualGamepad: React.FC<Props> = ({
  onMove,
  onRotate,
  onAction,
  onMoveStep,
  actionLabel,
}) => {
  const { lang } = useLanguage();
  const isEn = lang === 'en';

  const t = useMemo(() => ({
    move: isEn ? 'Move (L)' : '移動 (左搖桿)',
    look: isEn ? 'Look (R)' : '視角 (右搖桿)',
    action: isEn ? 'Action' : '動作鍵',
    defaultActionLabel: isEn ? 'TRIGGER' : '觸發',
    mark: isEn ? '✦ MARK' : '✦ 信標',
  }), [isEn]);

  const resolvedActionLabel = actionLabel || t.defaultActionLabel;

  const leftZoneRef = useRef<HTMLDivElement>(null);
  const leftKnobRef = useRef<HTMLDivElement>(null);
  const rightZoneRef = useRef<HTMLDivElement>(null);
  const rightKnobRef = useRef<HTMLDivElement>(null);
  const gripBtnRef = useRef<HTMLButtonElement>(null);

  const managerRef = useRef<JoystickManagerInstance | null>(null);

  // 觸控視覺活躍狀態
  const [isLeftActive, setIsLeftActive] = useState<boolean>(false);
  const [isRightActive, setIsRightActive] = useState<boolean>(false);
  const [isActionActive, setIsActionActive] = useState<boolean>(false);

  // Props 代理引用
  const callbacksRef = useRef<{
    onMove?: JoystickCallback;
    onRotate?: JoystickCallback;
    onAction?: ActionCallback;
    onMoveStep?: DirectionStepCallback;
  }>({ onMove, onRotate, onAction, onMoveStep });

  useEffect(() => {
    callbacksRef.current = { onMove, onRotate, onAction, onMoveStep };
  }, [onMove, onRotate, onAction, onMoveStep]);

  // 原生微振動觸覺回饋
  const triggerHaptic = useCallback((pattern: number | number[] = 15) => {
    if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  }, []);

  // 掛載搖桿生命週期與全域事件廣播
  useEffect(() => {
    if (
      !leftZoneRef.current ||
      !leftKnobRef.current ||
      !rightZoneRef.current ||
      !rightKnobRef.current ||
      !gripBtnRef.current
    ) {
      return;
    }

    managerRef.current = new JoystickManagerInstance({
      leftZone: leftZoneRef.current,
      leftKnob: leftKnobRef.current,
      rightZone: rightZoneRef.current,
      rightKnob: rightKnobRef.current,
      gripBtn: gripBtnRef.current,

      onMove: (x, y) => {
        const active = Math.abs(x) > 0.08 || Math.abs(y) > 0.08;
        setIsLeftActive(active);

        callbacksRef.current.onMove?.(x, y);

        window.dispatchEvent(
          new CustomEvent('logicore:joystick-move-analog', { detail: { x, y } })
        );
      },

      onMoveStep: (dx, dy) => {
        triggerHaptic(8);
        callbacksRef.current.onMoveStep?.(dx, dy);

        window.dispatchEvent(
          new CustomEvent('logicore:joystick-move', { detail: { dx, dy } })
        );
      },

      onRotate: (x, y) => {
        const active = Math.abs(x) > 0.08 || Math.abs(y) > 0.08;
        setIsRightActive(active);

        callbacksRef.current.onRotate?.(x, y);

        window.dispatchEvent(
          new CustomEvent('logicore:joystick-look', { detail: { x, y } })
        );
      },

      onGrip: () => {
        triggerHaptic(25);
        callbacksRef.current.onAction?.();

        window.dispatchEvent(new CustomEvent('logicore:joystick-action'));
      },
    });

    return () => {
      if (managerRef.current) {
        managerRef.current.destroy();
        managerRef.current = null;
      }
    };
  }, [triggerHaptic]);

  const handlePointerDownAction = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setIsActionActive(true);
  };

  const handlePointerUpAction = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    setIsActionActive(false);
  };

  return (
    <div
      role="region"
      aria-label={isEn ? 'Virtual Controller' : '虛擬搖桿控制器'}
      onContextMenu={(e) => e.preventDefault()}
      className="w-full max-w-md mx-auto my-2 flex items-center justify-between px-3 select-none touch-none font-mono"
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
    >
      {/* 左搖桿：移動 (MOVE) */}
      <div className="flex flex-col items-center">
        <div
          ref={leftZoneRef}
          role="slider"
          aria-label={t.move}
          aria-valuenow={isLeftActive ? 1 : 0}
          tabIndex={0}
          className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-slate-950/95 border-2 transition-shadow flex items-center justify-center cursor-grab active:cursor-grabbing touch-none focus:outline-none focus:ring-1 focus:ring-indigo-500/50 ${
            isLeftActive
              ? 'border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.5)] ring-2 ring-indigo-500/20'
              : 'border-slate-800 shadow-inner'
          }`}
        >
          {/* 十字方位微光導航刻度 */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30">
            <div className="w-[1px] h-full bg-indigo-400/40" />
            <div className="h-[1px] w-full bg-indigo-400/40 absolute" />
          </div>

          <div
            ref={leftKnobRef}
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 border border-indigo-200/50 shadow-xl pointer-events-none transition-transform duration-75 ${
              isLeftActive ? 'scale-110 shadow-indigo-500/60' : ''
            }`}
          />
        </div>
        <span
          className={`text-[7.5px] font-bold mt-1 uppercase tracking-widest transition-colors ${
            isLeftActive ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          {t.move}
        </span>
      </div>

      {/* 中央主動作鍵：標記/動作 (ACTION) */}
      <div className="flex flex-col items-center">
        <button
          ref={gripBtnRef}
          type="button"
          aria-label={resolvedActionLabel}
          onPointerDown={handlePointerDownAction}
          onPointerUp={handlePointerUpAction}
          onPointerCancel={handlePointerUpAction}
          className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl font-black text-[9px] sm:text-[10px] tracking-wider transition-all duration-75 flex flex-col items-center justify-center shadow-lg active:scale-90 border touch-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-cyan-400 ${
            isActionActive
              ? 'bg-gradient-to-br from-cyan-400 to-blue-600 text-slate-950 border-white shadow-[0_0_18px_rgba(56,189,248,0.7)] scale-95'
              : 'bg-gradient-to-br from-cyan-600 to-blue-700 text-white border-cyan-400/40 shadow-cyan-900/40'
          }`}
        >
          <span className="leading-none">{resolvedActionLabel}</span>
          <span className="text-[6.5px] opacity-75 mt-0.5 font-mono">{t.mark}</span>
        </button>
        <span
          className={`text-[7.5px] font-bold mt-1 uppercase tracking-widest transition-colors ${
            isActionActive ? 'text-cyan-400' : 'text-slate-500'
          }`}
        >
          {t.action}
        </span>
      </div>

      {/* 右搖桿：視角前瞻平移 (LOOK) */}
      <div className="flex flex-col items-center">
        <div
          ref={rightZoneRef}
          role="slider"
          aria-label={t.look}
          aria-valuenow={isRightActive ? 1 : 0}
          tabIndex={0}
          className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-slate-950/95 border-2 transition-shadow flex items-center justify-center cursor-grab active:cursor-grabbing touch-none focus:outline-none focus:ring-1 focus:ring-cyan-500/50 ${
            isRightActive
              ? 'border-cyan-400 shadow-[0_0_20px_rgba(56,189,248,0.5)] ring-2 ring-cyan-500/20'
              : 'border-slate-800 shadow-inner'
          }`}
        >
          {/* 十字方位微光導航刻度 */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30">
            <div className="w-[1px] h-full bg-cyan-400/40" />
            <div className="h-[1px] w-full bg-cyan-400/40 absolute" />
          </div>

          <div
            ref={rightKnobRef}
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-cyan-500 to-cyan-700 border border-cyan-200/50 shadow-xl pointer-events-none transition-transform duration-75 ${
              isRightActive ? 'scale-110 shadow-cyan-500/60' : ''
            }`}
          />
        </div>
        <span
          className={`text-[7.5px] font-bold mt-1 uppercase tracking-widest transition-colors ${
            isRightActive ? 'text-cyan-400' : 'text-slate-500'
          }`}
        >
          {t.look}
        </span>
      </div>
    </div>
  );
};
