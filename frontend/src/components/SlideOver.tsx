import { useEffect, type ReactNode } from 'react';

/**
 * Right-hand panel over the page. Closes on Escape or the close button.
 * `sheet`: on touch devices it rises from the bottom instead (quick actions such as Add Expense).
 */
export function SlideOver(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  sheet?: boolean;
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="slideover-backdrop" onClick={onClose}>
      <aside
        className={props.sheet ? 'slideover sheet' : 'slideover'}
        role="dialog"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="slideover-header">
          <h2>{props.title}</h2>
          <button type="button" className="btn-link" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="slideover-body">{props.children}</div>
      </aside>
    </div>
  );
}

export function ErrorText(props: { message: string | null }) {
  return props.message ? (
    <p className="error" role="alert">
      {props.message}
    </p>
  ) : null;
}
