// web-frontend/src/utils/joystickManager.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JoystickManagerInstance } from './joystickManager';

describe('JoystickManager World-Class Verification Suite', () => {
  let zone: HTMLDivElement;
  let knob: HTMLDivElement;
  let base: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    zone = document.createElement('div');
    knob = document.createElement('div');
    base = document.createElement('div');
    document.body.appendChild(zone);
    zone.appendChild(base);
    zone.appendChild(knob);

    vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      width: 200,
      height: 200,
      right: 300,
      bottom: 300,
      x: 100,
      y: 100,
      toJSON: () => {},
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('測試 1：浮動模式 pointerdown 觸控落點時，knob 的 transform 正確包含基底偏移向量', () => {
    const manager = new JoystickManagerInstance({
      leftZone: zone,
      leftKnob: knob,
      leftBase: base,
      mode: 'floating',
    });

    zone.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 260, clientY: 240 }));
    zone.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 320, clientY: 240 }));

    vi.advanceTimersByTime(16);

    expect(knob.style.transform).toContain('translate3d');
    expect(knob.style.transform).toMatch(/calc\(-50% \+ \d+(\.\d+)?px\)/);

    manager.destroy();
  });

  it('測試 2：死區狀態下 knob 停在浮動基準點，不發生滑回容器中心的閃現', () => {
    const manager = new JoystickManagerInstance({
      leftZone: zone,
      leftKnob: knob,
      mode: 'floating',
    });

    zone.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 250, clientY: 250 }));
    zone.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 251, clientY: 251 }));

    vi.advanceTimersByTime(16);

    expect(knob.style.transform).toBe('translate3d(calc(-50% + 50.0px), calc(-50% + 50.0px), 0)');

    manager.destroy();
  });

  it('測試 3：destroy() 呼叫後，所有綁定事件完全解綁，Pointer 事件不再觸發任何回呼', () => {
    const moveSpy = vi.fn();
    const stepSpy = vi.fn();
    const manager = new JoystickManagerInstance({
      leftZone: zone,
      leftKnob: knob,
      onMove: moveSpy,
      onMoveStep: stepSpy,
    });

    manager.destroy();

    zone.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 250, clientY: 200 }));
    zone.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 280, clientY: 200 }));

    expect(moveSpy).toHaveBeenCalledTimes(0);
    expect(stepSpy).toHaveBeenCalledTimes(0);
  });

  it('測試 4：destroy() 執行後，註冊加速的 DOM 元素之 willChange 屬性被徹底清空以回收 GPU 圖層', () => {
    const manager = new JoystickManagerInstance({
      leftZone: zone,
      leftKnob: knob,
      leftBase: base,
      mode: 'floating',
    });

    expect(knob.style.willChange).toBe('transform');
    expect(base.style.willChange).toBe('transform, opacity');

    manager.destroy();

    expect(knob.style.willChange).toBe('');
    expect(base.style.willChange).toBe('');
  });

  it('測試 5：setPointerCapture 拋出例外時，Document 全域 fallback 確保 PointerUp 能被正確捕捉並釋放', () => {
    vi.spyOn(zone, 'setPointerCapture').mockImplementation(() => {
      throw new Error('PointerCapture not supported');
    });

    const moveSpy = vi.fn();
    const manager = new JoystickManagerInstance({
      leftZone: zone,
      leftKnob: knob,
      onMove: moveSpy,
    });

    zone.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, clientX: 200, clientY: 200 }));
    expect(zone.classList.contains('active')).toBe(true);

    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99 }));

    expect(zone.classList.contains('active')).toBe(false);
    expect(moveSpy).toHaveBeenLastCalledWith(0, 0);

    manager.destroy();
  });

  // P2-A 極端驗證
  it('P2-A 驗證：同一 Zone 被第一根手指鎖定後，第二根手指按下必須被拒絕，確保單指獨佔', () => {
    const moveSpy = vi.fn();
    const manager = new JoystickManagerInstance({
      leftZone: zone,
      leftKnob: knob,
      onMove: moveSpy,
    });

    // 手指 1 按下並鎖定
    zone.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 101, clientX: 200, clientY: 200 }));
    // 手指 2 在同一 Zone 試圖搶占按下
    zone.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 102, clientX: 220, clientY: 220 }));

    // 手指 2 抬起，不得中斷手指 1 的追蹤狀態
    zone.dispatchEvent(new PointerEvent('pointerup', { pointerId: 102 }));
    expect(zone.classList.contains('active')).toBe(true);

    // 手指 1 依然能正常操控
    zone.dispatchEvent(new PointerEvent('pointermove', { pointerId: 101, clientX: 250, clientY: 200 }));
    expect(moveSpy).toHaveBeenCalled();

    // 手指 1 抬起，正常釋放
    zone.dispatchEvent(new PointerEvent('pointerup', { pointerId: 101 }));
    expect(zone.classList.contains('active')).toBe(false);

    manager.destroy();
  });

  // P2-B 極端驗證
  it('P2-B 驗證：Zone 寬高為 0 時必須拒絕進入拖曳，杜絕產生 NaN 污染下游', () => {
    // 模擬容器未排版或 display: none
    vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const moveSpy = vi.fn();
    const manager = new JoystickManagerInstance({
      leftZone: zone,
      leftKnob: knob,
      onMove: moveSpy,
    });

    zone.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 201, clientX: 10, clientY: 10 }));
    zone.dispatchEvent(new PointerEvent('pointermove', { pointerId: 201, clientX: 50, clientY: 50 }));

    // 不得啟動且絕對不能呼叫包含 NaN 的回呼
    expect(zone.classList.contains('active')).toBe(false);
    expect(moveSpy).toHaveBeenCalledTimes(0);

    manager.destroy();
  });
});
