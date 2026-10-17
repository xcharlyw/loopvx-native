import { deviceParams } from '../audio/devices';
import type { Device, DeviceType } from '../types';

// The user's own device presets (Live's "save preset" button on a device): a name and the full parameter set of one device type,
// kept on the device (kv `devicePresets`). Pure helpers; the store keeps the list.

export interface UserDevicePreset {
  id: string;
  type: DeviceType;
  name: string;
  params: Record<string, number>;
  user: true;
}

export const MAX_USER_PRESETS = 200;

/** Saves the device's current settings under a name; the same name (any case) of the same device type is replaced. */
export function saveUserPreset(list: UserDevicePreset[], device: Pick<Device, 'type' | 'params'>, name: string, id: string): UserDevicePreset[] {
  const clean = name.trim().slice(0, 40);
  if (!clean) return list;
  const preset: UserDevicePreset = { id, type: device.type, name: clean, params: deviceParams(device), user: true };
  const at = list.findIndex((p) => p.type === device.type && p.name.toLowerCase() === clean.toLowerCase());
  if (at >= 0) return list.map((p, i) => (i === at ? { ...preset, id: p.id } : p));
  return [...list, preset].slice(-MAX_USER_PRESETS);
}

export const removeUserPreset = (list: UserDevicePreset[], id: string): UserDevicePreset[] => list.filter((p) => p.id !== id);

/** Stored data back into presets: anything malformed is dropped (storage can be edited). */
export function cleanUserPresets(raw: unknown): UserDevicePreset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is UserDevicePreset => !!p && typeof p === 'object' && typeof p.id === 'string' && typeof p.type === 'string' && typeof p.name === 'string' && !!p.params && typeof p.params === 'object')
    .map((p) => ({ id: p.id, type: p.type, name: p.name, params: { ...p.params }, user: true as const }));
}

/** The user preset a device matches exactly, if any. */
export function userPresetOf(list: UserDevicePreset[], device: Pick<Device, 'type' | 'params'>): UserDevicePreset | undefined {
  const own = deviceParams(device);
  return list.find((p) => p.type === device.type && Object.keys(own).every((k) => Math.abs((p.params[k] ?? NaN) - own[k]) < 1e-9));
}

/** A name for a new preset that is not taken yet: "<Device> 1", "<Device> 2" … */
export function freePresetName(list: UserDevicePreset[], type: DeviceType, base: string): string {
  const taken = new Set(list.filter((p) => p.type === type).map((p) => p.name.toLowerCase()));
  for (let i = 1; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}
