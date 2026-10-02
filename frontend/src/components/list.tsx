import { useCallback, useState } from 'react';
import type { ListParams, Page, SortDirection } from '@boq/shared';
import { useDebounced } from '../api/use-debounced';
import { useLoad, type Loaded } from '../api/use-load';

/**
 * The one list pattern in the UI: search text, sort and page, sent to the server, which does the
 * searching, sorting and paging (backend/src/query). `fetchPage` must be stable (useCallback).
 * It usually returns a Page; a screen whose response wraps a page (e.g. a cost-head detail) works too.
 */
export function useList<R, S extends string>(fetchPage: (p: ListParams<S>) => Promise<R>) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: S; dir: SortDirection } | null>(null);
  const [page, setPage] = useState(1);
  const settledQ = useDebounced(q);
  const result: Loaded<R> = useLoad(
    useCallback(
      () =>
        fetchPage({
          ...(settledQ && { q: settledQ }),
          ...(sort && { sort: sort.key, dir: sort.dir }),
          page,
        }),
      [fetchPage, settledQ, sort, page],
    ),
  );
  return {
    ...result,
    q,
    setQ: (text: string) => {
      setQ(text);
      setPage(1);
    },
    sort,
    /** First click sorts ascending, the next one descending. */
    sortBy: (key: S) => {
      setSort(sort?.key === key && sort.dir === 'asc' ? { key, dir: 'desc' } : { key, dir: 'asc' });
      setPage(1);
    },
    page,
    setPage,
  };
}

export type ListState<S extends string> = {
  sort: { key: S; dir: SortDirection } | null;
  sortBy: (key: S) => void;
};

/** A column header that sorts the list by `sortKey`. */
export function SortHeader<S extends string>(props: {
  label: string;
  sortKey: S;
  list: ListState<S>;
  className?: string;
}) {
  const active = props.list.sort?.key === props.sortKey ? props.list.sort.dir : null;
  return (
    <th
      className={props.className}
      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
    >
      <button type="button" className="sort" onClick={() => props.list.sortBy(props.sortKey)}>
        {props.label}
        {active === 'asc' ? ' ▲' : active === 'desc' ? ' ▼' : ''}
      </button>
    </th>
  );
}

/** "N items · Previous · Page x of y · Next" under a list. */
export function Pager(props: {
  data: Page<unknown> | undefined;
  page: number;
  setPage: (n: number) => void;
  noun: string;
  loading?: boolean;
}) {
  const { data, page, setPage } = props;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="pager">
      <span className="muted">
        {props.loading ? 'Loading…' : `${data?.total ?? 0} ${props.noun}`}
      </span>
      <span className="spacer" />
      <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
        Next
      </button>
    </div>
  );
}
