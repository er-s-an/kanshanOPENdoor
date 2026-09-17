/**
 * Byte-slice helpers shared by the cache (content hashing for default keys)
 * and the built-in loaders. No fetch/DOM is touched here or at import time.
 */

export function toUint8(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

export function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export function byteLengthOf(data: ArrayBuffer | Uint8Array): number {
  return data.byteLength;
}

/** FNV-1a over the first 4 KiB plus the full length: cheap content identity. */
export function fnv1aHex(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  const n = Math.min(bytes.byteLength, 4096);
  for (let i = 0; i < n; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
