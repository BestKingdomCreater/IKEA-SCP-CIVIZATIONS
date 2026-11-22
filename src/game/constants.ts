import { GovernmentType, Ideology, TaxRate, UnitTrait } from './types';

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
