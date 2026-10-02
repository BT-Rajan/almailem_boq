import { useCallback, useState } from 'react';
import { formatFils, type EXPENSE_SORTS, type Expense, type ListParams } from '@boq/shared';
import { attachmentUrl, getCostHeadDetail, reverseExpense } from '../../api/expenses';
import { formatDate } from '../../components/format';
import { Figures } from '../../components/Figures';
import { Pager, SortHeader, useList } from '../../components/list';
import { ErrorText, SlideOver } from '../../components/SlideOver';
import { ExpenseForm, ReverseForm } from './ExpenseForm';

type Panel =
  { kind: 'add' } | { kind: 'edit'; expense: Expense } | { kind: 'reverse'; expense: Expense };

/** One cost head of a project: its figures (from the server) and every expense on it. */
export function CostHeadPage(props: { projectId: string; costHeadId: string }) {
  const { projectId, costHeadId } = props;
  const detail = useList(
    useCallback(
      (p: ListParams<(typeof EXPENSE_SORTS)[number]>) =>
        getCostHeadDetail(projectId, costHeadId, p),
      [projectId, costHeadId],
    ),
  );
  const [panel, setPanel] = useState<Panel | null>(null);
  const close = useCallback(() => setPanel(null), []);
  const done = useCallback(() => {
    setPanel(null);
    detail.reload();
  }, [detail]);

  const d = detail.data;
  if (!d) return <ErrorText message={detail.error} />;
  const m = d.metrics;

  return (
    <section className="panel">
      <div className="toolbar">
        <a href={`#/projects/${projectId}`} className="muted">
          Project
        </a>
        <span className="muted">/</span>
        <h1>
          {d.costHead.code} · {d.costHead.name}
        </h1>
        {!d.costHead.active && <span className="tag">Inactive</span>}
        <span className="spacer" />
        {d.editable && d.costHead.active && (
          <button
            type="button"
            className="btn-primary primary-action"
            onClick={() => setPanel({ kind: 'add' })}
          >
            Add expense
          </button>
        )}
      </div>

      <Figures metrics={m} status={d.status} />

      <div className="table-scroll">
        <table className="table money">
          <thead>
            <tr>
              <SortHeader label="Date" sortKey="date" list={detail} />
              <SortHeader label="Vendor" sortKey="vendor" list={detail} />
              <SortHeader label="Invoice" sortKey="invoice" list={detail} />
              <SortHeader label="Amount" sortKey="amount" list={detail} className="num" />
              <th>Description</th>
              <th>Bill</th>
              <th>By</th>
              <th className="num">Action</th>
            </tr>
          </thead>
          <tbody>
            {d.expenses.items.map((e) => {
              const isReversal = e.reversalOf !== null;
              const reversed = e.reversedAt !== null;
              return (
                <tr key={e.id} className={reversed ? 'inactive' : undefined}>
                  <td>{formatDate(e.expenseDate)}</td>
                  <td>{e.vendor}</td>
                  <td>
                    {e.invoiceNo}
                    {isReversal && <span className="tag"> Reversal</span>}
                    {reversed && <span className="tag"> Reversed</span>}
                  </td>
                  <td className={e.amountFils < 0 ? 'num negative' : 'num'}>
                    {formatFils(e.amountFils)}
                  </td>
                  <td className="muted name" title={e.description ?? undefined}>
                    {e.description ?? ''}
                  </td>
                  <td>
                    {e.attachment && (
                      <a href={attachmentUrl(projectId, e.id)} title={e.attachment.name}>
                        View
                      </a>
                    )}
                  </td>
                  <td>{e.createdBy.name}</td>
                  <td className="num">
                    {d.editable && !isReversal && !reversed && (
                      <>
                        <button
                          type="button"
                          onClick={() => setPanel({ kind: 'edit', expense: e })}
                        >
                          Edit
                        </button>{' '}
                        <button
                          type="button"
                          onClick={() => setPanel({ kind: 'reverse', expense: e })}
                        >
                          Reverse
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {d.expenses.items.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No expenses on this head yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager data={d.expenses} page={detail.page} setPage={detail.setPage} noun="entries" />

      {panel && (
        <SlideOver
          title={
            panel.kind === 'add'
              ? 'Add expense'
              : panel.kind === 'edit'
                ? 'Edit expense'
                : 'Reverse expense'
          }
          onClose={close}
          sheet
        >
          {panel.kind === 'reverse' ? (
            <ReverseForm
              expense={panel.expense}
              reverse={(reason) => reverseExpense(projectId, panel.expense.id, reason)}
              onReversed={done}
            />
          ) : (
            <ExpenseForm
              projectId={projectId}
              costHeadId={costHeadId}
              {...(panel.kind === 'edit' && { expense: panel.expense })}
              onSaved={done}
            />
          )}
        </SlideOver>
      )}
    </section>
  );
}
