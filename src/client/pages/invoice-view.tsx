import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { get } from '../lib/api';
import { Button, Banner, LoadingBlock, ErrorState } from '../components/ui';
import { InvoiceDocument } from '../components/invoice-doc';
import { useDocumentTitle } from '../lib/title';
import { accentVariants } from '../../shared/branding';

/** The customer's view of an issued invoice, from the link in the invoice email (R15-m4). No sign-in. */
export function PublicInvoice() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['public-invoice', token], queryFn: () => get(`/public/invoices/${token}`), retry: false });
  useDocumentTitle(q.data?.invoice ? `Invoice ${q.data.invoice.number} from ${q.data.company.name}` : 'Invoice');
  return (
    <main className="public-invoice">
      {q.isLoading ? <LoadingBlock /> : q.error ? (
        <ErrorState error={{ status: 404, message: 'This invoice link is not valid or has expired. Ask the company to send it again.' }} />
      ) : q.data.unavailable ? (
        <Banner tone="info" title={q.data.companyName}>{q.data.message}{q.data.companyPhone ? ` Phone: ${q.data.companyPhone}.` : ''}</Banner>
      ) : (
        <div className="stack">
          <div className="row-between no-print">
            <p className="muted" style={{ margin: 0 }}>{q.data.invoice.paymentStatus === 'paid' ? 'Paid in full. Thank you!' : 'Thank you for your business.'}</p>
            <Button icon={<Printer aria-hidden />} onClick={() => window.print()}>Print / save PDF</Button>
          </div>
          <InvoiceDocument company={q.data.company} invoice={q.data.invoice} lines={q.data.lines} logoUrl={q.data.company.logo ? `/api/public/invoices/${token}/logo` : null} accent={q.data.company.accent ? accentVariants(q.data.company.accent).light : undefined} />
        </div>
      )}
    </main>
  );
}
