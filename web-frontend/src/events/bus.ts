import { ExtendedTierKey } from '../hooks/useLearnerProfile';

export interface EventMap {
  'joystick-move': { dx: number; dy: number };
  'joystick-look': { x: number; y: number };
  'joystick-action': void;
  'navigate-game': { gameId?: string; tier?: ExtendedTierKey };
  'update-available': { version?: string };
}

type EventKey = keyof EventMap;
const EVENT_PREFIX = 'logicore:';

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
