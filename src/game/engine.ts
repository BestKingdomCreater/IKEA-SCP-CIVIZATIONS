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
  STAFF_KINGDOM_NAMES,
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
import {
  CHUNK_H,
  CHUNK_W,
  chunkKey,
  createEmptyChunk,
  generateProceduralChunk,
  SavedWorldChunk,
} from './infiniteWorld';
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
  ActiveAnomaly,
  BannerEmblem,
  BannerStyle,
  BattlePhase,
  BiomeType,
  BrushSize,
  BuildingPattern,
  BuildingSpacing,
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
  isStaffKind,
  Nation,
  NewsCategory,
  NewsItem,
  Particle,
  Projectile,
  PropType,
  SimSpeed,
  StaffInvasionAlert,
  StoreAnomalyType,
  SurvivorRole,
  TaxRate,
  TechId,
  ToolId,
  Unit,
  UnitKind,
  UnitTrait,
  WeaponType,
  WorldPreset,
} from './types';

const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44;
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
  public currentFps = 60;
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
  private techLabIndices: number[] = [];
  private escalatorIndices: number[] = [];
  private occupiedBuildingsCache: Map<number, { count: number; icon: string }> = new Map();
  private warFrontCache: Map<string, { x: number; y: number; simTime: number }> = new Map();
  private activeBuilderTargets: Set<number> = new Set();
  private nationAtWarCache: Set<number> = new Set();
  private nationGeneralCache: Map<number, Unit> = new Map();
  private nationBuildingAlert: Map<number, { x: number; y: number; until: number }> = new Map();
  private blueprintLayoutCache: Map<
    number,
    { key: string; slots: Array<{ dx: number; dy: number; prop: PropType; variant?: number }> }
  > = new Map();
  private unitBlueprintNextTime: Map<number, number> = new Map();
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
  private simTickCount = 0;
  private hasAnyActiveWar = false;
  private lastBorderSmoothTime = -10;
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
  public allowWildStaffKingdoms = false;
  public activeAnomaly: ActiveAnomaly | null = null;
  private anomalyCooldownTimer = 75;
  private caravanMercTimer = 30;
  private staffAlertTier: 0 | 1 | 2 = 0;
  private recentStaffSlainWindow = 0;
  private staffDominanceCheckTimer = 6;
  private staffPackCooldown = 14;
  private staffPack: {
    targetNationId: number;
    targetX: number;
    targetY: number;
    rallyX: number;
    rallyY: number;
    phase: 'GATHERING' | 'CHARGING';
    timer: number;
    membersCount: number;
  } | null = null;
  private staffInvasionAlert: StaffInvasionAlert | null = null;
  private staffInvasionScanTimer = 0;
  private lastInvasionAlertKey = '';
  private viewTilesHalfW = 48;
  private viewTilesHalfH = 32;

  public infiniteWorldMode = false;
  public smartInfrastructureMode = true;
  private needsInteriorWallCleanup = false;
  private lastInteriorCleanupTime = -10;
  public worldSeed = 1337;
  public originTx = 0;
  public originTy = 0;
  private chunkStore = new Map<string, SavedWorldChunk>();
  private discoveredChunks = new Set<string>();
  private hibernatedNationTerr = new Map<number, number>();
  private hibernatedNationPop = new Map<number, number>();

  public get summitLocalX(): number {
    return SUMMIT_X - this.originTx;
  }

  public get summitLocalY(): number {
    return SUMMIT_Y - this.originTy;
  }

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
    this.activeAnomaly = null;
    this.anomalyCooldownTimer = 75;
    this.caravanMercTimer = 30;
    this.staffAlertTier = 0;
    this.recentStaffSlainWindow = 0;
    this.staffDominanceCheckTimer = 6;
    this.staffPackCooldown = 14;
    this.staffPack = null;
    this.staffInvasionAlert = null;
    this.staffInvasionScanTimer = 0;
    this.lastInvasionAlertKey = '';
    this.originTx = 0;
    this.originTy = 0;
    this.worldSeed = (Math.random() * 0x7fffffff) | 0;
    this.chunkStore.clear();
    this.discoveredChunks.clear();
    this.hibernatedNationTerr.clear();
    this.hibernatedNationPop.clear();
    for (let cy = 0; cy < 6; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        this.discoveredChunks.add(chunkKey(cx, cy));
      }
    }
    this.camera.x = WORLD_PX_W * 0.5;
    this.camera.y = WORLD_PX_H * 0.5;
    this.dirtyMap = true;
    this.dirtyLight = true;
    this.forceMapRebuild = true;
    this.forceLightRebuild = true;
    this.warFrontCache.clear();
    this.activeBuilderTargets.clear();
    this.nationAtWarCache.clear();
    this.nationGeneralCache.clear();
    this.nationBuildingAlert.clear();
    this.blueprintLayoutCache.clear();
    this.unitBlueprintNextTime.clear();
    this.hasAnyActiveWar = false;
    this.lastBorderSmoothTime = -10;
    this.needsInteriorWallCleanup = false;
    this.lastInteriorCleanupTime = -10;
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
      this.connectTradeRoad(this.nations[0], this.nations[1], false);
      this.connectTradeRoad(this.nations[0], this.nations[2], false);
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
    this.recomputeLightMap();
    this.rebuildMapCache();
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
      allowWildStaffKingdoms: this.allowWildStaffKingdoms,
      infiniteWorldMode: this.infiniteWorldMode,
      smartInfrastructureMode: this.smartInfrastructureMode,
      originTx: this.originTx,
      originTy: this.originTy,
      worldSeed: this.worldSeed,
      activeAnomaly: this.activeAnomaly ? { ...this.activeAnomaly } : null,
      camera: { ...this.camera },
      nations: this.nations.map((n) => ({
        ...n,
        relations: { ...n.relations },
        leader: { ...n.leader, traits: [...n.leader.traits] },
        vassalIds: [...n.vassalIds],
        researchedTechs: [...(n.researchedTechs || [])],
        unionHubs: n.unionHubs ? n.unionHubs.map((h) => ({ ...h })) : undefined,
        unionCheckpoints: n.unionCheckpoints ? n.unionCheckpoints.map((p) => ({ ...p })) : undefined,
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
    this.allowWildStaffKingdoms = Boolean(data.allowWildStaffKingdoms);
    this.infiniteWorldMode = Boolean(data.infiniteWorldMode);
    this.smartInfrastructureMode = data.smartInfrastructureMode !== false;
    this.originTx = data.originTx ?? 0;
    this.originTy = data.originTy ?? 0;
    this.worldSeed = data.worldSeed ?? 1337;
    this.chunkStore.clear();
    this.discoveredChunks.clear();
    this.hibernatedNationTerr.clear();
    this.hibernatedNationPop.clear();
    const baseBx = Math.floor(this.originTx / CHUNK_W);
    const baseBy = Math.floor(this.originTy / CHUNK_H);
    for (let cy = 0; cy < 6; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        this.discoveredChunks.add(chunkKey(baseBx + cx, baseBy + cy));
      }
    }
    this.activeAnomaly = data.activeAnomaly ? { ...data.activeAnomaly } : null;
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
      unionCheckpoints: n.unionCheckpoints ? n.unionCheckpoints.map((p) => ({ ...p })) : undefined,
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
    this.nationAtWarCache.clear();
    this.nationGeneralCache.clear();
    this.nationBuildingAlert.clear();
    this.blueprintLayoutCache.clear();
    this.unitBlueprintNextTime.clear();
    this.hasAnyActiveWar = false;
    this.lastBorderSmoothTime = -10;
    this.needsInteriorWallCleanup = this.smartInfrastructureMode;
    this.lastInteriorCleanupTime = -10;
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
      if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 8) continue;
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

    if (Math.hypot(cx - this.summitLocalX, cy - this.summitLocalY) <= SUMMIT_RADIUS + 4) {
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
        if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 1) continue;
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
      buildingSpacing: config.buildingSpacing,
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
    if (stance === 'WAR') {
      this.nationAtWarCache.add(aId);
      this.nationAtWarCache.add(bId);
      this.hasAnyActiveWar = true;
    } else {
      const aHasWar = Object.values(a.relations).some((r) => r.stance === 'WAR');
      const bHasWar = Object.values(b.relations).some((r) => r.stance === 'WAR');
      if (aHasWar) this.nationAtWarCache.add(aId);
      else this.nationAtWarCache.delete(aId);
      if (bHasWar) this.nationAtWarCache.add(bId);
      else this.nationAtWarCache.delete(bId);
      this.hasAnyActiveWar = this.nationAtWarCache.size > 0;
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
          this.connectTradeRoad(actor, target);
          this.addNews('TRADE', `${actor.name} & ${target.name} signed a Shopping Cart Trade Pact & linked trade roads!`);
        }
        break;
      case 'FORM_ALLIANCE':
        if (target && target.alive && target.id !== actor.id) {
          this.setRelation(actor.id, target.id, 'ALLIANCE');
          this.connectTradeRoad(actor, target);
          this.addNews('DIPLOMACY', `${actor.name} & ${target.name} forged a Grand Alliance & open cart avenue!`);
        }
        break;
      case 'FORM_UNION':
        if (target && target.alive && target.id !== actor.id) {
          this.setRelation(actor.id, target.id, 'UNION');
          actor.happiness = Math.min(100, actor.happiness + 5);
          target.happiness = Math.min(100, target.happiness + 5);
          this.connectUnionLandsAndCorridor(actor, target, false);
          this.recountTerritoryAndHousing();
          this.addNews('UNION', `UNION PACT: ${actor.name} & ${target.name} linked roads & borders for Mutual Trade & Defense!`);
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
          if (this.getStance(actor.id, target.id) === 'UNION') {
            break;
          }
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
            const allyStance = this.getStance(allies[i].id, target.id);
            if (
              allies[i].id !== actor.id &&
              allyStance !== 'UNION' &&
              allyStance !== 'ALLIANCE' &&
              Math.random() < 0.65
            ) {
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

  private isTradeBlockedNation(viewerAId: number, viewerBId: number, ownerId: number): boolean {
    if (ownerId < 0 || ownerId === viewerAId || ownerId === viewerBId) return false;
    const owner = this.nations[ownerId];
    if (!owner || !owner.alive) return false;
    return (
      this.getStance(ownerId, viewerAId) === 'EMBARGO' ||
      this.getStance(ownerId, viewerBId) === 'EMBARGO' ||
      this.areHostile(ownerId, viewerAId) ||
      this.areHostile(ownerId, viewerBId)
    );
  }

  private buildTradeWaypoints(a: Nation, b: Nation): Array<{ x: number; y: number }> {
    const ax = a.capitalX + 0.5;
    const ay = a.capitalY + 0.5;
    const bx = b.capitalX + 0.5;
    const by = b.capitalY + 0.5;

    const obstacles: Array<{ x: number; y: number; r: number }> = [
      { x: this.summitLocalX + 0.5, y: this.summitLocalY + 0.5, r: SUMMIT_RADIUS + 4.5 },
    ];

    for (const c of this.nations) {
      if (!c.alive || c.id === a.id || c.id === b.id) continue;
      if (this.isTradeBlockedNation(a.id, b.id, c.id)) {
        const estRad = Math.max(10, Math.min(30, Math.sqrt(Math.max(36, c.territoryTiles) / Math.PI) + 3.5));
        obstacles.push({ x: c.capitalX + 0.5, y: c.capitalY + 0.5, r: estRad });
      }
    }

    const waypoints: Array<{ x: number; y: number }> = [
      { x: ax, y: ay },
      { x: bx, y: by },
    ];

    // Insert up to 4 perpendicular detours so routes cleanly bypass Summit Lounge & sanctioning/hostile realms
    for (let iter = 0; iter < 4 && waypoints.length < 6; iter++) {
      let splitHappened = false;
      for (let seg = 0; seg < waypoints.length - 1; seg++) {
        const p0 = waypoints[seg];
        const p1 = waypoints[seg + 1];
        const sdx = p1.x - p0.x;
        const sdy = p1.y - p0.y;
        const len = Math.hypot(sdx, sdy);
        if (len < 4) continue;
        const ux = sdx / len;
        const uy = sdy / len;

        for (const obs of obstacles) {
          const ox = obs.x - p0.x;
          const oy = obs.y - p0.y;
          const proj = ox * ux + oy * uy;
          if (proj <= 1 || proj >= len - 1) continue;
          const cx = p0.x + ux * proj;
          const cy = p0.y + uy * proj;
          const dObs = Math.hypot(cx - obs.x, cy - obs.y);
          if (dObs < obs.r) {
            const px = -uy;
            const py = ux;
            const dotSign = (cx - obs.x) * px + (cy - obs.y) * py >= 0 ? 1 : -1;
            const detourDist = obs.r + 3.5;

            const cand1x = Math.max(5, Math.min(GRID_W - 6, obs.x + px * dotSign * detourDist));
            const cand1y = Math.max(5, Math.min(GRID_H - 6, obs.y + py * dotSign * detourDist));
            const cand2x = Math.max(5, Math.min(GRID_W - 6, obs.x - px * dotSign * detourDist));
            const cand2y = Math.max(5, Math.min(GRID_H - 6, obs.y - py * dotSign * detourDist));

            const d1Blocked = this.isTradeBlockedNation(a.id, b.id, this.territory[(cand1y | 0) * GRID_W + (cand1x | 0)]);
            const d2Blocked = this.isTradeBlockedNation(a.id, b.id, this.territory[(cand2y | 0) * GRID_W + (cand2x | 0)]);
            const useSecond = d1Blocked && !d2Blocked;

            waypoints.splice(seg + 1, 0, {
              x: useSecond ? cand2x : cand1x,
              y: useSecond ? cand2y : cand1y,
            });
            splitHappened = true;
            break;
          }
        }
        if (splitHappened) break;
      }
      if (!splitHappened) break;
    }

    return waypoints;
  }

  private smoothTerritoryBorders(): void {
    const snap = new Int16Array(this.territory);
    for (let y = 1; y < GRID_H - 1; y++) {
      const row = y * GRID_W;
      for (let x = 1; x < GRID_W - 1; x++) {
        const idx = row + x;
        if (Math.hypot(x - this.summitLocalX, y - this.summitLocalY) <= SUMMIT_RADIUS + 1) continue;

        const cur = snap[idx];
        const n0 = snap[idx - GRID_W];
        const n1 = snap[idx + GRID_W];
        const n2 = snap[idx - 1];
        const n3 = snap[idx + 1];

        const curAlive = cur >= 0 && !!this.nations[cur]?.alive;
        if (!curAlive) {
          // Fill small 1-tile holes inside a living nation's territory (>= 3 orthogonal neighbors)
          let candidate = -1;
          if (n0 >= 0 && this.nations[n0]?.alive) {
            const c = (n0 === n1 ? 1 : 0) + (n0 === n2 ? 1 : 0) + (n0 === n3 ? 1 : 0) + 1;
            if (c >= 3) candidate = n0;
          }
          if (candidate === -1 && n1 >= 0 && this.nations[n1]?.alive) {
            const c = (n1 === n2 ? 1 : 0) + (n1 === n3 ? 1 : 0) + 1;
            if (c >= 3) candidate = n1;
          }
          if (candidate >= 0 && this.prop[idx] !== PropType.CHECKOUT_FLAG) {
            this.territory[idx] = candidate;
            if (cur >= 0 && this.propOwner[idx] === cur) {
              this.propOwner[idx] = candidate;
            }
          }
        } else {
          // Never erase tiles with owned buildings, flags, or trade walkways
          if (
            this.biome[idx] === BiomeType.WALKWAY ||
            (this.prop[idx] !== PropType.NONE && this.propOwner[idx] === cur)
          ) {
            continue;
          }
          const sameCount =
            (n0 === cur ? 1 : 0) +
            (n1 === cur ? 1 : 0) +
            (n2 === cur ? 1 : 0) +
            (n3 === cur ? 1 : 0);

          if (sameCount === 0) {
            // Remove isolated 1-tile speckles
            let majority = -1;
            if (n0 >= 0 && this.nations[n0]?.alive) {
              const c = (n0 === n1 ? 1 : 0) + (n0 === n2 ? 1 : 0) + (n0 === n3 ? 1 : 0) + 1;
              if (c >= 3) majority = n0;
            }
            this.territory[idx] = majority;
          } else if (sameCount === 1) {
            // Trim single-tile needles jutting into unclaimed neutral space
            const emptyCount =
              (n0 === -1 ? 1 : 0) +
              (n1 === -1 ? 1 : 0) +
              (n2 === -1 ? 1 : 0) +
              (n3 === -1 ? 1 : 0);
            const curNat = this.nations[cur];
            const nearCap =
              curNat && Math.hypot(x - curNat.capitalX, y - curNat.capitalY) <= 5.2;
            if (emptyCount === 3 && !nearCap) {
              this.territory[idx] = -1;
            }
          }
        }
      }
    }
  }

  public connectTradeRoad(a: Nation, b: Nation, launchCart = true): void {
    const waypoints = this.buildTradeWaypoints(a, b);
    if (waypoints.length < 2) return;

    const paintRoadTile = (tx: number, ty: number) => {
      if (tx < 2 || tx >= GRID_W - 2 || ty < 2 || ty >= GRID_H - 2) return;
      if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 1.5) return;
      const idx = ty * GRID_W + tx;
      const curOwner = this.territory[idx];
      if (this.isTradeBlockedNation(a.id, b.id, curOwner)) return;

      const curProp = this.prop[idx];
      if (curProp === PropType.CHECKOUT_FLAG) return;

      // Never bulldoze major non-wall buildings on a third nation's land
      if (
        curProp !== PropType.NONE &&
        curProp !== PropType.BARRICADE_WALL &&
        curProp !== PropType.BARRICADE_GATE &&
        !this.isDismantlableIkeaProp(curProp)
      ) {
        return;
      }

      if (this.biome[idx] !== BiomeType.FOOD_COURT) {
        this.biome[idx] = BiomeType.WALKWAY;
      }

      if (curProp === PropType.BARRICADE_WALL) {
        const pOwner = this.propOwner[idx];
        if (!this.isTradeBlockedNation(a.id, b.id, pOwner)) {
          this.placeNationProp(tx, ty, PropType.BARRICADE_GATE, 150, pOwner >= 0 ? pOwner : a.id, 0);
        }
      } else if (curProp !== PropType.NONE && this.isDismantlableIkeaProp(curProp)) {
        this.prop[idx] = PropType.NONE;
        this.propHp[idx] = 0;
        this.propOwner[idx] = -1;
      }
    };

    for (let seg = 0; seg < waypoints.length - 1; seg++) {
      const p0 = waypoints[seg];
      const p1 = waypoints[seg + 1];
      let cx = Math.round(p0.x);
      let cy = Math.round(p0.y);
      const ex = Math.round(p1.x);
      const ey = Math.round(p1.y);
      const sdx = Math.abs(ex - cx);
      const sdy = Math.abs(ey - cy);
      const sx = cx < ex ? 1 : -1;
      const sy = cy < ey ? 1 : -1;
      let err = sdx - sdy;
      const horizontalPrimary = sdx >= sdy;

      let safety = 0;
      while (safety++ < 600) {
        paintRoadTile(cx, cy);
        if (horizontalPrimary) paintRoadTile(cx, cy + 1);
        else paintRoadTile(cx + 1, cy);

        if (cx === ex && cy === ey) break;
        const e2 = 2 * err;
        // Step orthogonally so there are never diagonal gaps or sawtooth walls
        if (e2 > -sdy) {
          err -= sdy;
          cx += sx;
          paintRoadTile(cx, cy);
        }
        if (e2 < sdx) {
          err += sdx;
          cy += sy;
        }
      }
    }

    this.dirtyMap = true;
    this.dirtyLight = true;

    if (launchCart && !this.isNight && this.units.length < this.maxPopulation + 120) {
      this.spawnTradeCart(a, b);
    }
  }

  private isSameOrUnionTerritory(ownerId: number, tileOwnerId: number): boolean {
    if (tileOwnerId < 0) return false;
    if (tileOwnerId === ownerId) return true;
    return this.getStance(ownerId, tileOwnerId) === 'UNION';
  }

  private getCapitalPerimeterInfo(n: Nation): {
    pattern: BuildingPattern;
    radius: number;
    circular: boolean;
  } {
    const pattern = this.getKingdomBuildingPattern(n);
    const spacing = this.getKingdomBuildingSpacing(n);
    const baseR = pattern === 'Showroom Plaza' ? 9 : 10;
    const radius = Math.max(7, Math.min(13, baseR + (spacing === 'Crowded' ? -2 : spacing === 'Spaced' ? 3 : 0)));
    const circular = pattern === 'Cathedral Spire' || pattern === 'Imperial Concourse';
    return { pattern, radius, circular };
  }

  private isOnPrimaryCapitalPerimeter(n: Nation, tx: number, ty: number): boolean {
    if (!n.alive) return false;
    const { radius: R, circular } = this.getCapitalPerimeterInfo(n);
    const dx = tx - n.capitalX;
    const dy = ty - n.capitalY;
    if (circular) {
      const r = Math.hypot(dx, dy);
      return r >= R - 0.65 && r <= R + 0.65;
    }
    return Math.max(Math.abs(dx), Math.abs(dy)) === R;
  }

  private clearInteriorUnionWalls(targetNationIds?: Set<number>): void {
    let removed = false;
    for (let y = 2; y < GRID_H - 2; y++) {
      const row = y * GRID_W;
      for (let x = 2; x < GRID_W - 2; x++) {
        const idx = row + x;
        const p = this.prop[idx];
        if (p !== PropType.BARRICADE_WALL && p !== PropType.BARRICADE_GATE) continue;
        const pOwner = this.propOwner[idx];
        const tOwner = this.territory[idx];
        const ownerId = pOwner >= 0 ? pOwner : tOwner;
        if (ownerId < 0) continue;
        if (targetNationIds && !targetNationIds.has(ownerId)) continue;

        let allInterior = true;
        for (let dy = -2; dy <= 2 && allInterior; dy++) {
          const nRow = (y + dy) * GRID_W;
          for (let dx = -2; dx <= 2; dx++) {
            const nt = this.territory[nRow + x + dx];
            if (!this.isSameOrUnionTerritory(ownerId, nt)) {
              allInterior = false;
              break;
            }
          }
        }

        // Also clear any dividing walls directly along a Union partner border
        let touchesUnionPartner = false;
        const nTop = this.territory[idx - GRID_W];
        const nBot = this.territory[idx + GRID_W];
        const nLft = this.territory[idx - 1];
        const nRgt = this.territory[idx + 1];
        if (
          (nTop >= 0 && nTop !== ownerId && this.getStance(ownerId, nTop) === 'UNION') ||
          (nBot >= 0 && nBot !== ownerId && this.getStance(ownerId, nBot) === 'UNION') ||
          (nLft >= 0 && nLft !== ownerId && this.getStance(ownerId, nLft) === 'UNION') ||
          (nRgt >= 0 && nRgt !== ownerId && this.getStance(ownerId, nRgt) === 'UNION')
        ) {
          touchesUnionPartner = true;
        }

        // Preserve every living nation's primary Capital Citadel 4-entrance barricade ring
        const ownerNation = this.getNation(ownerId);
        if (
          !touchesUnionPartner &&
          ownerNation &&
          ownerNation.alive &&
          this.isOnPrimaryCapitalPerimeter(ownerNation, x, y)
        ) {
          continue;
        }

        if (allInterior || touchesUnionPartner) {
          this.prop[idx] = PropType.NONE;
          this.propHp[idx] = 0;
          this.propMaxHp[idx] = 0;
          this.propOwner[idx] = -1;
          this.propVariant[idx] = 0;
          removed = true;
        }
      }
    }
    if (removed) {
      this.dirtyMap = true;
      this.dirtyLight = true;
    }
  }

  private connectUnionLandsAndCorridor(a: Nation, b: Nation, isMergedUnion: boolean): void {
    const waypoints = this.buildTradeWaypoints(a, b);
    if (waypoints.length < 2) return;

    const totalSegments = waypoints.length - 1;
    let roadSteps = 0;

    // 1. Carve a wide smooth territory bridge between both realms so united lands merge naturally without skinny boxed necks
    for (let seg = 0; seg < totalSegments; seg++) {
      const p0 = waypoints[seg];
      const p1 = waypoints[seg + 1];
      const sdx = p1.x - p0.x;
      const sdy = p1.y - p0.y;
      const segLen = Math.hypot(sdx, sdy);
      if (segLen < 0.5) continue;

      const steps = Math.max(2, Math.ceil(segLen * 1.5));
      for (let s = 0; s <= steps; s++) {
        const tLocal = s / steps;
        const tGlobal = (seg + tLocal) / totalSegments;
        const cx = Math.round(p0.x + sdx * tLocal);
        const cy = Math.round(p0.y + sdy * tLocal);
        const segmentOwnerId = isMergedUnion || tGlobal < 0.5 ? a.id : b.id;

        // Smooth circular brush of radius 5 tiles for wide organic union borders
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            if (dx * dx + dy * dy > 26) continue;
            const tx = cx + dx;
            const ty = cy + dy;
            if (tx < 2 || tx >= GRID_W - 2 || ty < 2 || ty >= GRID_H - 2) continue;
            if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 1.5) continue;

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
          }
        }

        // Light up the union bridge cleanly every ~14 steps along the edge without overlapping structures
        roadSteps++;
        if (roadSteps % 14 === 7) {
          const lx = Math.max(2, Math.min(GRID_W - 3, cx + 2));
          const ly = Math.max(2, Math.min(GRID_H - 3, cy + 2));
          const lIdx = ly * GRID_W + lx;
          if (
            Math.hypot(lx - this.summitLocalX, ly - this.summitLocalY) > SUMMIT_RADIUS + 2 &&
            this.territory[lIdx] === segmentOwnerId &&
            (this.prop[lIdx] === PropType.NONE || this.isDismantlableIkeaProp(this.prop[lIdx])) &&
            !this.hasOwnedBuildingNear(segmentOwnerId, lx, ly, 4, false)
          ) {
            this.placeNationProp(lx, ly, PropType.SPOTLIGHT, 150, segmentOwnerId, 0);
          }
        }
      }
    }

    // 2. Smooth territory edges so corridor borders look clean & natural (no stair-step spikes)
    this.smoothTerritoryBorders();

    // 3. Paint crisp 2-tile-wide trade avenue down the center & gate/open any intersecting walls
    this.connectTradeRoad(a, b, false);

    // 4. Dissolve any interior wall boxes & dividing barricades between united lands
    this.clearInteriorUnionWalls(new Set([a.id, b.id]));

    // 5. Fortify the Union Corridor flanks with protective Barricades, Watchtowers, Spotlights & Escort Guards
    const corridorCheckpoints: Array<{ x: number; y: number; owner: Nation }> = [];
    const capProtected = (tx: number, ty: number): boolean => {
      if (Math.hypot(tx - a.capitalX, ty - a.capitalY) <= 11.5) return true;
      if (Math.hypot(tx - b.capitalX, ty - b.capitalY) <= 11.5) return true;
      if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 2.5) return true;
      for (const h of a.unionHubs || []) {
        if (Math.hypot(tx - h.x, ty - h.y) <= 9.5) return true;
      }
      for (const h of b.unionHubs || []) {
        if (Math.hypot(tx - h.x, ty - h.y) <= 9.5) return true;
      }
      return false;
    };

    let fortStep = 0;
    for (let seg = 0; seg < totalSegments; seg++) {
      const p0 = waypoints[seg];
      const p1 = waypoints[seg + 1];
      const sdx = p1.x - p0.x;
      const sdy = p1.y - p0.y;
      const segLen = Math.hypot(sdx, sdy);
      if (segLen < 1) continue;
      const perpX = -sdy / segLen;
      const perpY = sdx / segLen;

      const steps = Math.max(2, Math.ceil(segLen * 1.4));
      for (let s = 0; s <= steps; s++) {
        const tLocal = s / steps;
        const tGlobal = (seg + tLocal) / totalSegments;
        const cx = Math.round(p0.x + sdx * tLocal);
        const cy = Math.round(p0.y + sdy * tLocal);
        const ownerNation = isMergedUnion || tGlobal < 0.5 ? a : b;

        // Place outer edge barricades along both flanks of the radius-5 corridor
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const distCenter = Math.hypot(dx, dy);
            if (distCenter < 3.6 || distCenter > 5.3) continue;
            const tx = cx + dx;
            const ty = cy + dy;
            if (tx < 2 || tx >= GRID_W - 2 || ty < 2 || ty >= GRID_H - 2) continue;
            if (capProtected(tx, ty)) continue;

            const idx = ty * GRID_W + tx;
            const curOwner = this.territory[idx];
            if (curOwner !== a.id && curOwner !== b.id) continue;
            if (this.biome[idx] === BiomeType.WALKWAY) continue;

            const curProp = this.prop[idx];
            if (curProp !== PropType.NONE && !this.isDismantlableIkeaProp(curProp)) continue;

            // Only fortify the outer perimeter of the corridor (adjacent to non-union land)
            const nTop = this.territory[idx - GRID_W];
            const nBot = this.territory[idx + GRID_W];
            const nLft = this.territory[idx - 1];
            const nRgt = this.territory[idx + 1];
            if (
              this.isSameOrUnionTerritory(curOwner, nTop) &&
              this.isSameOrUnionTerritory(curOwner, nBot) &&
              this.isSameOrUnionTerritory(curOwner, nLft) &&
              this.isSameOrUnionTerritory(curOwner, nRgt)
            ) {
              continue;
            }

            let adjWalls = 0;
            for (const nIdx of [idx - GRID_W, idx + GRID_W, idx - 1, idx + 1]) {
              if (
                this.prop[nIdx] === PropType.BARRICADE_WALL ||
                this.prop[nIdx] === PropType.WATCHTOWER
              ) {
                adjWalls++;
              }
            }
            if (adjWalls >= 3) continue;

            this.placeNationProp(
              tx,
              ty,
              PropType.BARRICADE_WALL,
              160,
              curOwner,
              1 + ((tx + ty) % 4)
            );
          }
        }

        // Station Watchtowers & Spotlights every ~10 steps along alternating flanks for night illumination & fire support
        fortStep++;
        if (fortStep % 10 === 5 && !capProtected(cx, cy)) {
          const side = ((fortStep / 10) | 0) % 2 === 0 ? 1 : -1;
          const fx = Math.max(3, Math.min(GRID_W - 4, Math.round(cx + perpX * side * 3.1)));
          const fy = Math.max(3, Math.min(GRID_H - 4, Math.round(cy + perpY * side * 3.1)));
          const fIdx = fy * GRID_W + fx;
          const fOwner = this.territory[fIdx];
          if (
            (fOwner === a.id || fOwner === b.id) &&
            this.biome[fIdx] !== BiomeType.WALKWAY &&
            !capProtected(fx, fy) &&
            (this.prop[fIdx] === PropType.NONE || this.isDismantlableIkeaProp(this.prop[fIdx])) &&
            !this.hasOwnedBuildingNear(fOwner, fx, fy, 4, true)
          ) {
            const isTower = ((fortStep / 10) | 0) % 2 === 0;
            this.placeNationProp(
              fx,
              fy,
              isTower ? PropType.WATCHTOWER : PropType.SPOTLIGHT,
              isTower ? 220 : 160,
              fOwner,
              0
            );
          }
        }

        // Record up to 3 evenly spaced corridor guard checkpoints
        if (
          corridorCheckpoints.length < 3 &&
          ((corridorCheckpoints.length === 0 && tGlobal >= 0.25) ||
            (corridorCheckpoints.length === 1 && tGlobal >= 0.5) ||
            (corridorCheckpoints.length === 2 && tGlobal >= 0.75)) &&
          !capProtected(cx, cy)
        ) {
          corridorCheckpoints.push({ x: cx + 0.5, y: cy + 0.5, owner: ownerNation });
        }
      }
    }

    if (corridorCheckpoints.length === 0) {
      const mx = Math.round((a.capitalX + b.capitalX) * 0.5);
      const my = Math.round((a.capitalY + b.capitalY) * 0.5);
      if (mx >= 3 && mx < GRID_W - 3 && my >= 3 && my < GRID_H - 3 && !capProtected(mx, my)) {
        corridorCheckpoints.push({ x: mx + 0.5, y: my + 0.5, owner: a });
      }
    }

    const pushCheckpoint = (nation: Nation, pt: { x: number; y: number }) => {
      if (!nation.unionCheckpoints) nation.unionCheckpoints = [];
      if (!nation.unionCheckpoints.some((c) => Math.hypot(c.x - pt.x, c.y - pt.y) < 7)) {
        nation.unionCheckpoints.push({ x: pt.x, y: pt.y });
        if (nation.unionCheckpoints.length > 14) {
          nation.unionCheckpoints = nation.unionCheckpoints.slice(-14);
        }
      }
    };

    let spawnedGuards = 0;
    for (const cp of corridorCheckpoints) {
      pushCheckpoint(a, cp);
      if (!isMergedUnion) pushCheckpoint(b, cp);

      let hasNearbyGuard = false;
      this.spatialHash.queryRadius(this.units, cp.x, cp.y, 7, (other) => {
        if (
          other.alive &&
          (other.nationId === a.id || other.nationId === b.id) &&
          other.role === SurvivorRole.GUARD
        ) {
          hasNearbyGuard = true;
        }
      });

      if (!hasNearbyGuard && this.units.length < this.maxPopulation + 120) {
        const g = this.spawnSurvivor(cp.owner.id, SurvivorRole.GUARD, cp.x, cp.y);
        g.guardPostX = cp.x;
        g.guardPostY = cp.y;
        g.veteranTitle = 'Union Escort';
        g.maxHp += 20;
        g.hp = g.maxHp;
        g.chatEmoji = '🛡️';
        g.chatTimer = 2.0;
        cp.owner.population++;
        spawnedGuards++;
      }
    }
    if (spawnedGuards > 0) {
      this.recountTerritoryAndHousing();
    }

    this.blueprintLayoutCache.delete(a.id);
    this.blueprintLayoutCache.delete(b.id);

    this.dirtyMap = true;
    this.dirtyLight = true;

    // 6. Immediately launch armored Union trade carts along the fortified corridor (day or night)
    if (this.units.length < this.maxPopulation + 120) {
      if (isMergedUnion) {
        this.spawnTradeCart(a, a, { x: b.capitalX + 0.5, y: b.capitalY + 0.5, label: b.name });
      } else {
        this.spawnTradeCart(a, b);
        this.spawnTradeCart(b, a);
      }
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
    if (
      secondary.capitalX >= 0 &&
      secondary.capitalX < GRID_W &&
      secondary.capitalY >= 0 &&
      secondary.capitalY < GRID_H
    ) {
      const secCapIdx = secondary.capitalY * GRID_W + secondary.capitalX;
      if (this.prop[secCapIdx] === PropType.CHECKOUT_FLAG) {
        this.prop[secCapIdx] = PropType.SPOTLIGHT;
        this.propHp[secCapIdx] = 180;
        this.propMaxHp[secCapIdx] = 180;
        this.propOwner[secCapIdx] = primary.id;
      }
    }
    if (this.chunkStore.size > 0) {
      this.transferNationInChunkStore(secondary.id, primary.id);
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
    primary.firearms = (primary.firearms || 0) + (secondary.firearms || 0);
    primary.civilianGoods = (primary.civilianGoods || 0) + (secondary.civilianGoods || 0);
    primary.techTier = Math.max(primary.techTier, secondary.techTier) as 1 | 2 | 3 | 4;
    primary.happiness = Math.min(100, Math.max(primary.happiness, 74) + 8);
    primary.warExhaustion = Math.max(0, primary.warExhaustion - 20);

    const existingTechs = new Set(primary.researchedTechs || []);
    for (const techId of secondary.researchedTechs || []) {
      if (!existingTechs.has(techId)) {
        existingTechs.add(techId);
        if (!primary.researchedTechs) primary.researchedTechs = [];
        primary.researchedTechs.push(techId);
        if (
          techId === 'allen_spears' ||
          techId === 'pneumatic_nailguns' ||
          techId === 'halogen_rifles' ||
          techId === 'flatpack_automation'
        ) {
          for (const u of this.units) {
            if (u.alive && u.nationId === primary.id && this.isNationCitizen(u)) {
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
    const checkpoints = [...(primary.unionCheckpoints || [])];
    for (const cp of secondary.unionCheckpoints || []) {
      if (!checkpoints.some((c) => Math.hypot(c.x - cp.x, c.y - cp.y) < 7)) {
        checkpoints.push({ ...cp });
      }
    }
    primary.unionCheckpoints = checkpoints.slice(-14);
    if (!primary.secondaryColor) primary.secondaryColor = secondary.color;
    if (!primary.bannerStyle) primary.bannerStyle = 'split';
    if (!primary.bannerEmblem) primary.bannerEmblem = 'crown';
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
      const floodBonus =
        (hasTech(nation, 'halogen_floodlights') ? 3 : 0) +
        (hasTech(nation, 'sunlight_beacons') ? 4 : 0);
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
    for (let ti = 0; ti < this.techLabIndices.length; ti++) {
      const idx = this.techLabIndices[ti];
      if (this.prop[idx] !== PropType.TECH_LAB || this.disabledLightMap[idx] > 0) continue;
      const owner = this.propOwner[idx];
      const nation = owner >= 0 ? this.getNation(owner) : undefined;
      if (!nation || !hasTech(nation, 'fluorescent_capacitor')) continue;
      const x = idx % GRID_W;
      const y = (idx / GRID_W) | 0;
      const rad = WATCHTOWER_RADIUS;
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
    const data32 = IS_LITTLE_ENDIAN ? new Uint32Array(data.buffer) : null;
    const mm32 = IS_LITTLE_ENDIAN ? new Uint32Array(mmData.buffer) : null;

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
      const pyStart = ty * TILE_SIZE;
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
          const delta = tx % 4 === 0 || ty % 4 === 0 ? -10 : 4;
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
        let topDiff = false;
        let botDiff = false;
        let lftDiff = false;
        let rgtDiff = false;

        if (owner >= 0 && owner < nationRgb.length) {
          const ownerNation = this.nations[owner];
          const nc = nationRgb[owner];
          if (ownerNation && !ownerNation.alive) {
            const gray = ((nc[0] + nc[1] + nc[2]) / 3) | 0;
            const mutedR = (nc[0] * 0.4 + gray * 0.6) | 0;
            const mutedG = (nc[1] * 0.4 + gray * 0.6) | 0;
            const mutedB = (nc[2] * 0.4 + gray * 0.6) | 0;
            r = (r * 0.82 + mutedR * 0.18) | 0;
            g = (g * 0.82 + mutedG * 0.18) | 0;
            bl = (bl * 0.82 + mutedB * 0.18) | 0;
          } else {
            r = (r * 0.65 + nc[0] * 0.35) | 0;
            g = (g * 0.65 + nc[1] * 0.35) | 0;
            bl = (bl * 0.65 + nc[2] * 0.35) | 0;
          }

          topDiff = ty === 0 || this.territory[idx - GRID_W] !== owner;
          botDiff = ty === GRID_H - 1 || this.territory[idx + GRID_W] !== owner;
          lftDiff = tx === 0 || this.territory[idx - 1] !== owner;
          rgtDiff = tx === GRID_W - 1 || this.territory[idx + 1] !== owner;
          if (topDiff || botDiff || lftDiff || rgtDiff) {
            isBorder = true;
            bColor = ownerNation && !ownerNation.alive ? [100, 116, 139] : borderRgb[owner];
          }
        }

        const pxStart = tx * TILE_SIZE;
        if (data32 && mm32) {
          const basePacked = (0xff << 24) | (bl << 16) | (g << 8) | r;
          if (!isBorder || !bColor) {
            mm32[idx] = basePacked;
            for (let py = 0; py < TILE_SIZE; py++) {
              const pBase = (pyStart + py) * WORLD_PX_W + pxStart;
              data32[pBase] = basePacked;
              data32[pBase + 1] = basePacked;
              data32[pBase + 2] = basePacked;
              data32[pBase + 3] = basePacked;
              data32[pBase + 4] = basePacked;
              data32[pBase + 5] = basePacked;
              data32[pBase + 6] = basePacked;
              data32[pBase + 7] = basePacked;
            }
          } else {
            const mmPacked = (0xff << 24) | (bColor[2] << 16) | (bColor[1] << 8) | bColor[0];
            mm32[idx] = mmPacked;
            const br = (bColor[0] * 0.72) | 0;
            const bg = (bColor[1] * 0.72) | 0;
            const bb = (bColor[2] * 0.72) | 0;
            const borderPacked = (0xff << 24) | (bb << 16) | (bg << 8) | br;
            for (let py = 0; py < TILE_SIZE; py++) {
              const pBase = (pyStart + py) * WORLD_PX_W + pxStart;
              const yEdge = (topDiff && py < 2) || (botDiff && py >= TILE_SIZE - 2);
              if (yEdge) {
                data32[pBase] = borderPacked;
                data32[pBase + 1] = borderPacked;
                data32[pBase + 2] = borderPacked;
                data32[pBase + 3] = borderPacked;
                data32[pBase + 4] = borderPacked;
                data32[pBase + 5] = borderPacked;
                data32[pBase + 6] = borderPacked;
                data32[pBase + 7] = borderPacked;
              } else {
                const lCol = lftDiff ? borderPacked : basePacked;
                const rCol = rgtDiff ? borderPacked : basePacked;
                data32[pBase] = lCol;
                data32[pBase + 1] = lCol;
                data32[pBase + 2] = basePacked;
                data32[pBase + 3] = basePacked;
                data32[pBase + 4] = basePacked;
                data32[pBase + 5] = basePacked;
                data32[pBase + 6] = rCol;
                data32[pBase + 7] = rCol;
              }
            }
          }
        } else {
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
    this.simTickCount++;

    // 1. Day/Night Cycle (35s Day / 25s Night)
    const prevNight = this.isNight;
    this.cycleTimer += dt;
    if (this.cycleTimer >= CYCLE_DURATION) {
      this.cycleTimer -= CYCLE_DURATION;
      this.day++;
      this.onNewDay();
    }
    this.isNight = this.cycleTimer >= DAY_DURATION;
    if (prevNight !== this.isNight) {
      soundFX.setPhase(this.isNight, this.paused);
    }
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
      if (this.day >= 25 && this.day % 25 === 0) {
        this.triggerDirectorBossEvent();
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

    // 3. Periodic timers, Store Anomalies & Ambient Caravans/Mercenaries
    if (this.activeAnomaly) {
      this.activeAnomaly.remainingSec -= dt;
      if (this.activeAnomaly.remainingSec <= 0) {
        this.addNews('DIPLOMACY', `Store Anomaly ended: ${this.activeAnomaly.label} subsided.`);
        this.activeAnomaly = null;
      }
    } else if (this.day >= 2) {
      this.anomalyCooldownTimer -= dt;
      if (this.anomalyCooldownTimer <= 0) {
        this.anomalyCooldownTimer = 95 + Math.random() * 45;
        this.triggerStoreAnomaly();
      }
    }

    this.caravanMercTimer -= dt;
    if (this.caravanMercTimer <= 0) {
      this.caravanMercTimer = 34 + Math.random() * 14;
      this.tickAmbientCaravansAndMercs();
    }

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

    const recountInterval = this.units.length > 900 ? 1.8 : 1.2;
    this.territoryRebuildTimer += dt;
    if (this.territoryRebuildTimer >= recountInterval) {
      this.territoryRebuildTimer = 0;
      this.recountTerritoryAndHousing();
      if (this.dirtyLight) this.recomputeLightMap();
    }

    // 4. Fair Night Staff Spawning (NEVER inside lit spotlight radiuses) & Adaptive Pack Coordination
    this.evaluateStaffDominanceAndPacks(dt);
    this.evaluateStaffInvasionAlerts(dt);
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
    if (this.deadUnitsCount >= 40 || (this.units.length > 500 && this.deadUnitsCount >= 20)) {
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
        if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 8) continue;
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
        if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 8) continue;
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
      if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 3) continue;
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
    this.staffInvasionScanTimer = 0;
  }

  private triggerDirectorBossEvent(): void {
    if (this.units.some((u) => u.alive && u.kind === UnitKind.STAFF_DIRECTOR)) return;
    for (let attempt = 0; attempt < 80; attempt++) {
      const tx = 6 + ((Math.random() * (GRID_W - 12)) | 0);
      const ty = 6 + ((Math.random() * (GRID_H - 12)) | 0);
      const idx = ty * GRID_W + tx;
      if (this.lightMap[idx] === 0 && this.prop[idx] === PropType.NONE) {
        this.spawnStaff(UnitKind.STAFF_DIRECTOR, tx + 0.5, ty + 0.5);
        this.spawnParticleBurst(tx + 0.5, ty + 0.5, '#f43f5e', 18);
        this.spawnFloatingText(tx + 0.5, ty - 1.4, 'BOSS: STORE DIRECTOR!', '#f43f5e');
        this.addNews(
          'STAFF',
          `MEGA-SHOWROOM BOSS (Day ${this.day}): Rogue SCP-3008-2 Store Director has entered the floor!`
        );
        this.addChronicle(
          'AUDIT',
          `Store Director Emerges (Day ${this.day})`,
          'A towering Rogue Store Director marched out of the Dark Sectors to audit the showroom.',
          '#f43f5e'
        );
        soundFX.playInvasionAlert(true);
        this.staffInvasionScanTimer = 0;
        return;
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

      const hasRail = hasTech(nation, 'heavy_rivet_cannons');
      const hasArc = hasTech(nation, 'quantum_barcodes');
      const hasRadarAlert =
        hasTech(nation, 'staff_invasion_radar') && this.staffInvasionAlert !== null;
      const range = (hasRail ? 11.5 : 9.5) + (hasArc ? 1.0 : 0) + (hasRadarAlert ? 1.5 : 0);

      let target: Unit | null = null;
      let bestDSq = range * range;
      this.spatialHash.queryRadius(this.units, x + 0.5, y + 0.5, range, (u, _ui, dSq) => {
        const isHostile =
          (this.isNight && isStaffKind(u.kind)) ||
          (u.nationId >= 0 && this.areHostile(nation.id, u.nationId));
        if (isHostile && dSq < bestDSq) {
          bestDSq = dSq;
          target = u;
        }
      });

      if (target && this.projectiles.length < 150) {
        const t = target as Unit;
        const dx = t.x - (x + 0.5);
        const dy = t.y - (y + 0.5);
        const dist = Math.hypot(dx, dy) || 1;
        const speed = hasRail ? 25 : hasArc ? 23 : 19;
        const baseDmg = hasTech(nation, 'watchtower_turrets') ? 22 : 14;
        const turretDmg = Math.round(
          baseDmg * (hasRail ? 1.45 : 1) * (hasArc ? 1.25 : 1) * (hasRadarAlert ? 1.15 : 1)
        );
        this.projectiles.push({
          x: x + 0.5,
          y: y + 0.5,
          vx: (dx / dist) * speed,
          vy: (dy / dist) * speed,
          damage: turretDmg,
          nationId: nation.id,
          color: hasArc && hasRail ? '#f472b6' : hasArc ? '#e879f9' : hasRail ? '#f97316' : undefined,
          arcChain: hasArc,
          life: 0.7,
        });
        if (this.isNearCamera(x + 0.5, y + 0.5)) {
          soundFX.playShot(hasArc ? 'arc_caster' : hasRail ? 'rail_cannon' : 'turret');
        }
      }
    }

    // Anomalous Arc Capacitor & Repulsor Pylon defense from SCP-IKEA Tech Labs
    for (let ti = 0; ti < this.techLabIndices.length; ti++) {
      const idx = this.techLabIndices[ti];
      if (this.prop[idx] !== PropType.TECH_LAB) continue;
      const ownerId = this.propOwner[idx];
      const nation = ownerId >= 0 ? this.getNation(ownerId) : undefined;
      if (!nation || !nation.alive) continue;
      const hasCap = hasTech(nation, 'fluorescent_capacitor');
      const hasRepulsor = hasTech(nation, 'repulsor_pylons');
      if (!hasCap && !hasRepulsor) continue;
      const x = idx % GRID_W;
      const y = (idx / GRID_W) | 0;
      if (hasRepulsor) {
        for (let li = 0; li < this.lightSourceIndices.length; li++) {
          const lIdx = this.lightSourceIndices[li];
          if (this.disabledLightMap[lIdx] > 0) {
            const lx = lIdx % GRID_W;
            const ly = (lIdx / GRID_W) | 0;
            if ((lx - x) * (lx - x) + (ly - y) * (ly - y) <= 11 * 11) {
              this.disabledLightMap[lIdx] = 0;
              this.dirtyLight = true;
            }
          }
        }
      }
      let zapped: Unit | null = null;
      let bestDSq = 8.5 * 8.5;
      this.spatialHash.queryRadius(this.units, x + 0.5, y + 0.5, 9.5, (u, _ui, dSq) => {
        if (hasCap && u.kind === UnitKind.SURVIVOR && u.nationId === nation.id && u.hp < u.maxHp) {
          u.hp = Math.min(u.maxHp, u.hp + 3.5);
          return;
        }
        if (hasRepulsor && isStaffKind(u.kind) && u.nationId < 0) {
          u.feverTimer = 0;
        }
        if (hasCap && dSq <= 8.5 * 8.5) {
          const isHostile =
            (this.isNight && isStaffKind(u.kind)) ||
            (u.nationId >= 0 && this.areHostile(nation.id, u.nationId));
          if (isHostile && dSq < bestDSq) {
            bestDSq = dSq;
            zapped = u;
          }
        }
      });
      if (zapped) {
        const target = zapped as Unit;
        this.damageUnit(target, hasRepulsor ? 26 : 20, undefined, nation.id);
        this.spawnParticleBurst(target.x, target.y, '#22d3ee', 4);
        if (this.isNearCamera(x + 0.5, y + 0.5)) {
          soundFX.playShot('halogen_rifle');
        }
      }
    }
  }

  private isNearCamera(wx: number, wy: number): boolean {
    const camTx = this.camera.x / TILE_SIZE;
    const camTy = this.camera.y / TILE_SIZE;
    return (
      Math.abs(wx - camTx) <= this.viewTilesHalfW &&
      Math.abs(wy - camTy) <= this.viewTilesHalfH
    );
  }

  private evaluateStaffDominanceAndPacks(dt: number): void {
    this.recentStaffSlainWindow = Math.max(0, this.recentStaffSlainWindow - dt * 0.28);

    this.staffDominanceCheckTimer -= dt;
    if (this.staffDominanceCheckTimer <= 0) {
      this.staffDominanceCheckTimer = 4.5;
      let humanPop = 0;
      let humanArmy = 0;
      let totalFirearms = 0;
      let tier3Plus = 0;
      for (const n of this.nations) {
        if (!n.alive || n.species === 'staff') continue;
        humanPop += n.population;
        humanArmy += n.armyCount ?? 0;
        totalFirearms += n.firearms ?? 0;
        if (n.techTier >= 3) tier3Plus++;
      }

      let nextTier: 0 | 1 | 2 = this.staffAlertTier;
      if (
        this.recentStaffSlainWindow >= 20 ||
        (humanArmy >= 32 && (totalFirearms >= 18 || tier3Plus >= 2)) ||
        humanPop >= 145
      ) {
        nextTier = 2;
      } else if (
        this.recentStaffSlainWindow >= 9 ||
        (humanArmy >= 16 && (totalFirearms >= 6 || tier3Plus >= 1)) ||
        humanPop >= 80
      ) {
        nextTier = Math.max(nextTier, 1) as 0 | 1 | 2;
      } else if (humanPop < 42 && this.recentStaffSlainWindow < 4) {
        nextTier = 0;
      }

      if (nextTier > this.staffAlertTier) {
        this.staffAlertTier = nextTier;
        if (nextTier === 1) {
          this.addNews(
            'STAFF',
            'SCP-3008-2 Staff realize survivors are dominating—employees are grouping into coordinated attack packs!'
          );
          this.addChronicle(
            'GROWTH',
            'Staff Hive Adaptation',
            'Overpowered by well-armed kingdoms, Store Staff began staging coordinated night packs.',
            '#f59e0b'
          );
        } else {
          this.addNews(
            'STAFF',
            'STORE DOMINANCE ALERT: Lone Staff keep getting wiped—armored siege platoons are organizing!'
          );
          this.addChronicle(
            'WAR',
            'Staff Siege Coordination',
            'Dominant human firepower forced SCP-3008-2 entities into heavy combined-arms siege packs.',
            '#ef4444'
          );
        }
        soundFX.playStaffCoordinated();
      } else {
        this.staffAlertTier = nextTier;
      }
    }

    if (!this.isNight) {
      this.staffPack = null;
      return;
    }

    if (this.staffPack) {
      const target = this.getNation(this.staffPack.targetNationId);
      if (!target || !target.alive) {
        this.staffPack = null;
        this.staffPackCooldown = 8;
        return;
      }
      this.staffPack.targetX = target.capitalX;
      this.staffPack.targetY = target.capitalY;
      this.staffPack.timer -= dt;

      if (this.staffPack.phase === 'GATHERING') {
        let gathered = 0;
        this.spatialHash.queryRadius(
          this.units,
          this.staffPack.rallyX,
          this.staffPack.rallyY,
          8.5,
          (u) => {
            if (isStaffKind(u.kind) && u.nationId < 0 && !u.pacified) gathered++;
          }
        );
        this.staffPack.membersCount = gathered;
        if (this.staffPack.timer <= 0 || gathered >= (this.staffAlertTier === 2 ? 8 : 6)) {
          this.staffPack.phase = 'CHARGING';
          this.staffPack.timer = 17;
          this.spatialHash.queryRadius(
            this.units,
            this.staffPack.rallyX,
            this.staffPack.rallyY,
            10,
            (u) => {
              if (isStaffKind(u.kind) && u.nationId < 0 && !u.pacified) {
                u.feverTimer = Math.max(u.feverTimer, 6.5);
                u.chatEmoji = '📣';
                u.chatTimer = 2.0;
              }
            }
          );
          this.spawnParticleBurst(this.staffPack.rallyX, this.staffPack.rallyY, '#ef4444', 12);
          this.spawnFloatingText(
            this.staffPack.rallyX,
            this.staffPack.rallyY - 1.5,
            `PACK ASSAULT ON ${target.name.split(' ')[0].toUpperCase()}!`,
            '#f87171'
          );
          soundFX.playStaffCoordinated();
        }
      } else if (this.staffPack.timer <= 0) {
        this.staffPack = null;
        this.staffPackCooldown = this.staffAlertTier === 2 ? 12 : 19;
      }
    } else if (this.staffAlertTier >= 1) {
      this.staffPackCooldown -= dt;
      if (this.staffPackCooldown <= 0) {
        this.launchCoordinatedStaffPack();
      }
    }
  }

  private launchCoordinatedStaffPack(): void {
    const candidates = this.nations
      .filter((n) => n.alive && n.species !== 'staff')
      .sort(
        (a, b) =>
          b.population + (b.armyCount ?? 0) * 3 + (b.firearms ?? 0) * 1.5 + b.techTier * 12 -
          (a.population + (a.armyCount ?? 0) * 3 + (a.firearms ?? 0) * 1.5 + a.techTier * 12)
      );
    const target = candidates[0] || this.nations.find((n) => n.alive);
    if (!target) {
      this.staffPackCooldown = 14;
      return;
    }

    let rallyX = -1;
    let rallyY = -1;
    for (let attempt = 0; attempt < 22; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 17 + Math.random() * 10;
      const tx = Math.max(4, Math.min(GRID_W - 5, Math.round(target.capitalX + Math.cos(angle) * dist)));
      const ty = Math.max(4, Math.min(GRID_H - 5, Math.round(target.capitalY + Math.sin(angle) * dist)));
      const idx = ty * GRID_W + tx;
      if (this.lightMap[idx] === 0 && this.prop[idx] === PropType.NONE) {
        rallyX = tx + 0.5;
        rallyY = ty + 0.5;
        break;
      }
    }
    if (rallyX < 0) {
      this.staffPackCooldown = 10;
      return;
    }

    const wildStaffCount = this.units.filter((u) => u.alive && isStaffKind(u.kind) && u.nationId < 0).length;
    const hardCap = Math.min(220 + this.day * 28, Math.floor(this.maxPopulation * 0.28));
    const room = Math.max(0, hardCap - wildStaffCount);
    const desiredRoster: Array<
      | UnitKind.STAFF_MANAGER
      | UnitKind.STAFF_ANNOUNCER
      | UnitKind.STAFF_WARDEN
      | UnitKind.STAFF_STALKER
      | UnitKind.STAFF_CRAWLER
      | UnitKind.STAFF_NORMAL
      | UnitKind.STAFF_FORKLIFT
      | UnitKind.STAFF_THROWER
      | UnitKind.STAFF_DISRUPTOR
      | UnitKind.STAFF_DIRECTOR
    > =
      this.staffAlertTier === 2
        ? [
            UnitKind.STAFF_MANAGER,
            UnitKind.STAFF_FORKLIFT,
            UnitKind.STAFF_ANNOUNCER,
            UnitKind.STAFF_DISRUPTOR,
            UnitKind.STAFF_THROWER,
            UnitKind.STAFF_THROWER,
            UnitKind.STAFF_WARDEN,
            UnitKind.STAFF_STALKER,
            UnitKind.STAFF_CRAWLER,
            UnitKind.STAFF_NORMAL,
          ]
        : [
            UnitKind.STAFF_ANNOUNCER,
            UnitKind.STAFF_FORKLIFT,
            UnitKind.STAFF_THROWER,
            UnitKind.STAFF_DISRUPTOR,
            UnitKind.STAFF_WARDEN,
            UnitKind.STAFF_CRAWLER,
            UnitKind.STAFF_NORMAL,
          ];

    const spawnCount = Math.min(desiredRoster.length, Math.max(3, room));
    for (let i = 0; i < spawnCount; i++) {
      const ox = rallyX + (Math.random() - 0.5) * 3.5;
      const oy = rallyY + (Math.random() - 0.5) * 3.5;
      const spawned = this.spawnStaff(desiredRoster[i], ox, oy);
      if (this.staffAlertTier === 2) {
        spawned.maxHp = Math.round(spawned.maxHp * 1.25);
        spawned.hp = spawned.maxHp;
      }
      spawned.chatEmoji = '⚠️';
      spawned.chatTimer = 2.6;
      spawned.targetX = rallyX;
      spawned.targetY = rallyY;
      spawned.hasTarget = true;
    }

    this.staffPack = {
      targetNationId: target.id,
      targetX: target.capitalX,
      targetY: target.capitalY,
      rallyX,
      rallyY,
      phase: 'GATHERING',
      timer: 6.0,
      membersCount: spawnCount,
    };
    this.staffPackCooldown = this.staffAlertTier === 2 ? 22 : 28;
    this.spawnFloatingText(rallyX, rallyY - 1.3, 'STAFF PACK RALLYING!', '#fbbf24');
    this.addNews('STAFF', `Coordinated Staff pack spotted rallying outside ${target.name}!`);
    soundFX.playStaffCoordinated();
    this.staffInvasionScanTimer = 0;
  }

  private evaluateStaffInvasionAlerts(dt: number): void {
    const radarNations = this.nations.filter(
      (n) => n.alive && n.species !== 'staff' && hasTech(n, 'staff_invasion_radar')
    );
    if (radarNations.length === 0) {
      this.staffInvasionAlert = null;
      this.lastInvasionAlertKey = '';
      return;
    }

    this.staffInvasionScanTimer -= dt;
    if (this.staffInvasionScanTimer > 0 && this.staffInvasionAlert) {
      this.staffInvasionAlert.remainingSec = Math.max(0, this.staffInvasionAlert.remainingSec - dt);
      if (this.staffInvasionAlert.remainingSec <= 0) {
        this.staffInvasionAlert = null;
      }
      return;
    }
    this.staffInvasionScanTimer = 0.75;

    let nextAlert: StaffInvasionAlert | null = null;

    if (this.isNight && this.staffPack) {
      const target = this.getNation(this.staffPack.targetNationId);
      if (target && target.alive) {
        const isCharging = this.staffPack.phase === 'CHARGING';
        const ax = isCharging ? (this.staffPack.rallyX + target.capitalX) * 0.5 : this.staffPack.rallyX;
        const ay = isCharging ? (this.staffPack.rallyY + target.capitalY) * 0.5 : this.staffPack.rallyY;
        nextAlert = {
          title: isCharging ? 'Staff Siege Pack Charging!' : 'Staff Pack Staging Nearby',
          detail: `${Math.max(4, this.staffPack.membersCount)} hostile Staff converging on ${target.name}`,
          targetNationId: target.id,
          nationName: target.name,
          nationColor: target.color,
          x: ax,
          y: ay,
          enemyCount: Math.max(4, this.staffPack.membersCount),
          severity: isCharging ? 'CRITICAL' : 'WARNING',
          phase: isCharging ? 'BREACH' : 'INCOMING',
          remainingSec: Math.max(2, Math.ceil(this.staffPack.timer)),
        };
      }
    }

    if (!nextAlert && this.isNight) {
      let bestScore = 0;
      for (const rn of radarNations) {
        if (!this.isNationInWindow(rn)) continue;
        let nearCount = 0;
        let bossCount = 0;
        let directorFound = false;
        let sumX = 0;
        let sumY = 0;
        this.spatialHash.queryRadius(this.units, rn.capitalX, rn.capitalY, 26, (u) => {
          if (isStaffKind(u.kind) && u.nationId < 0 && !u.pacified) {
            nearCount++;
            if (u.kind === UnitKind.STAFF_DIRECTOR) {
              directorFound = true;
              bossCount += 3;
            } else if (
              u.kind === UnitKind.STAFF_MANAGER ||
              u.kind === UnitKind.STAFF_FORKLIFT ||
              u.kind === UnitKind.STAFF_DISRUPTOR
            ) {
              bossCount++;
            }
            sumX += u.x;
            sumY += u.y;
          }
        });
        const isAuditThreat = this.day % 10 === 0 && nearCount >= 2;
        if (nearCount >= 4 || bossCount >= 1 || isAuditThreat) {
          const score = nearCount + bossCount * 3;
          if (score > bestScore) {
            bestScore = score;
            const cx = nearCount > 0 ? sumX / nearCount : rn.capitalX;
            const cy = nearCount > 0 ? sumY / nearCount : rn.capitalY;
            const isCritical = directorFound || nearCount >= 8 || bossCount >= 1 || this.day % 10 === 0;
            nextAlert = {
              title: directorFound
                ? 'Rogue Store Director Detected!'
                : this.day % 10 === 0
                  ? 'Audit Night Breach Detected!'
                  : bossCount >= 1
                    ? 'Heavy Staff Vanguard Approaching!'
                    : 'Night Staff Border Incursion',
              detail: `${nearCount} hostile Staff spotted near ${rn.name}`,
              targetNationId: rn.id,
              nationName: rn.name,
              nationColor: rn.color,
              x: cx,
              y: cy,
              enemyCount: nearCount,
              severity: isCritical ? 'CRITICAL' : 'WARNING',
              phase: Math.hypot(cx - rn.capitalX, cy - rn.capitalY) <= 15 ? 'BREACH' : 'INCOMING',
              remainingSec: Math.max(4, Math.ceil(CYCLE_DURATION - this.cycleTimer)),
            };
          }
        }
      }
    }

    if (nextAlert) {
      const alertKey = `${this.day}-${nextAlert.targetNationId}-${nextAlert.severity}-${nextAlert.phase}`;
      if (alertKey !== this.lastInvasionAlertKey) {
        this.lastInvasionAlertKey = alertKey;
        soundFX.playInvasionAlert(nextAlert.severity === 'CRITICAL');
        this.addNews('STAFF', `PA RADAR ALERT: ${nextAlert.title} (${nextAlert.nationName})`);
      }
      this.nationBuildingAlert.set(nextAlert.targetNationId, {
        x: nextAlert.x,
        y: nextAlert.y,
        until: this.simTime + 8,
      });
      this.staffInvasionAlert = nextAlert;
    } else {
      this.staffInvasionAlert = null;
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
        this.spawnFloatingText(this.summitLocalX, this.summitLocalY - 3, 'EMERGENCY SUMMIT!', '#38bdf8');
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
      this.spawnFloatingText(this.summitLocalX, this.summitLocalY - 3, 'ROYAL SUMMIT!', '#ffda1a');
    } else if (manual) {
      this.addNews(
        'DIPLOMACY',
        `Day ${this.day} Summit: Envoys met by radio in the Neutral Lounge while kings remained at war.`
      );
      this.spawnFloatingText(this.summitLocalX, this.summitLocalY - 3, 'ROYAL SUMMIT!', '#ffda1a');
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
      if (Math.hypot(u.x - this.summitLocalX, u.y - this.summitLocalY) <= 5.5) {
        attending.push({ nation: n, leader: u });
      }
    }

    if (attending.length < 2) return;
    this.summitDiscussed = true;

    this.spawnParticleBurst(this.summitLocalX, this.summitLocalY, '#ffda1a', 14);
    this.spawnFloatingText(this.summitLocalX, this.summitLocalY - 3.6, 'SUMMIT ACCORD!', '#ffda1a');

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
          this.connectTradeRoad(a, b);
          a.lastQuote = `We agreed on open cart lanes with ${b.name} at the Summit!`;
          b.lastQuote = `Fair meatball trade sealed with ${a.name}!`;
          this.addNews(
            'TRADE',
            `Royal Summit Accord: ${attending[i].leader.name.split(' ')[0]} & ${attending[j].leader.name.split(' ')[0]} met in the Showroom Lounge and signed a Trade Pact!`
          );
          forgedDeal = true;
        } else if (stance === 'TRADE_PACT' && a.meatballs >= 45 && b.meatballs >= 45) {
          this.setRelation(a.id, b.id, 'ALLIANCE');
          this.connectTradeRoad(a, b);
          a.lastQuote = `${b.name} and ${a.name} stand united in the Showroom!`;
          b.lastQuote = `An Alliance forged over Swedish meatballs!`;
          this.addNews(
            'DIPLOMACY',
            `Royal Summit Accord: ${a.name} & ${b.name} elevated their talks into a Grand Alliance!`
          );
          forgedDeal = true;
        } else if (stance === 'ALLIANCE' && a.happiness >= 55 && b.happiness >= 55) {
          this.setRelation(a.id, b.id, 'UNION');
          this.connectUnionLandsAndCorridor(a, b, false);
          this.recountTerritoryAndHousing();
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
      this.spawnParticleBurst(this.summitLocalX + 0.5, this.summitLocalY + 0.5, '#ffda1a', 14);
      this.spawnFloatingText(this.summitLocalX + 0.5, this.summitLocalY - 3, 'SUMMIT LOUNGE CONVENED', '#ffda1a');
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
        this.isNationCitizen(u) &&
        u.role === SurvivorRole.LEADER
    );
    if (!leaderUnit) return 'away';
    const dist = Math.hypot(leaderUnit.x - (this.summitLocalX + 0.5), leaderUnit.y - (this.summitLocalY + 0.5));
    if (dist <= 4.2) return 'seated';
    if (this.summitLoungeSessionActive || (this.summitActiveTimer > 0 && !this.isNight)) {
      return 'walking';
    }
    return 'away';
  }

  private isNationCitizen(u: Unit): boolean {
    return u.nationId >= 0 && (u.kind === UnitKind.SURVIVOR || isStaffKind(u.kind));
  }

  private getWeaponRank(w: WeaponType | undefined): number {
    if (w === 'arc_caster') return 5;
    if (w === 'rail_cannon') return 4;
    if (w === 'plasma_stapler' || w === 'halogen_rifle' || w === 'pa_megaphone') return 3;
    if (w === 'nailgun') return 2;
    if (w === 'allen_spear') return 1;
    return 0;
  }

  private getNationBestWeaponType(n: Nation | undefined, unitId = 0): WeaponType {
    if (!n) return 'none';
    if (hasTech(n, 'quantum_barcodes')) {
      if (n.species === 'staff') return 'pa_megaphone';
      if (hasTech(n, 'heavy_rivet_cannons') && unitId % 2 === 1) return 'rail_cannon';
      return 'arc_caster';
    }
    if (hasTech(n, 'heavy_rivet_cannons')) {
      return n.species === 'staff' ? 'pa_megaphone' : 'rail_cannon';
    }
    if (hasTech(n, 'halogen_rifles')) {
      return n.species === 'staff' ? 'pa_megaphone' : unitId % 3 === 0 ? 'plasma_stapler' : 'halogen_rifle';
    }
    if (hasTech(n, 'pneumatic_nailguns')) return 'nailgun';
    if (hasTech(n, 'allen_spears')) return 'allen_spear';
    return 'none';
  }

  private getNationBestWeapon(
    n: Nation | undefined,
    unitId = 0
  ): { weapon: WeaponType; tier: 0 | 1 | 2 | 3 | 4 | 5 } {
    if (!n) return { weapon: 'none', tier: 0 };
    if (hasTech(n, 'quantum_barcodes')) {
      const weapon: WeaponType =
        n.species === 'staff'
          ? 'pa_megaphone'
          : hasTech(n, 'heavy_rivet_cannons') && unitId % 2 === 1
            ? 'rail_cannon'
            : 'arc_caster';
      return { weapon, tier: 5 };
    }
    if (hasTech(n, 'heavy_rivet_cannons')) {
      return { weapon: n.species === 'staff' ? 'pa_megaphone' : 'rail_cannon', tier: 4 };
    }
    if (hasTech(n, 'halogen_rifles')) {
      const weapon: WeaponType =
        n.species === 'staff' ? 'pa_megaphone' : unitId % 3 === 0 ? 'plasma_stapler' : 'halogen_rifle';
      return { weapon, tier: 3 };
    }
    if (hasTech(n, 'pneumatic_nailguns')) {
      return { weapon: 'nailgun', tier: 2 };
    }
    if (hasTech(n, 'allen_spears')) {
      return { weapon: 'allen_spear', tier: 1 };
    }
    return { weapon: 'none', tier: 0 };
  }

  public setAllowWildStaffKingdoms(enabled: boolean): void {
    this.allowWildStaffKingdoms = enabled;
  }

  public setSmartInfrastructureMode(enabled: boolean): void {
    this.smartInfrastructureMode = enabled;
    this.blueprintLayoutCache.clear();
    if (enabled) {
      this.needsInteriorWallCleanup = true;
    }
  }

  public setInfiniteWorldMode(enabled: boolean): void {
    this.infiniteWorldMode = enabled;
    if (enabled) {
      const baseBx = Math.floor(this.originTx / CHUNK_W);
      const baseBy = Math.floor(this.originTy / CHUNK_H);
      for (let cy = 0; cy < 6; cy++) {
        for (let cx = 0; cx < 8; cx++) {
          this.discoveredChunks.add(chunkKey(baseBx + cx, baseBy + cy));
        }
      }
    } else {
      this.clampCamera();
    }
  }

  public isNationInWindow(n: Nation): boolean {
    return n.capitalX >= 4 && n.capitalX < GRID_W - 4 && n.capitalY >= 4 && n.capitalY < GRID_H - 4;
  }

  public clampCamera(): void {
    if (!this.infiniteWorldMode) {
      this.camera.x = Math.max(0, Math.min(WORLD_PX_W, this.camera.x));
      this.camera.y = Math.max(0, Math.min(WORLD_PX_H, this.camera.y));
    }
  }

  public panToTile(localTx: number, localTy: number): void {
    this.camera.x = localTx * TILE_SIZE;
    this.camera.y = localTy * TILE_SIZE;
    this.updateCameraAndStream();
  }

  public updateCameraAndStream(): void {
    if (!this.infiniteWorldMode) {
      this.clampCamera();
      return;
    }
    const camTx = this.camera.x / TILE_SIZE;
    const camTy = this.camera.y / TILE_SIZE;
    const marginX = 48;
    const marginY = 36;
    let stepsX = 0;
    let stepsY = 0;
    if (camTx < marginX) {
      stepsX = Math.floor((camTx - marginX) / CHUNK_W);
    } else if (camTx > GRID_W - marginX) {
      stepsX = Math.ceil((camTx - (GRID_W - marginX)) / CHUNK_W);
    }
    if (camTy < marginY) {
      stepsY = Math.floor((camTy - marginY) / CHUNK_H);
    } else if (camTy > GRID_H - marginY) {
      stepsY = Math.ceil((camTy - (GRID_H - marginY)) / CHUNK_H);
    }
    if (stepsX !== 0 || stepsY !== 0) {
      this.shiftOriginTo(this.originTx + stepsX * CHUNK_W, this.originTy + stepsY * CHUNK_H);
    }
  }

  private recomputeHibernatedStats(): void {
    this.hibernatedNationTerr.clear();
    this.hibernatedNationPop.clear();
    if (this.chunkStore.size === 0) return;
    for (const ch of this.chunkStore.values()) {
      if (ch.nationTerrCounts) {
        for (const [nidStr, count] of Object.entries(ch.nationTerrCounts)) {
          const nid = Number(nidStr);
          this.hibernatedNationTerr.set(nid, (this.hibernatedNationTerr.get(nid) ?? 0) + count);
        }
      }
      for (const du of ch.dormantUnits) {
        if (du.alive && du.nationId >= 0 && this.isNationCitizen(du)) {
          this.hibernatedNationPop.set(
            du.nationId,
            (this.hibernatedNationPop.get(du.nationId) ?? 0) + 1
          );
        }
      }
    }
  }

  private transferNationInChunkStore(fromNationId: number, toNationId: number): void {
    for (const ch of this.chunkStore.values()) {
      const hasTerr = (ch.nationTerrCounts?.[fromNationId] ?? 0) > 0;
      if (hasTerr) {
        for (let i = 0; i < ch.territory.length; i++) {
          if (ch.territory[i] === fromNationId) {
            ch.territory[i] = toNationId;
          }
          if (ch.propOwner[i] === fromNationId) {
            ch.propOwner[i] = toNationId;
          }
        }
        const movedCount = ch.nationTerrCounts![fromNationId] ?? 0;
        delete ch.nationTerrCounts![fromNationId];
        if (toNationId >= 0) {
          ch.nationTerrCounts![toNationId] = (ch.nationTerrCounts![toNationId] ?? 0) + movedCount;
        }
      }
      for (const du of ch.dormantUnits) {
        if (du.alive && du.nationId === fromNationId) {
          du.nationId = toNationId;
          du.originNationId = toNationId;
          if (du.role === SurvivorRole.LEADER || du.role === SurvivorRole.GENERAL) {
            du.role = SurvivorRole.GUARD;
          }
        }
      }
    }
    this.recomputeHibernatedStats();
  }

  private saveActiveBlockToChunk(cx: number, cy: number, bx: number, by: number): SavedWorldChunk {
    const ch = createEmptyChunk(bx, by);
    const terrCounts: Record<number, number> = {};
    const gx0 = cx * CHUNK_W;
    const gy0 = cy * CHUNK_H;
    for (let ly = 0; ly < CHUNK_H; ly++) {
      const srcStart = (gy0 + ly) * GRID_W + gx0;
      const srcEnd = srcStart + CHUNK_W;
      const dstStart = ly * CHUNK_W;
      ch.biome.set(this.biome.subarray(srcStart, srcEnd), dstStart);
      ch.prop.set(this.prop.subarray(srcStart, srcEnd), dstStart);
      ch.propHp.set(this.propHp.subarray(srcStart, srcEnd), dstStart);
      ch.propMaxHp.set(this.propMaxHp.subarray(srcStart, srcEnd), dstStart);
      ch.propOwner.set(this.propOwner.subarray(srcStart, srcEnd), dstStart);
      ch.propVariant.set(this.propVariant.subarray(srcStart, srcEnd), dstStart);
      ch.territory.set(this.territory.subarray(srcStart, srcEnd), dstStart);
      ch.lightMap.set(this.lightMap.subarray(srcStart, srcEnd), dstStart);
      ch.fireMap.set(this.fireMap.subarray(srcStart, srcEnd), dstStart);
      ch.disabledLightMap.set(this.disabledLightMap.subarray(srcStart, srcEnd), dstStart);
      for (let lx = 0; lx < CHUNK_W; lx++) {
        const tid = this.territory[srcStart + lx];
        if (tid >= 0) {
          terrCounts[tid] = (terrCounts[tid] ?? 0) + 1;
        }
      }
    }
    ch.nationTerrCounts = terrCounts;
    return ch;
  }

  private writeChunkToActiveGrid(cx: number, cy: number, ch: SavedWorldChunk): void {
    const gx0 = cx * CHUNK_W;
    const gy0 = cy * CHUNK_H;
    for (let ly = 0; ly < CHUNK_H; ly++) {
      const srcStart = ly * CHUNK_W;
      const srcEnd = srcStart + CHUNK_W;
      const dstStart = (gy0 + ly) * GRID_W + gx0;
      this.biome.set(ch.biome.subarray(srcStart, srcEnd), dstStart);
      this.prop.set(ch.prop.subarray(srcStart, srcEnd), dstStart);
      this.propHp.set(ch.propHp.subarray(srcStart, srcEnd), dstStart);
      this.propMaxHp.set(ch.propMaxHp.subarray(srcStart, srcEnd), dstStart);
      this.propOwner.set(ch.propOwner.subarray(srcStart, srcEnd), dstStart);
      this.propVariant.set(ch.propVariant.subarray(srcStart, srcEnd), dstStart);
      this.territory.set(ch.territory.subarray(srcStart, srcEnd), dstStart);
      this.lightMap.set(ch.lightMap.subarray(srcStart, srcEnd), dstStart);
      this.fireMap.set(ch.fireMap.subarray(srcStart, srcEnd), dstStart);
      this.disabledLightMap.set(ch.disabledLightMap.subarray(srcStart, srcEnd), dstStart);
    }
  }

  private shiftOriginTo(newOriginTx: number, newOriginTy: number): void {
    const shiftX = newOriginTx - this.originTx;
    const shiftY = newOriginTy - this.originTy;
    if (shiftX === 0 && shiftY === 0) return;

    const oldBx0 = Math.floor(this.originTx / CHUNK_W);
    const oldBy0 = Math.floor(this.originTy / CHUNK_H);
    const newBx0 = Math.floor(newOriginTx / CHUNK_W);
    const newBy0 = Math.floor(newOriginTy / CHUNK_H);

    // 1. Save outgoing 30x30 blocks to chunkStore
    for (let cy = 0; cy < 6; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        const bx = oldBx0 + cx;
        const by = oldBy0 + cy;
        const staysInNew =
          bx >= newBx0 && bx < newBx0 + 8 && by >= newBy0 && by < newBy0 + 6;
        if (!staysInNew) {
          const ch = this.saveActiveBlockToChunk(cx, cy, bx, by);
          this.chunkStore.set(chunkKey(bx, by), ch);
        }
      }
    }

    // 2. Shift living units & hibernate those leaving the active 240x180 window
    const activeUnits: Unit[] = [];
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.alive) continue;
      u.x -= shiftX;
      u.y -= shiftY;
      u.targetX -= shiftX;
      u.targetY -= shiftY;
      u.lastCheckX -= shiftX;
      u.lastCheckY -= shiftY;
      if (u.guardPostX !== undefined) u.guardPostX -= shiftX;
      if (u.guardPostY !== undefined) u.guardPostY -= shiftY;
      if (u.routeWaypoints) {
        for (const wp of u.routeWaypoints) {
          wp.x -= shiftX;
          wp.y -= shiftY;
        }
      }
      if (u.insideBuildingIdx !== undefined && u.insideBuildingIdx >= 0) {
        const obx = u.insideBuildingIdx % GRID_W;
        const oby = (u.insideBuildingIdx / GRID_W) | 0;
        const nbx = obx - shiftX;
        const nby = oby - shiftY;
        if (nbx >= 0 && nbx < GRID_W && nby >= 0 && nby < GRID_H) {
          u.insideBuildingIdx = nby * GRID_W + nbx;
        } else {
          u.insideBuildingIdx = undefined;
          u.insideTimer = 0;
        }
      }
      u.visitTargetIdx = undefined;

      if (u.x >= 0 && u.x < GRID_W && u.y >= 0 && u.y < GRID_H) {
        activeUnits.push(u);
      } else {
        const wx = newOriginTx + u.x;
        const wy = newOriginTy + u.y;
        const ubx = Math.floor(Math.floor(wx) / CHUNK_W);
        const uby = Math.floor(Math.floor(wy) / CHUNK_H);
        const key = chunkKey(ubx, uby);
        const targetChunk = this.chunkStore.get(key);
        if (targetChunk) {
          u.x = wx;
          u.y = wy;
          u.targetX += newOriginTx;
          u.targetY += newOriginTy;
          u.lastCheckX += newOriginTx;
          u.lastCheckY += newOriginTy;
          if (u.guardPostX !== undefined) u.guardPostX += newOriginTx;
          if (u.guardPostY !== undefined) u.guardPostY += newOriginTy;
          if (u.routeWaypoints) {
            for (const wp of u.routeWaypoints) {
              wp.x += newOriginTx;
              wp.y += newOriginTy;
            }
          }
          u.insideTimer = 0;
          u.insideBuildingIdx = undefined;
          targetChunk.dormantUnits.push(u);
        }
      }
    }
    this.units = activeUnits;

    // 3. Shift overlapping typed-array rows in-place
    const dstX0 = Math.max(0, -shiftX);
    const dstX1 = Math.min(GRID_W, GRID_W - shiftX);
    const dstY0 = Math.max(0, -shiftY);
    const dstY1 = Math.min(GRID_H, GRID_H - shiftY);
    if (dstX1 > dstX0 && dstY1 > dstY0) {
      const shiftArrRow = (arr: Uint8Array | Uint16Array | Int16Array, dstY: number) => {
        const srcY = dstY + shiftY;
        const dstStart = dstY * GRID_W + dstX0;
        const srcStart = srcY * GRID_W + dstX0 + shiftX;
        const len = dstX1 - dstX0;
        arr.copyWithin(dstStart, srcStart, srcStart + len);
      };
      const stepRow = (dstY: number) => {
        shiftArrRow(this.biome, dstY);
        shiftArrRow(this.prop, dstY);
        shiftArrRow(this.propHp, dstY);
        shiftArrRow(this.propMaxHp, dstY);
        shiftArrRow(this.propOwner, dstY);
        shiftArrRow(this.propVariant, dstY);
        shiftArrRow(this.territory, dstY);
        shiftArrRow(this.lightMap, dstY);
        shiftArrRow(this.fireMap, dstY);
        shiftArrRow(this.disabledLightMap, dstY);
      };
      if (shiftY < 0) {
        for (let dstY = dstY1 - 1; dstY >= dstY0; dstY--) stepRow(dstY);
      } else {
        for (let dstY = dstY0; dstY < dstY1; dstY++) stepRow(dstY);
      }
    }

    // 4. Update origin & load/generate newly entered 30x30 sectors
    this.originTx = newOriginTx;
    this.originTy = newOriginTy;

    for (let cy = 0; cy < 6; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        const bx = newBx0 + cx;
        const by = newBy0 + cy;
        const wasInOld = bx >= oldBx0 && bx < oldBx0 + 8 && by >= oldBy0 && by < oldBy0 + 6;
        if (wasInOld) continue;

        const key = chunkKey(bx, by);
        const saved = this.chunkStore.get(key);
        if (saved) {
          this.writeChunkToActiveGrid(cx, cy, saved);
          this.chunkStore.delete(key);
          for (const du of saved.dormantUnits) {
            if (!du.alive) continue;
            const isCitizen = du.nationId >= 0 && this.isNationCitizen(du);
            if (!isCitizen && this.units.length >= this.maxPopulation + 160) continue;
            du.x -= newOriginTx;
            du.y -= newOriginTy;
            du.targetX -= newOriginTx;
            du.targetY -= newOriginTy;
            du.lastCheckX -= newOriginTx;
            du.lastCheckY -= newOriginTy;
            if (du.guardPostX !== undefined) du.guardPostX -= newOriginTx;
            if (du.guardPostY !== undefined) du.guardPostY -= newOriginTy;
            if (du.routeWaypoints) {
              for (const wp of du.routeWaypoints) {
                wp.x -= newOriginTx;
                wp.y -= newOriginTy;
              }
            }
            if (du.x >= 0 && du.x < GRID_W && du.y >= 0 && du.y < GRID_H) {
              this.units.push(du);
            }
          }
        } else {
          const { chunk, spawns } = generateProceduralChunk(
            this.worldSeed,
            bx,
            by,
            this.worldPreset
          );
          this.writeChunkToActiveGrid(cx, cy, chunk);
          if (!this.discoveredChunks.has(key)) {
            this.discoveredChunks.add(key);
            if (this.units.length < this.maxPopulation + 120) {
              for (const sp of spawns) {
                const lx = cx * CHUNK_W + sp.lx;
                const ly = cy * CHUNK_H + sp.ly;
                if (isStaffKind(sp.kind)) {
                  const spawned = this.spawnStaff(
                    sp.kind as
                      | UnitKind.STAFF_NORMAL
                      | UnitKind.STAFF_CRAWLER
                      | UnitKind.STAFF_MANAGER
                      | UnitKind.STAFF_WARDEN
                      | UnitKind.STAFF_STALKER
                      | UnitKind.STAFF_ANNOUNCER
                      | UnitKind.STAFF_FORKLIFT
                      | UnitKind.STAFF_THROWER
                      | UnitKind.STAFF_DISRUPTOR
                      | UnitKind.STAFF_DIRECTOR,
                    lx,
                    ly
                  );
                  if (sp.name) spawned.name = sp.name;
                } else {
                  this.spawnSurvivor(-1, sp.role, lx, ly);
                }
              }
            }
          }
        }
      }
    }

    // 5. Shift camera, nations, effects, and caches
    this.camera.x -= shiftX * TILE_SIZE;
    this.camera.y -= shiftY * TILE_SIZE;

    for (const n of this.nations) {
      n.capitalX -= shiftX;
      n.capitalY -= shiftY;
      if (n.unionHubs) {
        for (const h of n.unionHubs) {
          h.x -= shiftX;
          h.y -= shiftY;
        }
      }
      if (n.unionCheckpoints) {
        for (const cp of n.unionCheckpoints) {
          cp.x -= shiftX;
          cp.y -= shiftY;
        }
      }
      if (n.battlePlan) {
        n.battlePlan.rallyX -= shiftX;
        n.battlePlan.rallyY -= shiftY;
      }
    }

    this.projectiles = this.projectiles.filter((p) => {
      p.x -= shiftX;
      p.y -= shiftY;
      return p.x >= 0 && p.x < GRID_W && p.y >= 0 && p.y < GRID_H;
    });
    this.particles = this.particles.filter((pt) => {
      pt.x -= shiftX;
      pt.y -= shiftY;
      return pt.x >= 0 && pt.x < GRID_W && pt.y >= 0 && pt.y < GRID_H;
    });
    this.floatingTexts = this.floatingTexts.filter((ft) => {
      ft.x -= shiftX;
      ft.y -= shiftY;
      return ft.x >= 0 && ft.x < GRID_W && ft.y >= 0 && ft.y < GRID_H;
    });
    this.recentBuilds = this.recentBuilds.filter((rb) => {
      rb.x -= shiftX;
      rb.y -= shiftY;
      return rb.x >= 0 && rb.x < GRID_W && rb.y >= 0 && rb.y < GRID_H;
    });
    if (this.staffPack) {
      this.staffPack.targetX -= shiftX;
      this.staffPack.targetY -= shiftY;
      this.staffPack.rallyX -= shiftX;
      this.staffPack.rallyY -= shiftY;
    }
    if (this.staffInvasionAlert) {
      this.staffInvasionAlert.x -= shiftX;
      this.staffInvasionAlert.y -= shiftY;
    }

    this.activeBuilderTargets.clear();
    this.warFrontCache.clear();
    this.recomputeHibernatedStats();
    this.spatialHash.rebuild(this.units);
    this.recountTerritoryAndHousing();
    this.recomputeLightMap();
    this.rebuildMapCache();
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
    const mult =
      (hasTech(n, 'blueprint_mastery') ? 1.15 : 1) * (hasTech(n, 'kevlar_aprons') ? 1.2 : 1);
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
    const isTinker = role === SurvivorRole.TINKER;
    const tierHpBonus = n ? (n.techTier - 1) * 14 : 0;
    const govHpBonus = n?.government === 'Iron Dictatorship' && (isGuard || isGeneral) ? 15 : 0;
    const staffCitizenBonus = isStaffKind(u.kind) ? 20 : 0;
    const techHpBonus =
      (hasTech(n, 'allen_spears') && (isGuard || isGeneral || isLeader) ? 18 : 0) +
      (hasTech(n, 'flatpack_automation') && (isGuard || isGeneral || isLeader) ? 20 : 0) +
      (hasTech(n, 'kevlar_aprons') && (isGuard || isGeneral || isLeader) ? 35 : 0) +
      (hasTech(n, 'swedish_schematics') && isTinker ? 15 : 0);
    const techAtkBonus =
      (hasTech(n, 'allen_spears') && (isGuard || isGeneral || isLeader) ? 3 : 0) +
      (hasTech(n, 'flatpack_automation') && (isGuard || isGeneral || isLeader) ? 2 : 0) +
      (hasTech(n, 'pneumatic_nailguns') && (isGuard || isGeneral || isLeader) ? 3 : 0) +
      (hasTech(n, 'halogen_rifles') && (isGuard || isGeneral || isLeader) ? 5 : 0) +
      (hasTech(n, 'kevlar_aprons') && (isGuard || isGeneral || isLeader) ? 4 : 0) +
      (hasTech(n, 'heavy_rivet_cannons') && (isGuard || isGeneral || isLeader) ? 5 : 0) +
      (hasTech(n, 'quantum_barcodes') && (isGuard || isGeneral || isLeader) ? 6 : 0);
    const baseHp =
      (isLeader ? 140 : isGeneral ? 135 : isGuard ? 95 : 70) +
      tierHpBonus +
      govHpBonus +
      techHpBonus +
      staffCitizenBonus;
    u.maxHp = u.traits.includes('Tough') ? Math.round(baseHp * 1.35) : baseHp;
    u.hp = Math.min(u.hp, u.maxHp);
    u.atk =
      (isLeader ? 14 : isGeneral ? 13 : isGuard ? 11 : 6) +
      (n ? (n.techTier - 1) * 2 : 0) +
      techAtkBonus +
      (isStaffKind(u.kind) ? 3 : 0);

    if (n && (isGuard || isGeneral || isLeader || isTinker)) {
      const best = this.getNationBestWeapon(n, u.id);
      if (best.tier > this.getWeaponRank(u.weapon)) {
        u.weapon = best.weapon;
      }
    }
  }

  public setNationActiveResearch(nationId: number, techId: TechId): void {
    const n = this.getNation(nationId);
    if (!n || !n.alive) return;
    const node = RESEARCH_BY_ID[techId];
    if (!node || !canResearchTech(n, node)) return;
    n.activeResearchId = techId;
    n.researchPoints = 0;
  }

  public boostNationResearch(nationId: number, amount = 20): boolean {
    const n = this.getNation(nationId);
    if (!n || !n.alive) return false;
    if (!n.researchedTechs) n.researchedTechs = [];
    if (!n.activeResearchId || n.researchedTechs.includes(n.activeResearchId)) {
      n.activeResearchId = this.pickBestResearchForNation(n);
      n.researchPoints = 0;
    }
    if (!n.activeResearchId) {
      n.allenWrenches += 15;
      this.spawnFloatingText(n.capitalX + 0.5, n.capitalY - 1.4, '+15 WRENCHES!', '#38bdf8');
      return true;
    }
    n.researchPoints = (n.researchPoints || 0) + amount;
    const activeNode = RESEARCH_BY_ID[n.activeResearchId];
    if (activeNode && n.researchPoints >= activeNode.cost) {
      const completedId = activeNode.id;
      n.researchedTechs.push(completedId);
      n.researchPoints = Math.max(0, n.researchPoints - activeNode.cost);
      n.activeResearchId = this.pickBestResearchForNation(n);
      this.applyTechUnlockEffects(n, completedId, true);
    } else {
      this.spawnFloatingText(n.capitalX + 0.5, n.capitalY - 1.4, `+${amount} RP!`, '#38bdf8');
      this.spawnParticleBurst(n.capitalX + 0.5, n.capitalY + 0.5, '#38bdf8', 7);
    }
    return true;
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
    if (
      techId === 'halogen_floodlights' ||
      techId === 'fluorescent_capacitor' ||
      techId === 'sunlight_beacons'
    ) {
      this.dirtyLight = true;
    }
    if (
      techId === 'allen_spears' ||
      techId === 'flatpack_automation' ||
      techId === 'swedish_schematics' ||
      techId === 'pneumatic_nailguns' ||
      techId === 'halogen_rifles' ||
      techId === 'kevlar_aprons' ||
      techId === 'heavy_rivet_cannons' ||
      techId === 'quantum_barcodes'
    ) {
      for (const u of this.units) {
        if (u.alive && u.nationId === n.id && this.isNationCitizen(u)) {
          this.applyRoleStats(u, n, u.role);
        }
      }
      if (
        techId === 'pneumatic_nailguns' ||
        techId === 'halogen_rifles' ||
        techId === 'heavy_rivet_cannons' ||
        techId === 'quantum_barcodes'
      ) {
        const gain =
          techId === 'quantum_barcodes'
            ? 18
            : techId === 'heavy_rivet_cannons'
              ? 14
              : techId === 'halogen_rifles'
                ? 12
                : 8;
        n.firearms = (n.firearms || 0) + gain;
      }
      if (techId === 'quantum_barcodes') {
        n.civilianGoods = (n.civilianGoods || 0) + 25;
      }
    }
    if (techId === 'civilian_catalog') {
      n.civilianGoods = (n.civilianGoods || 0) + 18;
      n.happiness = Math.min(100, n.happiness + 6);
    }
    if (techId === 'cold_chain_bunkers') {
      n.meatballs += 28;
      n.happiness = Math.min(100, n.happiness + 8);
    }
    if (techId === 'staff_invasion_radar') {
      this.staffInvasionScanTimer = 0;
      this.spawnFloatingText(n.capitalX, n.capitalY - 2.3, 'PA INVASION RADAR ONLINE!', '#38bdf8');
    }
    if (techId === 'repulsor_pylons') {
      for (let li = 0; li < this.lightSourceIndices.length; li++) {
        const lIdx = this.lightSourceIndices[li];
        if (this.propOwner[lIdx] === n.id) this.disabledLightMap[lIdx] = 0;
      }
      this.dirtyLight = true;
    }
    if (techId === 'flatpack_automation') {
      // Reinforce all owned barricades, gates, watchtowers, and tech labs
      for (let i = 0; i < this.prop.length; i++) {
        if (this.propOwner[i] !== n.id) continue;
        const p = this.prop[i];
        if (
          p === PropType.BARRICADE_WALL ||
          p === PropType.BARRICADE_GATE ||
          p === PropType.WATCHTOWER ||
          p === PropType.TECH_LAB
        ) {
          const newMax = Math.round(Math.max(150, this.propMaxHp[i]) * 1.45);
          this.propMaxHp[i] = newMax;
          this.propHp[i] = Math.min(newMax, Math.round(this.propHp[i] * 1.45));
        }
      }
    }
    if (techId === 'blueprint_mastery' || techId === 'kevlar_aprons') {
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
        if (node.branch === 'scp_tech' && (n.techTier >= 2 || (n.jobs?.tinkers || 0) > 0)) s += 5;
        if ((n.government === 'Iron Dictatorship' || n.ideology === 'Iron Fortress') && node.branch === 'military') s += 4;
        if ((n.government === 'Merchant Republic' || n.ideology === 'Merchant Cartel') && node.branch === 'economy') s += 4;
        if ((n.government === 'Meatball Theocracy' || n.government === 'Checkout Democracy') && (node.branch === 'lighting' || node.branch === 'scp_tech')) s += 4;
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

  public getKingdomBuildingSpacing(n: Nation): BuildingSpacing {
    if (n.buildingSpacing) {
      return n.buildingSpacing;
    }
    const pattern = this.getKingdomBuildingPattern(n);
    if (
      pattern === 'Iron Citadel' ||
      n.government === 'Iron Dictatorship' ||
      n.ideology === 'Iron Fortress'
    ) {
      return 'Crowded';
    }
    if (
      pattern === 'Showroom Plaza' ||
      pattern === 'Imperial Concourse' ||
      n.ideology === 'Expansionist Empire'
    ) {
      return 'Spaced';
    }
    return 'Balanced';
  }

  public setNationBuildingSpacing(nationId: number, spacing: BuildingSpacing): boolean {
    const n = this.getNation(nationId);
    if (!n || !n.alive) return false;
    if (n.buildingSpacing === spacing) return true;
    n.buildingSpacing = spacing;
    this.addNews('POLITICS', `${n.name} adopted ${spacing} city building spacing.`);
    this.spawnFloatingText(n.capitalX + 0.5, n.capitalY - 2, `${spacing.toUpperCase()} ZONING!`, '#ffda1a');
    return true;
  }

  private getBuildingCost(prop: PropType, n?: Nation): {
    scrap: number;
    wrenches: number;
    meatballs: number;
    hp: number;
    label: string;
  } {
    const reinforced =
      hasTech(n, 'flatpack_automation') &&
      (prop === PropType.BARRICADE_WALL ||
        prop === PropType.BARRICADE_GATE ||
        prop === PropType.WATCHTOWER ||
        prop === PropType.TECH_LAB);
    const hpMult = reinforced ? 1.45 : 1;
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
      case PropType.TECH_LAB:
        return { scrap: 12, wrenches: 7, meatballs: 0, hp: Math.round(185 * hpMult), label: '+Tech Lab' };
      case PropType.ESCALATOR:
        return { scrap: 14, wrenches: 8, meatballs: 0, hp: Math.round(200 * hpMult), label: '+Escalator Hub' };
      case PropType.SPOTLIGHT:
        return { scrap: 8, wrenches: 0, meatballs: 0, hp: 150, label: '+Spotlight' };
      case PropType.WATCHTOWER:
        return { scrap: 11, wrenches: 3, meatballs: 0, hp: Math.round(190 * hpMult), label: '+Watchtower' };
      case PropType.BARRICADE_GATE:
        return { scrap: 5, wrenches: 0, meatballs: 0, hp: Math.round(145 * hpMult), label: '' };
      default:
        return { scrap: 5, wrenches: 0, meatballs: 0, hp: Math.round(150 * hpMult), label: '' };
    }
  }

  private getKingdomBlueprintLayout(
    n: Nation
  ): Array<{ dx: number; dy: number; prop: PropType; variant?: number }> {
    const pattern = this.getKingdomBuildingPattern(n);
    const spacing = this.getKingdomBuildingSpacing(n);
    const smart = this.smartInfrastructureMode ? 1 : 0;
    const cacheKey = `${pattern}|${spacing}|${smart}`;
    const cached = this.blueprintLayoutCache.get(n.id);
    if (cached && cached.key === cacheKey) {
      return cached.slots;
    }
    const rawInterior: Array<{ dx: number; dy: number; prop: PropType; variant?: number }> = [];

    // 1. Interior districts per architectural style (keeping the 4 cardinal gate boulevards open)
    if (pattern === 'Iron Citadel') {
      rawInterior.push(
        { dx: -4, dy: -3, prop: PropType.WORKSHOP },
        { dx: 4, dy: -3, prop: PropType.WORKSHOP },
        { dx: -4, dy: 3, prop: PropType.BISTRO },
        { dx: 4, dy: 3, prop: PropType.CART_DEPOT },
        { dx: -7, dy: -3, prop: PropType.MATTRESS_HUT },
        { dx: 7, dy: -3, prop: PropType.MATTRESS_HUT },
        { dx: -7, dy: 3, prop: PropType.MATTRESS_HUT },
        { dx: 7, dy: 3, prop: PropType.MATTRESS_HUT },
        { dx: -3, dy: -7, prop: PropType.MATTRESS_HUT },
        { dx: 3, dy: -7, prop: PropType.ARCHIVE },
        { dx: -3, dy: 7, prop: PropType.MATTRESS_HUT },
        { dx: 3, dy: 7, prop: PropType.BISTRO },
        { dx: -6, dy: -2, prop: PropType.SPOTLIGHT },
        { dx: 6, dy: 2, prop: PropType.SPOTLIGHT },
        { dx: 2, dy: -6, prop: PropType.SPOTLIGHT },
        { dx: -2, dy: 6, prop: PropType.SPOTLIGHT }
      );
    } else if (pattern === 'Merchant Bazaar') {
      rawInterior.push(
        { dx: -4, dy: -3, prop: PropType.CART_DEPOT },
        { dx: 4, dy: -3, prop: PropType.CART_DEPOT },
        { dx: -4, dy: 3, prop: PropType.BISTRO },
        { dx: 4, dy: 3, prop: PropType.BISTRO },
        { dx: -7, dy: -3, prop: PropType.MATTRESS_HUT },
        { dx: 7, dy: -3, prop: PropType.MATTRESS_HUT },
        { dx: -7, dy: 3, prop: PropType.MATTRESS_HUT },
        { dx: 7, dy: 3, prop: PropType.MATTRESS_HUT },
        { dx: -3, dy: -6, prop: PropType.WORKSHOP },
        { dx: 3, dy: -6, prop: PropType.ARCHIVE },
        { dx: -3, dy: 6, prop: PropType.WORKSHOP },
        { dx: 3, dy: 6, prop: PropType.ARCHIVE },
        { dx: -2, dy: -5, prop: PropType.SPOTLIGHT },
        { dx: 2, dy: 5, prop: PropType.SPOTLIGHT },
        { dx: -5, dy: 2, prop: PropType.SPOTLIGHT },
        { dx: 5, dy: -2, prop: PropType.SPOTLIGHT }
      );
    } else if (pattern === 'Cathedral Spire') {
      rawInterior.push(
        { dx: -2, dy: -4, prop: PropType.BISTRO },
        { dx: 2, dy: 4, prop: PropType.BISTRO },
        { dx: -4, dy: 2, prop: PropType.BISTRO },
        { dx: 4, dy: -2, prop: PropType.CART_DEPOT },
        { dx: -4, dy: -4, prop: PropType.ARCHIVE },
        { dx: 4, dy: -4, prop: PropType.ARCHIVE },
        { dx: -4, dy: 4, prop: PropType.WORKSHOP },
        { dx: 4, dy: 4, prop: PropType.WORKSHOP },
        { dx: -7, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: 7, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: -7, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: 7, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: 2, dy: -6, prop: PropType.SPOTLIGHT },
        { dx: -2, dy: 6, prop: PropType.SPOTLIGHT },
        { dx: -6, dy: -2, prop: PropType.SPOTLIGHT },
        { dx: 6, dy: 2, prop: PropType.SPOTLIGHT }
      );
    } else if (pattern === 'Imperial Concourse') {
      rawInterior.push(
        { dx: -4, dy: -3, prop: PropType.WORKSHOP },
        { dx: 4, dy: 3, prop: PropType.WORKSHOP },
        { dx: 2, dy: -4, prop: PropType.BISTRO },
        { dx: -4, dy: 3, prop: PropType.CART_DEPOT },
        { dx: -2, dy: 4, prop: PropType.CART_DEPOT },
        { dx: 4, dy: -3, prop: PropType.BISTRO },
        { dx: -3, dy: -7, prop: PropType.ARCHIVE },
        { dx: 3, dy: 7, prop: PropType.ARCHIVE },
        { dx: -7, dy: -2, prop: PropType.MATTRESS_HUT },
        { dx: 7, dy: 2, prop: PropType.MATTRESS_HUT },
        { dx: -6, dy: -6, prop: PropType.MATTRESS_HUT },
        { dx: 6, dy: -6, prop: PropType.MATTRESS_HUT },
        { dx: -6, dy: 6, prop: PropType.MATTRESS_HUT },
        { dx: 6, dy: 6, prop: PropType.MATTRESS_HUT },
        { dx: -4, dy: -2, prop: PropType.SPOTLIGHT },
        { dx: 4, dy: 2, prop: PropType.SPOTLIGHT },
        { dx: 2, dy: -7, prop: PropType.SPOTLIGHT },
        { dx: -2, dy: 7, prop: PropType.SPOTLIGHT }
      );
    } else {
      // Showroom Plaza
      rawInterior.push(
        { dx: -2, dy: -4, prop: PropType.BISTRO },
        { dx: 2, dy: 4, prop: PropType.BISTRO },
        { dx: -4, dy: 2, prop: PropType.ARCHIVE },
        { dx: 4, dy: -2, prop: PropType.CART_DEPOT },
        { dx: -4, dy: -4, prop: PropType.WORKSHOP },
        { dx: 4, dy: 4, prop: PropType.WORKSHOP },
        { dx: 4, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: -4, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: -7, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: 7, dy: -4, prop: PropType.MATTRESS_HUT },
        { dx: -7, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: 7, dy: 4, prop: PropType.MATTRESS_HUT },
        { dx: -3, dy: -7, prop: PropType.SPOTLIGHT },
        { dx: 3, dy: -7, prop: PropType.SPOTLIGHT },
        { dx: -3, dy: 7, prop: PropType.SPOTLIGHT },
        { dx: 3, dy: 7, prop: PropType.SPOTLIGHT }
      );
    }

    const scale = spacing === 'Crowded' ? 0.68 : spacing === 'Spaced' ? 1.32 : 1.0;
    const slots: Array<{ dx: number; dy: number; prop: PropType; variant?: number }> = [];
    const usedCoords = new Set<string>(['0,0', '2,0', '-2,0', '0,2', '0,-2']);

    for (const s of rawInterior) {
      let dx = Math.round(s.dx * scale);
      let dy = Math.round(s.dy * scale);
      if (this.smartInfrastructureMode) {
        if (dx === 0) dx = s.dx >= 0 ? 2 : -2;
        if (dy === 0) dy = s.dy >= 0 ? 2 : -2;
      }
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
        if (Math.abs(dx) >= Math.abs(dy)) dx = dx >= 0 ? 2 : -2;
        else dy = dy >= 0 ? 2 : -2;
      }
      const key = `${dx},${dy}`;
      if (usedCoords.has(key)) continue;
      usedCoords.add(key);
      slots.push({ dx, dy, prop: s.prop, variant: s.variant });
    }

    // Crowded kingdoms pack extra close-quarters infill huts & stalls along inner blocks
    if (spacing === 'Crowded') {
      const infill: Array<{ dx: number; dy: number; prop: PropType }> = [
        { dx: -2, dy: -2, prop: PropType.MATTRESS_HUT },
        { dx: 2, dy: -2, prop: PropType.MATTRESS_HUT },
        { dx: -2, dy: 2, prop: PropType.BISTRO },
        { dx: 2, dy: 2, prop: PropType.WORKSHOP },
        { dx: -5, dy: -2, prop: PropType.MATTRESS_HUT },
        { dx: 5, dy: -2, prop: PropType.MATTRESS_HUT },
        { dx: -2, dy: 5, prop: PropType.MATTRESS_HUT },
        { dx: 2, dy: 5, prop: PropType.CART_DEPOT },
      ];
      for (const inf of infill) {
        const key = `${inf.dx},${inf.dy}`;
        if (!usedCoords.has(key)) {
          usedCoords.add(key);
          slots.push(inf);
        }
      }
    }

    // 2. Capital Citadel Perimeter Barricade with 4 clean cardinal Entrances (always active so the Capital stays fortified!)
    const { radius: R } = this.getCapitalPerimeterInfo(n);

    if (pattern === 'Cathedral Spire' || pattern === 'Imperial Concourse') {
      const diag = Math.max(4, Math.round(R * 0.7));
      const wtCoords = [
        { dx: -diag, dy: -diag },
        { dx: diag, dy: -diag },
        { dx: -diag, dy: diag },
        { dx: diag, dy: diag },
      ];
      const wtSet = new Set(wtCoords.map((c) => `${c.dx},${c.dy}`));
      for (const c of wtCoords) {
        slots.push({ dx: c.dx, dy: c.dy, prop: PropType.WATCHTOWER });
      }
      const wallVariant = pattern === 'Cathedral Spire' ? 1 : 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (wtSet.has(`${dx},${dy}`)) continue;
          const r = Math.hypot(dx, dy);
          if (r >= R - 0.5 && r <= R + 0.45) {
            // 4 cardinal entrances (N, S, E, W)
            const isGate =
              (Math.abs(dx) <= 1 && Math.abs(dy) >= R - 1) ||
              (Math.abs(dy) <= 1 && Math.abs(dx) >= R - 1);
            slots.push({
              dx,
              dy,
              prop: isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL,
              variant: pattern === 'Cathedral Spire' ? ((dx + dy) & 1 ? 1 : 4) : wallVariant,
            });
          }
        }
      }
    } else {
      const vTop = pattern === 'Iron Citadel' ? 4 : pattern === 'Merchant Bazaar' ? 2 : 1;
      const vBot = pattern === 'Iron Citadel' ? 4 : 3;
      slots.push(
        { dx: -R, dy: -R, prop: PropType.WATCHTOWER },
        { dx: R, dy: -R, prop: PropType.WATCHTOWER },
        { dx: -R, dy: R, prop: PropType.WATCHTOWER },
        { dx: R, dy: R, prop: PropType.WATCHTOWER }
      );
      for (let d = -(R - 1); d <= R - 1; d++) {
        // 4 cardinal entrances (North, South, West, East)
        const isGate = Math.abs(d) <= 1;
        slots.push(
          { dx: d, dy: -R, prop: isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: vTop },
          { dx: d, dy: R, prop: isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: vBot },
          { dx: -R, dy: d, prop: isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: vTop },
          { dx: R, dy: d, prop: isGate ? PropType.BARRICADE_GATE : PropType.BARRICADE_WALL, variant: vBot }
        );
      }
    }

    this.blueprintLayoutCache.set(n.id, { key: cacheKey, slots });
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

  private isNearWalkwayOrWall(tx: number, ty: number, checkWalkwayDist: number, checkWallDist: number): boolean {
    const rad = Math.max(checkWalkwayDist, checkWallDist);
    const minY = Math.max(1, ty - rad);
    const maxY = Math.min(GRID_H - 2, ty + rad);
    const minX = Math.max(1, tx - rad);
    const maxX = Math.min(GRID_W - 2, tx + rad);
    for (let y = minY; y <= maxY; y++) {
      const row = y * GRID_W;
      for (let x = minX; x <= maxX; x++) {
        const d = Math.max(Math.abs(x - tx), Math.abs(y - ty));
        const idx = row + x;
        if (d <= checkWalkwayDist && this.biome[idx] === BiomeType.WALKWAY) {
          return true;
        }
        if (
          d <= checkWallDist &&
          (this.prop[idx] === PropType.BARRICADE_WALL || this.prop[idx] === PropType.BARRICADE_GATE)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private pickSmartDistrictProp(
    n: Nation,
    tx: number,
    ty: number,
    idx: number,
    bld: NonNullable<Nation['buildings']>,
    caps: {
      maxHuts: number;
      maxBistros: number;
      maxWorkshops: number;
      maxDepots: number;
      maxArchives: number;
      maxTechLabs: number;
      maxSpotlights: number;
      maxWatchtowers: number;
    }
  ): PropType | null {
    const canBuildLab = hasTech(n, 'swedish_schematics') || n.techTier >= 2;
    const canBuildEscalator =
      hasTech(n, 'maintenance_escalators') ||
      (hasTech(n, 'automated_cart_rails') && n.territoryTiles >= 150);
    const ownedEscalators = this.escalatorIndices.filter((eIdx) => this.propOwner[eIdx] === n.id).length;
    const hasEscalatorNear = this.escalatorIndices.some((eIdx) => {
      if (this.propOwner[eIdx] !== n.id) return false;
      const ex = eIdx % GRID_W;
      const ey = (eIdx / GRID_W) | 0;
      return Math.hypot(ex - tx, ey - ty) < 18;
    });

    // Always illuminate dark pockets first so citizens can safely work and defend outer districts at night
    if (this.lightMap[idx] === 0 && bld.spotlights < caps.maxSpotlights) {
      return PropType.SPOTLIGHT;
    }

    // Score kingdom shortages dynamically rather than building blindly
    let bestProp: PropType | null = null;
    let bestScore = -1;

    if (bld.huts < caps.maxHuts + 2) {
      const housingCrunch = n.population >= n.housingCap - 4 ? 95 : Math.max(15, 55 - (n.housingCap - n.population) * 5);
      if (housingCrunch > bestScore) {
        bestScore = housingCrunch;
        bestProp = PropType.MATTRESS_HUT;
      }
    }

    if (bld.bistros < caps.maxBistros) {
      const meatRatio = n.meatballs / Math.max(1, n.population);
      const foodScore = meatRatio < 1.1 ? 92 : meatRatio < 2.2 ? 62 : 28;
      if (foodScore > bestScore) {
        bestScore = foodScore;
        bestProp = PropType.BISTRO;
      }
    }

    if (canBuildLab && (bld.techLabs ?? 0) < caps.maxTechLabs) {
      const labs = bld.techLabs ?? 0;
      const labScore = labs === 0 ? 90 : n.activeResearchId ? 72 - labs * 12 : 45 - labs * 10;
      if (labScore > bestScore) {
        bestScore = labScore;
        bestProp = PropType.TECH_LAB;
      }
    }

    if (bld.workshops < caps.maxWorkshops) {
      const needWork = n.allenWrenches < 26 || (n.weaponTier ?? 0) >= 1;
      const workshopScore = bld.workshops === 0 ? 84 : needWork ? 66 - bld.workshops * 7 : 34;
      if (workshopScore > bestScore) {
        bestScore = workshopScore;
        bestProp = PropType.WORKSHOP;
      }
    }

    if (bld.depots < caps.maxDepots) {
      const depotScore = bld.depots === 0 ? 74 : 52 - bld.depots * 8;
      if (depotScore > bestScore) {
        bestScore = depotScore;
        bestProp = PropType.CART_DEPOT;
      }
    }

    if (n.techTier >= 2 && bld.archives < caps.maxArchives) {
      const archScore = bld.archives === 0 ? 64 : 46 - bld.archives * 8;
      if (archScore > bestScore) {
        bestScore = archScore;
        bestProp = PropType.ARCHIVE;
      }
    }

    if (canBuildEscalator && ownedEscalators < 4 && !hasEscalatorNear) {
      const distCap = Math.hypot(tx - n.capitalX, ty - n.capitalY);
      const escScore = distCap >= 20 ? 80 : 38;
      if (escScore > bestScore) {
        bestScore = escScore;
        bestProp = PropType.ESCALATOR;
      }
    }

    return bestProp;
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
      maxTechLabs: number;
      maxSpotlights: number;
      maxWatchtowers: number;
    },
    builderId = 0
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
      techLabs: 0,
    };

    const makeCandidate = (tx: number, ty: number, prop: PropType, variant = 0) => {
      const cost = this.getBuildingCost(prop, n);
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

    const spacing = this.getKingdomBuildingSpacing(n);
    const hubScale = spacing === 'Crowded' ? 0.72 : spacing === 'Spaced' ? 1.35 : 1.0;
    const hubClearance = spacing === 'Crowded' ? 1 : spacing === 'Spaced' ? 4 : 3;

    // 1. Develop united city hubs scaled to the kingdom's building spacing
    if (n.unionHubs && n.unionHubs.length > 0) {
      const hubOffsets: Array<{ dx: number; dy: number; prop: PropType }> = [
        { dx: 4, dy: -3, prop: PropType.CART_DEPOT },
        { dx: -4, dy: -3, prop: PropType.BISTRO },
        { dx: -4, dy: 3, prop: PropType.WORKSHOP },
        { dx: 4, dy: 3, prop: PropType.MATTRESS_HUT },
        { dx: -7, dy: 0, prop: PropType.MATTRESS_HUT },
        { dx: 7, dy: 0, prop: PropType.MATTRESS_HUT },
        { dx: 0, dy: -5, prop: PropType.SPOTLIGHT },
        { dx: 0, dy: 5, prop: PropType.SPOTLIGHT },
        { dx: -8, dy: 8, prop: PropType.WATCHTOWER },
        { dx: 8, dy: -8, prop: PropType.WATCHTOWER },
      ];
      for (const hub of n.unionHubs) {
        for (const off of hubOffsets) {
          const tx = hub.x + Math.round(off.dx * hubScale);
          const ty = hub.y + Math.round(off.dy * hubScale);
          if (tx < 2 || tx >= GRID_W - 2 || ty < 2 || ty >= GRID_H - 2) continue;
          if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 2) continue;
          const idx = ty * GRID_W + tx;
          if (this.territory[idx] !== n.id || this.activeBuilderTargets.has(idx)) continue;
          if (this.biome[idx] === BiomeType.WALKWAY) continue;
          const existing = this.prop[idx];
          if (existing !== PropType.NONE && (this.propOwner[idx] === n.id || !this.isDismantlableIkeaProp(existing))) {
            continue;
          }
          if (this.hasOwnedBuildingNear(n.id, tx, ty, hubClearance, false)) continue;
          const cand = makeCandidate(tx, ty, off.prop);
          if (cand.affordable) return cand;
        }
      }
    }

    // Rotate scan center across Capital and Union Hubs so huge/united realms fortify & develop ALL wings
    let scanCenterX = n.capitalX;
    let scanCenterY = n.capitalY;
    if (this.smartInfrastructureMode && n.unionHubs && n.unionHubs.length > 0) {
      const hubSlot = builderId % (n.unionHubs.length + 1);
      if (hubSlot > 0) {
        const hub = n.unionHubs[hubSlot - 1];
        scanCenterX = hub.x;
        scanCenterY = hub.y;
      }
    }

    const scanSpan = n.territoryTiles > 260 ? 94 : 64;
    const minX = Math.max(2, scanCenterX - scanSpan);
    const maxX = Math.min(GRID_W - 3, scanCenterX + scanSpan);
    const minY = Math.max(2, scanCenterY - scanSpan);
    const maxY = Math.min(GRID_H - 3, scanCenterY + scanSpan);

    let fallback: ReturnType<typeof makeCandidate> | null = null;

    // 2. Layer 1: Outer Territory Border Barricades & Watchtowers (contiguous along actual borders!)
    const borderChance = this.smartInfrastructureMode ? 0.66 : 0.52;
    const borderAttempts = this.smartInfrastructureMode ? 145 : 110;
    if (Math.random() < borderChance) {
      let bestBorder: {
        x: number;
        y: number;
        prop: PropType;
        variant: number;
        score: number;
      } | null = null;

      for (let attempt = 0; attempt < borderAttempts; attempt++) {
        const tx = minX + ((Math.random() * (maxX - minX + 1)) | 0);
        const ty = minY + ((Math.random() * (maxY - minY + 1)) | 0);
        if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 2) continue;
        const idx = ty * GRID_W + tx;
        if (this.territory[idx] !== n.id || this.activeBuilderTargets.has(idx)) continue;

        const existing = this.prop[idx];
        if (existing !== PropType.NONE) {
          if (this.propOwner[idx] === n.id || !this.isDismantlableIkeaProp(existing)) continue;
        }

        const nTop = this.territory[idx - GRID_W];
        const nBot = this.territory[idx + GRID_W];
        const nLft = this.territory[idx - 1];
        const nRgt = this.territory[idx + 1];
        if (nTop === n.id && nBot === n.id && nLft === n.id && nRgt === n.id) continue;

        // Check if border touches a friendly or union neighbor
        const nbs = [nTop, nBot, nLft, nRgt];
        let touchesFriendly = false;
        let touchesUnion = false;
        for (const nb of nbs) {
          if (nb >= 0 && nb !== n.id && this.nations[nb]?.alive) {
            if (this.getStance(n.id, nb) === 'UNION') touchesUnion = true;
            if (this.areFriendly(n.id, nb)) touchesFriendly = true;
          }
        }

        const onRoad = this.biome[idx] === BiomeType.WALKWAY;
        if (touchesUnion) {
          // Never build dividing walls or gates across Union borders
          continue;
        } else if (touchesFriendly && !onRoad) {
          // Keep friendly trade/ally borders open rather than sealing friends behind walls
          continue;
        }

        // Prevent boxing in concave notches, union corridors, or narrow seams where own/union land is 3 tiles away on most sides
        let outerFriendlyCount = 0;
        if (ty >= 4 && this.isSameOrUnionTerritory(n.id, this.territory[idx - GRID_W * 3])) outerFriendlyCount++;
        if (ty < GRID_H - 4 && this.isSameOrUnionTerritory(n.id, this.territory[idx + GRID_W * 3])) outerFriendlyCount++;
        if (tx >= 4 && this.isSameOrUnionTerritory(n.id, this.territory[idx - 3])) outerFriendlyCount++;
        if (tx < GRID_W - 4 && this.isSameOrUnionTerritory(n.id, this.territory[idx + 3])) outerFriendlyCount++;
        if (outerFriendlyCount >= 3) continue;

        // Do not place solid walls on buildings or block roads
        if (!onRoad && this.hasOwnedBuildingNear(n.id, tx, ty, 1, false)) continue;

        // Count neighboring walls to extend existing border walls into clean single-tile chains
        let adjWalls = 0;
        let adjGates = 0;
        for (const nIdx of [idx - GRID_W, idx + GRID_W, idx - 1, idx + 1]) {
          if (this.propOwner[nIdx] === n.id) {
            if (this.prop[nIdx] === PropType.BARRICADE_WALL || this.prop[nIdx] === PropType.WATCHTOWER) {
              adjWalls++;
            } else if (this.prop[nIdx] === PropType.BARRICADE_GATE) {
              adjGates++;
            }
          }
        }
        // Avoid thick 2-tile-wide wall clusters
        if (adjWalls >= 3) continue;

        let chosenProp: PropType = PropType.BARRICADE_WALL;
        let variant = 1 + ((tx + ty) % 4);
        const watchtowerGap = spacing === 'Crowded' ? 8 : spacing === 'Spaced' ? 14 : 11;
        if (onRoad) {
          if (adjGates > 0) continue; // Keep adjacent road tiles clean around a gate
          chosenProp = PropType.BARRICADE_GATE;
          variant = 0;
        } else if (
          bld.watchtowers < caps.maxWatchtowers &&
          !this.hasOwnedBuildingNear(n.id, tx, ty, watchtowerGap, true) &&
          (tx + ty) % 5 === 0
        ) {
          chosenProp = PropType.WATCHTOWER;
          variant = 0;
        } else if ((tx + ty) % 10 === 0) {
          chosenProp = PropType.BARRICADE_GATE;
          variant = 0;
        }

        // Prefer extending an existing wall chain (`adjWalls === 1` or `2`) so borders look clean & continuous
        const score = (adjWalls === 1 ? 30 : adjWalls === 2 ? 22 : 6) + (chosenProp === PropType.WATCHTOWER ? 8 : 0);
        if (!bestBorder || score > bestBorder.score) {
          bestBorder = { x: tx, y: ty, prop: chosenProp, variant, score };
        }
      }

      if (bestBorder) {
        const cand = makeCandidate(bestBorder.x, bestBorder.y, bestBorder.prop, bestBorder.variant);
        if (cand.affordable) return cand;
        fallback = cand;
      }
    }

    // 3. Interior Empty Land Districts: spacing depends on kingdom (Crowded: 1-tile alleys, Balanced: 4, Spaced: 5)
    const walkClear = spacing === 'Crowded' ? 0 : spacing === 'Spaced' ? 2 : 1;
    const wallClear = spacing === 'Crowded' ? 1 : 2;
    const interiorGap = spacing === 'Crowded' ? 1 : spacing === 'Spaced' ? 5 : 4;
    const gridStep = spacing === 'Crowded' ? 2 : spacing === 'Spaced' ? 5 : 4;
    const { radius: capR } = this.getCapitalPerimeterInfo(n);

    for (let attempt = 0; attempt < 90; attempt++) {
      let tx = minX + ((Math.random() * (maxX - minX + 1)) | 0);
      let ty = minY + ((Math.random() * (maxY - minY + 1)) | 0);

      // In Smart Infrastructure Mode, snap districts onto tidy avenue-aligned urban blocks
      if (this.smartInfrastructureMode) {
        tx = Math.max(minX, Math.min(maxX, scanCenterX + Math.round((tx - scanCenterX) / gridStep) * gridStep));
        ty = Math.max(minY, Math.min(maxY, scanCenterY + Math.round((ty - scanCenterY) / gridStep) * gridStep));
        // Keep the 4 cardinal boulevards leading through the Capital's 4 entrances clear
        const cdx = Math.abs(tx - n.capitalX);
        const cdy = Math.abs(ty - n.capitalY);
        if (Math.max(cdx, cdy) <= capR + 4 && (cdx <= 1 || cdy <= 1)) {
          continue;
        }
      }

      if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 2) continue;
      const idx = ty * GRID_W + tx;
      if (this.territory[idx] !== n.id || this.activeBuilderTargets.has(idx)) continue;

      const existing = this.prop[idx];
      if (existing !== PropType.NONE) {
        if (this.propOwner[idx] === n.id || !this.isDismantlableIkeaProp(existing)) continue;
      }

      const nTop = this.territory[idx - GRID_W];
      const nBot = this.territory[idx + GRID_W];
      const nLft = this.territory[idx - 1];
      const nRgt = this.territory[idx + 1];
      const isFrontier = nTop !== n.id || nBot !== n.id || nLft !== n.id || nRgt !== n.id;
      if (isFrontier) continue;

      if (this.isNearWalkwayOrWall(tx, ty, walkClear, wallClear)) continue;
      if (this.hasOwnedBuildingNear(n.id, tx, ty, interiorGap, false)) continue;

      let chosenProp: PropType | null = null;
      if (this.smartInfrastructureMode) {
        chosenProp = this.pickSmartDistrictProp(n, tx, ty, idx, bld, caps);
      } else {
        const canBuildLab = hasTech(n, 'swedish_schematics') || n.techTier >= 2;
        const canBuildEscalator =
          hasTech(n, 'maintenance_escalators') ||
          (hasTech(n, 'automated_cart_rails') && n.territoryTiles >= 150);
        const ownedEscalators = this.escalatorIndices.filter((eIdx) => this.propOwner[eIdx] === n.id).length;
        const hasEscalatorNear = this.escalatorIndices.some((eIdx) => {
          if (this.propOwner[eIdx] !== n.id) return false;
          const ex = eIdx % GRID_W;
          const ey = (eIdx / GRID_W) | 0;
          return Math.hypot(ex - tx, ey - ty) < 18;
        });
        if (this.lightMap[idx] === 0 && bld.spotlights < caps.maxSpotlights) {
          chosenProp = PropType.SPOTLIGHT;
        } else if (bld.huts < caps.maxHuts && (n.population >= n.housingCap - 8 || Math.random() < 0.45)) {
          chosenProp = PropType.MATTRESS_HUT;
        } else if (canBuildEscalator && ownedEscalators < 3 && !hasEscalatorNear && Math.random() < 0.25) {
          chosenProp = PropType.ESCALATOR;
        } else if (canBuildLab && (bld.techLabs ?? 0) < caps.maxTechLabs) {
          chosenProp = PropType.TECH_LAB;
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
    builderId: number,
    carryType: Unit['carryType'],
    carryAmount: number,
    builderX?: number,
    builderY?: number
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
      techLabs: 0,
    };

    const spacing = this.getKingdomBuildingSpacing(n);
    const densityMult = spacing === 'Crowded' ? 1.35 : spacing === 'Spaced' ? 0.85 : 1.0;
    const bpClearance = spacing === 'Crowded' ? 1 : spacing === 'Spaced' ? 3 : 2;
    const caps = {
      maxHuts: Math.max(8, Math.floor((n.territoryTiles / 22) * densityMult)),
      maxBistros: Math.max(4, Math.floor((n.territoryTiles / 55) * densityMult)),
      maxWorkshops: Math.max(4, Math.floor((n.territoryTiles / 65) * densityMult)),
      maxDepots: Math.max(3, Math.floor((n.territoryTiles / 75) * densityMult)),
      maxArchives: Math.max(3, Math.floor((n.territoryTiles / 85) * densityMult)),
      maxTechLabs: Math.max(2, Math.floor((n.territoryTiles / 85) * densityMult)),
      maxSpotlights: Math.max(5, Math.floor(n.territoryTiles / 35)),
      maxWatchtowers: Math.max(6, Math.floor(n.territoryTiles / 40)),
    };

    const availScrap = n.scrap + (carryType === 'scrap' ? carryAmount : 0);
    const availWrenches = n.allenWrenches + (carryType === 'wrench' ? carryAmount : 0);
    const availMeatballs = n.meatballs + (carryType === 'meatball' ? carryAmount : 0);

    // Split builder focus cleanly: even builders complete/maintain the 4-gate Capital Citadel while odd builders fortify outer borders & smart districts
    const frontierFirst = this.smartInfrastructureMode
      ? n.territoryTiles >= 65 && (builderId & 1) === 1
      : n.territoryTiles >= 85 && Math.random() < 0.48;

    let cachedEmptySite: ReturnType<typeof this.findEmptyLandBlueprintSite> | undefined;
    if (frontierFirst) {
      cachedEmptySite = this.findEmptyLandBlueprintSite(
        n,
        availScrap,
        availWrenches,
        availMeatballs,
        caps,
        builderId
      );
      if (cachedEmptySite && cachedEmptySite.affordable) return cachedEmptySite;
    }

    type BlueprintCandidate = {
      x: number;
      y: number;
      prop: PropType;
      variant: number;
      affordable: boolean;
      needsScrap: boolean;
      needsWrenches: boolean;
    };
    let firstNeeded: BlueprintCandidate | null = null;
    let bestAffordable: BlueprintCandidate | null = null;
    let bestAffDistSq = 1e9;

    for (const slot of layout) {
      const tx = n.capitalX + slot.dx;
      const ty = n.capitalY + slot.dy;
      if (tx < 2 || tx >= GRID_W - 2 || ty < 2 || ty >= GRID_H - 2) continue;
      if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 2) continue;

      const idx = ty * GRID_W + tx;
      const tileOwner = this.territory[idx];
      const existingProp = this.prop[idx];
      const existingOwner = this.propOwner[idx];

      // Already built by this nation (non-clearable)
      if (existingProp !== PropType.NONE) {
        if (existingOwner === n.id || !this.isDismantlableIkeaProp(existingProp)) {
          continue;
        }
      }
      // Don't stomp another living nation's claimed territory or props
      if (existingOwner >= 0 && existingOwner !== n.id) continue;
      if (tileOwner >= 0 && tileOwner !== n.id && this.nations[tileOwner]?.alive) continue;

      // Never place solid barricade walls on trade walkways; upgrade to gates
      let resolvedProp = slot.prop;
      let resolvedVariant = slot.variant ?? 0;
      if (resolvedProp === PropType.BARRICADE_WALL && this.biome[idx] === BiomeType.WALKWAY) {
        resolvedProp = PropType.BARRICADE_GATE;
        resolvedVariant = 0;
      }

      const isWallOrGate =
        resolvedProp === PropType.BARRICADE_WALL || resolvedProp === PropType.BARRICADE_GATE;
      if (isWallOrGate) {
        // Never wall off a directly adjacent Union or Friendly partner border
        const nbs = [
          this.territory[idx - GRID_W],
          this.territory[idx + GRID_W],
          this.territory[idx - 1],
          this.territory[idx + 1],
        ];
        let blockedByAllyOrUnion = false;
        for (const nb of nbs) {
          if (nb >= 0 && nb !== n.id && this.nations[nb]?.alive) {
            if (this.getStance(n.id, nb) === 'UNION' || this.areFriendly(n.id, nb)) {
              blockedByAllyOrUnion = true;
              break;
            }
          }
        }
        if (blockedByAllyOrUnion) continue;
      } else {
        // Enforce kingdom-specific building spacing for interior buildings
        if (this.hasOwnedBuildingNear(n.id, tx, ty, bpClearance, false)) {
          continue;
        }
      }

      // Soft building caps scaled to territory so kingdoms expand balanced cities across empty land
      if (resolvedProp === PropType.MATTRESS_HUT && bld.huts >= caps.maxHuts && n.population < n.housingCap - 4) continue;
      if (resolvedProp === PropType.BISTRO && bld.bistros >= caps.maxBistros) continue;
      if (resolvedProp === PropType.WORKSHOP && bld.workshops >= caps.maxWorkshops) continue;
      if (resolvedProp === PropType.CART_DEPOT && bld.depots >= caps.maxDepots) continue;
      if (resolvedProp === PropType.ARCHIVE && (n.techTier < 2 || bld.archives >= caps.maxArchives)) continue;
      if (resolvedProp === PropType.SPOTLIGHT && this.lightMap[idx] > 0 && bld.spotlights >= caps.maxSpotlights) continue;
      if (resolvedProp === PropType.WATCHTOWER && bld.watchtowers >= caps.maxWatchtowers && !isWallOrGate) continue;

      // Avoid assigning two builders of the same nation to the same blueprint tile (O(1) lookup)
      if (this.activeBuilderTargets.has(idx)) continue;

      const cost = this.getBuildingCost(resolvedProp, n);
      const affordable =
        availScrap >= cost.scrap &&
        availWrenches >= cost.wrenches &&
        availMeatballs >= cost.meatballs;

      const candidate = {
        x: tx,
        y: ty,
        prop: resolvedProp,
        variant: resolvedVariant,
        affordable,
        needsScrap: availScrap < cost.scrap,
        needsWrenches: availWrenches < cost.wrenches,
      };

      if (affordable) {
        if (builderX === undefined || builderY === undefined) return candidate;
        const dSq = (tx + 0.5 - builderX) * (tx + 0.5 - builderX) + (ty + 0.5 - builderY) * (ty + 0.5 - builderY);
        if (dSq < bestAffDistSq) {
          bestAffDistSq = dSq;
          bestAffordable = candidate;
        }
      } else if (!firstNeeded) {
        firstNeeded = candidate;
      }
    }

    if (bestAffordable) return bestAffordable;

    // Capital blueprint completed or deferred -> expand into outer border barricades & smart districts!
    const emptyLandSite =
      cachedEmptySite !== undefined
        ? cachedEmptySite
        : this.findEmptyLandBlueprintSite(
            n,
            availScrap,
            availWrenches,
            availMeatballs,
            caps,
            builderId
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
    if (
      defeated.capitalX >= 0 &&
      defeated.capitalX < GRID_W &&
      defeated.capitalY >= 0 &&
      defeated.capitalY < GRID_H
    ) {
      const capIdx = defeated.capitalY * GRID_W + defeated.capitalX;
      if (this.prop[capIdx] === PropType.CHECKOUT_FLAG) {
        this.prop[capIdx] = PropType.SPOTLIGHT;
        this.propHp[capIdx] = 150;
        this.propMaxHp[capIdx] = 150;
        this.propOwner[capIdx] = victor.id;
      }
    }
    if (this.chunkStore.size > 0) {
      this.transferNationInChunkStore(defeated.id, victor.id);
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
        if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 1) continue;
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
      this.needsInteriorWallCleanup = true;
      if (this.simTime - this.lastBorderSmoothTime >= 0.75) {
        this.lastBorderSmoothTime = this.simTime;
        this.smoothTerritoryBorders();
      }
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
    const prevHibStats = new Map<
      number,
      {
        armyCount: number;
        armyCap: number;
        jobs: Nation['jobs'];
        buildings: Nation['buildings'];
      }
    >();
    for (const n of this.nations) {
      if ((this.hibernatedNationPop.get(n.id) ?? 0) > 0 || (this.hibernatedNationTerr.get(n.id) ?? 0) > 0) {
        prevHibStats.set(n.id, {
          armyCount: n.armyCount ?? 0,
          armyCap: n.armyCap ?? 0,
          jobs: n.jobs ? { ...n.jobs } : undefined,
          buildings: n.buildings ? { ...n.buildings } : undefined,
        });
      }
      n.territoryTiles = 0;
      n.population = 0;
      n.armyCount = 0;
      n.armyCap = 0;
      n.buildingPattern = this.getKingdomBuildingPattern(n);
      n.buildingSpacing = this.getKingdomBuildingSpacing(n);
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
        techLabs: 0,
      };
    }

    this.nationBuildingsCache.clear();
    this.nationAtWarCache.clear();
    this.nationGeneralCache.clear();
    this.hasAnyActiveWar = false;
    for (const [nid, al] of this.nationBuildingAlert) {
      if (al.until <= this.simTime) this.nationBuildingAlert.delete(nid);
    }
    if (this.unitBlueprintNextTime.size > 400) {
      for (const [uid, t] of this.unitBlueprintNextTime) {
        if (t <= this.simTime) this.unitBlueprintNextTime.delete(uid);
      }
    }
    this.lightSourceIndices = [];
    this.watchtowerIndices = [];
    this.techLabIndices = [];
    this.escalatorIndices = [];

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
      if (p === PropType.TECH_LAB) {
        this.techLabIndices.push(i);
      }
      if (p === PropType.ESCALATOR) {
        this.escalatorIndices.push(i);
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
        else if (p === PropType.TECH_LAB) b.techLabs = (b.techLabs ?? 0) + 1;

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
      if (u.alive && u.nationId >= 0 && u.nationId < this.nations.length && this.isNationCitizen(u)) {
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

      // Add hibernating off-window territory & citizens in Infinite Chunk Store mode
      const hibTerr = this.hibernatedNationTerr.get(n.id) ?? 0;
      const hibPop = this.hibernatedNationPop.get(n.id) ?? 0;
      const activePop = n.population;
      n.territoryTiles += hibTerr;
      n.population += hibPop;
      if (activePop === 0 && hibPop > 0) {
        const prev = prevHibStats.get(n.id);
        if (prev) {
          if (prev.buildings) n.buildings = prev.buildings;
          if (prev.jobs) n.jobs = prev.jobs;
          n.armyCount = prev.armyCount;
          n.armyCap = prev.armyCap;
        }
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

      if (activePop === 0 && hibPop > 0) {
        continue;
      }

      n.armyCap = this.computeArmyCap(n);

      const warEnemies = this.nations.filter(
        (o) => o.alive && o.id !== n.id && this.getStance(n.id, o.id) === 'WAR'
      );
      const atWar = warEnemies.length > 0;
      if (atWar) {
        this.nationAtWarCache.add(n.id);
        this.hasAnyActiveWar = true;
      }

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
          this.nationGeneralCache.set(n.id, general);
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
    const activeSurvivors = this.units.filter((u) => u.alive && this.isNationCitizen(u)).length;

    if (
      this.smartInfrastructureMode &&
      this.needsInteriorWallCleanup &&
      this.simTime - this.lastInteriorCleanupTime >= 6
    ) {
      this.needsInteriorWallCleanup = false;
      this.lastInteriorCleanupTime = this.simTime;
      this.clearInteriorUnionWalls();
    }

    // Optional autonomous wild Staff Kingdom founding if toggle is enabled
    if (this.allowWildStaffKingdoms && this.nations.filter((n) => n.alive).length < 12 && Math.random() < 0.08) {
      const organizer = this.units.find(
        (u) =>
          u.alive &&
          u.nationId === -1 &&
          (u.kind === UnitKind.STAFF_MANAGER || u.kind === UnitKind.STAFF_WARDEN) &&
          Math.hypot(u.x - this.summitLocalX, u.y - this.summitLocalY) > SUMMIT_RADIUS + 6 &&
          this.territory[Math.max(0, Math.min(GRID_W * GRID_H - 1, (u.y | 0) * GRID_W + (u.x | 0)))] === -1
      );
      if (organizer) {
        let nearbyStaff = 0;
        this.spatialHash.queryRadius(this.units, organizer.x, organizer.y, 12, (o) => {
          if (isStaffKind(o.kind) && o.nationId === -1) nearbyStaff++;
        });
        if (nearbyStaff >= 3) {
          this.foundStaffKingdomFromUnit(organizer.id);
        }
      }
    }

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

      // Passive Tax, Gov & IKEA Building Production + Weapons & Civilian Goods Crafting
      const bld = n.buildings;
      const lingonMult = hasTech(n, 'lingonberry_kitchens') ? 1.4 : 1;
      const coldChainMult = hasTech(n, 'cold_chain_bunkers') ? 1.25 : 1;
      const bestArm = this.getNationBestWeapon(n, n.id);
      n.weaponTier = bestArm.tier;
      n.bestWeapon = bestArm.weapon;
      if (n.firearms === undefined) n.firearms = 0;
      if (n.civilianGoods === undefined) n.civilianGoods = 0;

      if (bld) {
        // Meatball Bistros cook meatballs & raise happiness
        if (bld.bistros > 0) {
          n.meatballs += bld.bistros * 0.45 * lingonMult * coldChainMult;
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
        // SCP-IKEA Tech Labs accelerate learning, craft wrenches, and salvage scrap
        if ((bld.techLabs ?? 0) > 0) {
          const labs = bld.techLabs ?? 0;
          n.allenWrenches += labs * 0.55;
          n.scrap += labs * 0.35;
        }
        // Weapons & Firearms Manufacturing (Workshops + Tech Labs)
        if ((bld.workshops > 0 || (bld.techLabs ?? 0) > 0) && bestArm.tier >= 1 && n.scrap >= 1.5) {
          const armRate =
            (bestArm.tier >= 3 ? 0.65 : bestArm.tier === 2 ? 0.5 : 0.35) *
            (1 + Math.min(1.0, ((bld.techLabs ?? 0) + bld.workshops) * 0.2));
          n.scrap = Math.max(0, n.scrap - 0.18);
          n.firearms = Math.min(999, (n.firearms || 0) + armRate);
        }
        // Civilian Goods Crafting (Blåhaj, Flatpack Furniture, Swede-Brew Espresso, Smart Lamps)
        if (bld.bistros > 0 || bld.workshops > 0) {
          const goodsRate = hasTech(n, 'civilian_catalog')
            ? 0.95 + (bld.bistros + bld.workshops) * 0.18
            : 0.25 + (bld.bistros + bld.workshops) * 0.06;
          n.civilianGoods = Math.min(999, (n.civilianGoods || 0) + goodsRate);
        }
      }
      if ((n.civilianGoods || 0) > 0) {
        n.civilianGoods = Math.max(0, (n.civilianGoods || 0) - 0.16);
      }

      // Research Tree progression driven by Tinkers, Billy Archives, SCP-IKEA Tech Labs, and Anomaly Surge
      if (!n.researchedTechs) n.researchedTechs = [];
      if (!n.activeResearchId || n.researchedTechs.includes(n.activeResearchId)) {
        n.activeResearchId = this.pickBestResearchForNation(n);
        n.researchPoints = 0;
      }
      const tinkerCount = n.jobs?.tinkers || 0;
      const archiveCount = bld?.archives || 0;
      const techLabCount = bld?.techLabs ?? 0;
      const govResBonus =
        n.government === 'Checkout Democracy'
          ? 0.45
          : n.government === 'Merchant Republic'
            ? 0.35
            : 0.2;
      const surgeBonus = this.activeAnomaly?.type === 'FLUORESCENT_SURGE' ? 0.6 : 0;
      const learningMult =
        1 +
        surgeBonus +
        (hasTech(n, 'blueprint_mastery') ? 0.3 : 0) +
        (hasTech(n, 'swedish_schematics') ? 0.35 : 0) +
        (hasTech(n, 'fluorescent_capacitor') ? 0.35 : 0) +
        (hasTech(n, 'repulsor_pylons') ? 0.3 : 0) +
        Math.min(0.65, techLabCount * 0.18);
      const rRate =
        (0.55 +
          tinkerCount * 0.55 +
          archiveCount * 0.85 +
          techLabCount * 1.35 +
          (n.techTier - 1) * 0.25 +
          govResBonus) *
        learningMult;
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
      if ((n.civilianGoods || 0) > 2) happyDelta += hasTech(n, 'civilian_catalog') ? 0.65 : 0.3;
      if (this.activeAnomaly?.type === 'ESPRESSO_RUSH') happyDelta += 0.7;
      const unionCount = Object.values(n.relations).filter((r) => r.stance === 'UNION').length;
      if (unionCount > 0) happyDelta += Math.min(1.0, unionCount * 0.4);

      if (n.government === 'Checkout Democracy') happyDelta += 0.6;
      if (n.government === 'Iron Dictatorship') happyDelta -= 0.35;
      if (n.government === 'Meatball Theocracy' && this.isNight) happyDelta += 0.5;

      if (n.taxRate === 'Low') happyDelta += 0.8;
      else if (n.taxRate === 'High') happyDelta -= 0.7;
      else if (n.taxRate === 'War Tax') happyDelta -= 1.5;

      const inWindow = this.isNationInWindow(n);
      if (inWindow) {
        const capIdx = Math.max(0, Math.min(GRID_W * GRID_H - 1, (n.capitalY | 0) * GRID_W + (n.capitalX | 0)));
        if (this.prop[capIdx] === PropType.CHECKOUT_FLAG && this.propOwner[capIdx] === n.id) {
          // Intact Capital Citadel provides administrative prosperity & morale
          n.meatballs += 0.35;
          n.scrap += 0.35;
          n.allenWrenches += 0.25;
          happyDelta += 0.25;
        }
        if (this.lightMap[capIdx]) happyDelta += 0.3;
        else if (this.isNight) happyDelta -= 1.2;
      } else {
        happyDelta += 0.1;
      }

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
      if (inWindow && n.happiness < 20) {
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
        inWindow &&
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
          if (n.species === 'staff') {
            const sk = Math.random() < 0.2 ? UnitKind.STAFF_CRAWLER : Math.random() < 0.35 ? UnitKind.STAFF_WARDEN : UnitKind.STAFF_NORMAL;
            const spawned = this.spawnStaff(sk, sx, sy);
            spawned.nationId = n.id;
            spawned.originNationId = n.id;
            spawned.name = randomName();
            this.applyRoleStats(spawned, n, role);
          } else {
            this.spawnSurvivor(n.id, role, sx, sy);
          }
          n.population += 1;
          currentLive += 1;
          birthsThisTick++;
          this.spawnFloatingText(sx, sy - 1.2, n.species === 'staff' ? '+1 Staff' : '+1 Citizen', '#4ade80');
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
      if (inWindow && n.population >= 2 && Math.random() < 0.38) {
        this.expandFrontierTerritory(n);
      }

      // Overcrowded Colony Split (can also colonize abandoned depopulated territory)
      if (
        inWindow &&
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
      const baseCartCadence = Math.max(4, (n.government === 'Merchant Republic' ? 7 : 12) - depotBonus);
      const cartCadence = hasTech(n, 'megastore_supply_net')
        ? Math.max(2, Math.round(baseCartCadence * 0.5))
        : baseCartCadence;
      if (inWindow && n.cartCooldown <= 0) {
        const unionPartners: Nation[] = [];
        const dayTradePartners: Nation[] = [];
        for (const other of this.nations) {
          if (!other.alive || other.id === n.id || !this.isNationInWindow(other)) continue;
          const st = this.getStance(n.id, other.id);
          if (st === 'UNION') {
            // Union partners run fortified night-safe corridors and trade twice as actively
            unionPartners.push(other);
            dayTradePartners.push(other, other);
          } else if (st === 'TRADE_PACT' || st === 'ALLIANCE') {
            dayTradePartners.push(other);
          }
        }
        const canRunInternalHub = Boolean(n.unionHubs && n.unionHubs.length > 0);
        const canLaunchNow = !this.isNight || unionPartners.length > 0 || canRunInternalHub;
        if (canLaunchNow) {
          n.cartCooldown = this.isNight ? Math.max(cartCadence, 7) : cartCadence;
          if (this.units.length < this.maxPopulation + 120) {
            if (
              canRunInternalHub &&
              ((this.isNight && (unionPartners.length === 0 || Math.random() < 0.5)) ||
                dayTradePartners.length === 0 ||
                Math.random() < 0.4)
            ) {
              const hub = n.unionHubs![(Math.random() * n.unionHubs!.length) | 0];
              if (hub.x >= 2 && hub.x < GRID_W - 2 && hub.y >= 2 && hub.y < GRID_H - 2) {
                this.spawnTradeCart(n, n, { x: hub.x + 0.5, y: hub.y + 0.5, label: hub.name });
              }
            } else if (this.isNight && unionPartners.length > 0) {
              const partner = unionPartners[(Math.random() * unionPartners.length) | 0];
              this.spawnTradeCart(n, partner);
            } else if (!this.isNight && dayTradePartners.length > 0) {
              const partner = dayTradePartners[(Math.random() * dayTradePartners.length) | 0];
              this.spawnTradeCart(n, partner);
            }
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
    const hasRail = hasTech(n, 'heavy_rivet_cannons');
    const hasArc = hasTech(n, 'quantum_barcodes');
    const radarBoost =
      hasTech(n, 'staff_invasion_radar') && this.staffInvasionAlert?.targetNationId === n.id
        ? 1.2
        : 1;
    const range = 10 + n.techTier * 1.5 + (hasRail ? 2 : 0) + (hasArc ? 1 : 0);
    const dmg = Math.round((12 + n.techTier * 5) * (hasRail ? 1.45 : 1) * (hasArc ? 1.25 : 1) * radarBoost);
    for (let wi = 0; wi < this.watchtowerIndices.length; wi++) {
      const idx = this.watchtowerIndices[wi];
      if (this.propOwner[idx] !== n.id || this.prop[idx] !== PropType.WATCHTOWER) continue;
      if (this.disabledLightMap[idx] > 0) continue;
      const tx = idx % GRID_W;
      const ty = (idx / GRID_W) | 0;
      let closest: Unit | null = null;
      let bestDist = range * range;
      this.spatialHash.queryRadius(this.units, tx + 0.5, ty + 0.5, range, (u, _idx, dSq) => {
        const hostileStaff = this.isNight && isStaffKind(u.kind);
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
          vx: (dx / d) * (hasRail ? 30 : hasArc ? 28 : 26),
          vy: (dy / d) * (hasRail ? 30 : hasArc ? 28 : 26),
          damage: dmg,
          nationId: n.id,
          color: hasArc && hasRail ? '#f472b6' : hasArc ? '#e879f9' : hasRail ? '#f97316' : undefined,
          arcChain: hasArc,
          life: 0.75,
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
      (u) => u.alive && u.nationId === n.id && this.isNationCitizen(u) && u.role !== SurvivorRole.LEADER
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

    const claimRoundedPatch = (cx: number, cy: number, radiusOneOnly: boolean) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (radiusOneOnly && Math.abs(dx) + Math.abs(dy) > 1) continue;
          const px = cx + dx;
          const py = cy + dy;
          if (px < 2 || px >= GRID_W - 2 || py < 2 || py >= GRID_H - 2) continue;
          if (Math.hypot(px - this.summitLocalX, py - this.summitLocalY) <= SUMMIT_RADIUS + 1) continue;
          const pIdx = py * GRID_W + px;
          const pOwner = this.territory[pIdx];
          if (pOwner === -1 || (pOwner >= 0 && !this.nations[pOwner]?.alive)) {
            const deadOwner = pOwner >= 0 ? this.getNation(pOwner) : undefined;
            this.territory[pIdx] = n.id;
            if (deadOwner && !deadOwner.alive) {
              if (this.prop[pIdx] === PropType.CHECKOUT_FLAG) {
                this.prop[pIdx] = PropType.SPOTLIGHT;
                this.propHp[pIdx] = 150;
                this.propMaxHp[pIdx] = 150;
              }
              if (this.propOwner[pIdx] === deadOwner.id) {
                this.propOwner[pIdx] = n.id;
              }
              claimedDeadNation = deadOwner;
            }
            claimed++;
          }
        }
      }
    };

    // 1. Cast radial probes outward from capital to advance borders smoothly as rounded patches
    for (let ray = 0; ray < 8 && claimed < 4; ray++) {
      const a = Math.random() * Math.PI * 2;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      let sawOwn = false;

      for (let r = 1; r <= 62; r++) {
        const tx = Math.round(n.capitalX + cosA * r);
        const ty = Math.round(n.capitalY + sinA * r);
        if (tx < 2 || tx >= GRID_W - 2 || ty < 2 || ty >= GRID_H - 2) break;
        if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 1) break;

        const idx = ty * GRID_W + tx;
        const owner = this.territory[idx];
        if (owner === n.id) {
          sawOwn = true;
          continue;
        }
        if (owner === -1 || (owner >= 0 && !this.nations[owner]?.alive)) {
          if (sawOwn) {
            claimRoundedPatch(tx, ty, true);
          }
          break;
        }
        break;
      }
    }

    // 2. Also expand adjacent to existing borders around active citizens (no scattered 1-tile speckles)
    if (claimed === 0) {
      for (let i = 0; i < this.units.length && claimed < 3; i++) {
        const u = this.units[i];
        if (!u.alive || u.nationId !== n.id || u.kind !== UnitKind.SURVIVOR) continue;
        if (Math.random() > 0.25) continue;
        const gx = u.x | 0;
        const gy = u.y | 0;
        if (gx < 2 || gx >= GRID_W - 2 || gy < 2 || gy >= GRID_H - 2) continue;
        if (Math.hypot(gx - this.summitLocalX, gy - this.summitLocalY) <= SUMMIT_RADIUS + 1) continue;
        const idx = gy * GRID_W + gx;
        const owner = this.territory[idx];
        if (owner === -1 || (owner >= 0 && !this.nations[owner]?.alive)) {
          const touchesOwn =
            this.territory[idx - GRID_W] === n.id ||
            this.territory[idx + GRID_W] === n.id ||
            this.territory[idx - 1] === n.id ||
            this.territory[idx + 1] === n.id;
          if (!touchesOwn) continue;
          claimRoundedPatch(gx, gy, true);
        }
      }
    }

    if (claimed > 0) {
      this.smoothTerritoryBorders();
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
    if (Math.hypot(cx - this.summitLocalX, cy - this.summitLocalY) <= SUMMIT_RADIUS + 5) return;

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
          if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 1) continue;
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
      buildingSpacing: parent.buildingSpacing,
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
    this.smoothTerritoryBorders();
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
    rawCy: number,
    allowNearbyOffset = false
  ): boolean {
    if (settlers.length < 2) return false;

    const minCapDist = allowNearbyOffset ? 7.5 : 9;
    let cx = Math.max(8, Math.min(GRID_W - 8, rawCx | 0));
    let cy = Math.max(8, Math.min(GRID_H - 8, rawCy | 0));

    const isValidCapSpot = (tx: number, ty: number) => {
      if (tx < 8 || tx > GRID_W - 8 || ty < 8 || ty > GRID_H - 8) return false;
      if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 4) return false;
      if (this.nations.some((n) => n.alive && Math.hypot(n.capitalX - tx, n.capitalY - ty) < minCapDist)) {
        return false;
      }
      const owner = this.territory[ty * GRID_W + tx];
      return owner < 0 || !this.nations[owner]?.alive;
    };

    if (!isValidCapSpot(cx, cy)) {
      if (!allowNearbyOffset) return false;
      let foundSpot = false;
      for (let rad = 3; rad <= 11 && !foundSpot; rad += 2) {
        for (let step = 0; step < 12; step++) {
          const ang = (step / 12) * Math.PI * 2;
          const candX = Math.round(cx + Math.cos(ang) * rad);
          const candY = Math.round(cy + Math.sin(ang) * rad);
          if (isValidCapSpot(candX, candY)) {
            cx = candX;
            cy = candY;
            foundSpot = true;
            break;
          }
        }
      }
      if (!foundSpot) return false;
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
        if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 1) continue;
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
    this.smoothTerritoryBorders();

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
      buildingSpacing: (['Crowded', 'Balanced', 'Spaced'] as BuildingSpacing[])[nid % 3],
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
      (u) => u.alive && u.nationId === n.id && this.isNationCitizen(u)
    );
    if (candidates.length === 0) {
      // Never spawn a zombie leader out of thin air when no living citizens remain
      n.leader.alive = false;
      return;
    }

    const chosen = candidates[(Math.random() * candidates.length) | 0];
    this.applyRoleStats(chosen, n, SurvivorRole.LEADER);
    chosen.hp = chosen.maxHp;

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

  public foundStaffKingdomFromUnit(unitId: number): { ok: boolean; nation?: Nation; error?: string } {
    const founder = this.units.find((u) => u.id === unitId && u.alive);
    if (!founder || !isStaffKind(founder.kind)) {
      return { ok: false, error: 'Selected entity is not an SCP-3008-2 Staff unit.' };
    }
    if (founder.nationId >= 0) {
      return { ok: false, error: 'This Staff unit already belongs to a realm!' };
    }

    let cx = Math.max(8, Math.min(GRID_W - 8, founder.x | 0));
    let cy = Math.max(8, Math.min(GRID_H - 8, founder.y | 0));
    const isSpotClear = (tx: number, ty: number) => {
      if (tx < 8 || tx > GRID_W - 8 || ty < 8 || ty > GRID_H - 8) return false;
      if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 4) return false;
      if (this.nations.some((n) => n.alive && Math.hypot(n.capitalX - tx, n.capitalY - ty) < 8)) return false;
      const owner = this.territory[ty * GRID_W + tx];
      return owner < 0 || !this.nations[owner]?.alive;
    };

    if (!isSpotClear(cx, cy)) {
      let found = false;
      for (let rad = 3; rad <= 16 && !found; rad += 2) {
        for (let step = 0; step < 12; step++) {
          const ang = (step / 12) * Math.PI * 2;
          const candX = Math.round(cx + Math.cos(ang) * rad);
          const candY = Math.round(cy + Math.sin(ang) * rad);
          if (isSpotClear(candX, candY)) {
            cx = candX;
            cy = candY;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        return { ok: false, error: 'Too close to existing capitals or Summit Lounge.' };
      }
    }

    const usedNames = new Set(this.nations.map((n) => n.name));
    const unusedPal = NATION_PALETTE.filter((p) => !this.nations.some((n) => n.alive && n.color === p.color));
    const pal = unusedPal[0] ?? {
      name: 'Staff Syndicate',
      color: '#eab308',
      border: '#a16207',
      rgb: [234, 179, 8] as [number, number, number],
      borderRgb: [161, 98, 7] as [number, number, number],
    };
    const pickedName =
      STAFF_KINGDOM_NAMES.find((n) => !usedNames.has(n)) ??
      `Staff Conclave ${this.nextNationId + 1}`;
    const nid = this.nextNationId++;

    let claimedTiles = 0;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy > 18) continue;
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx <= 1 || tx >= GRID_W - 1 || ty <= 1 || ty >= GRID_H - 1) continue;
        if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 1) continue;
        const idx = ty * GRID_W + tx;
        const owner = this.territory[idx];
        if (owner >= 0 && this.nations[owner]?.alive) continue;
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
          this.prop[idx] = PropType.NONE;
          this.propOwner[idx] = -1;
        }
        this.territory[idx] = nid;
        claimedTiles++;
      }
    }

    if (claimedTiles < 6) {
      for (let i = 0; i < this.territory.length; i++) {
        if (this.territory[i] === nid) this.territory[i] = -1;
      }
      this.nextNationId--;
      return { ok: false, error: 'Insufficient open floor space to claim a Staff Kingdom.' };
    }

    this.placeNationProp(cx, cy, PropType.CHECKOUT_FLAG, 380, nid);
    this.territory[cy * GRID_W + cx] = nid;
    if (this.territory[cy * GRID_W + (cx + 2)] === nid) {
      this.placeNationProp(cx + 2, cy, PropType.SPOTLIGHT, 160, nid);
    }
    this.smoothTerritoryBorders();

    const recruits: Unit[] = [founder];
    this.spatialHash.queryRadius(this.units, founder.x, founder.y, 14, (other) => {
      if (recruits.length < 10 && other.id !== founder.id && other.alive && isStaffKind(other.kind) && other.nationId === -1) {
        recruits.push(other);
      }
    });
    while (recruits.length < 5) {
      const att = this.spawnStaff(
        recruits.length === 1 ? UnitKind.STAFF_WARDEN : UnitKind.STAFF_NORMAL,
        cx + (Math.random() - 0.5) * 3,
        cy + (Math.random() - 0.5) * 3
      );
      recruits.push(att);
    }

    const gov = GOVERNMENTS[nid % GOVERNMENTS.length];
    const ideology = IDEOLOGIES[nid % IDEOLOGIES.length];
    founder.name = `Director ${randomName().split(' ')[0]}`;
    founder.age = 34;
    if (!founder.traits.includes('Tough')) founder.traits.push('Tough');

    const staffNation: Nation = {
      id: nid,
      name: pickedName,
      species: 'staff',
      color: pal.color,
      borderColor: pal.border,
      capitalX: cx,
      capitalY: cy,
      meatballs: 36,
      scrap: 38,
      allenWrenches: 22,
      firearms: 4,
      civilianGoods: 6,
      techTier: 1,
      population: recruits.length,
      housingCap: 20,
      territoryTiles: claimedTiles,
      ideology,
      government: gov,
      taxRate: 'Normal',
      happiness: 84,
      lowHappinessTimer: 0,
      warExhaustion: 0,
      threatScore: 0,
      overlordId: null,
      vassalIds: [],
      loyalty: 100,
      leader: {
        unitId: founder.id,
        name: founder.name,
        age: founder.age,
        traits: [...founder.traits],
        alive: true,
        crownedDay: this.day,
        kills: founder.kills,
      },
      recentCoupDay: -10,
      isRebel: false,
      lastQuote: `The store is ours! ${pickedName} welcomes disciplined Staff and trade!`,
      relations: {},
      alive: true,
      foundedDay: this.day,
      sabotageCooldown: 6,
      cartCooldown: 6,
      buildingSpacing: 'Balanced',
      researchedTechs: [],
      activeResearchId: null,
      researchPoints: 0,
      researchRate: 0,
      reproductionProgress: 0,
      reproductionRate: 0,
    };

    const staffRoles: SurvivorRole[] = [
      SurvivorRole.SCAVENGER,
      SurvivorRole.BUILDER,
      SurvivorRole.GUARD,
      SurvivorRole.TINKER,
      SurvivorRole.CHEF,
      SurvivorRole.TRADER,
    ];
    for (let i = 0; i < recruits.length; i++) {
      const r = recruits[i];
      r.nationId = nid;
      r.originNationId = nid;
      r.pacified = true;
      r.hasTarget = false;
      if (i > 0 && r.name.startsWith('SCP-3008-2')) {
        r.name = `Staff ${randomName().split(' ')[0]}`;
      }
      const role = i === 0 ? SurvivorRole.LEADER : staffRoles[(i - 1) % staffRoles.length];
      this.applyRoleStats(r, staffNation, role);
    }

    this.nations.push(staffNation);
    for (const o of this.nations) {
      if (o.id !== nid) this.setRelation(nid, o.id, 'NEUTRAL');
    }

    this.dirtyMap = true;
    this.dirtyLight = true;
    this.forceMapRebuild = true;
    this.forceLightRebuild = true;
    this.recountTerritoryAndHousing();
    this.addNews('FOUNDING', `STAFF REALM CHARTERED: ${pickedName} (${gov}) organized by ${founder.name}!`);
    this.addChronicle(
      'FOUNDING',
      `${pickedName} Staff Kingdom`,
      `SCP-3008-2 Staff founded ${pickedName} on Day ${this.day} under ${founder.name}.`,
      pal.color
    );
    this.spawnFloatingText(cx + 0.5, cy - 1.5, `STAFF REALM: ${pickedName.toUpperCase()}!`, pal.color);
    this.spawnParticleBurst(cx + 0.5, cy + 0.5, pal.color, 20);
    soundFX.playPower();
    return { ok: true, nation: staffNation };
  }

  public giveUnitGift(
    unitId: number,
    action:
      | 'bless'
      | 'rifle'
      | 'plasma'
      | 'rail_cannon'
      | 'arc_caster'
      | 'pacify'
      | 'promote_warden'
      | 'promote_manager'
      | 'promote_forklift'
      | 'promote_director'
      | 'charter_human'
      | 'charter_staff'
  ): { ok: boolean; message: string } {
    const u = this.units.find((cand) => cand.id === unitId && cand.alive);
    if (!u) return { ok: false, message: 'Unit is no longer alive.' };

    if (action === 'charter_staff') {
      const res = this.foundStaffKingdomFromUnit(unitId);
      return { ok: res.ok, message: res.ok ? `Founded ${res.nation?.name}!` : res.error || 'Could not found realm.' };
    }
    if (action === 'charter_human') {
      if (u.kind !== UnitKind.SURVIVOR || u.nationId >= 0) {
        return { ok: false, message: 'Only unclaimed Survivors can charter a new Human Kingdom.' };
      }
      const group: Unit[] = [u];
      this.spatialHash.queryRadius(this.units, u.x, u.y, 12, (o) => {
        if (group.length < 6 && o.id !== u.id && o.alive && o.kind === UnitKind.SURVIVOR && o.nationId === -1) {
          group.push(o);
        }
      });
      while (group.length < 4) {
        group.push(
          this.spawnSurvivor(-1, SurvivorRole.SCAVENGER, u.x + (Math.random() - 0.5) * 2.5, u.y + (Math.random() - 0.5) * 2.5)
        );
      }
      const ok = this.foundIndependentKingdomFromSettlers(group, u.x, u.y, true);
      return { ok, message: ok ? 'Chartered new Human Kingdom!' : 'Spot too crowded to found kingdom here.' };
    }
    if (action === 'pacify') {
      u.pacified = !u.pacified;
      u.hasTarget = false;
      this.spawnParticleBurst(u.x, u.y, u.pacified ? '#34d399' : '#ef4444', 8);
      this.spawnFloatingText(u.x, u.y - 1, u.pacified ? 'TAMED STAFF!' : 'FERAL!', u.pacified ? '#34d399' : '#ef4444');
      return { ok: true, message: u.pacified ? 'Staff entity tamed & pacified!' : 'Staff entity returned to feral.' };
    }
    if (
      action === 'promote_warden' ||
      action === 'promote_manager' ||
      action === 'promote_forklift' ||
      action === 'promote_director'
    ) {
      if (!isStaffKind(u.kind)) return { ok: false, message: 'Only Staff can be mutated.' };
      u.kind =
        action === 'promote_director'
          ? UnitKind.STAFF_DIRECTOR
          : action === 'promote_manager'
            ? UnitKind.STAFF_MANAGER
            : action === 'promote_forklift'
              ? UnitKind.STAFF_FORKLIFT
              : UnitKind.STAFF_WARDEN;
      const bonusHp =
        action === 'promote_director'
          ? 760
          : action === 'promote_manager'
            ? 360
            : action === 'promote_forklift'
              ? 280
              : 160;
      u.maxHp = Math.max(u.maxHp, bonusHp);
      u.hp = u.maxHp;
      u.atk +=
        action === 'promote_director'
          ? 18
          : action === 'promote_manager'
            ? 12
            : action === 'promote_forklift'
              ? 10
              : 6;
      if (u.nationId === -1) {
        u.name =
          action === 'promote_director'
            ? 'SCP-3008-2 Store Director'
            : action === 'promote_manager'
              ? 'SCP-3008-2 Manager Brute'
              : action === 'promote_forklift'
                ? 'SCP-3008-2 Forklift Juggernaut'
                : 'SCP-3008-2 Aisle Warden';
      }
      if (action === 'promote_director') u.veteranTitle = 'Mega-Showroom Boss';
      this.spawnParticleBurst(u.x, u.y, action === 'promote_director' ? '#f43f5e' : '#fbbf24', 12);
      this.spawnFloatingText(
        u.x,
        u.y - 1.2,
        action === 'promote_director'
          ? 'BOSS: STORE DIRECTOR!'
          : action === 'promote_manager'
            ? 'PROMOTED: MANAGER!'
            : action === 'promote_forklift'
              ? 'FORKLIFT JUGGERNAUT!'
              : 'PROMOTED: WARDEN!',
        action === 'promote_director' ? '#f43f5e' : '#fbbf24'
      );
      return { ok: true, message: `Evolved into ${u.name}!` };
    }
    if (action === 'rifle' || action === 'plasma' || action === 'rail_cannon' || action === 'arc_caster') {
      const w: WeaponType =
        action === 'arc_caster'
          ? 'arc_caster'
          : action === 'rail_cannon'
            ? 'rail_cannon'
            : action === 'plasma'
              ? 'plasma_stapler'
              : 'halogen_rifle';
      u.weapon = w;
      u.atk += action === 'arc_caster' ? 15 : action === 'rail_cannon' ? 13 : action === 'plasma' ? 11 : 8;
      u.heroRelic =
        action === 'arc_caster'
          ? 'Arc-Barcode Caster'
          : action === 'rail_cannon'
            ? 'Rail-Nail Cannon'
            : action === 'plasma'
              ? 'Arc Plasma Stapler'
              : 'Halogen Beam Rifle';
      this.spawnParticleBurst(u.x, u.y, action === 'arc_caster' ? '#e879f9' : '#22d3ee', 10);
      this.spawnFloatingText(
        u.x,
        u.y - 1.2,
        action === 'arc_caster'
          ? '⚡ ARC-BARCODE CASTER!'
          : action === 'rail_cannon'
            ? '🔩 RAIL-NAIL CANNON!'
            : action === 'plasma'
              ? '⚡ PLASMA STAPLER!'
              : '🔫 HALOGEN RIFLE!',
        action === 'arc_caster' ? '#e879f9' : '#22d3ee'
      );
      return { ok: true, message: `Equipped ${u.heroRelic}!` };
    }
    // Bless
    if (!u.traits.includes('Blessed')) u.traits.push('Blessed');
    u.maxHp += 50;
    u.hp = u.maxHp;
    u.atk += 7;
    u.heroRelic = u.heroRelic || 'Fluorescent Halo';
    this.spawnParticleBurst(u.x, u.y, '#38bdf8', 12);
    this.spawnFloatingText(u.x, u.y - 1.2, '★ DIVINE BLESSING!', '#38bdf8');
    soundFX.playPower();
    return { ok: true, message: `${u.name} received a Divine Blessing!` };
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

    const bestSpawnWeapon =
      n && (isGuard || isGeneral || isLeader || role === SurvivorRole.TINKER)
        ? this.getNationBestWeapon(n, this.nextUnitId).weapon
        : ('none' as WeaponType);

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
      weapon: bestSpawnWeapon !== 'none' ? bestSpawnWeapon : undefined,
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

    const routeWaypoints =
      !customDest && origin.id !== dest.id
        ? [...this.buildTradeWaypoints(origin, dest).slice(1, -1), { x: tx, y: ty }]
        : undefined;
    const firstTarget = routeWaypoints && routeWaypoints.length > 0 ? routeWaypoints[0] : { x: tx, y: ty };

    const isUnionCart = origin.id === dest.id || this.getStance(origin.id, dest.id) === 'UNION';
    const u: Unit = {
      id: this.nextUnitId++,
      kind: UnitKind.CART_RUNNER,
      role: SurvivorRole.TRADER,
      nationId: origin.id,
      x: sx,
      y: sy,
      vx: 0,
      vy: 0,
      hp: isUnionCart ? 165 : 85,
      maxHp: isUnionCart ? 165 : 85,
      atk: isUnionCart ? 8 : 4,
      speed: isUnionCart ? 5.4 : 5.0,
      name: `${isUnionCart ? 'Union Cart' : 'Cart Runner'} ${randomName().split(' ')[0]}`,
      age: 24,
      kills: 0,
      hunger: 5,
      traits: isUnionCart ? ['Speedy', 'Tough'] : ['Speedy'],
      carryType: 'wrench',
      carryAmount: isUnionCart ? 16 : 12,
      targetNationId: dest.id,
      originNationId: origin.id,
      targetX: firstTarget.x,
      targetY: firstTarget.y,
      routeWaypoints,
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

  public spawnStaff(
    kind:
      | UnitKind.STAFF_NORMAL
      | UnitKind.STAFF_CRAWLER
      | UnitKind.STAFF_MANAGER
      | UnitKind.STAFF_WARDEN
      | UnitKind.STAFF_STALKER
      | UnitKind.STAFF_ANNOUNCER
      | UnitKind.STAFF_FORKLIFT
      | UnitKind.STAFF_THROWER
      | UnitKind.STAFF_DISRUPTOR
      | UnitKind.STAFF_DIRECTOR,
    x: number,
    y: number
  ): Unit {
    const hpScale = 1 + (this.day - 1) * 0.12;
    let baseHp = 105;
    let atk = 14;
    let speed = 4.6;
    let name = 'SCP-3008-2 Staff';

    if (kind === UnitKind.STAFF_DIRECTOR) {
      baseHp = 760;
      atk = 32;
      speed = 3.7;
      name = 'SCP-3008-2 Store Director';
    } else if (kind === UnitKind.STAFF_MANAGER) {
      baseHp = 420;
      atk = 26;
      speed = 3.5;
      name = 'SCP-3008-2 Manager Brute';
    } else if (kind === UnitKind.STAFF_FORKLIFT) {
      baseHp = 310;
      atk = 22;
      speed = 4.3;
      name = 'SCP-3008-2 Forklift Juggernaut';
    } else if (kind === UnitKind.STAFF_THROWER) {
      baseHp = 125;
      atk = 15;
      speed = 4.1;
      name = 'SCP-3008-2 Shelf Quartermaster';
    } else if (kind === UnitKind.STAFF_DISRUPTOR) {
      baseHp = 115;
      atk = 14;
      speed = 5.6;
      name = 'SCP-3008-2 Barcode Scanner';
    } else if (kind === UnitKind.STAFF_CRAWLER) {
      baseHp = 65;
      atk = 10;
      speed = 6.4;
      name = 'SCP-3008-2 Crawler';
    } else if (kind === UnitKind.STAFF_WARDEN) {
      baseHp = 210;
      atk = 19;
      speed = 3.9;
      name = 'SCP-3008-2 Aisle Warden';
    } else if (kind === UnitKind.STAFF_STALKER) {
      baseHp = 85;
      atk = 17;
      speed = 6.8;
      name = 'SCP-3008-2 Blackout Stalker';
    } else if (kind === UnitKind.STAFF_ANNOUNCER) {
      baseHp = 135;
      atk = 13;
      speed = 4.5;
      name = 'SCP-3008-2 PA Hound';
    }

    const maxHp = Math.round(baseHp * hpScale);
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
      atk,
      speed,
      name,
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

  public triggerStoreAnomaly(forcedType?: StoreAnomalyType): ActiveAnomaly {
    const types: StoreAnomalyType[] = [
      'FLUORESCENT_SURGE',
      'AISLE_FOG',
      'CLEARANCE_STAMPEDE',
      'ESPRESSO_RUSH',
    ];
    const picked = forcedType ?? types[(Math.random() * types.length) | 0];
    const defs: Record<StoreAnomalyType, Omit<ActiveAnomaly, 'type'>> = {
      FLUORESCENT_SURGE: {
        label: 'Fluorescent Surge',
        description: '+60% Tech Lab & Archive research speed across all kingdoms.',
        remainingSec: 36,
        color: '#38bdf8',
      },
      AISLE_FOG: {
        label: 'Showroom Mist',
        description: 'Eerie fluorescent fog fills the aisles; Staff move +15% faster.',
        remainingSec: 32,
        color: '#94a3b8',
      },
      CLEARANCE_STAMPEDE: {
        label: 'Clearance Stampede',
        description: 'Fresh Meatball Vats & Pallets dropped across neutral aisles + +22% unit speed.',
        remainingSec: 30,
        color: '#ffda1a',
      },
      ESPRESSO_RUSH: {
        label: 'Swede-Brew Espresso Rush',
        description: '+32% citizen move speed & steady morale boost storewide!',
        remainingSec: 32,
        color: '#fbbf24',
      },
    };
    const meta = defs[picked];
    this.activeAnomaly = { type: picked, ...meta };

    if (picked === 'CLEARANCE_STAMPEDE') {
      let dropped = 0;
      for (let attempt = 0; attempt < 90 && dropped < 22; attempt++) {
        const tx = 8 + ((Math.random() * (GRID_W - 16)) | 0);
        const ty = 8 + ((Math.random() * (GRID_H - 16)) | 0);
        if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 4) continue;
        const idx = ty * GRID_W + tx;
        if (this.territory[idx] === -1 && this.prop[idx] === PropType.NONE) {
          const vat = Math.random() < 0.5;
          this.prop[idx] = vat ? PropType.MEATBALL_VAT : PropType.WOOD_PALLET;
          this.propHp[idx] = vat ? 120 : 80;
          this.propMaxHp[idx] = vat ? 120 : 80;
          this.propOwner[idx] = -1;
          dropped++;
        }
      }
    }

    this.addNews('STAFF', `STORE ANOMALY: ${meta.label} — ${meta.description}`);
    this.addChronicle('AUDIT', `Anomaly: ${meta.label}`, meta.description, meta.color);
    soundFX.playPower();
    return this.activeAnomaly;
  }

  private tickAmbientCaravansAndMercs(): void {
    if (this.units.length >= this.maxPopulation + 100) return;
    const aliveNations = this.nations.filter((n) => n.alive);
    if (aliveNations.length === 0) return;
    let caravans = 0;
    let mercs = 0;
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.isCaravan) caravans++;
      if (u.isMercenary) mercs++;
    }
    if (caravans < 3 && !this.isNight) {
      const n = aliveNations[(Math.random() * aliveNations.length) | 0];
      const angle = Math.random() * Math.PI * 2;
      const sx = Math.max(6, Math.min(GRID_W - 6, n.capitalX + Math.cos(angle) * 18));
      const sy = Math.max(6, Math.min(GRID_H - 6, n.capitalY + Math.sin(angle) * 18));
      this.spawnCaravan(sx, sy);
    }
    if (mercs < 4) {
      const tx = 14 + ((Math.random() * (GRID_W - 28)) | 0);
      const ty = 14 + ((Math.random() * (GRID_H - 28)) | 0);
      if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) > SUMMIT_RADIUS + 6) {
        this.spawnMercenary(tx + 0.5, ty + 0.5);
      }
    }
  }

  public spawnCaravan(x: number, y: number): Unit {
    const aliveNations = this.nations.filter((n) => n.alive);
    const dest = aliveNations.length > 0 ? aliveNations[(Math.random() * aliveNations.length) | 0] : undefined;
    const u: Unit = {
      id: this.nextUnitId++,
      kind: UnitKind.CART_RUNNER,
      role: SurvivorRole.TRADER,
      nationId: -1,
      x: Math.max(2, Math.min(GRID_W - 2, x)),
      y: Math.max(2, Math.min(GRID_H - 2, y)),
      vx: 0,
      vy: 0,
      hp: 150,
      maxHp: 150,
      atk: 8,
      speed: 4.8,
      name: `Wandering Caravan ${randomName().split(' ')[0]}`,
      age: 32,
      kills: 0,
      hunger: 0,
      traits: ['Speedy', 'Hoarder'],
      carryType: 'wrench',
      carryAmount: 18,
      targetNationId: dest ? dest.id : -1,
      originNationId: -1,
      targetX: dest ? dest.capitalX + 0.5 : x,
      targetY: dest ? dest.capitalY + 0.5 : y,
      hasTarget: Boolean(dest),
      stuckTimer: 0,
      lastCheckX: x,
      lastCheckY: y,
      attackCooldown: 0,
      hitFlash: 0,
      feverTimer: 0,
      aiTimer: 0,
      chatEmoji: '🐫',
      chatTimer: 2.5,
      isCaravan: true,
      alive: true,
    };
    this.units.push(u);
    this.spawnFloatingText(x, y - 1, 'TRADE CARAVAN!', '#fbbf24');
    return u;
  }

  public spawnMercenary(x: number, y: number): Unit {
    const u: Unit = {
      id: this.nextUnitId++,
      kind: UnitKind.SURVIVOR,
      role: SurvivorRole.GUARD,
      nationId: -1,
      x: Math.max(2, Math.min(GRID_W - 2, x)),
      y: Math.max(2, Math.min(GRID_H - 2, y)),
      vx: 0,
      vy: 0,
      hp: 155,
      maxHp: 155,
      atk: 17,
      speed: 5.0,
      name: `Merc. ${randomName()}`,
      age: 29,
      kills: 0,
      hunger: 0,
      traits: ['Brave', 'Tough'],
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
      aiTimer: 0,
      chatEmoji: '🗡️',
      chatTimer: 2.2,
      weapon: 'nailgun',
      veteranTitle: 'Free-Aisle Mercenary',
      isMercenary: true,
      alive: true,
    };
    this.units.push(u);
    this.spawnFloatingText(x, y - 1, 'MERCENARY HIREABLE!', '#a855f7');
    return u;
  }

  private spawnNightStaffWave(): void {
    const staffCount = this.units.filter((u) => u.alive && isStaffKind(u.kind) && u.nationId === -1).length;
    const maxStaff = Math.min(180 + this.day * 28, (this.maxPopulation * 0.25) | 0);
    if (staffCount >= maxStaff) return;

    // Fair spawning rule: NEVER inside lit Spotlight/Watchtower/Flag radiuses
    for (let attempt = 0; attempt < 18; attempt++) {
      const tx = 4 + ((Math.random() * (GRID_W - 8)) | 0);
      const ty = 4 + ((Math.random() * (GRID_H - 8)) | 0);
      const idx = ty * GRID_W + tx;
      if (this.lightMap[idx] === 0 && this.prop[idx] === PropType.NONE) {
        const roll = Math.random();
        let kind:
          | UnitKind.STAFF_NORMAL
          | UnitKind.STAFF_CRAWLER
          | UnitKind.STAFF_MANAGER
          | UnitKind.STAFF_WARDEN
          | UnitKind.STAFF_STALKER
          | UnitKind.STAFF_ANNOUNCER
          | UnitKind.STAFF_FORKLIFT
          | UnitKind.STAFF_THROWER
          | UnitKind.STAFF_DISRUPTOR
          | UnitKind.STAFF_DIRECTOR = UnitKind.STAFF_NORMAL;
        if (this.day >= 5 && roll < 0.05) kind = UnitKind.STAFF_FORKLIFT;
        else if (this.day >= 4 && roll < 0.10) kind = UnitKind.STAFF_DISRUPTOR;
        else if (this.day >= 4 && roll < 0.16) kind = UnitKind.STAFF_ANNOUNCER;
        else if (this.day >= 3 && roll < 0.23) kind = UnitKind.STAFF_THROWER;
        else if (this.day >= 3 && roll < 0.29) kind = UnitKind.STAFF_MANAGER;
        else if (this.day >= 3 && roll < 0.37) kind = UnitKind.STAFF_STALKER;
        else if (this.day >= 2 && roll < 0.48) kind = UnitKind.STAFF_WARDEN;
        else if (roll < 0.66) kind = UnitKind.STAFF_CRAWLER;

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
    if ((u.teleportCooldown ?? 0) > 0) u.teleportCooldown = Math.max(0, (u.teleportCooldown ?? 0) - dt);
    if (u.chatTimer > 0) {
      u.chatTimer = Math.max(0, u.chatTimer - dt);
      if (u.chatTimer === 0) u.chatEmoji = '';
    }

    // Active building occupancy (resting in huts, cooking in bistros, crafting in workshops, etc.)
    if ((u.insideTimer ?? 0) > 0) {
      const bIdx = u.insideBuildingIdx ?? -1;
      const nation = u.nationId >= 0 ? this.getNation(u.nationId) : undefined;
      const propType = bIdx >= 0 && bIdx < GRID_W * GRID_H ? this.prop[bIdx] : PropType.NONE;
      let validBuilding =
        Boolean(nation && nation.alive) &&
        bIdx >= 0 &&
        this.propOwner[bIdx] === u.nationId &&
        this.isEnterableBuilding(propType) &&
        !(u.role === SurvivorRole.GUARD && nation?.battlePlan);

      // Guards exit sheltered towers/buildings right away if their kingdom has an active building distress alert
      if (validBuilding && u.role === SurvivorRole.GUARD && nation) {
        const alert = this.nationBuildingAlert.get(nation.id);
        if (alert && alert.until > this.simTime) {
          validBuilding = false;
        }
      }

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
          } else if (propType === PropType.TECH_LAB) {
            if (nation) {
              const schemMult = hasTech(nation, 'swedish_schematics') ? 1.4 : 1.0;
              nation.allenWrenches += 2.2 * schemMult;
              nation.scrap += 2.0 * schemMult;
              if (nation.activeResearchId) {
                nation.researchPoints = (nation.researchPoints || 0) + 3.0 * schemMult;
              }
            }
            u.chatEmoji = '🔬';
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

    // Hunger & Food consumption for nation citizens (human & Staff citizens)
    if (this.isNationCitizen(u)) {
      u.hunger = Math.min(100, u.hunger + dt * 0.7);
      if (u.hunger > 55 && u.nationId >= 0) {
        const n = this.getNation(u.nationId);
        if (n && n.meatballs >= 1) {
          n.meatballs -= 1;
          u.hunger = 0;
          u.hp = Math.min(u.maxHp, u.hp + 12);
        }
      }
      if (u.hp < u.maxHp && u.nationId >= 0) {
        const n = this.getNation(u.nationId);
        if (!this.isNight) {
          const uTile = Math.max(0, Math.min(GRID_W * GRID_H - 1, (u.y | 0) * GRID_W + (u.x | 0)));
          if (this.lightMap[uTile] === 1 && this.territory[uTile] === u.nationId) {
            if (hasTech(n, 'fluorescent_ward')) {
              u.hp = Math.min(u.maxHp, u.hp + dt * 2.2);
            }
          }
        }
        if (hasTech(n, 'cold_chain_bunkers') && (n?.civilianGoods || 0) > 2) {
          u.hp = Math.min(u.maxHp, u.hp + dt * 1.25);
        }
      }
    }

    // Maintenance Escalator / Underground Tunnel fast-travel
    if (
      this.escalatorIndices.length >= 2 &&
      (u.teleportCooldown ?? 0) <= 0 &&
      u.hasTarget &&
      (u.kind === UnitKind.CART_RUNNER || this.isNationCitizen(u))
    ) {
      const distToTarget = Math.hypot(u.x - u.targetX, u.y - u.targetY);
      if (distToTarget > 16) {
        const uxTile = Math.max(1, Math.min(GRID_W - 2, u.x | 0));
        const uyTile = Math.max(1, Math.min(GRID_H - 2, u.y | 0));
        let standingEscalator = -1;
        for (let dy = -1; dy <= 1 && standingEscalator < 0; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const cIdx = (uyTile + dy) * GRID_W + (uxTile + dx);
            if (this.prop[cIdx] === PropType.ESCALATOR) {
              const eOwner = this.propOwner[cIdx];
              if (eOwner === -1 || (u.nationId >= 0 && this.areFriendly(u.nationId, eOwner))) {
                standingEscalator = cIdx;
                break;
              }
            }
          }
        }
        if (standingEscalator >= 0) {
          let bestDest = -1;
          let bestDestDist = distToTarget - 12;
          for (let ei = 0; ei < this.escalatorIndices.length; ei++) {
            const dIdx = this.escalatorIndices[ei];
            if (dIdx === standingEscalator || this.prop[dIdx] !== PropType.ESCALATOR) continue;
            const dOwner = this.propOwner[dIdx];
            if (dOwner !== -1 && (u.nationId < 0 || !this.areFriendly(u.nationId, dOwner))) continue;
            const ex = dIdx % GRID_W + 0.5;
            const ey = ((dIdx / GRID_W) | 0) + 0.5;
            const dToTarget = Math.hypot(ex - u.targetX, ey - u.targetY);
            if (dToTarget < bestDestDist) {
              bestDestDist = dToTarget;
              bestDest = dIdx;
            }
          }
          if (bestDest >= 0) {
            const destX = (bestDest % GRID_W) + 0.5;
            const destY = ((bestDest / GRID_W) | 0) + 0.5;
            this.spawnParticleBurst(u.x, u.y, '#22d3ee', 4);
            u.x = destX;
            u.y = destY;
            u.lastCheckX = destX;
            u.lastCheckY = destY;
            u.teleportCooldown = 6.5;
            this.spawnParticleBurst(destX, destY, '#22d3ee', 5);
            if (this.isNearCamera(destX, destY)) {
              soundFX.playEscalator();
            }
            if (Math.random() < 0.35) {
              this.spawnFloatingText(destX, destY - 1, '⇅ ESCALATOR', '#22d3ee');
            }
          }
        }
      }
    }

    // Wandering Neutral Trade Caravan AI
    if (u.isCaravan) {
      this.updateNeutralCaravan(u, dt);
      return;
    }

    // Free-Aisle Mercenary AI
    if (u.isMercenary) {
      this.updateMercenaryUnit(u, dt);
      return;
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

    // Feral Staff AI (Staff Kingdom citizens fall through to citizen behavior!)
    if (isStaffKind(u.kind) && (u.nationId < 0 || !this.getNation(u.nationId)?.alive)) {
      this.updateStaffUnit(u, dt);
      return;
    }

    // Citizen / Survivor AI (Human & Staff Kingdom citizens)
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
        if (this.isNationCitizen(other) && this.areHostile(origin.id, other.nationId)) {
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
      u.routeWaypoints = undefined;
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
      if (this.isNationCitizen(other) && this.areHostile(other.nationId, u.nationId)) {
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
      // Advance to next detour waypoint before final delivery if any remain
      if (u.routeWaypoints && u.routeWaypoints.length > 1) {
        u.routeWaypoints.shift();
        u.targetX = u.routeWaypoints[0].x;
        u.targetY = u.routeWaypoints[0].y;
        return;
      }
      // Arrived at destination capital or united city hub!
      const isUnionTrade = origin.id === dest.id || this.getStance(origin.id, dest.id) === 'UNION';
      const isMerchant = origin.government === 'Merchant Republic' || dest.government === 'Merchant Republic';
      const depotBonus = Math.min(6, (origin.buildings?.depots || 0) + (dest.buildings?.depots || 0));
      const railMult = hasTech(origin, 'automated_cart_rails') || hasTech(dest, 'automated_cart_rails') ? 2 : 1;
      const megastoreMult =
        hasTech(origin, 'megastore_supply_net') || hasTech(dest, 'megastore_supply_net') ? 1.5 : 1;
      const goodsBonus = (origin.civilianGoods || 0) > 2 || (dest.civilianGoods || 0) > 2 ? 1.3 : 1;
      const wrenchGain = Math.round(
        ((isMerchant ? 10 : 7) + depotBonus + (isUnionTrade ? 4 : 0)) * railMult * megastoreMult * goodsBonus
      );
      if (origin.id === dest.id) {
        origin.meatballs += Math.round(10 * railMult * megastoreMult * goodsBonus);
        origin.scrap += Math.round(10 * railMult * megastoreMult * goodsBonus) + (megastoreMult > 1 ? 10 : 0);
        origin.allenWrenches += wrenchGain;
        this.spawnFloatingText(u.x, u.y - 1, '+Union Supply!', '#fbbf24');
      } else {
        dest.meatballs += Math.round(8 * railMult * megastoreMult * goodsBonus);
        dest.scrap += Math.round(8 * railMult * megastoreMult * goodsBonus) + (megastoreMult > 1 ? 10 : 0);
        dest.allenWrenches += wrenchGain;
        origin.allenWrenches += wrenchGain;
        if (megastoreMult > 1) origin.scrap += 10;
        this.spawnFloatingText(
          u.x,
          u.y - 1,
          isUnionTrade ? '+Union Trade!' : megastoreMult > 1 ? '+Mega Trade!' : railMult > 1 ? '+2x Trade!' : '+Trade!',
          isUnionTrade ? '#fbbf24' : '#38bdf8'
        );
      }
      u.alive = false;
      this.deadUnitsCount++;
    }
  }

  private updateNeutralCaravan(u: Unit, dt: number): void {
    const aliveNations = this.nations.filter((n) => n.alive);
    if (aliveNations.length === 0) {
      u.alive = false;
      this.deadUnitsCount++;
      return;
    }
    let dest = u.targetNationId >= 0 ? this.getNation(u.targetNationId) : undefined;
    if (!dest || !dest.alive) {
      dest = aliveNations[(Math.random() * aliveNations.length) | 0];
      u.targetNationId = dest.id;
      u.targetX = dest.capitalX + 0.5;
      u.targetY = dest.capitalY + 0.5;
      u.hasTarget = true;
    }

    this.moveTowards(u, u.targetX, u.targetY, dt, 1.05);

    if (Math.hypot(u.x - u.targetX, u.y - u.targetY) < 2.6) {
      dest.meatballs += 16;
      dest.scrap += 16;
      dest.allenWrenches += 14;
      dest.civilianGoods = (dest.civilianGoods || 0) + 2;
      dest.happiness = Math.min(100, dest.happiness + 4);
      this.spawnParticleBurst(u.x, u.y, '#fbbf24', 8);
      this.spawnFloatingText(u.x, u.y - 1.2, `CARAVAN TRADE (+Goods)!`, '#fbbf24');

      u.carryAmount = Math.max(0, u.carryAmount - 6);
      if (u.carryAmount <= 0) {
        u.alive = false;
        this.deadUnitsCount++;
        return;
      }
      const nextStops = aliveNations.filter((n) => n.id !== dest!.id);
      const next = nextStops.length > 0 ? nextStops[(Math.random() * nextStops.length) | 0] : dest;
      u.targetNationId = next.id;
      u.targetX = next.capitalX + 0.5;
      u.targetY = next.capitalY + 0.5;
      u.hasTarget = true;
    }
  }

  private updateMercenaryUnit(u: Unit, dt: number): void {
    // Check if an embattled/nearby kingdom hires this Mercenary
    u.aiTimer -= dt;
    if (u.aiTimer <= 0) {
      u.aiTimer = 1.6;
      let bestEmployer: Nation | undefined;
      let bestDist = 20;
      for (const n of this.nations) {
        if (!n.alive || n.allenWrenches < 22) continue;
        const d = Math.hypot(n.capitalX - u.x, n.capitalY - u.y);
        const atWar = Object.values(n.relations).some((r) => r.stance === 'WAR');
        if (d < bestDist && (atWar || (n.armyCount ?? 0) < Math.max(2, n.armyCap || 3))) {
          bestDist = d;
          bestEmployer = n;
        }
      }
      if (bestEmployer) {
        bestEmployer.allenWrenches -= 22;
        u.nationId = bestEmployer.id;
        u.isMercenary = false;
        u.role = SurvivorRole.GUARD;
        u.weapon = 'halogen_rifle';
        u.atk = Math.max(u.atk, 19);
        u.chatEmoji = '🤝';
        u.chatTimer = 2.0;
        bestEmployer.population++;
        this.recountTerritoryAndHousing();
        this.spawnParticleBurst(u.x, u.y, bestEmployer.color, 10);
        this.spawnFloatingText(u.x, u.y - 1.2, `HIRED BY ${bestEmployer.name.split(' ')[0]}!`, '#a855f7');
        this.addNews('WAR', `${bestEmployer.name} hired Free-Aisle Mercenary ${u.name}!`);
        return;
      }
    }

    // Fight hostile Staff nearby
    let threat: Unit | null = null;
    let bestDSq = 9 * 9;
    this.spatialHash.queryRadius(this.units, u.x, u.y, 9, (other, _idx, dSq) => {
      if (isStaffKind(other.kind) && other.nationId < 0 && !other.pacified && (this.isNight || u.feverTimer > 0)) {
        if (dSq < bestDSq) {
          bestDSq = dSq;
          threat = other;
        }
      }
    });
    if (threat) {
      const target = threat as Unit;
      if (bestDSq <= 7.5 * 7.5 && bestDSq > 1.7 * 1.7) {
        if (u.attackCooldown <= 0) {
          u.attackCooldown = 0.58;
          const d = Math.sqrt(bestDSq) || 1;
          this.projectiles.push({
            x: u.x,
            y: u.y,
            vx: ((target.x - u.x) / d) * 18,
            vy: ((target.y - u.y) / d) * 18,
            damage: u.atk,
            nationId: -1,
            color: '#c084fc',
            life: 0.7,
          });
          if (this.isNearCamera(u.x, u.y)) {
            soundFX.playShot('plasma_stapler');
          }
        }
      } else if (bestDSq <= 1.7 * 1.7) {
        if (u.attackCooldown <= 0) {
          u.attackCooldown = 0.5;
          this.damageUnit(target, u.atk, u);
        }
      } else {
        this.moveTowards(u, target.x, target.y, dt, 1.05);
      }
      return;
    }

    if (!u.hasTarget || Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1.5) {
      const a = Math.random() * Math.PI * 2;
      u.targetX = Math.max(4, Math.min(GRID_W - 4, u.x + Math.cos(a) * 16));
      u.targetY = Math.max(4, Math.min(GRID_H - 4, u.y + Math.sin(a) * 16));
      u.hasTarget = true;
    }
    this.moveTowards(u, u.targetX, u.targetY, dt, 0.85);
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
    // Daytime ("Store Open") or Pacified Staff: calm aisle patrol
    if (!this.isNight || u.pacified) {
      u.aiTimer -= dt;
      if (!u.hasTarget || u.aiTimer <= 0 || Math.hypot(u.x - u.targetX, u.y - u.targetY) < 1.5) {
        u.aiTimer = 3.0 + Math.random() * 2.5;
        u.targetX = Math.max(4, Math.min(GRID_W - 4, u.x + (Math.random() - 0.5) * 24));
        u.targetY = Math.max(4, Math.min(GRID_H - 4, u.y + (Math.random() - 0.5) * 24));
        u.hasTarget = true;
      }
      this.moveTowards(u, u.targetX, u.targetY, dt, u.pacified ? 0.65 : 0.55);
      return;
    }

    // Nighttime ("The store is now closed"): Staff turn lethal and hunt survivors & buildings
    const isAudit = this.day % 10 === 0;
    const sightRad = isAudit ? 19 : 16;
    const uTileIdx = Math.max(0, Math.min(GRID_W * GRID_H - 1, (u.y | 0) * GRID_W + (u.x | 0)));
    const tileOwner = this.territory[uTileIdx];
    const tileOwnerNation = tileOwner >= 0 ? this.getNation(tileOwner) : undefined;
    const wardSlow =
      this.lightMap[uTileIdx] === 1 && hasTech(tileOwnerNation, 'fluorescent_ward')
        ? 0.72
        : 1.0;
    if (this.lightMap[uTileIdx] === 1 && hasTech(tileOwnerNation, 'sunlight_beacons')) {
      u.hp -= dt * 9.5;
      if (u.hp <= 0) {
        this.damageUnit(u, 12, undefined, tileOwnerNation?.id);
        return;
      }
      if ((u.id + this.simTickCount) % 16 === 0) {
        u.hitFlash = 0.08;
        this.spawnParticleBurst(u.x, u.y, '#fef08a', 2);
      }
    }
    const sirenBuff = u.feverTimer > 0 ? 1.32 : 1.0;
    const fogBuff = this.activeAnomaly?.type === 'AISLE_FOG' ? 1.15 : 1.0;
    const nightSpeed = (isAudit ? 1.32 : 1.18) * wardSlow * sirenBuff * fogBuff;

    // 1. PA Hound (STAFF_ANNOUNCER): periodically broadcasts Closing Siren that buffs nearby Staff & panics civilians
    if (u.kind === UnitKind.STAFF_ANNOUNCER) {
      u.aiTimer -= dt;
      if (u.aiTimer <= 0) {
        u.aiTimer = 6.5;
        let buffed = 0;
        this.spatialHash.queryRadius(this.units, u.x, u.y, 9, (other) => {
          if (isStaffKind(other.kind) && other.nationId < 0 && !other.pacified) {
            other.feverTimer = Math.max(other.feverTimer, 3.5);
            buffed++;
          } else if (
            this.isNationCitizen(other) &&
            other.role !== SurvivorRole.GUARD &&
            other.role !== SurvivorRole.GENERAL &&
            other.role !== SurvivorRole.LEADER
          ) {
            other.chatEmoji = '😱';
            other.chatTimer = 1.6;
            other.hasTarget = false;
          }
        });
        if (buffed > 0) {
          this.spawnParticleBurst(u.x, u.y, '#ef4444', 8);
          this.spawnFloatingText(u.x, u.y - 1.2, 'STORE CLOSED!', '#f87171');
        }
      }
    }

    // 1b. Barcode Scanner (STAFF_DISRUPTOR): jams nearby Watchtowers & Spotlights (unless shielded by Repulsor Pylons)
    if (u.kind === UnitKind.STAFF_DISRUPTOR) {
      u.aiTimer -= dt;
      if (u.aiTimer <= 0) {
        u.aiTimer = 5.5;
        let jammed = 0;
        for (let li = 0; li < this.lightSourceIndices.length; li++) {
          const lIdx = this.lightSourceIndices[li];
          const p = this.prop[lIdx];
          if ((p !== PropType.WATCHTOWER && p !== PropType.SPOTLIGHT) || this.disabledLightMap[lIdx] > 0) {
            continue;
          }
          const lx = lIdx % GRID_W;
          const ly = (lIdx / GRID_W) | 0;
          if ((lx + 0.5 - u.x) * (lx + 0.5 - u.x) + (ly + 0.5 - u.y) * (ly + 0.5 - u.y) <= 8.5 * 8.5) {
            const ownerN = this.propOwner[lIdx] >= 0 ? this.getNation(this.propOwner[lIdx]) : undefined;
            if (hasTech(ownerN, 'repulsor_pylons')) continue;
            this.disabledLightMap[lIdx] = 7;
            this.dirtyLight = true;
            jammed++;
            if (ownerN) {
              this.nationBuildingAlert.set(ownerN.id, { x: lx + 0.5, y: ly + 0.5, until: this.simTime + 10 });
            }
          }
        }
        if (jammed > 0) {
          this.spawnParticleBurst(u.x, u.y, '#e879f9', 8);
          this.spawnFloatingText(u.x, u.y - 1.2, 'SCANNER JAM!', '#e879f9');
        }
      }
    }

    // 1c. Store Director Boss (STAFF_DIRECTOR): rallies Staff within 12 tiles with executive fever
    if (u.kind === UnitKind.STAFF_DIRECTOR) {
      u.aiTimer -= dt;
      if (u.aiTimer <= 0) {
        u.aiTimer = 4.8;
        let rallied = 0;
        this.spatialHash.queryRadius(this.units, u.x, u.y, 12, (other) => {
          if (other.id !== u.id && isStaffKind(other.kind) && other.nationId < 0 && !other.pacified) {
            other.feverTimer = Math.max(other.feverTimer, 4.5);
            rallied++;
          }
        });
        if (rallied > 0) {
          this.spawnParticleBurst(u.x, u.y, '#f43f5e', 8);
          this.spawnFloatingText(u.x, u.y - 1.4, 'EXECUTIVE AUDIT!', '#f43f5e');
        }
      }
    }

    // 2. Blackout Stalker (STAFF_STALKER): prioritizes extinguishing nearby lit Spotlights at night (cached target)
    if (u.kind === UnitKind.STAFF_STALKER) {
      let targetLightIdx = u.visitTargetIdx ?? -1;
      if (
        targetLightIdx < 0 ||
        targetLightIdx >= GRID_W * GRID_H ||
        this.prop[targetLightIdx] !== PropType.SPOTLIGHT ||
        this.disabledLightMap[targetLightIdx] > 0
      ) {
        targetLightIdx = -1;
        let bestLightDistSq = 14 * 14;
        for (let li = 0; li < this.lightSourceIndices.length; li++) {
          const lIdx = this.lightSourceIndices[li];
          if (this.prop[lIdx] !== PropType.SPOTLIGHT || this.disabledLightMap[lIdx] > 0) continue;
          const lx = lIdx % GRID_W;
          const ly = (lIdx / GRID_W) | 0;
          const dx = lx + 0.5 - u.x;
          const dy = ly + 0.5 - u.y;
          const dSq = dx * dx + dy * dy;
          if (dSq < bestLightDistSq) {
            bestLightDistSq = dSq;
            targetLightIdx = lIdx;
          }
        }
        u.visitTargetIdx = targetLightIdx;
      }

      if (targetLightIdx >= 0) {
        const lx = targetLightIdx % GRID_W;
        const ly = (targetLightIdx / GRID_W) | 0;
        const dSq = (lx + 0.5 - u.x) * (lx + 0.5 - u.x) + (ly + 0.5 - u.y) * (ly + 0.5 - u.y);
        if (dSq <= 1.8 * 1.8) {
          this.disabledLightMap[targetLightIdx] = 16;
          this.dirtyLight = true;
          const sOwner = this.propOwner[targetLightIdx];
          if (sOwner >= 0) {
            this.nationBuildingAlert.set(sOwner, { x: lx + 0.5, y: ly + 0.5, until: this.simTime + 10 });
          }
          this.spawnParticleBurst(lx + 0.5, ly + 0.5, '#60a5fa', 6);
          this.spawnFloatingText(lx + 0.5, ly - 0.8, 'BLACKOUT!', '#60a5fa');
          u.visitTargetIdx = -1;
          u.attackCooldown = 0.6;
        } else if (dSq <= 16 * 16) {
          this.moveTowards(u, lx + 0.5, ly + 0.5, dt, nightSpeed * 1.08);
        } else {
          u.visitTargetIdx = -1;
        }
        if ((u.visitTargetIdx ?? -1) >= 0 || dSq <= 1.8 * 1.8) return;
      }
    }

    // 3. Aisle Warden / Forklift / Store Director: smashes nearby barricades/towers with siege damage
    const tx = u.x | 0;
    const ty = u.y | 0;
    const checkAdjacentStructure = (forWardenOnly: boolean): boolean => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx <= 0 || nx >= GRID_W - 1 || ny <= 0 || ny >= GRID_H - 1) continue;
          const idx = ny * GRID_W + nx;
          const p = this.prop[idx];
          const isStruct =
            p === PropType.BARRICADE_WALL ||
            p === PropType.BARRICADE_GATE ||
            p === PropType.SPOTLIGHT ||
            p === PropType.MATTRESS_HUT ||
            p === PropType.WATCHTOWER ||
            p === PropType.BISTRO ||
            p === PropType.WORKSHOP ||
            p === PropType.ARCHIVE ||
            p === PropType.CART_DEPOT ||
            p === PropType.TECH_LAB;
          if (!isStruct) continue;
          if (
            forWardenOnly &&
            p !== PropType.BARRICADE_WALL &&
            p !== PropType.BARRICADE_GATE &&
            p !== PropType.WATCHTOWER
          ) {
            continue;
          }
          const structOwner = this.propOwner[idx];
          if (structOwner >= 0) {
            this.nationBuildingAlert.set(structOwner, { x: nx + 0.5, y: ny + 0.5, until: this.simTime + 10 });
          }
          if (u.attackCooldown <= 0) {
            u.attackCooldown =
              u.kind === UnitKind.STAFF_FORKLIFT
                ? 0.48
                : u.kind === UnitKind.STAFF_DIRECTOR
                  ? 0.5
                  : u.kind === UnitKind.STAFF_WARDEN
                    ? 0.55
                    : 0.65;
            const structDmg =
              u.kind === UnitKind.STAFF_FORKLIFT
                ? Math.round(u.atk * 3.0)
                : u.kind === UnitKind.STAFF_DIRECTOR
                  ? Math.round(u.atk * 2.6)
                  : u.kind === UnitKind.STAFF_WARDEN
                    ? Math.round(u.atk * 2.2)
                    : u.atk;
            if (u.kind === UnitKind.STAFF_FORKLIFT || u.kind === UnitKind.STAFF_DIRECTOR) {
              this.spawnParticleBurst(
                nx + 0.5,
                ny + 0.5,
                u.kind === UnitKind.STAFF_DIRECTOR ? '#f43f5e' : '#fbbf24',
                4
              );
            }
            if (this.propHp[idx] > structDmg) {
              this.propHp[idx] -= structDmg;
            } else {
              this.ejectBuildingOccupants(idx);
              this.prop[idx] = PropType.NONE;
              this.propHp[idx] = 0;
              this.propOwner[idx] = -1;
              this.dirtyLight = true;
            }
          }
          return true;
        }
      }
      return false;
    };

    if (
      (u.kind === UnitKind.STAFF_WARDEN ||
        u.kind === UnitKind.STAFF_FORKLIFT ||
        u.kind === UnitKind.STAFF_DIRECTOR) &&
      checkAdjacentStructure(true)
    ) {
      return;
    }

    let enemy: Unit | null = null;
    let bestDSq = sightRad * sightRad;
    this.spatialHash.queryRadius(this.units, u.x, u.y, sightRad, (other, _idx, dSq) => {
      if ((other.insideTimer ?? 0) > 0) return;
      if (this.isNationCitizen(other) || other.kind === UnitKind.CART_RUNNER || other.kind === UnitKind.SURVIVOR) {
        if (dSq < bestDSq) {
          bestDSq = dSq;
          enemy = other;
        }
      }
    });

    // 4. Coordinated Pack Grouping & Regroup Instinct when Survivors are Dominant
    if (this.staffPack) {
      if (this.staffPack.phase === 'GATHERING') {
        const dRally = Math.hypot(this.staffPack.rallyX - u.x, this.staffPack.rallyY - u.y);
        if (dRally < 44 && (!enemy || bestDSq > 4.5 * 4.5)) {
          if (dRally > 2.6) {
            this.moveTowards(u, this.staffPack.rallyX, this.staffPack.rallyY, dt, nightSpeed * 1.12);
          } else {
            const a = (u.id % 12) * ((Math.PI * 2) / 12) + this.simTime * 0.6;
            this.moveTowards(
              u,
              this.staffPack.rallyX + Math.cos(a) * 2.2,
              this.staffPack.rallyY + Math.sin(a) * 2.2,
              dt,
              0.45
            );
          }
          return;
        }
      } else if (this.staffPack.phase === 'CHARGING') {
        const dTarget = Math.hypot(this.staffPack.targetX - u.x, this.staffPack.targetY - u.y);
        if (dTarget < 48 && (!enemy || bestDSq > 6 * 6)) {
          this.moveTowards(u, this.staffPack.targetX, this.staffPack.targetY, dt, nightSpeed * 1.16);
          return;
        }
      }
    }

    if (enemy) {
      const target = enemy as Unit;
      if (bestDSq <= 1.75 * 1.75) {
        if (u.attackCooldown <= 0) {
          u.attackCooldown = u.kind === UnitKind.STAFF_CRAWLER ? 0.38 : 0.58;
          this.damageUnit(target, Math.round(u.atk * 1.2), u);
          if (
            (u.kind === UnitKind.STAFF_WARDEN || u.kind === UnitKind.STAFF_FORKLIFT) &&
            target.alive
          ) {
            const kd = Math.hypot(target.x - u.x, target.y - u.y) || 1;
            const push = u.kind === UnitKind.STAFF_FORKLIFT ? 0.85 : 0.45;
            target.x = Math.max(1.5, Math.min(GRID_W - 1.5, target.x + ((target.x - u.x) / kd) * push));
            target.y = Math.max(1.5, Math.min(GRID_H - 1.5, target.y + ((target.y - u.y) / kd) * push));
            if (u.kind === UnitKind.STAFF_FORKLIFT) {
              this.spawnParticleBurst(target.x, target.y, '#fbbf24', 5);
            }
          }
        }
      } else if (
        (u.kind === UnitKind.STAFF_THROWER || u.kind === UnitKind.STAFF_DIRECTOR) &&
        bestDSq <= (u.kind === UnitKind.STAFF_DIRECTOR ? 9.5 * 9.5 : 8.0 * 8.0) &&
        bestDSq >= 2.0 * 2.0
      ) {
        if (u.attackCooldown <= 0 && this.projectiles.length < 160) {
          const isDir = u.kind === UnitKind.STAFF_DIRECTOR;
          u.attackCooldown = isDir ? 1.05 : 0.95;
          const d = Math.sqrt(bestDSq) || 1;
          this.projectiles.push({
            x: u.x,
            y: u.y,
            vx: ((target.x - u.x) / d) * (isDir ? 18 : 14),
            vy: ((target.y - u.y) / d) * (isDir ? 18 : 14),
            damage: Math.round(u.atk * (isDir ? 0.85 : 1.05)),
            nationId: -1,
            color: isDir ? '#f43f5e' : '#f97316',
            life: 0.72,
          });
          if (this.isNearCamera(u.x, u.y)) {
            soundFX.playShot(isDir ? 'pa_megaphone' : 'staff_throw');
          }
          if (isDir) {
            this.moveTowards(u, target.x, target.y, dt, nightSpeed * 0.7);
          }
        } else if (u.kind === UnitKind.STAFF_DIRECTOR) {
          this.moveTowards(u, target.x, target.y, dt, nightSpeed);
        }
      } else {
        // If survivors are dominant and this employee is alone outside melee, periodically group with nearby Staff
        if (
          this.staffAlertTier >= 1 &&
          bestDSq > 3.5 * 3.5 &&
          u.kind !== UnitKind.STAFF_MANAGER &&
          u.kind !== UnitKind.STAFF_DIRECTOR &&
          u.feverTimer <= 0 &&
          (u.id + this.simTickCount) % 10 === 0
        ) {
          let nearbyStaff = 0;
          let rallyAlly: Unit | null = null;
          let allyDistSq = 18 * 18;
          this.spatialHash.queryRadius(this.units, u.x, u.y, 18, (other, _oi, dSq) => {
            if (other.id === u.id || !isStaffKind(other.kind) || other.nationId >= 0 || other.pacified) return;
            if (dSq <= 6 * 6) nearbyStaff++;
            if (dSq > 4 * 4 && dSq < allyDistSq) {
              allyDistSq = dSq;
              rallyAlly = other;
            }
          });
          if (nearbyStaff < 1 && rallyAlly) {
            const ally = rallyAlly as Unit;
            this.moveTowards(u, ally.x, ally.y, dt, nightSpeed * 1.06);
            return;
          }
        }
        this.moveTowards(u, target.x, target.y, dt, nightSpeed);
      }
      return;
    }

    // Attack adjacent barricades/buildings if blocking path at night
    if (checkAdjacentStructure(false)) {
      return;
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
    this.moveTowards(u, u.targetX, u.targetY, dt, 1.15 * sirenBuff);
  }

  private updateSurvivorUnit(u: Unit, dt: number): void {
    const nation = u.nationId >= 0 ? this.getNation(u.nationId) : undefined;
    const goodsSpeed = (nation?.civilianGoods || 0) >= 5 ? 1.1 : 1.0;
    const anomalySpeed =
      this.activeAnomaly?.type === 'ESPRESSO_RUSH'
        ? 1.32
        : this.activeAnomaly?.type === 'CLEARANCE_STAMPEDE'
          ? 1.22
          : 1.0;
    const speedMult = (u.feverTimer > 0 ? 1.65 : 1.0) * goodsSpeed * anomalySpeed;

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
          if (isStaffKind(other.kind) && dSq < staffBestDSq) {
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

      // Player-placed unclaimed settlers gather locally, hold a Proximity Vote if next to a country, or found a kingdom
      if (u.canFoundKingdom) {
        u.settleTimer = (u.settleTimer || 0) + dt;
        const tileIdx = Math.max(0, Math.min(GRID_W * GRID_H - 1, (u.y | 0) * GRID_W + (u.x | 0)));
        const tileOwner = this.territory[tileIdx];
        const onLivingNation = tileOwner >= 0 && Boolean(this.nations[tileOwner]?.alive);
        const inSummit = Math.hypot(u.x - this.summitLocalX, u.y - this.summitLocalY) <= SUMMIT_RADIUS + 4;

        if (!onLivingNation && !inSummit && u.settleTimer >= 0.85) {
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
          const avgX = nearbySettlers.length > 0 ? sumX / nearbySettlers.length : u.x;
          const avgY = nearbySettlers.length > 0 ? sumY / nearbySettlers.length : u.y;
          const ax = Math.max(1, Math.min(GRID_W - 2, avgX | 0));
          const ay = Math.max(1, Math.min(GRID_H - 2, avgY | 0));

          // Check if placed right beside an existing living country -> hold Proximity Vote!
          if (!u.proximityVoted && nearbySettlers.some((s) => !s.proximityVoted)) {
            let neighbor: Nation | null = null;
            let bestNeighborDist = 17;
            for (const cand of this.nations) {
              if (!cand.alive) continue;
              const d = Math.hypot(cand.capitalX - avgX, cand.capitalY - avgY);
              if (d < bestNeighborDist) {
                bestNeighborDist = d;
                neighbor = cand;
              }
            }
            if (!neighbor) {
              for (let dy = -4; dy <= 4 && !neighbor; dy++) {
                for (let dx = -4; dx <= 4 && !neighbor; dx++) {
                  const nx = Math.max(0, Math.min(GRID_W - 1, ax + dx));
                  const ny = Math.max(0, Math.min(GRID_H - 1, ay + dy));
                  const ownerId = this.territory[ny * GRID_W + nx];
                  if (ownerId >= 0 && this.nations[ownerId]?.alive) {
                    neighbor = this.nations[ownerId];
                  }
                }
              }
            }

            if (neighbor) {
              const voters = nearbySettlers.length > 0 ? nearbySettlers : [u];
              let yesWeight = 0.42;
              if (neighbor.happiness >= 70) yesWeight += 0.16;
              else if (neighbor.happiness < 42) yesWeight -= 0.18;
              if (neighbor.government === 'Checkout Democracy' || neighbor.government === 'Merchant Republic') {
                yesWeight += 0.12;
              } else if (neighbor.government === 'Iron Dictatorship') {
                yesWeight -= 0.14;
              }
              if (neighbor.population < 12) yesWeight += 0.1;
              if (neighbor.meatballs > neighbor.population * 1.4) yesWeight += 0.08;
              yesWeight = Math.max(0.15, Math.min(0.88, yesWeight));

              let yesVotes = 0;
              let noVotes = 0;
              for (let vi = 0; vi < voters.length; vi++) {
                if (Math.random() < yesWeight) yesVotes++;
                else noVotes++;
              }
              if (yesVotes === noVotes) {
                if (Math.random() < yesWeight) yesVotes++;
                else noVotes++;
              }
              const joined = yesVotes > noVotes;

              if (joined) {
                for (const s of voters) {
                  const role = this.pickNeededJobForNation(neighbor, true);
                  s.nationId = neighbor.id;
                  s.canFoundKingdom = false;
                  s.proximityVoted = true;
                  this.applyRoleStats(s, neighbor, role);
                  s.hasTarget = false;
                  s.chatEmoji = '🗳️';
                  s.chatTimer = 2.0;
                  neighbor.population++;
                }
                this.recountTerritoryAndHousing();
                this.spawnParticleBurst(avgX, avgY, neighbor.color, 10);
                this.spawnFloatingText(
                  avgX,
                  avgY - 1.3,
                  `VOTE YES (${yesVotes}-${noVotes})! Joined ${neighbor.name}`,
                  neighbor.color
                );
                this.addNews(
                  'DIPLOMACY',
                  `${voters.length} nearby survivor${voters.length > 1 ? 's' : ''} voted YES (${yesVotes}-${noVotes}) to join ${neighbor.name}!`
                );
                return;
              } else {
                for (const s of voters) {
                  s.proximityVoted = true;
                  s.chatEmoji = '🗳️';
                  s.chatTimer = 2.0;
                }
                this.spawnFloatingText(
                  avgX,
                  avgY - 1.3,
                  `VOTE NO (${noVotes}-${yesVotes})! Staying Independent`,
                  '#ffda1a'
                );
                this.addNews(
                  'DIPLOMACY',
                  `Nearby survivors voted NO (${noVotes}-${yesVotes}) to stay independent from ${neighbor.name}!`
                );
                if (voters.length >= 2 && this.foundIndependentKingdomFromSettlers(voters, avgX, avgY, true)) {
                  return;
                }
              }
            }
          }

          if (nearbySettlers.length >= 2 && u.settleTimer >= 1.1) {
            if (this.foundIndependentKingdomFromSettlers(nearbySettlers, avgX, avgY, nearbySettlers.some((s) => Boolean(s.proximityVoted)))) {
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
      const atWar = this.nationAtWarCache.has(nation.id);
      if (this.summitLoungeSessionActive || !atWar) {
        const invitedNations = this.nations.filter(
          (n) =>
            n.alive &&
            n.leader.alive &&
            (this.summitLoungeSessionActive || !this.nationAtWarCache.has(n.id))
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
        let sx = this.summitLocalX + 0.5;
        let sy = this.summitLocalY + 0.5;
        if (seatIdx < couchOffsets.length) {
          sx = this.summitLocalX + 0.5 + couchOffsets[seatIdx][0];
          sy = this.summitLocalY + 0.5 + couchOffsets[seatIdx][1];
        } else {
          const totalSeats = Math.max(1, invitedNations.length);
          const seatAngle = (seatIdx / totalSeats) * Math.PI * 2;
          sx = this.summitLocalX + 0.5 + Math.cos(seatAngle) * 2.5;
          sy = this.summitLocalY + 0.5 + Math.sin(seatAngle) * 2.5;
        }
        const distToSeat = Math.hypot(u.x - sx, u.y - sy);
        const distToLounge = Math.hypot(u.x - (this.summitLocalX + 0.5), u.y - (this.summitLocalY + 0.5));

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

    // Actively capture undefended enemy/abandoned border pockets as soldiers advance (skip during peacetime)
    if (
      (this.hasAnyActiveWar || u.feverTimer > 0) &&
      (u.role === SurvivorRole.GUARD ||
        u.role === SurvivorRole.GENERAL ||
        u.role === SurvivorRole.LEADER ||
        u.feverTimer > 0)
    ) {
      this.captureUndefendedEnemyPocket(
        nation,
        Math.max(1, Math.min(GRID_W - 2, u.x | 0)),
        Math.max(1, Math.min(GRID_H - 2, u.y | 0)),
        u.role === SurvivorRole.GENERAL ? 2 : 1
      );
    }

    // 1. Combat Check: fight feral Staff or Hostile Nations nearby (with Firearms & Spears!)
    const isMilitary =
      u.role === SurvivorRole.GUARD ||
      u.role === SurvivorRole.GENERAL ||
      u.role === SurvivorRole.LEADER;
    const activeWeapon =
      u.weapon && u.weapon !== 'none'
        ? u.weapon
        : isMilitary
          ? this.getNationBestWeaponType(nation, u.id)
          : 'none';
    const rangedRange =
      activeWeapon === 'rail_cannon'
        ? 10.0
        : activeWeapon === 'arc_caster'
          ? 9.5
          : activeWeapon === 'halogen_rifle' || activeWeapon === 'plasma_stapler' || activeWeapon === 'pa_megaphone'
            ? 8.5
            : activeWeapon === 'nailgun'
              ? 6.5
              : 0;
    const searchRad = Math.max(
      rangedRange > 0 ? rangedRange + 2.5 : 0,
      u.role === SurvivorRole.GUARD || u.role === SurvivorRole.GENERAL || u.feverTimer > 0 ? 11 : 6.5
    );
    let nearestHostile: Unit | null = null;
    let bestDistSq = searchRad * searchRad;

    const shouldScanCombat =
      this.isNight ||
      this.hasAnyActiveWar ||
      u.feverTimer > 0
        ? isMilitary || (u.id + this.simTickCount) % 3 === 0
        : isMilitary && ((u.id + this.simTickCount) & 3) === 0;

    if (shouldScanCombat) {
      this.spatialHash.queryRadius(this.units, u.x, u.y, searchRad, (other, _idx, dSq) => {
        if ((other.insideTimer ?? 0) > 0) return;
        const isFeralStaff =
          (this.isNight || u.feverTimer > 0) && isStaffKind(other.kind) && other.nationId < 0 && !other.pacified;
        const isEnemy =
          other.nationId >= 0 &&
          other.nationId !== u.nationId &&
          (this.areHostile(u.nationId, other.nationId) || u.feverTimer > 0);
        if (isFeralStaff || isEnemy) {
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            nearestHostile = other;
          }
        }
      });
    }

    if (nearestHostile) {
      const enemy = nearestHostile as Unit;
      const isBrave =
        u.role === SurvivorRole.GUARD ||
        u.role === SurvivorRole.GENERAL ||
        u.role === SurvivorRole.LEADER ||
        u.traits.includes('Brave') ||
        u.traits.includes('Blessed') ||
        u.feverTimer > 0 ||
        rangedRange > 0 ||
        nation.government === 'Meatball Theocracy';

      if (isBrave || bestDistSq < 16) {
        if (bestDistSq <= 1.7 * 1.7) {
          if (u.attackCooldown <= 0) {
            u.attackCooldown = u.feverTimer > 0 ? 0.32 : 0.6;
            const spearBonus = activeWeapon === 'allen_spear' ? 4 : 0;
            const dmg = u.atk + spearBonus + (u.traits.includes('Blessed') ? 8 : 0) + (u.feverTimer > 0 ? 6 : 0);
            this.damageUnit(enemy, dmg, u);
          }
        } else if (rangedRange > 0 && bestDistSq <= rangedRange * rangedRange) {
          if (u.attackCooldown <= 0) {
            const d = Math.sqrt(bestDistSq) || 1;
            const isArc = activeWeapon === 'arc_caster';
            const isRail = activeWeapon === 'rail_cannon';
            const isPlasma = activeWeapon === 'plasma_stapler';
            const isRifle = activeWeapon === 'halogen_rifle';
            const isMegaphone = activeWeapon === 'pa_megaphone';
            const pSpeed = isRail ? 27 : isArc ? 25 : isPlasma ? 22 : isRifle ? 21 : isMegaphone ? 19 : 16;
            const pDmg = u.atk + (isArc ? 16 : isRail ? 15 : isPlasma ? 11 : isMegaphone ? 9 : isRifle ? 8 : 4);
            const pColor = isArc
              ? '#e879f9'
              : isRail
                ? '#f97316'
                : isPlasma
                  ? '#c084fc'
                  : isMegaphone
                    ? '#f43f5e'
                    : isRifle
                      ? '#38bdf8'
                      : '#fbbf24';
            u.attackCooldown = isArc ? 0.44 : isRail ? 0.56 : isPlasma ? 0.48 : isRifle ? 0.55 : isMegaphone ? 0.52 : 0.62;
            this.projectiles.push({
              x: u.x,
              y: u.y,
              vx: ((enemy.x - u.x) / d) * pSpeed,
              vy: ((enemy.y - u.y) / d) * pSpeed,
              damage: pDmg,
              nationId: u.nationId,
              color: pColor,
              arcChain: isArc,
              life: 0.78,
            });
            if (this.isNearCamera(u.x, u.y)) {
              soundFX.playShot(
                isArc
                  ? 'arc_caster'
                  : isRail
                    ? 'rail_cannon'
                    : isPlasma
                      ? 'plasma_stapler'
                      : isMegaphone
                        ? 'pa_megaphone'
                        : isRifle
                          ? 'halogen_rifle'
                          : 'nailgun'
              );
            }
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
      // Carry resource back to closest owned Depot / Hub / Workshop / Capital so outer scavengers stay distributed
      if (u.carryAmount > 0) {
        const dropOff = this.getClosestNationDropoff(nation, u.x, u.y);
        this.moveTowards(u, dropOff.x, dropOff.y, dt, speedMult);
        if (Math.hypot(u.x - dropOff.x, u.y - dropOff.y) < 2.3) {
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
      const inSummitZone = Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 1;

      if (!u.hasTarget) {
        u.buildProp = undefined;
        u.buildVariant = undefined;
      }

      // Claim tile under feet ONLY if contiguous with existing territory (prevents stray 1-tile speckles)
      const footOwner = this.territory[idx];
      if (!inSummitZone && (footOwner === -1 || (footOwner >= 0 && !this.nations[footOwner]?.alive))) {
        const touchesOwn =
          this.territory[idx - GRID_W] === nation.id ||
          this.territory[idx + GRID_W] === nation.id ||
          this.territory[idx - 1] === nation.id ||
          this.territory[idx + 1] === nation.id;
        if (touchesOwn) {
          if (footOwner >= 0 && this.prop[idx] === PropType.CHECKOUT_FLAG) {
            this.prop[idx] = PropType.SPOTLIGHT;
            this.propOwner[idx] = nation.id;
            this.dirtyLight = true;
          }
          this.territory[idx] = nation.id;
          this.dirtyMap = true;
        }
      }

      // Repair damaged friendly structures during daytime
      if (!this.isNight && this.propOwner[idx] === nation.id && this.propHp[idx] < this.propMaxHp[idx]) {
        this.propHp[idx] = Math.min(this.propMaxHp[idx], this.propHp[idx] + 25);
      }

      // At night, retreat to nearest lit Spotlight / Watchtower / Hub / Capital rather than abandoning outer districts
      if (this.isNight && this.lightMap[idx] === 0) {
        const safeLight = this.getClosestLitSafePoint(nation, u.x, u.y);
        if (Math.hypot(u.x - safeLight.x, u.y - safeLight.y) > 4.5) {
          u.buildProp = undefined;
          u.hasTarget = false;
          this.moveTowards(u, safeLight.x, safeLight.y, dt, speedMult);
          return;
        }
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
          const bInSummit = Math.hypot(bx - this.summitLocalX, by - this.summitLocalY) <= SUMMIT_RADIUS + 2;

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

          // Never build solid walls across trade walkways; automatically make them passable gates
          const finalBuildProp =
            u.buildProp === PropType.BARRICADE_WALL && this.biome[bIdx] === BiomeType.WALKWAY
              ? PropType.BARRICADE_GATE
              : u.buildProp;
          const finalVariant = finalBuildProp === PropType.BARRICADE_GATE ? 0 : (u.buildVariant ?? 0);

          const cost = this.getBuildingCost(finalBuildProp, nation);
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

            // Only expand 3x3 territory for interior structures; border walls/gates/towers sit ON the border edge
            const isBorderDefense =
              finalBuildProp === PropType.BARRICADE_WALL ||
              finalBuildProp === PropType.BARRICADE_GATE ||
              finalBuildProp === PropType.WATCHTOWER;

            if (!isBorderDefense) {
              let claimedNew = false;
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  const cx = bx + dx;
                  const cy = by + dy;
                  if (cx < 1 || cx >= GRID_W - 1 || cy < 1 || cy >= GRID_H - 1) continue;
                  if (Math.hypot(cx - this.summitLocalX, cy - this.summitLocalY) <= SUMMIT_RADIUS + 1) continue;
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
              if (claimedNew) {
                this.dirtyMap = true;
                this.needsInteriorWallCleanup = true;
              }
            } else if (this.territory[bIdx] === -1 && this.isOnPrimaryCapitalPerimeter(nation, bx, by)) {
              this.territory[bIdx] = nation.id;
              this.dirtyMap = true;
            }

            this.placeNationProp(bx, by, finalBuildProp, cost.hp, nation.id, finalVariant);
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

      // 2. Carrying harvested IKEA materials: bring straight to next blueprint site or closest dropoff
      if (u.carryAmount > 0) {
        const nextCheck = this.unitBlueprintNextTime.get(u.id) ?? 0;
        if (this.simTime >= nextCheck) {
          this.unitBlueprintNextTime.set(u.id, this.simTime + 0.85);
          const bp = this.findNextBlueprintSite(nation, u.id, u.carryType, u.carryAmount, u.x, u.y);
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
        }

        const dropOff = this.getClosestNationDropoff(nation, u.x, u.y);
        this.moveTowards(u, dropOff.x, dropOff.y, dt, speedMult);
        if (Math.hypot(u.x - dropOff.x, u.y - dropOff.y) < 2.3) {
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
        const nextCheck = this.unitBlueprintNextTime.get(u.id) ?? 0;
        const bp =
          this.simTime >= nextCheck
            ? this.findNextBlueprintSite(nation, u.id, u.carryType, u.carryAmount, u.x, u.y)
            : null;
        if (this.simTime >= nextCheck) {
          this.unitBlueprintNextTime.set(u.id, this.simTime + (bp && bp.affordable ? 0.25 : 0.9));
        }
        const needGather = !bp || !bp.affordable || nation.scrap < 18 || Math.random() < 0.08;

        if (!needGather && bp && bp.affordable) {
          this.activeBuilderTargets.add(bp.y * GRID_W + bp.x);
          u.targetX = bp.x + 0.5;
          u.targetY = bp.y + 0.5;
          u.buildProp = bp.prop;
          u.buildVariant = bp.variant;
          u.hasTarget = true;
        } else {
          // Occasionally step into a Workshop or Mattress Hut across any district between construction shifts
          if ((u.visitCooldown ?? 0) <= 0 && Math.random() < 0.22) {
            const breakSpot = this.pickDistributedFriendlyBuilding(nation.id, u.id, 75, [
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
            const anchor = this.getDistributedDistrictAnchor(nation, u.id, [
              PropType.WORKSHOP,
              PropType.TECH_LAB,
              PropType.MATTRESS_HUT,
            ]);
            const a = Math.random() * Math.PI * 2;
            const rad = 4 + Math.random() * 12;
            u.targetX = Math.max(2, Math.min(GRID_W - 2, anchor.x + Math.cos(a) * rad));
            u.targetY = Math.max(2, Math.min(GRID_H - 2, anchor.y + Math.sin(a) * rad));
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
      // Meatball Chefs staff Bistros across the entire realm (including outer districts & union hubs)
      if ((u.visitCooldown ?? 0) <= 0) {
        const bistro = this.pickDistributedFriendlyBuilding(nation.id, u.id, 85, [PropType.BISTRO]);
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
        const anchor = this.getDistributedDistrictAnchor(nation, u.id, [PropType.BISTRO]);
        const a = Math.random() * Math.PI * 2;
        const rad = 1.5 + Math.random() * 5.0;
        u.targetX = Math.max(2, Math.min(GRID_W - 2, anchor.x + Math.cos(a) * rad));
        u.targetY = Math.max(2, Math.min(GRID_H - 2, anchor.y + Math.sin(a) * rad));
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
          if (ally.nationId === nation.id && this.isNationCitizen(ally)) {
            ally.hunger = Math.max(0, ally.hunger - 22);
            if (ally.hp < ally.maxHp) ally.hp = Math.min(ally.maxHp, ally.hp + 5);
          }
        });
      }
      this.moveTowards(u, u.targetX, u.targetY, dt, speedMult * 0.9);
      return;
    }

    if (u.role === SurvivorRole.TINKER) {
      // Wrench Tinkers staff Workshops, Archives & SCP-IKEA Tech Labs across outer districts too
      if ((u.visitCooldown ?? 0) <= 0) {
        const shop = this.pickDistributedFriendlyBuilding(nation.id, u.id, 85, [
          PropType.TECH_LAB,
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
        const anchor = this.getDistributedDistrictAnchor(nation, u.id, [
          PropType.TECH_LAB,
          PropType.WORKSHOP,
          PropType.ARCHIVE,
        ]);
        const a = Math.random() * Math.PI * 2;
        const rad = 2.0 + Math.random() * 6.5;
        u.targetX = Math.max(2, Math.min(GRID_W - 2, anchor.x + Math.cos(a) * rad));
        u.targetY = Math.max(2, Math.min(GRID_H - 2, anchor.y + Math.sin(a) * rad));
        u.hasTarget = true;
      }
      if (u.aiTimer <= 0) {
        u.aiTimer = 3.5;
        const schemMult = hasTech(nation, 'swedish_schematics') ? 1.3 : 1.0;
        const shopBonus = Math.min(
          1.8,
          ((nation.buildings?.workshops || 0) + (nation.buildings?.archives || 0) + (nation.buildings?.techLabs || 0)) *
            0.35
        );
        nation.allenWrenches += (0.85 + shopBonus) * schemMult;
        if (nation.activeResearchId && (nation.buildings?.techLabs || 0) > 0) {
          nation.researchPoints = (nation.researchPoints || 0) + 0.65 * schemMult;
        }
        if (Math.random() < 0.3) {
          u.chatEmoji = (nation.buildings?.techLabs || 0) > 0 ? '🔬' : '🔧';
          u.chatTimer = 1.8;
        }
      }
      this.moveTowards(u, u.targetX, u.targetY, dt, speedMult * 0.95);
      return;
    }

    if (u.role === SurvivorRole.TRADER) {
      // Kingdom Merchant Traders staff Cart Depots & Bistros across the entire realm & union hubs
      if ((u.visitCooldown ?? 0) <= 0) {
        const hub = this.pickDistributedFriendlyBuilding(nation.id, u.id, 90, [
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
        if (nation.unionHubs && nation.unionHubs.length > 0 && Math.random() < (this.isNight ? 0.55 : 0.42)) {
          const hub = nation.unionHubs[(Math.random() * nation.unionHubs.length) | 0];
          u.targetX = hub.x + (Math.random() - 0.5) * 4;
          u.targetY = hub.y + (Math.random() - 0.5) * 4;
          u.hasTarget = true;
        } else if (unionPartner && Math.random() < (this.isNight ? 0.45 : 0.32)) {
          u.targetX = unionPartner.capitalX + (Math.random() - 0.5) * 4;
          u.targetY = unionPartner.capitalY + (Math.random() - 0.5) * 4;
          u.hasTarget = true;
        } else {
          const anchor = this.getDistributedDistrictAnchor(nation, u.id, [
            PropType.CART_DEPOT,
            PropType.BISTRO,
          ]);
          const a = Math.random() * Math.PI * 2;
          const rad = 2 + Math.random() * 8.0;
          u.targetX = Math.max(2, Math.min(GRID_W - 2, anchor.x + Math.cos(a) * rad));
          u.targetY = Math.max(2, Math.min(GRID_H - 2, anchor.y + Math.sin(a) * rad));
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

    // Peaceful / Garrison Guard AI: respond to outer building distress alerts, man outer Watchtowers, & patrol outer infrastructure
    const alert = this.nationBuildingAlert.get(nation.id);
    if (alert && alert.until > this.simTime) {
      const distAlert = Math.hypot(alert.x - u.x, alert.y - u.y);
      if (distAlert <= 62 || u.id % 2 === 0) {
        u.visitTargetIdx = -1;
        u.targetX = alert.x;
        u.targetY = alert.y;
        u.hasTarget = true;
        this.moveTowards(u, alert.x, alert.y, dt, speedMult * 1.18);
        return;
      }
    }

    if ((u.visitCooldown ?? 0) <= 0 && Math.random() < dt * 0.28) {
      const tower = this.pickDistributedFriendlyBuilding(nation.id, u.id, 85, [PropType.WATCHTOWER]);
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
      u.aiTimer = 2.6 + Math.random() * 1.8;
      const outerPt = this.getGuardPatrolTarget(nation, u.id, u);
      u.targetX = outerPt.x;
      u.targetY = outerPt.y;
      u.hasTarget = true;
    }
    this.moveTowards(u, u.targetX, u.targetY, dt, speedMult);

    if (this.hasAnyActiveWar || u.feverTimer > 0) {
      const gx = Math.max(1, Math.min(GRID_W - 2, u.x | 0));
      const gy = Math.max(1, Math.min(GRID_H - 2, u.y | 0));
      this.captureUndefendedEnemyPocket(nation, gx, gy, 1);
      this.attackEnemyFortification(u, nation);
    }
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
      p === PropType.WATCHTOWER ||
      p === PropType.TECH_LAB
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
    let b1: { x: number; y: number; idx: number; prop: PropType } | null = null;
    let b2: { x: number; y: number; idx: number; prop: PropType } | null = null;
    let b3: { x: number; y: number; idx: number; prop: PropType } | null = null;
    let d1 = Infinity;
    let d2 = Infinity;
    let d3 = Infinity;

    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (this.propOwner[b.idx] !== nationId || this.prop[b.idx] !== b.prop) continue;
      if (!types.includes(b.prop)) continue;
      const dx = b.x - sx;
      const dy = b.y - sy;
      const dSq = dx * dx + dy * dy;
      if (dSq > maxRadSq) continue;
      if (dSq < d1) {
        d3 = d2; b3 = b2;
        d2 = d1; b2 = b1;
        d1 = dSq; b1 = b;
      } else if (dSq < d2) {
        d3 = d2; b3 = b2;
        d2 = dSq; b2 = b;
      } else if (dSq < d3) {
        d3 = dSq; b3 = b;
      }
    }

    if (!b1) return null;
    const count = b3 ? 3 : b2 ? 2 : 1;
    const pick = count === 1 ? b1 : count === 2 ? (Math.random() < 0.5 ? b1 : b2!) : (Math.random() < 0.34 ? b1 : Math.random() < 0.5 ? b2! : b3!);
    return { x: pick.x, y: pick.y, idx: pick.idx, prop: pick.prop };
  }

  private pickDistributedFriendlyBuilding(
    nationId: number,
    unitId: number,
    maxRad: number,
    types: PropType[]
  ): { x: number; y: number; idx: number; prop: PropType } | null {
    const list = this.nationBuildingsCache.get(nationId);
    if (!list || list.length === 0) return null;
    const n = this.getNation(nationId);
    const cx = n ? n.capitalX : 0;
    const cy = n ? n.capitalY : 0;
    const maxRadSq = maxRad * maxRad;

    let matches = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (this.propOwner[b.idx] !== nationId || this.prop[b.idx] !== b.prop) continue;
      if (!types.includes(b.prop)) continue;
      const dx = b.x - cx;
      const dy = b.y - cy;
      if (dx * dx + dy * dy <= maxRadSq) matches++;
    }
    if (matches === 0) return null;

    const targetOrdinal = (unitId + ((this.simTime * 0.15) | 0)) % matches;
    let seen = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (this.propOwner[b.idx] !== nationId || this.prop[b.idx] !== b.prop) continue;
      if (!types.includes(b.prop)) continue;
      const dx = b.x - cx;
      const dy = b.y - cy;
      if (dx * dx + dy * dy > maxRadSq) continue;
      if (seen === targetOrdinal) {
        return { x: b.x, y: b.y, idx: b.idx, prop: b.prop };
      }
      seen++;
    }
    return null;
  }

  private getDistributedDistrictAnchor(
    nation: Nation,
    unitId: number,
    types: PropType[]
  ): { x: number; y: number } {
    const bld = this.pickDistributedFriendlyBuilding(nation.id, unitId, 95, types);
    if (bld) {
      return { x: bld.x + 0.5, y: bld.y + 0.5 };
    }
    if (nation.unionHubs && nation.unionHubs.length > 0 && unitId % 3 === 0) {
      const hub = nation.unionHubs[unitId % nation.unionHubs.length];
      return { x: hub.x + 0.5, y: hub.y + 0.5 };
    }
    return { x: nation.capitalX + 0.5, y: nation.capitalY + 0.5 };
  }

  private getClosestNationDropoff(nation: Nation, ux: number, uy: number): { x: number; y: number } {
    let bestX = nation.capitalX + 0.5;
    let bestY = nation.capitalY + 0.5;
    let bestDSq = (bestX - ux) * (bestX - ux) + (bestY - uy) * (bestY - uy);

    if (nation.unionHubs) {
      for (let i = 0; i < nation.unionHubs.length; i++) {
        const h = nation.unionHubs[i];
        const hx = h.x + 0.5;
        const hy = h.y + 0.5;
        const dSq = (hx - ux) * (hx - ux) + (hy - uy) * (hy - uy);
        if (dSq < bestDSq) {
          bestDSq = dSq;
          bestX = hx;
          bestY = hy;
        }
      }
    }

    const list = this.nationBuildingsCache.get(nation.id);
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (
          b.prop !== PropType.CART_DEPOT &&
          b.prop !== PropType.WORKSHOP &&
          b.prop !== PropType.BISTRO &&
          b.prop !== PropType.TECH_LAB
        ) {
          continue;
        }
        if (this.propOwner[b.idx] !== nation.id || this.prop[b.idx] !== b.prop) continue;
        const bx = b.x + 0.5;
        const by = b.y + 0.5;
        const dSq = (bx - ux) * (bx - ux) + (by - uy) * (by - uy);
        if (dSq < bestDSq) {
          bestDSq = dSq;
          bestX = bx;
          bestY = by;
        }
      }
    }
    return { x: bestX, y: bestY };
  }

  private getClosestLitSafePoint(nation: Nation, ux: number, uy: number): { x: number; y: number } {
    let bestX = nation.capitalX + 0.5;
    let bestY = nation.capitalY + 0.5;
    let bestDSq = (bestX - ux) * (bestX - ux) + (bestY - uy) * (bestY - uy);

    for (let i = 0; i < this.lightSourceIndices.length; i++) {
      const idx = this.lightSourceIndices[i];
      if (this.propOwner[idx] !== nation.id || this.disabledLightMap[idx] > 0) continue;
      const lx = (idx % GRID_W) + 0.5;
      const ly = ((idx / GRID_W) | 0) + 0.5;
      const dSq = (lx - ux) * (lx - ux) + (ly - uy) * (ly - uy);
      if (dSq < bestDSq) {
        bestDSq = dSq;
        bestX = lx;
        bestY = ly;
      }
    }
    return { x: bestX, y: bestY };
  }

  private getGuardPatrolTarget(nation: Nation, unitId: number, guardUnit?: Unit): { x: number; y: number } {
    const list = this.nationBuildingsCache.get(nation.id);
    const hubs = nation.unionHubs;
    const checkpoints = nation.unionCheckpoints;

    // Stationed Union Corridor Escort Guards remain anchored near their assigned corridor checkpoint
    if (guardUnit && guardUnit.guardPostX !== undefined && guardUnit.guardPostY !== undefined) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 4;
      return {
        x: Math.max(2, Math.min(GRID_W - 2, guardUnit.guardPostX + Math.cos(a) * r)),
        y: Math.max(2, Math.min(GRID_H - 2, guardUnit.guardPostY + Math.sin(a) * r)),
      };
    }

    // Dedicated Capital Garrison (~30% of Guards) watches the 4 Capital Citadel entrances & Checkout Flag
    if (unitId % 3 === 0) {
      const { radius: R } = this.getCapitalPerimeterInfo(nation);
      const gatePick = (unitId + ((this.simTime * 0.18) | 0)) % 4;
      const gOffX = gatePick === 0 ? 0 : gatePick === 1 ? 0 : gatePick === 2 ? -R : R;
      const gOffY = gatePick === 0 ? -R : gatePick === 1 ? R : 0;
      const tx = Math.max(2, Math.min(GRID_W - 2, nation.capitalX + gOffX + (Math.random() - 0.5) * 3.5));
      const ty = Math.max(2, Math.min(GRID_H - 2, nation.capitalY + gOffY + (Math.random() - 0.5) * 3.5));
      const tIdx = (ty | 0) * GRID_W + (tx | 0);
      if (this.isNight && this.lightMap[tIdx] === 0) {
        return this.getClosestLitSafePoint(nation, tx, ty);
      }
      return { x: tx, y: ty };
    }

    // Patrol Union Corridor Checkpoints & Union Hubs so night trade stays protected
    const roll = (unitId + ((this.simTime * 0.25) | 0)) % 10;
    if (checkpoints && checkpoints.length > 0 && (roll === 2 || roll === 3)) {
      const cp = checkpoints[unitId % checkpoints.length];
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 4.5;
      return {
        x: Math.max(2, Math.min(GRID_W - 2, cp.x + Math.cos(a) * r)),
        y: Math.max(2, Math.min(GRID_H - 2, cp.y + Math.sin(a) * r)),
      };
    }
    if (hubs && hubs.length > 0 && roll < 2) {
      const hub = hubs[unitId % hubs.length];
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 6;
      return {
        x: Math.max(2, Math.min(GRID_W - 2, hub.x + 0.5 + Math.cos(a) * r)),
        y: Math.max(2, Math.min(GRID_H - 2, hub.y + 0.5 + Math.sin(a) * r)),
      };
    }

    if (list && list.length > 0 && roll < 8) {
      // Pick across ALL buildings so outer Watchtowers/Tech Labs/Workshops/Bistros get active guard patrols
      const b = list[(unitId * 7 + ((Math.random() * list.length) | 0)) % list.length];
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 4.5;
      return {
        x: Math.max(2, Math.min(GRID_W - 2, b.x + 0.5 + Math.cos(a) * r)),
        y: Math.max(2, Math.min(GRID_H - 2, b.y + 0.5 + Math.sin(a) * r)),
      };
    }

    // Perimeter patrol around capital scaled to actual realm radius
    const realmRad = Math.min(34, Math.max(8, Math.sqrt(Math.max(36, nation.territoryTiles)) * 0.55));
    const a = Math.random() * Math.PI * 2;
    const r = (this.isNight ? 0.4 : 0.5) * realmRad + Math.random() * (realmRad * 0.5);
    const tx = Math.max(2, Math.min(GRID_W - 2, nation.capitalX + Math.cos(a) * r));
    const ty = Math.max(2, Math.min(GRID_H - 2, nation.capitalY + Math.sin(a) * r));
    const tIdx = (ty | 0) * GRID_W + (tx | 0);
    if (this.isNight && this.lightMap[tIdx] === 0) {
      return this.getClosestLitSafePoint(nation, tx, ty);
    }
    return { x: tx, y: ty };
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
    if (p === PropType.TECH_LAB) {
      this.techLabIndices.push(idx);
      this.dirtyLight = true;
    }
    if (p === PropType.ESCALATOR) {
      this.escalatorIndices.push(idx);
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
        p === PropType.SPOTLIGHT ||
        p === PropType.TECH_LAB ||
        p === PropType.ESCALATOR)
    ) {
      const n = ownerId >= 0 ? this.getNation(ownerId) : undefined;
      this.recentBuilds.push({
        x,
        y,
        color: n ? n.color : '#22d3ee',
        life: 2.8,
        maxLife: 2.8,
      });
      if (this.isNearCamera(x, y)) {
        soundFX.playBuild();
      }
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
        if (Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 2) continue;
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
      if (p === PropType.NONE || p === PropType.LAMP || p === PropType.CHECKOUT_FLAG || p === PropType.ESCALATOR) return true;
      if (p === PropType.BARRICADE_GATE) {
        const owner = this.propOwner[idx];
        if (u.kind === UnitKind.CART_RUNNER && !u.isSiegeCart) {
          // Trade carts pass through unowned gates and any non-hostile, non-embargoing nation's road gates
          return (
            owner < 0 ||
            (u.nationId >= 0 &&
              !this.areHostile(u.nationId, owner) &&
              this.getStance(u.nationId, owner) !== 'EMBARGO')
          );
        }
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
      // Slide perpendicular along obstacle; try both directions (prefer walkways for carts)
      const perpX = (-dy / dist) * step;
      const perpY = (dx / dist) * step;
      const opt1 = canWalk(u.x + perpX, u.y + perpY);
      const opt2 = canWalk(u.x - perpX, u.y - perpY);
      if (opt1 && opt2 && u.kind === UnitKind.CART_RUNNER) {
        const idx1 = ((u.y + perpY) | 0) * GRID_W + ((u.x + perpX) | 0);
        const onRoad1 = this.biome[idx1] === BiomeType.WALKWAY;
        u.x += onRoad1 ? perpX : -perpX;
        u.y += onRoad1 ? perpY : -perpY;
      } else if (opt1) {
        u.x += perpX;
        u.y += perpY;
      } else if (opt2) {
        u.x -= perpX;
        u.y -= perpY;
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
        if (u.kind === UnitKind.CART_RUNNER && !u.isSiegeCart) {
          // Sidestep around third-party walls/sanctions so trade routes never deadlock
          const perpAng = Math.atan2(dy, dx) + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
          const sidex = Math.max(2, Math.min(GRID_W - 2, u.x + Math.cos(perpAng) * 3.5));
          const sidey = Math.max(2, Math.min(GRID_H - 2, u.y + Math.sin(perpAng) * 3.5));
          if (canWalk(sidex, sidey)) {
            u.x = sidex;
            u.y = sidey;
          }
        } else {
          // Clear target & pick fresh nearby direction
          u.hasTarget = false;
          const randA = Math.random() * Math.PI * 2;
          u.targetX = Math.max(2, Math.min(GRID_W - 2, u.x + Math.cos(randA) * 7));
          u.targetY = Math.max(2, Math.min(GRID_H - 2, u.y + Math.sin(randA) * 7));
        }
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
      this.isNationCitizen(victim) && victim.nationId >= 0
        ? this.getNation(victim.nationId)
        : undefined;

    if (victimNation && atkNation && atkNation.id !== victimNation.id) {
      victimNation.lastAttackerNationId = atkNation.id;
      victimNation.lastAttackedDay = this.day;
    }

    victim.hp -= dmg;
    victim.hitFlash = 0.14;
    if (attacker && this.isNearCamera(victim.x, victim.y)) {
      soundFX.playMeleeHit();
    }
    if (victim.hp <= 0) {
      victim.alive = false;
      this.deadUnitsCount++;
      if (this.isNearCamera(victim.x, victim.y)) {
        soundFX.playDeath(isStaffKind(victim.kind));
      }
      if (attacker) {
        attacker.kills++;
        if (
          this.isNationCitizen(attacker) &&
          attacker.alive &&
          !attacker.veteranTitle &&
          (attacker.kills >= 3 ||
            victim.kind === UnitKind.STAFF_DIRECTOR ||
            victim.kind === UnitKind.STAFF_MANAGER ||
            victim.kind === UnitKind.STAFF_FORKLIFT ||
            victim.kind === UnitKind.STAFF_WARDEN)
        ) {
          attacker.veteranTitle =
            victim.kind === UnitKind.STAFF_DIRECTOR
              ? 'Director-Slayer'
              : victim.kind === UnitKind.STAFF_MANAGER
                ? 'Manager-Slayer'
                : victim.kind === UnitKind.STAFF_FORKLIFT
                  ? 'Forklift-Wrecker'
                  : victim.kind === UnitKind.STAFF_WARDEN
                    ? 'Warden-Breaker'
                    : attacker.role === SurvivorRole.GENERAL
                      ? 'Grand Marshal'
                      : attacker.role === SurvivorRole.GUARD
                        ? 'Aisle Champion'
                        : 'Store Veteran';
          attacker.maxHp += victim.kind === UnitKind.STAFF_DIRECTOR ? 35 : 20;
          attacker.hp = Math.min(attacker.maxHp, attacker.hp + 35);
          attacker.atk += victim.kind === UnitKind.STAFF_DIRECTOR ? 5 : 3;
          this.spawnParticleBurst(attacker.x, attacker.y, '#fbbf24', 8);
          this.spawnFloatingText(attacker.x, attacker.y - 1.4, `★ ${attacker.veteranTitle}!`, '#fbbf24');
          attacker.chatEmoji = '⭐';
          attacker.chatTimer = 2.2;
        }
      }
      if (victim.kind === UnitKind.STAFF_DIRECTOR && victim.nationId < 0) {
        if (atkNation && atkNation.alive) {
          atkNation.meatballs += 80;
          atkNation.scrap += 80;
          atkNation.allenWrenches += 65;
          atkNation.firearms = (atkNation.firearms || 0) + 8;
          atkNation.civilianGoods = (atkNation.civilianGoods || 0) + 8;
          this.addNews(
            'CONQUEST',
            `${atkNation.name} slew the Rogue Store Director and seized +80 Meatballs, +65 Wrenches & +8 Firearms!`
          );
          this.addChronicle(
            'AUDIT',
            `Store Director Defeated by ${atkNation.name}`,
            `Slain on Day ${this.day}, yielding executive stores and weaponry.`,
            atkNation.color
          );
        } else {
          this.addNews('STAFF', `The Rogue SCP-3008-2 Store Director was defeated on Day ${this.day}!`);
        }
        this.spawnParticleBurst(victim.x, victim.y, '#ffda1a', 18);
        this.spawnFloatingText(victim.x, victim.y - 1.5, 'DIRECTOR SLAIN! +LOOT', '#ffda1a');
        soundFX.playPower();
      }
      if (isStaffKind(victim.kind) && victim.nationId < 0) {
        this.records.totalStaffSlain += 1;
        this.recentStaffSlainWindow += 1;
      } else if (this.isNationCitizen(victim)) {
        this.records.totalSurvDeaths += 1;
      }
      this.spawnParticleBurst(
        victim.x,
        victim.y,
        isStaffKind(victim.kind) ? '#fde047' : '#ef4444',
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

        const hasAnyLivingCitizen =
          (this.hibernatedNationPop.get(victimNation.id) ?? 0) > 0 ||
          this.units.some(
            (other) =>
              other.alive &&
              this.isNationCitizen(other) &&
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
      let hitUnit: Unit | null = null;
      this.spatialHash.queryRadius(this.units, p.x, p.y, 1.1, (u) => {
        if (hit || (u.insideTimer ?? 0) > 0) return;
        const isEnemy =
          p.nationId < 0
            ? u.nationId >= 0 || u.kind === UnitKind.SURVIVOR || u.kind === UnitKind.CART_RUNNER
            : (isStaffKind(u.kind) && u.nationId < 0 && !u.pacified && this.isNight) ||
              (u.nationId >= 0 && u.nationId !== p.nationId && this.areHostile(p.nationId, u.nationId));
        if (isEnemy) {
          this.damageUnit(u, p.damage, undefined, p.nationId >= 0 ? p.nationId : undefined);
          hit = true;
          hitUnit = u;
        }
      });
      if (hit && p.arcChain && hitUnit) {
        const primary = hitUnit as Unit;
        let chained = false;
        this.spatialHash.queryRadius(this.units, primary.x, primary.y, 3.4, (other) => {
          if (chained || other.id === primary.id || (other.insideTimer ?? 0) > 0) return;
          const isChainTarget =
            (isStaffKind(other.kind) && other.nationId < 0 && !other.pacified && this.isNight) ||
            (p.nationId >= 0 &&
              other.nationId >= 0 &&
              other.nationId !== p.nationId &&
              this.areHostile(p.nationId, other.nationId));
          if (isChainTarget) {
            chained = true;
            this.damageUnit(
              other,
              Math.round(p.damage * 0.55),
              undefined,
              p.nationId >= 0 ? p.nationId : undefined
            );
            this.spawnParticleBurst(other.x, other.y, '#e879f9', 4);
          }
        });
      }
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
          const r = Math.random();
          const kind =
            r < 0.25
              ? UnitKind.STAFF_CRAWLER
              : r < 0.37
                ? UnitKind.STAFF_WARDEN
                : r < 0.45
                  ? UnitKind.STAFF_STALKER
                  : UnitKind.STAFF_NORMAL;
          this.spawnStaff(
            kind,
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
      case 'spawn_warden': {
        this.spawnStaff(UnitKind.STAFF_WARDEN, tx + 0.5, ty + 0.5);
        this.addNews('STAFF', 'An armored SCP-3008-2 Aisle Warden began smashing barricades!');
        soundFX.playChime(160, 0.16, 'sawtooth');
        break;
      }
      case 'spawn_stalker': {
        this.spawnStaff(UnitKind.STAFF_STALKER, tx + 0.5, ty + 0.5);
        this.addNews('STAFF', 'A fast SCP-3008-2 Blackout Stalker is hunting spotlights!');
        soundFX.playChime(210, 0.14, 'sawtooth');
        break;
      }
      case 'spawn_announcer': {
        this.spawnStaff(UnitKind.STAFF_ANNOUNCER, tx + 0.5, ty + 0.5);
        this.addNews('STAFF', 'An SCP-3008-2 PA Hound sounded the closing siren!');
        soundFX.playChime(240, 0.16, 'square');
        break;
      }
      case 'spawn_forklift': {
        this.spawnStaff(UnitKind.STAFF_FORKLIFT, tx + 0.5, ty + 0.5);
        this.addNews('STAFF', 'A heavy SCP-3008-2 Forklift Juggernaut rolled into the aisle!');
        soundFX.playChime(135, 0.18, 'sawtooth');
        break;
      }
      case 'spawn_thrower': {
        this.spawnStaff(UnitKind.STAFF_THROWER, tx + 0.5, ty + 0.5);
        this.addNews('STAFF', 'An SCP-3008-2 Shelf Quartermaster began hurling pallet shards!');
        soundFX.playChime(205, 0.14, 'triangle');
        break;
      }
      case 'spawn_disruptor': {
        this.spawnStaff(UnitKind.STAFF_DISRUPTOR, tx + 0.5, ty + 0.5);
        this.addNews('STAFF', 'An SCP-3008-2 Barcode Scanner is jamming spotlights & turrets!');
        soundFX.playChime(280, 0.14, 'sine');
        break;
      }
      case 'spawn_director': {
        this.spawnStaff(UnitKind.STAFF_DIRECTOR, tx + 0.5, ty + 0.5);
        this.spawnParticleBurst(tx + 0.5, ty + 0.5, '#f43f5e', 16);
        this.spawnFloatingText(tx + 0.5, ty - 1.3, 'BOSS: STORE DIRECTOR!', '#f43f5e');
        this.addNews('STAFF', 'A Rogue SCP-3008-2 Store Director Boss appeared on the showroom floor!');
        soundFX.playInvasionAlert(true);
        this.staffInvasionScanTimer = 0;
        break;
      }
      case 'spawn_trader': {
        this.spawnSurvivor(-1, SurvivorRole.TRADER, tx + 0.5, ty + 0.5);
        soundFX.playChime(640, 0.07);
        break;
      }
      case 'spawn_caravan': {
        this.spawnCaravan(tx + 0.5, ty + 0.5);
        soundFX.playChime(660, 0.09);
        break;
      }
      case 'spawn_mercenary': {
        this.spawnMercenary(tx + 0.5, ty + 0.5);
        soundFX.playChime(520, 0.09);
        break;
      }
      case 'paint_food':
      case 'paint_warehouse':
      case 'paint_showroom':
      case 'paint_dark':
      case 'paint_road':
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
            } else if (tool === 'paint_road') {
              this.biome[idx] = BiomeType.WALKWAY;
              if (this.prop[idx] !== PropType.NONE && this.propOwner[idx] === -1) {
                this.prop[idx] = PropType.NONE;
                this.propHp[idx] = 0;
              }
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
          const inSummit = Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 1;
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
          if (isStaffKind(u.kind)) {
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
          if (this.day >= 25 && this.day % 25 === 0) {
            this.triggerDirectorBossEvent();
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
            if (Math.hypot(nx - this.summitLocalX, ny - this.summitLocalY) <= SUMMIT_RADIUS + 1) continue;
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
      case 'power_anomaly': {
        const anomaly = this.triggerStoreAnomaly();
        this.spawnParticleBurst(tx, ty, anomaly.color, 20);
        this.spawnFloatingText(tx, ty - 1.3, `ANOMALY: ${anomaly.label.toUpperCase()}!`, anomaly.color);
        break;
      }
      case 'power_supply_drop': {
        const dropR = Math.max(2, rad - 1);
        let dropped = 0;
        for (let dy = -dropR; dy <= dropR; dy += 2) {
          for (let dx = -dropR; dx <= dropR; dx += 2) {
            if (dropped >= 6) break;
            const nx = tx + dx;
            const ny = ty + dy;
            if (nx <= 2 || nx >= GRID_W - 2 || ny <= 2 || ny >= GRID_H - 2) continue;
            if (Math.hypot(nx - this.summitLocalX, ny - this.summitLocalY) <= SUMMIT_RADIUS + 1) continue;
            const idx = ny * GRID_W + nx;
            if (this.prop[idx] !== PropType.NONE) continue;
            const kind = dropped % 3 === 0 ? PropType.MEATBALL_VAT : dropped % 3 === 1 ? PropType.WOOD_PALLET : PropType.SHELF;
            this.prop[idx] = kind;
            this.propHp[idx] = 120;
            this.propMaxHp[idx] = 120;
            this.propOwner[idx] = -1;
            dropped++;
          }
        }
        const terr = this.territory[ty * GRID_W + tx];
        const n = terr >= 0 ? this.getNation(terr) : undefined;
        if (n && n.alive) {
          n.meatballs += 40;
          n.scrap += 40;
          n.allenWrenches += 25;
          n.firearms = (n.firearms || 0) + 2;
          n.civilianGoods = (n.civilianGoods || 0) + 2;
        }
        if (dropped > 0) this.dirtyMap = true;
        this.spawnParticleBurst(tx, ty, '#fbbf24', 18);
        this.spawnFloatingText(tx, ty - 1.2, 'SUPPLY PARCEL DROP!', '#fbbf24');
        soundFX.playPower();
        break;
      }
      case 'power_pacify_staff': {
        let pacified = 0;
        this.spatialHash.queryRadius(this.units, tx, ty, rad + 4, (u) => {
          if (isStaffKind(u.kind) && u.nationId < 0) {
            u.pacified = true;
            u.feverTimer = 0;
            u.hasTarget = false;
            u.chatEmoji = '🕊️';
            u.chatTimer = 2.6;
            pacified++;
          }
        });
        this.spawnParticleBurst(tx, ty, '#34d399', 18);
        this.spawnFloatingText(
          tx,
          ty - 1.2,
          pacified > 0 ? `STAFF PACIFIED (${pacified})!` : 'TAMED STAFF AURA',
          '#34d399'
        );
        soundFX.playPower();
        break;
      }
      case 'power_prosperity': {
        const terr = this.territory[ty * GRID_W + tx];
        const targetNation =
          terr >= 0
            ? this.getNation(terr)
            : this.nations.find((n) => n.alive && Math.hypot(n.capitalX - tx, n.capitalY - ty) < 28);
        if (targetNation && targetNation.alive) {
          targetNation.happiness = Math.min(100, targetNation.happiness + 12);
          targetNation.meatballs += 50;
          targetNation.scrap += 50;
          targetNation.allenWrenches += 35;
          targetNation.civilianGoods = (targetNation.civilianGoods || 0) + 4;
          targetNation.firearms = (targetNation.firearms || 0) + 3;
          for (let i = 0; i < 2; i++) {
            const role = this.pickNeededJobForNation(targetNation, false);
            this.spawnSurvivor(
              targetNation.id,
              role,
              targetNation.capitalX + (Math.random() - 0.5) * 3,
              targetNation.capitalY + (Math.random() - 0.5) * 3
            );
          }
          this.recountTerritoryAndHousing();
          this.spawnParticleBurst(tx, ty, '#ffda1a', 20);
          this.spawnFloatingText(tx, ty - 1.3, 'GOLDEN PROSPERITY!', '#ffda1a');
          this.addNews('GOD', `Golden Age Prosperity blessed ${targetNation.name}!`);
          soundFX.playPower();
        } else {
          this.spawnFloatingText(tx, ty - 1, 'Tap a Kingdom for Prosperity', '#cbd5e1');
        }
        break;
      }
      case 'power_vortex': {
        let pulled = 0;
        this.spatialHash.queryRadius(this.units, tx, ty, rad + 5, (u) => {
          const dx = tx + 0.5 - u.x;
          const dy = ty + 0.5 - u.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d > 0.6) {
            u.x = Math.max(1.5, Math.min(GRID_W - 1.5, u.x + (dx / d) * Math.min(d * 0.72, 4.5)));
            u.y = Math.max(1.5, Math.min(GRID_H - 1.5, u.y + (dy / d) * Math.min(d * 0.72, 4.5)));
          }
          if (isStaffKind(u.kind) && u.nationId < 0) {
            this.damageUnit(u, 28);
          }
          pulled++;
        });
        this.spawnParticleBurst(tx, ty, '#a855f7', 22);
        this.spawnFloatingText(tx, ty - 1.3, pulled > 0 ? `AISLE VORTEX (${pulled})!` : 'AISLE VORTEX!', '#a855f7');
        soundFX.playChime(320, 0.16, 'triangle');
        break;
      }
      case 'power_enlighten': {
        const terr = this.territory[ty * GRID_W + tx];
        const targetNation =
          terr >= 0
            ? this.getNation(terr)
            : this.nations.find((n) => n.alive && Math.hypot(n.capitalX - tx, n.capitalY - ty) < 28);
        if (targetNation && targetNation.alive) {
          targetNation.researchPoints = (targetNation.researchPoints || 0) + 85;
          if (!targetNation.activeResearchId) {
            const unlocked = new Set(targetNation.researchedTechs || []);
            const nextNode = RESEARCH_TREE.find(
              (node) => !unlocked.has(node.id) && canResearchTech(targetNation, node)
            );
            if (nextNode) {
              targetNation.activeResearchId = nextNode.id;
            }
          }
          if (targetNation.activeResearchId) {
            const node = RESEARCH_BY_ID[targetNation.activeResearchId];
            if (node && (targetNation.researchPoints || 0) >= node.cost) {
              targetNation.researchPoints = Math.max(0, (targetNation.researchPoints || 0) - node.cost);
              if (!targetNation.researchedTechs) targetNation.researchedTechs = [];
              if (!targetNation.researchedTechs.includes(node.id)) {
                targetNation.researchedTechs.push(node.id);
              }
              this.applyTechUnlockEffects(targetNation, node.id);
              targetNation.activeResearchId = null;
              this.addNews('GOD', `Divine Epiphany: ${targetNation.name} instantly completed ${node.name}!`);
            }
          }
          this.spawnParticleBurst(tx, ty, '#22d3ee', 20);
          this.spawnFloatingText(tx, ty - 1.3, 'BLUEPRINT EPIPHANY!', '#22d3ee');
          soundFX.playPower();
        } else {
          this.spawnFloatingText(tx, ty - 1, 'Tap a Kingdom to Enlighten', '#cbd5e1');
        }
        break;
      }
      case 'build_spotlight':
      case 'build_watchtower':
      case 'build_wall':
      case 'build_bistro':
      case 'build_tech_lab':
      case 'build_escalator': {
        const idx = ty * GRID_W + tx;
        const inSummit = Math.hypot(tx - this.summitLocalX, ty - this.summitLocalY) <= SUMMIT_RADIUS + 1;
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
                : tool === 'build_tech_lab'
                  ? PropType.TECH_LAB
                  : tool === 'build_escalator'
                    ? PropType.ESCALATOR
                    : PropType.BARRICADE_WALL;
        const baseHp =
          propType === PropType.WATCHTOWER
            ? 190
            : propType === PropType.TECH_LAB
              ? 185
              : propType === PropType.ESCALATOR
                ? 210
                : 150;
        const hp =
          ownerNation &&
          hasTech(ownerNation, 'flatpack_automation') &&
          (propType === PropType.WATCHTOWER || propType === PropType.BARRICADE_WALL || propType === PropType.TECH_LAB)
            ? Math.round(baseHp * 1.45)
            : baseHp;
        const variant = propType === PropType.BARRICADE_WALL ? 1 + ((tx + ty) % 4) : 0;
        this.ejectBuildingOccupants(idx);
        this.placeNationProp(tx, ty, propType, hp, ownerId, variant);
        if (ownerId >= 0 && this.territory[idx] === -1) {
          this.territory[idx] = ownerId;
          this.dirtyMap = true;
        }
        this.dirtyLight = true;
        this.recountTerritoryAndHousing();
        this.spawnParticleBurst(tx + 0.5, ty + 0.5, propType === PropType.ESCALATOR ? '#22d3ee' : ownerNation?.color || '#ffda1a', 7);
        if (propType === PropType.ESCALATOR) {
          this.spawnFloatingText(tx + 0.5, ty - 1, '⇅ ESCALATOR BUILT!', '#22d3ee');
        }
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
      p === PropType.BARRICADE_GATE ||
      p === PropType.TECH_LAB ||
      p === PropType.ESCALATOR ||
      p === PropType.MEATBALL_VAT;
    if (!isKingdomStruct) return null;

    const occupants: Array<{ id: number; name: string; role: SurvivorRole }> = [];
    let chefsActive = 0;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.alive || (u.insideTimer ?? 0) <= 0 || u.insideBuildingIdx !== idx) continue;
      occupants.push({ id: u.id, name: u.name, role: u.role });
      if (u.role === SurvivorRole.CHEF) chefsActive++;
    }
    const ownerId = this.propOwner[idx];
    const ownerNation = ownerId >= 0 ? this.getNation(ownerId) : undefined;
    const linkedEscalators =
      p === PropType.ESCALATOR
        ? this.escalatorIndices.filter((eIdx) => {
            if (eIdx === idx || this.prop[eIdx] !== PropType.ESCALATOR) return false;
            const eOwner = this.propOwner[eIdx];
            return eOwner === -1 || ownerId === -1 || this.areFriendly(ownerId, eOwner);
          }).length
        : undefined;
    const kitchenOutput =
      p === PropType.BISTRO
        ? `${hasTech(ownerNation, 'lingonberry_kitchens') ? '3.4' : '2.4'} Meatballs / shift`
        : p === PropType.MEATBALL_VAT
          ? 'Simmering Vat Stock (+6 Meatballs / harvest)'
          : undefined;
    return {
      idx,
      tx: gx,
      ty: gy,
      prop: p,
      hp: this.propHp[idx],
      maxHp: Math.max(1, this.propMaxHp[idx]),
      ownerId,
      occupants,
      disabled: this.disabledLightMap[idx] > 0,
      chefsActive: p === PropType.BISTRO || p === PropType.MEATBALL_VAT ? chefsActive : undefined,
      linkedEscalators,
      kitchenOutput,
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

  public updateNationBanner(
    nationId: number,
    patch: {
      color?: string;
      secondaryColor?: string;
      bannerStyle?: BannerStyle;
      bannerEmblem?: BannerEmblem;
    }
  ): boolean {
    const n = this.getNation(nationId);
    if (!n) return false;
    if (patch.color) {
      n.color = patch.color;
      n.borderColor = patch.color;
    }
    if (patch.secondaryColor !== undefined) n.secondaryColor = patch.secondaryColor;
    if (patch.bannerStyle) n.bannerStyle = patch.bannerStyle;
    if (patch.bannerEmblem) n.bannerEmblem = patch.bannerEmblem;
    this.dirtyMap = true;
    this.forceMapRebuild = true;
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
      this.addNews('UNION', `Divine Decree: ${a.name} & ${b.name} linked corridors & borders in Union!`);
      this.spawnFloatingText(a.capitalX, a.capitalY - 2, 'UNION CORRIDOR!', '#fbbf24');
    } else if (stance === 'ALLIANCE') {
      this.connectTradeRoad(a, b);
      this.addNews('DIPLOMACY', `Divine Decree: ${a.name} & ${b.name} formed an Alliance & linked roads!`);
    } else if (stance === 'TRADE_PACT') {
      this.connectTradeRoad(a, b);
      this.addNews('TRADE', `Divine Decree: ${a.name} & ${b.name} opened a Trade Pact & trade avenue!`);
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
    const mapMinInterval = this.currentFps < 38 ? 850 : 420;
    const lightMinInterval = this.currentFps < 38 ? 520 : 260;
    if (this.dirtyMap && (this.forceMapRebuild || nowMs - this.lastMapRebuildMs >= mapMinInterval)) {
      this.rebuildMapCache();
    }
    if (this.dirtyLight && (this.forceLightRebuild || nowMs - this.lastLightRebuildMs >= lightMinInterval)) {
      this.recomputeLightMap();
    }

    const sprites = getGlowSprites();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#090c12';
    ctx.fillRect(0, 0, viewW, viewH);

    const zoom = this.camera.zoom;
    const halfW = viewW / (2 * zoom);
    const halfH = viewH / (2 * zoom);
    this.viewTilesHalfW = halfW / TILE_SIZE + 4;
    this.viewTilesHalfH = halfH / TILE_SIZE + 4;
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

    // Pre-collect occupied building tiles so windows & roof badges light up cleanly (reuses cached Map)
    const occupiedBuildings = this.occupiedBuildingsCache;
    occupiedBuildings.clear();
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
            ? '🔬'
            : u.role === SurvivorRole.TRADER
              ? '🛒'
              : u.role === SurvivorRole.GUARD
                ? '🛡️'
                : '💤';
      if (existing) existing.count += 1;
      else occupiedBuildings.set(bIdx, { count: 1, icon });
    }

    const lowFps = this.currentFps < 32;
    const simpleResources = lowFps || zoom < 0.58;

    // 2. Draw visible Props & Distinct 2.5D Kingdom Buildings
    for (let ty = minTy; ty <= maxTy; ty++) {
      const row = ty * GRID_W;
      const py = ty * TILE_SIZE;
      for (let tx = minTx; tx <= maxTx; tx++) {
        const idx = row + tx;
        const p = this.prop[idx];
        const fire = this.fireMap[idx];
        if (p === PropType.NONE && fire === 0) continue;
        const px = tx * TILE_SIZE;
        const occ = occupiedBuildings.get(idx);

        if (p === PropType.SHELF) {
          ctx.fillStyle = '#78350f';
          ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          if (!simpleResources) {
            ctx.fillStyle = '#b45309';
            ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, 2);
          }
        } else if (p === PropType.WOOD_PALLET) {
          ctx.fillStyle = '#a16207';
          ctx.fillRect(px + 1, py + 2, TILE_SIZE - 2, TILE_SIZE - 3);
          if (!simpleResources) {
            ctx.fillStyle = '#ca8a04';
            ctx.fillRect(px + 2, py + 3, TILE_SIZE - 4, 1);
          }
        } else if (p === PropType.COUCH) {
          ctx.fillStyle = '#1e40af';
          ctx.fillRect(px + 1, py + 2, TILE_SIZE - 2, TILE_SIZE - 3);
          if (!simpleResources) {
            ctx.fillStyle = '#60a5fa';
            ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, 2);
          }
        } else if (p === PropType.BED) {
          ctx.fillStyle = simpleResources ? '#ef4444' : '#e2e8f0';
          ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          if (!simpleResources) {
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(px + 1, py + 4, TILE_SIZE - 2, TILE_SIZE - 5);
          }
        } else if (p === PropType.LAMP) {
          ctx.fillStyle = '#fde047';
          ctx.fillRect(px + 3, py + 2, 2, 3);
          if (!simpleResources) {
            ctx.fillStyle = '#475569';
            ctx.fillRect(px + 3, py + 5, 2, 2);
          }
        } else if (p === PropType.MEATBALL_VAT) {
          ctx.fillStyle = simpleResources ? '#b45309' : '#64748b';
          ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          if (!simpleResources) {
            ctx.fillStyle = '#92400e';
            ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            ctx.fillStyle = '#d97706';
            ctx.fillRect(px + 3, py + 3, 2, 2);
            if (!lowFps && zoom >= 1.45) {
              // Zoomed-in simmering meatball vat details & gleaming silver ladle
              const bub = ((this.simTime * 4 + tx) | 0) % 2;
              ctx.fillStyle = '#fef3c7';
              ctx.fillRect(px + 2.3 + bub, py + 2.5, 0.9, 0.9);
              ctx.fillStyle = '#78350f';
              ctx.fillRect(px + 4.3, py + 4.0, 1.3, 1.3);
              ctx.fillStyle = '#e2e8f0';
              ctx.fillRect(px + 5.2, py + 1.5, 0.9, 3.2);
            }
          }
        } else if (p === PropType.ESCALATOR) {
          const owner = this.propOwner[idx];
          const n = owner >= 0 ? this.getNation(owner) : undefined;
          ctx.fillStyle = '#090c12';
          ctx.fillRect(px - 0.5, py - 0.5, TILE_SIZE + 1, TILE_SIZE + 1);
          // Brushed steel frame & cyan side rails
          ctx.fillStyle = '#334155';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.fillStyle = n ? n.color : '#22d3ee';
          ctx.fillRect(px, py, 1.4, TILE_SIZE);
          ctx.fillRect(px + TILE_SIZE - 1.4, py, 1.4, TILE_SIZE);
          // Animated scrolling amber stair treads
          const stepShift = ((this.simTime * 5) | 0) % 2;
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(px + 1.6, py + 0.5, TILE_SIZE - 3.2, TILE_SIZE - 1);
          ctx.fillStyle = '#ffda1a';
          ctx.fillRect(px + 2, py + 1 + stepShift, TILE_SIZE - 4, 1);
          ctx.fillRect(px + 2, py + 3.5 + stepShift, TILE_SIZE - 4, 1);
          ctx.fillStyle = '#22d3ee';
          ctx.fillRect(px + 3, py + 6.2, 2, 1.2);
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
          if (!lowFps && zoom >= 1.45) {
            // Zoomed-in bunk mattresses & warm lantern inside open hut window
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(px + 5.5, py + 2.8, 2, 1.4);
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(px + 5.5, py + 4.1, 2, 1.2);
            if (occ) {
              ctx.fillStyle = '#fbbf24';
              ctx.fillRect(px + 1.4, py + 3.4, 1.2, 1.2);
            }
          }
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
          // Tall Fortified Guard Tower with Rail-Nail & Arc-Barcode turret upgrades
          const owner = this.propOwner[idx];
          const n = owner >= 0 ? this.getNation(owner) : undefined;
          const hasRail = n ? hasTech(n, 'heavy_rivet_cannons') : false;
          const hasArc = n ? hasTech(n, 'quantum_barcodes') : false;
          const isJammed = this.disabledLightMap[idx] > 0;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(px, py + 7, TILE_SIZE, 2);
          ctx.fillStyle = '#090c12';
          ctx.fillRect(px, py - 6, TILE_SIZE, TILE_SIZE + 7);
          // Stone tower shaft
          ctx.fillStyle = '#64748b';
          ctx.fillRect(px + 1, py - 3, TILE_SIZE - 2, TILE_SIZE + 3);
          ctx.fillStyle = '#334155';
          ctx.fillRect(px + TILE_SIZE - 3, py - 3, 2, TILE_SIZE + 3);
          // Battlement parapet & beacon trim
          ctx.fillStyle = hasRail || hasArc ? '#0f172a' : '#1e293b';
          ctx.fillRect(px, py - 5, TILE_SIZE, 3);
          ctx.fillStyle = isJammed ? '#ef4444' : hasArc ? '#e879f9' : hasRail ? '#f97316' : '#f59e0b';
          ctx.fillRect(px + 1, py - 3, TILE_SIZE - 2, 1);

          // Rail-Nail Cannon mount on parapet
          if (hasRail) {
            ctx.fillStyle = '#475569';
            ctx.fillRect(px + 1, py - 7, 5.5, 2.2);
            ctx.fillStyle = isJammed ? '#991b1b' : '#f97316';
            ctx.fillRect(px + 4.5, py - 7, 3.5, 1.4); // glowing rail barrel
          }
          // Arc-Barcode Tesla twin spires on parapet
          if (hasArc) {
            ctx.fillStyle = '#701a75';
            ctx.fillRect(px + 1, py - 9, 1.4, 4);
            ctx.fillRect(px + 5.6, py - 9, 1.4, 4);
            ctx.fillStyle = isJammed ? '#ef4444' : '#f0abfc';
            ctx.fillRect(px + 1, py - 9.8, 1.4, 1.2);
            ctx.fillRect(px + 5.6, py - 9.8, 1.4, 1.2);
            if (!isJammed && ((this.simTickCount + idx) % 6 < 3)) {
              ctx.fillStyle = '#e879f9';
              ctx.fillRect(px + 2.4, py - 9.2, 3.2, 0.8);
            }
          }

          // Nation pennant flag on tower roof (shows dual-tone if customized/Union)
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(px + 3, py - 9, 1, 4);
          ctx.fillStyle = n ? n.color : '#f59e0b';
          ctx.fillRect(px + 4, py - 9, 4, 2.5);
          if (n?.secondaryColor && n.bannerStyle && n.bannerStyle !== 'solid') {
            ctx.fillStyle = n.secondaryColor;
            ctx.fillRect(px + 6, py - 9, 2, 2.5);
          }

          // Arrow slit window & base doorway
          ctx.fillStyle = isJammed ? '#ef4444' : occ || this.isNight ? '#fef08a' : '#0f172a';
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
          if (n?.secondaryColor && n.bannerStyle && n.bannerStyle !== 'solid') {
            ctx.fillStyle = n.secondaryColor;
            if (n.bannerStyle === 'striped') {
              ctx.fillRect(px + 5, py - 0.5, 6, 1.3);
            } else {
              ctx.fillRect(px + 8, py - 2, 3, 4);
            }
            if (n.bannerStyle === 'crowned') {
              ctx.fillStyle = '#ffda1a';
              ctx.fillRect(px + 5, py - 2, 6, 1);
            }
          }
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
          if (!lowFps && zoom >= 1.45) {
            // Zoomed-in IKEA Bistro Kitchen Interior! (checkered floor strip, steel counter, burners, meatball pot, plates & chef)
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(px + 0.6, py + 1.2, TILE_SIZE - 1.2, 5.2);
            // Checkered kitchen tile strip
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(px + 1, py + 1.5, 1.5, 1.5);
            ctx.fillRect(px + 4, py + 1.5, 1.5, 1.5);
            // Stainless steel prep counter & plates
            ctx.fillStyle = '#94a3b8';
            ctx.fillRect(px + 0.8, py + 3.4, TILE_SIZE - 1.6, 1.4);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(px + 5.6, py + 3.6, 1.3, 1.0);
            // Twin glowing stove burners & copper meatball pot
            ctx.fillStyle = occ ? '#fb923c' : '#9a3412';
            ctx.fillRect(px + 1.2, py + 3.7, 1.3, 1.0);
            ctx.fillStyle = '#b45309';
            ctx.fillRect(px + 3.1, py + 3.2, 1.8, 1.4);
            ctx.fillStyle = '#7c2d12';
            ctx.fillRect(px + 3.4, py + 3.4, 1.2, 0.8);
            if (occ) {
              // Mini chef hat behind counter + animated steam puffs
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(px + 3.4, py + 1.8, 1.3, 1.2);
              const steamY = ((this.simTime * 4) | 0) % 2;
              ctx.fillStyle = 'rgba(248, 250, 252, 0.78)';
              ctx.fillRect(px + 3.6, py + 1.2 - steamY, 1.1, 0.9);
            }
          }
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
          if (!lowFps && zoom >= 1.45) {
            // Zoomed-in glowing forge anvil & sparks
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(px + 5.3, py + 3.2, 2, 1.5);
            ctx.fillStyle = '#fb923c';
            ctx.fillRect(px + 1.3, py + 3.4, 1.4, 1.3);
            if (occ && ((this.simTime * 6) | 0) % 2 === 0) {
              ctx.fillStyle = '#fde047';
              ctx.fillRect(px + 5.7, py + 2.4, 1, 1);
            }
          }
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
          if (!lowFps && zoom >= 1.45) {
            // Zoomed-in IKEA catalog bookshelves
            ctx.fillStyle = '#f59e0b';
            ctx.fillRect(px + 2.2, py + 2.5, 0.7, 1.5);
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(px + 5.1, py + 2.5, 0.7, 1.5);
          }
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
        } else if (p === PropType.TECH_LAB) {
          // 2.5D SCP-IKEA Technology Lab with cyan R&D roof, monitor glass & pulsing capacitor dish
          const owner = this.propOwner[idx];
          const n = owner >= 0 ? this.getNation(owner) : undefined;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
          ctx.fillRect(px - 1, py + 7, TILE_SIZE + 2, 2);
          ctx.fillStyle = '#090c12';
          ctx.fillRect(px - 1, py - 5, TILE_SIZE + 2, TILE_SIZE + 6);
          // Steel lab facade
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(px, py + 1, TILE_SIZE, TILE_SIZE - 1);
          // Teal R&D dome roof + capacitor dish
          ctx.fillStyle = '#0891b2';
          ctx.fillRect(px - 1, py - 2, TILE_SIZE + 2, 3);
          ctx.fillStyle = '#22d3ee';
          ctx.fillRect(px + 1, py - 4, TILE_SIZE - 2, 2);
          ctx.fillStyle = (this.simTime * 3) % 2 < 1 ? '#ffda1a' : '#67e8f9';
          ctx.fillRect(px + 3, py - 5, 2, 1.5);
          // Nation trim & glowing cyan laboratory window
          ctx.fillStyle = n ? n.color : '#22d3ee';
          ctx.fillRect(px, py - 1, 2, 1);
          ctx.fillStyle = occ || hasTech(n, 'fluorescent_capacitor') ? '#67e8f9' : '#164e63';
          ctx.fillRect(px + 1, py + 2, 2.5, 2);
          ctx.fillStyle = occ ? '#fef08a' : '#0f172a';
          ctx.fillRect(px + 4, py + 5, 2, 3);
          if (!lowFps && zoom >= 1.45) {
            // Zoomed-in cyan blueprint oscilloscope & capacitor bench
            ctx.fillStyle = '#06b6d4';
            ctx.fillRect(px + 1.2, py + 2.3, 2, 1.2);
            ctx.fillStyle = '#ffda1a';
            ctx.fillRect(px + 5.2, py + 2.5, 1.5, 1.5);
          }
        }

        // Subtle doorway threshold glow + crisp tiny roof activity badge when occupied
        if (occ) {
          ctx.fillStyle = 'rgba(254, 240, 138, 0.38)';
          ctx.fillRect(px + 2, py + 7, 4, 2);
          if (!lowFps && zoom >= 1.15) {
            const topY =
              p === PropType.WATCHTOWER ? py - 10 : p === PropType.ARCHIVE || p === PropType.TECH_LAB ? py - 7 : py - 5;
            ctx.save();
            ctx.font = '5px "Plus Jakarta Sans", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(occ.icon, px + TILE_SIZE * 0.5, topY);
            ctx.restore();
          }
        }

        // Miniature HP bar for damaged kingdom fortifications & structures
        if (
          ((p >= PropType.BARRICADE_WALL && p <= PropType.CART_DEPOT) || p === PropType.TECH_LAB) &&
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

    // 2b. Showroom Lounge Rug & Central Coffee Table at (this.summitLocalX, this.summitLocalY)
    if (
      this.summitLocalX >= minTx - 6 &&
      this.summitLocalX <= maxTx + 6 &&
      this.summitLocalY >= minTy - 6 &&
      this.summitLocalY <= maxTy + 6
    ) {
      const lx = (this.summitLocalX + 0.5) * TILE_SIZE;
      const ly = (this.summitLocalY + 0.5) * TILE_SIZE;
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
        // Blue IKEA shopping cart + runner, Golden Trade Caravan, or armored Siege Cart Ram
        const n = this.getNation(u.nationId);
        if (u.isCaravan) {
          ctx.fillStyle = '#92400e';
          ctx.fillRect(ux - 4, uy - 3, 8, 5);
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(ux - 3.5, uy - 5, 7, 2.5);
          ctx.fillStyle = '#fef3c7';
          ctx.fillRect(ux - 2, uy - 4.5, 4, 1);
        } else if (u.isSiegeCart) {
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
      } else if (isStaffKind(u.kind)) {
        // SCP-3008-2 Staff variants (wild OR Staff Kingdom citizens!)
        const staffNation = u.nationId >= 0 ? this.getNation(u.nationId) : undefined;
        if (u.kind === UnitKind.STAFF_WARDEN) {
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#ca8a04';
          ctx.fillRect(ux - 3, uy - 9, 6, 8);
          ctx.fillStyle = '#334155';
          ctx.fillRect(ux - 2.5, uy - 7, 5, 4); // riot vest
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#fef3c7';
          ctx.fillRect(ux - 2, uy - 11, 4, 3); // head
          ctx.fillStyle = this.isNight && !u.pacified && !staffNation ? '#ef4444' : '#0f172a';
          ctx.fillRect(ux - 1.5, uy - 10, 3, 1); // visor
          ctx.fillStyle = '#94a3b8';
          ctx.fillRect(ux - 4.5, uy - 7, 1.8, 5); // barricade shield
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(ux - 3, uy - 1, 6, 2);
        } else if (u.kind === UnitKind.STAFF_STALKER) {
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#1e1b4b';
          ctx.fillRect(ux - 1.5, uy - 9, 3, 8);
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#fde68a';
          ctx.fillRect(ux - 1.5, uy - 11, 3, 2.5);
          if (this.isNight && !u.pacified && !staffNation) {
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(ux - 1, uy - 10, 0.8, 0.8);
            ctx.fillRect(ux + 0.3, uy - 10, 0.8, 0.8);
          }
          ctx.fillStyle = '#090c12';
          ctx.fillRect(ux - 1.5, uy - 1, 3, 2);
        } else if (u.kind === UnitKind.STAFF_ANNOUNCER) {
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#facc15';
          ctx.fillRect(ux - 2, uy - 7, 4, 7);
          ctx.fillStyle = '#dc2626';
          ctx.fillRect(ux - 1, uy - 6, 2, 3); // PA lanyard/sash
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#fef3c7';
          ctx.fillRect(ux - 1.5, uy - 9.5, 3, 2.5);
          // Megaphone horn
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(ux + 2, uy - 7.5, 2.5, 2);
          if (this.isNight && !u.pacified && !staffNation) {
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.arc(ux + 3, uy - 6.5, 2.5 + ((this.simTime * 5) % 3), -0.9, 0.9);
            ctx.stroke();
          }
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(ux - 2, uy, 4, 2);
        } else if (u.kind === UnitKind.STAFF_FORKLIFT) {
          // Yellow warehouse forklift chassis + steel prongs + driver
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#eab308';
          ctx.fillRect(ux - 4.5, uy - 5.5, 8, 5);
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(ux - 3.5, uy - 9.5, 4.5, 4); // roll-cage
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#facc15';
          ctx.fillRect(ux - 2.5, uy - 8.5, 2.5, 3); // yellow driver shirt
          ctx.fillStyle = '#fef3c7';
          ctx.fillRect(ux - 2.2, uy - 10.5, 2.4, 2); // head
          if (this.isNight && !u.pacified && !staffNation) {
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(ux - 1.6, uy - 9.8, 1.4, 1);
          }
          ctx.fillStyle = '#94a3b8';
          ctx.fillRect(ux + 3.2, uy - 2.5, 3.2, 1.3); // steel fork prongs
          ctx.fillStyle = '#090c12';
          ctx.fillRect(ux - 4, uy - 1, 2.2, 2);
          ctx.fillRect(ux + 1, uy - 1, 2.2, 2);
        } else if (u.kind === UnitKind.STAFF_THROWER) {
          // Orange cargo harness + pallet debris pack
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#facc15';
          ctx.fillRect(ux - 2.2, uy - 8, 4.4, 7.5);
          ctx.fillStyle = '#ea580c';
          ctx.fillRect(ux - 2.2, uy - 7, 4.4, 3); // orange quartermaster vest
          ctx.fillStyle = '#92400e';
          ctx.fillRect(ux - 4.2, uy - 9.5, 3, 3); // carried pallet crate
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#fef3c7';
          ctx.fillRect(ux - 1.5, uy - 10.5, 3, 2.5);
          if (this.isNight && !u.pacified && !staffNation) {
            ctx.fillStyle = '#f97316';
            ctx.fillRect(ux - 1, uy - 9.5, 2, 1);
          }
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(ux - 2, uy - 0.5, 4, 2);
        } else if (u.kind === UnitKind.STAFF_DIRECTOR) {
          // Mega-Showroom Boss: Executive Dark Blazer, Gold Name-Tag Crown, Crimson Tie & Boss Aura Ring
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.72)';
          ctx.lineWidth = 1.0;
          ctx.beginPath();
          ctx.arc(ux, uy - 1, 7.5 + Math.sin(this.simTime * 5) * 1.2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#0f172a';
          ctx.fillRect(ux - 4.5, uy - 12.5, 9, 11.5); // executive blazer
          ctx.fillStyle = '#ffda1a';
          ctx.fillRect(ux - 4.5, uy - 12.5, 9, 1.5); // gold shoulder trim
          ctx.fillRect(ux + 1, uy - 9.5, 2.5, 1.5); // golden Director badge
          ctx.fillStyle = '#f43f5e';
          ctx.fillRect(ux - 0.8, uy - 10.5, 1.6, 7); // crimson tie
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#fef3c7';
          ctx.fillRect(ux - 3, uy - 16, 6, 3.5); // tall faceless head
          ctx.fillStyle = '#fbbf24';
          ctx.fillRect(ux - 3.2, uy - 17.5, 6.4, 1.6); // executive crown
          if (this.isNight && !u.pacified && !staffNation) {
            ctx.fillStyle = '#f43f5e';
            ctx.fillRect(ux - 1.8, uy - 14.6, 3.6, 1.3);
          }
          ctx.fillStyle = '#020617';
          ctx.fillRect(ux - 4, uy - 1, 8, 2.5);
        } else if (u.kind === UnitKind.STAFF_DISRUPTOR) {
          // Sleek dark-yellow uniform + glowing magenta scanner
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#ca8a04';
          ctx.fillRect(ux - 2, uy - 8, 4, 7.5);
          ctx.fillStyle = '#312e81';
          ctx.fillRect(ux - 1.5, uy - 7, 3, 4);
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#fef3c7';
          ctx.fillRect(ux - 1.5, uy - 10.5, 3, 2.5);
          ctx.fillStyle = '#e879f9';
          ctx.fillRect(ux + 1.8, uy - 6.5, 2.4, 1.5); // handheld barcode scanner
          if (this.isNight && !u.pacified && !staffNation) {
            ctx.strokeStyle = 'rgba(232, 121, 249, 0.55)';
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.arc(ux + 2.5, uy - 5.8, 2 + ((this.simTime * 6) % 3), -0.8, 0.8);
            ctx.stroke();
          }
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(ux - 2, uy - 0.5, 4, 2);
        } else {
          const isMgr = u.kind === UnitKind.STAFF_MANAGER;
          const isCrw = u.kind === UnitKind.STAFF_CRAWLER;
          const w = isMgr ? 7 : 4;
          const h = isMgr ? 12 : isCrw ? 5 : 8;
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#facc15';
          ctx.fillRect(ux - w / 2, uy - h + 2, w, h - 2);
          // Faceless pale head
          ctx.fillStyle = u.hitFlash > 0 ? '#ffffff' : '#fef3c7';
          ctx.fillRect(ux - (w - 1) / 2, uy - h - 1, w - 1, 3);
          if (this.isNight && !u.pacified && !staffNation) {
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(ux - 1, uy - h + 1, 2, 1.5);
          }
          // Dark trousers
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(ux - w / 2, uy, w, 2);
        }
        // Staff Kingdom Sash, Leader Crown & Weapon Overlay
        if (staffNation && staffNation.alive) {
          ctx.fillStyle = staffNation.color;
          ctx.fillRect(ux - 2.2, uy - 6, 4.4, 2);
          if (u.role === SurvivorRole.LEADER) {
            ctx.fillStyle = '#fbbf24';
            ctx.fillRect(ux - 2, uy - 13, 4, 2);
            ctx.fillStyle = '#fef08a';
            ctx.fillRect(ux - 1.5, uy - 14, 1, 1);
            ctx.fillRect(ux + 0.5, uy - 14, 1, 1);
          } else if (u.role === SurvivorRole.GENERAL) {
            ctx.fillStyle = '#991b1b';
            ctx.fillRect(ux - 2, uy - 12, 4, 1.8);
          }
        }
        if (u.pacified) {
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.75)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(ux, uy - 1, 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (u.weapon && u.weapon !== 'none') {
          ctx.fillStyle =
            u.weapon === 'plasma_stapler'
              ? '#c084fc'
              : u.weapon === 'halogen_rifle'
                ? '#38bdf8'
                : u.weapon === 'pa_megaphone'
                  ? '#f43f5e'
                  : '#fbbf24';
          ctx.fillRect(ux + 2, uy - 6, 3.5, 1.4);
        }
        if (u.feverTimer > 0 && u.kind !== UnitKind.STAFF_ANNOUNCER) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(ux - 3.5, uy - 10, 7, 11);
        }
      } else {
        // Survivor / Leader / Guard / Saboteur / Mercenary
        const n = u.nationId >= 0 ? this.getNation(u.nationId) : undefined;
        const bodyColor =
          u.hitFlash > 0
            ? '#ffffff'
            : u.isMercenary
              ? '#9333ea'
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

        // Guard visible makeshift gear & crafted Firearms/Weapons
        const drawnWeapon =
          u.weapon && u.weapon !== 'none'
            ? u.weapon
            : u.role === SurvivorRole.GUARD || u.role === SurvivorRole.GENERAL
              ? this.getNationBestWeaponType(n, u.id)
              : 'none';
        if (
          drawnWeapon === 'arc_caster' ||
          drawnWeapon === 'rail_cannon' ||
          drawnWeapon === 'halogen_rifle' ||
          drawnWeapon === 'plasma_stapler' ||
          drawnWeapon === 'nailgun' ||
          drawnWeapon === 'pa_megaphone'
        ) {
          ctx.fillStyle = '#334155';
          ctx.fillRect(ux + 1.5, uy - 3.4, drawnWeapon === 'rail_cannon' ? 4.4 : 3.8, 1.3);
          ctx.fillStyle =
            drawnWeapon === 'arc_caster'
              ? '#e879f9'
              : drawnWeapon === 'rail_cannon'
                ? '#f97316'
                : drawnWeapon === 'plasma_stapler'
                  ? '#c084fc'
                  : drawnWeapon === 'halogen_rifle'
                    ? '#38bdf8'
                    : drawnWeapon === 'pa_megaphone'
                      ? '#f43f5e'
                      : '#fbbf24';
          ctx.fillRect(ux + (drawnWeapon === 'rail_cannon' ? 4.9 : 4.3), uy - 3.5, 1.4, 1.5);
          if (u.role === SurvivorRole.GUARD) {
            ctx.fillStyle = n && n.techTier >= 3 ? '#94a3b8' : '#64748b';
            ctx.fillRect(ux - 3.5, uy - 4, 2, 3);
          }
        } else if (u.role === SurvivorRole.GUARD) {
          ctx.fillStyle = drawnWeapon === 'allen_spear' || (n && n.techTier >= 3) ? '#e2e8f0' : '#a16207';
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

        // Lightweight zero-lag emoji bubble when resting/talking (capped at 20 per frame; skipped on low FPS)
        if (!lowFps && u.chatTimer > 0 && u.chatEmoji && emojiDrawCount < 20) {
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
      const gen = this.nationGeneralCache.get(n.id);
      const enemy = this.getNation(n.battlePlan.targetNationId);
      if (!gen || !gen.alive || !enemy || !enemy.alive) continue;
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

    // 4. Projectiles, Particles & Store Anomaly Atmospheric Tint
    for (const pr of this.projectiles) {
      ctx.fillStyle = pr.color || '#fef08a';
      ctx.fillRect(pr.x * TILE_SIZE - 1.2, pr.y * TILE_SIZE - 1.2, 2.4, 2.4);
    }

    for (const pt of this.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x * TILE_SIZE, pt.y * TILE_SIZE, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    if (this.activeAnomaly) {
      const aTint =
        this.activeAnomaly.type === 'AISLE_FOG'
          ? 'rgba(148, 163, 184, 0.14)'
          : this.activeAnomaly.type === 'FLUORESCENT_SURGE'
            ? 'rgba(56, 189, 248, 0.08)'
            : this.activeAnomaly.type === 'CLEARANCE_STAMPEDE'
              ? 'rgba(255, 218, 26, 0.06)'
              : 'rgba(251, 191, 36, 0.06)';
      ctx.fillStyle = aTint;
      ctx.fillRect(minTx * TILE_SIZE, minTy * TILE_SIZE, (maxTx - minTx + 1) * TILE_SIZE, (maxTy - minTy + 1) * TILE_SIZE);
    }

    // 4b. Coordinated Staff Pack Rally Beacon & Unlocked PA Radar Invasion Ring
    if (this.isNight && this.staffPack) {
      const rx =
        (this.staffPack.phase === 'GATHERING' ? this.staffPack.rallyX : this.staffPack.targetX) *
        TILE_SIZE;
      const ry =
        (this.staffPack.phase === 'GATHERING' ? this.staffPack.rallyY : this.staffPack.targetY) *
        TILE_SIZE;
      const pulseR =
        (this.staffPack.phase === 'GATHERING' ? 22 : 16) + Math.sin(this.simTime * 6) * 3;
      ctx.strokeStyle =
        this.staffPack.phase === 'GATHERING'
          ? 'rgba(251, 191, 36, 0.72)'
          : 'rgba(239, 68, 68, 0.72)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(rx, ry, pulseR, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.staffInvasionAlert) {
      const al = this.staffInvasionAlert;
      const ax = al.x * TILE_SIZE;
      const ay = al.y * TILE_SIZE;
      const radarR = 20 + ((this.simTime * 18) % 24);
      ctx.save();
      ctx.strokeStyle =
        al.severity === 'CRITICAL' ? 'rgba(244, 63, 94, 0.85)' : 'rgba(251, 191, 36, 0.85)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(ax, ay, radarR, 0, Math.PI * 2);
      ctx.stroke();
      const targetN = this.getNation(al.targetNationId);
      if (targetN && targetN.alive) {
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(targetN.capitalX * TILE_SIZE, targetN.capitalY * TILE_SIZE);
        ctx.stroke();
      }
      ctx.restore();
    }

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
        lowFps ? undefined : occupiedBuildings
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
        { x: 46 - this.originTx, y: 38 - this.originTy, label: 'SELF-SERVE WAREHOUSE' },
        { x: 188 - this.originTx, y: 40 - this.originTy, label: 'BEDDING & SHOWROOM' },
        { x: 52 - this.originTx, y: 138 - this.originTy, label: 'FOOD COURT WEST' },
        { x: 186 - this.originTx, y: 140 - this.originTy, label: 'DARK AS-IS SECTOR' },
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
      const lsx = ((this.summitLocalX + 0.5) * TILE_SIZE - this.camera.x) * zoom + viewW * 0.5;
      const lsy = ((this.summitLocalY - 5.2) * TILE_SIZE - this.camera.y) * zoom + viewH * 0.5;
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

      const atWar = n.alive && this.nationAtWarCache.has(n.id);
      const emblemGlyph =
        n.bannerEmblem === 'crown'
          ? '👑 '
          : n.bannerEmblem === 'shield'
            ? '🛡 '
            : n.bannerEmblem === 'cart'
              ? '🛒 '
              : n.bannerEmblem === 'star'
                ? '★ '
                : n.bannerEmblem === 'bolt'
                  ? '⚡ '
                  : '';
      const label = showDepopulated
        ? `${n.name} · Depopulated`
        : `${atWar ? '⚔ ' : ''}${emblemGlyph}${n.name} · T${n.techTier} · ${n.population}`;
      const textW = ctx.measureText(label).width;
      const boxW = textW + 22;
      const boxH = 22;
      const bx = sx - boxW / 2;
      const by = sy - boxH;

      ctx.fillStyle = showDepopulated ? 'rgba(15, 23, 42, 0.84)' : 'rgba(13, 17, 23, 0.86)';
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = showDepopulated ? '#64748b' : n.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, boxW, boxH);

      // Nation flag swatch (supports Union & custom split/striped/crowned banners)
      if (showDepopulated) {
        ctx.fillStyle = '#64748b';
        ctx.fillRect(bx + 5, by + 6, 8, 10);
      } else {
        ctx.fillStyle = n.color;
        ctx.fillRect(bx + 5, by + 6, 8, 10);
        if (n.secondaryColor && n.bannerStyle && n.bannerStyle !== 'solid') {
          ctx.fillStyle = n.secondaryColor;
          if (n.bannerStyle === 'striped') {
            ctx.fillRect(bx + 5, by + 9.3, 8, 3.4);
          } else {
            ctx.fillRect(bx + 9, by + 6, 4, 10);
          }
        }
        if (n.bannerStyle === 'crowned') {
          ctx.fillStyle = '#ffda1a';
          ctx.fillRect(bx + 5, by + 6, 8, 2);
        }
      }

      ctx.fillStyle = showDepopulated ? '#94a3b8' : '#f8fafc';
      ctx.fillText(label, bx + 17, by + 15);

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
      const floodBonus =
        (hasTech(ownerNation, 'halogen_floodlights') ? 3 : 0) +
        (hasTech(ownerNation, 'sunlight_beacons') ? 4 : 0);
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

    for (let ti = 0; ti < this.techLabIndices.length; ti++) {
      const idx = this.techLabIndices[ti];
      if (this.prop[idx] !== PropType.TECH_LAB || this.disabledLightMap[idx] > 0) continue;
      const owner = this.propOwner[idx];
      const ownerNation = owner >= 0 ? this.getNation(owner) : undefined;
      if (hasTech(ownerNation, 'fluorescent_capacitor')) {
        drawCutout(idx, PropType.WATCHTOWER);
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
      else if (isStaffKind(u.kind)) staffCount++;
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
      activeAnomaly: this.activeAnomaly ? { ...this.activeAnomaly } : null,
      staffInvasionAlert: this.staffInvasionAlert ? { ...this.staffInvasionAlert } : null,
      allowWildStaffKingdoms: this.allowWildStaffKingdoms,
      infiniteWorldMode: this.infiniteWorldMode,
      smartInfrastructureMode: this.smartInfrastructureMode,
      originTx: this.originTx,
      originTy: this.originTy,
    };
  }
}
