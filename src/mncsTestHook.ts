/**
 * Browser E2E test hook (loaded ONLY with `?mncs-test=1`).
 *
 * Exposes the real production call sites (not the loader internals) so
 * Playwright specs can prove which execution path answered:
 * `window.__mncs.ops.*` call the same functions the UI calls, and
 * `window.__mncs.stats` shows per-function wasm/fallback counters.
 * Never imported by production code paths.
 */
import { barTicks, parsePosition } from './music';
import { mncsCrc32 } from './mncsCrc';
import { mncsClipActive, mncsWrapTick } from './mncsArrange';
import { mncsRemapIndex } from './mncsMigrate';
import { mncsMagicCode } from './mncsWav';
import { mncsCentralEntry } from './mncsPack';
import {
  initMncsWasm,
  mncsModuleError,
  mncsModuleState,
  mncsPathStats,
  resetMncsPathStats,
  type MncsModuleName,
} from './mncsWasm';

export interface MncsTestHook {
  ready: () => Promise<boolean>;
  states: () => Record<MncsModuleName, string>;
  errors: () => Record<MncsModuleName, string | null>;
  stats: () => Record<string, { wasm: number; fallback: number }>;
  resetStats: () => void;
  ops: {
    barTicks: (numerator: number, denominator: number) => number;
    parsePosition: (text: string) => number | null;
    crc32: (bytes: number[]) => number;
    wrapTick: (tick: number, modulus: number) => number;
    clipActive: (localTick: number, lengthTicks: number) => boolean;
    remapIndex: (step: number, fromSteps: number, toSteps: number) => number;
    magicCode: (bytes: number[]) => number;
    centralEntryNameLen: (window: number[]) => number;
  };
}

export function installMncsTestHook(): void {
  const hook: MncsTestHook = {
    ready: () => initMncsWasm(),
    states: () => ({
      meter: mncsModuleState('meter'),
      arrange: mncsModuleState('arrange'),
      migrate: mncsModuleState('migrate'),
      geometry: mncsModuleState('geometry'),
      wav: mncsModuleState('wav'),
      pack: mncsModuleState('pack'),
      text: mncsModuleState('text'),
      crc: mncsModuleState('crc'),
    }),
    errors: () => ({
      meter: mncsModuleError('meter'),
      arrange: mncsModuleError('arrange'),
      migrate: mncsModuleError('migrate'),
      geometry: mncsModuleError('geometry'),
      wav: mncsModuleError('wav'),
      pack: mncsModuleError('pack'),
      text: mncsModuleError('text'),
      crc: mncsModuleError('crc'),
    }),
    stats: () => mncsPathStats(),
    resetStats: () => resetMncsPathStats(),
    ops: {
      barTicks: (numerator, denominator) => barTicks({ numerator, denominator: denominator as 2 | 4 | 8 | 16 }),
      parsePosition: (text) => parsePosition(text, { numerator: 4, denominator: 4 }),
      crc32: (bytes) => mncsCrc32(new Uint8Array(bytes)),
      wrapTick: (tick, modulus) => mncsWrapTick(tick, modulus),
      clipActive: (localTick, lengthTicks) => mncsClipActive(localTick, lengthTicks),
      remapIndex: (step, fromSteps, toSteps) => mncsRemapIndex(step, fromSteps, toSteps),
      magicCode: (bytes) => mncsMagicCode(new Uint8Array(bytes)),
      centralEntryNameLen: (window) => {
        const view = new DataView(new Uint8Array(window).buffer);
        return mncsCentralEntry(view, 0).nameLen;
      },
    },
  };
  (window as unknown as { __mncs: MncsTestHook }).__mncs = hook;
}
