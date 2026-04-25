/**
 * Simple FNV-1a 32-bit hash over a UTF-16 string. Not cryptographic; used only
 * for change detection. Returns an 8-character hex string.
 */
export function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    const hi = (s.charCodeAt(i) >> 8) & 0xff;
    if (hi !== 0) {
      h ^= hi;
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
  }
  return ('00000000' + h.toString(16)).slice(-8);
}
