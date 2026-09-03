// web-frontend/src/components/VirtualGamepad.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { JoystickManagerInstance, JoystickCallback, ActionCallback } from '../utils/joystickManager';

interface Props {
  onMove?: JoystickCallback;
  onRotate?: JoystickCallback;
  onAction?: ActionCallback;
  actionLabel?: string;
}

export const VirtualGamepad: React.FC<Props> = ({
  onMove,
  onRotate,
  onAction,
  actionLabel = 'TRIGGER',
}) => {
  const leftZoneRef = useRef<HTMLDivElement>(null);
  const leftKnobRef = useRef<HTMLDivElement>(null);
  const rightZoneRef = useRef<HTMLDivElement>(null);
  const rightKnobRef = useRef<HTMLDivElement>(null);
  const gripBtnRef = useRef<HTMLButtonElement>(null);

  const managerRef = useRef<JoystickManagerInstance | null>(null);

  // 1. 觸控視覺活躍狀態 (用餘光感知推桿狀態)
  const [isLeftActive, setIsLeftActive] = useState<boolean>(false);
  const [isRightActive, setIsRightActive] = useState<boolean>(false);
  const [isActionActive, setIsActionActive] = useState<boolean>(false);

  // 2. Props 代理位址
  const callbacksRef = useRef<{
    onMove?: JoystickCallback;
    onRotate?: JoystickCallback;
    onAction?: ActionCallback;
  }>({ onMove, onRotate, onAction });

  useEffect(() => {
    callbacksRef.current = { onMove, onRotate, onAction };
  }, [onMove, onRotate, onAction]);

  // 3. 原生微振動觸覺回饋 (Haptic Tick)
  const triggerHaptic = useCallback((pattern: number | number[] = 15) => {
    if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }, []);

  // 4. 掛載搖桿生命週期
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
        const active = Math.abs(x) > 0.1 || Math.abs(y) > 0.1;
        setIsLeftActive(active);
        callbacksRef.current.onMove?.(x, y);
      },
      onRotate: (x, y) => {
        const active = Math.abs(x) > 0.1 || Math.abs(y) > 0.1;
        setIsRightActive(active);
        callbacksRef.current.onRotate?.(x, y);
      },
      onGrip: () => {
        triggerHaptic(25);
        callbacksRef.current.onAction?.();
      },
    });

    return () => {
      if (managerRef.current) {
        managerRef.current.destroy();
        managerRef.current = null;
      }
    };
  }, [triggerHaptic]);

  // 5. 阻止 iOS 原生長按放大鏡與選單
  const preventSystemGestures = (e: React.TouchEvent | React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className="w-full max-w-md mx-auto my-2 flex items-center justify-between px-3 select-none touch-none font-mono"
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
    >
      {/* 左搖桿：移動 (MOVE) */}
      <div className="flex flex-col items-center">
        <div
          ref={leftZoneRef}
          onTouchStart={() => { setIsLeftActive(true); triggerHaptic(12); }}
          onTouchEnd={() => setIsLeftActive(false)}
          className={`relative w-18 h-18 sm:w-20 sm:h-20 rounded-full bg-slate-950/95 border-2 transition-shadow flex items-center justify-center cursor-grab active:cursor-grabbing ${
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
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 border border-indigo-200/50 shadow-xl pointer-events-none transition-transform duration-75 ${
              isLeftActive ? 'scale-110 shadow-indigo-500/60' : ''
            }`}
          />
        </div>
        <span className={`text-[7.5px] font-bold mt-1 uppercase tracking-widest transition-colors ${
          isLeftActive ? 'text-indigo-400' : 'text-slate-500'
        }`}>
          Move (L)
        </span>
      </div>

      {/* 中央主動作鍵：標記/動作 (ACTION) */}
      <div className="flex flex-col items-center">
        <button
          ref={gripBtnRef}
          onTouchStart={(e) => {
            preventSystemGestures(e);
            setIsActionActive(true);
            triggerHaptic(20);
          }}
          onTouchEnd={(e) => {
            preventSystemGestures(e);
            setIsActionActive(false);
          }}
          onMouseDown={() => setIsActionActive(true)}
          onMouseUp={() => setIsActionActive(false)}
          className={`relative w-13 h-13 sm:w-14 sm:h-14 rounded-2xl font-black text-[9px] sm:text-[10px] tracking-wider transition-all duration-75 flex flex-col items-center justify-center shadow-lg active:scale-90 border ${
            isActionActive
              ? 'bg-gradient-to-br from-cyan-400 to-blue-600 text-slate-950 border-white shadow-[0_0_18px_rgba(56,189,248,0.7)] scale-95'
              : 'bg-gradient-to-br from-cyan-600 to-blue-700 text-white border-cyan-400/40 shadow-cyan-900/40'
          }`}
        >
          <span className="leading-none">{actionLabel}</span>
          <span className="text-[6.5px] opacity-75 mt-0.5 font-mono">✦ MARK</span>
        </button>
        <span className={`text-[7.5px] font-bold mt-1 uppercase tracking-widest transition-colors ${
          isActionActive ? 'text-cyan-400' : 'text-slate-500'
        }`}>
          Action
        </span>
      </div>

      {/* 右搖桿：視角前瞻平移 (LOOK) */}
      <div className="flex flex-col items-center">
        <div
          ref={rightZoneRef}
          onTouchStart={() => { setIsRightActive(true); triggerHaptic(12); }}
          onTouchEnd={() => setIsRightActive(false)}
          className={`relative w-18 h-18 sm:w-20 sm:h-20 rounded-full bg-slate-950/95 border-2 transition-shadow flex items-center justify-center cursor-grab active:cursor-grabbing ${
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
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-cyan-500 to-cyan-700 border border-cyan-200/50 shadow-xl pointer-events-none transition-transform duration-75 ${
              isRightActive ? 'scale-110 shadow-cyan-500/60' : ''
            }`}
          />
        </div>
        <span className={`text-[7.5px] font-bold mt-1 uppercase tracking-widest transition-colors ${
          isRightActive ? 'text-cyan-400' : 'text-slate-500'
        }`}>
          Look (R)
        </span>
      </div>
    </div>
  );
};
