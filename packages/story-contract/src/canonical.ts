/** Deterministic JSON and SHA-256 helpers shared by compiler, player, and Studio. */

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function toCanonicalValue(value: unknown, path: string): JsonValue {
  if (value === null) return null;

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`Cannot canonicalize non-finite number at ${path}`);
      }
      // JSON.stringify already serializes -0 as 0, but normalizing it here
      // makes the contract explicit and avoids engine-specific surprises.
      return Object.is(value, -0) ? 0 : value;
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new TypeError(`Cannot canonicalize ${typeof value} at ${path}`);
    case "object":
      break;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => toCanonicalValue(entry, `${path}/${index}`));
  }
  if (!isPlainObject(value)) {
    throw new TypeError(`Only JSON objects are canonicalizable at ${path}`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "toJSON")) {
    throw new TypeError(`Objects with toJSON are not canonicalizable at ${path}`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`Symbol keys are not canonicalizable at ${path}`);
  }

  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = toCanonicalValue(value[key], `${path}/${key}`);
  }
  return result;
}

/**
 * Serialize a JSON-compatible value with recursively sorted object keys.
 * Arrays retain their order. Undefined, non-finite numbers, class instances,
 * and other values that would be ambiguous in a content package are rejected.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value, ""));
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Portable synchronous SHA-256; it works in Node and browser runtimes. */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? utf8Bytes(input) : input;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const bitLengthLow = (bytes.length << 3) >>> 0;
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000);
  const tail = paddedLength - 8;
  message[tail] = (bitLengthHigh >>> 24) & 0xff;
  message[tail + 1] = (bitLengthHigh >>> 16) & 0xff;
  message[tail + 2] = (bitLengthHigh >>> 8) & 0xff;
  message[tail + 3] = bitLengthHigh & 0xff;
  message[tail + 4] = (bitLengthLow >>> 24) & 0xff;
  message[tail + 5] = (bitLengthLow >>> 16) & 0xff;
  message[tail + 6] = (bitLengthLow >>> 8) & 0xff;
  message[tail + 7] = bitLengthLow & 0xff;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const index = offset + i * 4;
      w[i] = (
        (message[index] << 24) |
        (message[index + 1] << 16) |
        (message[index + 2] << 8) |
        message[index + 3]
      ) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const sigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choice + K[i] + w[i]) >>> 0;
      const sigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

export function digestJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
