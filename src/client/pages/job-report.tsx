import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Mail } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, ErrorState, ErrorSummary, LinkButton, LoadingBlock, PageHeader, Banner, useToast } from '../components/ui';
import { fmtDate, fmtDateTime } from '../lib/format';
import { OUTCOMES } from '../../shared/jobs';
import { reportLines } from '../../shared/report';
import { DeliveryList } from './jobdetail';

/**
 * The job report (R6-M4): what was asked for, what the driver found, notes, photos and signature, on
 * one printable page. "Print or save as PDF" uses the browser's print dialog; "Prepare email" puts a
 * text version in Messages for the office to review and send.
 */
export function JobReport() {
  const c = useCompany();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [c.cid, 'job', id], queryFn: () => get(`/c/${c.cid}/jobs/${id}`) });
  const prep = useSubmit(async () => {
    const r = await post(`/c/${c.cid}/jobs/${id}/report-message`, {});
    await qc.invalidateQueries({ queryKey: [c.cid] });
    toast(r.already ? 'The report email is already prepared. Review it in Messages.' : 'Report email prepared. Review and send it in Messages.');
  });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const { job, service, customer, location, files, billTo } = q.data;
  const done = !!job.completion;
  const lines = reportLines(service?.fields ?? [], job.details, job.completion?.values);
  const photos = (files ?? []).filter((f: any) => !f.name.startsWith('signature'));
  const signature = (files ?? []).find((f: any) => f.name.startsWith('signature'));
  const inspection = job.details?.service_detail === 'Inspection';
  const title = inspection ? 'Inspection report' : 'Job report';
  return (
    <div className="page page-narrow">
      <div className="no-print">
        <PageHeader back={{ to: c.to(`jobs/${id}`), label: `Job #${job.number}` }} title={title} actions={done ? <>
          <Button icon={<Printer aria-hidden />} onClick={() => window.print()}>Print or save as PDF</Button>
          {c.can('messages.send') && <Button variant="primary" icon={<Mail aria-hidden />} busy={prep.busy} onClick={() => prep.run()}>Prepare email</Button>}
        </> : undefined} />
        <ErrorSummary error={prep.error} />
        {!done && <Banner tone="info">The report is ready once the driver has recorded the visit.</Banner>}
        {c.can('messages.send') && done && <p className="small muted">The email goes to {billTo ? `${billTo.name} (who pays for this job)` : 'the customer'} and is not sent until someone sends it from Messages.{c.can('messages.view') ? <> <LinkButton size="sm" variant="ghost" to={c.to('messages')}>Open Messages</LinkButton></> : null}</p>}
      </div>
      {done && (
        <article className="card doc report" aria-label={title}>
          <header className="row-between" style={{ alignItems: 'flex-start', gap: 16 }}>
            <div>
              <div className="doc-title">{title}</div>
              <div className="muted">Job #{job.number} · {service?.name ?? 'Service'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <strong>{c.company.name}</strong>
              {c.company.phone && <div className="small">{c.company.phone}</div>}
              {c.company.email && <div className="small">{c.company.email}</div>}
            </div>
          </header>
          <dl className="kv" style={{ marginTop: 16 }}>
            <dt>Customer</dt><dd>{customer?.name ?? '—'}</dd>
            {billTo && <><dt>Ordered by</dt><dd>{billTo.name}</dd></>}
            <dt>Address</dt><dd>{location?.address ?? '—'}</dd>
            <dt>Visit</dt><dd>{fmtDateTime(job.completion.submittedAt ?? job.completed_at, c.company.timezone)}</dd>
            <dt>Outcome</dt><dd>{(OUTCOMES as any)[job.completion.outcome] ?? job.status}</dd>
            {job.completion.reason ? <><dt>What happened</dt><dd className="pre">{job.completion.reason}</dd></> : null}
            {lines.request.map((l) => <div key={l.label} style={{ display: 'contents' }}><dt>{l.label}</dt><dd>{l.value}</dd></div>)}
          </dl>
          {job.completion.lines?.length > 0 && <section style={{ marginTop: 20 }}>
            <h2 className="h3">Delivered</h2>
            <DeliveryList lines={job.completion.lines} unit={(service?.fields ?? []).find((f: any) => f.type === 'number' && f.stage !== 'request')?.unit ?? ''} />
          </section>}
          {lines.findings.length > 0 && <section style={{ marginTop: 20 }}>
            <h2 className="h3">Findings</h2>
            <table className="table report-table"><tbody>{lines.findings.map((l) => <tr key={l.label}><th scope="row">{l.label}</th><td className="pre">{l.value}</td></tr>)}</tbody></table>
          </section>}
          {job.completion.notes && <section style={{ marginTop: 20 }}><h2 className="h3">Notes</h2><p className="pre" style={{ margin: '6px 0 0' }}>{job.completion.notes}</p></section>}
          {photos.length > 0 && <section style={{ marginTop: 20 }}>
            <h2 className="h3">Photos</h2>
            <div className="report-photos">{photos.map((f: any, i: number) => <figure key={f.id}><img src={`/api/c/${c.cid}/jobs/${id}/files/${f.id}`} alt={`Site photo ${i + 1}`} /></figure>)}</div>
          </section>}
          {(signature || job.completion.signerName) && <section style={{ marginTop: 20 }}>
            <h2 className="h3">Signature</h2>
            {signature && <img className="report-signature" src={`/api/c/${c.cid}/jobs/${id}/files/${signature.id}`} alt={`Signature of ${job.completion.signerName || 'the customer'}`} />}
            {job.completion.signerName && <div className="small">Signed by {job.completion.signerName}</div>}
          </section>}
          <footer className="small muted" style={{ marginTop: 24 }}>Prepared {fmtDate(new Date().toISOString(), c.company.timezone)} by {c.company.name}.</footer>
        </article>
      )}
    </div>
  );
}
