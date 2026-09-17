/**
 * Local re-export of Three.js. Experience code imports 'three' through this
 * shim so packaged hosts can alias it; inside this repo it resolves to the
 * engine package's dependency, keeping a single module instance per session.
 */
export * from 'three';
