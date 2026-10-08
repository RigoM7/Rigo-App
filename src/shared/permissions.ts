// Permission keys are the single vocabulary used by the server (enforcement) and the client
// (navigation only). The server never trusts the client's view of these. Descriptions use plain
// words; screens replace "work" and "customers" with the workspace's own words.

export const PERMISSIONS = {
  'workspace.settings': 'Change the workspace details, words, stages and fields',
  'members.view': 'See the team',
  'members.invite': 'Invite people and manage invitations',
  'members.manage': 'Change roles and remove people',
  'roles.manage': 'Add, rename and change roles',
  'customers.view': 'See customers, their places and history',
  'customers.edit': 'Add and edit customers',
  'customers.contact': 'See customer phone numbers and email addresses',
  'work.view_all': 'See all work',
  'work.view_assigned': 'See work assigned to them',
  'work.create': 'Add work',
  'work.edit': 'Edit, reschedule and cancel work',
  'work.assign': 'Assign people and equipment',
  'work.do': 'Move their assigned work forward',
  'equipment.manage': 'Add and edit equipment',
  'money.view': 'See prices, amounts and what customers owe',
  'catalog.manage': 'Set services and prices',
  'invoices.manage': 'Prepare, edit and issue invoices',
  'invoices.approve': 'Approve invoices',
  'payments.record': 'Record payments',
  'automation.manage': 'Choose what Rigo does on its own',
  'automation.control': 'Pause Rigo and take over',
  'approvals.decide': 'Approve or reject what Rigo prepared',
  'requests.manage': 'Run the booking page and answer requests',
  'templates.manage': 'Publish and apply templates',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS: { label: string; keys: Permission[] }[] = [
  { label: 'Work', keys: ['work.view_all', 'work.view_assigned', 'work.create', 'work.edit', 'work.assign', 'work.do', 'equipment.manage'] },
  { label: 'Customers', keys: ['customers.view', 'customers.edit', 'customers.contact', 'requests.manage'] },
  { label: 'Money', keys: ['money.view', 'catalog.manage', 'invoices.manage', 'invoices.approve', 'payments.record'] },
  { label: 'Automation', keys: ['automation.manage', 'automation.control', 'approvals.decide'] },
  { label: 'Team and setup', keys: ['members.view', 'members.invite', 'members.manage', 'roles.manage', 'workspace.settings', 'templates.manage'] },
];

/** Which screens a role opens on: the office places, or the worker's Today / Upcoming / Done. */
export type RoleApp = 'office' | 'worker';

export interface RolePreset { key: string; name: string; description: string; app: RoleApp; permissions: Permission[] }

/** Permission sets the role editor offers as starting points. Templates rename them. */
export const PERMISSION_PRESETS: Record<'manager' | 'scheduler' | 'worker' | 'bookkeeper' | 'front_desk', Permission[]> = {
  manager: ['members.view', 'members.invite', 'customers.view', 'customers.edit', 'customers.contact', 'work.view_all', 'work.create', 'work.edit',
    'work.assign', 'equipment.manage', 'money.view', 'catalog.manage', 'invoices.manage', 'invoices.approve', 'payments.record', 'approvals.decide', 'requests.manage'],
  scheduler: ['members.view', 'customers.view', 'customers.edit', 'customers.contact', 'work.view_all', 'work.create', 'work.edit', 'work.assign',
    'equipment.manage', 'requests.manage'],
  worker: ['work.view_assigned', 'work.do'],
  bookkeeper: ['members.view', 'customers.view', 'customers.edit', 'customers.contact', 'work.view_all', 'money.view', 'catalog.manage',
    'invoices.manage', 'invoices.approve', 'payments.record', 'approvals.decide'],
  front_desk: ['members.view', 'customers.view', 'customers.edit', 'customers.contact', 'work.view_all', 'work.create', 'work.edit', 'work.assign',
    'money.view', 'payments.record', 'requests.manage'],
};

export const has = (perms: readonly string[] | Set<string>, p: Permission) =>
  perms instanceof Set ? perms.has(p) : perms.includes(p);
