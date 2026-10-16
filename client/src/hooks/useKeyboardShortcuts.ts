import { useEffect } from 'react';
import { useNavigate } from 'react-router';
export default function useKeyboardShortcuts(enabled: boolean) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !event.altKey
      )
        return;
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"]',
        )
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"]',
        ) ||
          (target.closest('input,textarea,select,[contenteditable="true"]') &&
            !target.closest('[data-chat-composer]')))
      )
        return;
      if (event.code === 'KeyN') {
        event.preventDefault();
        void navigate('/sessions/new');
      }
      if (event.code === 'Slash') {
        const composer = document.querySelector<HTMLTextAreaElement>(
          '[data-chat-composer]',
        );
        if (composer && !composer.disabled) {
          event.preventDefault();
          composer.focus();
        }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [enabled, navigate]);
}
