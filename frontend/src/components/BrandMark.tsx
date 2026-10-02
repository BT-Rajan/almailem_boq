import { Building2 } from 'lucide-react';

export const APP_NAME = 'Almailem BoQ Manager';

/** The app's logo mark: a blue tile with a building, as in the Almailem roadmap UI. */
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
      <span className="brand-name">{APP_NAME}</span>
    </>
  );
}
