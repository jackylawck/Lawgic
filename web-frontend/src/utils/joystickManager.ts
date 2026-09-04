// web-frontend/src/utils/joystickManager.ts

export type JoystickCallback = (x: number, y: number) => void;
export type DirectionStepCallback = (dx: number, dy: number) => void;
export type ActionCallback = () => void;

export interface JoystickElements {
  leftZone?: HTMLElement | null;
  leftKnob?: HTMLElement | null;
  rightZone?: HTMLElement | null;
  rightKnob?: HTMLElement | null;
  gripBtn?: HTMLElement | null;
  onMove?: JoystickCallback;
  onMoveStep?: DirectionStepCallback; // 專為網格遊戲設計的離散步進事件
  onRotate?: JoystickCallback;
  onGrip?: ActionCallback;
}

interface CachedZoneData {
  centerX: number;
  centerY: number;
  maxRadius: number;
}

export class JoystickManagerInstance {
  private activePointers: { left: number | null; right: number | null } = { left: null, right: null };
  private _cachedZones: { left: CachedZoneData | null; right: CachedZoneData | null } = { left: null, right: null };
  private _listeners: { target: EventTarget; type: string; fn: EventListenerOrEventListenerObject }[] = [];
  private _hapticState = {
    left: { passedDeadzone: false, reachedMax: false },
    right: { passedDeadzone: false, reachedMax: false },
  };

  // 離散步進定時器
  private _stepTimers: { left: ReturnType<typeof setInterval> | null; right: ReturnType<typeof setInterval> | null } = {
    left: null,
    right: null,
  };

  public config = {
    deadzone: 0.12,         // 12% 防誤觸死區
    curve: 1.6,             // 1.6 階響應曲線
    discreteStepInterval: 140, // 離散網格移動步進間隔 (ms)
    snapToCenterEasing: 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)',
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

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      active = true;
      this.activePointers[id] = e.pointerId;

      // 快取幾何計算，避免 move 時觸發 Layout Thrashing
      const rect = zone.getBoundingClientRect();
      this._cachedZones[id] = {
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        maxRadius: rect.width / 2,
      };

      try {
        zone.setPointerCapture(e.pointerId);
      } catch {}

      zone.classList.add('active');
      knob.style.transition = 'none';

      if (navigator.vibrate) navigator.vibrate(8);
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

      // 清除離散步進循環
      if (this._stepTimers[id]) {
        clearInterval(this._stepTimers[id]!);
        this._stepTimers[id] = null;
      }

      try {
        if (zone.hasPointerCapture(e.pointerId)) {
          zone.releasePointerCapture(e.pointerId);
        }
      } catch {}

      zone.classList.remove('active');

      // 物理回彈
      knob.style.transition = this.config.snapToCenterEasing;
      knob.style.transform = 'translate(-50%, -50%)';

      if (analogCallback) analogCallback(0, 0);
    };

    zone.addEventListener('pointerdown', onPointerDown as EventListener);
    zone.addEventListener('pointermove', onPointerMove as EventListener);
    zone.addEventListener('pointerup', onPointerUp as EventListener);
    zone.addEventListener('pointercancel', onPointerUp as EventListener);

    this._listeners.push(
      { target: zone, type: 'pointerdown', fn: onPointerDown as EventListener },
      { target: zone, type: 'pointermove', fn: onPointerMove as EventListener },
      { target: zone, type: 'pointerup', fn: onPointerUp as EventListener },
      { target: zone, type: 'pointercancel', fn: onPointerUp as EventListener }
    );
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

    // 死區判定
    if (dist < deadzonePx) {
      knob.style.transform = 'translate(-50%, -50%)';
      this._hapticState[id].passedDeadzone = false;
      if (analogCallback) analogCallback(0, 0);

      if (this._stepTimers[id]) {
        clearInterval(this._stepTimers[id]!);
        this._stepTimers[id] = null;
      }
      return;
    }

    const angle = Math.atan2(dy, dx);
    const clampedDist = Math.min(dist, maxRadius);

    const rawMagnitude = (clampedDist - deadzonePx) / (maxRadius - deadzonePx);
    const curvedMagnitude = Math.pow(Math.max(0, rawMagnitude), this.config.curve);

    const nx = Math.cos(angle) * curvedMagnitude;
    const ny = Math.sin(angle) * curvedMagnitude;

    // 觸覺微反饋
    if (navigator.vibrate) {
      if (!this._hapticState[id].passedDeadzone && rawMagnitude > 0.05) {
        navigator.vibrate(6);
        this._hapticState[id].passedDeadzone = true;
      }
      if (!this._hapticState[id].reachedMax && rawMagnitude >= 0.96) {
        navigator.vibrate(10);
        this._hapticState[id].reachedMax = true;
      } else if (rawMagnitude < 0.88) {
        this._hapticState[id].reachedMax = false;
      }
    }

    // 渲染搖桿球
    const displayX = Math.cos(angle) * clampedDist;
    const displayY = Math.sin(angle) * clampedDist;
    knob.style.transform = `translate(calc(-50% + ${displayX}px), calc(-50% + ${displayY}px))`;

    // 類比訊號回傳
    if (analogCallback) analogCallback(nx, ny);

    // 離散步進支援（專門解決走迷宮一次走一格的問題）
    if (stepCallback) {
      // 四方向吸附 (4-Way Discrete Snap)
      let stepDx = 0;
      let stepDy = 0;
      if (Math.abs(nx) > Math.abs(ny)) {
        stepDx = nx > 0 ? 1 : -1;
      } else {
        stepDy = ny > 0 ? 1 : -1;
      }

      // 如果尚未開啟步進循環，立即觸發一次並排程
      if (!this._stepTimers[id]) {
        stepCallback(stepDx, stepDy);
        this._stepTimers[id] = setInterval(() => {
          stepCallback(stepDx, stepDy);
        }, this.config.discreteStepInterval);
      }
    }
  }

  private _setupGripButton(btn: HTMLElement, onGrip?: ActionCallback) {
    let cooldown = false;

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (cooldown) return;
      cooldown = true;

      if (navigator.vibrate) navigator.vibrate(15);
      btn.style.transform = 'scale(0.88)';
      if (onGrip) onGrip();

      setTimeout(() => {
        btn.style.transform = 'scale(1)';
        cooldown = false;
      }, 140);
    };

    btn.addEventListener('pointerdown', onPointerDown as EventListener);
    this._listeners.push({ target: btn, type: 'pointerdown', fn: onPointerDown as EventListener });
  }

  public destroy() {
    Object.values(this._stepTimers).forEach((t) => {
      if (t) clearInterval(t);
    });
    this._listeners.forEach(({ target, type, fn }) => {
      target.removeEventListener(type, fn);
    });
    this._listeners = [];
    this.activePointers = { left: null, right: null };
  }
}
