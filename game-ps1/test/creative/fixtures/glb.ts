/**
 * Programmatic GLB fixtures: a minimal valid geometry-only triangle GLB,
 * a GLB referencing an external .bin, and non-GLB garbage.
 */

function chunk(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, payload.byteLength, true);
  dv.setUint32(4, type, true);
  out.set(payload, 8);
  return out;
}

function pad4(bytes: Uint8Array, fill: number): Uint8Array {
  const rem = bytes.byteLength % 4;
  if (rem === 0) return bytes;
  const out = new Uint8Array(bytes.byteLength + (4 - rem));
  out.set(bytes);
  out.fill(fill, bytes.byteLength);
  return out;
}

function assemble(jsonChunk: Uint8Array, binChunk: Uint8Array | null): Uint8Array {
  const parts = [jsonChunk];
  if (binChunk) parts.push(binChunk);
  const total = 12 + parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true); // version
  dv.setUint32(8, total, true);
  let off = 12;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/** One-triangle mesh, embedded BIN, no images: parses headless via GLTFLoader. */
export function buildTriangleGlb(): Uint8Array {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const bin = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'tri' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }],
    buffers: [{ byteLength: bin.byteLength }],
  });
  const jsonChunk = chunk(0x4e4f534a, pad4(new TextEncoder().encode(json), 0x20));
  const binChunk = chunk(0x004e4942, pad4(bin, 0x00));
  return assemble(jsonChunk, binChunk);
}

/** Structurally valid GLB whose buffer lives in an external file. */
export function buildExternalBinGlb(uri = 'scene.bin'): Uint8Array {
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ uri, byteLength: 36 }],
  });
  const jsonChunk = chunk(0x4e4f534a, pad4(new TextEncoder().encode(json), 0x20));
  return assemble(jsonChunk, null);
}

export function buildGarbageBytes(): Uint8Array {
  return new TextEncoder().encode('this is not a glb at all');
}
