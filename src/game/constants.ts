import { BorderPolicy, CultureTrait, GovernmentType, Ideology, NationCulture, PropType, TaxRate, UnitTrait } from './types';

export const GRID_W = 240;
export const GRID_H = 180;
export const TILE_SIZE = 8; // 1920x1440 cached world canvas
export const WORLD_PX_W = GRID_W * TILE_SIZE;
export const WORLD_PX_H = GRID_H * TILE_SIZE;

export const SPATIAL_CELL = 8; // 8x8 tiles
export const HASH_W = Math.ceil(GRID_W / SPATIAL_CELL); // 30
export const HASH_H = Math.ceil(GRID_H / SPATIAL_CELL); // 23
export const HASH_CELLS = HASH_W * HASH_H;

export const DAY_DURATION = 35; // seconds
export const NIGHT_DURATION = 25; // seconds
export const CYCLE_DURATION = DAY_DURATION + NIGHT_DURATION;

export const MAX_UNITS_LIMIT = 3500;

export const SPOTLIGHT_RADIUS = 13; // tiles
export const WATCHTOWER_RADIUS = 10; // tiles
export const FLAG_LIGHT_RADIUS = 11; // tiles

export const SUMMIT_X = 120;
export const SUMMIT_Y = 86;
export const SUMMIT_RADIUS = 7;

export const CITIZEN_EMOJIS = ['🍖', '🛋️', '🔧', '☕', '🛒', '💬', '😴', '📦', '🛡️'];

export const TECH_TIER_NAMES: Record<1 | 2 | 3 | 4, string> = {
  1: 'Cardboard Camp',
  2: 'Wooden Pallet Guild',
  3: 'Steel Shelf Republic',
  4: 'High-Security Citadel',
};

export const TECH_THRESHOLDS: Record<1 | 2 | 3 | 4, number> = {
  1: 0,
  2: 45,
  3: 130,
  4: 260,
};

export const NATION_PALETTE: Array<{ name: string; color: string; border: string; rgb: [number, number, number]; borderRgb: [number, number, number] }> = [
  { name: 'Billy Pact', color: '#3b82f6', border: '#1d4ed8', rgb: [59, 130, 246], borderRgb: [29, 78, 216] },
  { name: 'Köttbullar Syndicate', color: '#f59e0b', border: '#b45309', rgb: [245, 158, 11], borderRgb: [180, 83, 9] },
  { name: 'Lack Republic', color: '#10b981', border: '#047857', rgb: [16, 185, 129], borderRgb: [4, 120, 87] },
  { name: 'Aisle-9 Imperium', color: '#ef4444', border: '#991b1b', rgb: [239, 68, 68], borderRgb: [153, 27, 27] },
  { name: 'Blåhaj League', color: '#06b6d4', border: '#0e7490', rgb: [6, 182, 212], borderRgb: [14, 116, 144] },
  { name: 'Fjällbo Cartel', color: '#a855f7', border: '#6b21a8', rgb: [168, 85, 247], borderRgb: [107, 33, 168] },
  { name: 'Lingonberry Guard', color: '#ec4899', border: '#9d174d', rgb: [236, 72, 153], borderRgb: [157, 23, 77] },
  { name: 'Malm Federation', color: '#84cc16', border: '#3f6212', rgb: [132, 204, 22], borderRgb: [63, 98, 18] },
  { name: 'Poäng Commonwealth', color: '#f97316', border: '#9a3412', rgb: [249, 115, 22], borderRgb: [154, 52, 18] },
  { name: 'Kallax Freeholds', color: '#6366f1', border: '#3730a3', rgb: [99, 102, 241], borderRgb: [55, 48, 163] },
  { name: 'Vittsjö Sovereignty', color: '#14b8a6', border: '#115e59', rgb: [20, 184, 166], borderRgb: [17, 94, 89] },
  { name: 'Hemnes Crown', color: '#eab308', border: '#854d0e', rgb: [234, 179, 8], borderRgb: [133, 77, 14] },
  { name: 'Ivar Union', color: '#f43f5e', border: '#9f1239', rgb: [244, 63, 94], borderRgb: [159, 18, 57] },
  { name: 'Ektorp Duchy', color: '#38bdf8', border: '#0369a1', rgb: [56, 189, 248], borderRgb: [3, 105, 161] },
];

export const SETTLER_KINGDOM_NAMES = [
  'Vittsjö Free State',
  'Hemnes Sovereign',
  'Ivar Commonwealth',
  'Ektorp Union',
  'Nordli Principality',
  'Brimnes Compact',
  'Tärnö Freehold',
  'Skogsta Realm',
  'Råskog Collective',
  'Älmhult Duchy',
  'Klippan League',
  'Lommarp Charter',
  'Stuva Republic',
  'Gerton Citadel',
  'Bestå Sanctuary',
  'Fjälla Hold',
];

export const REBEL_PREFIXES = [
  'Free Billy',
  'Red Allen',
  'Aisle Liberation',
  'Broken Pallet',
  'Food Court',
  'Midnight',
  'As-Is',
  'Showroom',
];

export const REBEL_SUFFIXES = ['Front', 'Rebels', 'Commune', 'Uprising', 'Insurgents', 'Coalition'];

export const COLONY_NAMES = [
  'New Västerås',
  'Port As-Is',
  'Section 42B',
  'East Showroom',
  'Pallet Haven',
  'North Bistro',
  'Småland Bastion',
  'Kallax Outpost',
  'Hemnes Hold',
  'Ektorp Sanctuary',
];

export const SURVIVOR_FIRST_NAMES = [
  'Sven', 'Astrid', 'Erik', 'Freja', 'Lars', 'Ingrid', 'Oskar', 'Linnea',
  'Magnus', 'Saga', 'Nils', 'Maja', 'Hanna', 'Axel', 'Klara', 'Viktor',
  'Elin', 'Filip', 'Tove', 'Gustav', 'Bodil', 'Ragnar', 'Ylva', 'Tor',
  'Juno', 'Henrik', 'Alma', 'Kasper', 'Nora', 'Sigrid',
];

export const SURVIVOR_LAST_NAMES = [
  'Lindqvist', 'Bergstrom', 'Holm', 'Nystrom', 'Soderberg', 'Ek', 'Dahl',
  'Wickman', 'Forsberg', 'Kall', 'Engstrom', 'Lund', 'Bauer', 'Nygaard',
  'Vestergaard', 'Sandberg', 'Ahlstrom', 'Bjork',
];

export const TRAIT_POOL: UnitTrait[] = ['Brave', 'Speedy', 'Hoarder', 'Tough', 'Pyromaniac'];

export const GOVERNMENTS: GovernmentType[] = [
  'Checkout Democracy',
  'Iron Dictatorship',
  'Merchant Republic',
  'Meatball Theocracy',
];

export const IDEOLOGIES: Ideology[] = [
  'Merchant Cartel',
  'Iron Fortress',
  'Meatball Zealots',
  'Expansionist Empire',
];

export const TAX_RATES: TaxRate[] = ['Low', 'Normal', 'High', 'War Tax'];

export const IKEA_QUOTES = [
  'The meatballs belong to whoever holds the steam table!',
  'Assembly requires two Allen wrenches and zero mercy.',
  'Follow the yellow arrows—or perish in Bedding.',
  'Our wooden pallets shall blot out the fluorescent lights.',
  'No refunds, no surrender, no exit.',
  'Every shortcut through Textiles leads to another showroom.',
  'Blessed be the Lingonberry Vat and its infinite refill.',
  'Pay your Allen Wrench tribute before the store closes.',
];

export const STAFF_KINGDOM_NAMES = [
  'Closing Bell Dominion',
  'Yellow-Shirt Syndicate',
  'Night Shift Empire',
  'Aisle Manager Collective',
  'Fluorescent Conclave',
  'Lost Showroom Covenant',
  'Warehouse Wardens',
  'Midnight Inventory Pact',
];

export const WEAPON_LABELS: Record<string, string> = {
  none: 'Unarmed / Tool',
  allen_spear: 'Allen-Key Halberd',
  nailgun: 'Pneumatic Nailgun',
  halogen_rifle: 'Halogen Beam Rifle',
  plasma_stapler: 'Plasma Stapler',
  pa_megaphone: 'Sonic PA Blaster',
  rail_cannon: 'Rail-Nail Cannon',
  arc_caster: 'Arc-Barcode Caster',
};

export interface CultureSeed {
  name: string;
  traits: CultureTrait[];
}

export const HUMAN_CULTURES: CultureSeed[] = [
  { name: 'Flatpack Folk', traits: ['Flatpack Craft', 'Open-Aisle Exchange'] },
  { name: 'Meatball Epicureans', traits: ['Meatball Hospitality', 'Open-Aisle Exchange'] },
  { name: 'Aisle-9 Pioneers', traits: ['Aisle Barricaders', 'Flatpack Craft'] },
  { name: 'Showroom Artisans', traits: ['Catalog Scholars', 'Meatball Hospitality'] },
  { name: 'Pallet Nomads', traits: ['Open-Aisle Exchange', 'Aisle Barricaders'] },
  { name: 'Bistro Guildsmen', traits: ['Meatball Hospitality', 'Catalog Scholars'] },
  { name: 'Checkout Freeholders', traits: ['Flatpack Craft', 'Catalog Scholars'] },
];

export const STAFF_CULTURES: CultureSeed[] = [
  { name: 'Yellow-Shirt Protocol', traits: ['Uniform Protocol', 'Closing-Bell Discipline'] },
  { name: 'Closing-Bell Orthodoxy', traits: ['Closing-Bell Discipline', 'Inventory Vigilance'] },
  { name: 'Inventory Syndicate', traits: ['Inventory Vigilance', 'Fluorescent Order'] },
  { name: 'Fluorescent Directorate', traits: ['Fluorescent Order', 'Uniform Protocol'] },
  { name: 'Shift-Zero Collective', traits: ['Uniform Protocol', 'Inventory Vigilance'] },
];

export const CULTURE_TRAIT_INFO: Record<CultureTrait, string> = {
  'Flatpack Craft': '+12% Scrap & Wrench output',
  'Meatball Hospitality': '+Happiness & faster food recovery',
  'Aisle Barricaders': '+20% Barricade & Gate durability',
  'Catalog Scholars': '+15% Research speed',
  'Open-Aisle Exchange': '+Trade Cart speed & visitor goodwill',
  'Uniform Protocol': '+15% Staff citizen HP & discipline',
  'Closing-Bell Discipline': '+Border vigilance & guard patrol focus',
  'Inventory Vigilance': '+Faster Green Card screening & security',
  'Fluorescent Order': '+15% Tech Lab & lighting efficiency',
  'Syncretic Harmony': '+8% Happiness & cross-species trade bonus',
};

export const BORDER_POLICY_INFO: Record<BorderPolicy, { label: string; short: string; color: string }> = {
  'Open Aisles': {
    label: 'Open Aisles',
    short: 'Visitors & migrants enter freely without Green Card checks.',
    color: '#34d399',
  },
  'Green Card': {
    label: 'Green Card',
    short: 'Guards check border crossings & issue Green Cards to trusted arrivals.',
    color: '#22c55e',
  },
  'Strict Inspection': {
    label: 'Strict Inspection',
    short: 'Only Green Card holders & Union allies may cross; others turned back.',
    color: '#f59e0b',
  },
  Lockdown: {
    label: 'Lockdown',
    short: 'Gates sealed to all non-citizens & non-Union foreigners.',
    color: '#ef4444',
  },
};

export function createInitialCulture(
  species: 'human' | 'staff',
  seedIndex: number,
  initialPolicy?: BorderPolicy
): NationCulture {
  const pool = species === 'staff' ? STAFF_CULTURES : HUMAN_CULTURES;
  const pick = pool[Math.abs(seedIndex) % pool.length];
  return {
    name: pick.name,
    primaryCulture: pick.name,
    originSpecies: species,
    traits: [...pick.traits],
    composition: { [pick.name]: 100 },
    mixingScore: 0,
    mixedWith: [],
    borderPolicy: initialPolicy ?? (species === 'staff' ? 'Green Card' : 'Open Aisles'),
    borderVigilance: species === 'staff' ? 35 : 10,
    greenCardsIssued: 0,
    borderChecks: 0,
    turnedBackCount: 0,
  };
}

export function getBuildingDisplayMeta(
  prop: PropType,
  isStaff?: boolean
): { name: string; subtitle: string; icon: string } {
  if (isStaff) {
    switch (prop) {
      case PropType.CHECKOUT_FLAG:
        return { name: 'Directorate Beacon', subtitle: 'Staff Realm Command Hub', icon: '🟨' };
      case PropType.MATTRESS_HUT:
        return { name: 'Breakroom Pod', subtitle: 'Modular Staff Quarters (+Cap)', icon: '🛏️' };
      case PropType.BISTRO:
        return { name: 'Staff Canteen', subtitle: 'Corporate Ration Mess (+Food)', icon: '🍽️' };
      case PropType.WORKSHOP:
        return { name: 'Freight Bay', subtitle: 'Pallet & Wrench Maintenance', icon: '🔧' };
      case PropType.ARCHIVE:
        return { name: 'Inventory Hub', subtitle: 'Stock Ledger & Protocol Hall', icon: '📋' };
      case PropType.CART_DEPOT:
        return { name: 'Receiving Dock', subtitle: 'Cargo Cart Dispatch Bay', icon: '📦' };
      case PropType.TECH_LAB:
        return { name: 'PA Command Lab', subtitle: 'Fluorescent Signal R&D', icon: '📡' };
      case PropType.WATCHTOWER:
        return { name: 'Security Pylon', subtitle: 'Automated Surveillance Turret', icon: '🗼' };
      case PropType.SPOTLIGHT:
        return { name: 'Fluorescent Tower', subtitle: 'High-Output Aisle Beacon', icon: '💡' };
      case PropType.BARRICADE_WALL:
        return { name: 'Security Barrier', subtitle: 'Hazard-Striped Perimeter Wall', icon: '🚧' };
      case PropType.BARRICADE_GATE:
        return { name: 'Badge Security Gate', subtitle: 'Green Card Checkpoint Gate', icon: '🪪' };
      case PropType.ESCALATOR:
        return { name: 'Freight Escalator', subtitle: 'Express Transit Shaft', icon: '🪜' };
      default:
        return { name: 'Facility Prop', subtitle: 'Staff Structure', icon: '🏢' };
    }
  }
  switch (prop) {
    case PropType.CHECKOUT_FLAG:
      return { name: 'Checkout Flag', subtitle: 'Capital Citadel & Banner', icon: '🏁' };
    case PropType.MATTRESS_HUT:
      return { name: 'Mattress Hut', subtitle: 'Survivor Dwelling (+Cap)', icon: '🛏️' };
    case PropType.BISTRO:
      return { name: 'Meatball Bistro', subtitle: 'Hot Kitchen & Dining Hall', icon: '🍝' };
    case PropType.WORKSHOP:
      return { name: 'Wrench Workshop', subtitle: 'Forge & Firearm Craft', icon: '🔨' };
    case PropType.ARCHIVE:
      return { name: 'Billy Archive', subtitle: 'Catalog Library & Morale', icon: '📚' };
    case PropType.CART_DEPOT:
      return { name: 'Cart Depot', subtitle: 'Trade Caravan Staging', icon: '🛒' };
    case PropType.TECH_LAB:
      return { name: 'SCP Tech Lab', subtitle: 'Anomalous Research Lab', icon: '🔬' };
    case PropType.WATCHTOWER:
      return { name: 'Watchtower', subtitle: 'Fortified Defense Tower', icon: '🏰' };
    case PropType.SPOTLIGHT:
      return { name: 'Spotlight', subtitle: 'Anti-Staff Light Beacon', icon: '🔦' };
    case PropType.BARRICADE_WALL:
      return { name: 'Pallet Barricade', subtitle: 'Fortified Furniture Wall', icon: '🧱' };
    case PropType.BARRICADE_GATE:
      return { name: 'Border Gate', subtitle: 'Checkpoint Entrance', icon: '🚪' };
    case PropType.ESCALATOR:
      return { name: 'Escalator Hub', subtitle: 'Fast-Travel Link', icon: '🪜' };
    default:
      return { name: 'Structure', subtitle: 'Kingdom Building', icon: '🏗️' };
  }
}

