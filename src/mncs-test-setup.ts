import { beforeEach } from 'vitest';
import { unloadMncsModules } from './mncsWasm';

// Every test file starts with all MNCS WASM modules unloaded, so
// projection tests deterministically exercise the pure fallback path
// (the corpus-pinned authority) even if a runner ever shares module
// registries across files. Tests that need compiled execution load the
// modules themselves (see src/mncsWasm.test.ts).
beforeEach(() => {
  unloadMncsModules();
});
