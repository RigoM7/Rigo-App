import type { Db } from '../db/index.js';
import { GUIDE_JOB_NUMBER, type GuideProgress } from '../../shared/demo.js';

/**
 * Where the visitor is in the walkthrough, read from the records themselves (no polling, no extra
 * state): the guide job's driver and status, its invoice, and the invoice email.
 */
export async function guideProgress(db: Db, companyId: string, settings: any): Promise<GuideProgress> {
  const driverId = settings?.demo?.driverUserId ?? null;
  const { rows } = await db.query<any>(
    `select j.id, j.number, j.status, j.assigned_user_id, coalesce(m.display_name, u.name) as assignee_name,
            (select coalesce(dm.display_name, du.name) from rigo.users du left join rigo.memberships dm on dm.user_id = du.id and dm.company_id = j.company_id where du.id = $3) as driver_name,
            i.id as invoice_id, i.status as invoice_status,
            (select ms.id from rigo.messages ms where ms.invoice_id = i.id order by ms.created_at desc limit 1) as message_id,
            (select ms.status from rigo.messages ms where ms.invoice_id = i.id order by ms.created_at desc limit 1) as message_status
       from rigo.jobs j left join rigo.users u on u.id = j.assigned_user_id left join rigo.memberships m on m.company_id = j.company_id and m.user_id = j.assigned_user_id
       left join rigo.invoices i on i.job_id = j.id and i.status <> 'void'
      where j.company_id = $1 and j.number = $2`, [companyId, GUIDE_JOB_NUMBER, driverId]);
  const j = rows[0];
  return {
    jobId: j?.id ?? null, jobNumber: GUIDE_JOB_NUMBER,
    assigned: !!j?.assigned_user_id, assignedToDemoDriver: !!j && j.assigned_user_id === driverId, demoDriverName: j?.driver_name ?? null, assigneeName: j?.assignee_name ?? null,
    completed: !!j && ['completed', 'partial'].includes(j.status),
    invoiceId: j?.invoice_id ?? null, approved: !!j && ['approved', 'issued'].includes(j.invoice_status),
    messageId: j?.message_id ?? null, sent: !!j && ['simulated', 'sent', 'delivered'].includes(j.message_status),
  };
}
