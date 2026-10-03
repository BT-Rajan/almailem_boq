import type { Page, Route } from '@playwright/test';

/** Placeholder data shaped like the API's, sized to stress the layout (long names, many columns). */
export const P = '11111111-1111-4111-8111-111111111111';
export const H = '22222222-2222-4222-8222-222222222222';
const m = (budget: number, actual: number, utilisationBp: number) => ({
  budget,
  actual,
  remaining: budget - actual,
  utilisationBp,
});
const status = (bp: number) =>
  bp >= 10000 ? 'APPROVAL_REQUIRED' : bp >= 8000 ? 'WARNING' : 'NORMAL';
const heads = Array.from({ length: 12 }, (_, i) => {
  const bp = [2500, 8200, 10450, 0][i % 4] as number;
  return {
    costHead: {
      id: i === 0 ? H : `33333333-3333-4333-8333-3333333333${String(i).padStart(2, '0')}`,
      systemNo: `C${String(i + 1).padStart(3, '0')}`,
      code: `0${i} 30 00`,
      name: `Placeholder cost head with a fairly long descriptive name ${i}`,
      active: true,
    },
    metrics: m(125_000_500, Math.floor((125_000_500 * bp) / 10000), bp),
    status: status(bp),
  };
});
const boq = {
  rows: heads,
  total: m(1_500_006_000, 1_062_505_100, 7083),
  totalStatus: 'NORMAL',
  editable: true,
};
const project = {
  id: P,
  systemNo: 'P00001',
  code: 'ALM-2026-001',
  name: 'Placeholder tower with a long project name',
  status: 'active',
  ownerUserId: 'u1',
  ownerName: 'Site Admin',
  startDate: '2026-01-01',
  endDate: '2027-12-31',
  description: null,
  nextStatuses: ['on_hold', 'completed', 'cancelled'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const expense = (i: number) => ({
  id: `44444444-4444-4444-8444-4444444444${String(i).padStart(2, '0')}`,
  costHead: { id: H, code: '00 30 00', name: 'Placeholder cost head' },
  vendor: `Placeholder Trading and Contracting Co. ${i}`,
  invoiceNo: `INV-2026-00${i}`,
  expenseDate: '2026-03-15',
  amountFils: 12_345_678,
  description: 'Rebar and formwork for the podium slab, second pour',
  attachment: i % 2 ? { name: 'bill.pdf', type: 'application/pdf', size: 1000 } : null,
  createdBy: { id: 'u1', name: 'Site Admin' },
  createdAt: '2026-03-15T08:00:00.000Z',
  reversalOf: null,
  reversedAt: null,
  // One entry waits for approval, so its Cancel request button is part of the layout checks.
  status: i === 1 ? 'PENDING_APPROVAL' : 'POSTED',
  approval:
    i === 1
      ? {
          id: 'a1',
          status: 'PENDING',
          reason: 'Extra rebar after the structural redesign',
          requestedBy: { id: 'u1', name: 'Site Admin' },
          decidedBy: null,
          decidedAt: null,
          decisionComment: null,
        }
      : null,
});
const approval = (i: number) => {
  const e = expense(i);
  return {
    id: `55555555-5555-4555-8555-5555555555${String(i).padStart(2, '0')}`,
    status: 'PENDING',
    project: { id: P, code: project.code, name: project.name },
    costHead: e.costHead,
    expense: {
      id: e.id,
      vendor: e.vendor,
      invoiceNo: e.invoiceNo,
      expenseDate: e.expenseDate,
      amountFils: e.amountFils,
      hasAttachment: false,
    },
    reason: 'Extra rebar after the structural redesign of the podium slab',
    requestedBy: { id: 'u2', name: 'Placeholder Project Manager' },
    requestedAt: '2026-03-15T08:00:00.000Z',
    requestedBp: 10_450,
    decidedBy: null,
    decidedAt: null,
    decidedBp: null,
    decisionComment: null,
    now: {
      current: { metrics: heads[1]?.metrics, status: 'WARNING' },
      projected: { metrics: m(125_000_500, 130_000_000, 10399), status: 'APPROVAL_REQUIRED' },
    },
  };
};
const page = <T>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 50 });

const ROUTES: [RegExp, unknown][] = [
  [
    /\/api\/auth\/me$/,
    {
      user: { id: 'u1', email: 'admin@example.com', name: 'Site Admin' },
      permissions: [],
      csrfToken: 'c',
    },
  ],
  [
    /\/api\/dashboard$/,
    {
      summary: { projects: 6, pendingApprovals: 4, metrics: boq.total, status: 'NORMAL' },
      projects: Array.from({ length: 6 }, (_, i) => ({
        id: P,
        code: `ALM-2026-00${i}`,
        name: `Placeholder project with a long name ${i}`,
        projectStatus: 'active',
        metrics: heads[i % 4]?.metrics,
        status: heads[i % 4]?.status,
      })),
    },
  ],
  [/\/api\/projects\/[^/]+\/boq/, boq],
  [
    /\/api\/projects\/[^/]+\/cost-structure$/,
    {
      approved: heads
        .slice(0, 4)
        .map((h) => ({ costHead: h.costHead, amountFils: h.metrics.budget })),
      approvedTotalFils: 500_002_000,
      lockedHeadIds: [heads[0]?.costHead.id],
      latest: null,
      editable: true,
    },
  ],
  [
    /\/api\/projects\/[^/]+\/cost-heads\/[^/]+\/projection/,
    {
      current: { metrics: heads[1]?.metrics, status: 'WARNING' },
      projected: { metrics: m(125_000_500, 130_000_000, 10399), status: 'APPROVAL_REQUIRED' },
    },
  ],
  [
    /\/api\/projects\/[^/]+\/cost-heads\/[^/]+/,
    {
      costHead: heads[0]?.costHead,
      metrics: heads[0]?.metrics,
      status: heads[0]?.status,
      expenses: page(Array.from({ length: 6 }, (_, i) => expense(i))),
      editable: true,
    },
  ],
  [
    /\/api\/projects\/[^/]+\/members$/,
    [{ id: 'u1', name: 'Site Admin', email: 'admin@example.com', isOwner: true, removable: false }],
  ],
  [/\/api\/projects\/[0-9a-f-]{36}$/, project],
  [
    /\/api\/projects(\?|$)/,
    page(
      Array.from({ length: 8 }, (_, i) => ({
        ...project,
        code: `ALM-2026-00${i}`,
        name: `Placeholder project ${i}`,
      })),
    ),
  ],
  [/\/api\/approvals(\?|$)/, page(Array.from({ length: 6 }, (_, i) => approval(i)))],
  [/\/api\/users\/lookup/, []],
  [
    /\/api\/admin\/users/,
    page(
      Array.from({ length: 8 }, (_, i) => ({
        id: `u${i}`,
        email: `person.with.a.long.address${i}@example.com`,
        name: `Person ${i}`,
        disabled: false,
        locked: false,
        roles: [{ id: 'r', name: 'Accountant' }],
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
    ),
  ],
  [
    /\/api\/admin\/roles/,
    [
      {
        id: 'r',
        name: 'Accountant',
        description: 'Working access',
        isSystem: true,
        permissions: [
          'approval.request',
          'estimate.edit',
          'expense.create',
          'expense.edit',
          'expense.reverse',
          'expense.view',
          'import.run',
          'project.create',
          'project.edit',
          'project.members.manage',
          'project.view',
          'report.export',
          'report.view',
        ],
      },
    ],
  ],
  [
    /\/api\/admin\/cost-heads/,
    heads.map((h, i) => ({ ...h.costHead, description: 'Placeholder', displayOrder: i + 1 })),
  ],
  [
    /\/api\/admin\/approval-rules/,
    { warningBp: 8000, approvalBp: 10000, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: null },
  ],
  [/\/api\/admin\/projects/, []],
  [/\/api\/search/, { projects: [], costHeads: [], invoices: [], vendors: [], expenses: [] }],
];

/** Answer every /api call from the table above, in the { ok, data, error } envelope. */
export async function mockApi(page: Page): Promise<void> {
  // Only the API: Vite also serves modules from paths such as /src/api/client.ts.
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route: Route) => {
      const url = route.request().url();
      const hit = ROUTES.find(([re]) => re.test(url));
      await route.fulfill({
        status: hit ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(
          hit
            ? { ok: true, data: hit[1], error: null }
            : { ok: false, data: null, error: { code: 'NOT_FOUND', message: url } },
        ),
      });
    },
  );
}
