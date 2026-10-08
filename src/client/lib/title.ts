import { useEffect } from 'react';

/** Sets the browser tab title: "Page · Workspace · Rigo". */
export function useTitle(...parts: (string | null | undefined)[]) {
  const t = [...parts.filter(Boolean), 'Rigo'].join(' · ');
  useEffect(() => { document.title = t; }, [t]);
}
