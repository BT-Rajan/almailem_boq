import type { AttachmentType } from '@boq/shared';

/**
 * What a file really is, judged by its first bytes, never by its name or the client's claim.
 * Only the allowed types are recognised; anything else is null.
 */
const SIGNATURES: { type: AttachmentType; bytes: number[] }[] = [
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

export function sniffType(data: Uint8Array): AttachmentType | null {
  const match = SIGNATURES.find((s) => s.bytes.every((b, i) => data[i] === b));
  return match?.type ?? null;
}

/** A file name safe to store and to send back in Content-Disposition. */
export function cleanFileName(raw: string | undefined, type: AttachmentType): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw ?? '');
  } catch {
    decoded = ''; // malformed encoding: fall back to a generic name
  }
  const name = decoded
    .replace(/[\\/]/g, '_') // no paths
    .replace(/[^\p{L}\p{N} ._()-]/gu, '') // no control characters, quotes or other specials
    .trim()
    .slice(0, 150);
  const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[type];
  if (!name) return `attachment${ext}`;
  return /\.(pdf|jpe?g|png)$/i.test(name) ? name : `${name}${ext}`;
}
