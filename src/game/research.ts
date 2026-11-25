import { Nation, ResearchBranch, TechId } from './types';

export interface ResearchNode {
  id: TechId;
  name: string;
  branch: ResearchBranch;
  tier: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  cost: number;
  requires?: TechId;
  unlocksTag?: string;
  effectSummary: string;
}

export const BRANCH_LABELS: Record<ResearchBranch, string> = {
  economy: 'Economy & Supply',
  military: 'Military & Siege',
  lighting: 'Lighting & Survival',
  scp_tech: 'SCP-IKEA R&D',
};

export const RESEARCH_TREE: ResearchNode[] = [
  // Economy & Supply
  {
    id: 'flatpack_joinery',
    name: 'Flat-Pack Joinery',
    branch: 'economy',
    tier: 1,
    cost: 35,
    unlocksTag: '+35% Harvest & Faster Builds',
    effectSummary: '+35% IKEA timber & wrench harvest yield; faster building construction.',
  },
  {
    id: 'lingonberry_kitchens',
    name: 'Lingonberry Refill',
    branch: 'economy',
    tier: 2,
    cost: 75,
    requires: 'flatpack_joinery',
    unlocksTag: '+40% Bistro Output & Morale',
    effectSummary: '+40% Meatball Bistro & Chef output and steady citizen happiness.',
  },
  {
    id: 'automated_cart_rails',
    name: 'Cart Rail Logistics',
    branch: 'economy',
    tier: 3,
    cost: 130,
    requires: 'lingonberry_kitchens',
    unlocksTag: '2x Trade Yields & Fast Carts',
    effectSummary: '+35% Supply Cart speed and double trade route yields.',
  },
  {
    id: 'civilian_catalog',
    name: 'Blåhaj & Espresso Catalog',
    branch: 'economy',
    tier: 4,
    cost: 195,
    requires: 'automated_cart_rails',
    unlocksTag: 'Crafts Civilian Goods (+Speed & Trade)',
    effectSummary: 'Workshops & Bistros craft Flatpack Furniture, Plush Blåhaj & Swede-Brew Espresso (+12% citizen speed, happiness & trade value).',
  },
  {
    id: 'cold_chain_bunkers',
    name: 'Cold-Chain Meatball Vaults',
    branch: 'economy',
    tier: 5,
    cost: 245,
    requires: 'civilian_catalog',
    unlocksTag: '+25% Bistro Food & Surplus Regen',
    effectSummary: 'Refrigerated vats boost Meatball Bistro output +25%, while civilian goods stock heals nearby citizens steadily.',
  },
  {
    id: 'megastore_supply_net',
    name: 'Megastore Supply Network',
    branch: 'economy',
    tier: 6,
    cost: 310,
    requires: 'cold_chain_bunkers',
    unlocksTag: '2x Trade Cadence & +50% Cargo',
    effectSummary: 'Halves trade cart dispatch timers, boosts trade yields +50%, and grants bonus scrap & wrenches per delivery.',
  },
  {
    id: 'civic_green_card_bureaus',
    name: 'Civic Green Card Bureaus',
    branch: 'economy',
    tier: 7,
    cost: 380,
    requires: 'megastore_supply_net',
    unlocksTag: '+20% Visa Approval & +35% Culture Mix',
    effectSummary: 'Border checkpoints issue Green Cards faster (+20% approval), grant +35% cultural mixing, and earn +0.4 Wrenches per Green Card.',
  },
  {
    id: 'automated_factory_aisles',
    name: 'Automated Flat-Pack Foundries',
    branch: 'economy',
    tier: 8,
    cost: 460,
    requires: 'civic_green_card_bureaus',
    unlocksTag: 'Zero-Scrap Craft & +30% Builder Speed',
    effectSummary: 'Workshops & Tech Labs forge Firearms & Catalog Goods without draining scrap (+50% output), while Builders construct & dismantle 30% faster.',
  },

  // Military & Siege
  {
    id: 'allen_spears',
    name: 'Allen-Key Halberds',
    branch: 'military',
    tier: 1,
    cost: 35,
    unlocksTag: 'Crafts Halberd Gear (+3 ATK)',
    effectSummary: 'Guards, Generals, and Leaders gain +3 Attack and +18 Max HP.',
  },
  {
    id: 'watchtower_turrets',
    name: 'Rivet Watchtowers',
    branch: 'military',
    tier: 2,
    cost: 80,
    requires: 'allen_spears',
    unlocksTag: 'Arms Watchtower Turrets',
    effectSummary: 'Watchtowers actively fire rivet bolts at night Staff and enemy siegers.',
  },
  {
    id: 'siege_cart_rams',
    name: 'Cart Battering Rams',
    branch: 'military',
    tier: 3,
    cost: 140,
    requires: 'watchtower_turrets',
    unlocksTag: 'Unlocks Armored Siege Carts',
    effectSummary: 'Generals deploy armored Siege Carts during SIEGE phase to smash enemy walls.',
  },
  {
    id: 'pneumatic_nailguns',
    name: 'Pneumatic Nailgun Armory',
    branch: 'military',
    tier: 4,
    cost: 205,
    requires: 'siege_cart_rams',
    unlocksTag: 'Crafts Ranged Nailguns',
    effectSummary: 'Workshops craft rapid-fire Pneumatic Nailguns so Guards & Generals attack from range.',
  },
  {
    id: 'kevlar_aprons',
    name: 'Kevlar Apron Brigades',
    branch: 'military',
    tier: 5,
    cost: 250,
    requires: 'pneumatic_nailguns',
    unlocksTag: 'Kevlar Vests (+35 HP, +4 ATK, +20% Army)',
    effectSummary: 'Equips Guards, Generals, and Leaders with armored yellow-blue Kevlar vests (+35 Max HP, +4 ATK) and expands army cap +20%.',
  },
  {
    id: 'heavy_rivet_cannons',
    name: 'Heavy Rail-Nail Cannons',
    branch: 'military',
    tier: 6,
    cost: 320,
    requires: 'kevlar_aprons',
    unlocksTag: 'Crafts Rail-Nail Cannons & +45% Turrets',
    effectSummary: 'Workshops arm soldiers with high-velocity Rail-Nail Cannons and upgrade Watchtower turrets (+45% damage, +2 range).',
  },
  {
    id: 'hydraulic_breach_exosuits',
    name: 'Hydraulic Exosuit Rigging',
    branch: 'military',
    tier: 7,
    cost: 390,
    requires: 'heavy_rivet_cannons',
    unlocksTag: 'Exosuits (+45 HP, +6 ATK, +20% Army)',
    effectSummary: 'Equips Guards, Generals, and Leaders with powered warehouse exosuits (+45 Max HP, +6 ATK, +12% speed) and +20% Army Cap.',
  },
  {
    id: 'orbital_spotlight_satellites',
    name: 'Rafter Twin-Bolt Turrets',
    branch: 'military',
    tier: 8,
    cost: 470,
    requires: 'hydraulic_breach_exosuits',
    unlocksTag: 'Twin-Shot Watchtowers (+35% DMG, +3 Range)',
    effectSummary: 'Watchtowers mount twin rail-turret barrels firing double salvos with +3 tile range, +35% damage, and higher velocity.',
  },

  // Lighting & Survival
  {
    id: 'halogen_floodlights',
    name: 'Halogen Floodlights',
    branch: 'lighting',
    tier: 1,
    cost: 35,
    unlocksTag: '+3 Tile Safe Light Radius',
    effectSummary: '+3 tile safety radius on Spotlights, Watchtowers, and Capital Flags.',
  },
  {
    id: 'fluorescent_ward',
    name: 'Fluorescent Ward',
    branch: 'lighting',
    tier: 2,
    cost: 75,
    requires: 'halogen_floodlights',
    unlocksTag: 'Day Heal + Slows Night Staff',
    effectSummary: 'Lit friendly tiles heal citizens by day and slow night Staff by 28%.',
  },
  {
    id: 'blueprint_mastery',
    name: 'Master Blueprints',
    branch: 'lighting',
    tier: 3,
    cost: 135,
    requires: 'fluorescent_ward',
    unlocksTag: '+2 Housing & +30% Learning',
    effectSummary: '+2 Housing per Mattress Hut, +15% Army Cap, and +30% Research speed.',
  },
  {
    id: 'maintenance_escalators',
    name: 'Sub-Floor Escalator Grid',
    branch: 'lighting',
    tier: 4,
    cost: 195,
    requires: 'blueprint_mastery',
    unlocksTag: 'Builds Fast-Travel Escalators',
    effectSummary: 'Unlocks automated Escalator Hubs for instant fast-travel between distant territories and allies.',
  },
  {
    id: 'staff_invasion_radar',
    name: 'PA Motion Sensors & Invasion Alert',
    branch: 'lighting',
    tier: 5,
    cost: 230,
    requires: 'maintenance_escalators',
    unlocksTag: 'Unlocks Live Staff Invasion Alert',
    effectSummary: 'Detects incoming Staff packs, Audit waves & border breaches—sounding an early HUD Invasion Alert with click-to-pan radar & rallying Guards early.',
  },
  {
    id: 'sunlight_beacons',
    name: 'Solar Atrium Floodlights',
    branch: 'lighting',
    tier: 6,
    cost: 305,
    requires: 'staff_invasion_radar',
    unlocksTag: '+4 Light Radius & Burns Night Staff',
    effectSummary: 'Expands all Spotlight, Watchtower & Flag safety zones by +4 tiles and sears feral Night Staff inside lit friendly tiles.',
  },
  {
    id: 'cultural_atrium_plazas',
    name: 'Cultural Atrium Plazas',
    branch: 'lighting',
    tier: 7,
    cost: 375,
    requires: 'sunlight_beacons',
    unlocksTag: '+10 Happiness, +40% Mix & 24h Territory Heal',
    effectSummary: 'Bright atrium plazas keep citizens joyful (+10 Happiness), accelerate cultural mixing +40%, and heal citizens on friendly lit tiles day & night.',
  },
  {
    id: 'perpetual_daylight_array',
    name: 'Perpetual Daylight Array',
    branch: 'lighting',
    tier: 8,
    cost: 465,
    requires: 'cultural_atrium_plazas',
    unlocksTag: '+5 Light Radius & 45% Night Staff Slow',
    effectSummary: 'Expands all Spotlight, Watchtower & Flag zones +5 tiles, slows Night Staff 45% inside lit zones, and rapidly re-ignites sabotaged lights.',
  },

  // SCP-IKEA R&D & Crafting
  {
    id: 'swedish_schematics',
    name: 'SCP-IKEA Tech Bench',
    branch: 'scp_tech',
    tier: 1,
    cost: 35,
    unlocksTag: 'Unlocks Tech Lab Building',
    effectSummary: 'Unlocks SCP-IKEA Tech Labs; +35% learning rate & Tinkers craft extra wrenches/scrap.',
  },
  {
    id: 'flatpack_automation',
    name: 'Alloy Armor & Bulwarks',
    branch: 'scp_tech',
    tier: 2,
    cost: 80,
    requires: 'swedish_schematics',
    unlocksTag: 'Crafts Alloy Armor & +45% Walls',
    effectSummary: 'Reinforces all Barricades & Towers (+45% HP) and equips Guards with Alloy Armor (+20 HP, +2 ATK).',
  },
  {
    id: 'fluorescent_capacitor',
    name: 'Anomalous Arc Capacitor',
    branch: 'scp_tech',
    tier: 3,
    cost: 140,
    requires: 'flatpack_automation',
    unlocksTag: 'Tech Lab Arc Zapper + 35% Learn',
    effectSummary: 'Tech Labs zap nearby Night Staff with cyan arc bolts, mend nearby citizens, and boost RP +35%.',
  },
  {
    id: 'halogen_rifles',
    name: 'Halogen & Plasma Firearms',
    branch: 'scp_tech',
    tier: 4,
    cost: 215,
    requires: 'fluorescent_capacitor',
    unlocksTag: 'Crafts Halogen Rifles & Plasma Staplers',
    effectSummary: 'Tech Labs & Workshops manufacture high-velocity Halogen Beam Rifles & Plasma Staplers for soldiers and leaders.',
  },
  {
    id: 'repulsor_pylons',
    name: 'Anomalous Repulsor Pylons',
    branch: 'scp_tech',
    tier: 5,
    cost: 260,
    requires: 'halogen_rifles',
    unlocksTag: 'Jams Stalkers/Scanners & +30% Learn',
    effectSummary: 'Tech Labs project anti-jamming fields protecting Spotlights & Watchtowers from Blackout/Scanner disruptions and boost RP +30%.',
  },
  {
    id: 'quantum_barcodes',
    name: 'Quantum Barcode Arsenal',
    branch: 'scp_tech',
    tier: 6,
    cost: 330,
    requires: 'repulsor_pylons',
    unlocksTag: 'Crafts Chain-Arc Casters & +18 Firearms',
    effectSummary: 'Tech Labs manufacture Arc-Barcode Casters that chain-shock clustered enemies, plus +18 firearms & +25 civilian goods.',
  },
  {
    id: 'anomalous_containment_fields',
    name: 'Containment & Auto-Mend Fields',
    branch: 'scp_tech',
    tier: 7,
    cost: 400,
    requires: 'quantum_barcodes',
    unlocksTag: 'Tech Labs Auto-Repair Walls & Slow Staff',
    effectSummary: 'Tech Labs emit stabilizing fields that auto-repair nearby friendly barricades/gates/towers and slow hostile Night Staff.',
  },
  {
    id: 'singularity_barcode_core',
    name: 'Singularity Barcode Core',
    branch: 'scp_tech',
    tier: 8,
    cost: 490,
    requires: 'anomalous_containment_fields',
    unlocksTag: '+45% Learn, Double Arc-Chain & +25 Firearms',
    effectSummary: 'Unlocks peak SCP-3008 science (+45% RP/s, extra Arc-Caster chain bounce, +15% unit ATK, +25 firearms & +30 catalog goods).',
  },
];

export const RESEARCH_BY_ID: Record<TechId, ResearchNode> = RESEARCH_TREE.reduce(
  (acc, node) => {
    acc[node.id] = node;
    return acc;
  },
  {} as Record<TechId, ResearchNode>
);

const TECH_SET_CACHE = new WeakMap<TechId[], { len: number; set: Set<TechId> }>();

export function hasTech(nation: Nation | undefined, techId: TechId): boolean {
  if (!nation || !nation.researchedTechs) return false;
  const list = nation.researchedTechs;
  const len = list.length;
  if (len === 0) return false;
  let cached = TECH_SET_CACHE.get(list);
  if (!cached || cached.len !== len) {
    cached = { len, set: new Set(list) };
    TECH_SET_CACHE.set(list, cached);
  }
  return cached.set.has(techId);
}

export function canResearchTech(nation: Nation, node: ResearchNode): boolean {
  const done = nation.researchedTechs || [];
  if (done.includes(node.id)) return false;
  if (!node.requires) return true;
  return done.includes(node.requires);
}
