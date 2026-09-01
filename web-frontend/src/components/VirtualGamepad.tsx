// web-frontend/src/components/VirtualGamepad.tsx
import React, { useEffect, useRef } from 'react';
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

  // 1. 防禦性實例持有者：杜絕極端生命週期下的未定義調用
  const managerRef = useRef<JoystickManagerInstance | null>(null);

  // 2. Props 記憶體位址代理：徹底阻斷父層 Re-render 的干擾
  const callbacksRef = useRef<{
    onMove?: JoystickCallback;
    onRotate?: JoystickCallback;
    onAction?: ActionCallback;
  }>({ onMove, onRotate, onAction });

  useEffect(() => {
    callbacksRef.current = { onMove, onRotate, onAction };
  }, [onMove, onRotate, onAction]);

  // 3. 單次掛載與安全清理 (Mount-Once with Defensive Cleanup)
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
      onMove: (x, y) => callbacksRef.current.onMove?.(x, y),
      onRotate: (x, y) => callbacksRef.current.onRotate?.(x, y),
      onGrip: () => callbacksRef.current.onAction?.(),
    });

    return () => {
      if (managerRef.current) {
        managerRef.current.destroy();
        managerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="w-full max-w-lg mt-3 flex items-center justify-between px-4 select-none touch-none font-mono">
      {/* 左搖桿 (移動/平移) */}
      <div className="flex flex-col items-center">
        <div
          ref={leftZoneRef}
          className="relative w-20 h-20 rounded-full bg-slate-900/90 border border-slate-700/80 shadow-inner flex items-center justify-center cursor-grab active:cursor-grabbing active:border-indigo-500"
        >
          <div
            ref={leftKnobRef}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 border border-indigo-300/40 shadow-lg pointer-events-none"
          />
        </div>
        <span className="text-[8px] text-slate-500 mt-1 uppercase tracking-widest">Move (L)</span>
      </div>

      {/* 中央主動作鍵 */}
      <div className="flex flex-col items-center">
        <button
          ref={gripBtnRef}
          className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-600 to-blue-700 active:from-cyan-500 active:to-blue-600 text-white font-bold text-[10px] tracking-wider border border-cyan-400/40 shadow-lg shadow-cyan-900/30 transition-transform active:scale-90"
        >
          {actionLabel}
        </button>
        <span className="text-[8px] text-slate-500 mt-1 uppercase tracking-widest">Action</span>
      </div>

      {/* 右搖桿 (視角/旋轉) */}
      <div className="flex flex-col items-center">
        <div
          ref={rightZoneRef}
          className="relative w-20 h-20 rounded-full bg-slate-900/90 border border-slate-700/80 shadow-inner flex items-center justify-center cursor-grab active:cursor-grabbing active:border-cyan-500"
        >
          <div
            ref={rightKnobRef}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-cyan-700 border border-cyan-300/40 shadow-lg pointer-events-none"
          />
        </div>
        <span className="text-[8px] text-slate-500 mt-1 uppercase tracking-widest">Look (R)</span>
      </div>
    </div>
  );
};
