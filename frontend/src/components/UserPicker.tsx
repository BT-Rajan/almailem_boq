import { useCallback, useState } from 'react';
import type { UserRef } from '@boq/shared';
import { lookupUsers } from '../api/projects';
import { useLoad } from '../api/use-load';

/** Search box plus a select of enabled users. Calls onChange with the chosen user id ('' for none). */
export function UserPicker(props: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  exclude?: ReadonlySet<string>;
  /** Shown as the selected option before a search has loaded it. */
  current?: UserRef | null;
}) {
  const [search, setSearch] = useState('');
  const { data } = useLoad(useCallback(() => lookupUsers(search), [search]));
  const options = [
    ...(props.current ? [props.current] : []),
    ...(data ?? []).filter((u) => u.id !== props.current?.id),
  ].filter((u) => !props.exclude?.has(u.id));

  return (
    <div className="picker">
      <input
        type="search"
        placeholder="Search people"
        aria-label={`Search ${props.label.toLowerCase()}`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} · {u.email}
          </option>
        ))}
      </select>
    </div>
  );
}
