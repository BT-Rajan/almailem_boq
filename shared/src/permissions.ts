/**
 * Every permission code the application knows. Code refers to these, never to role names.
 * database/seed/access.json must list exactly these (a test enforces it).
 */
export const PERMISSION_CODES = [
  'admin.users.manage',
  'admin.roles.view',
  'admin.costheads.manage',
  'admin.approvalrules.manage',
  'admin.audit.view',
  'admin.projects.access',
  'admin.projects.delete',
  'project.create',
  'project.edit',
  'project.view',
  'project.members.manage',
  'estimate.edit',
  'expense.create',
  'expense.reverse',
  'expense.view',
  'approval.request',
  'approval.decide',
  'report.view',
  'report.export',
  'import.run',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];
