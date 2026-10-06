import { useEffect } from 'react';
import { useOptionalCompany } from './session';

/**
 * Sets the browser tab title: "Sign in · Rigo", or inside a company "Jobs · Acme Fuel · Rigo"
 * ("Jobs · Acme Fuel (Demo) · Rigo" in the demo), so people with several tabs can tell them apart.
 */
export function useDocumentTitle(page: string | null | undefined) {
  const c = useOptionalCompany();
  const company = c ? `${c.company.name}${c.company.kind === 'demo' ? ' (Demo)' : ''}` : null;
  useEffect(() => {
    if (!page) return;
    document.title = [page, company, 'Rigo'].filter(Boolean).join(' · ');
  }, [page, company]);
}
