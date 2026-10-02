import { useState, type FormEvent } from 'react';
import type { ProjectDetail } from '@boq/shared';
import { UserPicker } from '../../components/UserPicker';
import { ErrorText } from '../../components/SlideOver';

export type ProjectFormValues = {
  code: string;
  name: string;
  ownerUserId: string;
  startDate: string;
  endDate: string;
  description: string;
};

/** Empty strings become null (or are left out) so the server sees only real values. */
export function toRequest(v: ProjectFormValues) {
  return {
    name: v.name,
    ...(v.ownerUserId && { ownerUserId: v.ownerUserId }),
    startDate: v.startDate || null,
    endDate: v.endDate || null,
    description: v.description.trim() ? v.description : null,
  };
}

/** Project details, for create (with code) and edit (code fixed). Validation is the server's. */
export function ProjectForm(props: {
  project: ProjectDetail | null;
  submitLabel: string;
  onSubmit: (values: ProjectFormValues) => Promise<string | null>;
}) {
  const p = props.project;
  const [v, setV] = useState<ProjectFormValues>({
    code: p?.code ?? '',
    name: p?.name ?? '',
    ownerUserId: p?.ownerUserId ?? '',
    startDate: p?.startDate ?? '',
    endDate: p?.endDate ?? '',
    description: p?.description ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof ProjectFormValues) => (e: { target: { value: string } }) =>
    setV({ ...v, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await props.onSubmit(v));
    setBusy(false);
  };

  return (
    <form className="form" onSubmit={submit}>
      {!p && (
        <label>
          Code
          <input value={v.code} onChange={set('code')} required maxLength={30} />
        </label>
      )}
      <label>
        Name
        <input value={v.name} onChange={set('name')} required maxLength={200} />
      </label>
      <label>
        Owner {!p && <small className="muted">(you, if left empty)</small>}
        <UserPicker
          label="Owner"
          value={v.ownerUserId}
          onChange={(id) => setV({ ...v, ownerUserId: id })}
          current={p ? { id: p.ownerUserId, name: p.ownerName, email: '' } : null}
        />
      </label>
      <div className="row">
        <label>
          Start date
          <input type="date" value={v.startDate} onChange={set('startDate')} />
        </label>
        <label>
          End date
          <input type="date" value={v.endDate} onChange={set('endDate')} />
        </label>
      </div>
      <label>
        Description
        <textarea value={v.description} onChange={set('description')} rows={3} maxLength={5000} />
      </label>
      <ErrorText message={error} />
      <button className="btn-primary" type="submit" disabled={busy}>
        {props.submitLabel}
      </button>
    </form>
  );
}
