import { Nation, ResearchBranch, TechId } from './types';

export interface ResearchNode {
  id: TechId;
  name: string;
  branch: ResearchBranch;
  tier: 1 | 2 | 3 | 4;
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
];

export const RESEARCH_BY_ID: Record<TechId, ResearchNode> = RESEARCH_TREE.reduce(
  (acc, node) => {
    acc[node.id] = node;
    return acc;
  },
  {} as Record<TechId, ResearchNode>
);

export function hasTech(nation: Nation | undefined, techId: TechId): boolean {
  if (!nation || !nation.researchedTechs) return false;
  return nation.researchedTechs.includes(techId);
}

export function canResearchTech(nation: Nation, node: ResearchNode): boolean {
  const done = nation.researchedTechs || [];
  if (done.includes(node.id)) return false;
  if (!node.requires) return true;
  return done.includes(node.requires);
}
