// web-frontend/src/components/VirtualGamepad.tsx
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  memo,
} from 'react';
import { useLanguage, Language } from '../contexts/LanguageContext';
import {
  useAccessibilitySettings,
  useAccessibilityActions,
} from '../contexts/AccessibilityContext';
import {
  JoystickManagerInstance,
  JoystickCallback,
  ActionCallback,
  DirectionStepCallback,
} from '../utils/joystickManager';

// 1. 全域 CustomEvent 強型別契約
declare global {
  interface WindowEventMap {
    'logicore:joystick-move-analog': CustomEvent<{ readonly x: number; readonly y: number }>;
    'logicore:joystick-move': CustomEvent<{ readonly dx: number; readonly dy: number }>;
    'logicore:joystick-look': CustomEvent<{ readonly x: number; readonly y: number }>;
    'logicore:joystick-action': CustomEvent<void>;
  }
}

interface Props {
  readonly onMove?: JoystickCallback;
  readonly onRotate?: JoystickCallback;
  readonly onAction?: ActionCallback;
  readonly onMoveStep?: DirectionStepCallback;
  readonly actionLabel?: string;
  readonly forceLang?: Language;
}

interface AxisState {
  readonly x: number;
  readonly y: number;
}

function formatAxisValueText(x: number, y: number, isEn: boolean): string {
  // 防禦性夾緊：將對角線最大 1.414 規範化限制在單位圓 1.0 以內
  const rawMag = Math.sqrt(x * x + y * y);
  const mag = Math.min(1.0, rawMag);
  if (mag < 0.08) {
    return isEn ? 'Centered' : '置中靜止';
  }

  const angleDeg = (Math.atan2(-y, x) * 180) / Math.PI; // -y 為向上
  let dir = '';

  if (angleDeg >= -22.5 && angleDeg < 22.5) {
    dir = isEn ? 'East' : '東向';
  } else if (angleDeg >= 22.5 && angleDeg < 67.5) {
    dir = isEn ? 'North-East' : '東北向';
  } else if (angleDeg >= 67.5 && angleDeg < 112.5) {
    dir = isEn ? 'North' : '北向';
  } else if (angleDeg >= 112.5 && angleDeg < 157.5) {
    dir = isEn ? 'North-West' : '西北向';
  } else if (angleDeg >= 157.5 || angleDeg < -157.5) {
    dir = isEn ? 'West' : '西向';
  } else if (angleDeg >= -157.5 && angleDeg < -112.5) {
    dir = isEn ? 'South-West' : '西南向';
  } else if (angleDeg >= -112.5 && angleDeg < -67.5) {
    dir = isEn ? 'South' : '南向';
  } else {
    dir = isEn ? 'South-East' : '東南向';
  }

  const pct = Math.round(mag * 100);
  return isEn ? `${dir} thrust ${pct}%` : `${dir} 推力 ${pct}%`;
}

export const VirtualGamepad: React.FC<Props> = memo(function VirtualGamepad({
  onMove,
  onRotate,
  onAction,
  onMoveStep,
  actionLabel,
  forceLang,
}) {
  const { lang: contextLang } = useLanguage();
  const currentLang = forceLang || contextLang;
  const isEn = currentLang === 'en';

  const { hapticFeedback, reducedMotion } = useAccessibilitySettings();
  const { playSound } = useAccessibilityActions();

  const t = useMemo(
    () => ({
      move: isEn ? 'Move (Left Stick)' : '移動 (左搖桿)',
      look: isEn ? 'Look (Right Stick)' : '視角 (右搖桿)',
      action: isEn ? 'Action' : '動作鍵',
      defaultActionLabel: isEn ? 'TRIGGER' : '觸發',
      mark: isEn ? '✦ MARK' : '✦ 信標',
    }),
    [isEn]
  );

  const resolvedActionLabel = actionLabel || t.defaultActionLabel;

  const leftZoneRef = useRef<HTMLDivElement>(null);
  const leftKnobRef = useRef<HTMLDivElement>(null);
  const rightZoneRef = useRef<HTMLDivElement>(null);
  const rightKnobRef = useRef<HTMLDivElement>(null);
  const gripBtnRef = useRef<HTMLButtonElement>(null);

  const managerRef = useRef<JoystickManagerInstance | null>(null);

  // 雙軸實體數值狀態追蹤（供 ARIA 與可視化同步消費）
  const [leftAxis, setLeftAxis] = useState<AxisState>({ x: 0, y: 0 });
  const [rightAxis, setRightAxis] = useState<AxisState>({ x: 0, y: 0 });
  const [isActionActive, setIsActionActive] = useState<boolean>(false);

  const isLeftActive = Math.abs(leftAxis.x) > 0.08 || Math.abs(leftAxis.y) > 0.08;
  const isRightActive = Math.abs(rightAxis.x) > 0.08 || Math.abs(rightAxis.y) > 0.08;

  // 2. Props 代理引用，確保底層實體不因父層回呼身份更新而銷毀
  const callbacksRef = useRef<{
    onMove?: JoystickCallback;
    onRotate?: JoystickCallback;
    onAction?: ActionCallback;
    onMoveStep?: DirectionStepCallback;
  }>({ onMove, onRotate, onAction, onMoveStep });

  useEffect(() => {
    callbacksRef.current = { onMove, onRotate, onAction, onMoveStep };
  }, [onMove, onRotate, onAction, onMoveStep]);

  // 3. 受控觸覺震動回饋：前庭安全與靜音優先
  const triggerHaptic = useCallback(
    (pattern: number | number[] = 15) => {
      if (!hapticFeedback || reducedMotion) return;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(pattern);
        } catch {}
      }
    },
    [hapticFeedback, reducedMotion]
  );

  const triggerHapticRef = useRef(triggerHaptic);
  useEffect(() => {
    triggerHapticRef.current = triggerHaptic;
  }, [triggerHaptic]);

  // 4. 底層搖桿生命週期：空依賴陣列掛載，徹底根除實體抖動重建
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
        setLeftAxis({ x, y });
        callbacksRef.current.onMove?.(x, y);

        window.dispatchEvent(
          new CustomEvent('logicore:joystick-move-analog', { detail: { x, y } })
        );
      },

      onMoveStep: (dx, dy) => {
        triggerHapticRef.current(8);
        callbacksRef.current.onMoveStep?.(dx, dy);

        window.dispatchEvent(
          new CustomEvent('logicore:joystick-move', { detail: { dx, dy } })
        );
      },

      onRotate: (x, y) => {
        setRightAxis({ x, y });
        callbacksRef.current.onRotate?.(x, y);

        window.dispatchEvent(
          new CustomEvent('logicore:joystick-look', { detail: { x, y } })
        );
      },

      onGrip: () => {
        triggerHapticRef.current(25);
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
  }, []);

  // 5. 鍵盤二維巡航激發（防長按音效/觸覺風暴防禦）
  const handleLeftKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let dx = 0;
      let dy = 0;

      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') dy = -1;
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') dy = 1;
      else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') dx = -1;
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') dx = 1;

      if (dx !== 0 || dy !== 0) {
        e.preventDefault();

        /* 設計決策：長按重複事件 (e.repeat) 僅驅動位移與自訂事件廣播，
           感官反饋（音效與觸覺震動）嚴格限制在首次按下時觸發一次，徹底杜絕感官風暴。 */
        if (!e.repeat) {
          playSound('step');
          triggerHaptic(8);
        }

        callbacksRef.current.onMoveStep?.(dx, dy);
        callbacksRef.current.onMove?.(dx, dy);
        setLeftAxis({ x: dx, y: dy });

        window.dispatchEvent(
          new CustomEvent('logicore:joystick-move', { detail: { dx, dy } })
        );
      }
    },
    [playSound, triggerHaptic]
  );

  const handleLeftKeyUp = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(e.key)) {
      setLeftAxis({ x: 0, y: 0 });
      callbacksRef.current.onMove?.(0, 0);
    }
  }, []);

  const handleRightKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let dx = 0;
      let dy = 0;

      if (e.key === 'ArrowUp' || e.key === 'i' || e.key === 'I') dy = -1;
      else if (e.key === 'ArrowDown' || e.key === 'k' || e.key === 'K') dy = 1;
      else if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') dx = -1;
      else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') dx = 1;

      if (dx !== 0 || dy !== 0) {
        e.preventDefault();

        if (!e.repeat) {
          playSound('step');
          triggerHaptic(8);
        }

        callbacksRef.current.onRotate?.(dx, dy);
        setRightAxis({ x: dx, y: dy });

        // 修正 P0 語法錯誤：{ x, dy: dy } -> { x: dx, y: dy }
        window.dispatchEvent(
          new CustomEvent('logicore:joystick-look', { detail: { x: dx, y: dy } })
        );
      }
    },
    [playSound, triggerHaptic]
  );

  const handleRightKeyUp = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'i', 'j', 'k', 'l', 'I', 'J', 'K', 'L'].includes(e.key)) {
      setRightAxis({ x: 0, y: 0 });
      callbacksRef.current.onRotate?.(0, 0);
    }
  }, []);

  const handleActionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        setIsActionActive(true);
        playSound('click');
        triggerHaptic(25);
        callbacksRef.current.onAction?.();
        window.dispatchEvent(new CustomEvent('logicore:joystick-action'));
      }
    },
    [playSound, triggerHaptic]
  );

  const handleActionKeyUp = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      setIsActionActive(false);
    }
  }, []);

  const handlePointerDownAction = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setIsActionActive(true);
  }, []);

  const handlePointerUpAction = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    setIsActionActive(false);
  }, []);

  return (
    <div
      role="region"
      aria-label={isEn ? 'Virtual Gamepad Controller' : '虛擬搖桿控制器'}
      className="w-full max-w-md mx-auto my-2 flex items-center justify-between px-3 select-none touch-none font-mono"
    >
      {/* 左搖桿：移動 (MOVE) */}
      <div className="flex flex-col items-center">
        <div
          ref={leftZoneRef}
          role="slider"
          aria-label={t.move}
          aria-valuemin={-1}
          aria-valuemax={1}
          aria-valuenow={Number(leftAxis.y.toFixed(2))}
          aria-valuetext={formatAxisValueText(leftAxis.x, leftAxis.y, isEn)}
          tabIndex={0}
          onKeyDown={handleLeftKeyDown}
          onKeyUp={handleLeftKeyUp}
          className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-slate-950/95 border-2 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
            reducedMotion ? '' : 'transition-shadow'
          } ${
            isLeftActive
              ? 'border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.5)] ring-2 ring-indigo-500/20'
              : 'border-slate-800 shadow-inner'
          }`}
        >
          {/* 十字方位微光導航刻度 */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30" aria-hidden="true">
            <div className="w-[1px] h-full bg-indigo-400/40" />
            <div className="h-[1px] w-full bg-indigo-400/40 absolute" />
          </div>

          <div
            ref={leftKnobRef}
            aria-hidden="true"
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 border border-indigo-200/50 shadow-xl pointer-events-none ${
              reducedMotion ? '' : 'transition-transform duration-75'
            } ${isLeftActive ? 'scale-110 shadow-indigo-500/60' : ''}`}
          />
        </div>
        <span
          aria-hidden="true"
          className={`text-[7.5px] font-bold mt-1 uppercase tracking-widest ${
            reducedMotion ? '' : 'transition-colors'
          } ${isLeftActive ? 'text-indigo-400' : 'text-slate-500'}`}
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
          onKeyDown={handleActionKeyDown}
          onKeyUp={handleActionKeyUp}
          onPointerDown={handlePointerDownAction}
          onPointerUp={handlePointerUpAction}
          onPointerCancel={handlePointerUpAction}
          className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl font-black text-[9px] sm:text-[10px] tracking-wider flex flex-col items-center justify-center shadow-lg border touch-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
            reducedMotion ? '' : 'transition-all duration-75 active:scale-90'
          } ${
            isActionActive
              ? 'bg-gradient-to-br from-cyan-400 to-blue-600 text-slate-950 border-white shadow-[0_0_18px_rgba(56,189,248,0.7)] scale-95'
              : 'bg-gradient-to-br from-cyan-600 to-blue-700 text-white border-cyan-400/40 shadow-cyan-900/40'
          }`}
        >
          <span className="leading-none">{resolvedActionLabel}</span>
          <span className="text-[6.5px] opacity-75 mt-0.5 font-mono" aria-hidden="true">
            {t.mark}
          </span>
        </button>
        <span
          aria-hidden="true"
          className={`text-[7.5px] font-bold mt-1 uppercase tracking-widest ${
            reducedMotion ? '' : 'transition-colors'
          } ${isActionActive ? 'text-cyan-400' : 'text-slate-500'}`}
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
          aria-valuemin={-1}
          aria-valuemax={1}
          aria-valuenow={Number(rightAxis.y.toFixed(2))}
          aria-valuetext={formatAxisValueText(rightAxis.x, rightAxis.y, isEn)}
          tabIndex={0}
          onKeyDown={handleRightKeyDown}
          onKeyUp={handleRightKeyUp}
          className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-slate-950/95 border-2 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
            reducedMotion ? '' : 'transition-shadow'
          } ${
            isRightActive
              ? 'border-cyan-400 shadow-[0_0_20px_rgba(56,189,248,0.5)] ring-2 ring-cyan-500/20'
              : 'border-slate-800 shadow-inner'
          }`}
        >
          {/* 十字方位微光導航刻度 */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30" aria-hidden="true">
            <div className="w-[1px] h-full bg-cyan-400/40" />
            <div className="h-[1px] w-full bg-cyan-400/40 absolute" />
          </div>

          <div
            ref={rightKnobRef}
            aria-hidden="true"
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-cyan-500 to-cyan-700 border border-cyan-200/50 shadow-xl pointer-events-none ${
              reducedMotion ? '' : 'transition-transform duration-75'
            } ${isRightActive ? 'scale-110 shadow-cyan-500/60' : ''}`}
          />
        </div>
        <span
          aria-hidden="true"
          className={`text-[7.5px] font-bold mt-1 uppercase tracking-widest ${
            reducedMotion ? '' : 'transition-colors'
          } ${isRightActive ? 'text-cyan-400' : 'text-slate-500'}`}
        >
          {t.look}
        </span>
      </div>
    </div>
  );
});
