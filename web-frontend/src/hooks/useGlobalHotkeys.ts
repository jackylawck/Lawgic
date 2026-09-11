import { useEffect } from 'react';

interface HotkeyActions {
  onPrev: () => void;
  onNext: () => void;
  onGenerate: () => void;
  onToggleTournament: () => void;
  disabled?: boolean;
}

export function useGlobalHotkeys({
  onPrev,
  onNext,
  onGenerate,
  onToggleTournament,
  disabled = false,
}: HotkeyActions) {
  useEffect(() => {
    if (disabled) return;

    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === '[' || e.key === 'PageUp') {
        e.preventDefault();
        onPrev();
      } else if (e.key === ']' || e.key === 'PageDown') {
        e.preventDefault();
        onNext();
      } else if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onGenerate();
      } else if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onToggleTournament();
      }
    };

    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [onPrev, onNext, onGenerate, onToggleTournament, disabled]);
}
