import { ActiveAnomaly, ChronicleEntry, HallOfRecords, Nation, NewsItem, Unit } from './types';

export interface SerializedWorldV1 {
  version: 1;
  label: string;
  savedAt: string;
  day: number;
  cycleTimer: number;
  isNight: boolean;
  nextUnitId: number;
  nextNationId: number;
  nextNewsId: number;
  nextChronicleId: number;
  simTime: number;
  staffSpawnTimer: number;
  economyTimer: number;
  diplomacyTimer: number;
  territoryRebuildTimer: number;
  vatRegenTimer: number;
  fireTickTimer: number;
  watchtowerTimer: number;
  summitActiveTimer: number;
  lastAutoSummitDay: number;
  summitDiscussed: boolean;
  allowWildStaffKingdoms?: boolean;
  infiniteWorldMode?: boolean;
  smartInfrastructureMode?: boolean;
  originTx?: number;
  originTy?: number;
  worldSeed?: number;
  activeAnomaly?: ActiveAnomaly | null;
  camera: { x: number; y: number; zoom: number };
  nations: Nation[];
  units: Unit[];
  news: NewsItem[];
  chronicle: ChronicleEntry[];
  records: HallOfRecords;
  grids: {
    biome: string;
    prop: string;
    propHp: string;
    propMaxHp: string;
    propOwner: string;
    propVariant: string;
    territory: string;
    fireMap: string;
    disabledLightMap: string;
  };
}

export interface SaveSlotMeta {
  slotId: string;
  label: string;
  savedAt: string;
  day: number;
  nationCount: number;
  unitCount: number;
}

const SAVE_PREFIX = 'scp3008_world_slot_v1_';
export const SAVE_SLOTS = ['1', '2', '3'] as const;

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function typedArrayToBase64(arr: Uint8Array | Uint16Array | Int16Array): string {
  return bytesToBase64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
}

export function base64ToUint8(b64: string, expectedLen: number): Uint8Array {
  const bytes = base64ToBytes(b64);
  if (bytes.length !== expectedLen) {
    throw new Error('Corrupted world grid data (Uint8 length mismatch).');
  }
  return bytes;
}

export function base64ToUint16(b64: string, expectedLen: number): Uint16Array {
  const bytes = base64ToBytes(b64);
  if (bytes.byteLength !== expectedLen * 2) {
    throw new Error('Corrupted world grid data (Uint16 length mismatch).');
  }
  return new Uint16Array(bytes.buffer.slice(0));
}

export function base64ToInt16(b64: string, expectedLen: number): Int16Array {
  const bytes = base64ToBytes(b64);
  if (bytes.byteLength !== expectedLen * 2) {
    throw new Error('Corrupted world grid data (Int16 length mismatch).');
  }
  return new Int16Array(bytes.buffer.slice(0));
}

export function listSaveSlots(): Record<string, SaveSlotMeta | null> {
  const out: Record<string, SaveSlotMeta | null> = {};
  for (const id of SAVE_SLOTS) {
    try {
      const raw = window.localStorage.getItem(`${SAVE_PREFIX}${id}`);
      if (!raw) {
        out[id] = null;
        continue;
      }
      const parsed = JSON.parse(raw) as SerializedWorldV1;
      if (parsed && parsed.version === 1) {
        out[id] = {
          slotId: id,
          label: parsed.label || `Save Slot ${id}`,
          savedAt: parsed.savedAt,
          day: parsed.day,
          nationCount: parsed.nations.filter((n) => n.alive).length,
          unitCount: parsed.units.filter((u) => u.alive).length,
        };
      } else {
        out[id] = null;
      }
    } catch {
      out[id] = null;
    }
  }
  return out;
}

export function writeSaveSlot(slotId: string, payload: SerializedWorldV1): void {
  const json = JSON.stringify(payload);
  window.localStorage.setItem(`${SAVE_PREFIX}${slotId}`, json);
}

export function readSaveSlot(slotId: string): SerializedWorldV1 | null {
  try {
    const raw = window.localStorage.getItem(`${SAVE_PREFIX}${slotId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SerializedWorldV1;
    if (!parsed || parsed.version !== 1 || !parsed.grids) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function deleteSaveSlot(slotId: string): void {
  window.localStorage.removeItem(`${SAVE_PREFIX}${slotId}`);
}
