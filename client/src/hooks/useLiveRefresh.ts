import { useEffect } from 'react';
import { useRevalidator } from 'react-router';
export default function useLiveRefresh(enabled: boolean) {
  const { revalidate, state } = useRevalidator();
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (state === 'idle') void revalidate();
    }, 2000);
    return () => clearInterval(timer);
  }, [enabled, revalidate, state]);
}
