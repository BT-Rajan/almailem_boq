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
File: `BOQ_Final_Professional_-fatima.xlsx`, client "Mr. Abdulwahab A Almefleh", Sept 2026, currency KD (KWD). 39 sheets, all visible, no macros, no `#` errors, no external links found.

### 6.1 Sheet inventory (all 39 accounted for)
| Group | Sheets | Role |
|---|---|---|
| Presentation | `Cover` | Title only. Not data. |
| Reference | `Code Legend` | 57 sub-codes (CSI-style `NN NN NN` + name) for Div 05, 06, 08, 09, 22, 23, 26, plus 4 free-text notes (rows 67-70). |
| **New framework (24)** | `Div 01`-`Div 14`, `Div 20`-`Div 23`, `Div 25`-`Div 28`, `Div 31`, `Div 32` | One BoQ sheet per division. CSI MasterFormat, reserved divisions (15-19, 24, 29, 30) skipped. |
| New roll-up | `Collection (New Coding)` | Links each `Div NN` total, sums to **208,057 KD**. |
| **Legacy (11)** | `Div 1`, `Div 2`, `Div 3`, `Div 4`, `Div 5`, `Div 6`, `Div 7`, `Div 8`, `Div 9`, `Div 15`, `Div16` | Original sheets, untouched. Old numbering (Div 15 plumbing/HVAC, Div16 electrical). |
| Legacy roll-up | `Collecttion` (sic) | Links legacy totals, sums to **263,953.5 KD**. |

### 6.2 Sheet layout (every Div sheet)
Row 1-2 header: `ITEM | DESCRIPTION | QTY | UNIT | Unit Rate | Amount` (rate and amount in KD). Row 3 division title, row 4 boilerplate spec text (merged). Then item rows. Last row `Carried to Collection` = `SUM(F range)`, linked from the roll-up sheet. Hierarchy is positional: a coded row (`05 20 00`) is a group header, lettered rows (`A`, `B`) beneath it are the line items.

### 6.3 Cost heads as found
- **24 divisions** exist in the new framework (14 + 4 + 4 + 2), not 32. "32" appears to come from the CSI range 01-32; 8 of those numbers are reserved and skipped.
- **83 coded rows** across the 24 sheets (the finest level that carries a code; 57 of them are in `Code Legend`).
- Eight divisions are empty placeholders (10, 12, 20, 21, 25, 28, 31 hold 0; 32 holds a lump 2,000).
- Which level is the cost head (24 divisions, or 83 coded rows) is **open question Q9**. Nothing is seeded until you decide.

### 6.4 Column mapping
| Workbook column | Domain field | Notes |
|---|---|---|
| Sheet `Div NN` | CostHead group (division) | code `NN`, name from row 3 |
| ITEM (coded, e.g. `22 70 00`) | CostHead.code (if leaf level chosen) | |
| ITEM (letter `A`, `B`) | BoQ line sequence | only if a line level is built (Q4) |
| DESCRIPTION | CostHead.name / line description | |
| QTY, UNIT, Unit Rate | line qty, unit, rate_fils | only if line level is built |
| Amount (col F) | ProjectEstimate.amount_fils | KD x 1000 = fils; rolled up to the chosen head level |
| `Carried to Collection` | derived, never stored | recomputed by `domain/metrics` |

### 6.5 Data problems found (the importer in Chunk 15 must handle or reject these)
1. **Totals disagree.** New roll-up = 208,057; legacy roll-up = 263,953.5; the Code Legend note claims the new total "matches the original exactly" at 264,153.5. None of the three match. Per division, the new sheets are lower for Div 01 (2,350 vs 25,300), 02 (21,500 vs 29,700), 03 (31,260 vs 39,237.5), 04, 07, 09 and 05 (4,850 vs 1,350, higher). Legacy Div 15 (44,840) and Div16 (18,092) map to new 22/23/26/27 (40,492 total).
2. **Wrong codes inside sheets.** `Div 01` uses `02 xx xx` codes, `Div 02` uses `02 xx xx`, `Div 03` uses `04 xx xx` (concrete/steel items coded as masonry). The sheet name and the code prefix disagree.
3. **Amount without quantity.** Hard-coded amounts with no QTY/rate: Div 04 (1), 05 (2), 09 (2), 13, 14, 22, 23, 26, 27, 32 and legacy Div 1, 4, 15, 16.
4. **Mis-columned formula.** `Div 05` row 11 is `=D11*E11` (UNIT column used as quantity); several others multiply `E*C` instead of `C*E` (harmless but non-standard).
5. **Whitespace-only cells** (`' '`) in QTY/UNIT/Rate/Amount across Div 01-07 and legacy sheets; they look empty but are text.
6. **Inconsistent SUM ranges.** `Div 01` sums `F15:F27` (skips rows 8-12); `Div 02`/`Div 03` sum `F2:F28` (includes the header row); legacy `Div 9` has two partial totals (`F25`, `F60`) and `Collecttion` adds both.
7. **Scratch calculations beside the BoQ.** `Div 03` has 292 cells in cols G-AD (footing volumes, e.g. `=1.5*1.3*0.5`), `Div 8` has 9 cells in K-N, `Div16` has 93 cells in I-U. Not part of the BoQ; the importer must read columns A-F only.
8. **Typos / placeholders.** "Collecttion", "Requirments", "Handrain", `(not specified)` codes 09 40 00 and 09 60 00, blank rows 23-28 in `Collecttion`, a stray `+C7:F15` fragment in the `Collection (New Coding)` header text, and a duplicate `Div 9` label.
9. **Formulas.** Many totals are formulas; the importer reads cached values only (Chunk 15 rule), and cached values are present.

## 7. Questions and answers
**Answered**
1. Workbook: provided (`BOQ_Final_Professional_-fatima.xlsx`), analysed in section 6.
2. One project or template? **Template**, reused across projects. Estimates are copied per project (Chunk 07).
3. Currency: **KWD only**.
4. BoQ line level: **"could be"**. Treated as possible later, not built in V1 (see Q9).
5. Budget = 0 with spend: **treated as 100%, approval required**. Recorded in DECISIONS D3.
6. Roles: **flat organisation for now, RBAC enforced later**. Recorded in DECISIONS D6.

**Still open**
7. Who receives the 80% warning in Chunk 11 (project owner, all members, or Admins)? Flat org suggests "all project members". **All project members.** (D11)
8. Stack in DECISIONS D1: **accepted**.
9. **What is a "cost head"?** The pack says 32; the workbook has 24 divisions (83 coded rows beneath them). Options: (a) the 24 divisions, (b) the 83 coded rows, (c) divisions as heads with coded rows as an optional later BoQ-line level. Recommendation: (a) for V1, so the 24 sheets become 24 cost heads and Chunk 05's seed file comes from `Collection (New Coding)`. Note this changes the "(32)" in CLAUDE.md. **Deferred**: real list is 32 heads, to be supplied (D10).
10. **Which total is right?** 208,057 (new), 263,953.5 (legacy) or 264,153.5 (legend note)? Importer acceptance ("zero unexplained errors") needs the workbook reconciled first, or the 24 sheets accepted as the source of truth. **Workbook is a guide, not the source of truth.** Kuwait format `NNN,NNN.NNN` is the display standard (D9).
11. Fix the wrong code prefixes in Div 01/02/03 in the workbook, or have the importer key on sheet name? **Deferred**, treated as a data issue to fix later.
12. Are the 8 empty divisions kept as zero-budget heads, or hidden until used? - **Sample data only. All 32 heads are needed** and will be supplied (D10).
