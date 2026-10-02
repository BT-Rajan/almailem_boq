import { useCallback, useState, type ReactNode } from 'react';
import { formatFils, type SearchHit } from '@boq/shared';
import { globalSearch } from '../api/search';
import { useDebounced } from '../api/use-debounced';
import { useLoad } from '../api/use-load';
import { formatDate } from './format';

/** The header search box: projects, cost heads, invoices, vendors and expenses, as the server groups them. */
export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const settled = useDebounced(q.trim());
  const ready = settled.length >= 2;
  const results = useLoad(
    useCallback(() => (ready ? globalSearch(settled) : Promise.resolve(null)), [ready, settled]),
  );
  const r = ready && open ? results.data : null;
  const close = () => setOpen(false);
  const hitLink = (h: SearchHit) => `#/projects/${h.projectId}/heads/${h.costHeadId}`;
  const empty = r && Object.values(r).every((g) => g.length === 0);

  return (
    <div
      className="global-search"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}
    >
      <input
        type="search"
        placeholder="Search projects, invoices, vendors…"
        aria-label="Search everything"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      />
      {r && (
        <div className="search-results" role="listbox" aria-label="Search results">
          {empty && <p className="muted">Nothing found</p>}
          <Group title="Projects" items={r.projects}>
            {(p) => (
              <a href={`#/projects/${p.id}`} onClick={close}>
                {p.code} · {p.name}
              </a>
            )}
          </Group>
          <Group title="Cost heads" items={r.costHeads}>
            {(h) => (
              <span>
                {h.code} · {h.name}
                {!h.active && <span className="muted"> (inactive)</span>}
              </span>
            )}
          </Group>
          <Group title="Invoices" items={r.invoices}>
            {(h) => (
              <a href={hitLink(h)} onClick={close}>
                {h.invoiceNo} · {h.vendor} · {formatFils(h.amountFils)} · {h.projectCode}
              </a>
            )}
          </Group>
          <Group title="Vendors" items={r.vendors}>
            {(v) => (
              <span>
                {v.vendor}{' '}
                <span className="muted">
                  {v.expenses} expenses in {v.projects} {v.projects === 1 ? 'project' : 'projects'}
                </span>
              </span>
            )}
          </Group>
          <Group title="Expenses" items={r.expenses}>
            {(h) => (
              <a href={hitLink(h)} onClick={close}>
                {h.description} · {formatDate(h.expenseDate)} · {h.projectCode}
              </a>
            )}
          </Group>
        </div>
      )}
    </div>
  );
}

function Group<T>(props: { title: string; items: T[]; children: (item: T) => ReactNode }) {
  if (!props.items.length) return null;
  return (
    <div className="search-group">
      <div className="search-title">{props.title}</div>
      {props.items.map((item, i) => (
        <div key={i} className="search-item">
          {props.children(item)}
        </div>
      ))}
    </div>
  );
}
