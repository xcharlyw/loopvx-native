import type { Device, DeviceType } from '../types';

// The device chain's data: which effects exist, their parameters (range, default, how a knob shows them) and
// how a device is created. Pure; `devicemath.ts` has the numbers behind them, `devicenodes.ts` the Web Audio graph.

export type ParamUnit = 'hz' | 'db' | 'pct' | 'ms' | 'sec' | 'ratio' | 'oct' | 'pan' | 'hzfree' | 'enum' | 'switch';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  def: number;
  unit: ParamUnit;
  /** Frequencies and times feel right on a log dial. */
  curve?: 'log';
  step?: number;
  /** Texts of a stepped parameter (`enum`, `switch`), index = value. */
  options?: string[];
}

export interface DeviceDef {
  type: DeviceType;
  label: string;
  /** One line shown in the browser. */
  blurb: string;
  group: 'dynamics' | 'eq' | 'distortion' | 'space' | 'utility';
  params: ParamDef[];
}

export const GROUP_LABELS: Record<DeviceDef['group'], string> = {
  dynamics: 'Dynamik',
  eq: 'EQ & Filter',
  distortion: 'Verzerrung',
  space: 'Zeit & Raum',
  utility: 'Werkzeuge',
};

export const SAT_MODES = ['Soft', 'Hard', 'Fold', 'Tube'];
export const ECHO_DIVISIONS = ['1/16', '1/8', '1/8 punkt.', '1/4', '1/4 punkt.', '1/2', '1 Takt'];
/** Length of each echo division in beats (quarter notes). */
export const ECHO_BEATS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
export const FILTER_TYPES = ['Lowpass', 'Highpass', 'Bandpass'];

const P = (key: string, label: string, min: number, max: number, def: number, unit: ParamUnit, extra: Partial<ParamDef> = {}): ParamDef => ({ key, label, min, max, def, unit, ...extra });

export const DEVICE_DEFS: Record<DeviceType, DeviceDef> = {
  eq: {
    type: 'eq',
    label: 'EQ',
    blurb: 'Low-Cut, Bässe, zwei Mitten-Bänder, Höhen, High-Cut',
    group: 'eq',
    params: [
      P('hp', 'Low-Cut', 20, 1000, 20, 'hz', { curve: 'log' }),
      P('lsF', 'Bass Hz', 30, 500, 100, 'hz', { curve: 'log' }),
      P('lsG', 'Bass', -18, 18, 0, 'db'),
      P('p1F', 'Mitte 1 Hz', 60, 8000, 400, 'hz', { curve: 'log' }),
      P('p1G', 'Mitte 1', -18, 18, 0, 'db'),
      P('p1Q', 'Mitte 1 Q', 0.3, 10, 1, 'ratio', { curve: 'log' }),
      P('p2F', 'Mitte 2 Hz', 200, 12000, 2500, 'hz', { curve: 'log' }),
      P('p2G', 'Mitte 2', -18, 18, 0, 'db'),
      P('p2Q', 'Mitte 2 Q', 0.3, 10, 1, 'ratio', { curve: 'log' }),
      P('hsF', 'Höhen Hz', 2000, 16000, 8000, 'hz', { curve: 'log' }),
      P('hsG', 'Höhen', -18, 18, 0, 'db'),
      P('lp', 'High-Cut', 1000, 20000, 20000, 'hz', { curve: 'log' }),
    ],
  },
  comp: {
    type: 'comp',
    label: 'Compressor',
    blurb: 'Threshold, Ratio, Attack, Release, Knee, Makeup',
    group: 'dynamics',
    params: [
      P('threshold', 'Threshold', -60, 0, -18, 'db', { step: 0.5 }),
      P('ratio', 'Ratio', 1, 20, 4, 'ratio', { curve: 'log' }),
      P('attack', 'Attack', 1, 100, 10, 'ms', { curve: 'log' }),
      P('release', 'Release', 20, 1000, 120, 'ms', { curve: 'log' }),
      P('knee', 'Knee', 0, 24, 6, 'db', { step: 0.5 }),
      P('makeup', 'Makeup', 0, 24, 0, 'db', { step: 0.5 }),
      P('mix', 'Mix', 0, 1, 1, 'pct'),
    ],
  },
  sat: {
    type: 'sat',
    label: 'Saturator',
    blurb: 'Soft, Hard, Fold und Tube Verzerrung',
    group: 'distortion',
    params: [
      P('mode', 'Typ', 0, 3, 0, 'enum', { step: 1, options: SAT_MODES }),
      P('drive', 'Drive', 0, 24, 9, 'db', { step: 0.5 }),
      P('tone', 'Tone', 1000, 20000, 20000, 'hz', { curve: 'log' }),
      P('out', 'Output', -24, 6, 0, 'db', { step: 0.5 }),
      P('mix', 'Mix', 0, 1, 1, 'pct'),
    ],
  },
  echo: {
    type: 'echo',
    label: 'Echo',
    blurb: 'Delay im Songtempo oder frei, Feedback, Ping-Pong',
    group: 'space',
    params: [
      P('sync', 'Sync', 0, 1, 1, 'switch', { step: 1, options: ['Frei', 'Tempo'] }),
      P('division', 'Länge', 0, 6, 2, 'enum', { step: 1, options: ECHO_DIVISIONS }),
      P('time', 'Zeit', 20, 2000, 375, 'ms', { curve: 'log' }),
      P('feedback', 'Feedback', 0, 0.95, 0.4, 'pct'),
      P('hp', 'Low-Cut', 20, 2000, 150, 'hz', { curve: 'log' }),
      P('lp', 'High-Cut', 500, 20000, 5000, 'hz', { curve: 'log' }),
      P('pingpong', 'Ping-Pong', 0, 1, 0, 'switch', { step: 1, options: ['Aus', 'An'] }),
      P('mix', 'Mix', 0, 1, 0.3, 'pct'),
    ],
  },
  reverb: {
    type: 'reverb',
    label: 'Reverb',
    blurb: 'Raum und Hall mit Predelay und Dämpfung',
    group: 'space',
    params: [
      P('size', 'Größe', 0.3, 6, 2.4, 'sec', { curve: 'log' }),
      P('predelay', 'Predelay', 0, 200, 0, 'ms'),
      P('lowcut', 'Low-Cut', 20, 1000, 120, 'hz', { curve: 'log' }),
      P('damp', 'High-Cut', 1000, 20000, 12000, 'hz', { curve: 'log' }),
      P('mix', 'Mix', 0, 1, 0.25, 'pct'),
    ],
  },
  chorus: {
    type: 'chorus',
    label: 'Chorus',
    blurb: 'Breiter Chorus; kurze Zeit mit Feedback wird zum Flanger',
    group: 'space',
    params: [
      P('rate', 'Rate', 0.05, 8, 0.6, 'hzfree', { curve: 'log' }),
      P('depth', 'Tiefe', 0, 1, 0.5, 'pct'),
      P('delay', 'Delay', 1, 30, 10, 'ms', { curve: 'log' }),
      P('feedback', 'Feedback', 0, 0.8, 0, 'pct'),
      P('mix', 'Mix', 0, 1, 0.5, 'pct'),
    ],
  },
  filter: {
    type: 'filter',
    label: 'Filter',
    blurb: 'Lowpass, Highpass, Bandpass mit LFO',
    group: 'eq',
    params: [
      P('type', 'Typ', 0, 2, 0, 'enum', { step: 1, options: FILTER_TYPES }),
      P('cutoff', 'Cutoff', 30, 18000, 2000, 'hz', { curve: 'log' }),
      P('res', 'Resonanz', 0, 24, 6, 'db', { step: 0.5 }),
      P('lfoRate', 'LFO Rate', 0.05, 20, 1, 'hzfree', { curve: 'log' }),
      P('lfoDepth', 'LFO Tiefe', 0, 4, 0, 'oct'),
    ],
  },
  limiter: {
    type: 'limiter',
    label: 'Limiter',
    blurb: 'Weicher Limiter: Gain rein, Ceiling fest',
    group: 'dynamics',
    params: [P('gain', 'Gain', 0, 24, 0, 'db', { step: 0.5 }), P('ceiling', 'Ceiling', -12, 0, -0.3, 'db', { step: 0.1 })],
  },
  utility: {
    type: 'utility',
    label: 'Utility',
    blurb: 'Gain, Pan, Phase drehen',
    group: 'utility',
    params: [
      P('gain', 'Gain', -36, 24, 0, 'db', { step: 0.5 }),
      P('pan', 'Pan', -1, 1, 0, 'pan'),
      P('invert', 'Phase', 0, 1, 0, 'switch', { step: 1, options: ['Normal', 'Invertiert'] }),
    ],
  },
};

/** Order the browser lists the groups in. */
export const GROUP_ORDER: DeviceDef['group'][] = ['dynamics', 'eq', 'distortion', 'space', 'utility'];

export const DEVICE_TYPES = Object.keys(DEVICE_DEFS) as DeviceType[];

export const MAX_DEVICES = 8;

export const deviceDef = (type: DeviceType): DeviceDef => DEVICE_DEFS[type];

/** A new device with every parameter at its default. */
export function createDevice(type: DeviceType, id: string): Device {
  return { id, type, on: true, params: {} };
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Parameter values with defaults filled in, clamped to range and snapped to steps (old or hand-edited projects stay safe). */
export function deviceParams(device: Pick<Device, 'type' | 'params'>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of DEVICE_DEFS[device.type]?.params ?? []) {
    const raw = device.params?.[p.key];
    let v = typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, p.min, p.max) : p.def;
    if (p.step) v = clamp(p.min + Math.round((v - p.min) / p.step) * p.step, p.min, p.max);
    out[p.key] = v;
  }
  return out;
}

/** True when a device has been touched: any parameter other than its default. */
export const deviceIsDefault = (device: Device) => {
  const v = deviceParams(device);
  return (DEVICE_DEFS[device.type]?.params ?? []).every((p) => v[p.key] === p.def);
};

const dec = (v: number, digits: number) => v.toFixed(digits).replace('.', ',');

/** The text under a knob. */
export function formatParam(def: ParamDef, v: number): string {
  switch (def.unit) {
    case 'hz':
    case 'hzfree':
      // A cut at the end of its range does nothing: say so.
      if ((def.key === 'hp' && v <= def.min + 0.5) || (['lp', 'tone', 'damp'].includes(def.key) && v >= def.max - 1)) return 'Aus';
      return def.unit === 'hzfree' && v < 10 ? `${dec(v, 2)} Hz` : v >= 1000 ? `${dec(v / 1000, 1)} kHz` : `${Math.round(v)} Hz`;
    case 'db':
      return `${v > 0 ? '+' : ''}${dec(v, Math.abs(v) < 10 && def.step !== 1 ? 1 : 0)} dB`;
    case 'pct':
      return `${Math.round(v * 100)} %`;
    case 'ms':
      return v >= 100 ? `${Math.round(v)} ms` : `${dec(v, 1)} ms`;
    case 'sec':
      return `${dec(v, 1)} s`;
    case 'ratio':
      return def.key === 'ratio' ? `${dec(v, v < 10 ? 1 : 0)}:1` : dec(v, 1);
    case 'oct':
      return `${dec(v, 1)} Okt`;
    case 'pan':
      return Math.abs(v) < 0.005 ? 'Mitte' : `${Math.round(Math.abs(v) * 100)} ${v < 0 ? 'L' : 'R'}`;
    case 'enum':
    case 'switch':
      return def.options?.[Math.round(v)] ?? String(v);
  }
}

/** One line about a device's current state, shown when its card is folded. */
export function deviceSummary(device: Pick<Device, 'type' | 'params'>): string {
  const def = DEVICE_DEFS[device.type];
  if (!def) return '';
  const p = deviceParams(device);
  const f = (key: string) => {
    const d = def.params.find((x) => x.key === key)!;
    return formatParam(d, p[key]);
  };
  switch (device.type) {
    case 'eq': {
      const bands = [
        ['Bass', 'lsG'],
        ['Mitte 1', 'p1G'],
        ['Mitte 2', 'p2G'],
        ['Höhen', 'hsG'],
      ]
        .filter(([, k]) => Math.abs(p[k]) >= 0.05)
        .map(([name, k]) => `${name} ${f(k)}`);
      if (p.hp > 20.5) bands.unshift(`Low-Cut ${f('hp')}`);
      if (p.lp < 19999) bands.push(`High-Cut ${f('lp')}`);
      return bands.length ? bands.join(' · ') : 'Flach';
    }
    case 'comp':
      return `${f('threshold')} · ${f('ratio')} · ${f('release')}`;
    case 'sat':
      return `${f('mode')} · Drive ${f('drive')}`;
    case 'echo':
      return `${p.sync >= 0.5 ? f('division') : f('time')} · FB ${f('feedback')} · ${f('mix')}`;
    case 'reverb':
      return `${f('size')} · ${f('mix')}`;
    case 'chorus':
      return `${f('rate')} · ${f('mix')}`;
    case 'filter':
      return `${f('type')} · ${f('cutoff')}`;
    case 'limiter':
      return `Gain ${f('gain')} · Ceiling ${f('ceiling')}`;
    case 'utility':
      return `${f('gain')}${Math.abs(p.pan) > 0.005 ? ` · ${f('pan')}` : ''}${p.invert >= 0.5 ? ' · Phase' : ''}`;
  }
}
