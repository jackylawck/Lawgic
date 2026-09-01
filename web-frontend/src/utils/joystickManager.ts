// web-frontend/src/utils/joystickManager.ts

export type JoystickCallback = (x: number, y: number) => void;
export type ActionCallback = () => void;

export interface JoystickElements {
  leftZone?: HTMLElement | null;
  leftKnob?: HTMLElement | null;
  rightZone?: HTMLElement | null;
  rightKnob?: HTMLElement | null;
  gripBtn?: HTMLElement | null;
  onMove?: JoystickCallback;
  onRotate?: JoystickCallback;
  onGrip?: ActionCallback;
}

export class JoystickManagerInstance {
  private activePointers: { left: number | null; right: number | null } = { left: null, right: null };
  private _listeners: { target: EventTarget; type: string; fn: EventListenerOrEventListenerObject }[] = [];
  private _hapticState = {
    left: { passedDeadzone: false, reachedMax: false },
    right: { passedDeadzone: false, reachedMax: false },
  };

  public config = {
    deadzone: 0.08, // 8% 防誤觸死區
    curve: 1.8,     // 1.8 階指數手感曲線
    maxRadius: 1.0,
  };

  constructor(private elements: JoystickElements) {
    if (elements.leftZone && elements.leftKnob) {
      this._setupJoystick(elements.leftZone, elements.leftKnob, 'left', elements.onMove);
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
    callback?: JoystickCallback
  ) {
    let active = false;

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      active = true;
      this.activePointers[id] = e.pointerId;

      try {
        zone.setPointerCapture(e.pointerId);
      } catch {}

      zone.classList.add('active');
      // 按下時移除回彈過渡，達到 0 延遲跟手
      knob.style.transition = 'none';

      if (navigator.vibrate) navigator.vibrate(5);
      this._handleMove(e, zone, knob, id, callback);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!active || this.activePointers[id] !== e.pointerId) return;
      this._handleMove(e, zone, knob, id, callback);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!active || this.activePointers[id] !== e.pointerId) return;
      active = false;
      this.activePointers[id] = null;

      this._hapticState[id].passedDeadzone = false;
      this._hapticState[id].reachedMax = false;

      try {
        if (zone.hasPointerCapture(e.pointerId)) {
          zone.releasePointerCapture(e.pointerId);
        }
      } catch {}

      zone.classList.remove('active');

      // 🔥 彈性過衝物理回彈 (Elastic Snap-back)
      knob.style.transition = 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)';
      knob.style.transform = 'translate(-50%, -50%)';

      if (callback) callback(0, 0);
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
    zone: HTMLElement,
    knob: HTMLElement,
    id: 'left' | 'right',
    callback?: JoystickCallback
  ) {
    const rect = zone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = rect.width / 2;

    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const dist = Math.hypot(dx, dy);

    const deadzonePx = this.config.deadzone * maxRadius;
    if (dist < deadzonePx) {
      knob.style.transform = 'translate(-50%, -50%)';
      this._hapticState[id].passedDeadzone = false;
      if (callback) callback(0, 0);
      return;
    }

    const angle = Math.atan2(dy, dx);
    const clampedDist = Math.min(dist, maxRadius);

    const rawMagnitude = (clampedDist - deadzonePx) / (maxRadius - deadzonePx);
    const curvedMagnitude = Math.pow(Math.max(0, rawMagnitude), this.config.curve);

    const nx = Math.cos(angle) * curvedMagnitude;
    const ny = Math.sin(angle) * curvedMagnitude;

    // 分層微觸覺震動
    if (navigator.vibrate) {
      if (!this._hapticState[id].passedDeadzone && rawMagnitude > 0.01) {
        navigator.vibrate(8);
        this._hapticState[id].passedDeadzone = true;
      }
      if (!this._hapticState[id].reachedMax && rawMagnitude >= 0.98) {
        navigator.vibrate(12);
        this._hapticState[id].reachedMax = true;
      } else if (rawMagnitude < 0.92) {
        this._hapticState[id].reachedMax = false;
      }
    }

    const displayX = Math.cos(angle) * clampedDist;
    const displayY = Math.sin(angle) * clampedDist;
    knob.style.transform = `translate(calc(-50% + ${displayX}px), calc(-50% + ${displayY}px))`;

    if (callback) callback(nx, ny);
  }

  private _setupGripButton(btn: HTMLElement, onGrip?: ActionCallback) {
    let cooldown = false;

    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (cooldown) return;
      cooldown = true;

      if (navigator.vibrate) navigator.vibrate(20);

      btn.style.transform = 'scale(0.88)';
      if (onGrip) onGrip();

      setTimeout(() => {
        btn.style.transform = 'scale(1)';
        cooldown = false;
      }, 150);
    };

    btn.addEventListener('pointerdown', onPointerDown as EventListener);
    this._listeners.push({ target: btn, type: 'pointerdown', fn: onPointerDown as EventListener });
  }

  public destroy() {
    this._listeners.forEach(({ target, type, fn }) => {
      target.removeEventListener(type, fn);
    });
    this._listeners = [];
    this.activePointers = { left: null, right: null };
  }
}
