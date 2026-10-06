// Plain words for recorded actions in the activity log (R12-m2). Unknown actions fall back to their key.

const money = (m: unknown) => (typeof m === 'number' ? `$${(m / 100).toFixed(2)}` : '');

const TEXT: Record<string, (d: any) => string> = {
  'member.role_changed': (d) => `changed a member's role from ${d.from} to ${d.to}`,
  'member.removed': (d) => `removed a member${d.unassignedJobs ? ` (${d.unassignedJobs} open jobs returned to unassigned)` : ''}`,
  'member.reset_link_created': () => 'created a password reset link for a member',
  'invitation.created': (d) => `invited ${d.email} as ${d.role}`,
  'invitation.replaced': (d) => `replaced the invitation for ${d.email ?? 'someone'}${d.role ? ` (now ${d.role})` : ''}`,
  'invitation.revoked': () => 'revoked an invitation',
  'invitation.accepted': (d) => `joined as ${d.role}`,
  'role.updated': (d) => `changed the permissions of ${d.role ?? 'a role'}`,
  'approval.delegated': () => 'delegated their approval authority',
  'invoice.voided': (d) => `voided invoice ${d.number ?? ''}${d.reason ? `: ${d.reason}` : ''}`,
  'invoice.issued': (d) => `issued invoice ${d.number ?? ''}`,
  'invoice.approved': () => 'approved an invoice',
  'invoice.edited': () => 'edited a draft invoice',
  'invoice.credited': (d) => `added a credit note ${money(d.amountMinor)}`,
  'invoice.created_manually': () => 'created an invoice by hand',
  'invoice.sent_for_approval': () => 'sent an invoice for approval',
  'payment.recorded': (d) => `recorded a payment ${money(d.amountMinor)}`,
  'payment.confirmed': (d) => `confirmed a payment ${money(d.amountMinor)}`,
  'payment.rejected': (d) => `rejected a payment ${money(d.amountMinor)}${d.reason ? `: ${d.reason}` : ''}`,
  'payment.refunded': (d) => `recorded a refund ${money(d.amountMinor)}`,
  'company.settings_updated': () => 'changed company settings',
  'company.invoice_approval_changed': (d) => `turned the invoice approval rule ${d.required === false || d.to === false ? 'off' : 'on'}`,
  'branding.updated': () => 'changed the branding',
  'branding.logo_uploaded': () => 'uploaded a logo',
  'service.updated': () => 'changed a service or its prices',
  'service.created': () => 'added a service',
  'automation.mode_changed': (d) => `changed automation to ${d.to ?? d.mode ?? 'another mode'}`,
  'automation.paused': () => 'paused automation',
  'automation.resumed': () => 'resumed automation',
  'workflow.activated': () => 'activated a workflow',
  'workflow.deactivated': () => 'deactivated a workflow',
  'workflow.updated': () => 'edited a workflow',
  'workflow.created': () => 'created a workflow',
  'job.cancelled': (d) => `cancelled job #${d.number}${d.reason ? `: ${d.reason}` : ''}`,
  'jobs.truck_swapped': (d) => `swapped ${d.from} for ${d.to} on ${d.moved?.length ?? 0} job(s)`,
  'resource.out_of_service': (d) => `marked ${d.name} ${d.status === 'retired' ? 'retired' : 'out of service'}`,
  'resource.deleted': (d) => `deleted ${d.name}`,
  'late_record.accepted': () => "accepted a driver's late record",
  'late_record.dismissed': () => "dismissed a driver's late record",
  'plan.paused': () => 'paused a rental plan',
  'plan.ended': () => 'ended a rental plan',
  'customer.created': () => 'added a customer',
  'location.updated': () => 'changed a service location',
  'import.committed': () => 'imported records',
};

export function activityText(action: string, detail: unknown) {
  const f = TEXT[action];
  try { return f ? f(detail ?? {}) : action.replace(/[._]/g, ' '); } catch { return action.replace(/[._]/g, ' '); }
}
