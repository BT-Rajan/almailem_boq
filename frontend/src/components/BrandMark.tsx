import { Building2 } from 'lucide-react';

export const APP_NAME = 'Almailem BoQ Manager';

/** The app's logo mark: a champagne-gold tile with a building (the jdk_erp look, in light). */
export function BrandMark(props: { size?: number }) {
  const size = props.size ?? 36;
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <Building2 size={Math.round(size / 2)} strokeWidth={1.75} />
    </span>
  );
}

/** Mark and name together, for headers. */
export function Brand() {
  return (
    <>
      <BrandMark />
      {/* Wordmark as in jdk_erp: the name, with the product word in gold. */}
      <span className="brand-name">
        Almailem <em>BoQ</em> Manager
      </span>
    </>
  );
}
