import { useCallback, useState, type FormEvent } from 'react';
import type { CostHead } from '@boq/shared';
import { createCostHead, listCostHeads, reorderCostHeads, updateCostHead } from '../../api/admin';
import { attempt, useLoad } from '../../api/use-load';
import { ErrorText, SlideOver } from '../../components/SlideOver';

/** Swap two positions in a copy of the list. Pure UI ordering; the server stores the result. */
function moved(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  [next[from], next[to]] = [next[to] as string, next[from] as string];
  return next;
}

export function CostHeadsPage() {
  const { data, error, reload } = useLoad(listCostHeads);
  const [panel, setPanel] = useState<CostHead | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setPanel(null), []);

  const move = async (from: number, to: number) => {
    if (!data) return;
    setBusy(true);
    setActionError(
      await attempt(() =>
        reorderCostHeads(
          moved(
            data.map((h) => h.id),
            from,
            to,
          ),
        ),
      ),
    );
    setBusy(false);
    reload();
  };

  return (
    <section className="panel">
      <div className="toolbar">
        <h1>Cost heads</h1>
        <span className="muted">{data ? `${data.length} heads` : ''}</span>
        <span className="spacer" />
        <button type="button" className="btn-primary" onClick={() => setPanel('new')}>
          New cost head
        </button>
      </div>
      <ErrorText message={actionError ?? error} />
      <table className="table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Code</th>
            <th>Name</th>
            <th>Description</th>
            <th>Status</th>
            <th className="num">Order</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((h, i) => (
            <tr
              key={h.id}
              className={h.active ? 'clickable' : 'clickable inactive'}
              onClick={() => setPanel(h)}
            >
              <td className="num">{i + 1}</td>
              <td>{h.code}</td>
              <td>{h.name}</td>
              <td className="muted">{h.description ?? ''}</td>
              <td>{h.active ? 'Active' : 'Inactive'}</td>
              <td className="num" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  aria-label={`Move ${h.code} up`}
                  disabled={busy || i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  ↑
                </button>{' '}
                <button
                  type="button"
                  aria-label={`Move ${h.code} down`}
                  disabled={busy || i === data.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  ↓
                </button>
              </td>
            </tr>
          ))}
          {data && data.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No cost heads yet. Add them here or load the seed file.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {panel && (
        <SlideOver title={panel === 'new' ? 'New cost head' : 'Edit cost head'} onClose={close}>
          <CostHeadForm
            head={panel === 'new' ? null : panel}
            onSaved={() => {
              reload();
              close();
            }}
          />
        </SlideOver>
      )}
    </section>
  );
}

/** One form for add and edit. Deactivating is a checkbox; heads are never deleted. */
function CostHeadForm(props: { head: CostHead | null; onSaved: () => void }) {
  const { head } = props;
  const [code, setCode] = useState(head?.code ?? '');
  const [name, setName] = useState(head?.name ?? '');
  const [description, setDescription] = useState(head?.description ?? '');
  const [active, setActive] = useState(head?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = { code, name, description: description.trim() ? description : null };
    const err = await attempt(() =>
      head ? updateCostHead(head.id, { ...body, active }) : createCostHead(body),
    );
    setBusy(false);
    if (err) setError(err);
    else props.onSaved();
  };

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Code
        <input value={code} onChange={(e) => setCode(e.target.value)} required maxLength={30} />
      </label>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      </label>
      <label>
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={3}
        />
      </label>
      {head && (
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
      )}
      <ErrorText message={error} />
      <button className="btn-primary" type="submit" disabled={busy}>
        {head ? 'Save' : 'Add cost head'}
      </button>
    </form>
  );
}
