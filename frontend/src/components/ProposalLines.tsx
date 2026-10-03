import { formatFils, type BudgetChange, type BudgetProposal, type Fils } from '@boq/shared';

const CHANGE_LABELS: Record<BudgetChange, string> = {
  ADDED: 'Added',
  REMOVED: 'Removed',
  CHANGED: 'Changed',
  UNCHANGED: 'Unchanged',
};
const money = (v: Fils | null) => (v === null ? '—' : formatFils(v));

/** A budget request head by head: the approved value, the proposed one, and what changes. */
export function ProposalLines(props: {
  proposal: Pick<BudgetProposal, 'lines' | 'approvedTotalFils' | 'proposedTotalFils'>;
}) {
  const b = props.proposal;
  return (
    <div className="table-scroll">
      <table className="table money" aria-label="Proposed cost structure">
        <thead>
          <tr>
            <th>Cost Code</th>
            <th>Cost Head</th>
            <th className="num">Approved</th>
            <th className="num">Proposed</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {b.lines.map((l) => (
            <tr key={l.costHead.id} className={l.change === 'UNCHANGED' ? 'inactive' : undefined}>
              <td>{l.costHead.systemNo}</td>
              <td className="name" title={l.costHead.name}>
                {l.costHead.name}
              </td>
              <td className="num">{money(l.approvedFils)}</td>
              <td className="num">{money(l.amountFils)}</td>
              <td>{CHANGE_LABELS[l.change]}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2}>Total</th>
            <th className="num">{formatFils(b.approvedTotalFils)}</th>
            <th className="num">{formatFils(b.proposedTotalFils)}</th>
            <th />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
