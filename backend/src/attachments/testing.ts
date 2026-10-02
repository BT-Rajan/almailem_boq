/** Test support: the smallest byte strings each allowed type is recognised by. */
const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0]);
export const PDF = new TextEncoder().encode('%PDF-1.7\n%test');
export const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
export const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);
