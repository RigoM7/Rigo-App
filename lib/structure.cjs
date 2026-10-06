// A company's setup as configuration operations: structure only. Records, people, prices, names,
// logos, credentials, integrations and automation choices are never included. Approval rules
// travel switched off so the receiving owner decides on them.
const domain = require('./domain.cjs');

function structureOps(state) {
  const blank = domain.createState('x');
  const ops = [];
  const added = state.modules.filter(m => !blank.modules.includes(m));
  if (added.length) ops.push({ op: 'modules', add: added });
  const labels = Object.fromEntries(Object.entries(state.terminology || {}).filter(([k, v]) => blank.terminology?.[k] !== v));
  if (Object.keys(labels).length) ops.push({ op: 'labels', terminology: labels });
  const listName = id => state.lists.find(l => l.id === id)?.name;
  for (const list of state.lists) {
    const base = blank.lists.find(l => l.id === list.id);
    if (!base && list.libraryVisible !== false) ops.push({ op: 'addList', name: list.name });
    for (const f of list.fields) {
      if (base?.fields.some(b => b.id === f.id || b.name === f.name) || ['code', 'name'].includes(f.id)) continue;
      const op = { op: 'addField', list: list.name, name: f.name, type: f.type };
      if (f.type === 'select') op.options = f.options || [];
      if (f.type === 'reference') { const target = listName(f.listId); if (!target) continue; op.target = target; }
      ops.push(op);
    }
  }
  if (!state.workflow.retired) ops.push({ op: 'workflow', statuses: state.workflow.statuses, checklist: state.workflow.checklist, active: true });
  for (const r of state.approvalRules || []) ops.push({ op: 'approvalRule', minTotal: r.minTotal, role: r.role, backupRole: r.backupRole || '', enabled: false });
  for (const [kind, handler] of Object.entries(state.exceptionRules || {})) ops.push({ op: 'exceptionRule', kind, handler });
  return ops;
}

// Plain-language preview of what a template adds to a blank company.
function previewOps(ops) {
  let s = domain.createState('Preview');
  s = domain.applyAction(s, { type: 'proposeConfig', ops, source: 'template' }, 'Owner');
  return s.configProposals[0].preview;
}

module.exports = { structureOps, previewOps };
