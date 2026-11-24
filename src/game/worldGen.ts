import {
  GOVERNMENTS,
  GRID_H,
  GRID_W,
  IDEOLOGIES,
  NATION_PALETTE,
  SUMMIT_RADIUS,
  SUMMIT_X,
  SUMMIT_Y,
  SURVIVOR_FIRST_NAMES,
  SURVIVOR_LAST_NAMES,
  TRAIT_POOL,
} from './constants';
import {
  BiomeType,
  BuildingSpacing,
  Nation,
  PropType,
  SurvivorRole,
  Unit,
  UnitKind,
  UnitTrait,
  WorldPreset,
} from './types';

export function randomName(): string {
  const f = SURVIVOR_FIRST_NAMES[(Math.random() * SURVIVOR_FIRST_NAMES.length) | 0];
  const l = SURVIVOR_LAST_NAMES[(Math.random() * SURVIVOR_LAST_NAMES.length) | 0];
  return `${f} ${l}`;
}

export function randomTraits(count = 1): UnitTrait[] {
  const picked: UnitTrait[] = [];
  for (let i = 0; i < count; i++) {
    const t = TRAIT_POOL[(Math.random() * TRAIT_POOL.length) | 0];
    if (!picked.includes(t)) picked.push(t);
  }
  return picked;
}

export interface WorldGenResult {
  biome: Uint8Array;
  prop: Uint8Array;
  propHp: Uint16Array;
  propMaxHp: Uint16Array;
  propOwner: Int16Array;
  territory: Int16Array;
  nations: Nation[];
  units: Unit[];
  nextUnitId: number;
  nextNationId: number;
}

export function generateIkeaWorld(
  maxUnitsCap: number,
  preset: WorldPreset = 'standard'
): WorldGenResult {
  const total = GRID_W * GRID_H;
  const biome = new Uint8Array(total);
  const prop = new Uint8Array(total);
  const propHp = new Uint16Array(total);
  const propMaxHp = new Uint16Array(total);
  const propOwner = new Int16Array(total);
  const territory = new Int16Array(total);

  propOwner.fill(-1);
  territory.fill(-1);

  const setProp = (x: number, y: number, p: PropType, hp: number, owner = -1) => {
    if (x < 1 || x >= GRID_W - 1 || y < 1 || y >= GRID_H - 1) return;
    const idx = y * GRID_W + x;
    prop[idx] = p;
    propHp[idx] = hp;
    propMaxHp[idx] = hp;
    propOwner[idx] = owner;
  };

  // 1. Divide world into 30x30 IKEA store blocks separated by 4-tile main walkways
  const blockW = 30;
  const blockH = 30;
  const blocksX = Math.ceil(GRID_W / blockW);
  const blocksY = Math.ceil(GRID_H / blockH);

  // Assign sector types to blocks according to chosen WorldPreset
  const blockBiomes: BiomeType[][] = [];
  for (let by = 0; by < blocksY; by++) {
    blockBiomes[by] = [];
    for (let bx = 0; bx < blocksX; bx++) {
      const r = Math.random();
      if (preset === 'warehouse_maze') {
        if (r < 0.62) blockBiomes[by][bx] = BiomeType.WAREHOUSE;
        else if (r < 0.78) blockBiomes[by][bx] = BiomeType.SHOWROOM;
        else if (r < 0.9) blockBiomes[by][bx] = BiomeType.FOOD_COURT;
        else blockBiomes[by][bx] = BiomeType.DARK_SECTOR;
      } else if (preset === 'food_arena') {
        const nearCenter = bx >= 2 && bx <= 5 && by >= 1 && by <= 4;
        if (nearCenter || r < 0.45) blockBiomes[by][bx] = BiomeType.FOOD_COURT;
        else if (r < 0.78) blockBiomes[by][bx] = BiomeType.SHOWROOM;
        else blockBiomes[by][bx] = BiomeType.WAREHOUSE;
      } else if (preset === 'nightmare_dark') {
        if (r < 0.6) blockBiomes[by][bx] = BiomeType.DARK_SECTOR;
        else if (r < 0.78) blockBiomes[by][bx] = BiomeType.WAREHOUSE;
        else if (r < 0.9) blockBiomes[by][bx] = BiomeType.SHOWROOM;
        else blockBiomes[by][bx] = BiomeType.FOOD_COURT;
      } else {
        if (r < 0.34) blockBiomes[by][bx] = BiomeType.SHOWROOM;
        else if (r < 0.72) blockBiomes[by][bx] = BiomeType.WAREHOUSE;
        else if (r < 0.85) blockBiomes[by][bx] = BiomeType.FOOD_COURT;
        else blockBiomes[by][bx] = BiomeType.DARK_SECTOR;
      }
    }
  }

  // Ensure each starter nation area has Showroom/Warehouse + nearby Food Court
  const starterSpecs = [
    { cx: 52, cy: 50, fcX: 66, fcY: 46 },
    { cx: 184, cy: 52, fcX: 168, fcY: 48 },
    { cx: 118, cy: 134, fcX: 118, fcY: 116 },
  ];

  for (const s of starterSpecs) {
    const bx = Math.min(blocksX - 1, Math.max(0, (s.cx / blockW) | 0));
    const by = Math.min(blocksY - 1, Math.max(0, (s.cy / blockH) | 0));
    blockBiomes[by][bx] = BiomeType.SHOWROOM;
    const fbx = Math.min(blocksX - 1, Math.max(0, (s.fcX / blockW) | 0));
    const fby = Math.min(blocksY - 1, Math.max(0, (s.fcY / blockH) | 0));
    blockBiomes[fby][fbx] = BiomeType.FOOD_COURT;
  }

  // Fill biome grid with walkways around block borders
  for (let y = 0; y < GRID_H; y++) {
    const by = (y / blockH) | 0;
    const ly = y % blockH;
    for (let x = 0; x < GRID_W; x++) {
      const bx = (x / blockW) | 0;
      const lx = x % blockW;
      const idx = y * GRID_W + x;
      if (lx < 2 || lx >= blockW - 2 || ly < 2 || ly >= blockH - 2) {
        biome[idx] = BiomeType.WALKWAY;
      } else {
        biome[idx] = blockBiomes[by][bx];
      }
    }
  }

  // Add extra Food Courts inside Food Court blocks & props per biome
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const bType = blockBiomes[by][bx];
      const x0 = bx * blockW + 3;
      const y0 = by * blockH + 3;
      const x1 = Math.min(GRID_W - 3, (bx + 1) * blockW - 3);
      const y1 = Math.min(GRID_H - 3, (by + 1) * blockH - 3);

      if (bType === BiomeType.WAREHOUSE) {
        // Long parallel shelf rows with aisles & periodic gaps
        for (let y = y0 + 1; y < y1 - 1; y += 4) {
          for (let x = x0 + 1; x < x1 - 1; x++) {
            if ((x - x0) % 7 === 0 || (x - x0) % 7 === 1) continue; // aisle gap
            if (Math.random() < 0.85) {
              setProp(x, y, PropType.SHELF, 90);
            } else {
              setProp(x, y, PropType.WOOD_PALLET, 60);
            }
          }
        }
      } else if (bType === BiomeType.SHOWROOM) {
        // Cozy showroom pods (couches, beds, lamps)
        for (let y = y0 + 2; y < y1 - 2; y += 5) {
          for (let x = x0 + 2; x < x1 - 2; x += 6) {
            const roll = Math.random();
            if (roll < 0.4) {
              setProp(x, y, PropType.COUCH, 50);
              setProp(x + 1, y, PropType.LAMP, 35);
            } else if (roll < 0.78) {
              setProp(x, y, PropType.BED, 55);
              if (Math.random() < 0.5) setProp(x + 1, y + 1, PropType.LAMP, 35);
            } else {
              setProp(x, y, PropType.WOOD_PALLET, 50);
            }
          }
        }
      } else if (bType === BiomeType.FOOD_COURT) {
        // Meatball & Lingonberry vats clustered in cafeteria
        const midX = ((x0 + x1) / 2) | 0;
        const midY = ((y0 + y1) / 2) | 0;
        for (let dy = -4; dy <= 4; dy += 2) {
          for (let dx = -5; dx <= 5; dx += 3) {
            if (Math.random() < 0.8) {
              setProp(midX + dx, midY + dy, PropType.MEATBALL_VAT, 120);
            }
          }
        }
      } else if (bType === BiomeType.DARK_SECTOR) {
        // Dense broken shelves & dark hazards
        for (let y = y0 + 1; y < y1 - 1; y += 3) {
          for (let x = x0 + 1; x < x1 - 1; x++) {
            if ((x - x0) % 5 === 0) continue;
            if (Math.random() < 0.55) {
              setProp(x, y, PropType.SHELF, 85);
            }
          }
        }
      }
    }
  }

  // Ensure starter Food Courts right next to each starter capital
  for (const s of starterSpecs) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const tx = s.fcX + dx;
        const ty = s.fcY + dy;
        if (tx > 1 && tx < GRID_W - 1 && ty > 1 && ty < GRID_H - 1) {
          biome[ty * GRID_W + tx] = BiomeType.FOOD_COURT;
          prop[ty * GRID_W + tx] = PropType.NONE;
          if (Math.abs(dx) % 2 === 0 && Math.abs(dy) % 2 === 0) {
            setProp(tx, ty, PropType.MEATBALL_VAT, 120);
          }
        }
      }
    }
  }

  // Create Safe Neutral Summit Lounge in the store center for peaceful King Summits
  for (let dy = -SUMMIT_RADIUS; dy <= SUMMIT_RADIUS; dy++) {
    for (let dx = -SUMMIT_RADIUS; dx <= SUMMIT_RADIUS; dx++) {
      if (dx * dx + dy * dy > SUMMIT_RADIUS * SUMMIT_RADIUS) continue;
      const tx = SUMMIT_X + dx;
      const ty = SUMMIT_Y + dy;
      const idx = ty * GRID_W + tx;
      biome[idx] = BiomeType.SHOWROOM;
      prop[idx] = PropType.NONE;
      territory[idx] = -1;
    }
  }
  setProp(SUMMIT_X - 4, SUMMIT_Y - 4, PropType.SPOTLIGHT, 9999, -1);
  setProp(SUMMIT_X + 4, SUMMIT_Y - 4, PropType.SPOTLIGHT, 9999, -1);
  setProp(SUMMIT_X - 4, SUMMIT_Y + 4, PropType.SPOTLIGHT, 9999, -1);
  setProp(SUMMIT_X + 4, SUMMIT_Y + 4, PropType.SPOTLIGHT, 9999, -1);
  setProp(SUMMIT_X - 2, SUMMIT_Y, PropType.COUCH, 500, -1);
  setProp(SUMMIT_X + 2, SUMMIT_Y, PropType.COUCH, 500, -1);
  setProp(SUMMIT_X, SUMMIT_Y - 2, PropType.COUCH, 500, -1);
  setProp(SUMMIT_X, SUMMIT_Y + 2, PropType.COUCH, 500, -1);
  setProp(SUMMIT_X - 2, SUMMIT_Y - 2, PropType.LAMP, 500, -1);
  setProp(SUMMIT_X + 2, SUMMIT_Y + 2, PropType.LAMP, 500, -1);

  // 2. Spawn 3 Starter Nations
  const nations: Nation[] = [];
  const units: Unit[] = [];
  let nextUnitId = 1;
  let nextNationId = 0;

  const spawnUnit = (
    kind: UnitKind,
    role: SurvivorRole,
    nationId: number,
    x: number,
    y: number,
    overrideName?: string,
    overrideTraits?: UnitTrait[]
  ): Unit => {
    const traits = overrideTraits ?? randomTraits(1);
    const isLeader = role === SurvivorRole.LEADER;
    const isGuard = role === SurvivorRole.GUARD;
    const baseHp = isLeader ? 140 : isGuard ? 95 : 70;
    const maxHp = traits.includes('Tough') ? Math.round(baseHp * 1.35) : baseHp;
    const baseSpd = traits.includes('Speedy') ? 5.6 : 4.3;
    const u: Unit = {
      id: nextUnitId++,
      kind,
      role,
      nationId,
      x,
      y,
      vx: 0,
      vy: 0,
      hp: maxHp,
      maxHp,
      atk: isLeader ? 14 : isGuard ? 11 : 6,
      speed: baseSpd,
      name: overrideName || randomName(),
      age: 20 + ((Math.random() * 25) | 0),
      kills: 0,
      hunger: 10 + Math.random() * 15,
      traits,
      carryType: 'none',
      carryAmount: 0,
      targetNationId: -1,
      originNationId: nationId,
      targetX: x,
      targetY: y,
      hasTarget: false,
      stuckTimer: 0,
      lastCheckX: x,
      lastCheckY: y,
      attackCooldown: 0,
      hitFlash: 0,
      feverTimer: 0,
      aiTimer: Math.random() * 0.4,
      chatEmoji: '',
      chatTimer: 0,
      alive: true,
    };
    units.push(u);
    return u;
  };

  for (let i = 0; i < starterSpecs.length; i++) {
    const spec = starterSpecs[i];
    const pal = NATION_PALETTE[i % NATION_PALETTE.length];
    const nid = nextNationId++;
    const cx = spec.cx;
    const cy = spec.cy;

    // Clear central plaza for capital
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        const idx = ty * GRID_W + tx;
        if (dx * dx + dy * dy <= 30) {
          prop[idx] = PropType.NONE;
          territory[idx] = nid;
        }
      }
    }

    // Place Capital Flag, Spotlight, and 1 starter Mattress Hut so Builders actively expand the kingdom's pattern
    setProp(cx, cy, PropType.CHECKOUT_FLAG, 400, nid);
    setProp(cx + 2, cy, PropType.SPOTLIGHT, 150, nid);
    setProp(cx - 2, cy - 1, PropType.MATTRESS_HUT, 130, nid);

    const gov = GOVERNMENTS[i % GOVERNMENTS.length];
    const ideology = IDEOLOGIES[i % IDEOLOGIES.length];
    const leaderName = randomName();
    const leaderUnit = spawnUnit(
      UnitKind.SURVIVOR,
      SurvivorRole.LEADER,
      nid,
      cx + 0.5,
      cy + 1.2,
      leaderName,
      ['Brave', 'Tough']
    );

    // Spawn 17 more citizens (18 total) with diverse jobs (only ~22% Army Guards)
    const starterRoles: SurvivorRole[] = [
      SurvivorRole.SCAVENGER,
      SurvivorRole.SCAVENGER,
      SurvivorRole.SCAVENGER,
      SurvivorRole.SCAVENGER,
      SurvivorRole.SCAVENGER,
      SurvivorRole.BUILDER,
      SurvivorRole.BUILDER,
      SurvivorRole.BUILDER,
      SurvivorRole.CHEF,
      SurvivorRole.CHEF,
      SurvivorRole.TINKER,
      SurvivorRole.TINKER,
      SurvivorRole.TRADER,
      SurvivorRole.GUARD,
      SurvivorRole.GUARD,
      SurvivorRole.GUARD,
      SurvivorRole.GUARD,
    ];
    for (let u = 0; u < 17; u++) {
      const role = starterRoles[u] ?? SurvivorRole.SCAVENGER;
      const angle = (u / 17) * Math.PI * 2;
      const rad = 1.5 + Math.random() * 2.5;
      spawnUnit(
        UnitKind.SURVIVOR,
        role,
        nid,
        cx + Math.cos(angle) * rad,
        cy + Math.sin(angle) * rad
      );
    }

    const nation: Nation = {
      id: nid,
      name: pal.name,
      color: pal.color,
      borderColor: pal.border,
      capitalX: cx,
      capitalY: cy,
      meatballs: 45,
      scrap: 40,
      allenWrenches: 15,
      techTier: 1,
      population: 18,
      housingCap: 28,
      territoryTiles: 96,
      ideology,
      government: gov,
      taxRate: 'Normal',
      happiness: 78,
      lowHappinessTimer: 0,
      warExhaustion: 0,
      threatScore: 0,
      overlordId: null,
      vassalIds: [],
      loyalty: 100,
      leader: {
        unitId: leaderUnit.id,
        name: leaderName,
        age: leaderUnit.age,
        traits: leaderUnit.traits,
        alive: true,
        crownedDay: 1,
        kills: 0,
      },
      recentCoupDay: -10,
      isRebel: false,
      lastQuote: 'Hold the checkout lanes and guard the meatball vats!',
      relations: {},
      alive: true,
      foundedDay: 1,
      sabotageCooldown: 0,
      cartCooldown: 4,
      armyCount: 4,
      armyCap: gov === 'Iron Dictatorship' ? 6 : 4,
      buildingSpacing: (['Spaced', 'Crowded', 'Balanced'] as BuildingSpacing[])[i % 3],
      researchedTechs: [],
      activeResearchId: null,
      researchPoints: 0,
      researchRate: 0,
    };
    nations.push(nation);
  }

  // Initialize neutral relations between starter nations
  for (const a of nations) {
    for (const b of nations) {
      if (a.id !== b.id) {
        a.relations[b.id] = {
          stance: 'NEUTRAL',
          truceUntilDay: 0,
          warExhaustion: 0,
          tradeVolume: 0,
        };
      }
    }
  }

  // 3. Scatter wandering neutral survivors & traders across the map for instant action
  const wanderCount = Math.min(40, Math.max(15, (maxUnitsCap * 0.03) | 0));
  for (let i = 0; i < wanderCount; i++) {
    const wx = 12 + Math.random() * (GRID_W - 24);
    const wy = 12 + Math.random() * (GRID_H - 24);
    const tx = wx | 0;
    const ty = wy | 0;
    if (prop[ty * GRID_W + tx] !== PropType.NONE) {
      prop[ty * GRID_W + tx] = PropType.NONE;
    }
    const isTrader = i % 10 === 0;
    spawnUnit(
      UnitKind.SURVIVOR,
      isTrader ? SurvivorRole.TRADER : SurvivorRole.SCAVENGER,
      -1,
      wx,
      wy
    );
  }

  // 4. Seed passive daytime SCP-3008-2 Staff strolling aisles (turn hostile at Night)
  for (let i = 0; i < 12; i++) {
    const sx = 14 + Math.random() * (GRID_W - 28);
    const sy = 14 + Math.random() * (GRID_H - 28);
    const stx = sx | 0;
    const sty = sy | 0;
    if (territory[sty * GRID_W + stx] !== -1) continue;
    if (prop[sty * GRID_W + stx] !== PropType.NONE) {
      prop[sty * GRID_W + stx] = PropType.NONE;
    }
    const staff = spawnUnit(
      i % 4 === 0 ? UnitKind.STAFF_CRAWLER : UnitKind.STAFF_NORMAL,
      SurvivorRole.GUARD,
      -1,
      sx,
      sy,
      i % 4 === 0 ? 'SCP-3008-2 Crawler' : 'SCP-3008-2 Staff',
      []
    );
    staff.maxHp = i % 4 === 0 ? 65 : 105;
    staff.hp = staff.maxHp;
    staff.atk = i % 4 === 0 ? 10 : 14;
    staff.speed = i % 4 === 0 ? 6.4 : 4.6;
  }

  return {
    biome,
    prop,
    propHp,
    propMaxHp,
    propOwner,
    territory,
    nations,
    units,
    nextUnitId,
    nextNationId,
  };
}
