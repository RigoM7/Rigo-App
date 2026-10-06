// Permission keys are the single vocabulary used by the server (enforcement) and the client
// (navigation only). The server never trusts the client's view of these.

export const PERMISSIONS = {
  'company.settings': 'Edit company details, setup and branding',
  'members.view': 'See team members',
  'members.invite': 'Invite people and manage invitations',
  'members.manage': 'Change roles and remove members',
  'roles.manage': 'Edit role permissions',
  'customers.view': 'See customers and service locations',
  'customers.edit': 'Create and edit customers and locations',
  'customers.contact': 'See customer email and phone',
  'jobs.view_all': 'See all jobs',
  'jobs.view_assigned': 'See jobs assigned to them',
  'jobs.create': 'Create jobs',
  'jobs.edit': 'Edit and cancel jobs',
  'jobs.assign': 'Assign and reassign jobs',
  'jobs.work': 'Start and complete assigned jobs',
  'jobs.correct': 'Correct completed job records (with history)',
  'resources.view': 'See trucks and equipment',
  'resources.edit': 'Manage trucks and equipment',
  'services.manage': 'Configure services, fields and pricing',
  'finance.view': 'See prices, rates and invoice amounts',
  'invoices.view': 'See invoices',
  'invoices.edit': 'Prepare and edit draft invoices',
  'invoices.approve': 'Approve invoices',
  'invoices.issue': 'Issue invoices',
  'payments.record': 'Record payments',
  'workflows.view': 'See workflows and automation activity',
  'workflows.edit': 'Edit and test workflow drafts',
  'workflows.activate': 'Activate workflows',
  'automation.control': 'Pause, resume and take over automation',
  'approvals.decide': 'Act as an approver when assigned',
  'imports.run': 'Import records from files',
  'templates.manage': 'Create, share and apply templates',
  'reports.view': 'See the business overview',
  'messages.view': 'See customer communications',
  'messages.send': 'Prepare and send customer communications',
  'assistant.use': 'Use the assistant',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS: { label: string; keys: Permission[] }[] = [
  { label: 'Records', keys: ['customers.view', 'customers.edit', 'resources.view', 'resources.edit', 'jobs.view_all', 'jobs.view_assigned'] },
  { label: 'Fields', keys: ['customers.contact', 'finance.view'] },
  { label: 'Actions', keys: ['jobs.create', 'jobs.edit', 'jobs.assign', 'jobs.work', 'jobs.correct', 'messages.view', 'messages.send', 'imports.run', 'assistant.use'] },
  { label: 'Financial', keys: ['invoices.view', 'invoices.edit', 'invoices.issue', 'payments.record', 'reports.view'] },
  { label: 'Workflow configuration', keys: ['services.manage', 'workflows.view', 'workflows.edit', 'workflows.activate', 'automation.control', 'templates.manage'] },
  { label: 'Approval authority', keys: ['invoices.approve', 'approvals.decide'] },
  { label: 'Member management', keys: ['members.view', 'members.invite', 'members.manage', 'roles.manage', 'company.settings'] },
];

export interface RolePreset { key: string; name: string; description: string; permissions: Permission[]; isOwner?: boolean }

export const ROLE_PRESETS: RolePreset[] = [
  {
    key: 'owner', name: 'Owner', isOwner: true,
    description: 'Full control of the company, its configuration, members and approvals.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'dispatcher', name: 'Dispatcher',
    description: 'Creates jobs, organizes schedules and assigns drivers and equipment.',
    permissions: ['members.view', 'customers.view', 'customers.edit', 'customers.contact', 'jobs.view_all', 'jobs.create',
      'jobs.edit', 'jobs.assign', 'jobs.correct', 'resources.view', 'resources.edit', 'workflows.view', 'messages.view',
      'messages.send', 'assistant.use'],
  },
  {
    key: 'driver', name: 'Driver',
    description: 'Sees assigned work and the information needed to complete it.',
    permissions: ['jobs.view_assigned', 'jobs.work', 'resources.view', 'assistant.use'],
  },
  {
    key: 'office', name: 'Office / billing',
    description: 'Manages customers, invoices, approvals and payments.',
    permissions: ['members.view', 'customers.view', 'customers.edit', 'customers.contact', 'jobs.view_all', 'finance.view',
      'invoices.view', 'invoices.edit', 'invoices.approve', 'invoices.issue', 'payments.record', 'approvals.decide', 'messages.view', 'messages.send',
      'reports.view', 'imports.run', 'assistant.use'],
  },
];

export const has = (perms: readonly string[] | Set<string>, p: Permission) =>
  perms instanceof Set ? perms.has(p) : perms.includes(p);
