# DOMAIN (proposed)

Status: **PROPOSED**. The BoQ workbook was not available when this was written, so the
workbook analysis in section 6 is empty by design. No cost heads are listed or invented.

## 1. Mapping
Workbook > Project > Cost Head > Estimate > Expense > Approval

## 2. Entities
| Entity | Key fields | Notes |
|---|---|---|
| User | id, email (unique), name, password_hash, disabled, deleted_at | soft delete |
| Role | id, name | Admin, Project Manager, Accountant, Viewer (system roles) |
| Permission | id, key | bundled into roles via role_permissions |
| Project | id, code (unique), name, owner, start/end date, status, description, deleted_at | no money fields |
| ProjectMember | project_id, user_id | drives authorizeProjectAccess |
| CostHead | id, code (unique), name, description, display_order, active, deleted_at | managed master, 32 expected |
| ProjectEstimate | project_id, cost_head_id, amount_fils | unique per pair; this is the Budget |
| Expense | id, project_id, cost_head_id, vendor, invoice_no, date, amount_fils, description, attachment, created_by, status (pending/posted), reversal_of, reversed_at | unique (project, vendor, invoice_no); reversal = negative linked entry |
| Approval | id, expense_id, requested_by, reason, status | PENDING > APPROVED / REJECTED / CANCELLED |
| ApprovalAction | id, approval_id, actor, action, comment | one row per transition |
| Notification | id, user_id, type, payload, read_at | via notify() |
| AuditLog | id, event, actor, entity, before, after, at | append-only |

## 3. Relationships
Project 1..n ProjectEstimate n..1 CostHead. Project 1..n Expense n..1 CostHead. Expense 0..1 Approval 1..n ApprovalAction. User n..n Role; Role n..n Permission; User n..n Project via ProjectMember.

## 4. Definitions and rules
- **Budget** (per head) = ProjectEstimate.amount_fils. **Actual** = sum of posted, non-reversed expenses. **Remaining** = Budget - Actual. **Used** = Actual / Budget.
- Budget = 0: utilisation behaviour defined once in `domain/metrics` (open question Q5).
- **Status**: NORMAL 0-79.99%, WARNING 80-99.99%, APPROVAL_REQUIRED >= 100%. Thresholds are config, not code.
- Spend that would cross 100% is saved as pending, excluded from Actual, and needs Admin approval with a mandatory reason; requester cannot approve their own. The control engine is re-run at approval time.
- Money is integer fils (KWD, 3 decimals).

## 5. Permissions (draft list for seeding)
`admin.users.manage`, `admin.roles.view`, `admin.costheads.manage`, `admin.approvalrules.manage`, `admin.audit.view`, `project.create`, `project.edit`, `project.view`, `project.members.manage`, `estimate.edit`, `expense.create`, `expense.reverse`, `expense.view`, `approval.request`, `approval.decide`, `report.view`, `report.export`, `import.run`.
Role mapping to be agreed (Q6).

## 6. Workbook analysis
| Item | Finding |
|---|---|
| Sheets | **Not analysed. Workbook not provided.** |
| Cost heads | **None listed. To come from the workbook only.** |
| Headers, units, currency, hierarchy, merged cells, formulas | pending |

### Workbook column to domain field mapping
| Workbook column | Domain field | Status |
|---|---|---|
| (pending) | CostHead.code / name | pending |
| (pending) | ProjectEstimate.amount_fils | pending |

## 7. Open questions
1. **Please provide the BoQ workbook** (.xlsx). Sections 6 and the Chunk 05 seed depend on it. Attached
2. Is the workbook one project or a template reused across projects? Template
3. Currency: KWD only, or mixed? KWD only
4. Are there sub-items under each of the 32 cost heads (true BoQ lines), or only head-level totals? This decides whether the domain needs a BoQ line level. - could be
5. Budget = 0 with spend: treat as 100% (approval required) or undefined? yes
6. Role-to-permission mapping, especially Accountant versus Project Manager rights on estimates and expenses. - flat organisation for now will enforce RBAC later
7. Who is a "project admin" for the 80% warning in Chunk 11: project owner, or members with a given permission?
8. Confirm stack in DECISIONS.md D1.
