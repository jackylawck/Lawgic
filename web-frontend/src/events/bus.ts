import { ExtendedTierKey } from '../hooks/useLearnerProfile';

// U1: 提升為常數型別，供 vite-env.d.ts 映射
export const EVENT_PREFIX = 'logicore:' as const;
export type EventPrefix = typeof EVENT_PREFIX;

export interface EventMap {
  'joystick-move': { dx: number; dy: number };
  'joystick-look': { x: number; y: number };
  'joystick-action': void;
  'navigate-game': { gameId?: string; tier?: ExtendedTierKey };
  'update-available': { version?: string };
  // U2: 消除游離事件，統一納入型別契約
  'lang-changed': { lang: 'zh' | 'en' };
  'vault-updated': void;
}

type EventKey = keyof EventMap;

export const EventBus = {
  emit<K extends EventKey>(
    key: K,
    ...args: EventMap[K] extends void ? [] : [EventMap[K]]
  ): void {
    window.dispatchEvent(new CustomEvent(`${EVENT_PREFIX}${key}`, { detail: args[0] }));
  },

  on<K extends EventKey>(key: K, handler: (detail: EventMap[K]) => void): () => void {
    const listener = (event: Event) => {
      const customEvent = event as CustomEvent<EventMap[K]>;
      handler(customEvent.detail);
    };
    window.addEventListener(`${EVENT_PREFIX}${key}`, listener);
    return () => window.removeEventListener(`${EVENT_PREFIX}${key}`, listener);
  },
};
