-- Owner decision D7: the Office / billing preset can approve invoices and decide approvals.
-- Only companies whose Office role still has exactly the original preset get the new permissions;
-- an owner who customized the role keeps their choice.
update rigo.roles
   set permissions = permissions || array['invoices.approve', 'approvals.decide'],
       description = 'Manages customers, invoices, approvals and payments.'
 where key = 'office' and not is_owner
   and permissions @> array['members.view','customers.view','customers.edit','customers.contact','jobs.view_all','finance.view','invoices.view','invoices.edit','invoices.issue','payments.record','messages.view','messages.send','reports.view','imports.run','assistant.use']
   and array['members.view','customers.view','customers.edit','customers.contact','jobs.view_all','finance.view','invoices.view','invoices.edit','invoices.issue','payments.record','messages.view','messages.send','reports.view','imports.run','assistant.use'] @> permissions;
