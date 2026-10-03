import { expect, test, type Page } from '@playwright/test';
import { H, P, mockApi } from './fixtures';

/**
 * The Chunk 17 checklist, at 1024x768 and 768x1024 with touch:
 * no sideways page scroll, 44 px touch targets, sticky first column on wide tables,
 * Add Expense as a bottom sheet, primary actions within thumb reach, camera capture for bills.
 * Chunk 10 adds the Approvals screen, whose decisions open as bottom sheets too.
 */

const PAGES: [string, string][] = [
  ['dashboard', '#/dashboard'],
  ['projects', '#/projects'],
  ['approvals', '#/approvals'],
  ['project-boq', `#/projects/${P}`],
  ['cost-head', `#/projects/${P}/heads/${H}`],
  ['cost-structure', `#/projects/${P}/setup/boq`],
  ['users', '#/admin/users'],
  ['roles', '#/admin/roles'],
  ['cost-heads', '#/admin/cost-heads'],
  ['approval-rules', '#/admin/approval-rules'],
];

async function open(page: Page, hash: string) {
  await mockApi(page);
  await page.goto(`/${hash}`);
  await page.locator('main section.panel').first().waitFor();
  await page.waitForLoadState('networkidle');
}

/** Visible interactive elements smaller than 44 px (checkboxes are judged by their label). */
function smallTargets(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    for (const el of document.querySelectorAll('a[href], button, input, select, textarea')) {
      if (!visible(el)) continue;
      if (el instanceof HTMLInputElement && el.type === 'file') continue; // judged by its label
      const target =
        el instanceof HTMLInputElement && el.type === 'checkbox' ? (el.closest('label') ?? el) : el;
      const r = target.getBoundingClientRect();
      const needsWidth = el.tagName === 'BUTTON';
      if (r.height < 44 || (needsWidth && r.width < 44))
        out.push(
          `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
    }
    return out;
  });
}

for (const [name, hash] of PAGES) {
  test(`${name}: no sideways page scroll, every touch target at least 44 px`, async ({
    page,
  }, info) => {
    await open(page, hash);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, 'page scrolls sideways').toBeLessThanOrEqual(innerWidth);
    expect(await smallTargets(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
  });
}

test('wide tables scroll inside their panel and keep the first column in view', async ({
  page,
}) => {
  await open(page, `#/projects/${P}`);
  const box = page.locator('.table-scroll').first();
  const overflow = await box.evaluate((el) => el.scrollWidth - el.clientWidth);
  const firstCell = page.locator('.table-scroll tbody tr').first().locator('td').first();
  const before = await firstCell.boundingBox();
  await box.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  const after = await firstCell.boundingBox();
  // Whether or not this orientation needs to scroll, the first column never moves.
  expect(after?.x).toBe(before?.x);
  if (overflow > 0) {
    const lastCell = page.locator('.table-scroll tbody tr').first().locator('td').last();
    expect(await lastCell.isVisible()).toBe(true);
  }
  // Money rows stay one line high: the table scrolls rather than squeezing text into columns.
  const tallest = await page
    .locator('.table.money tbody tr')
    .evaluateAll((rows) => Math.max(...rows.map((r) => r.getBoundingClientRect().height)));
  expect(tallest).toBeLessThanOrEqual(60); // one line plus a 44 px button; a wrapped row is 70+
});

test('BoQ: in landscape every column, Action included, fits without scrolling', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'ipad-landscape', 'portrait may scroll the table sideways');
  await open(page, `#/projects/${P}`);
  const box = page.locator('.table-scroll').first();
  expect(await box.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const actionHeader = page.locator('.table-scroll thead th').last();
  await expect(actionHeader).toHaveText('Action');
  const action = await actionHeader.boundingBox();
  const vp = page.viewportSize() as { width: number; height: number };
  expect((action?.x ?? 0) + (action?.width ?? 0)).toBeLessThanOrEqual(vp.width);
  expect(action?.y ?? vp.height).toBeLessThan(vp.height);
});

/** True when every sampled point inside `selector` hits that element (nothing painted over it). */
function onTop(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    const r = el.getBoundingClientRect();
    const points = [0.1, 0.5, 0.9].flatMap((fx) =>
      [0.1, 0.5, 0.9].map((fy) => [r.left + r.width * fx, r.top + r.height * fy]),
    );
    return points.every(([x, y]) =>
      el.contains(document.elementFromPoint(x as number, y as number)),
    );
  }, selector);
}

test('Add Expense opens as a bottom sheet with its main button under the thumb', async ({
  page,
}) => {
  await open(page, `#/projects/${P}`);
  const vp = page.viewportSize() as { width: number; height: number };
  const add = page.locator('.primary-action');
  const a = await add.boundingBox();
  expect(a, 'Add expense button').not.toBeNull();
  // Bottom-right corner: where a thumb rests holding an iPad.
  expect((a?.y ?? 0) + (a?.height ?? 0) / 2).toBeGreaterThan(vp.height * 0.75);
  expect((a?.x ?? 0) + (a?.width ?? 0) / 2).toBeGreaterThan(vp.width * 0.6);

  await add.click();
  const sheet = page.locator('.slideover.sheet');
  await expect(sheet).toBeVisible();
  // Make the page under the sheet scroll sideways, then check nothing paints over the sheet.
  await page
    .locator('.table-scroll')
    .first()
    .evaluate((el) => (el.scrollLeft = 200));
  expect(await onTop(page, '.slideover.sheet'), 'something covers the sheet').toBe(true);
  const s = await sheet.boundingBox();
  expect(Math.round((s?.y ?? 0) + (s?.height ?? 0))).toBe(vp.height); // anchored to the bottom
  expect(Math.round(s?.width ?? 0)).toBe(vp.width); // full width

  const submit = sheet.getByRole('button', { name: 'Add expense' });
  const b = await submit.boundingBox();
  expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(vp.height);
  expect((b?.y ?? 0) + (b?.height ?? 0) / 2).toBeGreaterThan(vp.height * 0.6);

  // Camera capture for the bill.
  const camera = sheet.getByLabel('Take a photo of the bill');
  await expect(camera).toHaveAttribute('capture', 'environment');
  await expect(sheet.getByText('Take photo')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('add-expense-sheet.png') });
});

test('cost-head page: Add expense within thumb reach; the preview shows in the sheet', async ({
  page,
}) => {
  await open(page, `#/projects/${P}/heads/${H}`);
  const vp = page.viewportSize() as { width: number; height: number };
  const a = await page.locator('.primary-action').boundingBox();
  expect((a?.y ?? 0) + (a?.height ?? 0) / 2).toBeGreaterThan(vp.height * 0.75);
  await page.locator('.primary-action').click();
  await page.getByLabel('Amount (KWD)').fill('5000');
  await expect(page.getByRole('status', { name: 'After this expense' })).toBeVisible();
});

test('summary chart: Estimate vs Actual per head, readable, no sideways page scroll', async ({
  page,
}) => {
  await open(page, `#/projects/${P}`);
  const chart = page.getByRole('figure', { name: /Approved Estimate and Actual/ });
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.getByRole('link')).toHaveCount(12);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
  const box = await chart.boundingBox();
  const vp = page.viewportSize() as { width: number; height: number };
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(vp.width);
  await chart.screenshot({ path: test.info().outputPath('estimate-actual.png') });
  await chart.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`#/projects/${P}/heads/`));
});

test('tapping an expense opens its detail and history as a bottom sheet, touch-sized', async ({
  page,
}) => {
  await open(page, `#/projects/${P}/heads/${H}`);
  await page.getByText('INV-2026-003').click();
  const sheet = page.locator('.slideover.sheet');
  await expect(sheet.getByRole('list', { name: 'History' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'View bill.pdf' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
  expect(await smallTargets(page)).toEqual([]);
});

test('Approvals: in landscape every money column and Action fit without scrolling', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'ipad-landscape', 'portrait may scroll the table sideways');
  await open(page, '#/approvals');
  const box = page.locator('.table-scroll').first();
  expect(await box.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await expect(page.locator('.table-scroll thead th').last()).toHaveText('Action');
});

test('an approval decision opens as a bottom sheet with its main button under the thumb', async ({
  page,
}) => {
  await open(page, '#/approvals');
  const vp = page.viewportSize() as { width: number; height: number };
  await page.getByRole('button', { name: 'Decide' }).first().click();
  const sheet = page.locator('.slideover.sheet');
  await expect(sheet).toBeVisible();
  expect(await onTop(page, '.slideover.sheet'), 'something covers the sheet').toBe(true);
  const s = await sheet.boundingBox();
  expect(Math.round((s?.y ?? 0) + (s?.height ?? 0))).toBe(vp.height);
  expect(Math.round(s?.width ?? 0)).toBe(vp.width);
  const b = await sheet.getByRole('button', { name: 'Approve' }).boundingBox();
  expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(vp.height);
  expect((b?.y ?? 0) + (b?.height ?? 0) / 2).toBeGreaterThan(vp.height * 0.6);
  expect(await smallTargets(page)).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('approval-sheet.png') });
});

test('cost structure: two-column selection, then a tappable estimates table, all touch-sized', async ({
  page,
}) => {
  await open(page, `#/projects/${P}/setup/boq`);
  const grid = page.getByRole('group', { name: 'Cost heads' });
  const cards = grid.locator('label.check-card');
  const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(a?.y).toBe(b?.y); // two columns
  expect(a?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Next: Enter estimates' }).click();
  await page
    .getByRole('row', { name: /Estimate for/ })
    .first()
    .click();
  await expect(page.locator('.slideover.sheet')).toBeVisible();
  expect(await smallTargets(page)).toEqual([]);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});
