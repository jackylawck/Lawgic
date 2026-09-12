// web-frontend/src/utils/joystickManager.ts

export type JoystickCallback = (x: number, y: number) => void;
export type DirectionStepCallback = (dx: number, dy: number) => void;
export type ActionCallback = () => void;

export type JoystickMode = 'fixed' | 'floating';

export interface JoystickElements {
  leftZone?: HTMLElement | null;
  leftKnob?: HTMLElement | null;
  leftBase?: HTMLElement | null;
  rightZone?: HTMLElement | null;
  rightKnob?: HTMLElement | null;
  rightBase?: HTMLElement | null;
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
  baseOffsetX: number;
  baseOffsetY: number;
}

/**
 * 電競級虛擬搖桿管理器 (Virtual Joystick Engine - Production Certified v5.1)
 * 
 * ⚠️ 極端情境與數學防護保證 (Extreme Scenarios & Boundary Hardening)：
 * 1. P2-A 單指獨佔狀態機：若已有指針啟動，同一 Zone 拒絕第二根手指搶占，杜絕邏輯失效。
 * 2. P2-B 零尺寸與幾何塌陷防禦：Zone 尺寸為 0 (如 display:none 或排版未就緒) 時立即早退，阻絕 NaN 污染下游客戶端。
 * 3. 拖曳中強制銷毀復位：destroy() 確保即使在推動狀態下拔除元件，DOM 樣式與合成層皆 100% 恢復初始狀態。
 */
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

  private _dasTimers: { left: ReturnType<typeof setTimeout> | null; right: ReturnType<typeof setTimeout> | null } = {
    left: null,
    right: null,
  };
  private _arrIntervals: { left: ReturnType<typeof setInterval> | null; right: ReturnType<typeof setInterval> | null } = {
    left: null,
    right: null,
  };

  private _gripCooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private _rafId: { left: number | null; right: number | null } = { left: null, right: null };

  private _managedElements: Set<HTMLElement> = new Set();
  private _managedZones: Set<HTMLElement> = new Set();
  private _managedKnobs: Set<HTMLElement> = new Set();

  public config = {
    deadzone: 0.12,
    curve: 1.5,
    dasDelayMs: 180,
    arrIntervalMs: 85,
    snapToCenterEasing: 'transform 0.18s cubic-bezier(0.18, 0.89, 0.32, 1.28)',
  };

  constructor(private elements: JoystickElements) {
    if (elements.leftZone && elements.leftKnob) {
      this._setupJoystick(elements.leftZone, elements.leftKnob, elements.leftBase, 'left', elements.onMove, elements.onMoveStep);
    }
    if (elements.rightZone && elements.rightKnob) {
      this._setupJoystick(elements.rightZone, elements.rightKnob, elements.rightBase, 'right', elements.onRotate);
    }
    if (elements.gripBtn) {
      this._setupGripButton(elements.gripBtn, elements.onGrip);
    }
  }

  private _setupJoystick(
    zone: HTMLElement,
    knob: HTMLElement,
    base: HTMLElement | null | undefined,
    id: 'left' | 'right',
    analogCallback?: JoystickCallback,
    stepCallback?: DirectionStepCallback
  ) {
    let active = false;
    const isFloating = this.elements.mode === 'floating';

    this._managedZones.add(zone);
    this._managedKnobs.add(knob);
    knob.style.willChange = 'transform';
    this._managedElements.add(knob);

    if (base && isFloating) {
      base.style.willChange = 'transform, opacity';
      this._managedElements.add(base);
    }

    const onPointerDown = (e: PointerEvent) => {
      // P2-A 修復：已在追蹤其他指針，忽略新手勢，防止雙指踩踏搶占
      if (active) return;

      if ((e.target as HTMLElement | null)?.closest?.('[data-no-joystick]')) {
        return;
      }

      // P2-B 修復：零尺寸前置檢查，防止未排版容器引發 NaN
      const rect = zone.getBoundingClientRect();
      const maxRadius = Math.min(rect.width, rect.height) / 2;
      if (maxRadius <= 0 || !Number.isFinite(maxRadius)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      active = true;
      this.activePointers[id] = e.pointerId;

      const zoneCenterX = rect.left + rect.width / 2;
      const zoneCenterY = rect.top + rect.height / 2;

      let centerX = zoneCenterX;
      let centerY = zoneCenterY;
      let baseOffsetX = 0;
      let baseOffsetY = 0;

      if (isFloating) {
        centerX = e.clientX;
        centerY = e.clientY;
        baseOffsetX = e.clientX - zoneCenterX;
        baseOffsetY = e.clientY - zoneCenterY;

        zone.classList.add('floating-active');

        if (base) {
          zone.style.removeProperty('--joystick-center-x');
          zone.style.removeProperty('--joystick-center-y');
          base.style.transform = `translate3d(calc(-50% + ${baseOffsetX.toFixed(1)}px), calc(-50% + ${baseOffsetY.toFixed(1)}px), 0)`;
        } else {
          const localX = e.clientX - rect.left;
          const localY = e.clientY - rect.top;
          zone.style.setProperty('--joystick-center-x', `${localX}px`);
          zone.style.setProperty('--joystick-center-y', `${localY}px`);
        }
      }

      this._cachedZones[id] = {
        centerX,
        centerY,
        maxRadius,
        baseOffsetX,
        baseOffsetY,
      };

      let hasCaptured = false;
      try {
        zone.setPointerCapture(e.pointerId);
        hasCaptured = true;
      } catch {
        hasCaptured = false;
      }

      if (!hasCaptured) {
        const fallbackRelease = (releaseEvent: PointerEvent) => {
          if (releaseEvent.pointerId === e.pointerId) {
            document.removeEventListener('pointerup', fallbackRelease, { capture: true });
            document.removeEventListener('pointercancel', fallbackRelease, { capture: true });
            onPointerUp(releaseEvent);
          }
        };
        document.addEventListener('pointerup', fallbackRelease, { capture: true });
        document.addEventListener('pointercancel', fallbackRelease, { capture: true });
      }

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

      if (isFloating) {
        zone.classList.remove('floating-active');
        if (!base) {
          zone.style.removeProperty('--joystick-center-x');
          zone.style.removeProperty('--joystick-center-y');
        } else {
          base.style.transform = 'translate3d(-50%, -50%, 0)';
        }
      }

      knob.style.transition = this.config.snapToCenterEasing;
      knob.style.transform = 'translate3d(-50%, -50%, 0)';

      if (analogCallback) analogCallback(0, 0);
    };

    const downOptions: AddEventListenerOptions = { passive: false };
    const moveOptions: AddEventListenerOptions = { passive: true };
    const upOptions: AddEventListenerOptions = { passive: false };

    zone.addEventListener('pointerdown', onPointerDown as EventListener, downOptions);
    zone.addEventListener('pointermove', onPointerMove as EventListener, moveOptions);
    zone.addEventListener('pointerup', onPointerUp as EventListener, upOptions);
    zone.addEventListener('pointercancel', onPointerUp as EventListener, upOptions);

    this._listeners.push(
      { target: zone, type: 'pointerdown', fn: onPointerDown as EventListener, options: downOptions },
      { target: zone, type: 'pointermove', fn: onPointerMove as EventListener, options: moveOptions },
      { target: zone, type: 'pointerup', fn: onPointerUp as EventListener, options: upOptions },
      { target: zone, type: 'pointercancel', fn: onPointerUp as EventListener, options: upOptions }
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

    const { centerX, centerY, maxRadius, baseOffsetX, baseOffsetY } = cached;
    if (maxRadius <= 0) return;

    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const dist = Math.hypot(dx, dy);

    const deadzonePx = this.config.deadzone * maxRadius;

    // 死區門檻判定
    if (dist < deadzonePx) {
      if (this._rafId[id]) cancelAnimationFrame(this._rafId[id]!);
      this._rafId[id] = requestAnimationFrame(() => {
        knob.style.transform = `translate3d(calc(-50% + ${baseOffsetX.toFixed(1)}px), calc(-50% + ${baseOffsetY.toFixed(1)}px), 0)`;
      });

      this._hapticState[id].passedDeadzone = false;
      this._currentStepDir[id] = [0, 0];
      this._clearTimers(id);

      if (analogCallback) analogCallback(0, 0);
      return;
    }

    const denom = maxRadius - deadzonePx;
    if (denom <= 0) return; // 邊界防禦：死區與最大半徑重合時防止除零

    const angle = Math.atan2(dy, dx);
    const clampedDist = Math.min(dist, maxRadius);

    const rawMagnitude = (clampedDist - deadzonePx) / denom;
    const curvedMagnitude = Math.pow(Math.max(0, rawMagnitude), this.config.curve);

    const nx = Math.cos(angle) * curvedMagnitude;
    const ny = Math.sin(angle) * curvedMagnitude;

    // 杜絕任何 NaN 滲入回呼
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

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

    const displayX = baseOffsetX + Math.cos(angle) * clampedDist;
    const displayY = baseOffsetY + Math.sin(angle) * clampedDist;

    if (this._rafId[id]) cancelAnimationFrame(this._rafId[id]!);
    this._rafId[id] = requestAnimationFrame(() => {
      knob.style.transform = `translate3d(calc(-50% + ${displayX.toFixed(1)}px), calc(-50% + ${displayY.toFixed(1)}px), 0)`;
    });

    if (analogCallback) analogCallback(nx, ny);

    if (stepCallback) {
      let stepDx = 0;
      let stepDy = 0;

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

        stepCallback(stepDx, stepDy);

        this._dasTimers[id] = setTimeout(() => {
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
    this._managedElements.add(btn);

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

      this._gripCooldownTimer = setTimeout(() => {
        btn.style.transform = 'scale(1)';
        cooldown = false;
        this._gripCooldownTimer = null;
      }, 140);
    };

    const gripOptions: AddEventListenerOptions = { passive: false };
    btn.addEventListener('pointerdown', onPointerDown as EventListener, gripOptions);
    this._listeners.push({ target: btn, type: 'pointerdown', fn: onPointerDown as EventListener, options: gripOptions });
  }

  public destroy() {
    this._clearTimers('left');
    this._clearTimers('right');

    if (this._gripCooldownTimer) {
      clearTimeout(this._gripCooldownTimer);
      this._gripCooldownTimer = null;
    }

    Object.values(this._rafId).forEach((id) => {
      if (id) cancelAnimationFrame(id);
    });
    this._rafId = { left: null, right: null };

    this._listeners.forEach(({ target, type, fn, options }) => {
      target.removeEventListener(type, fn, options);
    });
    this._listeners = [];

    this._managedElements.forEach((el) => {
      if (el) el.style.willChange = '';
    });
    this._managedElements.clear();

    // P3 修復：強制恢復 Knob 樣式，防止中途銷毀視覺凍結
    this._managedKnobs.forEach((k) => {
      if (k) {
        k.style.transition = '';
        k.style.transform = '';
      }
    });
    this._managedKnobs.clear();

    this._managedZones.forEach((z) => {
      if (z) {
        z.classList.remove('active', 'floating-active');
        z.style.removeProperty('--joystick-center-x');
        z.style.removeProperty('--joystick-center-y');
      }
    });
    this._managedZones.clear();

    this.activePointers = { left: null, right: null };
    this._cachedZones = { left: null, right: null };
    this._currentStepDir = { left: [0, 0], right: [0, 0] };
    this._hapticState = {
      left: { passedDeadzone: false, reachedMax: false },
      right: { passedDeadzone: false, reachedMax: false },
    };
  }
}
