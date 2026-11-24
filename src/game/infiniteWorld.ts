import { BiomeType, PropType, SurvivorRole, Unit, UnitKind, WorldPreset } from './types';

export const CHUNK_W = 30;
export const CHUNK_H = 30;
export const CHUNK_LEN = CHUNK_W * CHUNK_H;

export interface SavedWorldChunk {
  bx: number;
  by: number;
  biome: Uint8Array;
  prop: Uint8Array;
  propHp: Uint16Array;
  propMaxHp: Uint16Array;
  propOwner: Int16Array;
  propVariant: Uint8Array;
  territory: Int16Array;
  lightMap: Uint8Array;
  fireMap: Uint8Array;
  disabledLightMap: Uint8Array;
  dormantUnits: Unit[];
  nationTerrCounts?: Record<number, number>;
}

export interface ChunkSpawnSpec {
  kind: UnitKind;
  role: SurvivorRole;
  lx: number;
  ly: number;
  name?: string;
}

export function chunkKey(bx: number, by: number): string {
  return `${bx},${by}`;
}

function createSeededRng(seed: number, bx: number, by: number): () => number {
  let h = (seed ^ Math.imul(bx, 374761393) ^ Math.imul(by, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  let state = (h ^ (h >>> 16)) >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createEmptyChunk(bx: number, by: number): SavedWorldChunk {
  const propOwner = new Int16Array(CHUNK_LEN);
  const territory = new Int16Array(CHUNK_LEN);
  propOwner.fill(-1);
  territory.fill(-1);
  return {
    bx,
    by,
    biome: new Uint8Array(CHUNK_LEN),
    prop: new Uint8Array(CHUNK_LEN),
    propHp: new Uint16Array(CHUNK_LEN),
    propMaxHp: new Uint16Array(CHUNK_LEN),
    propOwner,
    propVariant: new Uint8Array(CHUNK_LEN),
    territory,
    lightMap: new Uint8Array(CHUNK_LEN),
    fireMap: new Uint8Array(CHUNK_LEN),
    disabledLightMap: new Uint8Array(CHUNK_LEN),
    dormantUnits: [],
  };
}

export function generateProceduralChunk(
  worldSeed: number,
  bx: number,
  by: number,
  preset: WorldPreset
): { chunk: SavedWorldChunk; spawns: ChunkSpawnSpec[]; primaryBiome: BiomeType } {
  const rng = createSeededRng(worldSeed, bx, by);
  const chunk = createEmptyChunk(bx, by);
  const spawns: ChunkSpawnSpec[] = [];

  const r = rng();
  let bType: BiomeType;
  if (preset === 'warehouse_maze') {
    if (r < 0.62) bType = BiomeType.WAREHOUSE;
    else if (r < 0.78) bType = BiomeType.SHOWROOM;
    else if (r < 0.9) bType = BiomeType.FOOD_COURT;
    else bType = BiomeType.DARK_SECTOR;
  } else if (preset === 'food_arena') {
    if (r < 0.45) bType = BiomeType.FOOD_COURT;
    else if (r < 0.78) bType = BiomeType.SHOWROOM;
    else bType = BiomeType.WAREHOUSE;
  } else if (preset === 'nightmare_dark') {
    if (r < 0.6) bType = BiomeType.DARK_SECTOR;
    else if (r < 0.78) bType = BiomeType.WAREHOUSE;
    else if (r < 0.9) bType = BiomeType.SHOWROOM;
    else bType = BiomeType.FOOD_COURT;
  } else {
    if (r < 0.34) bType = BiomeType.SHOWROOM;
    else if (r < 0.72) bType = BiomeType.WAREHOUSE;
    else if (r < 0.86) bType = BiomeType.FOOD_COURT;
    else bType = BiomeType.DARK_SECTOR;
  }

  const setLocalProp = (lx: number, ly: number, p: PropType, hp: number) => {
    if (lx < 0 || lx >= CHUNK_W || ly < 0 || ly >= CHUNK_H) return;
    const idx = ly * CHUNK_W + lx;
    chunk.prop[idx] = p;
    chunk.propHp[idx] = hp;
    chunk.propMaxHp[idx] = hp;
    chunk.propOwner[idx] = -1;
  };

  for (let ly = 0; ly < CHUNK_H; ly++) {
    for (let lx = 0; lx < CHUNK_W; lx++) {
      const idx = ly * CHUNK_W + lx;
      if (lx < 2 || lx >= CHUNK_W - 2 || ly < 2 || ly >= CHUNK_H - 2) {
        chunk.biome[idx] = BiomeType.WALKWAY;
      } else {
        chunk.biome[idx] = bType;
      }
    }
  }

  const x0 = 3;
  const y0 = 3;
  const x1 = CHUNK_W - 3;
  const y1 = CHUNK_H - 3;

  if (bType === BiomeType.WAREHOUSE) {
    for (let y = y0 + 1; y < y1 - 1; y += 4) {
      for (let x = x0 + 1; x < x1 - 1; x++) {
        if ((x - x0) % 7 === 0 || (x - x0) % 7 === 1) continue;
        if (rng() < 0.85) {
          setLocalProp(x, y, PropType.SHELF, 90);
        } else {
          setLocalProp(x, y, PropType.WOOD_PALLET, 60);
        }
      }
    }
  } else if (bType === BiomeType.SHOWROOM) {
    for (let y = y0 + 2; y < y1 - 2; y += 5) {
      for (let x = x0 + 2; x < x1 - 2; x += 6) {
        const roll = rng();
        if (roll < 0.4) {
          setLocalProp(x, y, PropType.COUCH, 50);
          setLocalProp(x + 1, y, PropType.LAMP, 35);
        } else if (roll < 0.78) {
          setLocalProp(x, y, PropType.BED, 55);
          if (rng() < 0.5) setLocalProp(x + 1, y + 1, PropType.LAMP, 35);
        } else {
          setLocalProp(x, y, PropType.WOOD_PALLET, 50);
        }
      }
    }
    if (rng() < 0.14) {
      setLocalProp(15, 15, PropType.SPOTLIGHT, 150);
    }
  } else if (bType === BiomeType.FOOD_COURT) {
    const midX = 15;
    const midY = 15;
    for (let dy = -4; dy <= 4; dy += 2) {
      for (let dx = -5; dx <= 5; dx += 3) {
        if (rng() < 0.8) {
          setLocalProp(midX + dx, midY + dy, PropType.MEATBALL_VAT, 120);
        }
      }
    }
    if (rng() < 0.16) {
      setLocalProp(15, 10, PropType.SPOTLIGHT, 150);
    }
  } else if (bType === BiomeType.DARK_SECTOR) {
    for (let y = y0 + 1; y < y1 - 1; y += 3) {
      for (let x = x0 + 1; x < x1 - 1; x++) {
        if ((x - x0) % 5 === 0) continue;
        if (rng() < 0.55) {
          setLocalProp(x, y, PropType.SHELF, 85);
        }
      }
    }
  }

  // Seed wandering neutral survivors & daytime Staff on freshly discovered sectors
  const survRoll = rng();
  const survCount = survRoll < 0.45 ? 1 : survRoll < 0.75 ? 2 : 0;
  for (let i = 0; i < survCount; i++) {
    const lx = 4 + Math.floor(rng() * (CHUNK_W - 8));
    const ly = 4 + Math.floor(rng() * (CHUNK_H - 8));
    chunk.prop[ly * CHUNK_W + lx] = PropType.NONE;
    spawns.push({
      kind: UnitKind.SURVIVOR,
      role: i === 0 && rng() < 0.25 ? SurvivorRole.TRADER : SurvivorRole.SCAVENGER,
      lx: lx + 0.5,
      ly: ly + 0.5,
    });
  }

  if (rng() < 0.55) {
    const lx = 5 + Math.floor(rng() * (CHUNK_W - 10));
    const ly = 5 + Math.floor(rng() * (CHUNK_H - 10));
    chunk.prop[ly * CHUNK_W + lx] = PropType.NONE;
    const crawler = rng() < 0.28;
    spawns.push({
      kind: crawler ? UnitKind.STAFF_CRAWLER : UnitKind.STAFF_NORMAL,
      role: SurvivorRole.GUARD,
      lx: lx + 0.5,
      ly: ly + 0.5,
      name: crawler ? 'SCP-3008-2 Crawler' : 'SCP-3008-2 Staff',
    });
  }

  return { chunk, spawns, primaryBiome: bType };
}
