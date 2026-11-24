export const enum BiomeType {
  WALKWAY = 0,
  SHOWROOM = 1,
  WAREHOUSE = 2,
  FOOD_COURT = 3,
  DARK_SECTOR = 4,
}

export const enum PropType {
  NONE = 0,
  SHELF = 1,
  COUCH = 2,
  BED = 3,
  LAMP = 4,
  MEATBALL_VAT = 5,
  WOOD_PALLET = 6,
  BARRICADE_WALL = 7,
  BARRICADE_GATE = 8,
  MATTRESS_HUT = 9,
  SPOTLIGHT = 10,
  WATCHTOWER = 11,
  CHECKOUT_FLAG = 12,
  BISTRO = 13,
  WORKSHOP = 14,
  ARCHIVE = 15,
  CART_DEPOT = 16,
  TECH_LAB = 17,
  ESCALATOR = 18,
}

export type WeaponType =
  | 'none'
  | 'allen_spear'
  | 'nailgun'
  | 'halogen_rifle'
  | 'plasma_stapler'
  | 'pa_megaphone';

export type StoreAnomalyType =
  | 'FLUORESCENT_SURGE'
  | 'AISLE_FOG'
  | 'CLEARANCE_STAMPEDE'
  | 'ESPRESSO_RUSH';

export interface ActiveAnomaly {
  type: StoreAnomalyType;
  label: string;
  description: string;
  remainingSec: number;
  color: string;
}

export const enum UnitKind {
  SURVIVOR = 0,
  CART_RUNNER = 1,
  STAFF_NORMAL = 2,
  STAFF_CRAWLER = 3,
  STAFF_MANAGER = 4,
  SABOTEUR = 5,
  STAFF_WARDEN = 6,
  STAFF_STALKER = 7,
  STAFF_ANNOUNCER = 8,
}

export function isStaffKind(kind: UnitKind): boolean {
  return (
    kind === UnitKind.STAFF_NORMAL ||
    kind === UnitKind.STAFF_CRAWLER ||
    kind === UnitKind.STAFF_MANAGER ||
    kind === UnitKind.STAFF_WARDEN ||
    kind === UnitKind.STAFF_STALKER ||
    kind === UnitKind.STAFF_ANNOUNCER
  );
}

export const enum SurvivorRole {
  SCAVENGER = 0,
  BUILDER = 1,
  GUARD = 2,
  LEADER = 3,
  REFUGEE = 4,
  TRADER = 5,
  CHEF = 6,
  TINKER = 7,
  GENERAL = 8,
}

export type FormationType =
  | 'Shield Wall Rows'
  | 'Wedge Spearhead'
  | 'Phalanx Grid'
  | 'Flanking Pincer'
  | 'Zealot Crescent';

export type BattlePhase = 'MUSTER' | 'MARCH' | 'SIEGE' | 'REGROUP';

export interface BattlePlan {
  generalUnitId: number;
  generalName: string;
  formation: FormationType;
  phase: BattlePhase;
  targetNationId: number;
  rallyX: number;
  rallyY: number;
}

export type BuildingPattern =
  | 'Iron Citadel'
  | 'Merchant Bazaar'
  | 'Showroom Plaza'
  | 'Cathedral Spire'
  | 'Imperial Concourse';

export type BuildingSpacing = 'Crowded' | 'Balanced' | 'Spaced';

export type ResearchBranch = 'economy' | 'military' | 'lighting' | 'scp_tech';

export type TechId =
  | 'flatpack_joinery'
  | 'lingonberry_kitchens'
  | 'automated_cart_rails'
  | 'civilian_catalog'
  | 'allen_spears'
  | 'watchtower_turrets'
  | 'siege_cart_rams'
  | 'pneumatic_nailguns'
  | 'halogen_floodlights'
  | 'fluorescent_ward'
  | 'blueprint_mastery'
  | 'maintenance_escalators'
  | 'swedish_schematics'
  | 'flatpack_automation'
  | 'fluorescent_capacitor'
  | 'halogen_rifles';

export type UnitTrait = 'Brave' | 'Speedy' | 'Hoarder' | 'Tough' | 'Pyromaniac' | 'Blessed';

export type GovernmentType =
  | 'Checkout Democracy'
  | 'Iron Dictatorship'
  | 'Merchant Republic'
  | 'Meatball Theocracy';

export type TaxRate = 'Low' | 'Normal' | 'High' | 'War Tax';

export type Ideology =
  | 'Merchant Cartel'
  | 'Iron Fortress'
  | 'Meatball Zealots'
  | 'Expansionist Empire';

export type DiplomaticStance =
  | 'NEUTRAL'
  | 'WAR'
  | 'ALLIANCE'
  | 'UNION'
  | 'TRADE_PACT'
  | 'TRUCE'
  | 'EMBARGO'
  | 'COALITION';

export interface DiplomaticRelation {
  stance: DiplomaticStance;
  truceUntilDay: number;
  warExhaustion: number;
  tradeVolume: number;
}

export interface LeaderInfo {
  unitId: number;
  name: string;
  age: number;
  traits: UnitTrait[];
  alive: boolean;
  crownedDay: number;
  kills: number;
}

export interface Nation {
  id: number;
  name: string;
  color: string;
  borderColor: string;
  capitalX: number;
  capitalY: number;
  meatballs: number;
  scrap: number;
  allenWrenches: number;
  techTier: 1 | 2 | 3 | 4;
  population: number;
  housingCap: number;
  territoryTiles: number;
  ideology: Ideology;
  government: GovernmentType;
  taxRate: TaxRate;
  happiness: number; // 0 - 100
  lowHappinessTimer: number;
  warExhaustion: number;
  threatScore: number;
  overlordId: number | null;
  vassalIds: number[];
  loyalty: number; // 0 - 100 if vassal
  leader: LeaderInfo;
  recentCoupDay: number;
  isRebel: boolean;
  lastQuote: string;
  relations: Record<number, DiplomaticRelation>;
  alive: boolean;
  foundedDay: number;
  sabotageCooldown: number;
  cartCooldown: number;
  armyCount?: number;
  armyCap?: number;
  jobs?: {
    scavengers: number;
    builders: number;
    guards: number;
    chefs: number;
    tinkers: number;
    traders: number;
  };
  buildings?: {
    huts: number;
    bistros: number;
    workshops: number;
    archives: number;
    depots: number;
    watchtowers: number;
    spotlights: number;
    techLabs?: number;
  };
  battlePlan?: BattlePlan;
  buildingPattern?: BuildingPattern;
  customBuildingPattern?: BuildingPattern;
  buildingSpacing?: BuildingSpacing;
  researchedTechs?: TechId[];
  activeResearchId?: TechId | null;
  researchPoints?: number;
  researchRate?: number;
  defeatedStatus?: 'DEPOPULATED' | 'CONQUERED' | 'UNITED';
  defeatedDay?: number;
  conqueredByNationId?: number | null;
  conqueredByName?: string;
  unitedIntoNationId?: number | null;
  unitedIntoName?: string;
  isUnion?: boolean;
  unionMembers?: string[];
  unionHubs?: Array<{ x: number; y: number; name: string }>;
  reproductionProgress?: number;
  reproductionRate?: number;
  lastAttackerNationId?: number;
  lastAttackedDay?: number;
  species?: 'human' | 'staff';
  firearms?: number;
  civilianGoods?: number;
  weaponTier?: 0 | 1 | 2 | 3;
  bestWeapon?: WeaponType;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  role: SurvivorRole;
  nationId: number; // -1 for Staff or neutral
  x: number; // in tile coordinates (float)
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  atk: number;
  speed: number;
  name: string;
  age: number;
  kills: number;
  hunger: number; // 0 (full) to 100 (starving)
  traits: UnitTrait[];
  carryType: 'none' | 'meatball' | 'scrap' | 'wrench';
  carryAmount: number;
  targetNationId: number; // for cart runners / saboteurs
  originNationId: number; // for cart runners
  targetX: number;
  targetY: number;
  hasTarget: boolean;
  stuckTimer: number;
  lastCheckX: number;
  lastCheckY: number;
  attackCooldown: number;
  hitFlash: number;
  feverTimer: number;
  aiTimer: number;
  chatEmoji: string;
  chatTimer: number;
  formationSlot?: number;
  buildProp?: PropType;
  buildVariant?: number;
  isSiegeCart?: boolean;
  canFoundKingdom?: boolean;
  settleTimer?: number;
  insideTimer?: number;
  insideBuildingIdx?: number;
  visitCooldown?: number;
  visitTargetIdx?: number;
  routeWaypoints?: Array<{ x: number; y: number }>;
  proximityVoted?: boolean;
  veteranTitle?: string;
  weapon?: WeaponType;
  heroRelic?: string;
  pacified?: boolean;
  isCaravan?: boolean;
  isMercenary?: boolean;
  teleportCooldown?: number;
  alive: boolean;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  nationId: number;
  life: number;
  color?: string;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export type NewsCategory =
  | 'WAR'
  | 'PEACE'
  | 'TRADE'
  | 'POLITICS'
  | 'STAFF'
  | 'COLONY'
  | 'DIPLOMACY'
  | 'GOD'
  | 'GROWTH'
  | 'FOUNDING'
  | 'CONQUEST'
  | 'UNION';

export interface NewsItem {
  id: number;
  day: number;
  category: NewsCategory;
  text: string;
  color: string;
}

export type ToolId =
  | 'pan'
  | 'inspect'
  | 'spawn_survivor'
  | 'spawn_staff'
  | 'spawn_warden'
  | 'spawn_stalker'
  | 'spawn_announcer'
  | 'spawn_manager'
  | 'spawn_trader'
  | 'spawn_caravan'
  | 'spawn_mercenary'
  | 'spawn_kingdom'
  | 'paint_food'
  | 'paint_warehouse'
  | 'paint_showroom'
  | 'paint_dark'
  | 'paint_road'
  | 'paint_eraser'
  | 'power_meatball'
  | 'power_fever'
  | 'power_outage'
  | 'power_firebomb'
  | 'power_bless'
  | 'power_coup'
  | 'power_meteor'
  | 'power_lightning'
  | 'power_heal'
  | 'power_uplift'
  | 'power_peace'
  | 'power_war'
  | 'power_staff_purge'
  | 'power_time_shift'
  | 'power_rally_guard'
  | 'power_restock'
  | 'power_plague'
  | 'power_anomaly'
  | 'power_supply_drop'
  | 'power_pacify_staff'
  | 'power_prosperity'
  | 'power_vortex'
  | 'power_enlighten'
  | 'build_spotlight'
  | 'build_watchtower'
  | 'build_wall'
  | 'build_bistro'
  | 'build_tech_lab'
  | 'build_escalator';

export type BrushSize = 'S' | 'M' | 'L';
export type SimSpeed = 0 | 1 | 2 | 5 | 10;
export type WorldPreset = 'standard' | 'warehouse_maze' | 'food_arena' | 'nightmare_dark';

export type ChronicleEventType =
  | 'FOUNDING'
  | 'WAR'
  | 'PEACE'
  | 'CONQUEST'
  | 'CIVIL_WAR'
  | 'COLONY'
  | 'TECH'
  | 'AUDIT'
  | 'COUP'
  | 'GROWTH'
  | 'FALL'
  | 'UNION';

export interface ChronicleEntry {
  id: number;
  day: number;
  type: ChronicleEventType;
  title: string;
  detail: string;
  color: string;
}

export interface HallOfRecords {
  totalWarsDeclared: number;
  totalPeaceTreaties: number;
  totalBuildingsBuilt: number;
  totalTechsUnlocked: number;
  totalStaffSlain: number;
  totalSurvDeaths: number;
  peakPopulation: number;
  peakPopDay: number;
  auditNightsSurvived: number;
}

export interface CustomKingdomConfig {
  name: string;
  color: string;
  borderColor: string;
  government: GovernmentType;
  ideology: Ideology;
  buildingPattern: BuildingPattern;
  buildingSpacing?: BuildingSpacing;
  startingPop: number;
}

export interface HudSnapshot {
  day: number;
  isNight: boolean;
  cycleProgress: number; // 0..1 within current phase
  phaseRemainingSec: number;
  fps: number;
  totalUnits: number;
  survivorCount: number;
  staffCount: number;
  cartCount: number;
  nations: Nation[];
  news: NewsItem[];
  chronicle: ChronicleEntry[];
  records: HallOfRecords;
  paused: boolean;
  speed: SimSpeed;
  summitActive: boolean;
  auditNight?: boolean;
  activeAnomaly?: ActiveAnomaly | null;
  allowWildStaffKingdoms?: boolean;
}

export interface InspectedBuilding {
  idx: number;
  tx: number;
  ty: number;
  prop: PropType;
  hp: number;
  maxHp: number;
  ownerId: number;
  occupants: Array<{ id: number; name: string; role: SurvivorRole }>;
  disabled?: boolean;
  chefsActive?: number;
  linkedEscalators?: number;
  kitchenOutput?: string;
}

export interface InspectTarget {
  type: 'unit' | 'nation';
  unitId?: number;
  nationId?: number;
}

export interface GeminiDiplomaticAction {
  type:
    | 'DECLARE_WAR'
    | 'FORM_ALLIANCE'
    | 'FORM_UNION'
    | 'UNITE_KINGDOMS'
    | 'PEACE_TREATY'
    | 'TRADE_PACT'
    | 'DEMAND_TRIBUTE'
    | 'VASSALIZE'
    | 'EMBARGO'
    | 'COALITION'
    | 'REFORM_GOV';
  actorNationId: number;
  targetNationId?: number;
  newGovernment?: GovernmentType;
  quote: string;
}

export interface GeminiSummitResponse {
  actions: GeminiDiplomaticAction[];
  headline?: string;
}
