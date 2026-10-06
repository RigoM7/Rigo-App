import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Inbox, X } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, ApiError } from '../lib/api';
import { Button, Card, Empty, ErrorState, Field, LoadingBlock, PageHeader, Pill, Tabs, Textarea, Dialog, Banner, useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import { formatMoney } from '../../shared/billing';
import { OUTCOMES } from '../../shared/jobs';

// Records a driver sent after their job moved on: the job was given to someone else, finished first,
// or the driver was removed from the company (R9-M2, R12-M1). Nothing is applied until someone here
// accepts it; dismissing keeps the job as it is.

const WHY: Record<string, string> = {
  reassigned: 'The job was given to someone else first.',
  finished: 'The job was already finished.',
  removed: 'The driver was removed from the company.',
};

export function DriverRecords() {
  const c = useCompany();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const q = useQuery({ queryKey: [c.cid, 'pending-submissions', tab], queryFn: () => get<{ records: any[] }>(`/c/${c.cid}/pending-submissions${tab === 'all' ? '?status=all' : ''}`) });
  return (
    <div className="page page-narrow">
      <PageHeader title="Driver records to review" back={{ to: c.to('jobs'), label: 'Jobs' }} sub="Work a driver recorded after the job moved on. Accept it to use it, or dismiss it to keep the job as it is." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'pending', label: 'To review' }, { key: 'all', label: 'All' }]} label="Which records" />
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : q.data!.records.length === 0
        ? <Card><Empty icon={<Inbox />} title={tab === 'pending' ? 'Nothing to review' : 'No driver records yet'}>When a driver sends a record for a job that was reassigned or already finished, it waits here instead of being lost.</Empty></Card>
        : <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{q.data!.records.map((r) => <li key={r.id}><RecordCard r={r} /></li>)}</ul>}
    </div>
  );
}

function RecordCard({ r }: { r: any }) {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<'' | 'accept' | 'dismiss'>('');
  const [error, setError] = useState<ApiError | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [note, setNote] = useState('');
  const done = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const accept = async () => {
    setBusy('accept'); setError(null);
    try { const res = await post<{ message: string }>(`/c/${c.cid}/pending-submissions/${r.id}/accept`); toast(res.message); done(); }
    catch (e) { setError(e as ApiError); } finally { setBusy(''); }
  };
  const dismiss = async () => {
    setBusy('dismiss'); setError(null);
    try { await post(`/c/${c.cid}/pending-submissions/${r.id}/dismiss`, { note }); setDismissing(false); toast('Record dismissed. The job stays as it was.'); done(); }
    catch (e) { setError(e as ApiError); } finally { setBusy(''); }
  };
  const file = (id: string) => `/api/c/${c.cid}/pending-submissions/${r.id}/files/${id}`;
  const problems = Object.values(r.problems ?? {}) as string[];
  const finishedJob = ['completed', 'partial', 'unsuccessful', 'cancelled'].includes(r.jobStatus);
  return (
    <Card title={<h2 style={{ fontSize: 'var(--fs-18)' }}><Link to={c.to(`jobs/${r.jobId}`)}>Job #{r.jobNumber}</Link>{r.customerName ? ` · ${r.customerName}` : ''}</h2>}
      actions={r.status === 'pending' ? <Pill tone="warning">To review</Pill> : <Pill tone={r.status === 'accepted' ? 'success' : 'neutral'}>{r.status === 'accepted' ? 'Accepted' : 'Dismissed'}</Pill>}>
      <div className="stack">
        <p style={{ margin: 0 }}><strong>{r.driverName}</strong> recorded <strong>{OUTCOMES[r.outcome as keyof typeof OUTCOMES]?.toLowerCase() ?? r.outcome}</strong> on {fmtDateTime(r.createdAt, c.company.timezone)}. {WHY[r.reason] ?? ''}</p>
        {problems.length > 0 && <Banner tone="warning" title="Incomplete record">{problems.join(' ')}</Banner>}
        <dl className="kv">
          {r.reasonText && <div style={{ display: 'contents' }}><dt>What happened</dt><dd>{r.reasonText}</dd></div>}
          {r.values.map((v: any) => <div key={v.label} style={{ display: 'contents' }}><dt>{v.label}</dt><dd>{v.value}</dd></div>)}
          {r.notes && <div style={{ display: 'contents' }}><dt>Notes</dt><dd className="pre">{r.notes}</dd></div>}
          {r.problem && <div style={{ display: 'contents' }}><dt>Problem reported</dt><dd>{r.problem}</dd></div>}
          {r.signerName && <div style={{ display: 'contents' }}><dt>Signed by</dt><dd>{r.signerName}{r.signatureTyped ? ' (typed name, with their agreement)' : ''}</dd></div>}
          {r.collected && <div style={{ display: 'contents' }}><dt>Payment collected</dt><dd>{r.collected.method === 'check' ? `Check #${r.collected.reference}` : r.collected.method === 'cash' ? 'Cash' : 'Card on the terminal'}{r.collected.amountMinor != null ? `: ${formatMoney(r.collected.amountMinor, c.company.currency)}` : ''}</dd></div>}
        </dl>
        {r.status === 'pending' && (r.files.photoIds.length > 0 || r.files.signatureId) && (
          <div className="photo-grid">
            {r.files.photoIds.map((id: string, i: number) => <figure key={id}><a href={file(id)} target="_blank" rel="noreferrer"><img src={file(id)} alt={`Photo ${i + 1} from ${r.driverName}`} loading="lazy" /></a></figure>)}
            {r.files.signatureId && <figure><img src={file(r.files.signatureId)} alt={`Signature by ${r.signerName || 'the customer'}`} loading="lazy" /></figure>}
          </div>
        )}
        {r.status !== 'pending' && <p className="small muted" style={{ margin: 0 }}>{r.status === 'accepted' ? 'Accepted' : 'Dismissed'} by {r.decidedBy ?? 'someone'} on {fmtDateTime(r.decidedAt, c.company.timezone)}.{r.decisionNote ? ` Note: ${r.decisionNote}` : ''}</p>}
        {error && <Banner tone="danger">{error.message}</Banner>}
        {r.status === 'pending' && (
          <>
            <p className="small muted" style={{ margin: 0 }}>{finishedJob ? 'The job already has an outcome. Accepting adds this record to its history (and any payment collected, for you to confirm); it does not replace the outcome.' : 'Accepting records this outcome on the job, as if the driver had sent it in time. Billing follows as usual.'}</p>
            <div className="row">
              <Button variant="primary" icon={<Check aria-hidden />} busy={busy === 'accept'} onClick={accept}>{busy === 'accept' ? 'Accepting…' : 'Accept record'}</Button>
              <Button variant="danger" icon={<X aria-hidden />} onClick={() => setDismissing(true)}>Dismiss</Button>
            </div>
          </>
        )}
      </div>
      <Dialog open={dismissing} onClose={() => setDismissing(false)} title={`Dismiss ${r.driverName}'s record for job #${r.jobNumber}?`}
        footer={<><Button onClick={() => setDismissing(false)}>Cancel</Button><Button variant="danger" icon={<X aria-hidden />} busy={busy === 'dismiss'} onClick={dismiss}>Dismiss record</Button></>}>
        <div className="stack">
          <p style={{ margin: 0 }}>The job stays as it is and this record is not used. It stays in the job's history.</p>
          <Field label="Note for the driver" optionalText id={`f-dismiss-${r.id}`} hint="They see it if they are still on the team.">{(p) => <Textarea {...p} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
      </Dialog>
    </Card>
  );
}
