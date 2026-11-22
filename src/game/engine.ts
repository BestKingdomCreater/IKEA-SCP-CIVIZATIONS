import {
  CITIZEN_EMOJIS,
  COLONY_NAMES,
  CYCLE_DURATION,
  DAY_DURATION,
  FLAG_LIGHT_RADIUS,
  GOVERNMENTS,
  GRID_H,
  GRID_W,
  IDEOLOGIES,
  IKEA_QUOTES,
  NATION_PALETTE,
  REBEL_PREFIXES,
  REBEL_SUFFIXES,
  SETTLER_KINGDOM_NAMES,
  SPOTLIGHT_RADIUS,
  SUMMIT_RADIUS,
  SUMMIT_X,
  SUMMIT_Y,
  TECH_THRESHOLDS,
  TECH_TIER_NAMES,
  TILE_SIZE,
  WATCHTOWER_RADIUS,
  WORLD_PX_H,
  WORLD_PX_W,
} from './constants';
import { runHeuristicDiplomacyTurn } from './diplomacy';
import { canResearchTech, hasTech, RESEARCH_BY_ID, RESEARCH_TREE } from './research';
import {
  base64ToInt16,
  base64ToUint16,
  base64ToUint8,
  SerializedWorldV1,
  typedArrayToBase64,
} from './saveLoad';
import { soundFX } from './sound';
import { SpatialHashGrid } from './spatialHash';
import { getGlowSprites } from './sprites';
import {
  BattlePhase,
  BiomeType,
  BrushSize,
  BuildingPattern,
  ChronicleEntry,
  ChronicleEventType,
  CustomKingdomConfig,
  DiplomaticStance,
  FloatingText,
  FormationType,
  GeminiDiplomaticAction,
  GovernmentType,
  HallOfRecords,
  HudSnapshot,
  InspectedBuilding,
  Nation,
  NewsCategory,
  NewsItem,
  Particle,
  Projectile,
  PropType,
  SimSpeed,
  SurvivorRole,
  TaxRate,
  TechId,
  ToolId,
  Unit,
  UnitKind,
  UnitTrait,
  WorldPreset,
} from './types';
import { generateIkeaWorld, randomName, randomTraits } from './worldGen';

function createEmptyRecords(): HallOfRecords {
  return {
    totalWarsDeclared: 0,
    totalPeaceTreaties: 0,
    totalBuildingsBuilt: 0,
    totalTechsUnlocked: 0,
    totalStaffSlain: 0,
    totalSurvDeaths: 0,
    peakPopulation: 0,
    peakPopDay: 1,
    auditNightsSurvived: 0,
  };
}

export interface Camera {
  x: number; // world px center
  y: number;
  zoom: number;
}

export interface BannerHitbox {
  nationId: number;
  sx: number;
  sy: number;
  w: number;
  h: number;
}

const BIOME_RGB: Record<number, [number, number, number]> = {
  [BiomeType.WALKWAY]: [203, 213, 225],
  [BiomeType.SHOWROOM]: [224, 198, 158],
  [BiomeType.WAREHOUSE]: [148, 163, 184],
  [BiomeType.FOOD_COURT]: [253, 224, 71],
  [BiomeType.DARK_SECTOR]: [30, 34, 46],
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export class SimEngine {
  public biome: Uint8Array = new Uint8Array(GRID_W * GRID_H);
  public prop: Uint8Array = new Uint8Array(GRID_W * GRID_H);
  public propHp: Uint16Array = new Uint16Array(GRID_W * GRID_H);
  public propMaxHp: Uint16Array = new Uint16Array(GRID_W * GRID_H);
  public propOwner: Int16Array = new Int16Array(GRID_W * GRID_H);
  public propVariant: Uint8Array = new Uint8Array(GRID_W * GRID_H);
  public territory: Int16Array = new Int16Array(GRID_W * GRID_H);
  public lightMap: Uint8Array = new Uint8Array(GRID_W * GRID_H);
  public fireMap: Uint8Array = new Uint8Array(GRID_W * GRID_H);
  public disabledLightMap: Uint8Array = new Uint8Array(GRID_W * GRID_H); // timer in ticks/sec

  public nations: Nation[] = [];
  public units: Unit[] = [];
  public projectiles: Projectile[] = [];
  public particles: Particle[] = [];
  public floatingTexts: FloatingText[] = [];
  private recentBuilds: Array<{ x: number; y: number; color: string; life: number; maxLife: number }> = [];
  public news: NewsItem[] = [];
  public chronicle: ChronicleEntry[] = [];
  public records: HallOfRecords = createEmptyRecords();

  public spatialHash = new SpatialHashGrid();

  public nextUnitId = 1;
  public nextNationId = 0;
  public nextNewsId = 1;
  public nextChronicleId = 1;

  public day = 1;
  public cycleTimer = 6; // start partway into morning so action is immediate
  public isNight = false;
  public speed: SimSpeed = 1;
  public paused = false;

  public maxPopulation = 2000;
  public isMobileViewport = false;
  public particleScale = 1;
  public worldPreset: WorldPreset = 'standard';

  public camera: Camera = {
    x: WORLD_PX_W * 0.5,
    y: WORLD_PX_H * 0.5,
    zoom: 1.15,
  };

  public dirtyMap = true;
  public dirtyLight = true;
  private forceMapRebuild = true;
  private forceLightRebuild = true;
  private lastMapRebuildMs = 0;
  private lastLightRebuildMs = 0;

  private nationBuildingsCache: Map<
    number,
    Array<{ x: number; y: number; idx: number; prop: PropType }>
  > = new Map();
  private lightSourceIndices: number[] = [];
  private watchtowerIndices: number[] = [];
  private warFrontCache: Map<string, { x: number; y: number; simTime: number }> = new Map();
  private activeBuilderTargets: Set<number> = new Set();
  private deadUnitsCount = 0;

  public mapCanvas: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private mapImageData: ImageData;

  public minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private minimapImageData: ImageData;

  private lightOverlayCanvas: HTMLCanvasElement;
  private lightOverlayCtx: CanvasRenderingContext2D;

  public bannerHitboxes: BannerHitbox[] = [];
  public summitBannerHitbox: { sx: number; sy: number; w: number; h: number } | null = null;

  private simTime = 0;
  private staffSpawnTimer = 0;
  private economyTimer = 0;
  private diplomacyTimer = 0;
  private territoryRebuildTimer = 0;
  private vatRegenTimer = 0;
  private fireTickTimer = 0;
  private watchtowerTimer = 0;
  public summitActiveTimer = 0;
  public summitLoungeSessionActive = false;
  public summitSpeakingNationId: number | null = null;
  public summitSpeakingTimer = 0;
  private lastAutoSummitDay = 0;
  private summitDiscussed = false;
  private hegemonyClaimed = false;

  private onDayStartedCallback?: (day: number) => void;

  constructor(maxPop: number, isMobile: boolean, onDayStarted?: (day: number) => void) {
    this.maxPopulation = maxPop;
    this.isMobileViewport = isMobile;
    this.particleScale = isMobile ? 0.5 : 1;
    this.onDayStartedCallback = onDayStarted;

    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = WORLD_PX_W;
    this.mapCanvas.height = WORLD_PX_H;
    this.mapCtx = this.mapCanvas.getContext('2d')!;
    this.mapImageData = this.mapCtx.createImageData(WORLD_PX_W, WORLD_PX_H);

    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.width = GRID_W;
    this.minimapCanvas.height = GRID_H;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.minimapImageData = this.minimapCtx.createImageData(GRID_W, GRID_H);

    this.lightOverlayCanvas = document.createElement('canvas');
    this.lightOverlayCanvas.width = 480;
    this.lightOverlayCanvas.height = 360;
    this.lightOverlayCtx = this.lightOverlayCanvas.getContext('2d')!;

    this.resetWorld();
  }

  public resetWorld(preset?: WorldPreset): void {
    if (preset) {
      this.worldPreset = preset;
    }
    const gen = generateIkeaWorld(this.maxPopulation, this.worldPreset);
    this.biome = gen.biome;
    this.prop = gen.prop;
    this.propHp = gen.propHp;
    this.propMaxHp = gen.propMaxHp;
    this.propOwner = gen.propOwner;
    this.propVariant.fill(0);
    this.territory = gen.territory;
    this.fireMap.fill(0);
    this.disabledLightMap.fill(0);
    this.nations = gen.nations;
    this.units = gen.units;
    this.projectiles = [];
    this.particles = [];
    this.floatingTexts = [];
    this.recentBuilds = [];
    this.news = [];
    this.chronicle = [];
    this.records = createEmptyRecords();
    this.nextUnitId = gen.nextUnitId;
    this.nextNationId = gen.nextNationId;
    this.nextNewsId = 1;
    this.nextChronicleId = 1;
    this.day = 1;
    this.cycleTimer = 4;
    this.isNight = false;
    this.summitActiveTimer = 0;
    this.summitLoungeSessionActive = false;
    this.summitSpeakingNationId = null;
    this.summitSpeakingTimer = 0;
    this.lastAutoSummitDay = 0;
    this.summitDiscussed = false;
    this.hegemonyClaimed = false;
    this.dirtyMap = true;
    this.dirtyLight = true;
    this.forceMapRebuild = true;
    this.forceLightRebuild = true;
    this.warFrontCache.clear();
    this.activeBuilderTargets.clear();
    this.deadUnitsCount = 0;

    this.spatialHash.rebuild(this.units);
    this.recountTerritoryAndHousing();
    this.recomputeLightMap();
    this.rebuildMapCache();

    // Seed initial diplomatic stances so wars and multi-country trade start immediately
    if (this.nations.length >= 3) {
      this.setRelation(0, 1, 'TRADE_PACT');
      this.setRelation(0, 2, 'TRADE_PACT');
      this.setRelation(1, 2, 'WAR');
      this.records.totalWarsDeclared += 1;
      this.addNews('TRADE', `${this.nations[0].name} opened Shopping Cart Trade Pacts with ${this.nations[1].name} & ${this.nations[2].name}.`);
      this.addNews('WAR', `${this.nations[1].name} declared war on ${this.nations[2].name} over Food Court vats!`);
      this.addChronicle(
        'WAR',
        `${this.nations[1].name} vs ${this.nations[2].name}`,
        'Initial Food Court border conflict erupted on opening morning.',
        '#f87171'
      );
    }
    this.recountTerritoryAndHousing();
    this.addNews('DIPLOMACY', 'Day 1: Store lights flicker on. Three survivor nations claim the aisles.');
    this.addChronicle(
      'FOUNDING',
      'Opening Day in SCP-3008',
      `${this.nations.filter((n) => n.alive).map((n) => n.name).join(', ')} raised their checkout banners.`,
      '#34d399'
    );
  }

  public addChronicle(
    type: ChronicleEventType,
    title: string,
    detail: string,
    color = '#93c5fd'
  ): void {
    this.chronicle.unshift({
      id: this.nextChronicleId++,
      day: this.day,
      type,
      title,
      detail,
      color,
    });
    if (this.chronicle.length > 250) {
      this.chronicle.length = 250;
    }
  }

  public exportWorldState(label: string): SerializedWorldV1 {
    return {
      version: 1,
      label: label.trim() || `Day ${this.day} Store Save`,
      savedAt: new Date().toISOString(),
      day: this.day,
      cycleTimer: this.cycleTimer,
      isNight: this.isNight,
      nextUnitId: this.nextUnitId,
      nextNationId: this.nextNationId,
      nextNewsId: this.nextNewsId,
      nextChronicleId: this.nextChronicleId,
      simTime: this.simTime,
      staffSpawnTimer: this.staffSpawnTimer,
      economyTimer: this.economyTimer,
      diplomacyTimer: this.diplomacyTimer,
      territoryRebuildTimer: this.territoryRebuildTimer,
      vatRegenTimer: this.vatRegenTimer,
      fireTickTimer: this.fireTickTimer,
      watchtowerTimer: this.watchtowerTimer,
      summitActiveTimer: this.summitActiveTimer,
      lastAutoSummitDay: this.lastAutoSummitDay,
      summitDiscussed: this.summitDiscussed,
      camera: { ...this.camera },
      nations: this.nations.map((n) => ({
        ...n,
        relations: { ...n.relations },
        leader: { ...n.leader, traits: [...n.leader.traits] },
        vassalIds: [...n.vassalIds],
        researchedTechs: [...(n.researchedTechs || [])],
        unionHubs: n.unionHubs ? n.unionHubs.map((h) => ({ ...h })) : undefined,
      })),
      units: this.units.map((u) => ({
        ...u,
        traits: [...u.traits],
      })),
      news: [...this.news],
      chronicle: [...this.chronicle],
      records: { ...this.records },
      grids: {
        biome: typedArrayToBase64(this.biome),
        prop: typedArrayToBase64(this.prop),
        propHp: typedArrayToBase64(this.propHp),
        propMaxHp: typedArrayToBase64(this.propMaxHp),
        propOwner: typedArrayToBase64(this.propOwner),
        propVariant: typedArrayToBase64(this.propVariant),
        territory: typedArrayToBase64(this.territory),
        fireMap: typedArrayToBase64(this.fireMap),
        disabledLightMap: typedArrayToBase64(this.disabledLightMap),
      },
    };
  }

  public importWorldState(data: SerializedWorldV1): void {
    const gridLen = GRID_W * GRID_H;
    const biome = base64ToUint8(data.grids.biome, gridLen);
    const prop = base64ToUint8(data.grids.prop, gridLen);
    const propHp = base64ToUint16(data.grids.propHp, gridLen);
    const propMaxHp = base64ToUint16(data.grids.propMaxHp, gridLen);
    const propOwner = base64ToInt16(data.grids.propOwner, gridLen);
    const propVariant = base64ToUint8(data.grids.propVariant, gridLen);
    const territory = base64ToInt16(data.grids.territory, gridLen);
    const fireMap = base64ToUint8(data.grids.fireMap, gridLen);
    const disabledLightMap = base64ToUint8(data.grids.disabledLightMap, gridLen);

    this.biome.set(biome);
    this.prop.set(prop);
    this.propHp.set(propHp);
    this.propMaxHp.set(propMaxHp);
    this.propOwner.set(propOwner);
    this.propVariant.set(propVariant);
    this.territory.set(territory);
    this.fireMap.set(fireMap);
    this.disabledLightMap.set(disabledLightMap);

    this.day = data.day;
    this.cycleTimer = data.cycleTimer;
    this.isNight = data.isNight;
    this.nextUnitId = data.nextUnitId;
    this.nextNationId = data.nextNationId;
    this.nextNewsId = data.nextNewsId;
    this.nextChronicleId = data.nextChronicleId || 1;
    this.simTime = data.simTime || 0;
    this.staffSpawnTimer = data.staffSpawnTimer || 0;
    this.economyTimer = data.economyTimer || 0;
    this.diplomacyTimer = data.diplomacyTimer || 0;
    this.territoryRebuildTimer = data.territoryRebuildTimer || 0;
    this.vatRegenTimer = data.vatRegenTimer || 0;
    this.fireTickTimer = data.fireTickTimer || 0;
    this.watchtowerTimer = data.watchtowerTimer || 0;
    this.summitActiveTimer = data.summitActiveTimer || 0;
    this.lastAutoSummitDay = data.lastAutoSummitDay || 0;
    this.summitDiscussed = Boolean(data.summitDiscussed);
    this.summitLoungeSessionActive = false;
    this.summitSpeakingNationId = null;
    this.summitSpeakingTimer = 0;

    if (data.camera) {
      this.camera = { ...data.camera };
    }

    this.nations = data.nations.map((n) => ({
      ...n,
      relations: { ...(n.relations || {}) },
      leader: { ...n.leader, traits: [...(n.leader?.traits || [])] },
      vassalIds: [...(n.vassalIds || [])],
      researchedTechs: [...(n.researchedTechs || [])],
      unionHubs: n.unionHubs ? n.unionHubs.map((h) => ({ ...h })) : undefined,
    }));
    this.units = data.units.map((u) => ({
      ...u,
      traits: [...(u.traits || [])],
    }));
    this.news = [...(data.news || [])];
    this.chronicle = [...(data.chronicle || [])];
    this.records = { ...createEmptyRecords(), ...(data.records || {}) };

    this.projectiles = [];
    this.particles = [];
    this.floatingTexts = [];
    this.recentBuilds = [];
    this.dirtyMap = true;
    this.dirtyLight = true;
    this.forceMapRebuild = true;
    this.forceLightRebuild = true;
    this.warFrontCache.clear();
    this.activeBuilderTargets.clear();
    this.deadUnitsCount = 0;

    this.spatialHash.rebuild(this.units);
    this.hegemonyClaimed = false;
    this.recountTerritoryAndHousing();
    const loadedClaimed = this.nations.reduce((s, n) => s + (n.alive ? n.territoryTiles : 0), 0);
    if (loadedClaimed >= 400 && this.nations.some((n) => n.alive && n.territoryTiles / loadedClaimed >= 0.7)) {
      this.hegemonyClaimed = true;
    }
    this.recomputeLightMap();
    this.rebuildMapCache();
    this.addNews('GOD', `Loaded saved store world (Day ${this.day}).`);
  }

  public findOpenKingdomSpot(): { tx: number; ty: number } | null {
    let best: { tx: number; ty: number } | null = null;
    let bestClearance = -1;
    for (let attempt = 0; attempt < 90; attempt++) {
      const tx = 14 + ((Math.random() * (GRID_W - 28)) | 0);
      const ty = 14 + ((Math.random() * (GRID_H - 28)) | 0);
      if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 8) continue;
      let minDist = 999;
      for (const n of this.nations) {
        if (!n.alive) continue;
        const d = Math.hypot(n.capitalX - tx, n.capitalY - ty);
        if (d < minDist) minDist = d;
      }
      if (minDist < 12) continue;
      const terrBonus = this.territory[ty * GRID_W + tx] === -1 ? 20 : 0;
      const score = minDist + terrBonus;
      if (score > bestClearance) {
        bestClearance = score;
        best = { tx, ty };
      }
    }
    return best;
  }

  public spawnCustomKingdom(config: CustomKingdomConfig, wx: number, wy: number): { ok: boolean; error?: string; nation?: Nation } {
    let cx = Math.max(8, Math.min(GRID_W - 8, wx | 0));
    let cy = Math.max(8, Math.min(GRID_H - 8, wy | 0));

    if (Math.hypot(cx - SUMMIT_X, cy - SUMMIT_Y) <= SUMMIT_RADIUS + 4) {
      return { ok: false, error: 'Cannot establish a capital inside the neutral Summit Lounge zone.' };
    }

    const tooClose = this.nations.find(
      (n) => n.alive && Math.hypot(n.capitalX - cx, n.capitalY - cy) < 8
    );
    if (tooClose) {
      return { ok: false, error: `Too close to ${tooClose.name}'s capital flag.` };
    }

    const nid = this.nextNationId++;
    const cleanName = config.name.trim() || `New Freehold ${nid + 1}`;
    const popCount = Math.max(6, Math.min(24, config.startingPop | 0));

    // Claim 7x7 territory & clear immediate center without overwriting existing capital flags
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 14) continue;
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx <= 1 || tx >= GRID_W - 1 || ty <= 1 || ty >= GRID_H - 1) continue;
        if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 1) continue;
        const idx = ty * GRID_W + tx;
        if (this.prop[idx] !== PropType.CHECKOUT_FLAG) {
          if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
            this.prop[idx] = PropType.NONE;
            this.propOwner[idx] = -1;
          }
          this.territory[idx] = nid;
        }
      }
    }

    this.placeNationProp(cx, cy, PropType.CHECKOUT_FLAG, 350, nid);
    this.territory[cy * GRID_W + cx] = nid;
    this.placeNationProp(cx + 2, cy, PropType.SPOTLIGHT, 150, nid);
    this.placeNationProp(cx - 2, cy, PropType.BISTRO, 130, nid);

    const leader = this.spawnSurvivor(nid, SurvivorRole.LEADER, cx + 0.5, cy + 1);
    const starterCycle: SurvivorRole[] = [
      SurvivorRole.SCAVENGER,
      SurvivorRole.BUILDER,
      SurvivorRole.SCAVENGER,
      SurvivorRole.CHEF,
      SurvivorRole.TINKER,
      SurvivorRole.GUARD,
      SurvivorRole.BUILDER,
      SurvivorRole.GUARD,
      SurvivorRole.TRADER,
    ];
    for (let i = 1; i < popCount; i++) {
      const role = starterCycle[(i - 1) % starterCycle.length];
      this.spawnSurvivor(
        nid,
        role,
        cx + (Math.random() - 0.5) * 4,
        cy + (Math.random() - 0.5) * 4
      );
    }

    const nation: Nation = {
      id: nid,
      name: cleanName,
      color: config.color,
      borderColor: config.borderColor,
      capitalX: cx,
      capitalY: cy,
      meatballs: 45,
      scrap: 45,
      allenWrenches: 25,
      techTier: 1,
      population: popCount,
      housingCap: 20,
      territoryTiles: 45,
      ideology: config.ideology,
      government: config.government,
      taxRate: 'Normal',
      happiness: 84,
      lowHappinessTimer: 0,
      warExhaustion: 0,
      threatScore: 0,
      overlordId: null,
      vassalIds: [],
      loyalty: 100,
      leader: {
        unitId: leader.id,
        name: leader.name,
        age: leader.age,
        traits: leader.traits,
        alive: true,
        crownedDay: this.day,
        kills: 0,
      },
      recentCoupDay: -10,
      isRebel: false,
      lastQuote: `Long live ${cleanName}! Claim the nearest showroom!`,
      relations: {},
      alive: true,
      foundedDay: this.day,
      sabotageCooldown: 8,
      cartCooldown: 6,
      customBuildingPattern: config.buildingPattern,
      buildingPattern: config.buildingPattern,
      researchedTechs: [],
      activeResearchId: null,
      researchPoints: 0,
      researchRate: 0,
    };

    this.nations.push(nation);
    for (const o of this.nations) {
      if (o.id !== nid) {
        this.setRelation(nid, o.id, 'NEUTRAL');
      }
    }

    this.dirtyMap = true;
    this.dirtyLight = true;
    this.recountTerritoryAndHousing();
    this.addNews('GOD', `A new kingdom arose: ${cleanName} (${config.government})!`);
    this.addChronicle(
      'FOUNDING',
      `${cleanName} Founded`,
      `Established on Day ${this.day} under ${nation.leader.name} (${config.government}, ${config.buildingPattern}).`,
      config.color
    );
    this.spawnFloatingText(cx + 0.5, cy - 1.5, `${cleanName.toUpperCase()}!`, config.color);
    this.spawnParticleBurst(cx + 0.5, cy + 0.5, config.color, 16);
    soundFX.playPower();
    return { ok: true, nation };
  }

  public addNews(category: NewsCategory, text: string): void {
    const colorMap: Record<NewsCategory, string> = {
      WAR: '#f87171',
      PEACE: '#4ade80',
      TRADE: '#38bdf8',
      POLITICS: '#c084fc',
      STAFF: '#fbbf24',
      COLONY: '#34d399',
      DIPLOMACY: '#93c5fd',
      GOD: '#f472b6',
      GROWTH: '#4ade80',
      FOUNDING: '#ffda1a',
      CONQUEST: '#fb7185',
      UNION: '#fbbf24',
    };
    this.news.unshift({
      id: this.nextNewsId++,
      day: this.day,
      category,
      text,
      color: colorMap[category],
    });
    if (this.news.length > 60) {
      this.news.length = 60;
    }
  }

  public getNation(id: number): Nation | undefined {
    if (id < 0 || id >= this.nations.length) return undefined;
    return this.nations[id];
  }

  public getTopOverlordId(nationId: number): number {
    let cur = nationId;
    let safety = 0;
    while (safety < 6) {
      const n = this.getNation(cur);
      if (!n || n.overlordId === null) return cur;
      cur = n.overlordId;
      safety++;
    }
    return nationId;
  }

  public getStance(n1: number, n2: number): DiplomaticStance {
    if (n1 < 0 || n2 < 0 || n1 === n2) return 'NEUTRAL';
    const a = this.getNation(n1);
    if (!a) return 'NEUTRAL';
    return a.relations[n2]?.stance || 'NEUTRAL';
  }

  public areFriendly(n1: number, n2: number): boolean {
    if (n1 < 0 || n2 < 0) return false;
    if (n1 === n2) return true;
    const o1 = this.getTopOverlordId(n1);
    const o2 = this.getTopOverlordId(n2);
    if (o1 === o2) return true;
    const st = this.getStance(n1, n2);
    return st === 'ALLIANCE' || st === 'UNION' || st === 'TRADE_PACT' || st === 'COALITION';
  }

  public areHostile(n1: number, n2: number): boolean {
    if (n1 < 0 || n2 < 0 || n1 === n2) return false;
    const o1 = this.getTopOverlordId(n1);
    const o2 = this.getTopOverlordId(n2);
    if (o1 === o2) return false;
    return this.getStance(n1, n2) === 'WAR' || this.getStance(o1, o2) === 'WAR';
  }

  public setRelation(aId: number, bId: number, stance: DiplomaticStance, truceDays = 0): void {
    const a = this.getNation(aId);
    const b = this.getNation(bId);
    if (!a || !b || aId === bId) return;
    if (!a.relations[bId]) {
      a.relations[bId] = { stance: 'NEUTRAL', truceUntilDay: 0, warExhaustion: 0, tradeVolume: 0 };
    }
    if (!b.relations[aId]) {
      b.relations[aId] = { stance: 'NEUTRAL', truceUntilDay: 0, warExhaustion: 0, tradeVolume: 0 };
    }
    a.relations[bId].stance = stance;
    b.relations[aId].stance = stance;
    if (stance === 'PEACE_TREATY' as unknown as DiplomaticStance || stance === 'TRUCE') {
      a.relations[bId].stance = 'TRUCE';
      b.relations[aId].stance = 'TRUCE';
    }
    if (truceDays > 0) {
      a.relations[bId].truceUntilDay = this.day + truceDays;
      b.relations[aId].truceUntilDay = this.day + truceDays;
      a.relations[bId].warExhaustion = 0;
      b.relations[aId].warExhaustion = 0;
    }
  }

  public applyDiplomaticAction(action: GeminiDiplomaticAction): void {
    const actor = this.getNation(action.actorNationId);
    if (!actor || !actor.alive) return;
    const target =
      action.targetNationId !== undefined ? this.getNation(action.targetNationId) : undefined;

    if (action.quote) {
      actor.lastQuote = action.quote;
      this.spawnFloatingText(actor.capitalX, actor.capitalY - 2, `"${action.quote.slice(0, 34)}"`, actor.color);
    }

    switch (action.type) {
      case 'DECLARE_WAR':
        if (target && target.alive && target.id !== actor.id) {
          const alreadyWar = this.getStance(actor.id, target.id) === 'WAR';
          this.setRelation(actor.id, target.id, 'WAR');
          actor.threatScore += 8;
          this.addNews('WAR', `${actor.name} declared WAR on ${target.name}! "${action.quote}"`);
          if (!alreadyWar) {
            this.records.totalWarsDeclared += 1;
            this.addChronicle(
              'WAR',
              `${actor.name} Declared War on ${target.name}`,
              action.quote || 'Aisle dispute escalated into open conflict.',
              '#f87171'
            );
            // Union mutual defense: Union partners join the defender automatically
            for (const ally of this.nations) {
              if (!ally.alive || ally.id === actor.id || ally.id === target.id) continue;
              if (this.getStance(ally.id, target.id) === 'UNION' && this.getStance(ally.id, actor.id) !== 'WAR') {
                this.setRelation(ally.id, actor.id, 'WAR');
                this.addNews('UNION', `Union Defense Pact: ${ally.name} entered the war to defend ${target.name}!`);
              }
            }
          }
        }
        break;
      case 'PEACE_TREATY':
        if (target && target.alive && target.id !== actor.id) {
          const wasWar = this.getStance(actor.id, target.id) === 'WAR';
          this.setRelation(actor.id, target.id, 'TRUCE', 1);
          actor.warExhaustion = Math.max(0, actor.warExhaustion - 25);
          target.warExhaustion = Math.max(0, target.warExhaustion - 25);
          this.addNews('PEACE', `${actor.name} & ${target.name} signed a 1-day Truce. "${action.quote}"`);
          if (wasWar) {
            this.records.totalPeaceTreaties += 1;
            this.addChronicle(
              'PEACE',
              `Truce: ${actor.name} & ${target.name}`,
              action.quote || 'Hostilities paused under a formal showroom truce.',
              '#4ade80'
            );
          }
        }
        break;
      case 'TRADE_PACT':
        if (target && target.alive && target.id !== actor.id) {
          this.setRelation(actor.id, target.id, 'TRADE_PACT');
          this.addNews('TRADE', `${actor.name} & ${target.name} signed a Shopping Cart Trade Pact!`);
        }
        break;
      case 'FORM_ALLIANCE':
        if (target && target.alive && target.id !== actor.id) {
          this.setRelation(actor.id, target.id, 'ALLIANCE');
          this.addNews('DIPLOMACY', `${actor.name} & ${target.name} forged a Grand Alliance!`);
        }
        break;
      case 'FORM_UNION':
        if (target && target.alive && target.id !== actor.id) {
          this.setRelation(actor.id, target.id, 'UNION');
          actor.happiness = Math.min(100, actor.happiness + 5);
          target.happiness = Math.min(100, target.happiness + 5);
          this.connectUnionLandsAndCorridor(actor, target, false);
          this.recountTerritoryAndHousing();
          this.addNews('UNION', `UNION PACT: ${actor.name} & ${target.name} linked roads & walls for Mutual Trade & Defense!`);
          this.spawnFloatingText(actor.capitalX, actor.capitalY - 2, 'UNION CORRIDOR!', '#fbbf24');
        }
        break;
      case 'UNITE_KINGDOMS':
        if (target && target.alive && target.id !== actor.id) {
          const actorScore = actor.population * 5 + actor.territoryTiles;
          const targetScore = target.population * 5 + target.territoryTiles;
          const primary = actorScore >= targetScore ? actor : target;
          const secondary = primary.id === actor.id ? target : actor;
          this.uniteKingdoms(primary.id, secondary.id);
        }
        break;
      case 'EMBARGO':
        if (target && target.alive && target.id !== actor.id) {
          this.setRelation(actor.id, target.id, 'EMBARGO');
          this.addNews('TRADE', `${actor.name} imposed a Shopping Cart Embargo on ${target.name}!`);
        }
        break;
      case 'DEMAND_TRIBUTE':
        if (target && target.alive && target.id !== actor.id) {
          const mb = Math.min(target.meatballs * 0.25, 25);
          const wr = Math.min(target.allenWrenches * 0.25, 15);
          target.meatballs -= mb;
          target.allenWrenches -= wr;
          actor.meatballs += mb;
          actor.allenWrenches += wr;
          this.addNews('DIPLOMACY', `${actor.name} extracted ${Math.round(mb)} Meatballs & ${Math.round(wr)} Wrenches from ${target.name}.`);
        }
        break;
      case 'VASSALIZE':
        if (target && target.alive && target.id !== actor.id && target.overlordId === null) {
          this.makeVassal(actor, target);
        }
        break;
      case 'COALITION':
        if (target && target.alive && target.id !== actor.id) {
          const allies = this.nations.filter(
            (n) => n.alive && n.id !== target.id && n.overlordId !== target.id
          );
          for (let i = 0; i < allies.length; i++) {
            for (let j = i + 1; j < allies.length; j++) {
              if (this.getStance(allies[i].id, allies[j].id) !== 'WAR') {
                this.setRelation(allies[i].id, allies[j].id, 'COALITION');
              }
            }
            if (allies[i].id !== actor.id && Math.random() < 0.65) {
              this.setRelation(allies[i].id, target.id, 'EMBARGO');
            }
          }
          this.addNews('DIPLOMACY', `Defensive Coalition formed to contain ${target.name}! "${action.quote}"`);
        }
        break;
      case 'REFORM_GOV':
        if (action.newGovernment && GOVERNMENTS.includes(action.newGovernment)) {
          actor.government = action.newGovernment;
          this.addNews('POLITICS', `${actor.name} reformed into a ${action.newGovernment}!`);
        }
        break;
    }
  }

  private makeVassal(overlord: Nation, vassal: Nation): void {
    if (vassal.id === overlord.id) return;
    vassal.overlordId = overlord.id;
    vassal.loyalty = 75;
    if (!overlord.vassalIds.includes(vassal.id)) {
      overlord.vassalIds.push(vassal.id);
    }
    this.setRelation(overlord.id, vassal.id, 'ALLIANCE');
    overlord.threatScore += 14;
    this.dirtyMap = true;
    this.addNews('POLITICS', `${vassal.name} became a Vassal State under ${overlord.name}!`);
  }

  private formatUnionName(primary: Nation, secondary: Nation): string {
    const cleanRoot = (name: string) =>
      name
        .replace(/^United\s+/i, '')
        .replace(/\s+(Union|Commonwealth|Federation|Republic|Imperium|Syndicate|Cartel|Pact|League|Guard|Freeholds|Crown|Duchy|Sovereignty|Freehold|Free State)$/i, '')
        .trim();
    const aRoot = cleanRoot(primary.name).split(/\s+/)[0] || primary.name;
    const bRoot = cleanRoot(secondary.name).split(/\s+/)[0] || secondary.name;
    if (primary.isUnion) {
      return `Grand ${aRoot} Union`;
    }
    if (aRoot.toLowerCase() === bRoot.toLowerCase()) {
      return `United ${aRoot} Union`;
    }
    return `${aRoot}–${bRoot} Union`.slice(0, 28);
  }

  private connectUnionLandsAndCorridor(a: Nation, b: Nation, isMergedUnion: boolean): void {
    const ax = a.capitalX + 0.5;
    const ay = a.capitalY + 0.5;
    const bx = b.capitalX + 0.5;
    const by = b.capitalY + 0.5;
    const dx = bx - ax;
    const dy = by - ay;
    const totalDist = Math.hypot(dx, dy);
    if (totalDist < 2) return;

    // Route around neutral Summit Lounge if the straight corridor would cut through it
    const waypoints: Array<{ x: number; y: number }> = [{ x: ax, y: ay }];
    const ux = dx / totalDist;
    const uy = dy / totalDist;
    const sx = SUMMIT_X + 0.5 - ax;
    const sy = SUMMIT_Y + 0.5 - ay;
    const proj = sx * ux + sy * uy;
    if (proj > 0 && proj < totalDist) {
      const closestX = ax + ux * proj;
      const closestY = ay + uy * proj;
      const dSummit = Math.hypot(closestX - (SUMMIT_X + 0.5), closestY - (SUMMIT_Y + 0.5));
      if (dSummit <= SUMMIT_RADIUS + 4.5) {
        const px = -uy;
        const py = ux;
        const sideSign = (closestX - (SUMMIT_X + 0.5)) * px + (closestY - (SUMMIT_Y + 0.5)) * py >= 0 ? 1 : -1;
        const detour = SUMMIT_RADIUS + 5.5;
        waypoints.push({
          x: Math.max(8, Math.min(GRID_W - 8, SUMMIT_X + 0.5 + px * sideSign * detour)),
          y: Math.max(8, Math.min(GRID_H - 8, SUMMIT_Y + 0.5 + py * sideSign * detour)),
        });
      }
    }
    waypoints.push({ x: bx, y: by });

    let globalStep = 0;
    const totalSegments = waypoints.length - 1;

    for (let seg = 0; seg < totalSegments; seg++) {
      const p0 = waypoints[seg];
      const p1 = waypoints[seg + 1];
      const sdx = p1.x - p0.x;
      const sdy = p1.y - p0.y;
      const segLen = Math.hypot(sdx, sdy);
      if (segLen < 0.5) continue;

      const dirX = sdx / segLen;
      const dirY = sdy / segLen;
      const perpX = -dirY;
      const perpY = dirX;
      const steps = Math.max(2, Math.ceil(segLen * 2));

      for (let s = 0; s <= steps; s++) {
        const tLocal = s / steps;
        const tGlobal = (seg + tLocal) / totalSegments;
        const cx = p0.x + sdx * tLocal;
        const cy = p0.y + sdy * tLocal;
        const segmentOwnerId = isMergedUnion || tGlobal < 0.5 ? a.id : b.id;

        for (let off = -3; off <= 3; off += 0.5) {
          const tx = Math.max(2, Math.min(GRID_W - 3, Math.round(cx + perpX * off)));
          const ty = Math.max(2, Math.min(GRID_H - 3, Math.round(cy + perpY * off)));
          if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 1.5) continue;

          const idx = ty * GRID_W + tx;
          const curOwner = this.territory[idx];
          const canClaim =
            curOwner === -1 ||
            curOwner === a.id ||
            curOwner === b.id ||
            (curOwner >= 0 && !this.nations[curOwner]?.alive);

          if (!canClaim) continue;

          const tileOwner =
            curOwner === a.id || curOwner === b.id
              ? isMergedUnion
                ? a.id
                : curOwner
              : segmentOwnerId;

          if (curOwner !== tileOwner) {
            if (curOwner >= 0 && this.prop[idx] === PropType.CHECKOUT_FLAG) {
              this.prop[idx] = PropType.SPOTLIGHT;
              this.propHp[idx] = 160;
              this.propMaxHp[idx] = 160;
            }
            this.territory[idx] = tileOwner;
          }

          const absOff = Math.abs(off);
          const curProp = this.prop[idx];
          const nearA = Math.hypot(tx - a.capitalX, ty - a.capitalY) < 4.5;
          const nearB = Math.hypot(tx - b.capitalX, ty - b.capitalY) < 4.5;

          if (absOff <= 1.15) {
            // Open central trade avenue: convert intersecting walls into gates & clear blocking furniture
            if (curProp !== PropType.CHECKOUT_FLAG && this.biome[idx] !== BiomeType.FOOD_COURT) {
              this.biome[idx] = BiomeType.WALKWAY;
            }
            if (
              curProp === PropType.BARRICADE_WALL &&
              (this.propOwner[idx] === a.id || this.propOwner[idx] === b.id || this.propOwner[idx] === -1)
            ) {
              this.placeNationProp(tx, ty, PropType.BARRICADE_GATE, 150, tileOwner, 0);
            } else if (curProp !== PropType.NONE && this.isDismantlableIkeaProp(curProp)) {
              this.prop[idx] = PropType.NONE;
              this.propHp[idx] = 0;
              this.propOwner[idx] = -1;
            }
          } else if (absOff >= 2.25 && absOff <= 2.95 && !nearA && !nearB) {
            // Connect fortified walls along both edges of the corridor, linking to each city's walls
            if (curProp === PropType.NONE || this.isDismantlableIkeaProp(curProp)) {
              const isSideGate = globalStep % 18 === 0;
              const isLight = !isSideGate && globalStep % 18 === 9;
              if (isLight) {
                this.placeNationProp(tx, ty, PropType.SPOTLIGHT, 150, tileOwner, 0);
              } else {
                this.placeNationProp(
                  tx,
                  ty,
                  isSideGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL,
                  150,
                  tileOwner,
                  1 + ((tx + ty) % 4)
                );
              }
            }
          }
        }
        globalStep++;
      }
    }

    this.dirtyMap = true;
    this.dirtyLight = true;

    // Immediately launch trade carts along the newly connected corridor
    if (isMergedUnion) {
      this.spawnTradeCart(a, a, { x: b.capitalX + 0.5, y: b.capitalY + 0.5, label: b.name });
    } else {
      this.spawnTradeCart(a, b);
      this.spawnTradeCart(b, a);
    }
  }

  public uniteKingdoms(primaryId: number, secondaryId: number, customReason?: string): boolean {
    const primary = this.getNation(primaryId);
    const secondary = this.getNation(secondaryId);
    if (!primary || !secondary || !primary.alive || !secondary.alive || primary.id === secondary.id) {
      return false;
    }

    const oldPrimaryName = primary.name;
    const oldSecondaryName = secondary.name;
    const unionName = this.formatUnionName(primary, secondary);

    let transferredTiles = 0;
    for (let i = 0; i < this.territory.length; i++) {
      if (this.territory[i] === secondary.id) {
        this.territory[i] = primary.id;
        transferredTiles++;
      }
      if (this.propOwner[i] === secondary.id) {
        this.propOwner[i] = primary.id;
      }
    }

    // Convert secondary's Checkout Flag into a lit Spotlight owned by the Union
    const secCapIdx = secondary.capitalY * GRID_W + secondary.capitalX;
    if (this.prop[secCapIdx] === PropType.CHECKOUT_FLAG) {
      this.prop[secCapIdx] = PropType.SPOTLIGHT;
      this.propHp[secCapIdx] = 180;
      this.propMaxHp[secCapIdx] = 180;
      this.propOwner[secCapIdx] = primary.id;
    }

    // Transfer all living units; promote former secondary leader into a Union Marshal
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.nationId === secondary.id) {
        u.nationId = primary.id;
        u.originNationId = primary.id;
        if (u.role === SurvivorRole.LEADER) {
          this.applyRoleStats(u, primary, SurvivorRole.GUARD);
          if (!u.veteranTitle) {
            u.veteranTitle = 'Union Co-Founder';
            u.maxHp += 25;
            u.hp = Math.min(u.maxHp, u.hp + 25);
            u.atk += 3;
          }
          u.hasTarget = false;
        }
      } else if (u.kind === UnitKind.CART_RUNNER && u.targetNationId === secondary.id) {
        if (u.originNationId === primary.id) {
          u.alive = false;
        } else {
          u.targetNationId = primary.id;
          u.targetX = primary.capitalX + 0.5;
          u.targetY = primary.capitalY + 0.5;
        }
      }
    }

    // Detach or transfer vassal relationships cleanly
    if (secondary.overlordId !== null) {
      const ov = this.getNation(secondary.overlordId);
      if (ov) ov.vassalIds = ov.vassalIds.filter((id) => id !== secondary.id);
      secondary.overlordId = null;
    }
    primary.vassalIds = primary.vassalIds.filter((id) => id !== secondary.id);
    for (const vid of secondary.vassalIds) {
      const v = this.getNation(vid);
      if (v && v.alive && v.id !== primary.id) {
        v.overlordId = primary.id;
        if (!primary.vassalIds.includes(v.id)) primary.vassalIds.push(v.id);
      }
    }
    secondary.vassalIds = [];

    // Clear secondary wars/relations
    for (const other of this.nations) {
      if (other.id !== secondary.id && other.relations[secondary.id]?.stance === 'WAR') {
        this.setRelation(secondary.id, other.id, 'NEUTRAL');
      }
    }
    this.setRelation(primary.id, secondary.id, 'NEUTRAL');

    // Merge treasuries, tech tiers & researched techs
    primary.meatballs += Math.round(secondary.meatballs);
    primary.scrap += Math.round(secondary.scrap);
    primary.allenWrenches += Math.round(secondary.allenWrenches);
    primary.techTier = Math.max(primary.techTier, secondary.techTier) as 1 | 2 | 3 | 4;
    primary.happiness = Math.min(100, Math.max(primary.happiness, 74) + 8);
    primary.warExhaustion = Math.max(0, primary.warExhaustion - 20);

    const existingTechs = new Set(primary.researchedTechs || []);
    for (const techId of secondary.researchedTechs || []) {
      if (!existingTechs.has(techId)) {
        existingTechs.add(techId);
        if (!primary.researchedTechs) primary.researchedTechs = [];
        primary.researchedTechs.push(techId);
        if (techId === 'allen_spears') {
          for (const u of this.units) {
            if (u.alive && u.nationId === primary.id && u.kind === UnitKind.SURVIVOR) {
              this.applyRoleStats(u, primary, u.role);
            }
          }
        }
      }
    }

    const members = new Set<string>([
      ...(primary.unionMembers || [oldPrimaryName]),
      ...(secondary.unionMembers || [oldSecondaryName]),
    ]);
    primary.isUnion = true;
    primary.unionMembers = Array.from(members);
    const hubs = [...(primary.unionHubs || [])];
    hubs.push({ x: secondary.capitalX, y: secondary.capitalY, name: oldSecondaryName });
    for (const sh of secondary.unionHubs || []) {
      if (!hubs.some((h) => Math.hypot(h.x - sh.x, h.y - sh.y) < 5)) {
        hubs.push({ ...sh });
      }
    }
    primary.unionHubs = hubs.slice(0, 6);
    primary.name = unionName;
    primary.lastQuote = `By united banner, ${oldPrimaryName} and ${oldSecondaryName} now stand as ${unionName}!`;

    // Mark secondary cleanly as UNITED
    secondary.alive = false;
    secondary.population = 0;
    secondary.territoryTiles = 0;
    secondary.armyCount = 0;
    secondary.armyCap = 0;
    secondary.reproductionRate = 0;
    secondary.reproductionProgress = 0;
    secondary.leader.alive = false;
    secondary.battlePlan = undefined;
    secondary.defeatedStatus = 'UNITED';
    secondary.defeatedDay = this.day;
    secondary.unitedIntoNationId = primary.id;
    secondary.unitedIntoName = unionName;
    secondary.meatballs = 0;
    secondary.scrap = 0;
    secondary.allenWrenches = 0;

    // Connect both realms with a paved fortified corridor, linked walls, and union supply carts
    this.connectUnionLandsAndCorridor(primary, secondary, true);

    this.dirtyMap = true;
    this.dirtyLight = true;
    this.forceMapRebuild = true;
    this.forceLightRebuild = true;
    this.recountTerritoryAndHousing();

    this.spawnParticleBurst(primary.capitalX + 0.5, primary.capitalY + 0.5, '#fbbf24', 16);
    this.spawnParticleBurst(secondary.capitalX + 0.5, secondary.capitalY + 0.5, primary.color, 16);
    this.spawnFloatingText(primary.capitalX + 0.5, primary.capitalY - 2, 'GRAND UNION!', '#fbbf24');
    this.spawnFloatingText(secondary.capitalX + 0.5, secondary.capitalY - 2, `JOINED ${unionName.toUpperCase()}!`, '#fbbf24');

    const newsMsg =
      customReason ||
      `GRAND UNION: ${oldPrimaryName} & ${oldSecondaryName} united into ${unionName} (+${transferredTiles} tiles)!`;
    this.addNews('UNION', newsMsg);
    this.addChronicle(
      'UNION',
      `${unionName} Formed`,
      `${oldPrimaryName} and ${oldSecondaryName} merged their kingdoms on Day ${this.day}.`,
      '#fbbf24'
    );
    soundFX.playPower();
    return true;
  }

  // ==================== LIGHT MAP & OFF-SCREEN MAP CACHE ====================

  public recomputeLightMap(): void {
    this.lightMap.fill(0);
    if (this.lightSourceIndices.length === 0) {
      for (let i = 0; i < this.prop.length; i++) {
        const p = this.prop[i];
        if (p === PropType.SPOTLIGHT || p === PropType.WATCHTOWER || p === PropType.CHECKOUT_FLAG) {
          this.lightSourceIndices.push(i);
        }
      }
    }
    for (let li = 0; li < this.lightSourceIndices.length; li++) {
      const idx = this.lightSourceIndices[li];
      const p = this.prop[idx];
      if (
        p !== PropType.SPOTLIGHT &&
        p !== PropType.WATCHTOWER &&
        p !== PropType.CHECKOUT_FLAG
      ) {
        continue;
      }
      if (this.disabledLightMap[idx] > 0) continue;

      const x = idx % GRID_W;
      const y = (idx / GRID_W) | 0;
      const owner = this.propOwner[idx];
      const nation = owner >= 0 ? this.getNation(owner) : undefined;
      const tierBonus = nation ? (nation.techTier - 1) * 1.5 : 0;
      const floodBonus = hasTech(nation, 'halogen_floodlights') ? 3 : 0;
      const rad =
        (p === PropType.SPOTLIGHT
          ? SPOTLIGHT_RADIUS + tierBonus
          : p === PropType.CHECKOUT_FLAG
            ? FLAG_LIGHT_RADIUS + tierBonus
            : WATCHTOWER_RADIUS) + floodBonus;

      const rCeil = Math.ceil(rad);
      const rSq = rad * rad;
      const minY = Math.max(0, y - rCeil);
      const maxY = Math.min(GRID_H - 1, y + rCeil);
      const minX = Math.max(0, x - rCeil);
      const maxX = Math.min(GRID_W - 1, x + rCeil);

      for (let ly = minY; ly <= maxY; ly++) {
        const dy = ly - y;
        const dySq = dy * dy;
        const lRow = ly * GRID_W;
        for (let lx = minX; lx <= maxX; lx++) {
          const dx = lx - x;
          if (dx * dx + dySq <= rSq) {
            this.lightMap[lRow + lx] = 1;
          }
        }
      }
    }
    this.dirtyLight = false;
    this.forceLightRebuild = false;
    this.lastLightRebuildMs = performance.now();
  }

  public rebuildMapCache(): void {
    const data = this.mapImageData.data;
    const mmData = this.minimapImageData.data;

    // Precompute nation & overlord RGBs
    const nationRgb: Array<[number, number, number]> = [];
    const borderRgb: Array<[number, number, number]> = [];
    for (let i = 0; i < this.nations.length; i++) {
      const n = this.nations[i];
      nationRgb[i] = hexToRgb(n.color);
      const overlordId = this.getTopOverlordId(i);
      const overlord = this.nations[overlordId] || n;
      borderRgb[i] = hexToRgb(overlord.borderColor);
    }

    for (let ty = 0; ty < GRID_H; ty++) {
      const tRow = ty * GRID_W;
      for (let tx = 0; tx < GRID_W; tx++) {
        const idx = tRow + tx;
        const b = this.biome[idx];
        const base = BIOME_RGB[b] || BIOME_RGB[BiomeType.WALKWAY];
        let r = base[0];
        let g = base[1];
        let bl = base[2];

        // Subtle pixel floor tile variation
        const checker = (tx + ty) & 1;
        if (b === BiomeType.FOOD_COURT) {
          if ((tx % 2 === 0 && ty % 2 === 0) || (tx % 2 === 1 && ty % 2 === 1)) {
            r = 59;
            g = 130;
            bl = 246;
          } else {
            r = 250;
            g = 204;
            bl = 21;
          }
        } else if (b === BiomeType.SHOWROOM) {
          const delta = checker ? 6 : -6;
          r = Math.min(255, Math.max(0, r + delta));
          g = Math.min(255, Math.max(0, g + delta));
          bl = Math.min(255, Math.max(0, bl + delta));
        } else if (b === BiomeType.WAREHOUSE) {
          const delta = (tx % 4 === 0 || ty % 4 === 0) ? -10 : 4;
          r += delta;
          g += delta;
          bl += delta;
        } else if (b === BiomeType.WALKWAY) {
          // Iconic yellow walkway line along center
          if ((tx % 30 === 1 && ty % 2 === 0) || (ty % 30 === 1 && tx % 2 === 0)) {
            r = 250;
            g = 204;
            bl = 21;
          }
        }

        const owner = this.territory[idx];
        let isBorder = false;
        let bColor: [number, number, number] | null = null;

        if (owner >= 0 && owner < nationRgb.length) {
          const ownerNation = this.nations[owner];
          const nc = nationRgb[owner];
          if (ownerNation && !ownerNation.alive) {
            // Desaturated muted ruins tint for Defeated / Depopulated empty territory
            const gray = ((nc[0] + nc[1] + nc[2]) / 3) | 0;
            const mutedR = (nc[0] * 0.4 + gray * 0.6) | 0;
            const mutedG = (nc[1] * 0.4 + gray * 0.6) | 0;
            const mutedB = (nc[2] * 0.4 + gray * 0.6) | 0;
            r = (r * 0.82 + mutedR * 0.18) | 0;
            g = (g * 0.82 + mutedG * 0.18) | 0;
            bl = (bl * 0.82 + mutedB * 0.18) | 0;
          } else {
            // Semi-transparent colored territory blend (35%)
            r = (r * 0.65 + nc[0] * 0.35) | 0;
            g = (g * 0.65 + nc[1] * 0.35) | 0;
            bl = (bl * 0.65 + nc[2] * 0.35) | 0;
          }

          const top = ty > 0 ? this.territory[idx - GRID_W] : -2;
          const bot = ty < GRID_H - 1 ? this.territory[idx + GRID_W] : -2;
          const lft = tx > 0 ? this.territory[idx - 1] : -2;
          const rgt = tx < GRID_W - 1 ? this.territory[idx + 1] : -2;
          if (top !== owner || bot !== owner || lft !== owner || rgt !== owner) {
            isBorder = true;
            if (ownerNation && !ownerNation.alive) {
              bColor = [100, 116, 139];
            } else {
              bColor = borderRgb[owner];
            }
          }
        }

        // Write minimap pixel
        const mmIdx = idx * 4;
        if (isBorder && bColor) {
          mmData[mmIdx] = bColor[0];
          mmData[mmIdx + 1] = bColor[1];
          mmData[mmIdx + 2] = bColor[2];
        } else {
          mmData[mmIdx] = r;
          mmData[mmIdx + 1] = g;
          mmData[mmIdx + 2] = bl;
        }
        mmData[mmIdx + 3] = 255;

        // Write TILE_SIZE x TILE_SIZE block to offscreen map ImageData
        const topDiff = isBorder && (ty > 0 ? this.territory[idx - GRID_W] !== owner : true);
        const botDiff = isBorder && (ty < GRID_H - 1 ? this.territory[idx + GRID_W] !== owner : true);
        const lftDiff = isBorder && (tx > 0 ? this.territory[idx - 1] !== owner : true);
        const rgtDiff = isBorder && (tx < GRID_W - 1 ? this.territory[idx + 1] !== owner : true);

        const pyStart = ty * TILE_SIZE;
        const pxStart = tx * TILE_SIZE;
        for (let py = 0; py < TILE_SIZE; py++) {
          const rowOff = (pyStart + py) * WORLD_PX_W;
          for (let px = 0; px < TILE_SIZE; px++) {
            const pIdx = (rowOff + pxStart + px) * 4;
            if (
              isBorder &&
              bColor &&
              ((topDiff && py < 2) ||
                (botDiff && py >= TILE_SIZE - 2) ||
                (lftDiff && px < 2) ||
                (rgtDiff && px >= TILE_SIZE - 2))
            ) {
              // Crisp dark outer border (Vassals match Overlord outline)
              data[pIdx] = (bColor[0] * 0.72) | 0;
              data[pIdx + 1] = (bColor[1] * 0.72) | 0;
              data[pIdx + 2] = (bColor[2] * 0.72) | 0;
            } else {
              data[pIdx] = r;
              data[pIdx + 1] = g;
              data[pIdx + 2] = bl;
            }
            data[pIdx + 3] = 255;
          }
        }
      }
    }

    this.mapCtx.putImageData(this.mapImageData, 0, 0);
    this.minimapCtx.putImageData(this.minimapImageData, 0, 0);
    this.dirtyMap = false;
    this.forceMapRebuild = false;
    this.lastMapRebuildMs = performance.now();
  }

  // ==================== SIMULATION STEP (FIXED TIMESTEP) ====================

  public step(dt: number): void {
    this.simTime += dt;

    // 1. Day/Night Cycle (35s Day / 25s Night)
    const prevNight = this.isNight;
    this.cycleTimer += dt;
    if (this.cycleTimer >= CYCLE_DURATION) {
      this.cycleTimer -= CYCLE_DURATION;
      this.day++;
      this.onNewDay();
    }
    this.isNight = this.cycleTimer >= DAY_DURATION;
    soundFX.setPhase(this.isNight, this.paused);
    if (!prevNight && this.isNight) {
      if (!this.summitLoungeSessionActive) {
        this.summitActiveTimer = 0;
        this.summitDiscussed = false;
      }
      soundFX.playAlert(true);
      if (this.day % 10 === 0) {
        this.triggerAuditNight();
      } else {
        this.addNews('STAFF', `Night ${this.day}: "The store is now closed. Please exit the building."`);
      }
    } else if (prevNight && !this.isNight) {
      soundFX.playAlert(false);
      if (this.day - 1 > 0 && (this.day - 1) % 10 === 0) {
        this.records.auditNightsSurvived += 1;
      }
      if (this.day % 2 === 1) {
        this.restockIkeaStore();
      }
    }

    if (this.summitSpeakingTimer > 0) {
      this.summitSpeakingTimer = Math.max(0, this.summitSpeakingTimer - dt);
      if (this.summitSpeakingTimer === 0) {
        this.summitSpeakingNationId = null;
      }
    }

    // Mid-day peaceful Kings Summit inside the safe Neutral Showroom Lounge
    if (!this.isNight && this.cycleTimer >= 14 && this.lastAutoSummitDay < this.day) {
      this.lastAutoSummitDay = this.day;
      this.startKingSummit();
    }
    if (this.summitActiveTimer > 0) {
      this.summitActiveTimer = Math.max(0, this.summitActiveTimer - dt);
      if (!this.isNight && !this.summitDiscussed) {
        this.tickRoyalSummitDiscussion();
      }
    }

    // 2. Rebuild spatial hash
    this.spatialHash.rebuild(this.units);

    // 3. Periodic timers
    this.economyTimer += dt;
    if (this.economyTimer >= 1.0) {
      this.economyTimer -= 1.0;
      this.tickNationsEconomy();
      this.tickDisabledLights();
    }

    this.vatRegenTimer += dt;
    if (this.vatRegenTimer >= 4.0) {
      this.vatRegenTimer -= 4.0;
      this.regenFoodCourts();
    }

    this.fireTickTimer += dt;
    if (this.fireTickTimer >= 0.4) {
      this.fireTickTimer -= 0.4;
      this.tickFires();
    }

    this.diplomacyTimer += dt;
    if (this.diplomacyTimer >= 14.0) {
      this.diplomacyTimer -= 14.0;
      runHeuristicDiplomacyTurn(this.nations, this.day, (act) => this.applyDiplomaticAction(act));
    }

    this.territoryRebuildTimer += dt;
    if (this.territoryRebuildTimer >= 1.2) {
      this.territoryRebuildTimer -= 1.2;
      this.recountTerritoryAndHousing();
      if (this.dirtyLight) this.recomputeLightMap();
    }

    // 4. Fair Night Staff Spawning (NEVER inside lit spotlight radiuses)
    if (this.isNight) {
      this.staffSpawnTimer += dt;
      const spawnInterval = Math.max(0.55, 2.2 - this.day * 0.14);
      if (this.staffSpawnTimer >= spawnInterval) {
        this.staffSpawnTimer = 0;
        this.spawnNightStaffWave();
      }
    }

    // 4b. Pre-index active builder target tiles for O(1) slot checks
    this.activeBuilderTargets.clear();
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.alive && u.role === SurvivorRole.BUILDER && u.buildProp !== undefined && u.hasTarget) {
        const btx = Math.max(0, Math.min(GRID_W - 1, u.targetX | 0));
        const bty = Math.max(0, Math.min(GRID_H - 1, u.targetY | 0));
        this.activeBuilderTargets.add(bty * GRID_W + btx);
      }
    }

    // 5. Update Units
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.alive) continue;
      this.updateUnit(u, dt);
    }

    // 6. Update Watchtowers & Projectiles
    this.watchtowerTimer += dt;
    if (this.watchtowerTimer >= 0.9) {
      this.watchtowerTimer -= 0.9;
      this.tickWatchtowerTurrets();
    }
    this.updateProjectiles(dt);

    // 7. Update Particles & Floating Text
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const f = this.floatingTexts[i];
      f.y += f.vy * dt;
      f.life -= dt;
      if (f.life <= 0) this.floatingTexts.splice(i, 1);
    }
    for (let i = this.recentBuilds.length - 1; i >= 0; i--) {
      const rb = this.recentBuilds[i];
      rb.life -= dt;
      if (rb.life <= 0) this.recentBuilds.splice(i, 1);
    }

    // 8. Compact dead units deterministically to keep iteration fast
    if (this.deadUnitsCount >= 60 || (this.units.length > 500 && this.deadUnitsCount >= 25)) {
      this.units = this.units.filter((u) => u.alive);
      this.deadUnitsCount = 0;
    }
  }

  private onNewDay(): void {
    for (const n of this.nations) {
      if (!n.alive) continue;
      // Vassal tribute to Overlord
      if (n.overlordId !== null) {
        const overlord = this.getNation(n.overlordId);
        if (overlord && overlord.alive) {
          const mbTrib = Math.min(n.meatballs * 0.18, 15);
          const scTrib = Math.min(n.scrap * 0.18, 15);
          n.meatballs -= mbTrib;
          n.scrap -= scTrib;
          overlord.meatballs += mbTrib;
          overlord.scrap += scTrib;

          // Loyalty check
          if (n.happiness < 40 || overlord.warExhaustion > 60) {
            n.loyalty = Math.max(0, n.loyalty - 15);
          } else {
            n.loyalty = Math.min(100, n.loyalty + 6);
          }
          if (n.loyalty <= 15 && Math.random() < 0.55) {
            // Vassal rebels!
            n.overlordId = null;
            overlord.vassalIds = overlord.vassalIds.filter((id) => id !== n.id);
            this.setRelation(n.id, overlord.id, 'WAR');
            this.dirtyMap = true;
            this.addNews('WAR', `${n.name} rebelled against their Overlord ${overlord.name}!`);
          }
        } else {
          n.overlordId = null;
          this.dirtyMap = true;
        }
      }

      // Leader aging
      if (n.leader.alive) {
        n.leader.age += 1;
      }

      // Decay threat score slightly
      n.threatScore = Math.max(0, n.threatScore - 2);
    }

    if (this.day >= 3 && this.day % 10 !== 0 && this.day % 4 === 0 && Math.random() < 0.72) {
      this.triggerStorewidePAEvent();
    }

    if (this.onDayStartedCallback) {
      this.onDayStartedCallback(this.day);
    }
  }

  private triggerStorewidePAEvent(): void {
    const roll = Math.random();
    if (roll < 0.4) {
      // Event 1: Clearance Restock Rush (drops cluster of vats & pallets in neutral aisles)
      let cx = 20 + ((Math.random() * (GRID_W - 40)) | 0);
      let cy = 20 + ((Math.random() * (GRID_H - 40)) | 0);
      for (let attempt = 0; attempt < 25; attempt++) {
        const tx = 16 + ((Math.random() * (GRID_W - 32)) | 0);
        const ty = 16 + ((Math.random() * (GRID_H - 32)) | 0);
        if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 8) continue;
        if (this.territory[ty * GRID_W + tx] === -1) {
          cx = tx;
          cy = ty;
          break;
        }
      }
      let spawned = 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy > 10 || Math.random() < 0.45) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx <= 2 || nx >= GRID_W - 2 || ny <= 2 || ny >= GRID_H - 2) continue;
          const idx = ny * GRID_W + nx;
          if (this.prop[idx] !== PropType.NONE) continue;
          const isVat = Math.random() < 0.45;
          this.prop[idx] = isVat ? PropType.MEATBALL_VAT : PropType.WOOD_PALLET;
          this.propHp[idx] = isVat ? 120 : 80;
          this.propMaxHp[idx] = isVat ? 120 : 80;
          this.propOwner[idx] = -1;
          spawned++;
        }
      }
      if (spawned > 0) {
        this.recentBuilds.push({ x: cx, y: cy, color: '#ffda1a', life: 3.4, maxLife: 3.4 });
        this.spawnFloatingText(cx + 0.5, cy - 1.5, 'CLEARANCE RESTOCK!', '#ffda1a');
        this.addNews(
          'TRADE',
          `STOREWIDE PA: Clearance Restock Rush dropped fresh Meatball Vats & Wood Pallets near (${cx}, ${cy})!`
        );
      }
    } else if (roll < 0.72) {
      // Event 2: Wanderer Caravan (unclaimed survivors arrive looking to found or settle)
      let sx = 14 + ((Math.random() * (GRID_W - 28)) | 0);
      let sy = 14 + ((Math.random() * (GRID_H - 28)) | 0);
      for (let attempt = 0; attempt < 30; attempt++) {
        const tx = 14 + ((Math.random() * (GRID_W - 28)) | 0);
        const ty = 14 + ((Math.random() * (GRID_H - 28)) | 0);
        if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 8) continue;
        const idx = ty * GRID_W + tx;
        if (this.territory[idx] === -1 && this.prop[idx] === PropType.NONE) {
          sx = tx;
          sy = ty;
          break;
        }
      }
      if (this.territory[sy * GRID_W + sx] === -1) {
        for (let i = 0; i < 3; i++) {
          const role = i === 2 ? SurvivorRole.TRADER : SurvivorRole.SCAVENGER;
          const u = this.spawnSurvivor(
            -1,
            role,
            sx + (Math.random() - 0.5) * 2,
            sy + (Math.random() - 0.5) * 2
          );
          u.canFoundKingdom = true;
          u.settleTimer = 0;
        }
        this.spawnFloatingText(sx + 0.5, sy - 1.5, 'WANDERER CARAVAN!', '#38bdf8');
        this.addNews(
          'COLONY',
          `STOREWIDE PA: A Wanderer Caravan of 3 unclaimed survivors emerged from Sector (${sx}, ${sy})!`
        );
      }
    } else {
      // Event 3: Sector Power Ballast Flicker (temporarily dims a random corner of spotlights)
      const qx = Math.random() < 0.5 ? 0 : GRID_W >> 1;
      const qy = Math.random() < 0.5 ? 0 : GRID_H >> 1;
      let dimmed = 0;
      for (let y = Math.max(2, qy); y < Math.min(GRID_H - 2, qy + (GRID_H >> 1)); y++) {
        const row = y * GRID_W;
        for (let x = Math.max(2, qx); x < Math.min(GRID_W - 2, qx + (GRID_W >> 1)); x++) {
          const idx = row + x;
          if (this.prop[idx] === PropType.SPOTLIGHT && this.disabledLightMap[idx] === 0) {
            if (Math.random() < 0.45 && dimmed < 6) {
              this.disabledLightMap[idx] = 18;
              dimmed++;
            }
          }
        }
      }
      if (dimmed > 0) {
        this.dirtyLight = true;
        this.addNews(
          'STAFF',
          `STOREWIDE PA: Overhead ballast flicker temporarily dimmed ${dimmed} spotlights in the ${qy === 0 ? 'North' : 'South'}-${qx === 0 ? 'West' : 'East'} wing!`
        );
      }
    }
  }

  private tickDisabledLights(): void {
    let changed = false;
    for (let i = 0; i < this.disabledLightMap.length; i++) {
      if (this.disabledLightMap[i] > 0) {
        this.disabledLightMap[i]--;
        if (this.disabledLightMap[i] === 0) changed = true;
      }
    }
    if (changed) this.dirtyLight = true;
  }

  private regenFoodCourts(): void {
    // Regenerate Meatball Vats on Food Court tiles
    for (let y = 2; y < GRID_H - 2; y += 2) {
      const row = y * GRID_W;
      for (let x = 2; x < GRID_W - 2; x += 2) {
        const idx = row + x;
        if (this.biome[idx] === BiomeType.FOOD_COURT && this.prop[idx] === PropType.NONE) {
          if (Math.random() < 0.08) {
            this.prop[idx] = PropType.MEATBALL_VAT;
            this.propHp[idx] = 120;
            this.propMaxHp[idx] = 120;
            this.propOwner[idx] = -1;
          }
        }
      }
    }
  }

  private restockIkeaStore(): void {
    let restocked = 0;
    for (let attempt = 0; attempt < 360 && restocked < 85; attempt++) {
      const tx = 4 + ((Math.random() * (GRID_W - 8)) | 0);
      const ty = 4 + ((Math.random() * (GRID_H - 8)) | 0);
      if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 3) continue;
      const idx = ty * GRID_W + tx;
      if (this.territory[idx] !== -1 || this.lightMap[idx] !== 0 || this.prop[idx] !== PropType.NONE) {
        continue;
      }
      const b = this.biome[idx];
      if (b === BiomeType.FOOD_COURT) {
        this.prop[idx] = PropType.MEATBALL_VAT;
        this.propHp[idx] = 120;
        this.propMaxHp[idx] = 120;
      } else if (b === BiomeType.WAREHOUSE) {
        this.prop[idx] = Math.random() < 0.6 ? PropType.SHELF : PropType.WOOD_PALLET;
        this.propHp[idx] = 90;
        this.propMaxHp[idx] = 90;
      } else if (b === BiomeType.SHOWROOM) {
        this.prop[idx] = Math.random() < 0.45 ? PropType.COUCH : Math.random() < 0.75 ? PropType.BED : PropType.LAMP;
        this.propHp[idx] = 55;
        this.propMaxHp[idx] = 55;
      } else {
        this.prop[idx] = Math.random() < 0.55 ? PropType.WOOD_PALLET : PropType.SHELF;
        this.propHp[idx] = 80;
        this.propMaxHp[idx] = 80;
      }
      this.propOwner[idx] = -1;
      restocked++;
    }
    if (restocked > 0) {
      this.addNews('COLONY', `Overnight Store Shift restocked ${restocked} shelves & displays across distant aisles.`);
    }
  }

  private triggerAuditNight(): void {
    this.addNews('STAFF', `STOREWIDE PA (Night ${this.day}): "THE STORE IS NOW CLOSED" — District Manager Audit!`);
    this.addChronicle(
      'AUDIT',
      `Audit Night ${this.day}`,
      'District Manager Brutes swept out of the Dark Sectors as store closing sirens echoed.',
      '#f59e0b'
    );
    let spawned = 0;
    for (let attempt = 0; attempt < 60 && spawned < 4; attempt++) {
      const tx = 6 + ((Math.random() * (GRID_W - 12)) | 0);
      const ty = 6 + ((Math.random() * (GRID_H - 12)) | 0);
      const idx = ty * GRID_W + tx;
      if (this.lightMap[idx] === 0 && this.prop[idx] === PropType.NONE) {
        this.spawnStaff(UnitKind.STAFF_MANAGER, tx + 0.5, ty + 0.5);
        this.spawnFloatingText(tx, ty - 1, 'AUDIT MANAGER!', '#f59e0b');
        spawned++;
      }
    }
  }

  private tickWatchtowerTurrets(): void {
    for (let wi = 0; wi < this.watchtowerIndices.length; wi++) {
      const idx = this.watchtowerIndices[wi];
      if (this.prop[idx] !== PropType.WATCHTOWER || this.disabledLightMap[idx] > 0) continue;
      const x = idx % GRID_W;
      const y = (idx / GRID_W) | 0;
      const ownerId = this.propOwner[idx];
      const nation = ownerId >= 0 ? this.getNation(ownerId) : undefined;
      if (!nation || !nation.alive) continue;
      const armed = hasTech(nation, 'watchtower_turrets') || nation.techTier >= 3;
      if (!armed) continue;

      let target: Unit | null = null;
      let bestDSq = 9.5 * 9.5;
      this.spatialHash.queryRadius(this.units, x + 0.5, y + 0.5, 9.5, (u, _ui, dSq) => {
        const isHostile =
          (this.isNight && u.kind >= UnitKind.STAFF_NORMAL && u.kind <= UnitKind.STAFF_MANAGER) ||
          (u.nationId >= 0 && this.areHostile(nation.id, u.nationId));
        if (isHostile && dSq < bestDSq) {
          bestDSq = dSq;
          target = u;
        }
      });

      if (target && this.projectiles.length < 140) {
        const t = target as Unit;
        const dx = t.x - (x + 0.5);
        const dy = t.y - (y + 0.5);
        const dist = Math.hypot(dx, dy) || 1;
        const speed = 19;
        this.projectiles.push({
          x: x + 0.5,
          y: y + 0.5,
          vx: (dx / dist) * speed,
          vy: (dy / dist) * speed,
          damage: hasTech(nation, 'watchtower_turrets') ? 22 : 14,
          nationId: nation.id,
          life: 0.65,
        });
      }
    }
  }

  private tickFires(): void {
    let anyChanged = false;
    for (let y = 1; y < GRID_H - 1; y++) {
      const row = y * GRID_W;
      for (let x = 1; x < GRID_W - 1; x++) {
        const idx = row + x;
        const f = this.fireMap[idx];
        if (f === 0) continue;
        this.fireMap[idx] = f - 1;
        const p = this.prop[idx];
        if (
          p === PropType.SHELF ||
          p === PropType.COUCH ||
          p === PropType.BED ||
          p === PropType.WOOD_PALLET ||
          p === PropType.BARRICADE_WALL ||
          p === PropType.MATTRESS_HUT ||
          p === PropType.BISTRO ||
          p === PropType.WORKSHOP ||
          p === PropType.ARCHIVE ||
          p === PropType.CART_DEPOT
        ) {
          if (this.propHp[idx] > 18) {
            this.propHp[idx] -= 18;
          } else {
            this.ejectBuildingOccupants(idx);
            this.prop[idx] = PropType.NONE;
            this.propHp[idx] = 0;
            this.propOwner[idx] = -1;
            anyChanged = true;
          }
          // Small spread chance
          if (Math.random() < 0.12) {
            const nx = x + ((Math.random() * 3) | 0) - 1;
            const ny = y + ((Math.random() * 3) | 0) - 1;
            const nIdx = ny * GRID_W + nx;
            if (this.prop[nIdx] !== PropType.NONE && this.fireMap[nIdx] === 0) {
              this.fireMap[nIdx] = 5;
            }
          }
        }
      }
    }
    if (anyChanged) this.dirtyLight = true;
  }

  public startKingSummit(manual = false): void {
    if (this.isNight) {
      if (manual) {
        this.addNews(
          'DIPLOMACY',
          `Night ${this.day} Emergency Radio Summit convened across the dark aisles!`
        );
        this.spawnFloatingText(SUMMIT_X, SUMMIT_Y - 3, 'EMERGENCY SUMMIT!', '#38bdf8');
      }
      return;
    }
    const peacefulKings = this.nations.filter(
      (n) =>
        n.alive &&
        n.leader.alive &&
        !Object.values(n.relations).some((r) => r.stance === 'WAR')
    );
    this.summitActiveTimer = 24;
    this.summitDiscussed = false;
    if (peacefulKings.length >= 1) {
      const names = peacefulKings.map((k) => k.leader.name.split(' ')[0]).join(', ');
      this.addNews(
        'DIPLOMACY',
        `Day ${this.day} Royal Summit: ${names} ${peacefulKings.length === 1 ? 'headed' : 'are meeting'} in the Neutral Showroom Lounge to talk!`
      );
      this.spawnFloatingText(SUMMIT_X, SUMMIT_Y - 3, 'ROYAL SUMMIT!', '#ffda1a');
    } else if (manual) {
      this.addNews(
        'DIPLOMACY',
        `Day ${this.day} Summit: Envoys met by radio in the Neutral Lounge while kings remained at war.`
      );
      this.spawnFloatingText(SUMMIT_X, SUMMIT_Y - 3, 'ROYAL SUMMIT!', '#ffda1a');
    }
  }

  private tickRoyalSummitDiscussion(): void {
    const attending: Array<{ nation: Nation; leader: Unit }> = [];
    for (const u of this.units) {
      if (!u.alive || u.kind !== UnitKind.SURVIVOR || u.role !== SurvivorRole.LEADER || u.nationId < 0) {
        continue;
      }
      const n = this.getNation(u.nationId);
      if (!n || !n.alive) continue;
      const atWar = Object.values(n.relations).some((r) => r.stance === 'WAR');
      if (atWar) continue;
      if (Math.hypot(u.x - SUMMIT_X, u.y - SUMMIT_Y) <= 5.5) {
        attending.push({ nation: n, leader: u });
      }
    }

    if (attending.length < 2) return;
    this.summitDiscussed = true;

    this.spawnParticleBurst(SUMMIT_X, SUMMIT_Y, '#ffda1a', 14);
    this.spawnFloatingText(SUMMIT_X, SUMMIT_Y - 3.6, 'SUMMIT ACCORD!', '#ffda1a');

    for (const { nation, leader } of attending) {
      nation.meatballs += 5;
      nation.allenWrenches += 5;
      nation.happiness = Math.min(100, nation.happiness + 5);
      leader.chatEmoji = '🤝';
      leader.chatTimer = 3.0;
    }

    // Check if any two gathered peaceful leaders can deepen ties (including Unions!)
    let forgedDeal = false;
    const aliveCount = this.nations.filter((n) => n.alive).length;
    for (let i = 0; i < attending.length && !forgedDeal; i++) {
      for (let j = i + 1; j < attending.length && !forgedDeal; j++) {
        const a = attending[i].nation;
        const b = attending[j].nation;
        const stance = this.getStance(a.id, b.id);
        if (stance === 'NEUTRAL' || stance === 'TRUCE') {
          this.setRelation(a.id, b.id, 'TRADE_PACT');
          a.lastQuote = `We agreed on open cart lanes with ${b.name} at the Summit!`;
          b.lastQuote = `Fair meatball trade sealed with ${a.name}!`;
          this.addNews(
            'TRADE',
            `Royal Summit Accord: ${attending[i].leader.name.split(' ')[0]} & ${attending[j].leader.name.split(' ')[0]} met in the Showroom Lounge and signed a Trade Pact!`
          );
          forgedDeal = true;
        } else if (stance === 'TRADE_PACT' && a.meatballs >= 45 && b.meatballs >= 45) {
          this.setRelation(a.id, b.id, 'ALLIANCE');
          a.lastQuote = `${b.name} and ${a.name} stand united in the Showroom!`;
          b.lastQuote = `An Alliance forged over Swedish meatballs!`;
          this.addNews(
            'DIPLOMACY',
            `Royal Summit Accord: ${a.name} & ${b.name} elevated their talks into a Grand Alliance!`
          );
          forgedDeal = true;
        } else if (stance === 'ALLIANCE' && a.happiness >= 55 && b.happiness >= 55) {
          this.setRelation(a.id, b.id, 'UNION');
          a.lastQuote = `One Union Pact to guard every aisle with ${b.name}!`;
          b.lastQuote = `${a.name} & ${b.name} pledge mutual defense as a Union!`;
          this.addNews(
            'UNION',
            `Royal Summit Accord: ${a.name} & ${b.name} signed a Union Pact at the coffee table!`
          );
          forgedDeal = true;
        } else if (stance === 'UNION' && aliveCount >= 3 && this.day >= 4 && Math.random() < 0.45) {
          const primary = a.population + a.territoryTiles * 0.2 >= b.population + b.territoryTiles * 0.2 ? a : b;
          const secondary = primary.id === a.id ? b : a;
          this.uniteKingdoms(
            primary.id,
            secondary.id,
            `Historic Summit Act of Union: ${a.name} & ${b.name} united into one realm at the Showroom Lounge!`
          );
          forgedDeal = true;
        }
      }
    }

    if (!forgedDeal) {
      const names = attending.map((x) => x.leader.name.split(' ')[0]).join(', ');
      this.addNews(
        'DIPLOMACY',
        `Royal Summit Talks: ${names} discussed meatball rations, spotlights & Night Staff defense (+5 Wrenches, +5% Happiness).`
      );
    }
  }

  public setSummitLoungeSession(active: boolean): void {
    this.summitLoungeSessionActive = active;
    if (active) {
      this.summitActiveTimer = Math.max(this.summitActiveTimer, 300);
      this.spawnParticleBurst(SUMMIT_X + 0.5, SUMMIT_Y + 0.5, '#ffda1a', 14);
      this.spawnFloatingText(SUMMIT_X + 0.5, SUMMIT_Y - 3, 'SUMMIT LOUNGE CONVENED', '#ffda1a');
      this.addNews(
        'DIPLOMACY',
        `Day ${this.day}: Leaders are heading to the Neutral Summit Lounge for live talks!`
      );
    } else {
      this.summitActiveTimer = 0;
      this.summitSpeakingNationId = null;
      this.summitSpeakingTimer = 0;
    }
  }

  public announceSummitSpeech(nationId: number, dialogue: string): void {
    const nation = this.getNation(nationId);
    if (!nation) return;
    this.summitSpeakingNationId = nationId;
    this.summitSpeakingTimer = 6.0;
    nation.lastQuote = dialogue;

    const leaderUnit = this.units.find(
      (u) =>
        u.alive &&
        u.nationId === nationId &&
        u.kind === UnitKind.SURVIVOR &&
        u.role === SurvivorRole.LEADER
    );
    if (leaderUnit) {
      leaderUnit.chatEmoji = '💬';
      leaderUnit.chatTimer = 4.8;
      const shortLine = dialogue.length > 34 ? `${dialogue.slice(0, 32)}…` : dialogue;
      this.spawnFloatingText(leaderUnit.x, leaderUnit.y - 1.5, shortLine, nation.color);
    }
  }

  public getLeaderLoungeStatus(nationId: number): 'seated' | 'walking' | 'away' {
    const leaderUnit = this.units.find(
      (u) =>
        u.alive &&
        u.nationId === nationId &&
        u.kind === UnitKind.SURVIVOR &&
        u.role === SurvivorRole.LEADER
    );
    if (!leaderUnit) return 'away';
    const dist = Math.hypot(leaderUnit.x - (SUMMIT_X + 0.5), leaderUnit.y - (SUMMIT_Y + 0.5));
    if (dist <= 4.2) return 'seated';
    if (this.summitLoungeSessionActive || (this.summitActiveTimer > 0 && !this.isNight)) {
      return 'walking';
    }
    return 'away';
  }

  private getEffectiveGuardRatio(n: Nation): number {
    const atWar = Object.values(n.relations).some((r) => r.stance === 'WAR');
    const isMilitarist = atWar || n.government === 'Iron Dictatorship';
    const isMercantile = n.government === 'Merchant Republic';
    const baseRatio = isMilitarist ? 0.32 : isMercantile ? 0.2 : 0.21;
    // Higher population increases army cap scaling (deeper reserves & logistics)
    const popBonusRatio = Math.min(0.16, Math.max(0, n.population - 16) * 0.003);
    return Math.min(0.48, baseRatio + popBonusRatio);
  }

  private computeArmyCap(n: Nation): number {
    if (n.population <= 0) return 0;
    if (n.population < 6) {
      return Math.max(1, Math.min(n.population - 1, Math.round(n.population * 0.25)));
    }
    const ratio = this.getEffectiveGuardRatio(n);
    const mult = hasTech(n, 'blueprint_mastery') ? 1.15 : 1;
    return Math.max(2, Math.round(n.population * ratio * mult));
  }

  private getTargetJobRatios(n: Nation): {
    scavenger: number;
    builder: number;
    chef: number;
    tinker: number;
    trader: number;
    guard: number;
  } {
    const atWar = Object.values(n.relations).some((r) => r.stance === 'WAR');
    const isMilitarist = atWar || n.government === 'Iron Dictatorship';
    const isMercantile = n.government === 'Merchant Republic';
    const base = isMilitarist
      ? { scavenger: 0.24, builder: 0.16, chef: 0.11, tinker: 0.1, trader: 0.07, guard: 0.32 }
      : isMercantile
        ? { scavenger: 0.26, builder: 0.16, chef: 0.13, tinker: 0.11, trader: 0.14, guard: 0.2 }
        : { scavenger: 0.28, builder: 0.18, chef: 0.14, tinker: 0.11, trader: 0.08, guard: 0.21 };

    const guard = this.getEffectiveGuardRatio(n);
    if (guard <= base.guard) return base;
    const civScale = (1 - guard) / (1 - base.guard);
    return {
      scavenger: base.scavenger * civScale,
      builder: base.builder * civScale,
      chef: base.chef * civScale,
      tinker: base.tinker * civScale,
      trader: base.trader * civScale,
      guard,
    };
  }

  private pickNeededJobForNation(n: Nation, allowGuard = true): SurvivorRole {
    const pop = Math.max(1, n.population);
    const jobs = n.jobs || {
      scavengers: 0,
      builders: 0,
      guards: 0,
      chefs: 0,
      tinkers: 0,
      traders: 0,
    };
    const r = this.getTargetJobRatios(n);
    const armyCap = n.armyCap ?? this.computeArmyCap(n);
    const candidates: Array<{ role: SurvivorRole; deficit: number }> = [
      { role: SurvivorRole.SCAVENGER, deficit: r.scavenger * pop - jobs.scavengers },
      { role: SurvivorRole.BUILDER, deficit: r.builder * pop - jobs.builders },
      { role: SurvivorRole.CHEF, deficit: r.chef * pop - jobs.chefs },
      { role: SurvivorRole.TINKER, deficit: r.tinker * pop - jobs.tinkers },
      { role: SurvivorRole.TRADER, deficit: r.trader * pop - jobs.traders },
    ];
    if (allowGuard && jobs.guards < armyCap) {
      candidates.push({ role: SurvivorRole.GUARD, deficit: armyCap - jobs.guards });
    }
    candidates.sort((a, b) => b.deficit - a.deficit);
    return candidates[0].role;
  }

  private applyRoleStats(u: Unit, n: Nation | undefined, role: SurvivorRole): void {
    u.role = role;
    const isLeader = role === SurvivorRole.LEADER;
    const isGeneral = role === SurvivorRole.GENERAL;
    const isGuard = role === SurvivorRole.GUARD;
    const tierHpBonus = n ? (n.techTier - 1) * 14 : 0;
    const govHpBonus = n?.government === 'Iron Dictatorship' && (isGuard || isGeneral) ? 15 : 0;
    const techHpBonus = hasTech(n, 'allen_spears') && (isGuard || isGeneral || isLeader) ? 18 : 0;
    const techAtkBonus = hasTech(n, 'allen_spears') && (isGuard || isGeneral || isLeader) ? 3 : 0;
    const baseHp = (isLeader ? 140 : isGeneral ? 135 : isGuard ? 95 : 70) + tierHpBonus + govHpBonus + techHpBonus;
    u.maxHp = u.traits.includes('Tough') ? Math.round(baseHp * 1.35) : baseHp;
    u.hp = Math.min(u.hp, u.maxHp);
    u.atk = (isLeader ? 14 : isGeneral ? 13 : isGuard ? 11 : 6) + (n ? (n.techTier - 1) * 2 : 0) + techAtkBonus;
  }

  public setNationActiveResearch(nationId: number, techId: TechId): void {
    const n = this.getNation(nationId);
    if (!n || !n.alive) return;
    const node = RESEARCH_BY_ID[techId];
    if (!node || !canResearchTech(n, node)) return;
    n.activeResearchId = techId;
    n.researchPoints = 0;
  }

  public grantNationResearch(nationId: number, techId: TechId): void {
    const n = this.getNation(nationId);
    if (!n || !n.alive) return;
    const node = RESEARCH_BY_ID[techId];
    if (!node) return;
    if (!n.researchedTechs) n.researchedTechs = [];
    if (n.researchedTechs.includes(techId)) return;

    // Auto-unlock prerequisite if player grants a higher node directly as God
    if (node.requires && !n.researchedTechs.includes(node.requires)) {
      this.grantNationResearch(nationId, node.requires);
    }

    n.researchedTechs.push(techId);
    if (n.activeResearchId === techId) {
      n.activeResearchId = null;
      n.researchPoints = 0;
    }
    this.applyTechUnlockEffects(n, techId, true);
  }

  private applyTechUnlockEffects(n: Nation, techId: TechId, byGod = false): void {
    const node = RESEARCH_BY_ID[techId];
    if (techId === 'halogen_floodlights') {
      this.dirtyLight = true;
    }
    if (techId === 'allen_spears') {
      for (const u of this.units) {
        if (u.alive && u.nationId === n.id && u.kind === UnitKind.SURVIVOR) {
          this.applyRoleStats(u, n, u.role);
        }
      }
    }
    if (techId === 'blueprint_mastery') {
      this.recountTerritoryAndHousing();
    }
    this.records.totalTechsUnlocked += 1;
    this.addChronicle(
      'TECH',
      `${n.name} Unlocked ${node.name}`,
      node.effectSummary,
      n.color
    );
    this.addNews(
      byGod ? 'GOD' : 'COLONY',
      `${n.name} ${byGod ? 'was gifted' : 'researched'} ${node.name}!`
    );
    this.spawnFloatingText(n.capitalX, n.capitalY - 1.5, `+TECH: ${node.name}`, '#38bdf8');
    this.spawnParticleBurst(n.capitalX + 0.5, n.capitalY + 0.5, '#38bdf8', 10);
  }

  private pickBestResearchForNation(n: Nation): TechId | null {
    const available = RESEARCH_TREE.filter((node) => canResearchTech(n, node));
    if (available.length === 0) return null;
    const atWar = Object.values(n.relations).some((r) => r.stance === 'WAR');
    const lowFood = n.meatballs < n.population * 1.3 || n.scrap < 20;

    available.sort((a, b) => {
      const score = (node: typeof a) => {
        let s = -node.tier * 2;
        if (atWar && node.branch === 'military') s += 10;
        if (lowFood && node.branch === 'economy') s += 9;
        if ((n.government === 'Iron Dictatorship' || n.ideology === 'Iron Fortress') && node.branch === 'military') s += 4;
        if ((n.government === 'Merchant Republic' || n.ideology === 'Merchant Cartel') && node.branch === 'economy') s += 4;
        if ((n.government === 'Meatball Theocracy' || n.government === 'Checkout Democracy') && node.branch === 'lighting') s += 4;
        return s;
      };
      return score(b) - score(a);
    });
    return available[0].id;
  }

  public getKingdomFormation(n: Nation): FormationType {
    if (n.government === 'Iron Dictatorship' || n.ideology === 'Iron Fortress') {
      return 'Shield Wall Rows';
    }
    if (n.ideology === 'Expansionist Empire') {
      return 'Wedge Spearhead';
    }
    if (n.government === 'Merchant Republic' || n.ideology === 'Merchant Cartel') {
      return 'Flanking Pincer';
    }
    if (n.government === 'Meatball Theocracy' || n.ideology === 'Meatball Zealots') {
      return 'Zealot Crescent';
    }
    return 'Phalanx Grid';
  }

  public getKingdomBuildingPattern(n: Nation): BuildingPattern {
    if (n.customBuildingPattern) {
      return n.customBuildingPattern;
    }
    if (n.government === 'Iron Dictatorship' || n.ideology === 'Iron Fortress') {
      return 'Iron Citadel';
    }
    if (n.government === 'Merchant Republic') {
      return 'Merchant Bazaar';
    }
    if (n.government === 'Meatball Theocracy') {
      return 'Cathedral Spire';
    }
    if (n.ideology === 'Expansionist Empire') {
      return 'Imperial Concourse';
    }
    return 'Showroom Plaza';
  }

  private getBuildingCost(prop: PropType): {
    scrap: number;
    wrenches: number;
    meatballs: number;
    hp: number;
    label: string;
  } {
    switch (prop) {
      case PropType.MATTRESS_HUT:
        return { scrap: 8, wrenches: 0, meatballs: 0, hp: 140, label: '+Mattress Hut' };
      case PropType.BISTRO:
        return { scrap: 10, wrenches: 0, meatballs: 6, hp: 150, label: '+Meatball Bistro' };
      case PropType.WORKSHOP:
        return { scrap: 10, wrenches: 4, meatballs: 0, hp: 165, label: '+Wrench Workshop' };
      case PropType.CART_DEPOT:
        return { scrap: 10, wrenches: 4, meatballs: 0, hp: 155, label: '+Cart Depot' };
      case PropType.ARCHIVE:
        return { scrap: 12, wrenches: 6, meatballs: 0, hp: 175, label: '+Billy Archive' };
      case PropType.SPOTLIGHT:
        return { scrap: 8, wrenches: 0, meatballs: 0, hp: 150, label: '+Spotlight' };
      case PropType.WATCHTOWER:
        return { scrap: 11, wrenches: 3, meatballs: 0, hp: 190, label: '+Watchtower' };
      case PropType.BARRICADE_GATE:
        return { scrap: 5, wrenches: 0, meatballs: 0, hp: 145, label: '' };
      default:
        return { scrap: 5, wrenches: 0, meatballs: 0, hp: 150, label: '' };
    }
  }

  private getKingdomBlueprintLayout(
    n: Nation
  ): Array<{ dx: number; dy: number; prop: PropType; variant?: number }> {
    const pattern = this.getKingdomBuildingPattern(n);
    const slots: Array<{ dx: number; dy: number; prop: PropType; variant?: number }> = [];

    if (pattern === 'Iron Citadel') {
      // Inner armored core: workshops, barracks rows, watchtower corners
      slots.push(
        { dx: -3, dy: 0, prop: PropType.WORKSHOP },
        { dx: 3, dy: 0, prop: PropType.WORKSHOP },
        { dx: 0, dy: 3, prop: PropType.BISTRO },
        { dx: -2, dy: 1, prop: PropType.MATTRESS_HUT },
        { dx: 2, dy: 1, prop: PropType.MATTRESS_HUT },
        { dx: 2, dy: -1, prop: PropType.MATTRESS_HUT },
        { dx: -2, dy: 2, prop: PropType.MATTRESS_HUT },
        { dx: 2, dy: 2, prop: PropType.MATTRESS_HUT },
        { dx: 0, dy: -3, prop: PropType.CART_DEPOT },
        { dx: -2, dy: -3, prop: PropType.ARCHIVE },
        { dx: -3, dy: -3, prop: PropType.WATCHTOWER },
        { dx: 3, dy: -3, prop: PropType.WATCHTOWER },
        { dx: -3, dy: 3, prop: PropType.WATCHTOWER },
        { dx: 3, dy: 3, prop: PropType.WATCHTOWER },
        { dx: -4, dy: 2, prop: PropType.SPOTLIGHT },
        { dx: 4, dy: -2, prop: PropType.SPOTLIGHT }
      );
      // Inner square bastion walls (radius 5) with cardinal gates
      for (let d = -5; d <= 5; d++) {
        slots.push(
          { dx: d, dy: -5, prop: d === 0 ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 4 },
          { dx: d, dy: 5, prop: d === 0 ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 4 }
        );
        if (Math.abs(d) < 5) {
          slots.push(
            { dx: -5, dy: d, prop: d === 0 ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 4 },
            { dx: 5, dy: d, prop: d === 0 ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 4 }
          );
        }
      }
      // Outer citadel perimeter (radius 9) with corner watchtowers
      slots.push(
        { dx: -9, dy: -9, prop: PropType.WATCHTOWER },
        { dx: 9, dy: -9, prop: PropType.WATCHTOWER },
        { dx: -9, dy: 9, prop: PropType.WATCHTOWER },
        { dx: 9, dy: 9, prop: PropType.WATCHTOWER },
        { dx: -6, dy: -8, prop: PropType.SPOTLIGHT },
        { dx: 6, dy: 8, prop: PropType.SPOTLIGHT }
      );
      for (let d = -9; d <= 9; d++) {
        if (Math.abs(d) === 9) continue;
        slots.push(
          { dx: d, dy: -9, prop: Math.abs(d) <= 1 ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 0 },
          { dx: d, dy: 9, prop: Math.abs(d) <= 1 ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 0 },
          { dx: -9, dy: d, prop: Math.abs(d) <= 1 ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 0 },
          { dx: 9, dy: d, prop: Math.abs(d) <= 1 ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 0 }
        );
      }
    } else if (pattern === 'Merchant Bazaar') {
      // Wide open N/S & E/W trade avenues (|dx| <= 1 or |dy| <= 1 kept clear), flanked by Cart Depots & Bistros
      slots.push(
        { dx: 3, dy: -2, prop: PropType.CART_DEPOT },
        { dx: -3, dy: -2, prop: PropType.CART_DEPOT },
        { dx: 3, dy: 2, prop: PropType.BISTRO },
        { dx: -3, dy: 2, prop: PropType.BISTRO },
        { dx: 5, dy: -2, prop: PropType.BISTRO },
        { dx: -5, dy: 2, prop: PropType.CART_DEPOT },
        { dx: -2, dy: 4, prop: PropType.WORKSHOP },
        { dx: 2, dy: 4, prop: PropType.WORKSHOP },
        { dx: -2, dy: -4, prop: PropType.ARCHIVE },
        { dx: 2, dy: -4, prop: PropType.ARCHIVE },
        { dx: -5, dy: -2, prop: PropType.SPOTLIGHT },
        { dx: 5, dy: 2, prop: PropType.SPOTLIGHT },
        { dx: -2, dy: 6, prop: PropType.SPOTLIGHT },
        { dx: 2, dy: -6, prop: PropType.SPOTLIGHT },
        // Symmetrical 4-quadrant merchant quarters
        { dx: -4, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: -5, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: 4, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: 5, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: -4, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: -5, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: 4, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: 5, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: -8, dy: -8, prop: PropType.WATCHTOWER },
        { dx: 8, dy: -8, prop: PropType.WATCHTOWER },
        { dx: -8, dy: 8, prop: PropType.WATCHTOWER },
        { dx: 8, dy: 8, prop: PropType.WATCHTOWER }
      );
      // Bazaar showcase perimeter (radius 8) with wide 3-tile open gates
      for (let d = -7; d <= 7; d++) {
        const isWideGate = Math.abs(d) <= 1;
        slots.push(
          { dx: d, dy: -8, prop: isWideGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 2 },
          { dx: d, dy: 8, prop: isWideGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 3 },
          { dx: -8, dy: d, prop: isWideGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 2 },
          { dx: 8, dy: d, prop: isWideGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 3 }
        );
      }
    } else if (pattern === 'Cathedral Spire') {
      // Sacred radial cross of Bistros & Spotlights, diagonal Archives, octagonal sanctum ring
      slots.push(
        { dx: 0, dy: -3, prop: PropType.BISTRO },
        { dx: 0, dy: 3, prop: PropType.BISTRO },
        { dx: -3, dy: 0, prop: PropType.BISTRO },
        { dx: 3, dy: 0, prop: PropType.BISTRO },
        { dx: -3, dy: -3, prop: PropType.ARCHIVE },
        { dx: 3, dy: -3, prop: PropType.ARCHIVE },
        { dx: -3, dy: 3, prop: PropType.WORKSHOP },
        { dx: 3, dy: 3, prop: PropType.CART_DEPOT },
        { dx: 0, dy: -6, prop: PropType.SPOTLIGHT },
        { dx: 0, dy: 6, prop: PropType.SPOTLIGHT },
        { dx: -6, dy: 0, prop: PropType.SPOTLIGHT },
        { dx: 6, dy: 0, prop: PropType.SPOTLIGHT },
        { dx: -4, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: 4, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: -4, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: 4, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: -5, dy: -2, prop: PropType.MATTRESS_HUT },
        { dx: 5, dy: 2, prop: PropType.MATTRESS_HUT },
        { dx: -2, dy: -5, prop: PropType.MATTRESS_HUT },
        { dx: 2, dy: 5, prop: PropType.MATTRESS_HUT },
        { dx: 0, dy: -8, prop: PropType.WATCHTOWER },
        { dx: 0, dy: 8, prop: PropType.WATCHTOWER },
        { dx: -8, dy: 0, prop: PropType.WATCHTOWER },
        { dx: 8, dy: 0, prop: PropType.WATCHTOWER }
      );
      // Octagonal cathedral wall ring
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const r = Math.hypot(dx, dy);
          if (r >= 7.6 && r <= 8.55 && !(Math.abs(dx) === 0 || Math.abs(dy) === 0)) {
            const isGate = (Math.abs(dx) === 1 && Math.abs(dy) >= 7) || (Math.abs(dy) === 1 && Math.abs(dx) >= 7);
            slots.push({
              dx,
              dy,
              prop: isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL,
              variant: (dx + dy) & 1 ? 1 : 4,
            });
          }
        }
      }
    } else if (pattern === 'Imperial Concourse') {
      // Radial command spokes & circular outpost rings
      slots.push(
        { dx: -2, dy: 2, prop: PropType.WORKSHOP },
        { dx: 2, dy: -2, prop: PropType.WORKSHOP },
        { dx: 0, dy: -3, prop: PropType.BISTRO },
        { dx: -3, dy: 0, prop: PropType.CART_DEPOT },
        { dx: 0, dy: 3, prop: PropType.CART_DEPOT },
        { dx: 3, dy: 0, prop: PropType.BISTRO },
        { dx: 3, dy: 3, prop: PropType.ARCHIVE },
        { dx: -3, dy: -3, prop: PropType.ARCHIVE },
        { dx: -5, dy: -5, prop: PropType.WATCHTOWER },
        { dx: 5, dy: -5, prop: PropType.WATCHTOWER },
        { dx: -5, dy: 5, prop: PropType.WATCHTOWER },
        { dx: 5, dy: 5, prop: PropType.WATCHTOWER },
        { dx: -5, dy: 0, prop: PropType.MATTRESS_HUT },
        { dx: 5, dy: 0, prop: PropType.MATTRESS_HUT },
        { dx: 0, dy: -5, prop: PropType.MATTRESS_HUT },
        { dx: 0, dy: 5, prop: PropType.MATTRESS_HUT },
        { dx: -4, dy: 2, prop: PropType.MATTRESS_HUT },
        { dx: 4, dy: -2, prop: PropType.MATTRESS_HUT },
        { dx: -2, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: 2, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: -7, dy: -3, prop: PropType.SPOTLIGHT },
        { dx: 7, dy: 3, prop: PropType.SPOTLIGHT },
        { dx: -3, dy: 7, prop: PropType.SPOTLIGHT },
        { dx: 3, dy: -7, prop: PropType.SPOTLIGHT }
      );
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const r = Math.hypot(dx, dy);
          if (r >= 7.2 && r <= 8.1) {
            const isGate = Math.abs(dx) <= 1 || Math.abs(dy) <= 1;
            slots.push({
              dx,
              dy,
              prop: isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL,
              variant: 0,
            });
          }
        }
      }
    } else {
      // Showroom Plaza: 4 symmetrical 2x2 neighborhood clusters around a lit civic square
      slots.push(
        { dx: 0, dy: -4, prop: PropType.BISTRO },
        { dx: 0, dy: 4, prop: PropType.BISTRO },
        { dx: -4, dy: 0, prop: PropType.ARCHIVE },
        { dx: 4, dy: 0, prop: PropType.CART_DEPOT },
        { dx: -3, dy: 2, prop: PropType.WORKSHOP },
        { dx: 3, dy: -2, prop: PropType.WORKSHOP },
        { dx: -3, dy: -3, prop: PropType.SPOTLIGHT },
        { dx: 3, dy: -3, prop: PropType.SPOTLIGHT },
        { dx: -3, dy: 3, prop: PropType.SPOTLIGHT },
        { dx: 3, dy: 3, prop: PropType.SPOTLIGHT },
        // 2x2 residential showroom clusters
        { dx: -4, dy: -5, prop: PropType.MATTRESS_HUT },
        { dx: -5, dy: -5, prop: PropType.MATTRESS_HUT },
        { dx: -4, dy: -6, prop: PropType.MATTRESS_HUT },
        { dx: 4, dy: -5, prop: PropType.MATTRESS_HUT },
        { dx: 5, dy: -5, prop: PropType.MATTRESS_HUT },
        { dx: 4, dy: -6, prop: PropType.MATTRESS_HUT },
        { dx: -4, dy: 5, prop: PropType.MATTRESS_HUT },
        { dx: -5, dy: 5, prop: PropType.MATTRESS_HUT },
        { dx: 4, dy: 5, prop: PropType.MATTRESS_HUT },
        { dx: 5, dy: 5, prop: PropType.MATTRESS_HUT },
        { dx: -7, dy: -7, prop: PropType.WATCHTOWER },
        { dx: 7, dy: -7, prop: PropType.WATCHTOWER },
        { dx: -7, dy: 7, prop: PropType.WATCHTOWER },
        { dx: 7, dy: 7, prop: PropType.WATCHTOWER }
      );
      // Clean Billy & Kallax room-gallery perimeter (radius 7)
      for (let d = -6; d <= 6; d++) {
        const isGate = Math.abs(d) <= 1;
        slots.push(
          { dx: d, dy: -7, prop: isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 1 },
          { dx: d, dy: 7, prop: isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 3 },
          { dx: -7, dy: d, prop: isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 1 },
          { dx: 7, dy: d, prop: isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: 3 }
        );
      }
    }

    return slots;
  }

  private isDismantlableIkeaProp(p: PropType): boolean {
    return (
      p === PropType.SHELF ||
      p === PropType.WOOD_PALLET ||
      p === PropType.COUCH ||
      p === PropType.BED ||
      p === PropType.LAMP ||
      p === PropType.MEATBALL_VAT
    );
  }

  private hasOwnedBuildingNear(nationId: number, tx: number, ty: number, radius: number, onlyWatchtower = false): boolean {
    const minY = Math.max(1, ty - radius);
    const maxY = Math.min(GRID_H - 2, ty + radius);
    const minX = Math.max(1, tx - radius);
    const maxX = Math.min(GRID_W - 2, tx + radius);
    for (let y = minY; y <= maxY; y++) {
      const row = y * GRID_W;
      for (let x = minX; x <= maxX; x++) {
        const idx = row + x;
        const p = this.prop[idx];
        if (p === PropType.NONE || this.propOwner[idx] !== nationId) continue;
        if (onlyWatchtower) {
          if (p === PropType.WATCHTOWER) return true;
        } else if (
          p !== PropType.BARRICADE_WALL &&
          p !== PropType.BARRICADE_GATE
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private findEmptyLandBlueprintSite(
    n: Nation,
    availScrap: number,
    availWrenches: number,
    availMeatballs: number,
    caps: {
      maxHuts: number;
      maxBistros: number;
      maxWorkshops: number;
      maxDepots: number;
      maxArchives: number;
      maxSpotlights: number;
      maxWatchtowers: number;
    }
  ): {
    x: number;
    y: number;
    prop: PropType;
    variant: number;
    affordable: boolean;
    needsScrap: boolean;
    needsWrenches: boolean;
  } | null {
    const bld = n.buildings || {
      huts: 0,
      bistros: 0,
      workshops: 0,
      archives: 0,
      depots: 0,
      watchtowers: 0,
      spotlights: 0,
    };

    const makeCandidate = (tx: number, ty: number, prop: PropType, variant = 0) => {
      const cost = this.getBuildingCost(prop);
      return {
        x: tx,
        y: ty,
        prop,
        variant,
        affordable:
          availScrap >= cost.scrap &&
          availWrenches >= cost.wrenches &&
          availMeatballs >= cost.meatballs,
        needsScrap: availScrap < cost.scrap,
        needsWrenches: availWrenches < cost.wrenches,
      };
    };

    // 1. Develop united city hubs if any exist
    if (n.unionHubs && n.unionHubs.length > 0) {
      const hubOffsets: Array<{ dx: number; dy: number; prop: PropType }> = [
        { dx: 3, dy: 0, prop: PropType.CART_DEPOT },
        { dx: -3, dy: 0, prop: PropType.BISTRO },
        { dx: 0, dy: 3, prop: PropType.WORKSHOP },
        { dx: -3, dy: -3, prop: PropType.MATTRESS_HUT },
        { dx: 3, dy: 3, prop: PropType.MATTRESS_HUT },
        { dx: 0, dy: -4, prop: PropType.SPOTLIGHT },
        { dx: -4, dy: 4, prop: PropType.WATCHTOWER },
      ];
      for (const hub of n.unionHubs) {
        for (const off of hubOffsets) {
          const tx = hub.x + off.dx;
          const ty = hub.y + off.dy;
          if (tx < 2 || tx >= GRID_W - 2 || ty < 2 || ty >= GRID_H - 2) continue;
          if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 2) continue;
          const idx = ty * GRID_W + tx;
          if (this.territory[idx] !== n.id || this.activeBuilderTargets.has(idx)) continue;
          const existing = this.prop[idx];
          if (existing !== PropType.NONE && (this.propOwner[idx] === n.id || !this.isDismantlableIkeaProp(existing))) {
            continue;
          }
          const cand = makeCandidate(tx, ty, off.prop);
          if (cand.affordable) return cand;
        }
      }
    }

    // 2. Scan empty owned territory across the kingdom for new districts, lights, & frontier walls
    let fallback: ReturnType<typeof makeCandidate> | null = null;
    const scanSpan = n.territoryTiles > 260 ? 95 : 55;
    const minX = Math.max(2, n.capitalX - scanSpan);
    const maxX = Math.min(GRID_W - 3, n.capitalX + scanSpan);
    const minY = Math.max(2, n.capitalY - scanSpan);
    const maxY = Math.min(GRID_H - 3, n.capitalY + scanSpan);

    for (let attempt = 0; attempt < 95; attempt++) {
      const tx = minX + ((Math.random() * (maxX - minX + 1)) | 0);
      const ty = minY + ((Math.random() * (maxY - minY + 1)) | 0);
      if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 2) continue;
      const idx = ty * GRID_W + tx;
      if (this.territory[idx] !== n.id || this.activeBuilderTargets.has(idx)) continue;

      const existing = this.prop[idx];
      if (existing !== PropType.NONE) {
        if (this.propOwner[idx] === n.id || !this.isDismantlableIkeaProp(existing)) continue;
      }

      // Check 4-neighbors to distinguish outer frontier vs interior empty land
      const nTop = this.territory[idx - GRID_W];
      const nBot = this.territory[idx + GRID_W];
      const nLft = this.territory[idx - 1];
      const nRgt = this.territory[idx + 1];
      const isFrontier = nTop !== n.id || nBot !== n.id || nLft !== n.id || nRgt !== n.id;

      if (isFrontier) {
        // Don't wall off a friendly UNION/ALLIANCE neighbor without gates
        const neighbors = [nTop, nBot, nLft, nRgt];
        const touchesUnionFriend = neighbors.some(
          (nb) => nb >= 0 && nb !== n.id && this.nations[nb]?.alive && this.areFriendly(n.id, nb)
        );
        if (touchesUnionFriend) {
          // Connect with a gate along walkable/road crossings instead of blocking walls
          if (this.biome[idx] === BiomeType.WALKWAY && Math.random() < 0.35) {
            const cand = makeCandidate(tx, ty, PropType.BARRICADE_GATE, 0);
            if (cand.affordable) return cand;
          }
          continue;
        }

        // Fortify outer empty border with Watchtowers and gated Barricade Walls
        if (
          bld.watchtowers < caps.maxWatchtowers &&
          !this.hasOwnedBuildingNear(n.id, tx, ty, 9, true)
        ) {
          const cand = makeCandidate(tx, ty, PropType.WATCHTOWER);
          if (cand.affordable) return cand;
          if (!fallback) fallback = cand;
          continue;
        }

        // Avoid choking tiles with walls on 3+ orthogonal sides
        let adjWalls = 0;
        if (this.prop[idx - GRID_W] === PropType.BARRICADE_WALL) adjWalls++;
        if (this.prop[idx + GRID_W] === PropType.BARRICADE_WALL) adjWalls++;
        if (this.prop[idx - 1] === PropType.BARRICADE_WALL) adjWalls++;
        if (this.prop[idx + 1] === PropType.BARRICADE_WALL) adjWalls++;
        if (adjWalls >= 2 && Math.random() < 0.7) continue;

        const isGate = (tx + ty) % 6 === 0 || this.biome[idx] === BiomeType.WALKWAY;
        const cand = makeCandidate(
          tx,
          ty,
          isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL,
          isGate ? 0 : 1 + ((tx + ty) % 4)
        );
        if (cand.affordable) return cand;
        if (!fallback) fallback = cand;
        continue;
      }

      // Interior empty land: keep roads clear and space buildings cleanly (no 3-tile crowding)
      if (this.biome[idx] === BiomeType.WALKWAY && Math.random() < 0.75) continue;
      if (this.hasOwnedBuildingNear(n.id, tx, ty, 3, false)) continue;

      let chosenProp: PropType | null = null;
      if (this.lightMap[idx] === 0 && bld.spotlights < caps.maxSpotlights) {
        chosenProp = PropType.SPOTLIGHT;
      } else if (bld.huts < caps.maxHuts && (n.population >= n.housingCap - 8 || Math.random() < 0.45)) {
        chosenProp = PropType.MATTRESS_HUT;
      } else if (bld.bistros < caps.maxBistros) {
        chosenProp = PropType.BISTRO;
      } else if (bld.workshops < caps.maxWorkshops) {
        chosenProp = PropType.WORKSHOP;
      } else if (bld.depots < caps.maxDepots) {
        chosenProp = PropType.CART_DEPOT;
      } else if (n.techTier >= 2 && bld.archives < caps.maxArchives) {
        chosenProp = PropType.ARCHIVE;
      } else if (bld.huts < caps.maxHuts + 4) {
        chosenProp = PropType.MATTRESS_HUT;
      }

      if (chosenProp !== null) {
        const cand = makeCandidate(tx, ty, chosenProp);
        if (cand.affordable) return cand;
        if (!fallback) fallback = cand;
      }
    }

    return fallback;
  }

  private findNextBlueprintSite(
    n: Nation,
    _builderId: number,
    carryType: Unit['carryType'],
    carryAmount: number
  ): {
    x: number;
    y: number;
    prop: PropType;
    variant: number;
    affordable: boolean;
    needsScrap: boolean;
    needsWrenches: boolean;
  } | null {
    const layout = this.getKingdomBlueprintLayout(n);
    const bld = n.buildings || {
      huts: 0,
      bistros: 0,
      workshops: 0,
      archives: 0,
      depots: 0,
      watchtowers: 0,
      spotlights: 0,
    };

    const caps = {
      maxHuts: Math.max(8, Math.floor(n.territoryTiles / 22)),
      maxBistros: Math.max(4, Math.floor(n.territoryTiles / 55)),
      maxWorkshops: Math.max(4, Math.floor(n.territoryTiles / 65)),
      maxDepots: Math.max(3, Math.floor(n.territoryTiles / 75)),
      maxArchives: Math.max(3, Math.floor(n.territoryTiles / 85)),
      maxSpotlights: Math.max(5, Math.floor(n.territoryTiles / 35)),
      maxWatchtowers: Math.max(6, Math.floor(n.territoryTiles / 45)),
    };

    const availScrap = n.scrap + (carryType === 'scrap' ? carryAmount : 0);
    const availWrenches = n.allenWrenches + (carryType === 'wrench' ? carryAmount : 0);
    const availMeatballs = n.meatballs + (carryType === 'meatball' ? carryAmount : 0);

    // If the kingdom controls lots of empty land, occasionally develop outer districts even while finishing capital rings
    if (n.territoryTiles >= 90 && Math.random() < 0.38) {
      const emptySite = this.findEmptyLandBlueprintSite(
        n,
        availScrap,
        availWrenches,
        availMeatballs,
        caps
      );
      if (emptySite && emptySite.affordable) return emptySite;
    }

    let firstNeeded: {
      x: number;
      y: number;
      prop: PropType;
      variant: number;
      affordable: boolean;
      needsScrap: boolean;
      needsWrenches: boolean;
    } | null = null;

    for (const slot of layout) {
      const tx = n.capitalX + slot.dx;
      const ty = n.capitalY + slot.dy;
      if (tx < 2 || tx >= GRID_W - 2 || ty < 2 || ty >= GRID_H - 2) continue;
      if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 2) continue;

      const idx = ty * GRID_W + tx;
      const existingProp = this.prop[idx];
      const existingOwner = this.propOwner[idx];

      // Already built by this nation (non-clearable)
      if (existingProp !== PropType.NONE) {
        if (existingOwner === n.id || !this.isDismantlableIkeaProp(existingProp)) {
          continue;
        }
      }
      // Don't stomp another living nation's claimed heartland
      if (existingOwner >= 0 && existingOwner !== n.id) continue;

      // Soft building caps scaled to territory so kingdoms expand balanced cities across empty land
      if (slot.prop === PropType.MATTRESS_HUT && bld.huts >= caps.maxHuts && n.population < n.housingCap - 4) continue;
      if (slot.prop === PropType.BISTRO && bld.bistros >= caps.maxBistros) continue;
      if (slot.prop === PropType.WORKSHOP && bld.workshops >= caps.maxWorkshops) continue;
      if (slot.prop === PropType.CART_DEPOT && bld.depots >= caps.maxDepots) continue;
      if (slot.prop === PropType.ARCHIVE && (n.techTier < 2 || bld.archives >= caps.maxArchives)) continue;
      if (slot.prop === PropType.SPOTLIGHT && this.lightMap[idx] > 0 && bld.spotlights >= caps.maxSpotlights) continue;
      if (slot.prop === PropType.WATCHTOWER && bld.watchtowers >= caps.maxWatchtowers) continue;

      // Avoid assigning two builders of the same nation to the same blueprint tile (O(1) lookup)
      if (this.activeBuilderTargets.has(idx)) continue;

      const cost = this.getBuildingCost(slot.prop);
      const affordable =
        availScrap >= cost.scrap &&
        availWrenches >= cost.wrenches &&
        availMeatballs >= cost.meatballs;

      const candidate = {
        x: tx,
        y: ty,
        prop: slot.prop,
        variant: slot.variant ?? 0,
        affordable,
        needsScrap: availScrap < cost.scrap,
        needsWrenches: availWrenches < cost.wrenches,
      };

      if (affordable) return candidate;
      if (!firstNeeded) firstNeeded = candidate;
    }

    // Capital blueprint completed or deferred -> expand into empty owned land & frontiers!
    const emptyLandSite = this.findEmptyLandBlueprintSite(
      n,
      availScrap,
      availWrenches,
      availMeatballs,
      caps
    );
    if (emptyLandSite && (emptyLandSite.affordable || !firstNeeded)) {
      return emptyLandSite;
    }

    return firstNeeded;
  }

  private computeFormationSlotTarget(
    formation: FormationType,
    slotIdx: number,
    totalSlots: number,
    anchorX: number,
    anchorY: number,
    fx: number,
    fy: number
  ): { x: number; y: number } {
    const rx = -fy; // perpendicular right vector
    const ry = fx;
    let fwdOff = 0;
    let rightOff = 0;

    if (formation === 'Shield Wall Rows') {
      // Disciplined double/triple shield rows facing the enemy
      const cols = Math.min(5, Math.max(2, Math.ceil(totalSlots / 2)));
      const row = Math.floor(slotIdx / cols);
      const col = slotIdx % cols;
      const centeredCol = col - (cols - 1) * 0.5;
      fwdOff = 1.6 - row * 1.9;
      rightOff = centeredCol * 1.85;
    } else if (formation === 'Phalanx Grid') {
      // Organized 3-wide phalanx rows around the General
      const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(totalSlots))));
      const row = Math.floor(slotIdx / cols);
      const col = slotIdx % cols;
      const centeredCol = col - (cols - 1) * 0.5;
      fwdOff = 1.4 - row * 1.8;
      rightOff = centeredCol * 2.0;
    } else if (formation === 'Wedge Spearhead') {
      // V-shaped spearhead behind the General
      const rank = Math.floor(slotIdx / 2) + 1;
      const side = slotIdx % 2 === 0 ? -1 : 1;
      fwdOff = -rank * 1.65;
      rightOff = side * rank * 1.55;
    } else if (formation === 'Flanking Pincer') {
      // Left and right flanking columns
      const side = slotIdx % 2 === 0 ? -1 : 1;
      const depth = Math.floor(slotIdx / 2);
      fwdOff = 1.8 - depth * 1.75;
      rightOff = side * (2.6 + (depth % 2) * 0.8);
    } else {
      // Zealot Crescent arc enveloping forward
      const span = Math.max(1, totalSlots - 1);
      const t = totalSlots <= 1 ? 0 : (slotIdx / span) * 2 - 1; // -1..1
      const angle = t * (Math.PI * 0.48);
      fwdOff = Math.cos(angle) * 2.6 - 0.8;
      rightOff = Math.sin(angle) * 4.4;
    }

    return {
      x: Math.max(2.5, Math.min(GRID_W - 2.5, anchorX + fx * fwdOff + rx * rightOff)),
      y: Math.max(2.5, Math.min(GRID_H - 2.5, anchorY + fy * fwdOff + ry * rightOff)),
    };
  }

  private computeTerritoryResourcePopCap(n: Nation): number {
    if (!n.alive || n.territoryTiles <= 0) return 0;
    const huts = n.buildings?.huts || 0;
    const bistros = n.buildings?.bistros || 0;
    const hutBonus = huts * (hasTech(n, 'blueprint_mastery') ? 6 : 4);
    const landAndHousingCap = 4 + Math.floor(n.territoryTiles * 0.28) + hutBonus;
    const resourceCap =
      10 +
      bistros * 6 +
      (n.buildings?.workshops || 0) * 2 +
      Math.floor(n.meatballs * 0.45) +
      Math.floor(n.scrap * 0.25);
    const globalCeiling = Math.max(8, Math.floor(this.maxPopulation * 0.55));
    return Math.max(2, Math.min(landAndHousingCap, resourceCap, globalCeiling));
  }

  private markKingdomDepopulated(n: Nation, reason: string): void {
    if (!n.alive) return;
    n.alive = false;
    n.population = 0;
    n.armyCount = 0;
    n.armyCap = 0;
    n.reproductionRate = 0;
    n.reproductionProgress = 0;
    n.leader.alive = false;
    n.battlePlan = undefined;
    n.defeatedStatus = 'DEPOPULATED';
    n.defeatedDay = this.day;
    n.conqueredByNationId = null;
    n.conqueredByName = undefined;

    if (n.overlordId !== null) {
      const ov = this.getNation(n.overlordId);
      if (ov) ov.vassalIds = ov.vassalIds.filter((id) => id !== n.id);
      n.overlordId = null;
    }
    for (const vid of n.vassalIds) {
      const v = this.getNation(vid);
      if (v) v.overlordId = null;
    }
    n.vassalIds = [];

    for (const other of this.nations) {
      if (other.id !== n.id && other.relations[n.id]?.stance === 'WAR') {
        this.setRelation(n.id, other.id, 'NEUTRAL');
      }
    }

    this.dirtyMap = true;
    this.dirtyLight = true;
    this.forceMapRebuild = true;
    this.forceLightRebuild = true;
    this.addNews(
      'CONQUEST',
      `DEFEATED / DEPOPULATED: ${n.name} fell on Day ${this.day} (${reason}) — empty territory abandoned.`
    );
    this.addChronicle(
      'FALL',
      `${n.name} Depopulated`,
      `Marked Defeated / Depopulated on Day ${this.day}: ${reason}.`,
      '#94a3b8'
    );
    this.spawnFloatingText(n.capitalX, n.capitalY - 2, 'DEPOPULATED!', '#94a3b8');
  }

  private conquerEliminatedKingdom(victor: Nation, defeated: Nation, reason?: string): void {
    if (!defeated.alive) return;
    let transferred = 0;
    for (let i = 0; i < this.territory.length; i++) {
      if (this.territory[i] === defeated.id) {
        this.territory[i] = victor.id;
        transferred++;
      }
      if (this.propOwner[i] === defeated.id) {
        this.propOwner[i] = victor.id;
      }
    }
    const capIdx = defeated.capitalY * GRID_W + defeated.capitalX;
    if (this.prop[capIdx] === PropType.CHECKOUT_FLAG) {
      this.prop[capIdx] = PropType.SPOTLIGHT;
      this.propHp[capIdx] = 150;
      this.propMaxHp[capIdx] = 150;
      this.propOwner[capIdx] = victor.id;
    }

    for (const u of this.units) {
      if (u.alive && u.nationId === defeated.id) {
        u.nationId = victor.id;
        u.originNationId = victor.id;
        if (u.role === SurvivorRole.LEADER || u.role === SurvivorRole.GENERAL) {
          this.applyRoleStats(u, victor, SurvivorRole.GUARD);
          u.hasTarget = false;
        }
      }
    }

    if (defeated.overlordId !== null) {
      const ov = this.getNation(defeated.overlordId);
      if (ov) ov.vassalIds = ov.vassalIds.filter((id) => id !== defeated.id);
      defeated.overlordId = null;
    }
    for (const vid of defeated.vassalIds) {
      const v = this.getNation(vid);
      if (v) v.overlordId = null;
    }
    defeated.vassalIds = [];

    for (const other of this.nations) {
      if (other.id !== defeated.id && other.relations[defeated.id]?.stance === 'WAR') {
        this.setRelation(defeated.id, other.id, 'NEUTRAL');
      }
    }

    defeated.alive = false;
    defeated.population = 0;
    defeated.territoryTiles = 0;
    defeated.armyCount = 0;
    defeated.armyCap = 0;
    defeated.reproductionRate = 0;
    defeated.reproductionProgress = 0;
    defeated.leader.alive = false;
    defeated.battlePlan = undefined;
    defeated.defeatedStatus = 'CONQUERED';
    defeated.defeatedDay = this.day;
    defeated.conqueredByNationId = victor.id;
    defeated.conqueredByName = victor.name;

    victor.threatScore += 16;
    victor.warExhaustion = Math.max(0, victor.warExhaustion - 20);
    victor.meatballs += Math.round(defeated.meatballs * 0.5);
    victor.scrap += Math.round(defeated.scrap * 0.5);
    victor.allenWrenches += Math.round(defeated.allenWrenches * 0.4);
    defeated.meatballs = 0;
    defeated.scrap = 0;
    defeated.allenWrenches = 0;

    this.dirtyMap = true;
    this.dirtyLight = true;
    this.forceMapRebuild = true;
    this.forceLightRebuild = true;
    const msg =
      reason ||
      `${victor.name} conquered and eliminated ${defeated.name}${transferred > 0 ? ` (+${transferred} tiles)` : ''}!`;
    this.addNews('CONQUEST', msg);
    this.addChronicle(
      'CONQUEST',
      `${victor.name} Conquered ${defeated.name}`,
      `${defeated.name} was defeated and absorbed by ${victor.name} on Day ${this.day}.`,
      victor.color
    );
    this.spawnFloatingText(defeated.capitalX, defeated.capitalY - 2, 'CONQUERED!', victor.color);
    this.spawnParticleBurst(defeated.capitalX + 0.5, defeated.capitalY + 0.5, victor.color, 18);
  }

  private findWarFrontTarget(
    attacker: Nation,
    enemy: Nation,
    fromX: number,
    fromY: number
  ): { x: number; y: number } {
    const cacheKey = `${attacker.id}-${enemy.id}`;
    const cached = this.warFrontCache.get(cacheKey);
    if (cached && this.simTime - cached.simTime < 0.9) {
      return { x: cached.x, y: cached.y };
    }

    let bestX = enemy.capitalX + 0.5;
    let bestY = enemy.capitalY + 0.5;
    let bestDSq = Infinity;

    // 1. Prioritize nearest living enemy defender (to break defense & finish off weakened enemies)
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.alive || u.nationId !== enemy.id || u.kind !== UnitKind.SURVIVOR) continue;
      const isDef = u.role === SurvivorRole.GUARD || u.role === SurvivorRole.GENERAL || u.role === SurvivorRole.LEADER;
      const weight = isDef ? 0.7 : 1.0;
      const dSq = ((u.x - fromX) * (u.x - fromX) + (u.y - fromY) * (u.y - fromY)) * weight;
      if (dSq < bestDSq) {
        bestDSq = dSq;
        bestX = u.x;
        bestY = u.y;
      }
    }

    // 2. Also check nearest enemy border tile (stride 4 for crisp 60 FPS even during huge wars)
    let bestTileDSq = Infinity;
    let tileX = enemy.capitalX + 0.5;
    let tileY = enemy.capitalY + 0.5;
    for (let ty = 2; ty < GRID_H - 2; ty += 4) {
      const row = ty * GRID_W;
      for (let tx = 2; tx < GRID_W - 2; tx += 4) {
        if (this.territory[row + tx] === enemy.id) {
          const dSq = (tx - fromX) * (tx - fromX) + (ty - fromY) * (ty - fromY);
          if (dSq < bestTileDSq) {
            bestTileDSq = dSq;
            tileX = tx + 0.5;
            tileY = ty + 0.5;
          }
        }
      }
    }

    const res = bestTileDSq < bestDSq * 0.85 ? { x: tileX, y: tileY } : { x: bestX, y: bestY };
    this.warFrontCache.set(cacheKey, { x: res.x, y: res.y, simTime: this.simTime });
    return res;
  }

  private captureUndefendedEnemyPocket(
    attacker: Nation,
    gx: number,
    gy: number,
    captureRadius = 1
  ): number {
    const centerIdx = gy * GRID_W + gx;
    const centerOwner = this.territory[centerIdx];
    if (centerOwner < 0 || centerOwner === attacker.id) return 0;

    const enemyNation = this.getNation(centerOwner);
    if (!enemyNation) return 0;
    const enemyAlive = enemyNation.alive;
    if (enemyAlive && !this.areHostile(attacker.id, centerOwner)) return 0;

    // Check if any living military defender of enemyNation still defends this local tile/pocket
    if (enemyAlive) {
      let hasDefender = false;
      this.spatialHash.queryRadius(this.units, gx + 0.5, gy + 0.5, 4.5, (other, _idx, dSq) => {
        if (hasDefender) return;
        if (other.alive && other.nationId === centerOwner && other.kind === UnitKind.SURVIVOR) {
          if (
            other.role === SurvivorRole.GUARD ||
            other.role === SurvivorRole.GENERAL ||
            other.role === SurvivorRole.LEADER ||
            dSq < 2.2 * 2.2
          ) {
            hasDefender = true;
          }
        }
      });
      if (hasDefender) return 0;
    }

    let captured = 0;
    const rSq = captureRadius * captureRadius + 0.5;
    for (let dy = -captureRadius; dy <= captureRadius; dy++) {
      for (let dx = -captureRadius; dx <= captureRadius; dx++) {
        if (dx * dx + dy * dy > rSq) continue;
        const tx = gx + dx;
        const ty = gy + dy;
        if (tx < 1 || tx >= GRID_W - 1 || ty < 1 || ty >= GRID_H - 1) continue;
        if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 1) continue;
        const idx = ty * GRID_W + tx;
        if (this.territory[idx] === centerOwner) {
          // Do not steal an intact living Checkout Flag without breaking it first
          if (enemyAlive && this.prop[idx] === PropType.CHECKOUT_FLAG) continue;
          this.territory[idx] = attacker.id;
          if (this.propOwner[idx] === centerOwner && this.prop[idx] !== PropType.CHECKOUT_FLAG) {
            this.propOwner[idx] = attacker.id;
          }
          captured++;
        }
      }
    }

    if (captured > 0) {
      this.dirtyMap = true;
      this.dirtyLight = true;
      if (Math.random() < 0.08) {
        this.spawnFloatingText(gx + 0.5, gy - 0.8, `+${captured} Tiles`, attacker.color);
      }
    }
    return captured;
  }

  private attackEnemyFortification(attackerUnit: Unit, attackerNation: Nation): boolean {
    const tx = attackerUnit.x | 0;
    const ty = attackerUnit.y | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx <= 0 || nx >= GRID_W - 1 || ny <= 0 || ny >= GRID_H - 1) continue;
        const idx = ny * GRID_W + nx;
        const p = this.prop[idx];
        const pOwner = this.propOwner[idx];
        if (
          pOwner >= 0 &&
          pOwner !== attackerNation.id &&
          this.areHostile(attackerNation.id, pOwner) &&
          (p === PropType.BARRICADE_WALL ||
            p === PropType.BARRICADE_GATE ||
            p === PropType.WATCHTOWER ||
            p === PropType.CHECKOUT_FLAG)
        ) {
          if (attackerUnit.attackCooldown <= 0) {
            attackerUnit.attackCooldown = 0.55;
            const dmg = Math.round(attackerUnit.atk * 1.45);
            this.spawnParticleBurst(nx + 0.5, ny + 0.5, '#cbd5e1', 3);
            if (this.propHp[idx] > dmg) {
              this.propHp[idx] -= dmg;
            } else {
              const enemyNation = this.getNation(pOwner);
              if (p === PropType.CHECKOUT_FLAG && enemyNation && enemyNation.alive) {
                this.handleCapitalConquered(attackerNation, enemyNation);
                return true;
              }
              this.ejectBuildingOccupants(idx);
              this.prop[idx] = PropType.NONE;
              this.propHp[idx] = 0;
              this.propOwner[idx] = -1;
              this.territory[idx] = attackerNation.id;
              this.dirtyMap = true;
              this.dirtyLight = true;
            }
          }
          return true;
        }
      }
    }
    return false;
  }

  private recountTerritoryAndHousing(): void {
    for (const n of this.nations) {
      n.territoryTiles = 0;
      n.population = 0;
      n.armyCount = 0;
      n.armyCap = 0;
      n.buildingPattern = this.getKingdomBuildingPattern(n);
      n.jobs = {
        scavengers: 0,
        builders: 0,
        guards: 0,
        chefs: 0,
        tinkers: 0,
        traders: 0,
      };
      n.buildings = {
        huts: 0,
        bistros: 0,
        workshops: 0,
        archives: 0,
        depots: 0,
        watchtowers: 0,
        spotlights: 0,
      };
    }

    this.nationBuildingsCache.clear();
    this.lightSourceIndices = [];
    this.watchtowerIndices = [];

    for (let i = 0; i < this.territory.length; i++) {
      const tid = this.territory[i];
      if (tid >= 0 && tid < this.nations.length) {
        this.nations[tid].territoryTiles++;
      }
      const p = this.prop[i];
      if (p === PropType.NONE) continue;
      if (p === PropType.SPOTLIGHT || p === PropType.WATCHTOWER || p === PropType.CHECKOUT_FLAG) {
        this.lightSourceIndices.push(i);
      }
      if (p === PropType.WATCHTOWER) {
        this.watchtowerIndices.push(i);
      }
      const owner = this.propOwner[i];
      if (owner >= 0 && owner < this.nations.length) {
        const ownerNation = this.nations[owner];
        const b = ownerNation.buildings!;
        if (p === PropType.MATTRESS_HUT) b.huts++;
        else if (p === PropType.BISTRO) b.bistros++;
        else if (p === PropType.WORKSHOP) b.workshops++;
        else if (p === PropType.ARCHIVE) b.archives++;
        else if (p === PropType.CART_DEPOT) b.depots++;
        else if (p === PropType.WATCHTOWER) b.watchtowers++;
        else if (p === PropType.SPOTLIGHT) b.spotlights++;

        if (this.isEnterableBuilding(p)) {
          let arr = this.nationBuildingsCache.get(owner);
          if (!arr) {
            arr = [];
            this.nationBuildingsCache.set(owner, arr);
          }
          arr.push({ x: i % GRID_W, y: (i / GRID_W) | 0, idx: i, prop: p });
        }
      }
    }

    const nationGuards: Unit[][] = this.nations.map(() => []);
    const nationGenerals: Array<Unit | null> = this.nations.map(() => null);
    const nationCivilians: Unit[][] = this.nations.map(() => []);

    for (const u of this.units) {
      if (u.alive && u.nationId >= 0 && u.nationId < this.nations.length && u.kind === UnitKind.SURVIVOR) {
        const n = this.nations[u.nationId];
        n.population++;
        const j = n.jobs!;
        if (u.role === SurvivorRole.GENERAL) {
          if (!nationGenerals[u.nationId]) {
            nationGenerals[u.nationId] = u;
            j.guards++;
            n.armyCount = j.guards;
          } else {
            this.applyRoleStats(u, n, SurvivorRole.GUARD);
            j.guards++;
            n.armyCount = j.guards;
            nationGuards[u.nationId].push(u);
          }
        } else if (u.role === SurvivorRole.GUARD) {
          j.guards++;
          n.armyCount = j.guards;
          nationGuards[u.nationId].push(u);
        } else if (u.role === SurvivorRole.SCAVENGER) {
          j.scavengers++;
          nationCivilians[u.nationId].push(u);
        } else if (u.role === SurvivorRole.BUILDER) {
          j.builders++;
          nationCivilians[u.nationId].push(u);
        } else if (u.role === SurvivorRole.CHEF) {
          j.chefs++;
          nationCivilians[u.nationId].push(u);
        } else if (u.role === SurvivorRole.TINKER) {
          j.tinkers++;
          nationCivilians[u.nationId].push(u);
        } else if (u.role === SurvivorRole.TRADER) {
          j.traders++;
          nationCivilians[u.nationId].push(u);
        }
      }
    }

    const totalLivingPop = this.nations.reduce((sum, n) => sum + (n.alive ? n.population : 0), 0);
    if (totalLivingPop > this.records.peakPopulation) {
      this.records.peakPopulation = totalLivingPop;
      this.records.peakPopDay = this.day;
    }

    // Rebalance workforce, enforce Defeated/Depopulated states, & manage War Generals
    for (const n of this.nations) {
      if (!n.alive) {
        n.housingCap = 0;
        n.armyCap = 0;
        n.reproductionRate = 0;
        continue;
      }

      n.housingCap = this.computeTerritoryResourcePopCap(n);

      // Eliminate kingdom immediately if 0 territories OR 0 living people remain!
      if (n.territoryTiles <= 0) {
        const victor =
          n.lastAttackerNationId !== undefined && this.day - (n.lastAttackedDay ?? -99) <= 2
            ? this.getNation(n.lastAttackerNationId)
            : undefined;
        if (victor && victor.alive && victor.id !== n.id) {
          this.conquerEliminatedKingdom(victor, n, `${victor.name} captured the last territory of ${n.name}!`);
        } else {
          this.markKingdomDepopulated(n, 'lost all remaining territory');
        }
        continue;
      }

      if (n.population <= 0) {
        const victor =
          n.lastAttackerNationId !== undefined && this.day - (n.lastAttackedDay ?? -99) <= 1
            ? this.getNation(n.lastAttackerNationId)
            : undefined;
        if (victor && victor.alive && victor.id !== n.id && this.areHostile(victor.id, n.id)) {
          this.conquerEliminatedKingdom(
            victor,
            n,
            `${victor.name} eliminated the last defenders of ${n.name} and claimed its territory!`
          );
        } else {
          this.markKingdomDepopulated(n, 'all citizens perished');
        }
        continue;
      }

      n.armyCap = this.computeArmyCap(n);

      const warEnemies = this.nations.filter(
        (o) => o.alive && o.id !== n.id && this.getStance(n.id, o.id) === 'WAR'
      );
      const atWar = warEnemies.length > 0;

      if (n.population >= 6 && n.jobs) {
        const maxGuards = n.armyCap;
        const minGuards = Math.max(1, Math.floor(maxGuards * (atWar ? 0.85 : 0.7)));
        const guardsList = nationGuards[n.id];
        const civList = nationCivilians[n.id];

        if (n.jobs.guards > maxGuards + 1 && guardsList.length > 0) {
          const toConvert = Math.min(2, n.jobs.guards - maxGuards, guardsList.length);
          for (let k = 0; k < toConvert; k++) {
            const g = guardsList[k];
            const newRole = this.pickNeededJobForNation(n, false);
            this.applyRoleStats(g, n, newRole);
            g.hasTarget = false;
            n.jobs.guards--;
            n.armyCount = n.jobs.guards;
            if (newRole === SurvivorRole.SCAVENGER) n.jobs.scavengers++;
            else if (newRole === SurvivorRole.BUILDER) n.jobs.builders++;
            else if (newRole === SurvivorRole.CHEF) n.jobs.chefs++;
            else if (newRole === SurvivorRole.TINKER) n.jobs.tinkers++;
            else if (newRole === SurvivorRole.TRADER) n.jobs.traders++;
          }
        } else if (n.jobs.guards < minGuards && civList.length > 2) {
          const toRecruit = Math.min(2, minGuards - n.jobs.guards, civList.length - 2);
          for (let k = 0; k < toRecruit; k++) {
            const idx = civList.findIndex((c) => c.traits.includes('Brave') || c.traits.includes('Tough'));
            const recruit = idx >= 0 ? civList.splice(idx, 1)[0] : civList.shift();
            if (!recruit) break;
            if (recruit.role === SurvivorRole.SCAVENGER) n.jobs.scavengers--;
            else if (recruit.role === SurvivorRole.BUILDER) n.jobs.builders--;
            else if (recruit.role === SurvivorRole.CHEF) n.jobs.chefs--;
            else if (recruit.role === SurvivorRole.TINKER) n.jobs.tinkers--;
            else if (recruit.role === SurvivorRole.TRADER) n.jobs.traders--;
            this.applyRoleStats(recruit, n, SurvivorRole.GUARD);
            recruit.hasTarget = false;
            n.jobs.guards++;
            n.armyCount = n.jobs.guards;
            guardsList.push(recruit);
          }
        }
      }

      // Commission or stand down War General & update Battle Plan (NEVER spawn a General out of thin air)
      let general = nationGenerals[n.id];
      if (atWar) {
        const formation = this.getKingdomFormation(n);
        if (!general) {
          const guardsList = nationGuards[n.id];
          const civList = nationCivilians[n.id];
          if (guardsList.length > 0) {
            const idx = guardsList.findIndex((g) => g.traits.includes('Brave') || g.traits.includes('Tough'));
            general = idx >= 0 ? guardsList.splice(idx, 1)[0] : guardsList.shift()!;
            this.applyRoleStats(general, n, SurvivorRole.GENERAL);
            general.hasTarget = false;
          } else if (civList.length > 0 && n.population >= 2) {
            const recruit = civList.shift()!;
            if (n.jobs) {
              if (recruit.role === SurvivorRole.SCAVENGER) n.jobs.scavengers--;
              else if (recruit.role === SurvivorRole.BUILDER) n.jobs.builders--;
              else if (recruit.role === SurvivorRole.CHEF) n.jobs.chefs--;
              else if (recruit.role === SurvivorRole.TINKER) n.jobs.tinkers--;
              else if (recruit.role === SurvivorRole.TRADER) n.jobs.traders--;
              n.jobs.guards++;
              n.armyCount = n.jobs.guards;
            }
            this.applyRoleStats(recruit, n, SurvivorRole.GENERAL);
            recruit.hasTarget = false;
            general = recruit;
          }
          if (general) {
            general.chatEmoji = '🚩';
            general.chatTimer = 3.0;
            this.spawnFloatingText(general.x, general.y - 1.3, `GEN. ${general.name.split(' ')[0].toUpperCase()}`, n.color);
            this.addNews('WAR', `${n.name} commissioned General ${general.name} (${formation})!`);
          }
        }

        if (general) {
          // Pick nearest or weakest war enemy
          warEnemies.sort(
            (a, b) =>
              Math.hypot(a.capitalX - n.capitalX, a.capitalY - n.capitalY) +
              a.population * 2 -
              (Math.hypot(b.capitalX - n.capitalX, b.capitalY - n.capitalY) + b.population * 2)
          );
          const targetEnemy = warEnemies[0];
          const frontTarget = this.findWarFrontTarget(n, targetEnemy, general.x, general.y);
          const dx = frontTarget.x - n.capitalX;
          const dy = frontTarget.y - n.capitalY;
          const distTotal = Math.hypot(dx, dy) || 1;
          const fx = dx / distTotal;
          const fy = dy / distTotal;
          const rallyDist = Math.min(9, distTotal * 0.22);
          const rallyX = Math.max(4, Math.min(GRID_W - 4, n.capitalX + fx * rallyDist));
          const rallyY = Math.max(4, Math.min(GRID_H - 4, n.capitalY + fy * rallyDist));

          const guardsList = nationGuards[n.id];
          let nearbyCount = 0;
          for (let gi = 0; gi < guardsList.length; gi++) {
            guardsList[gi].formationSlot = gi;
            if (Math.hypot(guardsList[gi].x - general.x, guardsList[gi].y - general.y) <= 11.5) {
              nearbyCount++;
            }
          }

          const distToEnemy = Math.hypot(general.x - frontTarget.x, general.y - frontTarget.y);
          const enemyWeakened = targetEnemy.population <= 8 || (targetEnemy.armyCount || 0) <= 1;
          const prevPhase = n.battlePlan?.phase;
          let phase: BattlePhase = 'MARCH';
          if (this.isNight && distToEnemy > 18 && !enemyWeakened) {
            phase = 'REGROUP';
          } else if (distToEnemy <= 15 || enemyWeakened) {
            phase = 'SIEGE';
          } else if (
            guardsList.length >= 3 &&
            nearbyCount < Math.ceil(guardsList.length * 0.4) &&
            Math.hypot(general.x - n.capitalX, general.y - n.capitalY) < 16
          ) {
            phase = 'MUSTER';
          } else {
            phase = 'MARCH';
          }

          if (prevPhase && prevPhase !== phase) {
            const orderText =
              phase === 'MUSTER'
                ? 'FORM ROWS!'
                : phase === 'MARCH'
                  ? 'ADVANCE!'
                  : phase === 'SIEGE'
                    ? 'STORM THE AISLES!'
                    : 'REGROUP!';
            general.chatEmoji = '🚩';
            general.chatTimer = 2.4;
            this.spawnFloatingText(general.x, general.y - 1.3, orderText, n.color);
          }

          n.battlePlan = {
            generalUnitId: general.id,
            generalName: general.name,
            formation,
            phase,
            targetNationId: targetEnemy.id,
            rallyX,
            rallyY,
          };

          if (phase === 'SIEGE' && hasTech(n, 'siege_cart_rams')) {
            const hasRam = this.units.some(
              (u) => u.alive && u.kind === UnitKind.CART_RUNNER && u.isSiegeCart && u.nationId === n.id
            );
            if (!hasRam && n.scrap >= 10) {
              n.scrap -= 10;
              this.spawnSiegeCart(n, targetEnemy, general.x, general.y);
            }
          }
        }
      } else {
        if (general) {
          this.applyRoleStats(general, n, SurvivorRole.GUARD);
          general.hasTarget = false;
        }
        n.battlePlan = undefined;
      }
    }

    if (!this.hegemonyClaimed) {
      const totalClaimed = this.nations.reduce((sum, n) => sum + (n.alive ? n.territoryTiles : 0), 0);
      if (totalClaimed >= 400) {
        const hegemon = this.nations.find(
          (n) => n.alive && n.territoryTiles / totalClaimed >= 0.7
        );
        if (hegemon) {
          this.hegemonyClaimed = true;
          const pct = Math.round((hegemon.territoryTiles / totalClaimed) * 100);
          this.addNews(
            'UNION',
            `STORE HEGEMONY: ${hegemon.name} now commands ${pct}% of all claimed aisles!`
          );
          this.addChronicle(
            'UNION',
            `${hegemon.name} Achieves Store Hegemony`,
            `On Day ${this.day}, ${hegemon.name} consolidated ${pct}% of claimed territory across SCP-3008.`,
            '#ffda1a'
          );
          this.spawnFloatingText(
            hegemon.capitalX + 0.5,
            hegemon.capitalY - 2.0,
            'STORE HEGEMONY!',
            '#ffda1a'
          );
        }
      }
    }
  }

  private tickNationsEconomy(): void {
    const activeSurvivors = this.units.filter((u) => u.alive && u.kind === UnitKind.SURVIVOR).length;

    for (const n of this.nations) {
      if (!n.alive) continue;

      // Tech Tier upgrades
      if (n.allenWrenches >= TECH_THRESHOLDS[4] && n.techTier < 4) {
        n.techTier = 4;
        this.dirtyLight = true;
        this.addNews('COLONY', `${n.name} reached Tech Tier 4: ${TECH_TIER_NAMES[4]}!`);
      } else if (n.allenWrenches >= TECH_THRESHOLDS[3] && n.techTier < 3) {
        n.techTier = 3;
        this.dirtyLight = true;
        this.addNews('COLONY', `${n.name} reached Tech Tier 3: ${TECH_TIER_NAMES[3]}!`);
      } else if (n.allenWrenches >= TECH_THRESHOLDS[2] && n.techTier < 2) {
        n.techTier = 2;
        this.dirtyLight = true;
        this.addNews('COLONY', `${n.name} reached Tech Tier 2: ${TECH_TIER_NAMES[2]}!`);
      }

      // Passive Tax, Gov & IKEA Building Production effects
      const bld = n.buildings;
      const lingonMult = hasTech(n, 'lingonberry_kitchens') ? 1.4 : 1;
      if (bld) {
        // Meatball Bistros cook meatballs & raise happiness
        if (bld.bistros > 0) {
          n.meatballs += bld.bistros * 0.45 * lingonMult;
        }
        // Allen Wrench Workshops refine Wood/Scrap into Allen Wrenches
        if (bld.workshops > 0 && n.scrap >= bld.workshops * 0.3) {
          n.scrap -= bld.workshops * 0.25;
          n.allenWrenches += bld.workshops * 0.45;
        }
        // Billy Showroom Archives boost Tech & reduce war exhaustion
        if (bld.archives > 0) {
          n.allenWrenches += bld.archives * 0.35;
          n.warExhaustion = Math.max(0, n.warExhaustion - bld.archives * 0.15);
        }
      }

      // Research Tree progression driven by Tinkers, Billy Archives, and Government
      if (!n.researchedTechs) n.researchedTechs = [];
      if (!n.activeResearchId || n.researchedTechs.includes(n.activeResearchId)) {
        n.activeResearchId = this.pickBestResearchForNation(n);
        n.researchPoints = 0;
      }
      const tinkerCount = n.jobs?.tinkers || 0;
      const archiveCount = bld?.archives || 0;
      const govResBonus =
        n.government === 'Checkout Democracy'
          ? 0.45
          : n.government === 'Merchant Republic'
            ? 0.35
            : 0.2;
      const masteryMult = hasTech(n, 'blueprint_mastery') ? 1.3 : 1;
      const rRate = (0.55 + tinkerCount * 0.5 + archiveCount * 0.85 + (n.techTier - 1) * 0.25 + govResBonus) * masteryMult;
      n.researchRate = Number(rRate.toFixed(1));
      if (n.activeResearchId) {
        n.researchPoints = (n.researchPoints || 0) + rRate;
        const activeNode = RESEARCH_BY_ID[n.activeResearchId];
        if (activeNode && n.researchPoints >= activeNode.cost) {
          const completedId = activeNode.id;
          n.researchedTechs.push(completedId);
          n.researchPoints = Math.max(0, n.researchPoints - activeNode.cost);
          n.activeResearchId = this.pickBestResearchForNation(n);
          this.applyTechUnlockEffects(n, completedId, false);
        }
      }

      if (n.government === 'Checkout Democracy') {
        n.allenWrenches += 0.25;
      } else if (n.government === 'Merchant Republic') {
        n.allenWrenches += 0.35;
      }

      const taxBonus: Record<TaxRate, number> = {
        Low: 0,
        Normal: 0.15,
        High: 0.38,
        'War Tax': 0.65,
      };
      n.allenWrenches += taxBonus[n.taxRate];

      // Automatic Heuristic Tax adjustment
      const atWar = Object.values(n.relations).some((r) => r.stance === 'WAR');
      if (n.happiness < 35 && n.taxRate !== 'Low') {
        n.taxRate = 'Low';
      } else if (atWar && n.happiness > 60 && n.allenWrenches < 60 && n.taxRate !== 'War Tax') {
        n.taxRate = 'War Tax';
      } else if (!atWar && n.taxRate === 'War Tax') {
        n.taxRate = 'Normal';
      } else if (n.meatballs > 85 && n.happiness > 70 && n.taxRate === 'Normal') {
        n.taxRate = 'High';
      }

      // Happiness Math
      let happyDelta = 0;
      if (n.meatballs > n.population * 1.2) happyDelta += 0.9;
      else if (n.meatballs < 6) happyDelta -= 2.2;
      if (bld && bld.bistros > 0) happyDelta += Math.min(1.2, bld.bistros * 0.35);
      if (bld && bld.archives > 0) happyDelta += Math.min(1.0, bld.archives * 0.3);
      if (hasTech(n, 'lingonberry_kitchens')) happyDelta += 0.45;
      const unionCount = Object.values(n.relations).filter((r) => r.stance === 'UNION').length;
      if (unionCount > 0) happyDelta += Math.min(1.0, unionCount * 0.4);

      if (n.government === 'Checkout Democracy') happyDelta += 0.6;
      if (n.government === 'Iron Dictatorship') happyDelta -= 0.35;
      if (n.government === 'Meatball Theocracy' && this.isNight) happyDelta += 0.5;

      if (n.taxRate === 'Low') happyDelta += 0.8;
      else if (n.taxRate === 'High') happyDelta -= 0.7;
      else if (n.taxRate === 'War Tax') happyDelta -= 1.5;

      const capIdx = n.capitalY * GRID_W + n.capitalX;
      if (this.lightMap[capIdx]) happyDelta += 0.3;
      else if (this.isNight) happyDelta -= 1.2;

      if (n.warExhaustion > 40) happyDelta -= 0.9;

      n.happiness = Math.max(0, Math.min(100, n.happiness + happyDelta));

      // War exhaustion accumulation
      if (atWar) {
        n.warExhaustion = Math.min(100, n.warExhaustion + 0.75);
        for (const rel of Object.values(n.relations)) {
          if (rel.stance === 'WAR') rel.warExhaustion = Math.min(100, rel.warExhaustion + 0.85);
        }
      } else {
        n.warExhaustion = Math.max(0, n.warExhaustion - 0.5);
      }

      // Civil Wars, Separatist Breakaways & Coups if Happiness < 20%
      if (n.happiness < 20) {
        n.lowHappinessTimer++;
        if (n.lowHappinessTimer >= 7 && n.population >= 10 && this.day - n.recentCoupDay >= 1) {
          n.lowHappinessTimer = 0;
          const preferSeparatist =
            n.territoryTiles > 140 && n.population >= 14 ? 0.72 : 0.48;
          if (Math.random() < preferSeparatist && this.nations.length < 13) {
            this.triggerCivilWar(n);
          } else {
            this.triggerPalaceCoup(n);
          }
        }
      } else {
        n.lowHappinessTimer = Math.max(0, n.lowHappinessTimer - 1);
      }

      // True Population Reproduction: requires >= 2 living people, food, and territory/resource capacity
      // Tuned so kingdoms can meaningfully recover from Night Staff raids & wars without zombie respawns
      if (
        n.population >= 2 &&
        activeSurvivors < this.maxPopulation &&
        n.population < n.housingCap &&
        n.meatballs >= Math.max(5, n.population * 0.5) &&
        n.happiness >= 12
      ) {
        const popScale = 2.6 + Math.sqrt(n.population) * 2.15;
        const foodSurplusRatio = n.meatballs / Math.max(8, n.population * 1.0);
        const hutMult = 1 + Math.min(0.45, (bld?.huts || 0) * 0.08);
        const recoveryBoost = n.population < 8 && (bld?.huts || 0) > 0 ? 1.25 : 1.0;
        const lingonGrowth = lingonMult > 1 ? 0.15 : 0;
        const foodMult =
          Math.max(
            0.75,
            Math.min(
              1.9,
              0.8 + (foodSurplusRatio - 0.5) * 0.75 + Math.min(0.3, (bld?.bistros || 0) * 0.08) + lingonGrowth
            )
          ) *
          hutMult *
          recoveryBoost;
        const peaceBase = atWar ? 0.65 : 1.15;
        const happyFactor = n.happiness >= 70 ? 1.25 : n.happiness >= 40 ? 1.05 : 0.72;
        const exhaustionPenalty = n.warExhaustion > 55 ? 0.78 : 1.0;
        const nightFactor = this.isNight ? 0.85 : 1.0;
        const stabilityMult = peaceBase * happyFactor * exhaustionPenalty * nightFactor;
        const headroom = Math.max(0.28, 1 - (n.population / Math.max(1, n.housingCap)) * 0.65);
        const progressPerSec = popScale * foodMult * stabilityMult * headroom;

        n.reproductionRate = Number((progressPerSec * 0.6).toFixed(2));
        n.reproductionProgress = (n.reproductionProgress || 0) + progressPerSec;

        let birthsThisTick = 0;
        let currentLive = activeSurvivors;
        for (
          let b = 0;
          b < 2 &&
          n.reproductionProgress >= 100 &&
          currentLive < this.maxPopulation &&
          n.population < n.housingCap;
          b++
        ) {
          n.reproductionProgress -= 100;
          const foodCost = Math.min(n.meatballs * 0.22, Math.max(2, Math.round(2 + n.population * 0.08)));
          n.meatballs = Math.max(0, n.meatballs - foodCost);
          const role = this.pickNeededJobForNation(n, true);
          const sx = n.capitalX + (Math.random() - 0.5) * 3;
          const sy = n.capitalY + (Math.random() - 0.5) * 3;
          this.spawnSurvivor(n.id, role, sx, sy);
          n.population += 1;
          currentLive += 1;
          birthsThisTick++;
          this.spawnFloatingText(sx, sy - 1.2, '+1 Citizen', '#4ade80');
          this.spawnParticleBurst(sx, sy, '#4ade80', 4);
        }
        if (birthsThisTick > 0) {
          this.addNews(
            'GROWTH',
            `${n.name} grew (+${birthsThisTick}) to ${n.population}/${n.housingCap} citizens via population reproduction.`
          );
        }
      } else {
        n.reproductionRate = 0;
        if (n.population < 2) {
          n.reproductionProgress = 0;
        }
      }

      // Gradual outward territory expansion into unclaimed or abandoned/depopulated ruins
      if (n.population >= 2 && Math.random() < 0.38) {
        this.expandFrontierTerritory(n);
      }

      // Overcrowded Colony Split (can also colonize abandoned depopulated territory)
      if (
        n.population >= 32 &&
        n.meatballs >= 50 &&
        this.nations.filter((x) => x.alive).length < 10 &&
        Math.random() < 0.035
      ) {
        this.foundColony(n);
      }

      // Trade Caravan Spawning (Merchant Republic, Cart Depots, Union Pacts & Internal Union Hubs)
      n.cartCooldown -= 1;
      const depotBonus = Math.min(4, n.buildings?.depots || 0);
      const cartCadence = Math.max(4, (n.government === 'Merchant Republic' ? 7 : 12) - depotBonus);
      if (n.cartCooldown <= 0 && !this.isNight) {
        n.cartCooldown = cartCadence;
        const tradePartners: Nation[] = [];
        for (const other of this.nations) {
          if (!other.alive || other.id === n.id) continue;
          const st = this.getStance(n.id, other.id);
          if (st === 'UNION') {
            // Union partners trade twice as actively
            tradePartners.push(other, other);
          } else if (st === 'TRADE_PACT' || st === 'ALLIANCE') {
            tradePartners.push(other);
          }
        }
        const canRunInternalHub = n.unionHubs && n.unionHubs.length > 0;
        if (this.units.length < this.maxPopulation + 120) {
          if (canRunInternalHub && (tradePartners.length === 0 || Math.random() < 0.4)) {
            const hub = n.unionHubs![(Math.random() * n.unionHubs!.length) | 0];
            this.spawnTradeCart(n, n, { x: hub.x + 0.5, y: hub.y + 0.5, label: hub.name });
          } else if (tradePartners.length > 0) {
            const partner = tradePartners[(Math.random() * tradePartners.length) | 0];
            this.spawnTradeCart(n, partner);
          }
        }
      }

      // Dusk Saboteur Spawning (aggressive nations right before nightfall)
      n.sabotageCooldown -= 1;
      const duskWindow = !this.isNight && this.cycleTimer >= DAY_DURATION - 8;
      if (
        duskWindow &&
        n.sabotageCooldown <= 0 &&
        (n.ideology === 'Expansionist Empire' || n.government === 'Iron Dictatorship')
      ) {
        const enemies = this.nations.filter(
          (o) => o.alive && o.id !== n.id && this.getStance(n.id, o.id) === 'WAR'
        );
        if (enemies.length > 0 && Math.random() < 0.45) {
          n.sabotageCooldown = 25;
          const target = enemies[(Math.random() * enemies.length) | 0];
          this.spawnSaboteur(n, target);
        }
      }

      // Watchtower defense shots
      this.fireWatchtowersForNation(n);
    }
  }

  private fireWatchtowersForNation(n: Nation): void {
    const range = 10 + n.techTier * 1.5;
    const dmg = 12 + n.techTier * 5;
    for (let wi = 0; wi < this.watchtowerIndices.length; wi++) {
      const idx = this.watchtowerIndices[wi];
      if (this.propOwner[idx] !== n.id || this.prop[idx] !== PropType.WATCHTOWER) continue;
      if (this.disabledLightMap[idx] > 0) continue;
      const tx = idx % GRID_W;
      const ty = (idx / GRID_W) | 0;
      let closest: Unit | null = null;
      let bestDist = range * range;
      this.spatialHash.queryRadius(this.units, tx + 0.5, ty + 0.5, range, (u, _idx, dSq) => {
        const hostileStaff = this.isNight && u.kind >= UnitKind.STAFF_NORMAL;
        const hostileNation = u.nationId >= 0 && this.areHostile(n.id, u.nationId);
        if (hostileStaff || hostileNation) {
          if (dSq < bestDist) {
            bestDist = dSq;
            closest = u;
          }
        }
      });
      if (closest && this.projectiles.length < 160) {
        const target = closest as Unit;
        const dx = target.x - (tx + 0.5);
        const dy = target.y - (ty + 0.5);
        const d = Math.hypot(dx, dy) || 1;
        this.projectiles.push({
          x: tx + 0.5,
          y: ty + 0.5,
          vx: (dx / d) * 26,
          vy: (dy / d) * 26,
          damage: dmg,
          nationId: n.id,
          life: 0.7,
        });
      }
    }
  }

  public triggerPalaceCoup(n: Nation): void {
    const newGov = GOVERNMENTS.filter((g) => g !== n.government)[
      (Math.random() * (GOVERNMENTS.length - 1)) | 0
    ];
    n.government = newGov;
    n.happiness = 52;
    n.warExhaustion = Math.max(0, n.warExhaustion - 25);
    n.taxRate = 'Normal';
    n.recentCoupDay = this.day;
    this.replaceLeader(n, 'Palace Coup');
    this.addNews('POLITICS', `COUP in ${n.name}! ${n.leader.name} seized power and formed a ${newGov}!`);
    this.addChronicle(
      'COUP',
      `Palace Coup in ${n.name}`,
      `${n.leader.name} seized control and established a ${newGov}.`,
      '#c084fc'
    );
    this.spawnFloatingText(n.capitalX, n.capitalY - 2, 'PALACE COUP!', '#c084fc');
  }

  public triggerCivilWar(n: Nation): void {
    if (this.nations.length >= 14) {
      this.triggerPalaceCoup(n);
      return;
    }
    const nationUnits = this.units.filter(
      (u) => u.alive && u.nationId === n.id && u.kind === UnitKind.SURVIVOR && u.role !== SurvivorRole.LEADER
    );
    if (nationUnits.length < 6) {
      this.triggerPalaceCoup(n);
      return;
    }

    // Pick rebel capital at outer edge of nation's territory
    let rx = n.capitalX;
    let ry = n.capitalY;
    let maxDist = 0;
    for (const u of nationUnits) {
      const d = Math.hypot(u.x - n.capitalX, u.y - n.capitalY);
      if (d > maxDist) {
        maxDist = d;
        rx = Math.max(8, Math.min(GRID_W - 8, u.x | 0));
        ry = Math.max(8, Math.min(GRID_H - 8, u.y | 0));
      }
    }
    if (maxDist < 4) {
      rx = Math.max(8, Math.min(GRID_W - 8, n.capitalX + (Math.random() < 0.5 ? 12 : -12)));
      ry = Math.max(8, Math.min(GRID_H - 8, n.capitalY + (Math.random() < 0.5 ? 10 : -10)));
    }

    const pal = NATION_PALETTE[this.nextNationId % NATION_PALETTE.length];
    const rebelId = this.nextNationId++;
    const prefix = REBEL_PREFIXES[(Math.random() * REBEL_PREFIXES.length) | 0];
    const suffix = REBEL_SUFFIXES[(Math.random() * REBEL_SUFFIXES.length) | 0];
    const rebelName = `${prefix} ${suffix}`;

    // Flip outer ~40% of tiles closer to (rx, ry)
    for (let y = 0; y < GRID_H; y++) {
      const row = y * GRID_W;
      for (let x = 0; x < GRID_W; x++) {
        if (this.territory[row + x] === n.id) {
          const dOrig = Math.hypot(x - n.capitalX, y - n.capitalY);
          const dReb = Math.hypot(x - rx, y - ry);
          if (dReb < dOrig * 0.92) {
            this.territory[row + x] = rebelId;
            if (this.propOwner[row + x] === n.id && this.prop[row + x] !== PropType.CHECKOUT_FLAG) {
              this.propOwner[row + x] = rebelId;
            }
          }
        }
      }
    }

    // Place rebel capital flag & spotlight
    this.prop[ry * GRID_W + rx] = PropType.CHECKOUT_FLAG;
    this.propHp[ry * GRID_W + rx] = 350;
    this.propMaxHp[ry * GRID_W + rx] = 350;
    this.propOwner[ry * GRID_W + rx] = rebelId;
    this.territory[ry * GRID_W + rx] = rebelId;

    // Split ~40% of units
    const splitCount = Math.max(3, (nationUnits.length * 0.4) | 0);
    let rebelLeaderUnit: Unit | null = null;
    for (let i = 0; i < splitCount; i++) {
      const u = nationUnits[i];
      u.nationId = rebelId;
      u.originNationId = rebelId;
      if (i === 0) {
        u.role = SurvivorRole.LEADER;
        u.maxHp = 135;
        u.hp = 135;
        rebelLeaderUnit = u;
      }
    }

    const rebelNation: Nation = {
      id: rebelId,
      name: rebelName,
      color: pal.color,
      borderColor: pal.border,
      capitalX: rx,
      capitalY: ry,
      meatballs: Math.max(18, n.meatballs * 0.4),
      scrap: Math.max(18, n.scrap * 0.4),
      allenWrenches: Math.max(10, n.allenWrenches * 0.35),
      techTier: n.techTier,
      population: splitCount,
      housingCap: 22,
      territoryTiles: 35,
      ideology: IDEOLOGIES[(Math.random() * IDEOLOGIES.length) | 0],
      government: GOVERNMENTS[(Math.random() * GOVERNMENTS.length) | 0],
      taxRate: 'Low',
      happiness: 72,
      lowHappinessTimer: 0,
      warExhaustion: 0,
      threatScore: 4,
      overlordId: null,
      vassalIds: [],
      loyalty: 100,
      leader: {
        unitId: rebelLeaderUnit ? rebelLeaderUnit.id : -1,
        name: rebelLeaderUnit ? rebelLeaderUnit.name : randomName(),
        age: rebelLeaderUnit ? rebelLeaderUnit.age : 28,
        traits: rebelLeaderUnit ? rebelLeaderUnit.traits : ['Brave'],
        alive: true,
        crownedDay: this.day,
        kills: 0,
      },
      recentCoupDay: this.day,
      isRebel: true,
      lastQuote: 'No more War Taxes! Free the aisles!',
      relations: {},
      alive: true,
      foundedDay: this.day,
      sabotageCooldown: 5,
      cartCooldown: 8,
      researchedTechs: [],
      activeResearchId: null,
      researchPoints: 0,
      researchRate: 0,
    };

    n.meatballs *= 0.6;
    n.scrap *= 0.6;
    n.happiness = 45;
    n.recentCoupDay = this.day;

    this.nations.push(rebelNation);
    for (const other of this.nations) {
      if (other.id !== rebelId) {
        this.setRelation(rebelId, other.id, other.id === n.id ? 'WAR' : 'NEUTRAL');
      }
    }

    this.dirtyMap = true;
    this.dirtyLight = true;
    this.forceMapRebuild = true;
    this.forceLightRebuild = true;
    this.recountTerritoryAndHousing();
    this.addNews('WAR', `CIVIL WAR! ${rebelName} split from ${n.name}!`);
    this.addChronicle(
      'CIVIL_WAR',
      `${rebelName} Rebellion`,
      `${rebelName} broke away from ${n.name} in a bitter aisle civil war.`,
      pal.color
    );
    this.spawnFloatingText(rx, ry - 2, 'CIVIL WAR!', '#ef4444');
  }

  private expandFrontierTerritory(n: Nation): void {
    if (!n.alive || n.population < 2) return;
    let claimed = 0;
    let claimedDeadNation: Nation | undefined;

    // 1. Cast radial probes outward from capital to expand smoothly along borders
    for (let ray = 0; ray < 8 && claimed < 2; ray++) {
      const a = Math.random() * Math.PI * 2;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      let sawOwn = false;

      for (let r = 1; r <= 56; r++) {
        const tx = Math.round(n.capitalX + cosA * r);
        const ty = Math.round(n.capitalY + sinA * r);
        if (tx < 2 || tx >= GRID_W - 2 || ty < 2 || ty >= GRID_H - 2) break;
        if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 1) break;

        const idx = ty * GRID_W + tx;
        const owner = this.territory[idx];
        if (owner === n.id) {
          sawOwn = true;
          continue;
        }
        if (owner === -1 || (owner >= 0 && !this.nations[owner]?.alive)) {
          if (sawOwn) {
            const deadOwner = owner >= 0 ? this.getNation(owner) : undefined;
            this.territory[idx] = n.id;
            if (deadOwner && !deadOwner.alive) {
              if (this.prop[idx] === PropType.CHECKOUT_FLAG) {
                this.prop[idx] = PropType.SPOTLIGHT;
                this.propHp[idx] = 150;
                this.propMaxHp[idx] = 150;
              }
              if (this.propOwner[idx] === deadOwner.id) {
                this.propOwner[idx] = n.id;
              }
              claimedDeadNation = deadOwner;
            }
            claimed++;
          }
          break;
        }
        // Living neighbor territory blocks peaceful expansion
        break;
      }
    }

    // 2. Also expand around active citizens (helps detached enclaves or newly founded corners)
    if (claimed === 0) {
      for (let i = 0; i < this.units.length && claimed < 2; i++) {
        const u = this.units[i];
        if (!u.alive || u.nationId !== n.id || u.kind !== UnitKind.SURVIVOR) continue;
        if (Math.random() > 0.25) continue;
        const gx = u.x | 0;
        const gy = u.y | 0;
        if (gx < 2 || gx >= GRID_W - 2 || gy < 2 || gy >= GRID_H - 2) continue;
        if (Math.hypot(gx - SUMMIT_X, gy - SUMMIT_Y) <= SUMMIT_RADIUS + 1) continue;
        const idx = gy * GRID_W + gx;
        const owner = this.territory[idx];
        if (owner === -1 || (owner >= 0 && !this.nations[owner]?.alive)) {
          const deadOwner = owner >= 0 ? this.getNation(owner) : undefined;
          this.territory[idx] = n.id;
          if (deadOwner && !deadOwner.alive) {
            if (this.prop[idx] === PropType.CHECKOUT_FLAG) {
              this.prop[idx] = PropType.SPOTLIGHT;
              this.propHp[idx] = 150;
              this.propMaxHp[idx] = 150;
            }
            if (this.propOwner[idx] === deadOwner.id) {
              this.propOwner[idx] = n.id;
            }
            claimedDeadNation = deadOwner;
          }
          claimed++;
        }
      }
    }

    if (claimed > 0) {
      this.dirtyMap = true;
      this.dirtyLight = true;
      if (claimedDeadNation && Math.random() < 0.2) {
        this.addNews(
          'COLONY',
          `${n.name} claimed abandoned territory of fallen ${claimedDeadNation.name}.`
        );
      }
    }
  }

  private foundColony(parent: Nation): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = 28 + Math.random() * 18;
    const cx = Math.max(10, Math.min(GRID_W - 10, (parent.capitalX + Math.cos(angle) * dist) | 0));
    const cy = Math.max(10, Math.min(GRID_H - 10, (parent.capitalY + Math.sin(angle) * dist) | 0));
    if (Math.hypot(cx - SUMMIT_X, cy - SUMMIT_Y) <= SUMMIT_RADIUS + 5) return;

    const existingOwner = this.territory[cy * GRID_W + cx];
    const existingNation = existingOwner >= 0 ? this.getNation(existingOwner) : undefined;
    if (existingOwner !== -1 && existingNation?.alive) return;

    const nid = this.nextNationId++;
    const pal = NATION_PALETTE[nid % NATION_PALETTE.length];
    const cname = COLONY_NAMES[nid % COLONY_NAMES.length];

    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy <= 18) {
          const tx = cx + dx;
          const ty = cy + dy;
          if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 1) continue;
          const idx = ty * GRID_W + tx;
          const tOwner = this.territory[idx];
          if (tOwner !== -1 && this.nations[tOwner]?.alive) continue;
          this.prop[idx] = PropType.NONE;
          this.propOwner[idx] = -1;
          this.territory[idx] = nid;
        }
      }
    }

    this.prop[cy * GRID_W + cx] = PropType.CHECKOUT_FLAG;
    this.propHp[cy * GRID_W + cx] = 350;
    this.propMaxHp[cy * GRID_W + cx] = 350;
    this.propOwner[cy * GRID_W + cx] = nid;

    this.prop[cy * GRID_W + (cx + 2)] = PropType.SPOTLIGHT;
    this.propHp[cy * GRID_W + (cx + 2)] = 150;
    this.propMaxHp[cy * GRID_W + (cx + 2)] = 150;
    this.propOwner[cy * GRID_W + (cx + 2)] = nid;

    const leader = this.spawnSurvivor(nid, SurvivorRole.LEADER, cx + 0.5, cy + 1);
    const colonyRoles: SurvivorRole[] = [
      SurvivorRole.SCAVENGER,
      SurvivorRole.SCAVENGER,
      SurvivorRole.SCAVENGER,
      SurvivorRole.BUILDER,
      SurvivorRole.BUILDER,
      SurvivorRole.CHEF,
      SurvivorRole.TINKER,
      SurvivorRole.GUARD,
      SurvivorRole.GUARD,
    ];
    for (let i = 0; i < 9; i++) {
      this.spawnSurvivor(
        nid,
        colonyRoles[i] ?? SurvivorRole.SCAVENGER,
        cx + (Math.random() - 0.5) * 3,
        cy + (Math.random() - 0.5) * 3
      );
    }

    const colony: Nation = {
      id: nid,
      name: cname,
      color: pal.color,
      borderColor: pal.border,
      capitalX: cx,
      capitalY: cy,
      meatballs: 25,
      scrap: 25,
      allenWrenches: 10,
      techTier: parent.techTier,
      population: 10,
      housingCap: 20,
      territoryTiles: 45,
      ideology: parent.ideology,
      government: parent.government,
      taxRate: 'Normal',
      happiness: 78,
      lowHappinessTimer: 0,
      warExhaustion: 0,
      threatScore: 0,
      overlordId: parent.id,
      vassalIds: [],
      loyalty: 85,
      leader: {
        unitId: leader.id,
        name: leader.name,
        age: leader.age,
        traits: leader.traits,
        alive: true,
        crownedDay: this.day,
        kills: 0,
      },
      recentCoupDay: -10,
      isRebel: false,
      lastQuote: `Long live ${cname}, proud colony of ${parent.name}!`,
      relations: {},
      alive: true,
      foundedDay: this.day,
      sabotageCooldown: 5,
      cartCooldown: 6,
      researchedTechs: [...(parent.researchedTechs || [])],
      activeResearchId: null,
      researchPoints: 0,
      researchRate: 0,
      reproductionProgress: 0,
      reproductionRate: 0,
    };

    parent.meatballs -= 20;
    parent.vassalIds.push(nid);
    this.nations.push(colony);
    for (const o of this.nations) {
      if (o.id !== nid) {
        this.setRelation(nid, o.id, o.id === parent.id ? 'ALLIANCE' : 'NEUTRAL');
      }
    }
    this.dirtyMap = true;
    this.dirtyLight = true;
    this.forceMapRebuild = true;
    this.forceLightRebuild = true;
    this.recountTerritoryAndHousing();
    const colonizingRuins =
      existingNation && !existingNation.alive
        ? ` in the abandoned ruins of ${existingNation.name}`
        : '';
    this.addNews('COLONY', `${parent.name} founded a new colony: ${cname}${colonizingRuins}!`);
    this.addChronicle(
      'COLONY',
      `${cname} Colony Founded`,
      `Chartered by ${parent.name}${colonizingRuins} on Day ${this.day}.`,
      pal.color
    );
  }

  private foundIndependentKingdomFromSettlers(
    settlers: Unit[],
    rawCx: number,
    rawCy: number
  ): boolean {
    if (settlers.length < 2) return false;

    const cx = Math.max(8, Math.min(GRID_W - 8, rawCx | 0));
    const cy = Math.max(8, Math.min(GRID_H - 8, rawCy | 0));

    if (Math.hypot(cx - SUMMIT_X, cy - SUMMIT_Y) <= SUMMIT_RADIUS + 4) return false;
    if (
      this.nations.some(
        (n) => n.alive && Math.hypot(n.capitalX - cx, n.capitalY - cy) < 9
      )
    ) {
      return false;
    }

    const usedNames = new Set(this.nations.map((n) => n.name));
    const unusedPalettes = NATION_PALETTE.filter((p) => !this.nations.some((n) => n.alive && n.color === p.color));
    const pal =
      unusedPalettes[0] ?? NATION_PALETTE[this.nextNationId % NATION_PALETTE.length];
    const pickedName =
      SETTLER_KINGDOM_NAMES.find((name) => !usedNames.has(name)) ??
      `${pal.name.split(' ')[0]} Freehold ${this.nextNationId + 1}`;

    const nid = this.nextNationId++;
    let claimedTiles = 0;

    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 14) continue;
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx <= 1 || tx >= GRID_W - 1 || ty <= 1 || ty >= GRID_H - 1) continue;
        if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 1) continue;
        const idx = ty * GRID_W + tx;
        const existingOwner = this.territory[idx];
        if (existingOwner >= 0 && this.nations[existingOwner]?.alive) continue;
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
          this.prop[idx] = PropType.NONE;
          this.propOwner[idx] = -1;
        } else if (this.prop[idx] === PropType.CHECKOUT_FLAG) {
          this.prop[idx] = PropType.NONE;
          this.propOwner[idx] = -1;
        }
        this.territory[idx] = nid;
        claimedTiles++;
      }
    }

    if (claimedTiles < 6) {
      // Revert if space was completely blocked
      for (let i = 0; i < this.territory.length; i++) {
        if (this.territory[i] === nid) this.territory[i] = -1;
      }
      this.nextNationId--;
      return false;
    }

    this.placeNationProp(cx, cy, PropType.CHECKOUT_FLAG, 350, nid);
    this.territory[cy * GRID_W + cx] = nid;
    if (this.territory[cy * GRID_W + (cx + 2)] === nid) {
      this.placeNationProp(cx + 2, cy, PropType.SPOTLIGHT, 150, nid);
    }

    const gov = GOVERNMENTS[nid % GOVERNMENTS.length];
    const ideology = IDEOLOGIES[nid % IDEOLOGIES.length];

    const newNation: Nation = {
      id: nid,
      name: pickedName,
      color: pal.color,
      borderColor: pal.border,
      capitalX: cx,
      capitalY: cy,
      meatballs: 24 + settlers.length * 3,
      scrap: 24 + settlers.length * 3,
      allenWrenches: 12 + settlers.length * 2,
      techTier: 1,
      population: settlers.length,
      housingCap: 16,
      territoryTiles: claimedTiles,
      ideology,
      government: gov,
      taxRate: 'Normal',
      happiness: 80,
      lowHappinessTimer: 0,
      warExhaustion: 0,
      threatScore: 0,
      overlordId: null,
      vassalIds: [],
      loyalty: 100,
      leader: {
        unitId: settlers[0].id,
        name: settlers[0].name,
        age: settlers[0].age,
        traits: settlers[0].traits,
        alive: true,
        crownedDay: this.day,
        kills: settlers[0].kills,
      },
      recentCoupDay: -10,
      isRebel: false,
      lastQuote: `From the uncharted aisles, ${pickedName} rises independent and free!`,
      relations: {},
      alive: true,
      foundedDay: this.day,
      sabotageCooldown: 6,
      cartCooldown: 6,
      researchedTechs: [],
      activeResearchId: null,
      researchPoints: 0,
      researchRate: 0,
      reproductionProgress: 0,
      reproductionRate: 0,
    };

    const settlerRoles: SurvivorRole[] = [
      SurvivorRole.SCAVENGER,
      SurvivorRole.BUILDER,
      SurvivorRole.CHEF,
      SurvivorRole.GUARD,
      SurvivorRole.TINKER,
      SurvivorRole.TRADER,
    ];
    for (let i = 0; i < settlers.length; i++) {
      const s = settlers[i];
      s.nationId = nid;
      s.originNationId = nid;
      s.canFoundKingdom = false;
      s.settleTimer = 0;
      s.hasTarget = false;
      const role = i === 0 ? SurvivorRole.LEADER : settlerRoles[(i - 1) % settlerRoles.length];
      this.applyRoleStats(s, newNation, role);
    }

    this.nations.push(newNation);
    for (const o of this.nations) {
      if (o.id !== nid) {
        this.setRelation(nid, o.id, 'NEUTRAL');
      }
    }

    this.dirtyMap = true;
    this.dirtyLight = true;
    this.forceMapRebuild = true;
    this.forceLightRebuild = true;
    this.recountTerritoryAndHousing();
    this.addNews(
      'FOUNDING',
      `NEW KINGDOM FOUNDED: ${pickedName} (${gov}) established by ${settlers.length} independent settlers!`
    );
    this.addChronicle(
      'FOUNDING',
      `${pickedName} Founded`,
      `${settlers.length} unclaimed settlers united on Day ${this.day} under ${newNation.leader.name} (${gov}).`,
      pal.color
    );
    this.spawnFloatingText(cx + 0.5, cy - 1.5, `NEW KINGDOM: ${pickedName.toUpperCase()}!`, pal.color);
    this.spawnParticleBurst(cx + 0.5, cy + 0.5, pal.color, 18);
    soundFX.playPower();
    return true;
  }

  public replaceLeader(n: Nation, cause: string): void {
    const candidates = this.units.filter(
      (u) => u.alive && u.nationId === n.id && u.kind === UnitKind.SURVIVOR
    );
    if (candidates.length === 0) {
      // Never spawn a zombie leader out of thin air when no living citizens remain
      n.leader.alive = false;
      return;
    }

    const chosen = candidates[(Math.random() * candidates.length) | 0];
    chosen.role = SurvivorRole.LEADER;
    chosen.maxHp = 140;
    chosen.hp = 140;
    chosen.atk = 14;

    let method = 'Council Selection';
    if (n.government === 'Checkout Democracy') method = 'Checkout Election';
    else if (n.government === 'Iron Dictatorship') {
      method = 'General Takeover';
      n.happiness = Math.max(5, n.happiness - 10);
    } else if (n.government === 'Merchant Republic') method = 'Richest Trader Guild';
    else if (n.government === 'Meatball Theocracy') method = 'High Priest Conclave';

    n.leader = {
      unitId: chosen.id,
      name: chosen.name,
      age: chosen.age,
      traits: chosen.traits,
      alive: true,
      crownedDay: this.day,
      kills: chosen.kills,
    };

    this.addNews('POLITICS', `${cause}: ${chosen.name} crowned in ${n.name} via ${method}!`);
  }

  // ==================== SPAWNERS ====================

  public spawnSurvivor(
    nationId: number,
    role: SurvivorRole,
    x: number,
    y: number,
    traitsOverride?: UnitTrait[]
  ): Unit {
    const traits = traitsOverride ?? randomTraits(1);
    const isLeader = role === SurvivorRole.LEADER;
    const isGeneral = role === SurvivorRole.GENERAL;
    const isGuard = role === SurvivorRole.GUARD;
    const n = nationId >= 0 ? this.getNation(nationId) : undefined;
    const tierHpBonus = n ? (n.techTier - 1) * 14 : 0;
    const govHpBonus = n?.government === 'Iron Dictatorship' && (isGuard || isGeneral) ? 15 : 0;
    const baseHp = (isLeader ? 140 : isGeneral ? 135 : isGuard ? 95 : 70) + tierHpBonus + govHpBonus;
    const maxHp = traits.includes('Tough') ? Math.round(baseHp * 1.35) : baseHp;
    const speed = traits.includes('Speedy') ? 5.6 : 4.3;

    const u: Unit = {
      id: this.nextUnitId++,
      kind: UnitKind.SURVIVOR,
      role,
      nationId,
      x: Math.max(1.5, Math.min(GRID_W - 1.5, x)),
      y: Math.max(1.5, Math.min(GRID_H - 1.5, y)),
      vx: 0,
      vy: 0,
      hp: maxHp,
      maxHp,
      atk: (isLeader ? 14 : isGeneral ? 13 : isGuard ? 11 : 6) + (n ? (n.techTier - 1) * 2 : 0),
      speed,
      name: randomName(),
      age: 19 + ((Math.random() * 28) | 0),
      kills: 0,
      hunger: 10,
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
      aiTimer: Math.random() * 0.3,
      chatEmoji: '',
      chatTimer: 0,
      alive: true,
    };
    this.units.push(u);
    return u;
  }

  public spawnTradeCart(
    origin: Nation,
    dest: Nation,
    customDest?: { x: number; y: number; label?: string }
  ): Unit {
    const startDepot = this.findNearestFriendlyBuilding(origin.id, origin.capitalX, origin.capitalY, 22, [
      PropType.CART_DEPOT,
    ]);
    const destTileX = customDest ? customDest.x | 0 : dest.capitalX;
    const destTileY = customDest ? customDest.y | 0 : dest.capitalY;
    const endDepot = this.findNearestFriendlyBuilding(dest.id, destTileX, destTileY, 22, [
      PropType.CART_DEPOT,
    ]);
    const sx = startDepot ? startDepot.x + 0.5 : origin.capitalX + 0.5;
    const sy = startDepot ? startDepot.y + 0.9 : origin.capitalY + 0.5;
    const tx = customDest ? customDest.x : endDepot ? endDepot.x + 0.5 : dest.capitalX + 0.5;
    const ty = customDest ? customDest.y : endDepot ? endDepot.y + 0.9 : dest.capitalY + 0.5;

    const u: Unit = {
      id: this.nextUnitId++,
      kind: UnitKind.CART_RUNNER,
      role: SurvivorRole.TRADER,
      nationId: origin.id,
      x: sx,
      y: sy,
      vx: 0,
      vy: 0,
      hp: 85,
      maxHp: 85,
      atk: 4,
      speed: 5.0,
      name: `Cart Runner ${randomName().split(' ')[0]}`,
      age: 24,
      kills: 0,
      hunger: 5,
      traits: ['Speedy'],
      carryType: 'wrench',
      carryAmount: 12,
      targetNationId: dest.id,
      originNationId: origin.id,
      targetX: tx,
      targetY: ty,
      hasTarget: true,
      stuckTimer: 0,
      lastCheckX: sx,
      lastCheckY: sy,
      attackCooldown: 0,
      hitFlash: 0,
      feverTimer: 0,
      aiTimer: 0,
      chatEmoji: '',
      chatTimer: 0,
      alive: true,
    };
    this.units.push(u);
    return u;
  }

  public spawnSiegeCart(origin: Nation, enemy: Nation, sx: number, sy: number): Unit {
    const u: Unit = {
      id: this.nextUnitId++,
      kind: UnitKind.CART_RUNNER,
      role: SurvivorRole.GUARD,
      nationId: origin.id,
      x: sx,
      y: sy,
      vx: 0,
      vy: 0,
      hp: 240,
      maxHp: 240,
      atk: 26,
      speed: 3.4,
      name: `${origin.name.split(' ')[0]} Siege Cart`,
      age: 30,
      kills: 0,
      hunger: 0,
      traits: ['Tough'],
      carryType: 'none',
      carryAmount: 0,
      targetNationId: enemy.id,
      originNationId: origin.id,
      targetX: enemy.capitalX + 0.5,
      targetY: enemy.capitalY + 0.5,
      hasTarget: true,
      stuckTimer: 0,
      lastCheckX: sx,
      lastCheckY: sy,
      attackCooldown: 0,
      hitFlash: 0,
      feverTimer: 0,
      aiTimer: 0,
      chatEmoji: '🛒',
      chatTimer: 2.0,
      isSiegeCart: true,
      alive: true,
    };
    this.units.push(u);
    this.spawnFloatingText(sx, sy - 1.2, 'SIEGE CART!', origin.color);
    return u;
  }

  public spawnSaboteur(origin: Nation, target: Nation): Unit {
    const u: Unit = {
      id: this.nextUnitId++,
      kind: UnitKind.SABOTEUR,
      role: SurvivorRole.GUARD,
      nationId: origin.id,
      x: origin.capitalX + 0.5,
      y: origin.capitalY + 0.5,
      vx: 0,
      vy: 0,
      hp: 80,
      maxHp: 80,
      atk: 10,
      speed: 5.8,
      name: `Saboteur ${randomName().split(' ')[0]}`,
      age: 27,
      kills: 0,
      hunger: 10,
      traits: ['Speedy'],
      carryType: 'none',
      carryAmount: 0,
      targetNationId: target.id,
      originNationId: origin.id,
      targetX: target.capitalX + 2,
      targetY: target.capitalY,
      hasTarget: true,
      stuckTimer: 0,
      lastCheckX: origin.capitalX,
      lastCheckY: origin.capitalY,
      attackCooldown: 0,
      hitFlash: 0,
      feverTimer: 0,
      aiTimer: 0,
      chatEmoji: '',
      chatTimer: 0,
      alive: true,
    };
    this.units.push(u);
    return u;
  }

  public spawnStaff(kind: UnitKind.STAFF_NORMAL | UnitKind.STAFF_CRAWLER | UnitKind.STAFF_MANAGER, x: number, y: number): Unit {
    const hpScale = 1 + (this.day - 1) * 0.12;
    const isMgr = kind === UnitKind.STAFF_MANAGER;
    const isCrw = kind === UnitKind.STAFF_CRAWLER;
    const maxHp = Math.round((isMgr ? 420 : isCrw ? 65 : 105) * hpScale);
    const u: Unit = {
      id: this.nextUnitId++,
      kind,
      role: SurvivorRole.GUARD,
      nationId: -1,
      x: Math.max(1.5, Math.min(GRID_W - 1.5, x)),
      y: Math.max(1.5, Math.min(GRID_H - 1.5, y)),
      vx: 0,
      vy: 0,
      hp: maxHp,
      maxHp,
      atk: isMgr ? 26 : isCrw ? 10 : 14,
      speed: isMgr ? 3.5 : isCrw ? 6.4 : 4.6,
      name: isMgr ? 'SCP-3008-2 Manager Brute' : isCrw ? 'SCP-3008-2 Crawler' : 'SCP-3008-2 Staff',
      age: 0,
      kills: 0,
      hunger: 0,
      traits: [],
      carryType: 'none',
      carryAmount: 0,
      targetNationId: -1,
      originNationId: -1,
      targetX: x,
      targetY: y,
      hasTarget: false,
      stuckTimer: 0,
      lastCheckX: x,
      lastCheckY: y,
      attackCooldown: 0,
      hitFlash: 0,
      feverTimer: 0,
      aiTimer: Math.random() * 0.3,
      chatEmoji: '',
      chatTimer: 0,
      alive: true,
    };
    this.units.push(u);
    return u;
  }

  private spawnNightStaffWave(): void {
    const staffCount = this.units.filter((u) => u.alive && u.kind >= UnitKind.STAFF_NORMAL && u.kind <= UnitKind.STAFF_MANAGER).length;
    const maxStaff = Math.min(180 + this.day * 28, (this.maxPopulation * 0.25) | 0);
    if (staffCount >= maxStaff) return;

    // Fair spawning rule: NEVER inside lit Spotlight/Watchtower/Flag radiuses
    for (let attempt = 0; attempt < 18; attempt++) {
      const tx = 4 + ((Math.random() * (GRID_W - 8)) | 0);
      const ty = 4 + ((Math.random() * (GRID_H - 8)) | 0);
      const idx = ty * GRID_W + tx;
      if (this.lightMap[idx] === 0 && this.prop[idx] === PropType.NONE) {
        const roll = Math.random();
        const kind =
          this.day >= 3 && roll < 0.06
            ? UnitKind.STAFF_MANAGER
            : roll < 0.34
              ? UnitKind.STAFF_CRAWLER
              : UnitKind.STAFF_NORMAL;
        this.spawnStaff(kind, tx + 0.5, ty + 0.5);
        if (Math.random() < 0.22) {
          this.spawnFloatingText(tx, ty - 1, 'The store is closed', '#fde047');
        }
        return;
      }
    }
  }

  // ==================== UNIT AI, ANTI-STUCK & COMBAT ====================

  private updateUnit(u: Unit, dt: number): void {
    if (u.hitFlash > 0) u.hitFlash = Math.max(0, u.hitFlash - dt);
    if (u.attackCooldown > 0) u.attackCooldown = Math.max(0, u.attackCooldown - dt);
    if (u.feverTimer > 0) u.feverTimer = Math.max(0, u.feverTimer - dt);
    if ((u.visitCooldown ?? 0) > 0) u.visitCooldown = Math.max(0, (u.visitCooldown ?? 0) - dt);
    if (u.chatTimer > 0) {
      u.chatTimer = Math.max(0, u.chatTimer - dt);
      if (u.chatTimer === 0) u.chatEmoji = '';
    }

    // Active building occupancy (resting in huts, cooking in bistros, crafting in workshops, etc.)
    if ((u.insideTimer ?? 0) > 0) {
      const bIdx = u.insideBuildingIdx ?? -1;
      const nation = u.nationId >= 0 ? this.getNation(u.nationId) : undefined;
      const propType = bIdx >= 0 && bIdx < GRID_W * GRID_H ? this.prop[bIdx] : PropType.NONE;
      const validBuilding =
        Boolean(nation && nation.alive) &&
        bIdx >= 0 &&
        this.propOwner[bIdx] === u.nationId &&
        this.isEnterableBuilding(propType) &&
        !(u.role === SurvivorRole.GUARD && nation?.battlePlan);

      if (!validBuilding) {
        const bx = bIdx >= 0 ? bIdx % GRID_W : u.x | 0;
        const by = bIdx >= 0 ? (bIdx / GRID_W) | 0 : u.y | 0;
        u.insideTimer = 0;
        u.insideBuildingIdx = -1;
        u.visitTargetIdx = -1;
        u.hasTarget = false;
        u.x = Math.max(1.2, Math.min(GRID_W - 1.2, bx + 0.5));
        u.y = Math.max(1.2, Math.min(GRID_H - 1.2, by + 0.92));
      } else {
        const bx = bIdx % GRID_W;
        const by = (bIdx / GRID_W) | 0;
        u.x = bx + 0.5;
        u.y = by + 0.5;
        u.vx = 0;
        u.vy = 0;
        u.insideTimer = Math.max(0, (u.insideTimer ?? 0) - dt);

        if (propType === PropType.MATTRESS_HUT || propType === PropType.BISTRO) {
          u.hunger = Math.max(0, u.hunger - dt * 6);
          u.hp = Math.min(u.maxHp, u.hp + dt * 5);
        }

        if ((u.insideTimer ?? 0) <= 0) {
          if (propType === PropType.MATTRESS_HUT) {
            u.hunger = Math.max(0, u.hunger - 35);
            u.hp = Math.min(u.maxHp, u.hp + 28);
            u.chatEmoji = '💤';
            u.chatTimer = 1.6;
          } else if (propType === PropType.BISTRO) {
            if (nation) {
              const lingonMult = hasTech(nation, 'lingonberry_kitchens') ? 1.4 : 1;
              nation.meatballs += 2.4 * lingonMult;
            }
            u.hunger = 0;
            u.hp = Math.min(u.maxHp, u.hp + 14);
            u.chatEmoji = '🍖';
            u.chatTimer = 1.8;
          } else if (propType === PropType.WORKSHOP) {
            if (nation) {
              nation.allenWrenches += 1.6;
            }
            u.chatEmoji = '🔧';
            u.chatTimer = 1.8;
          } else if (propType === PropType.ARCHIVE) {
            if (nation) {
              nation.allenWrenches += 1.0;
              if (nation.activeResearchId) {
                nation.researchPoints = (nation.researchPoints || 0) + 1.8;
              }
            }
            u.chatEmoji = '📖';
            u.chatTimer = 1.8;
          } else if (propType === PropType.CART_DEPOT) {
            if (nation) {
              nation.allenWrenches += 2.0;
            }
            u.chatEmoji = '🛒';
            u.chatTimer = 1.8;
          } else if (propType === PropType.WATCHTOWER) {
            u.chatEmoji = '🛡️';
            u.chatTimer = 1.6;
          }

          u.x = Math.max(1.2, Math.min(GRID_W - 1.2, bx + 0.5));
          u.y = Math.max(1.2, Math.min(GRID_H - 1.2, by + 0.92));
          u.insideBuildingIdx = -1;
          u.visitTargetIdx = -1;
          u.hasTarget = false;
          u.visitCooldown = 7 + Math.random() * 8;
        }
        return;
      }
    }

    // Hunger & Food consumption for survivors
    if (u.kind === UnitKind.SURVIVOR) {
      u.hunger = Math.min(100, u.hunger + dt * 0.7);
      if (u.hunger > 55 && u.nationId >= 0) {
        const n = this.getNation(u.nationId);
        if (n && n.meatballs >= 1) {
          n.meatballs -= 1;
          u.hunger = 0;
          u.hp = Math.min(u.maxHp, u.hp + 12);
        }
      }
      if (!this.isNight && u.hp < u.maxHp && u.nationId >= 0) {
        const uTile = Math.max(0, Math.min(GRID_W * GRID_H - 1, (u.y | 0) * GRID_W + (u.x | 0)));
        if (this.lightMap[uTile] === 1 && this.territory[uTile] === u.nationId) {
          const n = this.getNation(u.nationId);
          if (hasTech(n, 'fluorescent_ward')) {
            u.hp = Math.min(u.maxHp, u.hp + dt * 2.2);
          }
        }
      }
    }

    // Trade Cart Runner AI
    if (u.kind === UnitKind.CART_RUNNER) {
      this.updateCartRunner(u, dt);
      return;
    }

    // Saboteur AI
    if (u.kind === UnitKind.SABOTEUR) {
      this.updateSaboteur(u, dt);
      return;
    }

    // Staff AI
    if (u.kind >= UnitKind.STAFF_NORMAL && u.kind <= UnitKind.STAFF_MANAGER) {
      this.updateStaffUnit(u, dt);
      return;
    }

    // Survivor AI
    this.updateSurvivorUnit(u, dt);
  }

  private updateCartRunner(u: Unit, dt: number): void {
    const dest = this.getNation(u.targetNationId);
    const origin = this.getNation(u.originNationId);
    if (!dest || !dest.alive || !origin || !origin.alive) {
      u.alive = false;
      this.deadUnitsCount++;
      return;
    }

    // Armored Siege Cart Battering Ram logic
    if (u.isSiegeCart) {
      const distToEnemy = Math.hypot(u.x - dest.capitalX, u.y - dest.capitalY);
      const enemyWeakened = dest.population <= 8 || (dest.armyCount || 0) <= 1;
      if (this.getStance(origin.id, dest.id) !== 'WAR' || (this.isNight && distToEnemy > 16 && !enemyWeakened)) {
        u.alive = false;
        this.deadUnitsCount++;
        return;
      }
      const frontTarget = this.findWarFrontTarget(origin, dest, u.x, u.y);
      u.targetX = frontTarget.x;
      u.targetY = frontTarget.y;
      this.moveTowards(u, u.targetX, u.targetY, dt, 1.0);

      const tx = u.x | 0;
      const ty = u.y | 0;
      this.captureUndefendedEnemyPocket(origin, tx, ty, 1);

      // Smash hostile barricades, watchtowers, & checkout flags
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx <= 0 || nx >= GRID_W - 1 || ny <= 0 || ny >= GRID_H - 1) continue;
          const idx = ny * GRID_W + nx;
          const p = this.prop[idx];
          const pOwner = this.propOwner[idx];
          if (
            pOwner === dest.id &&
            (p === PropType.BARRICADE_WALL ||
              p === PropType.BARRICADE_GATE ||
              p === PropType.WATCHTOWER ||
              p === PropType.CHECKOUT_FLAG)
          ) {
            if (u.attackCooldown <= 0) {
              u.attackCooldown = 0.7;
              this.spawnParticleBurst(nx + 0.5, ny + 0.5, '#cbd5e1', 5);
              if (this.propHp[idx] > 36) {
                this.propHp[idx] -= 36;
              } else {
                this.ejectBuildingOccupants(idx);
                this.prop[idx] = PropType.NONE;
                this.propHp[idx] = 0;
                this.propOwner[idx] = -1;
                if (p === PropType.CHECKOUT_FLAG) {
                  this.handleCapitalConquered(origin, dest);
                  u.alive = false;
                  this.deadUnitsCount++;
                  return;
                }
                this.territory[idx] = origin.id;
                this.dirtyMap = true;
                this.dirtyLight = true;
              }
            }
            return;
          }
        }
      }

      // Ram hostile guards in melee range
      this.spatialHash.queryRadius(this.units, u.x, u.y, 1.9, (other) => {
        if (other.kind === UnitKind.SURVIVOR && other.nationId >= 0 && this.areHostile(origin.id, other.nationId)) {
          if (u.attackCooldown <= 0) {
            u.attackCooldown = 0.75;
            this.damageUnit(other, u.atk, u);
          }
        }
      });
      return;
    }

    // Check Embargo (internal union hub carts have origin.id === dest.id and are never embargoed)
    if (
      origin.id !== dest.id &&
      (this.getStance(origin.id, dest.id) === 'EMBARGO' || this.areHostile(origin.id, dest.id))
    ) {
      // Return home if embargoed
      u.targetNationId = origin.id;
      u.targetX = origin.capitalX + 0.5;
      u.targetY = origin.capitalY + 0.5;
    }

    if (!u.hasTarget) {
      u.hasTarget = true;
      if (origin.id !== dest.id) {
        u.targetX = dest.capitalX + 0.5;
        u.targetY = dest.capitalY + 0.5;
      }
    }

    const railSpeed = hasTech(origin, 'automated_cart_rails') || hasTech(dest, 'automated_cart_rails') ? 1.55 : 1.15;
    this.moveTowards(u, u.targetX, u.targetY, dt, railSpeed);

    // Ambush check by hostile guards
    let ambushed = false;
    this.spatialHash.queryRadius(this.units, u.x, u.y, 2.2, (other) => {
      if (ambushed) return;
      if (other.kind === UnitKind.SURVIVOR && other.nationId >= 0 && this.areHostile(other.nationId, u.nationId)) {
        if (u.attackCooldown <= 0) {
          u.hp -= 18;
          u.hitFlash = 0.15;
          u.attackCooldown = 0.35;
          if (u.hp <= 0) {
            u.alive = false;
            this.deadUnitsCount++;
            ambushed = true;
            const looter = this.getNation(other.nationId);
            if (looter) {
              looter.meatballs += 14;
              looter.scrap += 14;
              looter.allenWrenches += 10;
              this.addNews('WAR', `${looter.name} ambushed & looted a ${origin.name} trade cart!`);
              this.spawnFloatingText(u.x, u.y, 'CART LOOTED!', '#f87171');
            }
          }
        }
      }
    });
    if (!u.alive) return;

    if (Math.hypot(u.x - u.targetX, u.y - u.targetY) < 2.2) {
      // Arrived at destination capital or united city hub!
      const isUnionTrade = origin.id === dest.id || this.getStance(origin.id, dest.id) === 'UNION';
      const isMerchant = origin.government === 'Merchant Republic' || dest.government === 'Merchant Republic';
      const depotBonus = Math.min(6, (origin.buildings?.depots || 0) + (dest.buildings?.depots || 0));
      const railMult = hasTech(origin, 'automated_cart_rails') || hasTech(dest, 'automated_cart_rails') ? 2 : 1;
      const wrenchGain = ((isMerchant ? 10 : 7) + depotBonus + (isUnionTrade ? 4 : 0)) * railMult;
      if (origin.id === dest.id) {
        origin.meatballs += 10 * railMult;
        origin.scrap += 10 * railMult;
        origin.allenWrenches += wrenchGain;
        this.spawnFloatingText(u.x, u.y - 1, '+Union Supply!', '#fbbf24');
      } else {
        dest.meatballs += 8 * railMult;
        dest.scrap += 8 * railMult;
        dest.allenWrenches += wrenchGain;
        origin.allenWrenches += wrenchGain;
        this.spawnFloatingText(
          u.x,
          u.y - 1,
          isUnionTrade ? '+Union Trade!' : railMult > 1 ? '+2x Trade!' : '+Trade!',
          isUnionTrade ? '#fbbf24' : '#38bdf8'
        );
      }
      u.alive = false;
      this.deadUnitsCount++;
    }
  }

  private updateSaboteur(u: Unit, dt: number): void {
    const target = this.getNation(u.targetNationId);
    if (!target || !target.alive) {
      u.alive = false;
      this.deadUnitsCount++;
      return;
    }
    this.moveTowards(u, target.capitalX + 1, target.capitalY, dt, 1.25);

    const tx = u.x | 0;
    const ty = u.y | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx <= 0 || nx >= GRID_W - 1 || ny <= 0 || ny >= GRID_H - 1) continue;
        const idx = ny * GRID_W + nx;
        if (this.prop[idx] === PropType.SPOTLIGHT && this.propOwner[idx] === target.id && this.disabledLightMap[idx] === 0) {
          if (target.government === 'Meatball Theocracy' && Math.random() < 0.5) {
            this.spawnFloatingText(nx, ny, 'Sabotage Resisted!', '#fbbf24');
          } else {
            this.disabledLightMap[idx] = 22;
            this.dirtyLight = true;
            this.addNews('STAFF', `A ${this.getNation(u.originNationId)?.name || 'rival'} Saboteur disabled ${target.name}'s Spotlight!`);
            this.spawnFloatingText(nx, ny, 'LIGHT CUT!', '#f43f5e');
          }
          u.alive = false;
          this.deadUnitsCount++;
          return;
        }
      }
    }
  }

  private updateStaffUnit(u: Unit, dt: number): void {
    // Daytime ("Store Open"): SCP-3008-2 Staff are passive and calmly patrol aisles
    if (!this.isNight) {
      u.aiTimer -= dt;
      if (!u.hasTarget || u.aiTimer <= 0 || Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1.5) {
        u.aiTimer = 3.0 + Math.random() * 2.5;
        u.targetX = Math.max(4, Math.min(GRID_W - 4, u.x + (Math.random() - 0.5) * 24));
        u.targetY = Math.max(4, Math.min(GRID_H - 4, u.y + (Math.random() - 0.5) * 24));
        u.hasTarget = true;
      }
      this.moveTowards(u, u.targetX, u.targetY, dt, 0.55);
      return;
    }

    // Nighttime ("The store is now closed"): Staff turn lethal and hunt survivors & buildings
    const isAudit = this.day % 10 === 0;
    const sightRad = isAudit ? 19 : 16;
    const uTileIdx = Math.max(0, Math.min(GRID_W * GRID_H - 1, (u.y | 0) * GRID_W + (u.x | 0)));
    const tileOwner = this.territory[uTileIdx];
    const wardSlow =
      this.lightMap[uTileIdx] === 1 &&
      tileOwner >= 0 &&
      hasTech(this.getNation(tileOwner), 'fluorescent_ward')
        ? 0.72
        : 1.0;
    const nightSpeed = (isAudit ? 1.32 : 1.18) * wardSlow;

    let enemy: Unit | null = null;
    let bestDSq = sightRad * sightRad;
    this.spatialHash.queryRadius(this.units, u.x, u.y, sightRad, (other, _idx, dSq) => {
      if ((other.insideTimer ?? 0) > 0) return;
      if (other.kind === UnitKind.SURVIVOR || other.kind === UnitKind.CART_RUNNER) {
        if (dSq < bestDSq) {
          bestDSq = dSq;
          enemy = other;
        }
      }
    });

    if (enemy) {
      const target = enemy as Unit;
      if (bestDSq <= 1.75 * 1.75) {
        if (u.attackCooldown <= 0) {
          u.attackCooldown = u.kind === UnitKind.STAFF_CRAWLER ? 0.38 : 0.58;
          this.damageUnit(target, Math.round(u.atk * 1.2), u);
        }
      } else {
        this.moveTowards(u, target.x, target.y, dt, nightSpeed);
      }
      return;
    }

    // Attack adjacent barricades/buildings if blocking path at night
    const tx = u.x | 0;
    const ty = u.y | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx <= 0 || nx >= GRID_W - 1 || ny <= 0 || ny >= GRID_H - 1) continue;
        const idx = ny * GRID_W + nx;
        const p = this.prop[idx];
        if (
          p === PropType.BARRICADE_WALL ||
          p === PropType.BARRICADE_GATE ||
          p === PropType.SPOTLIGHT ||
          p === PropType.MATTRESS_HUT ||
          p === PropType.WATCHTOWER ||
          p === PropType.BISTRO ||
          p === PropType.WORKSHOP ||
          p === PropType.ARCHIVE ||
          p === PropType.CART_DEPOT
        ) {
          if (u.attackCooldown <= 0) {
            u.attackCooldown = 0.65;
            if (this.propHp[idx] > u.atk) {
              this.propHp[idx] -= u.atk;
            } else {
              this.ejectBuildingOccupants(idx);
              this.prop[idx] = PropType.NONE;
              this.propHp[idx] = 0;
              this.propOwner[idx] = -1;
              this.dirtyLight = true;
            }
          }
          return;
        }
      }
    }

    // Converge on nearest nation capital at night
    u.aiTimer -= dt;
    if (!u.hasTarget || u.aiTimer <= 0) {
      u.aiTimer = 1.8 + Math.random();
      const aliveNations = this.nations.filter((n) => n.alive);
      if (aliveNations.length > 0) {
        let nearest = aliveNations[0];
        let minD = Infinity;
        for (const n of aliveNations) {
          const d = Math.hypot(n.capitalX - u.x, n.capitalY - u.y);
          if (d < minD) {
            minD = d;
            nearest = n;
          }
        }
        u.targetX = nearest.capitalX + (Math.random() - 0.5) * 6;
        u.targetY = nearest.capitalY + (Math.random() - 0.5) * 6;
        u.hasTarget = true;
      }
    }
    this.moveTowards(u, u.targetX, u.targetY, dt, 1.15);
  }

  private updateSurvivorUnit(u: Unit, dt: number): void {
    const nation = u.nationId >= 0 ? this.getNation(u.nationId) : undefined;
    const speedMult = u.feverTimer > 0 ? 1.65 : 1.0;

    // Unclaimed / Independent people: stay local & found their own kingdom instead of running across the map
    if (!nation || !nation.alive) {
      if (u.nationId >= 0) {
        u.role = SurvivorRole.REFUGEE;
        u.nationId = -1;
        u.canFoundKingdom = false;
        u.settleTimer = 0;
      }

      // Self-defense against Night Staff nearby
      let staffThreat: Unit | null = null;
      let staffBestDSq = 36;
      if (this.isNight || u.feverTimer > 0) {
        this.spatialHash.queryRadius(this.units, u.x, u.y, 6, (other, _idx, dSq) => {
          if (other.kind >= UnitKind.STAFF_NORMAL && other.kind <= UnitKind.STAFF_MANAGER && dSq < staffBestDSq) {
            staffBestDSq = dSq;
            staffThreat = other;
          }
        });
      }
      if (staffThreat) {
        const threat = staffThreat as Unit;
        if (staffBestDSq <= 1.7 * 1.7) {
          if (u.attackCooldown <= 0) {
            u.attackCooldown = 0.65;
            this.damageUnit(threat, u.atk, u);
          }
        } else {
          this.moveTowards(u, threat.x, threat.y, dt, speedMult);
        }
        return;
      }

      // Player-placed unclaimed settlers gather locally and found a brand-new kingdom
      if (u.canFoundKingdom) {
        u.settleTimer = (u.settleTimer || 0) + dt;
        const tileIdx = Math.max(0, Math.min(GRID_W * GRID_H - 1, (u.y | 0) * GRID_W + (u.x | 0)));
        const tileOwner = this.territory[tileIdx];
        const onLivingNation = tileOwner >= 0 && Boolean(this.nations[tileOwner]?.alive);
        const inSummit = Math.hypot(u.x - SUMMIT_X, u.y - SUMMIT_Y) <= SUMMIT_RADIUS + 4;

        if (!onLivingNation && !inSummit && u.settleTimer >= 1.1) {
          const nearbySettlers: Unit[] = [];
          let sumX = 0;
          let sumY = 0;
          this.spatialHash.queryRadius(this.units, u.x, u.y, 11, (other) => {
            if (other.kind === UnitKind.SURVIVOR && other.nationId === -1 && other.canFoundKingdom) {
              nearbySettlers.push(other);
              sumX += other.x;
              sumY += other.y;
            }
          });
          if (nearbySettlers.length >= 2) {
            const avgX = sumX / nearbySettlers.length;
            const avgY = sumY / nearbySettlers.length;
            if (this.foundIndependentKingdomFromSettlers(nearbySettlers, avgX, avgY)) {
              return;
            }
          } else if (u.settleTimer >= 2.2 && u.settleTimer < 2.2 + dt * 1.4) {
            this.spawnFloatingText(u.x, u.y - 1.1, 'Add 1 more settler to found', '#fbbf24');
          }
        }
      }

      // Gentle local wander/forage around current position (never cross-map migration)
      u.aiTimer -= dt;
      if (!u.hasTarget || u.aiTimer <= 0 || Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1.2) {
        u.aiTimer = 2.0 + Math.random() * 2.0;
        const radius = u.canFoundKingdom ? 3.5 : 8.0;
        const a = Math.random() * Math.PI * 2;
        u.targetX = Math.max(3, Math.min(GRID_W - 3, u.x + Math.cos(a) * radius));
        u.targetY = Math.max(3, Math.min(GRID_H - 3, u.y + Math.sin(a) * radius));
        u.hasTarget = true;
      }
      if (u.hasTarget) this.moveTowards(u, u.targetX, u.targetY, dt, speedMult * 0.75);
      return;
    }

    // 0. Leaders traveling to or seated at the Summit Lounge get priority safe passage
    if (
      u.role === SurvivorRole.LEADER &&
      (this.summitLoungeSessionActive || (!this.isNight && this.summitActiveTimer > 0))
    ) {
      const atWar = Object.values(nation.relations).some((r) => r.stance === 'WAR');
      if (this.summitLoungeSessionActive || !atWar) {
        const invitedNations = this.nations.filter(
          (n) =>
            n.alive &&
            n.leader.alive &&
            (this.summitLoungeSessionActive ||
              !Object.values(n.relations).some((r) => r.stance === 'WAR'))
        );
        const seatIdx = Math.max(0, invitedNations.findIndex((p) => p.id === nation.id));
        const couchOffsets: Array<[number, number]> = [
          [-2, 0],
          [2, 0],
          [0, -2],
          [0, 2],
          [-1.6, -1.6],
          [1.6, 1.6],
          [-1.6, 1.6],
          [1.6, -1.6],
        ];
        let sx = SUMMIT_X + 0.5;
        let sy = SUMMIT_Y + 0.5;
        if (seatIdx < couchOffsets.length) {
          sx = SUMMIT_X + 0.5 + couchOffsets[seatIdx][0];
          sy = SUMMIT_Y + 0.5 + couchOffsets[seatIdx][1];
        } else {
          const totalSeats = Math.max(1, invitedNations.length);
          const seatAngle = (seatIdx / totalSeats) * Math.PI * 2;
          sx = SUMMIT_X + 0.5 + Math.cos(seatAngle) * 2.5;
          sy = SUMMIT_Y + 0.5 + Math.sin(seatAngle) * 2.5;
        }
        const distToSeat = Math.hypot(u.x - sx, u.y - sy);
        const distToLounge = Math.hypot(u.x - (SUMMIT_X + 0.5), u.y - (SUMMIT_Y + 0.5));

        if (distToSeat > 0.65) {
          const prevX = u.x;
          const prevY = u.y;
          const travelSpeed = distToLounge > 10 ? 2.4 : 1.5;
          this.moveTowards(u, sx, sy, dt, travelSpeed);
          if (Math.hypot(u.x - prevX, u.y - prevY) < 0.01 && distToSeat > 0.35) {
            const d = distToSeat;
            u.x = Math.max(2, Math.min(GRID_W - 2, u.x + ((sx - u.x) / d) * u.speed * dt * 1.6));
            u.y = Math.max(2, Math.min(GRID_H - 2, u.y + ((sy - u.y) / d) * u.speed * dt * 1.6));
          }
        } else {
          // Seated comfortably on the showroom couch
          u.vx = 0;
          u.vy = 0;
        }

        if (!this.summitLoungeSessionActive && distToLounge < 5.0) {
          u.aiTimer -= dt;
          if (u.aiTimer <= 0) {
            u.aiTimer = 2.2 + Math.random() * 1.6;
            const emojis = ['💬', '☕', '🤝', '🍖', '🔧'];
            u.chatEmoji = emojis[(Math.random() * emojis.length) | 0];
            u.chatTimer = 2.2;
            const summitLines = [
              'Meatball pact?',
              'Open cart lanes!',
              'Share wrenches?',
              'Build spotlights!',
              'Watch the Dark Sector',
              'Fair trade!',
              'Peace in IKEA!',
              'Hold Aisle 7!',
            ];
            this.spawnFloatingText(
              u.x,
              u.y - 1.2,
              summitLines[(Math.random() * summitLines.length) | 0],
              nation.color
            );
          }
        }
        return;
      }
    }

    // Actively capture undefended enemy/abandoned border pockets as soldiers advance
    if (
      u.role === SurvivorRole.GUARD ||
      u.role === SurvivorRole.GENERAL ||
      u.role === SurvivorRole.LEADER ||
      u.feverTimer > 0
    ) {
      this.captureUndefendedEnemyPocket(
        nation,
        Math.max(1, Math.min(GRID_W - 2, u.x | 0)),
        Math.max(1, Math.min(GRID_H - 2, u.y | 0)),
        u.role === SurvivorRole.GENERAL ? 2 : 1
      );
    }

    // 1. Combat Check: fight Staff or Hostile Nations nearby
    const searchRad =
      u.role === SurvivorRole.GUARD || u.role === SurvivorRole.GENERAL || u.feverTimer > 0 ? 11 : 6.5;
    let nearestHostile: Unit | null = null;
    let bestDistSq = searchRad * searchRad;

    this.spatialHash.queryRadius(this.units, u.x, u.y, searchRad, (other, _idx, dSq) => {
      if ((other.insideTimer ?? 0) > 0) return;
      const isStaff =
        (this.isNight || u.feverTimer > 0) &&
        other.kind >= UnitKind.STAFF_NORMAL &&
        other.kind <= UnitKind.STAFF_MANAGER;
      const isEnemy =
        other.nationId >= 0 &&
        other.nationId !== u.nationId &&
        (this.areHostile(u.nationId, other.nationId) || u.feverTimer > 0);
      if (isStaff || isEnemy) {
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          nearestHostile = other;
        }
      }
    });

    if (nearestHostile) {
      const enemy = nearestHostile as Unit;
      const isBrave =
        u.role === SurvivorRole.GUARD ||
        u.role === SurvivorRole.GENERAL ||
        u.role === SurvivorRole.LEADER ||
        u.traits.includes('Brave') ||
        u.traits.includes('Blessed') ||
        u.feverTimer > 0 ||
        nation.government === 'Meatball Theocracy';

      if (isBrave || bestDistSq < 16) {
        if (bestDistSq <= 1.7 * 1.7) {
          if (u.attackCooldown <= 0) {
            u.attackCooldown = u.feverTimer > 0 ? 0.32 : 0.6;
            const dmg = u.atk + (u.traits.includes('Blessed') ? 8 : 0) + (u.feverTimer > 0 ? 6 : 0);
            this.damageUnit(enemy, dmg, u);
          }
        } else {
          if (
            (u.role === SurvivorRole.GUARD || u.role === SurvivorRole.GENERAL) &&
            this.attackEnemyFortification(u, nation)
          ) {
            return;
          }
          this.moveTowards(u, enemy.x, enemy.y, dt, speedMult * 1.1);
        }
        return;
      }
    }

    // 1b. Continue walking into a chosen friendly building doorway if en route
    if (this.enterBuildingIfArrived(u, nation, dt, speedMult)) {
      return;
    }

    // 1c. Nighttime shelter / injured / hungry civilian visits to huts & bistros
    if (
      (u.visitCooldown ?? 0) <= 0 &&
      u.carryAmount === 0 &&
      u.buildProp === undefined &&
      u.role !== SurvivorRole.GUARD &&
      u.role !== SurvivorRole.GENERAL &&
      u.role !== SurvivorRole.LEADER &&
      (this.isNight || u.hp < u.maxHp * 0.72 || u.hunger > 52)
    ) {
      const types =
        u.hunger > 52
          ? [PropType.BISTRO, PropType.MATTRESS_HUT]
          : [PropType.MATTRESS_HUT, PropType.BISTRO];
      const shelter = this.findNearestFriendlyBuilding(nation.id, u.x | 0, u.y | 0, 26, types);
      if (shelter) {
        u.visitTargetIdx = shelter.idx;
        u.targetX = shelter.x + 0.5;
        u.targetY = shelter.y + 0.88;
        u.hasTarget = true;
        this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);
        return;
      } else {
        u.visitCooldown = 4 + Math.random() * 3;
      }
    }

    // 2. Role-specific behavior
    if (u.role === SurvivorRole.LEADER) {
      // Periodically inspect kingdom Archives/Bistros or patrol around Checkout Flag
      if ((u.visitCooldown ?? 0) <= 0 && !this.summitLoungeSessionActive && Math.random() < dt * 0.22) {
        const civic = this.findNearestFriendlyBuilding(nation.id, u.x | 0, u.y | 0, 22, [
          PropType.ARCHIVE,
          PropType.BISTRO,
        ]);
        if (civic) {
          u.visitTargetIdx = civic.idx;
          u.targetX = civic.x + 0.5;
          u.targetY = civic.y + 0.88;
          u.hasTarget = true;
          this.moveTowards(u, u.targetX, u.targetY, dt, speedMult * 0.9);
          return;
        } else {
          u.visitCooldown = 4 + Math.random() * 3;
        }
      }

      u.aiTimer -= dt;
      if (!u.hasTarget || u.aiTimer <= 0 || Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1) {
        u.aiTimer = 2.0 + Math.random() * 2;
        const a = Math.random() * Math.PI * 2;
        const r = 1.5 + Math.random() * 4.5;
        u.targetX = nation.capitalX + Math.cos(a) * r;
        u.targetY = nation.capitalY + Math.sin(a) * r;
        u.hasTarget = true;
      }
      this.moveTowards(u, u.targetX, u.targetY, dt, speedMult * 0.85);
      return;
    }

    // Zero-lag Emoji Chat when citizens are resting / not carrying cargo
    if (!this.isNight && u.carryAmount === 0 && u.chatTimer <= 0 && Math.random() < dt * 0.035) {
      u.chatEmoji =
        u.hunger > 60
          ? '🍖'
          : CITIZEN_EMOJIS[(Math.random() * CITIZEN_EMOJIS.length) | 0];
      u.chatTimer = 2.3;
    }

    if (u.role === SurvivorRole.SCAVENGER) {
      // Carry resource back to capital
      if (u.carryAmount > 0) {
        this.moveTowards(u, nation.capitalX + 0.5, nation.capitalY + 0.5, dt, speedMult);
        if (Math.hypot(u.x - nation.capitalX, u.y - nation.capitalY) < 2.3) {
          if (u.carryType === 'meatball') nation.meatballs += u.carryAmount;
          else if (u.carryType === 'scrap') nation.scrap += u.carryAmount;
          else if (u.carryType === 'wrench') nation.allenWrenches += u.carryAmount;
          u.carryAmount = 0;
          u.carryType = 'none';
          u.hasTarget = false;
        }
        return;
      }

      // Rest or eat inside a hut/bistro occasionally between scavenging trips
      if (!u.hasTarget && (u.visitCooldown ?? 0) <= 0 && Math.random() < 0.28) {
        const restSpot = this.findNearestFriendlyBuilding(nation.id, u.x | 0, u.y | 0, 22, [
          PropType.MATTRESS_HUT,
          PropType.BISTRO,
        ]);
        if (restSpot) {
          u.visitTargetIdx = restSpot.idx;
          u.targetX = restSpot.x + 0.5;
          u.targetY = restSpot.y + 0.88;
          u.hasTarget = true;
          this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);
          return;
        } else {
          u.visitCooldown = 4 + Math.random() * 3;
        }
      }

      // Find nearest resource prop
      if (!u.hasTarget) {
        const found = this.findNearestResource(u.x | 0, u.y | 0, 22);
        if (found) {
          u.targetX = found.x + 0.5;
          u.targetY = found.y + 0.5;
          u.hasTarget = true;
        } else {
          u.targetX = Math.max(4, Math.min(GRID_W - 4, u.x + (Math.random() - 0.5) * 18));
          u.targetY = Math.max(4, Math.min(GRID_H - 4, u.y + (Math.random() - 0.5) * 18));
          u.hasTarget = true;
        }
      }

      this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);
      if (Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1.6) {
        const tx = u.targetX | 0;
        const ty = u.targetY | 0;
        const idx = ty * GRID_W + tx;
        const p = this.prop[idx];
        const hoarderBonus = u.traits.includes('Hoarder') ? 3 : 0;
        const joineryMult = hasTech(nation, 'flatpack_joinery') ? 1.35 : 1;
        if (p === PropType.MEATBALL_VAT) {
          u.carryType = 'meatball';
          u.carryAmount = Math.round((6 + hoarderBonus) * joineryMult);
          if (this.propHp[idx] > 20) this.propHp[idx] -= 20;
          else this.prop[idx] = PropType.NONE;
        } else if (p === PropType.SHELF || p === PropType.WOOD_PALLET) {
          u.carryType = Math.random() < 0.42 ? 'wrench' : 'scrap';
          u.carryAmount = Math.round(((u.carryType === 'wrench' ? 4 : 6) + hoarderBonus) * joineryMult);
          if (this.propHp[idx] > 22) this.propHp[idx] -= 22;
          else this.prop[idx] = PropType.NONE;
        } else if (p === PropType.COUCH || p === PropType.BED || p === PropType.LAMP) {
          u.carryType = 'scrap';
          u.carryAmount = Math.round((5 + hoarderBonus) * joineryMult);
          this.prop[idx] = PropType.NONE;
        }
        u.hasTarget = false;
      }
      return;
    }

    if (u.role === SurvivorRole.BUILDER) {
      // Builders dismantle IKEA furniture for lumber/wrenches and construct kingdom-specific city patterns
      u.aiTimer -= dt;
      const tx = Math.max(1, Math.min(GRID_W - 2, u.x | 0));
      const ty = Math.max(1, Math.min(GRID_H - 2, u.y | 0));
      const idx = ty * GRID_W + tx;
      const inSummitZone = Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 1;

      if (!u.hasTarget) {
        u.buildProp = undefined;
        u.buildVariant = undefined;
      }

      // Claim tile under feet if unowned or abandoned/depopulated & outside Neutral Summit Lounge
      const footOwner = this.territory[idx];
      if (!inSummitZone && (footOwner === -1 || (footOwner >= 0 && !this.nations[footOwner]?.alive))) {
        if (footOwner >= 0 && this.prop[idx] === PropType.CHECKOUT_FLAG) {
          this.prop[idx] = PropType.SPOTLIGHT;
          this.propOwner[idx] = nation.id;
          this.dirtyLight = true;
        }
        this.territory[idx] = nation.id;
        this.dirtyMap = true;
      }

      // Repair damaged friendly structures during daytime
      if (!this.isNight && this.propOwner[idx] === nation.id && this.propHp[idx] < this.propMaxHp[idx]) {
        this.propHp[idx] = Math.min(this.propMaxHp[idx], this.propHp[idx] + 25);
      }

      // At night, stay inside lit capital radius instead of wandering into Dark Sectors
      if (this.isNight && Math.hypot(u.x - nation.capitalX, u.y - nation.capitalY) > 7 && this.lightMap[idx] === 0) {
        u.buildProp = undefined;
        u.hasTarget = false;
        this.moveTowards(u, nation.capitalX + 0.5, nation.capitalY + 0.5, dt, speedMult);
        return;
      }

      const builderSpeedMult = speedMult * (hasTech(nation, 'flatpack_joinery') ? 1.18 : 1.0);

      // 1. Walking to a planned blueprint site to build
      if (u.buildProp !== undefined && u.hasTarget) {
        this.moveTowards(u, u.targetX, u.targetY, dt, builderSpeedMult);
        if (Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1.65) {
          // Deposit carried IKEA materials straight into project
          if (u.carryAmount > 0) {
            if (u.carryType === 'meatball') nation.meatballs += u.carryAmount;
            else if (u.carryType === 'wrench') nation.allenWrenches += u.carryAmount;
            else nation.scrap += u.carryAmount;
            u.carryAmount = 0;
            u.carryType = 'none';
          }

          const bx = Math.max(1, Math.min(GRID_W - 2, u.targetX | 0));
          const by = Math.max(1, Math.min(GRID_H - 2, u.targetY | 0));
          const bIdx = by * GRID_W + bx;
          const bInSummit = Math.hypot(bx - SUMMIT_X, by - SUMMIT_Y) <= SUMMIT_RADIUS + 2;

          // Clear any blocking IKEA store furniture on the blueprint tile & salvage its materials
          const existing = this.prop[bIdx];
          if (!bInSummit && existing !== PropType.NONE && this.propOwner[bIdx] !== nation.id && this.isDismantlableIkeaProp(existing)) {
            if (existing === PropType.MEATBALL_VAT) {
              nation.meatballs += 6;
            } else {
              nation.scrap += 6;
              if (existing === PropType.SHELF || existing === PropType.WOOD_PALLET) {
                nation.allenWrenches += 2;
              }
            }
            this.prop[bIdx] = PropType.NONE;
            this.spawnParticleBurst(bx + 0.5, by + 0.5, '#d97706', 5);
          }

          const cost = this.getBuildingCost(u.buildProp);
          if (
            !bInSummit &&
            this.prop[bIdx] === PropType.NONE &&
            (this.propOwner[bIdx] === -1 || this.propOwner[bIdx] === nation.id) &&
            nation.scrap >= cost.scrap &&
            nation.allenWrenches >= cost.wrenches &&
            nation.meatballs >= cost.meatballs
          ) {
            nation.scrap -= cost.scrap;
            nation.allenWrenches -= cost.wrenches;
            nation.meatballs -= cost.meatballs;

            // Claim 3x3 territory footprint around new structure (unowned or abandoned/depopulated)
            let claimedNew = false;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const cx = bx + dx;
                const cy = by + dy;
                if (cx < 1 || cx >= GRID_W - 1 || cy < 1 || cy >= GRID_H - 1) continue;
                if (Math.hypot(cx - SUMMIT_X, cy - SUMMIT_Y) <= SUMMIT_RADIUS + 1) continue;
                const cIdx = cy * GRID_W + cx;
                const cOwner = this.territory[cIdx];
                if (cOwner === -1 || (cOwner >= 0 && !this.nations[cOwner]?.alive)) {
                  if (cOwner >= 0 && this.prop[cIdx] === PropType.CHECKOUT_FLAG) {
                    this.prop[cIdx] = PropType.NONE;
                    this.propOwner[cIdx] = -1;
                  }
                  this.territory[cIdx] = nation.id;
                  claimedNew = true;
                }
              }
            }
            if (claimedNew) this.dirtyMap = true;

            this.placeNationProp(bx, by, u.buildProp, cost.hp, nation.id, u.buildVariant ?? 0);
            this.records.totalBuildingsBuilt += 1;
            this.spawnParticleBurst(bx + 0.5, by + 0.5, '#fbbf24', 7);
            u.chatEmoji = '🔨';
            u.chatTimer = 1.6;
            if (cost.label) {
              this.spawnFloatingText(bx + 0.5, by - 0.8, cost.label, nation.color);
            }
          }

          u.buildProp = undefined;
          u.buildVariant = undefined;
          u.hasTarget = false;
          u.aiTimer = hasTech(nation, 'flatpack_joinery') ? 0.2 : 0.55;
        }
        return;
      }

      // 2. Carrying harvested IKEA materials: bring straight to next blueprint site or capital stockpile
      if (u.carryAmount > 0) {
        const bp = this.findNextBlueprintSite(nation, u.id, u.carryType, u.carryAmount);
        if (bp && bp.affordable) {
          this.activeBuilderTargets.add(bp.y * GRID_W + bp.x);
          u.targetX = bp.x + 0.5;
          u.targetY = bp.y + 0.5;
          u.buildProp = bp.prop;
          u.buildVariant = bp.variant;
          u.hasTarget = true;
          this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);
          return;
        }

        this.moveTowards(u, nation.capitalX + 0.5, nation.capitalY + 0.5, dt, speedMult);
        if (Math.hypot(u.x - nation.capitalX, u.y - nation.capitalY) < 2.3) {
          if (u.carryType === 'meatball') nation.meatballs += u.carryAmount;
          else if (u.carryType === 'wrench') nation.allenWrenches += u.carryAmount;
          else nation.scrap += u.carryAmount;
          u.carryAmount = 0;
          u.carryType = 'none';
          u.hasTarget = false;
        }
        return;
      }

      // 3. Pick a new job: build next kingdom blueprint/empty land OR dismantle IKEA furniture for wood/wrenches
      if (!u.hasTarget && u.aiTimer <= 0) {
        const bp = this.findNextBlueprintSite(nation, u.id, u.carryType, u.carryAmount);
        const needGather = !bp || !bp.affordable || nation.scrap < 18 || Math.random() < 0.08;

        if (!needGather && bp && bp.affordable) {
          this.activeBuilderTargets.add(bp.y * GRID_W + bp.x);
          u.targetX = bp.x + 0.5;
          u.targetY = bp.y + 0.5;
          u.buildProp = bp.prop;
          u.buildVariant = bp.variant;
          u.hasTarget = true;
        } else {
          // Occasionally step into a Workshop or Mattress Hut between construction shifts
          if ((u.visitCooldown ?? 0) <= 0 && Math.random() < 0.22) {
            const breakSpot = this.findNearestFriendlyBuilding(nation.id, u.x | 0, u.y | 0, 22, [
              PropType.WORKSHOP,
              PropType.MATTRESS_HUT,
            ]);
            if (breakSpot) {
              u.visitTargetIdx = breakSpot.idx;
              u.targetX = breakSpot.x + 0.5;
              u.targetY = breakSpot.y + 0.88;
              u.hasTarget = true;
              this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);
              return;
            } else {
              u.visitCooldown = 4 + Math.random() * 3;
            }
          }
          const res = this.findNearestResource(u.x | 0, u.y | 0, 34, true);
          if (res) {
            u.targetX = res.x + 0.5;
            u.targetY = res.y + 0.5;
            u.buildProp = undefined;
            u.hasTarget = true;
          } else if (bp && bp.affordable) {
            this.activeBuilderTargets.add(bp.y * GRID_W + bp.x);
            u.targetX = bp.x + 0.5;
            u.targetY = bp.y + 0.5;
            u.buildProp = bp.prop;
            u.buildVariant = bp.variant;
            u.hasTarget = true;
          } else {
            const a = Math.random() * Math.PI * 2;
            const rad = 5 + Math.random() * 14;
            u.targetX = Math.max(2, Math.min(GRID_W - 2, nation.capitalX + Math.cos(a) * rad));
            u.targetY = Math.max(2, Math.min(GRID_H - 2, nation.capitalY + Math.sin(a) * rad));
            u.buildProp = undefined;
            u.hasTarget = true;
          }
        }
      }

      // 4. Move to IKEA furniture prop & dismantle it for building materials
      if (u.hasTarget) {
        this.moveTowards(u, u.targetX, u.targetY, dt, builderSpeedMult);
        if (Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1.65) {
          const rtx = Math.max(1, Math.min(GRID_W - 2, u.targetX | 0));
          const rty = Math.max(1, Math.min(GRID_H - 2, u.targetY | 0));
          const rIdx = rty * GRID_W + rtx;
          const p = this.prop[rIdx];
          const hoarderBonus = u.traits.includes('Hoarder') ? 3 : 0;
          const joineryMult = hasTech(nation, 'flatpack_joinery') ? 1.35 : 1;

          if (p === PropType.SHELF || p === PropType.WOOD_PALLET) {
            const wantWrench = nation.allenWrenches < 10 && Math.random() < 0.55;
            u.carryType = wantWrench ? 'wrench' : 'scrap';
            u.carryAmount = Math.round(((wantWrench ? 5 : 9) + hoarderBonus) * joineryMult);
            if (this.propHp[rIdx] > 25) this.propHp[rIdx] -= 25;
            else this.prop[rIdx] = PropType.NONE;
            this.spawnParticleBurst(rtx + 0.5, rty + 0.5, '#d97706', 4);
            u.chatEmoji = '🪵';
            u.chatTimer = 1.4;
          } else if (p === PropType.COUCH || p === PropType.BED || p === PropType.LAMP) {
            u.carryType = 'scrap';
            u.carryAmount = Math.round((7 + hoarderBonus) * joineryMult);
            this.prop[rIdx] = PropType.NONE;
            this.spawnParticleBurst(rtx + 0.5, rty + 0.5, '#94a3b8', 4);
            u.chatEmoji = '🪵';
            u.chatTimer = 1.4;
          } else if (p === PropType.MEATBALL_VAT) {
            u.carryType = 'meatball';
            u.carryAmount = Math.round((7 + hoarderBonus) * joineryMult);
            if (this.propHp[rIdx] > 20) this.propHp[rIdx] -= 20;
            else this.prop[rIdx] = PropType.NONE;
            u.chatEmoji = '🍖';
            u.chatTimer = 1.4;
          }
          u.hasTarget = false;
          u.aiTimer = hasTech(nation, 'flatpack_joinery') ? 0.1 : 0.25;
        }
      }
      return;
    }

    if (u.role === SurvivorRole.CHEF) {
      // Meatball Chefs work inside Bistros (walking to doorway & entering) & feed nearby hungry allies
      if ((u.visitCooldown ?? 0) <= 0) {
        const bistro = this.findNearestFriendlyBuilding(nation.id, u.x | 0, u.y | 0, 26, [PropType.BISTRO]);
        if (bistro) {
          u.visitTargetIdx = bistro.idx;
          u.targetX = bistro.x + 0.5;
          u.targetY = bistro.y + 0.88;
          u.hasTarget = true;
          this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);
          return;
        } else {
          u.visitCooldown = 4 + Math.random() * 3;
        }
      }

      u.aiTimer -= dt;
      const bistroCount = nation.buildings?.bistros || 0;
      if (!u.hasTarget || Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1.3) {
        const a = Math.random() * Math.PI * 2;
        const rad = 1.5 + Math.random() * 5.5;
        u.targetX = Math.max(2, Math.min(GRID_W - 2, nation.capitalX + Math.cos(a) * rad));
        u.targetY = Math.max(2, Math.min(GRID_H - 2, nation.capitalY + Math.sin(a) * rad));
        u.hasTarget = true;
      }
      if (u.aiTimer <= 0) {
        u.aiTimer = 3.2;
        const lingonBonus = hasTech(nation, 'lingonberry_kitchens') ? 1.4 : 1;
        const cooked = (1.3 + Math.min(1.5, bistroCount * 0.45)) * lingonBonus;
        nation.meatballs += cooked;
        if (Math.random() < 0.35) {
          u.chatEmoji = '🍖';
          u.chatTimer = 1.8;
        }
        // Feed nearby hungry/injured citizens
        this.spatialHash.queryRadius(this.units, u.x, u.y, 4.5, (ally) => {
          if (ally.nationId === nation.id && ally.kind === UnitKind.SURVIVOR) {
            ally.hunger = Math.max(0, ally.hunger - 22);
            if (ally.hp < ally.maxHp) ally.hp = Math.min(ally.maxHp, ally.hp + 5);
          }
        });
      }
      this.moveTowards(u, u.targetX, u.targetY, dt, speedMult * 0.9);
      return;
    }

    if (u.role === SurvivorRole.TINKER) {
      // Wrench Tinkers walk into Workshops & Archives to craft wrenches & advance research
      if ((u.visitCooldown ?? 0) <= 0) {
        const shop = this.findNearestFriendlyBuilding(nation.id, u.x | 0, u.y | 0, 28, [
          PropType.WORKSHOP,
          PropType.ARCHIVE,
        ]);
        if (shop) {
          u.visitTargetIdx = shop.idx;
          u.targetX = shop.x + 0.5;
          u.targetY = shop.y + 0.88;
          u.hasTarget = true;
          this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);
          return;
        } else {
          u.visitCooldown = 4 + Math.random() * 3;
        }
      }

      u.aiTimer -= dt;
      const gx = Math.max(1, Math.min(GRID_W - 2, u.x | 0));
      const gy = Math.max(1, Math.min(GRID_H - 2, u.y | 0));
      const idx = gy * GRID_W + gx;
      if (this.propOwner[idx] === nation.id && this.propHp[idx] < this.propMaxHp[idx]) {
        this.propHp[idx] = Math.min(this.propMaxHp[idx], this.propHp[idx] + 35);
      }
      if (!u.hasTarget || Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1.3) {
        const a = Math.random() * Math.PI * 2;
        const rad = 2.5 + Math.random() * 8.5;
        u.targetX = Math.max(2, Math.min(GRID_W - 2, nation.capitalX + Math.cos(a) * rad));
        u.targetY = Math.max(2, Math.min(GRID_H - 2, nation.capitalY + Math.sin(a) * rad));
        u.hasTarget = true;
      }
      if (u.aiTimer <= 0) {
        u.aiTimer = 3.5;
        const shopBonus = Math.min(1.4, ((nation.buildings?.workshops || 0) + (nation.buildings?.archives || 0)) * 0.35);
        nation.allenWrenches += 0.85 + shopBonus;
        if (Math.random() < 0.3) {
          u.chatEmoji = '🔧';
          u.chatTimer = 1.8;
        }
      }
      this.moveTowards(u, u.targetX, u.targetY, dt, speedMult * 0.95);
      return;
    }

    if (u.role === SurvivorRole.TRADER) {
      // Kingdom Merchant Traders enter Cart Depots & Bistros to manage shipments & supplies
      if ((u.visitCooldown ?? 0) <= 0) {
        const hub = this.findNearestFriendlyBuilding(nation.id, u.x | 0, u.y | 0, 28, [
          PropType.CART_DEPOT,
          PropType.BISTRO,
        ]);
        if (hub) {
          u.visitTargetIdx = hub.idx;
          u.targetX = hub.x + 0.5;
          u.targetY = hub.y + 0.88;
          u.hasTarget = true;
          this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);
          return;
        } else {
          u.visitCooldown = 4 + Math.random() * 3;
        }
      }

      u.aiTimer -= dt;
      if (!u.hasTarget || Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1.3) {
        const unionPartner = this.nations.find(
          (o) => o.alive && o.id !== nation.id && this.getStance(nation.id, o.id) === 'UNION'
        );
        if (!this.isNight && nation.unionHubs && nation.unionHubs.length > 0 && Math.random() < 0.35) {
          const hub = nation.unionHubs[(Math.random() * nation.unionHubs.length) | 0];
          u.targetX = hub.x + (Math.random() - 0.5) * 3;
          u.targetY = hub.y + (Math.random() - 0.5) * 3;
          u.hasTarget = true;
        } else if (!this.isNight && unionPartner && Math.random() < 0.3) {
          u.targetX = unionPartner.capitalX + (Math.random() - 0.5) * 3;
          u.targetY = unionPartner.capitalY + (Math.random() - 0.5) * 3;
          u.hasTarget = true;
        } else {
          const a = Math.random() * Math.PI * 2;
          const rad = 2 + Math.random() * 9.5;
          u.targetX = Math.max(2, Math.min(GRID_W - 2, nation.capitalX + Math.cos(a) * rad));
          u.targetY = Math.max(2, Math.min(GRID_H - 2, nation.capitalY + Math.sin(a) * rad));
          u.hasTarget = true;
        }
      }
      if (u.aiTimer <= 0) {
        u.aiTimer = 3.6;
        const hasPact = Object.values(nation.relations).some(
          (r) => r.stance === 'TRADE_PACT' || r.stance === 'ALLIANCE' || r.stance === 'UNION'
        );
        const depotBonus = Math.min(1.0, (nation.buildings?.depots || 0) * 0.4);
        nation.allenWrenches += (hasPact ? 1.5 : 0.9) + depotBonus;
        if (Math.random() < 0.28) {
          u.chatEmoji = '🛒';
          u.chatTimer = 1.8;
        }
      }
      this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);
      return;
    }

    // War General AI: strategic rallying, advancing in kingdom formation, sieging, and capturing war fronts
    if (u.role === SurvivorRole.GENERAL) {
      const plan = nation.battlePlan;
      const enemy = plan ? this.getNation(plan.targetNationId) : undefined;
      if (plan && enemy && enemy.alive) {
        const frontTarget = this.findWarFrontTarget(nation, enemy, u.x, u.y);
        let destX = plan.rallyX;
        let destY = plan.rallyY;
        let pace = speedMult * 0.85;

        if (plan.phase === 'REGROUP') {
          destX = nation.capitalX + ((nation.id % 2 === 0 ? 1 : -1) * 2.5);
          destY = nation.capitalY + 2.5;
          pace = speedMult * 1.0;
        } else if (plan.phase === 'MUSTER') {
          destX = plan.rallyX;
          destY = plan.rallyY;
          pace = speedMult * 0.88;
        } else if (plan.phase === 'MARCH') {
          destX = frontTarget.x;
          destY = frontTarget.y;
          pace = speedMult * 0.85;
        } else {
          destX = frontTarget.x;
          destY = frontTarget.y;
          pace = speedMult * 1.04;
        }

        if (Math.hypot(u.x - destX, u.y - destY) > 1.0) {
          if (!this.attackEnemyFortification(u, nation)) {
            this.moveTowards(u, destX, destY, dt, pace);
          }
        } else {
          this.attackEnemyFortification(u, nation);
        }

        const gx = Math.max(1, Math.min(GRID_W - 2, u.x | 0));
        const gy = Math.max(1, Math.min(GRID_H - 2, u.y | 0));
        this.captureUndefendedEnemyPocket(nation, gx, gy, 2);
        return;
      }
      // Fallback patrol if no active target
      this.moveTowards(u, nation.capitalX + 1.5, nation.capitalY + 1.5, dt, speedMult * 0.8);
      return;
    }

    // Army Guard AI: follow War General's kingdom formation or push & capture war fronts
    const plan = nation.battlePlan;
    if (plan) {
      const general = this.units.find(
        (g) => g.alive && g.id === plan.generalUnitId && g.nationId === nation.id
      );
      const warEnemy = this.getNation(plan.targetNationId);
      if (general && warEnemy && warEnemy.alive) {
        const frontTarget = this.findWarFrontTarget(nation, warEnemy, general.x, general.y);
        const anchorX = plan.phase === 'MUSTER' ? plan.rallyX : general.x;
        const anchorY = plan.phase === 'MUSTER' ? plan.rallyY : general.y;
        const dx = frontTarget.x - (plan.phase === 'REGROUP' ? nation.capitalX : anchorX);
        const dy = frontTarget.y - (plan.phase === 'REGROUP' ? nation.capitalY : anchorY);
        const len = Math.hypot(dx, dy) || 1;
        const fx = dx / len;
        const fy = dy / len;
        const totalGuards = Math.max(1, nation.armyCount || 4);
        const slotIdx = u.formationSlot ?? (u.id % totalGuards);
        const slot = this.computeFormationSlotTarget(
          plan.formation,
          slotIdx,
          totalGuards,
          anchorX,
          anchorY,
          fx,
          fy
        );

        if (plan.phase === 'SIEGE' && Math.hypot(u.x - frontTarget.x, u.y - frontTarget.y) < 10) {
          u.targetX = frontTarget.x + ((slotIdx % 3) - 1) * 1.4;
          u.targetY = frontTarget.y + (Math.floor(slotIdx / 3) - 0.5) * 1.4;
        } else {
          u.targetX = slot.x;
          u.targetY = slot.y;
        }
        u.hasTarget = true;

        const distSlot = Math.hypot(u.x - u.targetX, u.y - u.targetY);
        if (distSlot > 0.7) {
          if (!this.attackEnemyFortification(u, nation)) {
            this.moveTowards(u, u.targetX, u.targetY, dt, speedMult * (distSlot > 6 ? 1.12 : 0.98));
          }
        } else {
          this.attackEnemyFortification(u, nation);
        }

        const gx = Math.max(1, Math.min(GRID_W - 2, u.x | 0));
        const gy = Math.max(1, Math.min(GRID_H - 2, u.y | 0));
        this.captureUndefendedEnemyPocket(nation, gx, gy, 1);
        return;
      }
    }

    // Peaceful / Garrison Guard AI: periodically man Watchtowers or patrol perimeter furniture walls
    if ((u.visitCooldown ?? 0) <= 0 && Math.random() < dt * 0.3) {
      const tower = this.findNearestFriendlyBuilding(nation.id, u.x | 0, u.y | 0, 24, [PropType.WATCHTOWER]);
      if (tower) {
        u.visitTargetIdx = tower.idx;
        u.targetX = tower.x + 0.5;
        u.targetY = tower.y + 0.88;
        u.hasTarget = true;
        this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);
        return;
      } else {
        u.visitCooldown = 4 + Math.random() * 3;
      }
    }

    u.aiTimer -= dt;
    if (!u.hasTarget || u.aiTimer <= 0 || Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1.8) {
      u.aiTimer = 2.2 + Math.random() * 1.4;
      const a = Math.random() * Math.PI * 2;
      const r = this.isNight ? 3 + Math.random() * 5 : 5 + Math.random() * 9;
      u.targetX = Math.max(2, Math.min(GRID_W - 2, nation.capitalX + Math.cos(a) * r));
      u.targetY = Math.max(2, Math.min(GRID_H - 2, nation.capitalY + Math.sin(a) * r));
      u.hasTarget = true;
    }
    this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);

    const gx = Math.max(1, Math.min(GRID_W - 2, u.x | 0));
    const gy = Math.max(1, Math.min(GRID_H - 2, u.y | 0));
    this.captureUndefendedEnemyPocket(nation, gx, gy, 1);
    this.attackEnemyFortification(u, nation);
  }

  private handleCapitalConquered(victor: Nation, defeated: Nation): void {
    if (!defeated.alive) return;
    if (
      defeated.overlordId === null &&
      defeated.population > 12 &&
      (defeated.armyCount || 0) >= 2 &&
      victor.population < defeated.population * 1.2 &&
      Math.random() < 0.15
    ) {
      // Rare Vassal State when both kingdoms are still substantial
      this.propHp[defeated.capitalY * GRID_W + defeated.capitalX] = 250;
      this.makeVassal(victor, defeated);
      this.addChronicle(
        'CONQUEST',
        `${defeated.name} Vassalized`,
        `Forced to swear fealty to ${victor.name} on Day ${this.day}.`,
        victor.color
      );
    } else {
      this.conquerEliminatedKingdom(
        victor,
        defeated,
        `${victor.name} stormed ${defeated.name}'s Checkout Flag and conquered its realm!`
      );
      this.recountTerritoryAndHousing();
    }
  }

  private isEnterableBuilding(p: PropType): boolean {
    return (
      p === PropType.MATTRESS_HUT ||
      p === PropType.BISTRO ||
      p === PropType.WORKSHOP ||
      p === PropType.ARCHIVE ||
      p === PropType.CART_DEPOT ||
      p === PropType.WATCHTOWER
    );
  }

  private ejectBuildingOccupants(idx: number): void {
    const tx = idx % GRID_W;
    const ty = (idx / GRID_W) | 0;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.alive) continue;
      if (u.insideBuildingIdx === idx && (u.insideTimer ?? 0) > 0) {
        u.insideTimer = 0;
        u.insideBuildingIdx = -1;
        u.visitTargetIdx = -1;
        u.hasTarget = false;
        u.visitCooldown = 4;
        u.x = Math.max(1.2, Math.min(GRID_W - 1.2, tx + 0.5));
        u.y = Math.max(1.2, Math.min(GRID_H - 1.2, ty + 0.92));
      } else if (u.visitTargetIdx === idx) {
        u.visitTargetIdx = -1;
        u.hasTarget = false;
      }
    }
  }

  private findNearestFriendlyBuilding(
    nationId: number,
    sx: number,
    sy: number,
    maxRad: number,
    types: PropType[]
  ): { x: number; y: number; idx: number; prop: PropType } | null {
    const list = this.nationBuildingsCache.get(nationId);
    if (!list || list.length === 0) return null;

    const maxRadSq = maxRad * maxRad;
    const candidates: Array<{ x: number; y: number; idx: number; prop: PropType; dSq: number }> = [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (this.propOwner[b.idx] !== nationId || this.prop[b.idx] !== b.prop) continue;
      if (!types.includes(b.prop)) continue;
      const dx = b.x - sx;
      const dy = b.y - sy;
      const dSq = dx * dx + dy * dy;
      if (dSq <= maxRadSq) {
        candidates.push({ x: b.x, y: b.y, idx: b.idx, prop: b.prop, dSq });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.dSq - b.dSq);
    const pool = Math.min(3, candidates.length);
    const chosen = candidates[(Math.random() * pool) | 0];
    return { x: chosen.x, y: chosen.y, idx: chosen.idx, prop: chosen.prop };
  }

  private enterBuildingIfArrived(u: Unit, nation: Nation, dt: number, speedMult: number): boolean {
    const bIdx = u.visitTargetIdx ?? -1;
    if (bIdx < 0) return false;
    if (u.role === SurvivorRole.GUARD && nation.battlePlan) {
      u.visitTargetIdx = -1;
      u.hasTarget = false;
      return false;
    }
    if (bIdx >= GRID_W * GRID_H || this.propOwner[bIdx] !== nation.id || !this.isEnterableBuilding(this.prop[bIdx])) {
      u.visitTargetIdx = -1;
      u.hasTarget = false;
      return false;
    }

    const bx = bIdx % GRID_W;
    const by = (bIdx / GRID_W) | 0;
    const doorX = bx + 0.5;
    const doorY = by + 0.88;
    this.moveTowards(u, doorX, doorY, dt, speedMult);

    if (Math.hypot(u.x - doorX, u.y - doorY) < 1.35) {
      const p = this.prop[bIdx];
      u.insideBuildingIdx = bIdx;
      u.insideTimer =
        this.isNight && p === PropType.MATTRESS_HUT
          ? 4.0 + Math.random() * 2.4
          : 2.5 + Math.random() * 1.6;
      u.visitTargetIdx = -1;
      u.hasTarget = false;
      u.x = bx + 0.5;
      u.y = by + 0.5;
      this.spawnParticleBurst(doorX, doorY, '#fef08a', 2);
    }
    return true;
  }

  private placeNationProp(
    x: number,
    y: number,
    p: PropType,
    hp: number,
    ownerId: number,
    variant = 0
  ): void {
    const idx = y * GRID_W + x;
    this.prop[idx] = p;
    this.propHp[idx] = hp;
    this.propMaxHp[idx] = hp;
    this.propOwner[idx] = ownerId;
    this.propVariant[idx] = variant;
    if (p === PropType.SPOTLIGHT || p === PropType.WATCHTOWER || p === PropType.CHECKOUT_FLAG) {
      this.lightSourceIndices.push(idx);
      this.dirtyLight = true;
    }
    if (p === PropType.WATCHTOWER) {
      this.watchtowerIndices.push(idx);
    }
    if (ownerId >= 0 && this.isEnterableBuilding(p)) {
      let arr = this.nationBuildingsCache.get(ownerId);
      if (!arr) {
        arr = [];
        this.nationBuildingsCache.set(ownerId, arr);
      }
      arr.push({ x, y, idx, prop: p });
    }
    if (
      this.simTime > 0.1 &&
      (p === PropType.MATTRESS_HUT ||
        p === PropType.BISTRO ||
        p === PropType.WORKSHOP ||
        p === PropType.ARCHIVE ||
        p === PropType.CART_DEPOT ||
        p === PropType.WATCHTOWER ||
        p === PropType.SPOTLIGHT)
    ) {
      const n = ownerId >= 0 ? this.getNation(ownerId) : undefined;
      this.recentBuilds.push({
        x,
        y,
        color: n ? n.color : '#fbbf24',
        life: 2.8,
        maxLife: 2.8,
      });
    }
  }

  private findNearestResource(
    sx: number,
    sy: number,
    maxRad: number,
    preferTimber = false
  ): { x: number; y: number } | null {
    // Fast radial sample search so 2,000+ units cost microseconds
    for (let ring = 2; ring <= maxRad; ring += 2) {
      const samples = ring <= 10 ? 12 : 16;
      for (let sample = 0; sample < samples; sample++) {
        const a = (sample / samples) * Math.PI * 2 + Math.random() * 0.35;
        const tx = Math.max(1, Math.min(GRID_W - 2, (sx + Math.cos(a) * ring) | 0));
        const ty = Math.max(1, Math.min(GRID_H - 2, (sy + Math.sin(a) * ring) | 0));
        if (Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 2) continue;
        const idx = ty * GRID_W + tx;
        const p = this.prop[idx];
        if (preferTimber) {
          if (
            p === PropType.SHELF ||
            p === PropType.WOOD_PALLET ||
            p === PropType.COUCH ||
            p === PropType.BED ||
            p === PropType.LAMP
          ) {
            return { x: tx, y: ty };
          }
        } else if (
          p === PropType.MEATBALL_VAT ||
          p === PropType.SHELF ||
          p === PropType.WOOD_PALLET ||
          p === PropType.COUCH ||
          p === PropType.BED ||
          p === PropType.LAMP
        ) {
          return { x: tx, y: ty };
        }
      }
    }
    return null;
  }

  /**
   * Grid-assisted steering with diagonal wall-sliding & 1.5s anti-stuck recovery.
   * Friendly/allied members pass freely through Barricade Gates.
   */
  private moveTowards(u: Unit, tx: number, ty: number, dt: number, speedMult: number): void {
    const dx = tx - u.x;
    const dy = ty - u.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.05) return;

    const step = u.speed * speedMult * dt;
    const nx = (dx / dist) * step;
    const ny = (dy / dist) * step;

    const canWalk = (cx: number, cy: number): boolean => {
      const gx = cx | 0;
      const gy = cy | 0;
      if (gx < 1 || gx >= GRID_W - 1 || gy < 1 || gy >= GRID_H - 1) return false;
      const idx = gy * GRID_W + gx;
      const p = this.prop[idx];
      if (p === PropType.NONE || p === PropType.LAMP || p === PropType.CHECKOUT_FLAG) return true;
      if (p === PropType.BARRICADE_GATE) {
        const owner = this.propOwner[idx];
        return u.nationId >= 0 && owner >= 0 && this.areFriendly(u.nationId, owner);
      }
      if (p === PropType.SHELF || p === PropType.BARRICADE_WALL) return false;
      return true;
    };

    // Diagonal wall-sliding: test X and Y independently
    let moved = false;
    if (canWalk(u.x + nx, u.y)) {
      u.x += nx;
      moved = true;
    }
    if (canWalk(u.x, u.y + ny)) {
      u.y += ny;
      moved = true;
    }
    if (!moved) {
      // Slide perpendicular along obstacle
      const perpX = (-dy / dist) * step;
      const perpY = (dx / dist) * step;
      if (canWalk(u.x + perpX, u.y + perpY)) {
        u.x += perpX;
        u.y += perpY;
      }
    }

    // Anti-stuck check (>1.5s without meaningful progress)
    u.stuckTimer += dt;
    if (u.stuckTimer >= 1.5) {
      const prog = Math.hypot(u.x - u.lastCheckX, u.y - u.lastCheckY);
      u.lastCheckX = u.x;
      u.lastCheckY = u.y;
      u.stuckTimer = 0;
      if (prog < 0.75) {
        // Clear target & pick fresh nearby direction
        u.hasTarget = false;
        const randA = Math.random() * Math.PI * 2;
        u.targetX = Math.max(2, Math.min(GRID_W - 2, u.x + Math.cos(randA) * 7));
        u.targetY = Math.max(2, Math.min(GRID_H - 2, u.y + Math.sin(randA) * 7));
      }
    }
  }

  private damageUnit(victim: Unit, dmg: number, attacker?: Unit, attackerNationId?: number): void {
    if (!victim.alive) return;
    const atkNationId =
      attacker && attacker.nationId >= 0
        ? attacker.nationId
        : attackerNationId !== undefined && attackerNationId >= 0
          ? attackerNationId
          : -1;
    const atkNation = atkNationId >= 0 ? this.getNation(atkNationId) : undefined;
    const victimNation =
      victim.kind === UnitKind.SURVIVOR && victim.nationId >= 0
        ? this.getNation(victim.nationId)
        : undefined;

    if (victimNation && atkNation && atkNation.id !== victimNation.id) {
      victimNation.lastAttackerNationId = atkNation.id;
      victimNation.lastAttackedDay = this.day;
    }

    victim.hp -= dmg;
    victim.hitFlash = 0.14;
    if (victim.hp <= 0) {
      victim.alive = false;
      this.deadUnitsCount++;
      if (attacker) {
        attacker.kills++;
        if (
          attacker.kind === UnitKind.SURVIVOR &&
          attacker.alive &&
          !attacker.veteranTitle &&
          (attacker.kills >= 3 || victim.kind === UnitKind.STAFF_MANAGER)
        ) {
          attacker.veteranTitle =
            victim.kind === UnitKind.STAFF_MANAGER
              ? 'Manager-Slayer'
              : attacker.role === SurvivorRole.GENERAL
                ? 'Grand Marshal'
                : attacker.role === SurvivorRole.GUARD
                  ? 'Aisle Champion'
                  : 'Store Veteran';
          attacker.maxHp += 20;
          attacker.hp = Math.min(attacker.maxHp, attacker.hp + 20);
          attacker.atk += 3;
          this.spawnParticleBurst(attacker.x, attacker.y, '#fbbf24', 8);
          this.spawnFloatingText(attacker.x, attacker.y - 1.4, `★ ${attacker.veteranTitle}!`, '#fbbf24');
          attacker.chatEmoji = '⭐';
          attacker.chatTimer = 2.2;
        }
      }
      if (victim.kind >= UnitKind.STAFF_NORMAL && victim.kind <= UnitKind.STAFF_MANAGER) {
        this.records.totalStaffSlain += 1;
      } else if (victim.kind === UnitKind.SURVIVOR) {
        this.records.totalSurvDeaths += 1;
      }
      this.spawnParticleBurst(
        victim.x,
        victim.y,
        victim.kind >= UnitKind.STAFF_NORMAL ? '#fde047' : '#ef4444',
        5
      );

      if (victimNation && victimNation.alive) {
        if (atkNation && atkNation.alive && atkNation.id !== victimNation.id && this.areHostile(atkNation.id, victimNation.id)) {
          this.captureUndefendedEnemyPocket(
            atkNation,
            Math.max(1, Math.min(GRID_W - 2, victim.x | 0)),
            Math.max(1, Math.min(GRID_H - 2, victim.y | 0)),
            2
          );
        }

        const hasAnyLivingCitizen = this.units.some(
          (other) =>
            other.alive &&
            other.kind === UnitKind.SURVIVOR &&
            other.nationId === victimNation.id
        );

        if (!hasAnyLivingCitizen) {
          if (
            atkNation &&
            atkNation.alive &&
            atkNation.id !== victimNation.id &&
            this.areHostile(atkNation.id, victimNation.id)
          ) {
            this.conquerEliminatedKingdom(
              atkNation,
              victimNation,
              `${atkNation.name} defeated the last defender of ${victimNation.name} and conquered its territory!`
            );
          } else {
            this.markKingdomDepopulated(victimNation, 'all citizens perished');
          }
          return;
        }

        if (victim.role === SurvivorRole.LEADER) {
          victimNation.leader.alive = false;
          this.replaceLeader(victimNation, `${victim.name} fell in combat`);
        }
      }
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }

      let hit = false;
      this.spatialHash.queryRadius(this.units, p.x, p.y, 1.1, (u) => {
        if (hit) return;
        const isEnemy =
          (this.isNight && u.kind >= UnitKind.STAFF_NORMAL) ||
          (u.nationId >= 0 && this.areHostile(p.nationId, u.nationId));
        if (isEnemy) {
          this.damageUnit(u, p.damage, undefined, p.nationId);
          hit = true;
        }
      });
      if (hit) this.projectiles.splice(i, 1);
    }
  }

  // ==================== GOD TOOLS & BRUSHES ====================

  public applyTool(tool: ToolId, brush: BrushSize, wx: number, wy: number): void {
    const tx = Math.max(1, Math.min(GRID_W - 2, wx | 0));
    const ty = Math.max(1, Math.min(GRID_H - 2, wy | 0));
    const rad = brush === 'S' ? 2 : brush === 'M' ? 5 : 9;

    switch (tool) {
      case 'spawn_survivor': {
        const count = brush === 'S' ? 1 : brush === 'M' ? 4 : 8;
        const terrOwner = this.territory[ty * GRID_W + tx];
        const rawOwner = terrOwner >= 0 ? this.getNation(terrOwner) : undefined;
        // Never resurrect or spawn people into a Defeated / Depopulated kingdom!
        const ownerNation = rawOwner && rawOwner.alive ? rawOwner : undefined;
        const targetNationId = ownerNation ? ownerNation.id : -1;

        for (let i = 0; i < count; i++) {
          const role = ownerNation
            ? this.pickNeededJobForNation(ownerNation, true)
            : SurvivorRole.SCAVENGER;
          const u = this.spawnSurvivor(
            targetNationId,
            role,
            tx + (Math.random() - 0.5) * rad,
            ty + (Math.random() - 0.5) * rad
          );
          if (!ownerNation) {
            u.canFoundKingdom = true;
            u.settleTimer = 0;
          } else if (ownerNation.jobs) {
            ownerNation.population++;
            ownerNation.armyCap = this.computeArmyCap(ownerNation);
            if (role === SurvivorRole.GUARD) {
              ownerNation.jobs.guards++;
              ownerNation.armyCount = ownerNation.jobs.guards;
            }
          }
        }
        if (ownerNation) {
          this.recountTerritoryAndHousing();
        } else {
          this.spawnFloatingText(
            tx + 0.5,
            ty - 1,
            count >= 2 ? 'Settlers staking claim...' : 'Unclaimed settler placed',
            '#ffda1a'
          );
        }
        soundFX.playChime(580, 0.06);
        break;
      }
      case 'spawn_staff': {
        const count = brush === 'S' ? 2 : brush === 'M' ? 6 : 12;
        for (let i = 0; i < count; i++) {
          this.spawnStaff(
            Math.random() < 0.3 ? UnitKind.STAFF_CRAWLER : UnitKind.STAFF_NORMAL,
            tx + (Math.random() - 0.5) * rad,
            ty + (Math.random() - 0.5) * rad
          );
        }
        soundFX.playChime(190, 0.12, 'sawtooth');
        break;
      }
      case 'spawn_manager': {
        this.spawnStaff(UnitKind.STAFF_MANAGER, tx + 0.5, ty + 0.5);
        this.addNews('STAFF', 'A Giant SCP-3008-2 Manager Brute was spotted in the aisles!');
        soundFX.playChime(140, 0.2, 'sawtooth');
        break;
      }
      case 'spawn_trader': {
        this.spawnSurvivor(-1, SurvivorRole.TRADER, tx + 0.5, ty + 0.5);
        soundFX.playChime(640, 0.07);
        break;
      }
      case 'paint_food':
      case 'paint_warehouse':
      case 'paint_showroom':
      case 'paint_dark':
      case 'paint_eraser': {
        const rSq = rad * rad;
        for (let dy = -rad; dy <= rad; dy++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (dx * dx + dy * dy > rSq) continue;
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx <= 1 || nx >= GRID_W - 1 || ny <= 1 || ny >= GRID_H - 1) continue;
            const idx = ny * GRID_W + nx;
            if (tool === 'paint_eraser') {
              if (this.prop[idx] !== PropType.CHECKOUT_FLAG) {
                this.ejectBuildingOccupants(idx);
                this.prop[idx] = PropType.NONE;
                this.propOwner[idx] = -1;
              }
              this.territory[idx] = -1;
            } else if (tool === 'paint_food') {
              this.biome[idx] = BiomeType.FOOD_COURT;
              if (Math.abs(dx) % 2 === 0 && Math.abs(dy) % 2 === 0 && Math.random() < 0.65) {
                this.prop[idx] = PropType.MEATBALL_VAT;
                this.propHp[idx] = 120;
                this.propMaxHp[idx] = 120;
              }
            } else if (tool === 'paint_warehouse') {
              this.biome[idx] = BiomeType.WAREHOUSE;
              if (dy % 2 === 0 && Math.random() < 0.45 && this.prop[idx] === PropType.NONE) {
                this.prop[idx] = PropType.SHELF;
                this.propHp[idx] = 90;
                this.propMaxHp[idx] = 90;
              }
            } else if (tool === 'paint_showroom') {
              this.biome[idx] = BiomeType.SHOWROOM;
              if (Math.random() < 0.14 && this.prop[idx] === PropType.NONE) {
                this.prop[idx] = Math.random() < 0.5 ? PropType.COUCH : PropType.BED;
                this.propHp[idx] = 55;
                this.propMaxHp[idx] = 55;
              }
            } else if (tool === 'paint_dark') {
              this.biome[idx] = BiomeType.DARK_SECTOR;
            }
          }
        }
        this.dirtyMap = true;
        this.dirtyLight = true;
        this.forceMapRebuild = true;
        this.forceLightRebuild = true;
        if (tool === 'paint_eraser') {
          this.recountTerritoryAndHousing();
        }
        break;
      }
      case 'power_meatball': {
        this.spawnFloatingText(tx, ty - 1, 'MEATBALL RAIN!', '#fbbf24');
        this.spawnParticleBurst(tx, ty, '#b45309', 14);
        this.spatialHash.queryRadius(this.units, tx, ty, rad + 2, (u) => {
          if (u.kind === UnitKind.SURVIVOR) {
            u.hp = Math.min(u.maxHp, u.hp + 45);
            u.hunger = 0;
            const n = u.nationId >= 0 ? this.getNation(u.nationId) : undefined;
            if (n) n.meatballs += 3;
          }
        });
        soundFX.playPower();
        break;
      }
      case 'power_fever': {
        this.spawnFloatingText(tx, ty - 1, 'BLACK FRIDAY FEVER!', '#f43f5e');
        this.spawnParticleBurst(tx, ty, '#f43f5e', 14);
        this.spatialHash.queryRadius(this.units, tx, ty, rad + 2, (u) => {
          u.feverTimer = 12;
        });
        soundFX.playPower();
        break;
      }
      case 'power_outage': {
        const rSq = (rad + 4) * (rad + 4);
        for (let dy = -rad - 4; dy <= rad + 4; dy++) {
          for (let dx = -rad - 4; dx <= rad + 4; dx++) {
            if (dx * dx + dy * dy > rSq) continue;
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx > 0 && nx < GRID_W - 1 && ny > 0 && ny < GRID_H - 1) {
              const idx = ny * GRID_W + nx;
              if (this.prop[idx] === PropType.SPOTLIGHT || this.prop[idx] === PropType.WATCHTOWER) {
                this.disabledLightMap[idx] = 25;
              }
            }
          }
        }
        this.dirtyLight = true;
        this.spawnFloatingText(tx, ty - 1, 'POWER OUTAGE!', '#60a5fa');
        soundFX.playAlert(true);
        break;
      }
      case 'power_firebomb': {
        const rSq = rad * rad;
        for (let dy = -rad; dy <= rad; dy++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (dx * dx + dy * dy <= rSq) {
              const nx = tx + dx;
              const ny = ty + dy;
              if (nx > 0 && nx < GRID_W - 1 && ny > 0 && ny < GRID_H - 1) {
                this.fireMap[ny * GRID_W + nx] = 8;
              }
            }
          }
        }
        this.spatialHash.queryRadius(this.units, tx, ty, rad, (u) => {
          this.damageUnit(u, 45);
        });
        this.spawnParticleBurst(tx, ty, '#fb923c', 18);
        this.spawnFloatingText(tx, ty - 1, 'FIREBOMB!', '#fb923c');
        soundFX.playChime(140, 0.18, 'sawtooth');
        break;
      }
      case 'power_bless': {
        this.spatialHash.queryRadius(this.units, tx, ty, rad + 2, (u) => {
          if (u.kind === UnitKind.SURVIVOR) {
            if (!u.traits.includes('Blessed')) u.traits.push('Blessed');
            u.maxHp += 35;
            u.hp = u.maxHp;
            u.atk += 5;
          }
        });
        this.spawnParticleBurst(tx, ty, '#38bdf8', 12);
        this.spawnFloatingText(tx, ty - 1, 'BLESSED!', '#38bdf8');
        soundFX.playPower();
        break;
      }
      case 'power_coup': {
        const terr = this.territory[ty * GRID_W + tx];
        const targetNation =
          terr >= 0
            ? this.getNation(terr)
            : this.nations.find((n) => n.alive && Math.hypot(n.capitalX - tx, n.capitalY - ty) < 25);
        if (targetNation && targetNation.alive) {
          targetNation.happiness = 10;
          const separatistBias =
            targetNation.territoryTiles > 140 && targetNation.population >= 14 ? 0.72 : 0.55;
          if (Math.random() < separatistBias) {
            this.triggerCivilWar(targetNation);
          } else {
            this.triggerPalaceCoup(targetNation);
          }
          this.addNews('GOD', `A divine riot sparked upheaval inside ${targetNation.name}!`);
          soundFX.playPower();
        } else {
          this.spawnFloatingText(tx, ty - 1, 'Tap a Nation to spark riot', '#cbd5e1');
        }
        break;
      }
      case 'power_heal': {
        const r = rad + 2;
        const rSq = r * r;
        const touchedNations = new Set<number>();
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > rSq) continue;
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx > 0 && nx < GRID_W - 1 && ny > 0 && ny < GRID_H - 1) {
              const idx = ny * GRID_W + nx;
              this.fireMap[idx] = 0;
              if (this.prop[idx] !== PropType.NONE && this.propHp[idx] < this.propMaxHp[idx]) {
                this.propHp[idx] = this.propMaxHp[idx];
              }
              if (this.territory[idx] >= 0) touchedNations.add(this.territory[idx]);
            }
          }
        }
        this.spatialHash.queryRadius(this.units, tx, ty, r + 1, (u) => {
          if (u.kind === UnitKind.SURVIVOR) {
            u.hp = u.maxHp;
            u.hunger = 0;
            u.feverTimer = 0;
            if (u.nationId >= 0) touchedNations.add(u.nationId);
          }
        });
        for (const nid of touchedNations) {
          const n = this.getNation(nid);
          if (n && n.alive) n.happiness = Math.min(100, n.happiness + 6);
        }
        this.spawnParticleBurst(tx, ty, '#34d399', 16);
        this.spawnFloatingText(tx, ty - 1, 'DIVINE HEAL!', '#34d399');
        soundFX.playPower();
        break;
      }
      case 'power_uplift': {
        const terr = this.territory[ty * GRID_W + tx];
        const targetNation =
          terr >= 0
            ? this.getNation(terr)
            : this.nations.find((n) => n.alive && Math.hypot(n.capitalX - tx, n.capitalY - ty) < 28);
        if (targetNation && targetNation.alive) {
          targetNation.meatballs += 45;
          targetNation.scrap += 45;
          targetNation.allenWrenches += 35;
          targetNation.happiness = Math.min(100, targetNation.happiness + 8);
          const idx = ty * GRID_W + tx;
          const inSummit = Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 1;
          if (!inSummit && this.prop[idx] === PropType.NONE) {
            this.placeNationProp(tx, ty, PropType.SPOTLIGHT, 180, targetNation.id);
            this.dirtyLight = true;
          }
          this.spawnParticleBurst(tx, ty, '#fbbf24', 18);
          this.spawnFloatingText(tx, ty - 1, 'GOLDEN GIFT!', '#ffda1a');
          this.addNews('GOD', `Divine IKEA supplies rained upon ${targetNation.name}!`);
          soundFX.playPower();
        } else {
          this.spawnFloatingText(tx, ty - 1, 'Tap a Nation to gift supplies', '#cbd5e1');
        }
        break;
      }
      case 'power_lightning': {
        const strikeR = Math.max(2, Math.round(rad * 0.85));
        const rSq = strikeR * strikeR;
        for (let dy = -strikeR - 2; dy <= strikeR + 2; dy++) {
          for (let dx = -strikeR - 2; dx <= strikeR + 2; dx++) {
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx <= 1 || nx >= GRID_W - 1 || ny <= 1 || ny >= GRID_H - 1) continue;
            const idx = ny * GRID_W + nx;
            this.disabledLightMap[idx] = 0;
            if (dx * dx + dy * dy <= 2 && this.prop[idx] !== PropType.CHECKOUT_FLAG) {
              this.ejectBuildingOccupants(idx);
              this.prop[idx] = PropType.NONE;
              this.propOwner[idx] = -1;
              this.propHp[idx] = 0;
              this.fireMap[idx] = 5;
            }
          }
        }
        this.spatialHash.queryRadius(this.units, tx, ty, strikeR + 0.5, (u) => {
          const d = Math.hypot(u.x - tx, u.y - ty);
          if (u.kind === UnitKind.SURVIVOR && u.traits.includes('Blessed')) {
            if (!u.traits.includes('Speedy')) {
              u.traits.push('Speedy');
              u.speed = 5.6;
            }
            return;
          }
          this.damageUnit(u, d < 1.8 ? 110 : 58);
        });
        this.dirtyLight = true;
        this.spawnParticleBurst(tx, ty, '#fde047', 20);
        this.spawnFloatingText(tx, ty - 1, 'LIGHTNING STRIKE!', '#fde047');
        soundFX.playChime(880, 0.14, 'square');
        break;
      }
      case 'power_meteor': {
        const blastR = rad + 1;
        const rSq = blastR * blastR;
        const craterSq = Math.max(2, (blastR * 0.55) * (blastR * 0.55));
        for (let dy = -blastR; dy <= blastR; dy++) {
          for (let dx = -blastR; dx <= blastR; dx++) {
            const dSq = dx * dx + dy * dy;
            if (dSq > rSq) continue;
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx <= 1 || nx >= GRID_W - 1 || ny <= 1 || ny >= GRID_H - 1) continue;
            const idx = ny * GRID_W + nx;
            if (this.prop[idx] !== PropType.CHECKOUT_FLAG) {
              this.ejectBuildingOccupants(idx);
              this.prop[idx] = PropType.NONE;
              this.propOwner[idx] = -1;
              this.propHp[idx] = 0;
            }
            if (dSq <= craterSq) {
              this.biome[idx] = BiomeType.DARK_SECTOR;
            } else if (Math.random() < 0.55) {
              this.fireMap[idx] = 9;
            }
          }
        }
        this.spatialHash.queryRadius(this.units, tx, ty, blastR + 1.5, (u) => {
          const d = Math.hypot(u.x - tx, u.y - ty);
          this.damageUnit(u, d <= blastR * 0.5 ? 140 : 70);
        });
        this.dirtyMap = true;
        this.dirtyLight = true;
        this.spawnParticleBurst(tx, ty, '#fb923c', 26);
        this.spawnFloatingText(tx, ty - 1.5, 'METEOR IMPACT!', '#f97316');
        soundFX.playChime(110, 0.22, 'sawtooth');
        break;
      }
      case 'power_peace': {
        const terr = this.territory[ty * GRID_W + tx];
        const targetNation =
          terr >= 0
            ? this.getNation(terr)
            : this.nations.find((n) => n.alive && Math.hypot(n.capitalX - tx, n.capitalY - ty) < 30);
        if (targetNation && targetNation.alive) {
          let endedWars = 0;
          for (const other of this.nations) {
            if (!other.alive || other.id === targetNation.id) continue;
            if (this.getStance(targetNation.id, other.id) === 'WAR') {
              this.setRelation(targetNation.id, other.id, 'TRUCE', 2);
              other.warExhaustion = 0;
              endedWars++;
            }
          }
          targetNation.warExhaustion = 0;
          targetNation.happiness = Math.min(100, targetNation.happiness + 12);
          this.spawnParticleBurst(tx, ty, '#2dd4bf', 14);
          this.spawnFloatingText(tx, ty - 1, 'DIVINE PEACE!', '#2dd4bf');
          this.addNews(
            'GOD',
            endedWars > 0
              ? `A Divine Peace calmed ${targetNation.name}, ending ${endedWars} war${endedWars > 1 ? 's' : ''}!`
              : `A Divine Blessing filled ${targetNation.name} with peace & harmony.`
          );
          soundFX.playPower();
        } else {
          this.spawnFloatingText(tx, ty - 1, 'Tap a Nation for Peace', '#cbd5e1');
        }
        break;
      }
      case 'power_war': {
        const terr = this.territory[ty * GRID_W + tx];
        const targetNation =
          terr >= 0
            ? this.getNation(terr)
            : this.nations.find((n) => n.alive && Math.hypot(n.capitalX - tx, n.capitalY - ty) < 30);
        if (targetNation && targetNation.alive) {
          const candidates = this.nations.filter(
            (o) =>
              o.alive &&
              o.id !== targetNation.id &&
              this.getStance(targetNation.id, o.id) !== 'WAR' &&
              targetNation.overlordId !== o.id &&
              o.overlordId !== targetNation.id
          );
          candidates.sort(
            (a, b) =>
              Math.hypot(a.capitalX - targetNation.capitalX, a.capitalY - targetNation.capitalY) -
              Math.hypot(b.capitalX - targetNation.capitalX, b.capitalY - targetNation.capitalY)
          );
          const rival = candidates[0];
          if (rival) {
            this.setRelation(targetNation.id, rival.id, 'WAR');
            targetNation.threatScore += 8;
            this.spawnParticleBurst(tx, ty, '#f43f5e', 14);
            this.spawnFloatingText(tx, ty - 1, 'WAR SPARKED!', '#f43f5e');
            this.addNews('GOD', `Divine Whisper of War: ${targetNation.name} declared WAR on ${rival.name}!`);
            soundFX.playAlert(true);
          } else {
            this.spawnFloatingText(tx, ty - 1, 'Already at war with rivals!', '#fbbf24');
          }
        } else {
          this.spawnFloatingText(tx, ty - 1, 'Tap a Nation to spark war', '#cbd5e1');
        }
        break;
      }
      case 'power_staff_purge': {
        let purged = 0;
        this.spatialHash.queryRadius(this.units, tx, ty, rad + 4, (u) => {
          if (u.kind >= UnitKind.STAFF_NORMAL && u.kind <= UnitKind.STAFF_MANAGER) {
            this.damageUnit(u, u.hp + 999);
            purged++;
          }
        });
        this.spawnParticleBurst(tx, ty, '#fef08a', 22);
        this.spawnFloatingText(
          tx,
          ty - 1.2,
          purged > 0 ? `DAWN PURGE (${purged})!` : 'DAWN PURGE!',
          '#fef08a'
        );
        soundFX.playPower();
        break;
      }
      case 'power_time_shift': {
        if (this.isNight) {
          if (this.day > 0 && this.day % 10 === 0) {
            this.records.auditNightsSurvived += 1;
          }
          this.day++;
          this.cycleTimer = 2;
          this.isNight = false;
          this.onNewDay();
          if (this.day % 2 === 1) {
            this.restockIkeaStore();
          }
          this.addNews('GOD', `Divine Dawn: Overhead fluorescents snapped back ON (Day ${this.day})!`);
          this.spawnParticleBurst(tx, ty, '#ffda1a', 18);
          this.spawnFloatingText(tx, ty - 1.2, 'STORE OPEN!', '#ffda1a');
        } else {
          this.cycleTimer = DAY_DURATION + 1;
          this.isNight = true;
          if (!this.summitLoungeSessionActive) {
            this.summitActiveTimer = 0;
            this.summitDiscussed = false;
          }
          if (this.day % 10 === 0) {
            this.triggerAuditNight();
          } else {
            this.addNews('GOD', `Divine Closing: Night ${this.day} descended early across the store!`);
          }
          this.spawnParticleBurst(tx, ty, '#f87171', 18);
          this.spawnFloatingText(tx, ty - 1.2, 'STORE CLOSED!', '#f87171');
        }
        this.dirtyLight = true;
        soundFX.playAlert(this.isNight);
        soundFX.setPhase(this.isNight, this.paused);
        break;
      }
      case 'power_rally_guard': {
        let conscripted = 0;
        let buffed = 0;
        this.spatialHash.queryRadius(this.units, tx, ty, rad + 2, (u) => {
          if (u.kind !== UnitKind.SURVIVOR) return;
          const n = u.nationId >= 0 ? this.getNation(u.nationId) : undefined;
          if (
            u.role !== SurvivorRole.LEADER &&
            u.role !== SurvivorRole.GENERAL &&
            u.role !== SurvivorRole.GUARD
          ) {
            this.applyRoleStats(u, n, SurvivorRole.GUARD);
            u.hp = u.maxHp;
            u.hasTarget = false;
            u.chatEmoji = '🛡️';
            u.chatTimer = 2.0;
            conscripted++;
          } else if (u.role === SurvivorRole.GUARD) {
            u.maxHp += 25;
            u.hp = u.maxHp;
            u.atk += 3;
            if (!u.traits.includes('Tough')) u.traits.push('Tough');
            u.chatEmoji = '⚔️';
            u.chatTimer = 2.0;
            buffed++;
          }
        });
        if (conscripted > 0) {
          this.recountTerritoryAndHousing();
        }
        this.spawnParticleBurst(tx, ty, '#38bdf8', 18);
        this.spawnFloatingText(
          tx,
          ty - 1.2,
          conscripted + buffed > 0 ? `CONSCRIPTED (${conscripted + buffed})!` : 'NO SURVIVORS NEARBY',
          '#38bdf8'
        );
        soundFX.playPower();
        break;
      }
      case 'power_restock': {
        const dropR = rad + 1;
        let placed = 0;
        for (let dy = -dropR; dy <= dropR; dy++) {
          for (let dx = -dropR; dx <= dropR; dx++) {
            if (dx * dx + dy * dy > dropR * dropR) continue;
            if (Math.random() > 0.42) continue;
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx <= 2 || nx >= GRID_W - 2 || ny <= 2 || ny >= GRID_H - 2) continue;
            if (Math.hypot(nx - SUMMIT_X, ny - SUMMIT_Y) <= SUMMIT_RADIUS + 1) continue;
            const idx = ny * GRID_W + nx;
            if (this.prop[idx] !== PropType.NONE) continue;
            const roll = Math.random();
            if (roll < 0.4) {
              this.prop[idx] = PropType.MEATBALL_VAT;
              this.propHp[idx] = 120;
              this.propMaxHp[idx] = 120;
            } else if (roll < 0.72) {
              this.prop[idx] = PropType.WOOD_PALLET;
              this.propHp[idx] = 80;
              this.propMaxHp[idx] = 80;
            } else {
              this.prop[idx] = PropType.SHELF;
              this.propHp[idx] = 100;
              this.propMaxHp[idx] = 100;
            }
            this.propOwner[idx] = -1;
            placed++;
          }
        }
        if (placed > 0) {
          this.dirtyMap = true;
        }
        this.spawnParticleBurst(tx, ty, '#ffda1a', 18);
        this.spawnFloatingText(
          tx,
          ty - 1.2,
          placed > 0 ? `RESTOCKED (${placed})!` : 'AISLE FULL',
          '#ffda1a'
        );
        soundFX.playPower();
        break;
      }
      case 'power_plague': {
        let hit = 0;
        this.spatialHash.queryRadius(this.units, tx, ty, rad + 2, (u) => {
          u.hunger = Math.min(100, u.hunger + 40);
          u.speed = Math.max(2.4, u.speed * 0.85);
          u.chatEmoji = '🤢';
          u.chatTimer = 2.2;
          this.damageUnit(u, 35);
          hit++;
        });
        this.spawnParticleBurst(tx, ty, '#84cc16', 20);
        this.spawnFloatingText(
          tx,
          ty - 1.2,
          hit > 0 ? `SPOILED MEAT (${hit})!` : 'SPOILED MEAT!',
          '#84cc16'
        );
        soundFX.playChime(190, 0.14, 'sawtooth');
        break;
      }
      case 'build_spotlight':
      case 'build_watchtower':
      case 'build_wall':
      case 'build_bistro': {
        const idx = ty * GRID_W + tx;
        const inSummit = Math.hypot(tx - SUMMIT_X, ty - SUMMIT_Y) <= SUMMIT_RADIUS + 1;
        if (inSummit || this.prop[idx] === PropType.CHECKOUT_FLAG) {
          this.spawnFloatingText(tx, ty - 1, 'Protected tile', '#94a3b8');
          break;
        }
        let ownerId = this.territory[idx];
        let ownerNation = ownerId >= 0 ? this.getNation(ownerId) : undefined;
        if (!ownerNation || !ownerNation.alive) {
          let bestDist = 18;
          ownerNation = undefined;
          for (const n of this.nations) {
            if (!n.alive) continue;
            const d = Math.hypot(n.capitalX - tx, n.capitalY - ty);
            if (d < bestDist) {
              bestDist = d;
              ownerNation = n;
            }
          }
          ownerId = ownerNation ? ownerNation.id : -1;
        }
        const propType =
          tool === 'build_spotlight'
            ? PropType.SPOTLIGHT
            : tool === 'build_watchtower'
              ? PropType.WATCHTOWER
              : tool === 'build_bistro'
                ? PropType.BISTRO
                : PropType.BARRICADE_WALL;
        const hp =
          propType === PropType.WATCHTOWER
            ? 190
            : propType === PropType.BISTRO
              ? 150
              : propType === PropType.SPOTLIGHT
                ? 150
                : 150;
        const variant = propType === PropType.BARRICADE_WALL ? 1 + ((tx + ty) % 4) : 0;
        this.ejectBuildingOccupants(idx);
        this.placeNationProp(tx, ty, propType, hp, ownerId, variant);
        if (ownerId >= 0 && this.territory[idx] === -1) {
          this.territory[idx] = ownerId;
          this.dirtyMap = true;
        }
        this.dirtyLight = true;
        this.recountTerritoryAndHousing();
        this.spawnParticleBurst(tx + 0.5, ty + 0.5, ownerNation?.color || '#ffda1a', 7);
        soundFX.playChime(620, 0.06);
        break;
      }
    }
  }

  public getBuildingAtTile(tx: number, ty: number): InspectedBuilding | null {
    const gx = Math.max(0, Math.min(GRID_W - 1, tx | 0));
    const gy = Math.max(0, Math.min(GRID_H - 1, ty | 0));
    const idx = gy * GRID_W + gx;
    const p = this.prop[idx];
    const isKingdomStruct =
      p === PropType.MATTRESS_HUT ||
      p === PropType.BISTRO ||
      p === PropType.WORKSHOP ||
      p === PropType.ARCHIVE ||
      p === PropType.CART_DEPOT ||
      p === PropType.WATCHTOWER ||
      p === PropType.SPOTLIGHT ||
      p === PropType.CHECKOUT_FLAG ||
      p === PropType.BARRICADE_WALL ||
      p === PropType.BARRICADE_GATE;
    if (!isKingdomStruct) return null;

    const occupants: Array<{ id: number; name: string; role: SurvivorRole }> = [];
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.alive || (u.insideTimer ?? 0) <= 0 || u.insideBuildingIdx !== idx) continue;
      occupants.push({ id: u.id, name: u.name, role: u.role });
    }
    return {
      idx,
      tx: gx,
      ty: gy,
      prop: p,
      hp: this.propHp[idx],
      maxHp: Math.max(1, this.propMaxHp[idx]),
      ownerId: this.propOwner[idx],
      occupants,
      disabled: this.disabledLightMap[idx] > 0,
    };
  }

  public repairBuildingAt(idx: number): boolean {
    if (idx < 0 || idx >= GRID_W * GRID_H || this.prop[idx] === PropType.NONE) return false;
    this.propHp[idx] = Math.max(this.propHp[idx], this.propMaxHp[idx]);
    this.fireMap[idx] = 0;
    this.disabledLightMap[idx] = 0;
    this.dirtyLight = true;
    const tx = idx % GRID_W;
    const ty = (idx / GRID_W) | 0;
    this.spawnParticleBurst(tx + 0.5, ty + 0.5, '#34d399', 8);
    this.spawnFloatingText(tx + 0.5, ty - 1, 'REPAIRED!', '#34d399');
    return true;
  }

  public demolishBuildingAt(idx: number): boolean {
    if (idx < 0 || idx >= GRID_W * GRID_H) return false;
    if (this.prop[idx] === PropType.NONE || this.prop[idx] === PropType.CHECKOUT_FLAG) return false;
    const tx = idx % GRID_W;
    const ty = (idx / GRID_W) | 0;
    this.ejectBuildingOccupants(idx);
    this.prop[idx] = PropType.NONE;
    this.propHp[idx] = 0;
    this.propMaxHp[idx] = 0;
    this.propOwner[idx] = -1;
    this.dirtyLight = true;
    this.forceLightRebuild = true;
    this.recountTerritoryAndHousing();
    this.spawnParticleBurst(tx + 0.5, ty + 0.5, '#f87171', 8);
    return true;
  }

  public renameNation(nationId: number, newName: string): boolean {
    const n = this.getNation(nationId);
    const cleaned = newName.trim().slice(0, 28);
    if (!n || !cleaned) return false;
    const oldName = n.name;
    n.name = cleaned;
    if (oldName !== cleaned) {
      this.addNews('POLITICS', `${oldName} was renamed to ${cleaned}!`);
    }
    return true;
  }

  public godSpawnForNation(nationId: number, unitType: 'citizen' | 'guard'): boolean {
    const n = this.getNation(nationId);
    if (!n || !n.alive) return false;
    const count = unitType === 'guard' ? 2 : 3;
    for (let i = 0; i < count; i++) {
      const role = unitType === 'guard' ? SurvivorRole.GUARD : this.pickNeededJobForNation(n, true);
      const sx = Math.max(2, Math.min(GRID_W - 2, n.capitalX + (Math.random() - 0.5) * 4));
      const sy = Math.max(2, Math.min(GRID_H - 2, n.capitalY + (Math.random() - 0.5) * 4));
      this.spawnSurvivor(n.id, role, sx, sy);
    }
    this.recountTerritoryAndHousing();
    this.spawnParticleBurst(n.capitalX + 0.5, n.capitalY + 0.5, n.color, 10);
    this.spawnFloatingText(
      n.capitalX + 0.5,
      n.capitalY - 2,
      unitType === 'guard' ? '+2 Guards!' : '+3 Citizens!',
      n.color
    );
    return true;
  }

  public godSetDiplomacy(aId: number, bId: number, stance: DiplomaticStance): boolean {
    const a = this.getNation(aId);
    const b = this.getNation(bId);
    if (!a || !b || !a.alive || !b.alive || a.id === b.id) return false;
    this.setRelation(a.id, b.id, stance, stance === 'TRUCE' ? 3 : 0);
    if (stance === 'WAR') {
      this.records.totalWarsDeclared += 1;
      this.addNews('WAR', `Divine Decree: ${a.name} & ${b.name} are now at WAR!`);
      this.addChronicle('WAR', `${a.name} vs ${b.name}`, 'War sparked by divine command.', '#ef4444');
    } else if (stance === 'UNION') {
      a.happiness = Math.min(100, a.happiness + 6);
      b.happiness = Math.min(100, b.happiness + 6);
      this.connectUnionLandsAndCorridor(a, b, false);
      this.recountTerritoryAndHousing();
      this.addNews('UNION', `Divine Decree: ${a.name} & ${b.name} linked corridors & walls in Union!`);
      this.spawnFloatingText(a.capitalX, a.capitalY - 2, 'UNION CORRIDOR!', '#fbbf24');
    } else if (stance === 'ALLIANCE') {
      this.addNews('DIPLOMACY', `Divine Decree: ${a.name} & ${b.name} formed an Alliance!`);
    } else if (stance === 'TRADE_PACT') {
      this.addNews('TRADE', `Divine Decree: ${a.name} & ${b.name} opened a Trade Pact!`);
    } else if (stance === 'NEUTRAL' || stance === 'TRUCE') {
      a.warExhaustion = 0;
      b.warExhaustion = 0;
      this.records.totalPeaceTreaties += 1;
      this.addNews('PEACE', `Divine Decree: Peace restored between ${a.name} and ${b.name}.`);
    }
    return true;
  }

  public godUniteNations(aId: number, bId: number): boolean {
    const a = this.getNation(aId);
    const b = this.getNation(bId);
    if (!a || !b || !a.alive || !b.alive || a.id === b.id) return false;
    const aScore = a.population * 5 + a.territoryTiles;
    const bScore = b.population * 5 + b.territoryTiles;
    const primary = aScore >= bScore ? a : b;
    const secondary = primary.id === a.id ? b : a;
    return this.uniteKingdoms(
      primary.id,
      secondary.id,
      `DIVINE UNION: ${a.name} & ${b.name} united by divine decree into one realm!`
    );
  }

  public spawnParticleBurst(x: number, y: number, color: string, baseCount: number): void {
    if (this.particles.length >= 160) return;
    const count = Math.max(1, Math.round(baseCount * this.particleScale));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 2 + Math.random() * 5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        color,
        size: 1.5 + Math.random() * 1.5,
        life: 0.35 + Math.random() * 0.25,
        maxLife: 0.6,
      });
    }
  }

  public spawnFloatingText(x: number, y: number, text: string, color: string): void {
    if (this.floatingTexts.length > 45) return;
    this.floatingTexts.push({
      x,
      y,
      vy: -2.5,
      text,
      color,
      life: 1.6,
      maxLife: 1.6,
    });
  }

  // ==================== MAIN VIEWPORT RENDERING ====================

  public render(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    const nowMs = performance.now();
    if (this.dirtyMap && (this.forceMapRebuild || nowMs - this.lastMapRebuildMs >= 240)) {
      this.rebuildMapCache();
    }
    if (this.dirtyLight && (this.forceLightRebuild || nowMs - this.lastLightRebuildMs >= 180)) {
      this.recomputeLightMap();
    }

    const sprites = getGlowSprites();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#090c12';
    ctx.fillRect(0, 0, viewW, viewH);

    const zoom = this.camera.zoom;
    const halfW = viewW / (2 * zoom);
    const halfH = viewH / (2 * zoom);
    const leftPx = this.camera.x - halfW;
    const topPx = this.camera.y - halfH;

    // 1. Composite visible map chunk from offscreen cached canvas
    const srcX = Math.max(0, leftPx);
    const srcY = Math.max(0, topPx);
    const srcMaxX = Math.min(WORLD_PX_W, leftPx + viewW / zoom);
    const srcMaxY = Math.min(WORLD_PX_H, topPx + viewH / zoom);
    const srcW = srcMaxX - srcX;
    const srcH = srcMaxY - srcY;

    if (srcW > 0 && srcH > 0) {
      const dstX = (srcX - leftPx) * zoom;
      const dstY = (srcY - topPx) * zoom;
      ctx.drawImage(this.mapCanvas, srcX, srcY, srcW, srcH, dstX, dstY, srcW * zoom, srcH * zoom);
    }

    // Transform into world-pixel space
    ctx.save();
    ctx.translate(viewW * 0.5, viewH * 0.5);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // Visible tile bounds (culling)
    const minTx = Math.max(0, ((leftPx / TILE_SIZE) | 0) - 1);
    const maxTx = Math.min(GRID_W - 1, (((leftPx + viewW / zoom) / TILE_SIZE) | 0) + 1);
    const minTy = Math.max(0, ((topPx / TILE_SIZE) | 0) - 1);
    const maxTy = Math.min(GRID_H - 1, (((topPx + viewH / zoom) / TILE_SIZE) | 0) + 1);

    // Pre-collect occupied building tiles so windows & roof badges light up cleanly
    const occupiedBuildings = new Map<number, { count: number; icon: string }>();
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.alive || (u.insideTimer ?? 0) <= 0) continue;
      const bIdx = u.insideBuildingIdx ?? -1;
      if (bIdx < 0) continue;
      const existing = occupiedBuildings.get(bIdx);
      const icon =
        u.role === SurvivorRole.CHEF
          ? '🍖'
          : u.role === SurvivorRole.TINKER
            ? '🔧'
            : u.role === SurvivorRole.TRADER
              ? '🛒'
              : u.role === SurvivorRole.GUARD
                ? '🛡️'
                : '💤';
      if (existing) existing.count += 1;
      else occupiedBuildings.set(bIdx, { count: 1, icon });
    }

    const lodSkipFurniture = zoom < 0.78;

    // 2. Draw visible Props & Distinct 2.5D Kingdom Buildings
    for (let ty = minTy; ty <= maxTy; ty++) {
      const row = ty * GRID_W;
      const py = ty * TILE_SIZE;
      for (let tx = minTx; tx <= maxTx; tx++) {
        const idx = row + tx;
        const p = this.prop[idx];
        const fire = this.fireMap[idx];
        if (p === PropType.NONE && fire === 0) continue;
        if (
          lodSkipFurniture &&
          fire === 0 &&
          (p === PropType.SHELF ||
            p === PropType.WOOD_PALLET ||
            p === PropType.COUCH ||
            p === PropType.BED ||
            p === PropType.LAMP)
        ) {
          continue;
        }
        const px = tx * TILE_SIZE;
        const occ = occupiedBuildings.get(idx);

        if (p === PropType.SHELF) {
          ctx.fillStyle = '#78350f';
          ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          ctx.fillStyle = '#b45309';
          ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, 2);
        } else if (p === PropType.WOOD_PALLET) {
          ctx.fillStyle = '#a16207';
          ctx.fillRect(px + 1, py + 2, TILE_SIZE - 2, TILE_SIZE - 3);
          ctx.fillStyle = '#ca8a04';
          ctx.fillRect(px + 2, py + 3, TILE_SIZE - 4, 1);
        } else if (p === PropType.COUCH) {
          ctx.fillStyle = '#1e40af';
          ctx.fillRect(px + 1, py + 2, TILE_SIZE - 2, TILE_SIZE - 3);
          ctx.fillStyle = '#60a5fa';
          ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, 2);
        } else if (p === PropType.BED) {
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(px + 1, py + 4, TILE_SIZE - 2, TILE_SIZE - 5);
        } else if (p === PropType.LAMP) {
          ctx.fillStyle = '#fde047';
          ctx.fillRect(px + 3, py + 2, 2, 3);
          ctx.fillStyle = '#475569';
          ctx.fillRect(px + 3, py + 5, 2, 2);
        } else if (p === PropType.MEATBALL_VAT) {
          ctx.fillStyle = '#64748b';
          ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          ctx.fillStyle = '#92400e';
          ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
          ctx.fillStyle = '#d97706';
          ctx.fillRect(px + 3, py + 3, 2, 2);
        } else if (p === PropType.BARRICADE_WALL) {
          // Swedish Furniture Barricade Walls with crisp grounded drop shadow
          const variant = this.propVariant[idx];
          const owner = this.propOwner[idx];
          const n = owner >= 0 ? this.getNation(owner) : undefined;
          ctx.fillStyle = 'rgba(9, 12, 18, 0.45)';
          ctx.fillRect(px, py + TILE_SIZE - 1, TILE_SIZE, 2);
          if (variant === 1) {
            ctx.fillStyle = '#92400e';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#fbbf24';
            ctx.fillRect(px + 1, py + 2, 2, 2);
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(px + 4, py + 2, 3, 2);
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(px + 2, py + 5, 4, 2);
          } else if (variant === 2) {
            ctx.fillStyle = '#1d4ed8';
            ctx.fillRect(px, py + 1, TILE_SIZE, TILE_SIZE - 1);
            ctx.fillStyle = '#60a5fa';
            ctx.fillRect(px + 1, py + 2, TILE_SIZE - 2, 3);
          } else if (variant === 3) {
            ctx.fillStyle = '#d97706';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#fef3c7';
            ctx.fillRect(px + 1, py + 1, 2, 2);
            ctx.fillRect(px + 5, py + 1, 2, 2);
            ctx.fillRect(px + 1, py + 5, 2, 2);
            ctx.fillRect(px + 5, py + 5, 2, 2);
          } else if (variant === 4) {
            ctx.fillStyle = '#cbd5e1';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = n ? n.borderColor : '#475569';
            ctx.fillRect(px + 1, py + 2, TILE_SIZE - 2, 2);
            ctx.fillRect(px + 1, py + 5, TILE_SIZE - 2, 2);
          } else {
            ctx.fillStyle = n ? n.borderColor : '#475569';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#94a3b8';
            ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, 2);
          }
        } else if (p === PropType.BARRICADE_GATE) {
          ctx.fillStyle = 'rgba(9, 12, 18, 0.45)';
          ctx.fillRect(px, py + TILE_SIZE - 1, TILE_SIZE, 2);
          ctx.fillStyle = '#334155';
          ctx.fillRect(px, py - 1, 2, TILE_SIZE + 1);
          ctx.fillRect(px + TILE_SIZE - 2, py - 1, 2, TILE_SIZE + 1);
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, 2);
        } else if (p === PropType.MATTRESS_HUT) {
          // 2.5D Pitched Cabin Hut with nation roof trim, front doorway & lit window when occupied
          const owner = this.propOwner[idx];
          const n = owner >= 0 ? this.getNation(owner) : undefined;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.fillRect(px - 1, py + 7, TILE_SIZE + 2, 2);
          ctx.fillStyle = '#090c12';
          ctx.fillRect(px - 1, py - 3, TILE_SIZE + 2, TILE_SIZE + 4);
          // Timber cabin walls
          ctx.fillStyle = '#e7d3b0';
          ctx.fillRect(px, py + 2, TILE_SIZE, TILE_SIZE - 2);
          ctx.fillStyle = '#c4a472';
          ctx.fillRect(px + TILE_SIZE - 2, py + 2, 2, TILE_SIZE - 2);
          // Pitched gable roof with nation trim
          ctx.fillStyle = n ? n.color : '#2563eb';
          ctx.fillRect(px - 1, py - 1, TILE_SIZE + 2, 3);
          ctx.fillRect(px + 1, py - 3, TILE_SIZE - 2, 2);
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(px + 2, py - 3, TILE_SIZE - 4, 1);
          // Doorway & Window
          ctx.fillStyle = occ ? '#fde047' : '#1e1b18';
          ctx.fillRect(px + 3, py + 5, 2, 3);
          ctx.fillStyle = occ ? '#fef08a' : '#475569';
          ctx.fillRect(px + 1, py + 3, 2, 2);
        } else if (p === PropType.SPOTLIGHT) {
          const disabled = this.disabledLightMap[idx] > 0;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.fillRect(px + 1, py + 6, 6, 2);
          ctx.fillStyle = '#090c12';
          ctx.fillRect(px + 1, py - 2, 6, 9);
          ctx.fillStyle = '#334155';
          ctx.fillRect(px + 2, py + 1, 4, 5);
          ctx.fillStyle = disabled ? '#ef4444' : '#fef08a';
          ctx.fillRect(px + 2.5, py - 1, 3, 2.5);
          if (!disabled && !this.isNight) {
            ctx.drawImage(sprites.spotlightDay, px - 20, py - 20, 48, 48);
          }
        } else if (p === PropType.WATCHTOWER) {
          // Tall Fortified Guard Tower with battlements, nation pennant & manned beacon window
          const owner = this.propOwner[idx];
          const n = owner >= 0 ? this.getNation(owner) : undefined;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(px, py + 7, TILE_SIZE, 2);
          ctx.fillStyle = '#090c12';
          ctx.fillRect(px, py - 6, TILE_SIZE, TILE_SIZE + 7);
          // Stone tower shaft
          ctx.fillStyle = '#64748b';
          ctx.fillRect(px + 1, py - 3, TILE_SIZE - 2, TILE_SIZE + 3);
          ctx.fillStyle = '#334155';
          ctx.fillRect(px + TILE_SIZE - 3, py - 3, 2, TILE_SIZE + 3);
          // Battlement parapet & amber beacon trim
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(px, py - 5, TILE_SIZE, 3);
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(px + 1, py - 3, TILE_SIZE - 2, 1);
          // Nation pennant flag on tower roof
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(px + 3, py - 9, 1, 4);
          ctx.fillStyle = n ? n.color : '#f59e0b';
          ctx.fillRect(px + 4, py - 9, 4, 2.5);
          // Arrow slit window & base doorway
          ctx.fillStyle = occ || this.isNight ? '#fef08a' : '#0f172a';
          ctx.fillRect(px + 3, py - 1, 2, 3);
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(px + 3, py + 5, 2, 3);
        } else if (p === PropType.CHECKOUT_FLAG) {
          const owner = this.propOwner[idx];
          const n = owner >= 0 ? this.getNation(owner) : undefined;
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(px + 3, py - 2, 2, TILE_SIZE + 2);
          ctx.fillStyle = n ? n.color : '#3b82f6';
          ctx.fillRect(px + 5, py - 2, 6, 4);
        } else if (p === PropType.BISTRO) {
          // 2.5D Meatball Bistro with outlined storefront, striped blue/yellow awning & glowing hearth
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.fillRect(px - 1, py + 7, TILE_SIZE + 2, 2);
          ctx.fillStyle = '#090c12';
          ctx.fillRect(px - 1, py - 3, TILE_SIZE + 2, TILE_SIZE + 4);
          // Cream café wall
          ctx.fillStyle = '#fef3c7';
          ctx.fillRect(px, py + 2, TILE_SIZE, TILE_SIZE - 2);
          ctx.fillStyle = '#92400e';
          ctx.fillRect(px, py + 6, TILE_SIZE, 2);
          // Raised Swedish blue roof + striped awning
          ctx.fillStyle = '#0058a3';
          ctx.fillRect(px - 1, py - 2, TILE_SIZE + 2, 3);
          ctx.fillStyle = '#ffda1a';
          ctx.fillRect(px + 1, py - 2, 2, 2);
          ctx.fillRect(px + 5, py - 2, 2, 2);
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(px + 2, py - 3, 4, 1);
          // Bistro window & doorway
          ctx.fillStyle = occ ? '#fb923c' : '#334155';
          ctx.fillRect(px + 1, py + 3, 2, 2);
          ctx.fillStyle = occ ? '#fef08a' : '#1e1b18';
          ctx.fillRect(px + 3, py + 5, 2, 3);
          if (occ) {
            ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
            ctx.fillRect(px + 6, py - 5 - ((this.simTime * 3) | 0) % 2, 1.5, 1.5);
          }
        } else if (p === PropType.WORKSHOP) {
          // 2.5D Tinker Smithy Workshop with forge chimney, iron roof & glowing furnace window
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.fillRect(px - 1, py + 7, TILE_SIZE + 2, 2);
          ctx.fillStyle = '#090c12';
          ctx.fillRect(px - 1, py - 3, TILE_SIZE + 2, TILE_SIZE + 4);
          ctx.fillRect(px + 5, py - 6, 3, 4); // chimney outline
          // Steel & slate workshop facade
          ctx.fillStyle = '#64748b';
          ctx.fillRect(px, py + 2, TILE_SIZE, TILE_SIZE - 2);
          ctx.fillStyle = '#475569';
          ctx.fillRect(px + 5, py - 5, 2, 4); // chimney
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(px - 1, py - 2, TILE_SIZE + 2, 3);
          ctx.fillStyle = '#f97316';
          ctx.fillRect(px, py - 1, TILE_SIZE - 2, 1.5);
          // Forge window & door
          ctx.fillStyle = occ ? '#fb923c' : '#1e293b';
          ctx.fillRect(px + 1, py + 3, 2, 2);
          ctx.fillStyle = occ ? '#fde047' : '#0f172a';
          ctx.fillRect(px + 3, py + 5, 2, 3);
          if (occ) {
            ctx.fillStyle = 'rgba(203, 213, 225, 0.8)';
            ctx.fillRect(px + 5.5, py - 7 - ((this.simTime * 4) | 0) % 2, 2, 1.5);
          }
        } else if (p === PropType.ARCHIVE) {
          // 2.5D Tall Grand Archive with purple roof, gold pediment & arched glowing window
          ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
          ctx.fillRect(px - 1, py + 7, TILE_SIZE + 2, 2);
          ctx.fillStyle = '#090c12';
          ctx.fillRect(px - 1, py - 5, TILE_SIZE + 2, TILE_SIZE + 6);
          // Warm mahogany & cream hall
          ctx.fillStyle = '#78350f';
          ctx.fillRect(px, py + 1, TILE_SIZE, TILE_SIZE - 1);
          ctx.fillStyle = '#fef3c7';
          ctx.fillRect(px + 1, py + 2, 1, 5);
          ctx.fillRect(px + 6, py + 2, 1, 5);
          // High violet gabled roof + gold crest
          ctx.fillStyle = '#7e22ce';
          ctx.fillRect(px - 1, py - 2, TILE_SIZE + 2, 3);
          ctx.fillRect(px + 1, py - 4, TILE_SIZE - 2, 2);
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(px + 3, py - 4, 2, 1);
          // Arched window & doorway
          ctx.fillStyle = occ ? '#fef08a' : '#3b0764';
          ctx.fillRect(px + 3, py + 2, 2, 2);
          ctx.fillStyle = occ ? '#fde68a' : '#1e1b18';
          ctx.fillRect(px + 3, py + 5, 2, 3);
        } else if (p === PropType.CART_DEPOT) {
          // 2.5D Logistics Cart Depot with bright cyan bay canopy, wide bay door & nation corner trim
          const owner = this.propOwner[idx];
          const n = owner >= 0 ? this.getNation(owner) : undefined;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.fillRect(px - 1, py + 7, TILE_SIZE + 2, 2);
          ctx.fillStyle = '#090c12';
          ctx.fillRect(px - 1, py - 3, TILE_SIZE + 2, TILE_SIZE + 4);
          // Warehouse masonry
          ctx.fillStyle = '#334155';
          ctx.fillRect(px, py + 2, TILE_SIZE, TILE_SIZE - 2);
          // Wide cargo bay opening
          ctx.fillStyle = occ ? '#1e3a8a' : '#0f172a';
          ctx.fillRect(px + 2, py + 4, 4, 4);
          // Bright cyan canopy roof
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(px - 1, py - 2, TILE_SIZE + 2, 3);
          ctx.fillStyle = '#7dd3fc';
          ctx.fillRect(px, py - 2, TILE_SIZE, 1);
          ctx.fillStyle = n ? n.color : '#38bdf8';
          ctx.fillRect(px, py - 1, 2, 1);
          // Overhead bay lamps
          ctx.fillStyle = occ ? '#fef08a' : '#38bdf8';
          ctx.fillRect(px + 1, py + 3, 1.5, 1.5);
          ctx.fillRect(px + 5.5, py + 3, 1.5, 1.5);
        }

        // Subtle doorway threshold glow + crisp tiny roof activity badge when occupied
        if (occ) {
          ctx.fillStyle = 'rgba(254, 240, 138, 0.38)';
          ctx.fillRect(px + 2, py + 7, 4, 2);
          if (zoom >= 1.15) {
            const topY =
              p === PropType.WATCHTOWER ? py - 10 : p === PropType.ARCHIVE ? py - 7 : py - 5;
            ctx.save();
            ctx.font = '5px "Plus Jakarta Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(occ.icon, px + TILE_SIZE * 0.5, topY);
            ctx.restore();
          }
        }

        // Miniature HP bar for damaged kingdom fortifications & structures
        if (
          p >= PropType.BARRICADE_WALL &&
          p <= PropType.CART_DEPOT &&
          this.propMaxHp[idx] > 0 &&
          this.propHp[idx] < this.propMaxHp[idx]
        ) {
          const pct = Math.max(0, this.propHp[idx] / this.propMaxHp[idx]);
          ctx.fillStyle = 'rgba(9, 12, 18, 0.8)';
          ctx.fillRect(px + 1, py + TILE_SIZE, 6, 1.5);
          ctx.fillStyle = pct > 0.5 ? '#22c55e' : pct > 0.25 ? '#f59e0b' : '#ef4444';
          ctx.fillRect(px + 1, py + TILE_SIZE, 6 * pct, 1.5);
        }

        if (fire > 0) {
          ctx.drawImage(sprites.fireGlow, px - 8, py - 8, 24, 24);
        }
      }
    }

    // 2b. Showroom Lounge Rug & Central Coffee Table at (SUMMIT_X, SUMMIT_Y)
    {
      const lx = (SUMMIT_X + 0.5) * TILE_SIZE;
      const ly = (SUMMIT_Y + 0.5) * TILE_SIZE;
      ctx.save();
      ctx.fillStyle = this.summitLoungeSessionActive || this.summitActiveTimer > 0
        ? 'rgba(0, 88, 163, 0.28)'
        : 'rgba(51, 65, 85, 0.24)';
      ctx.beginPath();
      ctx.arc(lx, ly, 3.2 * TILE_SIZE, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.summitLoungeSessionActive || this.summitActiveTimer > 0
        ? 'rgba(255, 218, 26, 0.55)'
        : 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Low birch IKEA coffee table in center
      ctx.fillStyle = '#d97706';
      ctx.fillRect(lx - 4, ly - 3, 8, 6);
      ctx.fillStyle = '#fde68a';
      ctx.fillRect(lx - 3, ly - 2, 6, 4);
      ctx.restore();
    }

    // 2c. Active Builder Blueprint Markers (batched canvas state)
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 0.7;
    ctx.setLineDash([1.5, 1.5]);
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (
        !u.alive ||
        u.role !== SurvivorRole.BUILDER ||
        u.buildProp === undefined ||
        !u.hasTarget
      ) {
        continue;
      }
      const btx = u.targetX | 0;
      const bty = u.targetY | 0;
      if (btx < minTx || btx > maxTx || bty < minTy || bty > maxTy) continue;
      const n = this.getNation(u.nationId);
      ctx.strokeStyle = n ? n.color : '#38bdf8';
      ctx.strokeRect(btx * TILE_SIZE + 0.5, bty * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    }
    ctx.restore();

    // 2d. Newly Built Structure Pulse Highlights so new kingdom buildings pop immediately
    if (this.recentBuilds.length > 0) {
      ctx.save();
      for (const rb of this.recentBuilds) {
        if (rb.x < minTx - 2 || rb.x > maxTx + 2 || rb.y < minTy - 2 || rb.y > maxTy + 2) continue;
        const progress = 1 - rb.life / rb.maxLife;
        const ringRadius = 4 + ((progress * 2.2) % 1) * 9;
        ctx.strokeStyle = rb.color;
        ctx.globalAlpha = Math.max(0, (1 - progress) * 0.85);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc((rb.x + 0.5) * TILE_SIZE, (rb.y + 0.5) * TILE_SIZE, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Draw Units inside visible bounds (skip units currently sheltered/working inside a building)
    const minUx = minTx - 2;
    const maxUx = maxTx + 2;
    const minUy = minTy - 2;
    const maxUy = maxTy + 2;
    let emojiDrawCount = 0;

    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.alive || (u.insideTimer ?? 0) > 0 || u.x < minUx || u.x > maxUx || u.y < minUy || u.y > maxUy) continue;
      const ux = u.x * TILE_SIZE;
      const uy = u.y * TILE_SIZE;

      if (u.kind === UnitKind.CART_RUNNER) {
        // Blue IKEA shopping cart + runner (or armored Siege Cart Ram)
        const n = this.getNation(u.nationId);
        if (u.isSiegeCart) {
          ctx.fillStyle = '#334155';
          ctx.fillRect(ux - 4, uy - 3, 8, 6);
          ctx.fillStyle = '#1d4ed8';
          ctx.fillRect(ux - 3, uy - 2, 6, 4);
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(ux + 3, uy - 2.5, 2, 5); // steel battering ram bumper
          ctx.fillStyle = n ? n.color : '#f59e0b';
          ctx.fillRect(ux - 4, uy - 5, 3, 2); // war pennant
        } else {
          ctx.fillStyle = '#1d4ed8';
          ctx.fillRect(ux - 3, uy - 2, 6, 4);
          ctx.fillStyle = '#93c5fd';
          ctx.fillRect(ux - 2, uy - 1, 4, 2);
          ctx.fillStyle = n ? n.color : '#fff';
          ctx.fillRect(ux - 5, uy - 3, 2, 4);
        }
      } else if (u.kind >= UnitKind.STAFF_NORMAL && u.kind <= UnitKind.STAFF_MANAGER) {
        // SCP-3008-2 Tall Yellow-Shirted Faceless Staff (passive by day, glowing threat by night)
        const isMgr = u.kind === UnitKind.STAFF_MANAGER;
        const isCrw = u.kind === UnitKind.STAFF_CRAWLER;
        const w = isMgr ? 7 : 4;
        const h = isMgr ? 12 : isCrw ? 5 : 8;
        ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#facc15';
        ctx.fillRect(ux - w / 2, uy - h + 2, w, h - 2);
        // Faceless pale head
        ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#fef3c7';
        ctx.fillRect(ux - (w - 1) / 2, uy - h - 1, w - 1, 3);
        if (this.isNight) {
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(ux - 1, uy - h + 1, 2, 1.5);
        }
        // Dark trousers
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(ux - w / 2, uy, w, 2);
      } else {
        // Survivor / Leader / Guard / Saboteur
        const n = u.nationId >= 0 ? this.getNation(u.nationId) : undefined;
        const bodyColor =
          u.hitFlash > 0
            ? '#ffffff'
            : u.kind === UnitKind.SABOTEUR
              ? '#111827'
              : n
                ? n.color
                : u.role === SurvivorRole.TRADER
                  ? '#f59e0b'
                  : '#94a3b8';

        // Body
        ctx.fillStyle = bodyColor;
        ctx.fillRect(ux - 2, uy - 4, 4, 5);
        // Head
        ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#fde68a';
        ctx.fillRect(ux - 1.5, uy - 6.5, 3, 2.5);

        // Speaking leader highlight ring during Summit Lounge talk
        if (
          u.role === SurvivorRole.LEADER &&
          this.summitSpeakingNationId === u.nationId &&
          this.summitSpeakingTimer > 0
        ) {
          ctx.strokeStyle = '#ffda1a';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(ux, uy - 2, 6.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Leader Golden Pixel Crown
        if (u.role === SurvivorRole.LEADER) {
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(ux - 2, uy - 8.5, 4, 2);
          ctx.fillStyle = '#fef08a';
          ctx.fillRect(ux - 2, uy - 9.5, 1, 1);
          ctx.fillRect(ux, uy - 9.5, 1, 1);
          ctx.fillRect(ux + 1, uy - 9.5, 1, 1);
        }

        // Guard visible makeshift gear (table-leg spear & pot-lid shield)
        if (u.role === SurvivorRole.GUARD) {
          ctx.fillStyle = n && n.techTier >= 3 ? '#e2e8f0' : '#a16207';
          ctx.fillRect(ux + 2, uy - 7, 1, 7); // spear
          ctx.fillStyle = n && n.techTier >= 2 ? '#94a3b8' : '#64748b';
          ctx.fillRect(ux - 3.5, uy - 4, 2, 3); // pot-lid shield
        }

        // War General officer cap, gold epaulettes, command banner & tactical ring
        if (u.role === SurvivorRole.GENERAL) {
          ctx.strokeStyle = n ? n.color : '#f59e0b';
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.arc(ux, uy - 1, 7.2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;

          // Peaked crimson/gold officer cap
          ctx.fillStyle = '#991b1b';
          ctx.fillRect(ux - 2, uy - 8, 4, 1.8);
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(ux - 1.5, uy - 8.5, 3, 0.8);
          // Gold shoulder epaulettes
          ctx.fillRect(ux - 3, uy - 4, 1, 1);
          ctx.fillRect(ux + 2, uy - 4, 1, 1);
          // Command standard pole + nation pennant
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(ux + 2.5, uy - 10, 1, 10);
          ctx.fillStyle = n ? n.color : '#ef4444';
          ctx.fillRect(ux + 3.5, uy - 10, 4, 2.5);
        }

        // Chef white toque hat & apron
        if (u.role === SurvivorRole.CHEF) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(ux - 1.5, uy - 8.5, 3, 2); // chef hat
          ctx.fillRect(ux - 1.5, uy - 3, 3, 2.5); // apron
        }

        // Tinker cyan goggles & silver wrench
        if (u.role === SurvivorRole.TINKER) {
          ctx.fillStyle = '#22d3ee';
          ctx.fillRect(ux - 1.5, uy - 6, 3, 1); // safety goggles
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(ux + 2, uy - 4.5, 1.5, 3); // wrench
        }

        // Merchant Trader golden vest/satchel
        if (u.role === SurvivorRole.TRADER && u.nationId >= 0) {
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(ux - 2.5, uy - 3.5, 1.5, 3);
        }

        // Builder yellow safety hard-hat & construction hammer
        if (u.role === SurvivorRole.BUILDER) {
          ctx.fillStyle = '#facc15';
          ctx.fillRect(ux - 2, uy - 8, 4, 1.6); // yellow hard-hat
          ctx.fillStyle = '#92400e';
          ctx.fillRect(ux + 2, uy - 4.5, 1, 3.5); // hammer handle
          ctx.fillStyle = '#cbd5e1';
          ctx.fillRect(ux + 1.5, uy - 5.2, 2.2, 1.2); // steel hammer head
        }

        // Scavenger carry pixel icon
        if (u.carryAmount > 0) {
          ctx.fillStyle =
            u.carryType === 'meatball'
              ? '#b45309'
              : u.carryType === 'wrench'
                ? '#e2e8f0'
                : '#a16207';
          ctx.fillRect(ux + 2, uy - 3, 2.5, 2.5);
        }

        // Veteran Hero golden star pip
        if (u.veteranTitle) {
          ctx.fillStyle = '#fef08a';
          ctx.fillRect(ux - 2.5, uy - 7.5, 1.5, 1.5);
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(ux - 2.2, uy - 7.2, 1, 1);
        }

        // Fever aura
        if (u.feverTimer > 0) {
          ctx.drawImage(sprites.feverGlow, ux - 6, uy - 7, 12, 12);
        }

        // Lightweight zero-lag emoji bubble when resting/talking (capped at 20 per frame)
        if (u.chatTimer > 0 && u.chatEmoji && emojiDrawCount < 20) {
          emojiDrawCount++;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillRect(ux - 4.5, uy - 17, 9, 8);
          ctx.font = '6px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(u.chatEmoji, ux, uy - 10.5);
        }
      }

      // Damaged HP bar
      if (u.hp < u.maxHp) {
        const pct = Math.max(0, u.hp / u.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(ux - 3, uy - 11, 6, 1.5);
        ctx.fillStyle = pct > 0.45 ? '#22c55e' : '#ef4444';
        ctx.fillRect(ux - 3, uy - 11, 6 * pct, 1.5);
      }
    }

    // 3b. Draw subtle War Front lines & General Tactical Advance Vectors
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
    for (let i = 0; i < this.nations.length; i++) {
      const a = this.nations[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.nations.length; j++) {
        const b = this.nations[j];
        if (!b.alive) continue;
        if (this.getStance(a.id, b.id) === 'WAR') {
          ctx.beginPath();
          ctx.moveTo(a.capitalX * TILE_SIZE, a.capitalY * TILE_SIZE);
          ctx.lineTo(b.capitalX * TILE_SIZE, b.capitalY * TILE_SIZE);
          ctx.stroke();
        }
      }
    }
    // Draw each General's active strategic march line toward rally or enemy
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    for (const n of this.nations) {
      if (!n.alive || !n.battlePlan) continue;
      const gen = this.units.find((u) => u.alive && u.id === n.battlePlan!.generalUnitId);
      const enemy = this.getNation(n.battlePlan.targetNationId);
      if (!gen || !enemy || !enemy.alive) continue;
      const tx = n.battlePlan.phase === 'MUSTER' ? n.battlePlan.rallyX : enemy.capitalX;
      const ty = n.battlePlan.phase === 'MUSTER' ? n.battlePlan.rallyY : enemy.capitalY;
      ctx.strokeStyle = n.color;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(gen.x * TILE_SIZE, gen.y * TILE_SIZE);
      ctx.lineTo(tx * TILE_SIZE, ty * TILE_SIZE);
      ctx.stroke();
    }
    ctx.restore();

    // Neutral Summit Lounge marker is drawn in crisp screen coordinates below

    // 4. Projectiles & Particles
    ctx.fillStyle = '#fef08a';
    for (const pr of this.projectiles) {
      ctx.fillRect(pr.x * TILE_SIZE - 1, pr.y * TILE_SIZE - 1, 2, 2);
    }

    for (const pt of this.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x * TILE_SIZE, pt.y * TILE_SIZE, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // 5. Night Emergency Lighting Overlay (Zero shadowBlur!)
    const nightAlpha = this.computeNightAlpha();
    if (nightAlpha > 0.02) {
      this.renderNightOverlay(
        ctx,
        viewW,
        viewH,
        leftPx,
        topPx,
        zoom,
        nightAlpha,
        minTx,
        maxTx,
        minTy,
        maxTy,
        occupiedBuildings
      );
    }

    // 6. Floating Damage / Speech Popups
    ctx.font = 'bold 5px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    for (const ft of this.floatingTexts) {
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      ctx.fillStyle = '#000000';
      ctx.fillText(ft.text, ft.x * TILE_SIZE + 0.5, ft.y * TILE_SIZE + 0.5);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x * TILE_SIZE, ft.y * TILE_SIZE);
    }
    ctx.globalAlpha = 1;

    // 6b. Named IKEA Store Department Floor Signage (visible at medium/high zoom)
    if (zoom >= 0.55 && zoom <= 2.3) {
      ctx.save();
      ctx.font = '600 6px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(226, 232, 240, 0.28)';
      const departments = [
        { x: 46, y: 38, label: 'SELF-SERVE WAREHOUSE' },
        { x: 188, y: 40, label: 'BEDDING & SHOWROOM' },
        { x: 52, y: 138, label: 'FOOD COURT WEST' },
        { x: 186, y: 140, label: 'DARK AS-IS SECTOR' },
      ];
      for (const dept of departments) {
        if (dept.x >= minTx - 12 && dept.x <= maxTx + 12 && dept.y >= minTy - 12 && dept.y <= maxTy + 12) {
          ctx.fillText(dept.label, dept.x * TILE_SIZE, dept.y * TILE_SIZE);
        }
      }
      ctx.restore();
    }

    ctx.restore();

    // 7. Crisp Floating Nation Banners & Summit Lounge Banner (drawn in screen pixels!)
    this.bannerHitboxes = [];
    this.summitBannerHitbox = null;

    {
      const lsx = ((SUMMIT_X + 0.5) * TILE_SIZE - this.camera.x) * zoom + viewW * 0.5;
      const lsy = ((SUMMIT_Y - 5.2) * TILE_SIZE - this.camera.y) * zoom + viewH * 0.5;
      if (lsx >= -140 && lsx <= viewW + 140 && lsy >= -40 && lsy <= viewH + 40) {
        const active = this.summitLoungeSessionActive || this.summitActiveTimer > 0;
        const label = this.summitLoungeSessionActive
          ? 'Summit Lounge · Live Talk'
          : active
            ? 'Summit Lounge · Active'
            : 'Summit Lounge';
        ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
        const tw = ctx.measureText(label).width;
        const bw = tw + 20;
        const bh = 22;
        const bx = lsx - bw / 2;
        const by = lsy - bh;

        ctx.fillStyle = active ? 'rgba(15, 23, 42, 0.92)' : 'rgba(13, 17, 23, 0.84)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = active ? '#ffda1a' : '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, bw, bh);

        ctx.fillStyle = active ? '#ffda1a' : '#38bdf8';
        ctx.fillRect(bx + 5, by + 6, 6, 10);

        ctx.fillStyle = active ? '#fef08a' : '#e2e8f0';
        ctx.textAlign = 'left';
        ctx.fillText(label, bx + 14, by + 15);
        this.summitBannerHitbox = { sx: bx, sy: by, w: bw, h: bh };
      }
    }

    ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'left';
    for (const n of this.nations) {
      const showDepopulated = !n.alive && n.defeatedStatus === 'DEPOPULATED' && n.territoryTiles > 0;
      if (!n.alive && !showDepopulated) continue;
      const sx = (n.capitalX * TILE_SIZE - this.camera.x) * zoom + viewW * 0.5;
      const sy = (n.capitalY * TILE_SIZE - this.camera.y) * zoom + viewH * 0.5 - 18 * Math.min(1.4, zoom);
      if (sx < -140 || sx > viewW + 140 || sy < -40 || sy > viewH + 40) continue;

      const atWar = n.alive && Object.values(n.relations).some((r) => r.stance === 'WAR');
      const label = showDepopulated
        ? `${n.name} · Depopulated`
        : `${atWar ? '⚔ ' : ''}${n.name} · T${n.techTier} · ${n.population}`;
      const textW = ctx.measureText(label).width;
      const boxW = textW + 18;
      const boxH = 22;
      const bx = sx - boxW / 2;
      const by = sy - boxH;

      ctx.fillStyle = showDepopulated ? 'rgba(15, 23, 42, 0.84)' : 'rgba(13, 17, 23, 0.86)';
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = showDepopulated ? '#64748b' : n.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, boxW, boxH);

      // Nation flag swatch
      ctx.fillStyle = showDepopulated ? '#64748b' : n.color;
      ctx.fillRect(bx + 5, by + 6, 6, 10);

      ctx.fillStyle = showDepopulated ? '#94a3b8' : '#f8fafc';
      ctx.fillText(label, bx + 14, by + 15);

      this.bannerHitboxes.push({ nationId: n.id, sx: bx, sy: by, w: boxW, h: boxH });
    }
  }

  private computeNightAlpha(): number {
    if (!this.isNight) {
      // Smooth dusk fade-in in last 3s of day
      if (this.cycleTimer > DAY_DURATION - 3) {
        return ((this.cycleTimer - (DAY_DURATION - 3)) / 3) * 0.72;
      }
      return 0;
    }
    const nTime = this.cycleTimer - DAY_DURATION;
    if (nTime > 25 - 3) {
      return ((25 - nTime) / 3) * 0.72;
    }
    return 0.72;
  }

  private renderNightOverlay(
    mainCtx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    leftPx: number,
    topPx: number,
    zoom: number,
    nightAlpha: number,
    minTx: number,
    maxTx: number,
    minTy: number,
    maxTy: number,
    occupiedBuildings?: Map<number, { count: number; icon: string }>
  ): void {
    const lCanvas = this.lightOverlayCanvas;
    const lw = lCanvas.width;
    const lh = lCanvas.height;
    const lCtx = this.lightOverlayCtx;
    const sprites = getGlowSprites();

    lCtx.globalCompositeOperation = 'source-over';
    lCtx.clearRect(0, 0, lw, lh);
    // Eerie blue/red emergency night tint
    const redPulse = 0.08 + 0.05 * Math.sin(this.simTime * 2.2);
    lCtx.fillStyle = `rgba(10, 14, 34, ${nightAlpha})`;
    lCtx.fillRect(0, 0, lw, lh);
    lCtx.fillStyle = `rgba(153, 27, 27, ${redPulse * nightAlpha})`;
    lCtx.fillRect(0, 0, lw, lh);

    // Punch out warm circles around active Spotlights, Watchtowers, Flags, and occupied buildings
    lCtx.globalCompositeOperation = 'destination-out';
    const scaleX = lw / viewW;
    const scaleY = lh / viewH;
    const visMinTx = Math.max(0, minTx - 12);
    const visMaxTx = Math.min(GRID_W - 1, maxTx + 12);
    const visMinTy = Math.max(0, minTy - 12);
    const visMaxTy = Math.min(GRID_H - 1, maxTy + 12);

    const drawCutout = (idx: number, p: PropType) => {
      const tx = idx % GRID_W;
      const ty = (idx / GRID_W) | 0;
      if (tx < visMinTx || tx > visMaxTx || ty < visMinTy || ty > visMaxTy) return;
      const owner = this.propOwner[idx];
      const ownerNation = owner >= 0 ? this.getNation(owner) : undefined;
      const floodBonus = hasTech(ownerNation, 'halogen_floodlights') ? 3 : 0;
      const radTiles =
        p === PropType.SPOTLIGHT
          ? SPOTLIGHT_RADIUS + floodBonus
          : p === PropType.CHECKOUT_FLAG
            ? FLAG_LIGHT_RADIUS + floodBonus
            : p === PropType.WATCHTOWER
              ? WATCHTOWER_RADIUS + floodBonus
              : 3.2;
      const sx = ((tx + 0.5) * TILE_SIZE - leftPx) * zoom * scaleX;
      const sy = ((ty + 0.5) * TILE_SIZE - topPx) * zoom * scaleY;
      const sr = radTiles * TILE_SIZE * zoom * scaleX;
      lCtx.drawImage(sprites.spotlightNight, sx - sr, sy - sr, sr * 2, sr * 2);
    };

    for (let li = 0; li < this.lightSourceIndices.length; li++) {
      const idx = this.lightSourceIndices[li];
      const p = this.prop[idx];
      if (
        (p === PropType.SPOTLIGHT || p === PropType.WATCHTOWER || p === PropType.CHECKOUT_FLAG) &&
        this.disabledLightMap[idx] === 0
      ) {
        drawCutout(idx, p);
      }
    }

    if (occupiedBuildings && occupiedBuildings.size > 0) {
      occupiedBuildings.forEach((_val, idx) => {
        const p = this.prop[idx];
        if (p !== PropType.SPOTLIGHT && p !== PropType.WATCHTOWER && p !== PropType.CHECKOUT_FLAG) {
          drawCutout(idx, p);
        }
      });
    }

    // Draw lighting overlay onto screen (we're currently in world-space transform, draw in screen coords)
    mainCtx.save();
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = mainCtx.canvas.width / viewW;
    mainCtx.scale(dpr, dpr);
    mainCtx.drawImage(lCanvas, 0, 0, viewW, viewH);
    mainCtx.restore();
  }

  public getHudSnapshot(fps: number): HudSnapshot {
    let survivorCount = 0;
    let staffCount = 0;
    let cartCount = 0;
    let totalUnits = 0;

    for (const u of this.units) {
      if (!u.alive) continue;
      totalUnits++;
      if (u.kind === UnitKind.SURVIVOR) survivorCount++;
      else if (u.kind === UnitKind.CART_RUNNER) cartCount++;
      else if (u.kind >= UnitKind.STAFF_NORMAL && u.kind <= UnitKind.STAFF_MANAGER) staffCount++;
    }

    const cycleProgress = this.isNight
      ? (this.cycleTimer - DAY_DURATION) / 25
      : this.cycleTimer / DAY_DURATION;
    const phaseRemainingSec = this.isNight
      ? Math.max(0, Math.ceil(CYCLE_DURATION - this.cycleTimer))
      : Math.max(0, Math.ceil(DAY_DURATION - this.cycleTimer));

    return {
      day: this.day,
      isNight: this.isNight,
      cycleProgress: Math.max(0, Math.min(1, cycleProgress)),
      phaseRemainingSec,
      fps: Math.round(fps),
      totalUnits,
      survivorCount,
      staffCount,
      cartCount,
      nations: this.nations.map((n) => ({
        ...n,
        relations: { ...n.relations },
        leader: { ...n.leader },
        battlePlan: n.battlePlan ? { ...n.battlePlan } : undefined,
        researchedTechs: n.researchedTechs ? [...n.researchedTechs] : [],
      })),
      news: [...this.news],
      chronicle: [...this.chronicle],
      records: { ...this.records },
      paused: this.paused,
      speed: this.speed,
      summitActive: this.summitActiveTimer > 0,
      auditNight: this.isNight && this.day % 10 === 0,
    };
  }
}
