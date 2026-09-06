// web-frontend/src/utils/joystickManager.ts

export type JoystickCallback = (x: number, y: number) => void;
export type DirectionStepCallback = (dx: number, dy: number) => void;
export type ActionCallback = () => void;

export type JoystickMode = 'fixed' | 'floating'; // 支援固定與動態浮動定位

export interface JoystickElements {
  leftZone?: HTMLElement | null;
  leftKnob?: HTMLElement | null;
  rightZone?: HTMLElement | null;
  rightKnob?: HTMLElement | null;
  gripBtn?: HTMLElement | null;
  onMove?: JoystickCallback;
  onMoveStep?: DirectionStepCallback;
  onRotate?: JoystickCallback;
  onGrip?: ActionCallback;
  mode?: JoystickMode;
}

interface CachedZoneData {
  centerX: number;
  centerY: number;
  maxRadius: number;
  isFloating?: boolean;
}

export class JoystickManagerInstance {
  private activePointers: { left: number | null; right: number | null } = { left: null, right: null };
  private _cachedZones: { left: CachedZoneData | null; right: CachedZoneData | null } = { left: null, right: null };
  private _listeners: { target: EventTarget; type: string; fn: EventListenerOrEventListenerObject; options?: AddEventListenerOptions }[] = [];
  
  private _hapticState = {
    left: { passedDeadzone: false, reachedMax: false },
    right: { passedDeadzone: false, reachedMax: false },
  };

  private _currentStepDir: { left: [number, number]; right: [number, number] } = {
    left: [0, 0],
    right: [0, 0],
  };

  // 電競級 DAS (Delayed Auto Shift) / ARR (Auto Repeat Rate) 計時器
  private _dasTimers: { left: ReturnType<typeof setTimeout> | null; right: ReturnType<typeof setTimeout> | null } = {
    left: null,
    right: null,
  };
  private _arrIntervals: { left: ReturnType<typeof setInterval> | null; right: ReturnType<typeof setInterval> | null } = {
    left: null,
    right: null,
  };

  private _rafId: { left: number | null; right: number | null } = { left: null, right: null };

  public config = {
    deadzone: 0.12,             // 12% 防誤觸死區
    curve: 1.5,                 // 1.5 階平滑非線性曲線
    dasDelayMs: 180,            // 首次步進防誤觸延遲 (Delayed Auto Shift)
    arrIntervalMs: 85,          // 連續快速步進頻率 (Auto Repeat Rate)
    diagonalThreshold: 0.38,    // 對角線死區夾角門檻 (約 22.5 度邊界保護)
    snapToCenterEasing: 'transform 0.18s cubic-bezier(0.18, 0.89, 0.32, 1.28)',
  };

  constructor(private elements: JoystickElements) {
    if (elements.leftZone && elements.leftKnob) {
      this._setupJoystick(elements.leftZone, elements.leftKnob, 'left', elements.onMove, elements.onMoveStep);
    }
    if (elements.rightZone && elements.rightKnob) {
      this._setupJoystick(elements.rightZone, elements.rightKnob, 'right', elements.onRotate);
    }
    if (elements.gripBtn) {
      this._setupGripButton(elements.gripBtn, elements.onGrip);
    }
  }

  private _setupJoystick(
    zone: HTMLElement,
    knob: HTMLElement,
    id: 'left' | 'right',
    analogCallback?: JoystickCallback,
    stepCallback?: DirectionStepCallback
  ) {
    let active = false;
    const isFloating = this.elements.mode === 'floating';

    // 開啟 GPU 合成層加速
    knob.style.willChange = 'transform';

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      active = true;
      this.activePointers[id] = e.pointerId;

      const rect = zone.getBoundingClientRect();
      const maxRadius = Math.min(rect.width, rect.height) / 2;

      // 浮動模式下以落點為新中心；固定模式下以區域正中為中心
      const centerX = isFloating ? e.clientX : rect.left + rect.width / 2;
      const centerY = isFloating ? e.clientY : rect.top + rect.height / 2;

      this._cachedZones[id] = {
        centerX,
        centerY,
        maxRadius,
        isFloating,
      };

      try {
        zone.setPointerCapture(e.pointerId);
      } catch {}

      zone.classList.add('active');
      knob.style.transition = 'none';

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(8);
      }
      this._handleMove(e, knob, id, analogCallback, stepCallback);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!active || this.activePointers[id] !== e.pointerId) return;
      this._handleMove(e, knob, id, analogCallback, stepCallback);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!active || this.activePointers[id] !== e.pointerId) return;
      active = false;
      this.activePointers[id] = null;
      this._cachedZones[id] = null;

      this._hapticState[id].passedDeadzone = false;
      this._hapticState[id].reachedMax = false;
      this._currentStepDir[id] = [0, 0];

      this._clearTimers(id);

      if (this._rafId[id]) {
        cancelAnimationFrame(this._rafId[id]!);
        this._rafId[id] = null;
      }

      try {
        if (zone.hasPointerCapture(e.pointerId)) {
          zone.releasePointerCapture(e.pointerId);
        }
      } catch {}

      zone.classList.remove('active');

      knob.style.transition = this.config.snapToCenterEasing;
      knob.style.transform = 'translate3d(-50%, -50%, 0)';

      if (analogCallback) analogCallback(0, 0);
    };

    const options: AddEventListenerOptions = { passive: false };
    zone.addEventListener('pointerdown', onPointerDown as EventListener, options);
    zone.addEventListener('pointermove', onPointerMove as EventListener, options);
    zone.addEventListener('pointerup', onPointerUp as EventListener, options);
    zone.addEventListener('pointercancel', onPointerUp as EventListener, options);

    this._listeners.push(
      { target: zone, type: 'pointerdown', fn: onPointerDown as EventListener, options },
      { target: zone, type: 'pointermove', fn: onPointerMove as EventListener, options },
      { target: zone, type: 'pointerup', fn: onPointerUp as EventListener, options },
      { target: zone, type: 'pointercancel', fn: onPointerUp as EventListener, options }
    );
  }

  private _clearTimers(id: 'left' | 'right') {
    if (this._dasTimers[id]) {
      clearTimeout(this._dasTimers[id]!);
      this._dasTimers[id] = null;
    }
    if (this._arrIntervals[id]) {
      clearInterval(this._arrIntervals[id]!);
      this._arrIntervals[id] = null;
    }
  }

  private _handleMove(
    e: PointerEvent,
    knob: HTMLElement,
    id: 'left' | 'right',
    analogCallback?: JoystickCallback,
    stepCallback?: DirectionStepCallback
  ) {
    const cached = this._cachedZones[id];
    if (!cached) return;

    const { centerX, centerY, maxRadius } = cached;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const dist = Math.hypot(dx, dy);

    const deadzonePx = this.config.deadzone * maxRadius;

    // 死區判定 (Deadzone Gating)
    if (dist < deadzonePx) {
      if (this._rafId[id]) cancelAnimationFrame(this._rafId[id]!);
      this._rafId[id] = requestAnimationFrame(() => {
        knob.style.transform = 'translate3d(-50%, -50%, 0)';
      });

      this._hapticState[id].passedDeadzone = false;
      this._currentStepDir[id] = [0, 0];
      this._clearTimers(id);

      if (analogCallback) analogCallback(0, 0);
      return;
    }

    const angle = Math.atan2(dy, dx);
    const clampedDist = Math.min(dist, maxRadius);

    const rawMagnitude = (clampedDist - deadzonePx) / (maxRadius - deadzonePx);
    const curvedMagnitude = Math.pow(Math.max(0, rawMagnitude), this.config.curve);

    const nx = Math.cos(angle) * curvedMagnitude;
    const ny = Math.sin(angle) * curvedMagnitude;

    // 階梯微反饋 (Hysteresis Protection)
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      if (!this._hapticState[id].passedDeadzone && rawMagnitude > 0.08) {
        navigator.vibrate(6);
        this._hapticState[id].passedDeadzone = true;
      }
      if (!this._hapticState[id].reachedMax && rawMagnitude >= 0.96) {
        navigator.vibrate(10);
        this._hapticState[id].reachedMax = true;
      } else if (rawMagnitude < 0.85) {
        this._hapticState[id].reachedMax = false;
      }
    }

    // GPU 加速位移渲染 (translate3d)
    const displayX = Math.cos(angle) * clampedDist;
    const displayY = Math.sin(angle) * clampedDist;
    if (this._rafId[id]) cancelAnimationFrame(this._rafId[id]!);
    this._rafId[id] = requestAnimationFrame(() => {
      knob.style.transform = `translate3d(calc(-50% + ${displayX.toFixed(1)}px), calc(-50% + ${displayY.toFixed(1)}px), 0)`;
    });

    if (analogCallback) analogCallback(nx, ny);

    // 電競級離散步進 (DAS + ARR 雙階響應)
    if (stepCallback) {
      let stepDx = 0;
      let stepDy = 0;

      // 八分角精準過濾：防止斜向微推引發晃動
      const absX = Math.abs(nx);
      const absY = Math.abs(ny);
      if (absX > absY) {
        stepDx = nx > 0 ? 1 : -1;
      } else {
        stepDy = ny > 0 ? 1 : -1;
      }

      const prevDir = this._currentStepDir[id];
      const isDirChanged = prevDir[0] !== stepDx || prevDir[1] !== stepDy;
      this._currentStepDir[id] = [stepDx, stepDy];

      if (isDirChanged) {
        this._clearTimers(id);

        // 1. 首次立即執行一次步進 (Tap feedback)
        stepCallback(stepDx, stepDy);

        // 2. 啟動 DAS (延遲防誤觸)
        this._dasTimers[id] = setTimeout(() => {
          // 3. 進入 ARR (高頻連續步進)
          this._arrIntervals[id] = setInterval(() => {
            const [curX, curY] = this._currentStepDir[id];
            if (curX !== 0 || curY !== 0) {
              stepCallback(curX, curY);
            }
          }, this.config.arrIntervalMs);
        }, this.config.dasDelayMs);
      }
    }
  }

  private _setupGripButton(btn: HTMLElement, onGrip?: ActionCallback) {
    let cooldown = false;
    btn.style.willChange = 'transform';

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (cooldown) return;
      cooldown = true;

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(15);
      }
      btn.style.transform = 'scale(0.88)';
      if (onGrip) onGrip();

      setTimeout(() => {
        btn.style.transform = 'scale(1)';
        cooldown = false;
      }, 140);
    };

    btn.addEventListener('pointerdown', onPointerDown as EventListener, { passive: false });
    this._listeners.push({ target: btn, type: 'pointerdown', fn: onPointerDown as EventListener });
  }

  public destroy() {
    this._clearTimers('left');
    this._clearTimers('right');

    Object.values(this._rafId).forEach((id) => {
      if (id) cancelAnimationFrame(id);
    });
    this._listeners.forEach(({ target, type, fn, options }) => {
      target.removeEventListener(type, fn, options);
    });
    this._listeners = [];
    this.activePointers = { left: null, right: null };
  }
}
