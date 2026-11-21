import { Nation, ResearchBranch, TechId } from './types';

export interface ResearchNode {
  id: TechId;
  name: string;
  branch: ResearchBranch;
  tier: 1 | 2 | 3;
  cost: number;
  requires?: TechId;
  effectSummary: string;
}

export const BRANCH_LABELS: Record<ResearchBranch, string> = {
  economy: 'Economy & Supply',
  military: 'Military & Siege',
  lighting: 'Lighting & Survival',
};

export const RESEARCH_TREE: ResearchNode[] = [
  // Economy & Supply
  {
    id: 'flatpack_joinery',
    name: 'Flat-Pack Joinery',
    branch: 'economy',
    tier: 1,
    cost: 35,
    effectSummary: '+35% IKEA timber & wrench harvest yield; faster building construction.',
  },
  {
    id: 'lingonberry_kitchens',
    name: 'Lingonberry Refill',
    branch: 'economy',
    tier: 2,
    cost: 75,
    requires: 'flatpack_joinery',
    effectSummary: '+40% Meatball Bistro & Chef output and steady citizen happiness.',
  },
  {
    id: 'automated_cart_rails',
    name: 'Cart Rail Logistics',
    branch: 'economy',
    tier: 3,
    cost: 130,
    requires: 'lingonberry_kitchens',
    effectSummary: '+35% Supply Cart speed and double trade route yields.',
  },

  // Military & Siege
  {
    id: 'allen_spears',
    name: 'Allen-Key Halberds',
    branch: 'military',
    tier: 1,
    cost: 35,
    effectSummary: 'Guards, Generals, and Leaders gain +3 Attack and +18 Max HP.',
  },
  {
    id: 'watchtower_turrets',
    name: 'Rivet Watchtowers',
    branch: 'military',
    tier: 2,
    cost: 80,
    requires: 'allen_spears',
    effectSummary: 'Watchtowers actively fire rivet bolts at night Staff and enemy siegers.',
  },
  {
    id: 'siege_cart_rams',
    name: 'Cart Battering Rams',
    branch: 'military',
    tier: 3,
    cost: 140,
    requires: 'watchtower_turrets',
    effectSummary: 'Generals deploy armored Siege Carts during SIEGE phase to smash enemy walls.',
  },

  // Lighting & Survival
  {
    id: 'halogen_floodlights',
    name: 'Halogen Floodlights',
    branch: 'lighting',
    tier: 1,
    cost: 35,
    effectSummary: '+3 tile safety radius on Spotlights, Watchtowers, and Capital Flags.',
  },
  {
    id: 'fluorescent_ward',
    name: 'Fluorescent Ward',
    branch: 'lighting',
    tier: 2,
    cost: 75,
    requires: 'halogen_floodlights',
    effectSummary: 'Lit friendly tiles heal citizens by day and slow night Staff by 28%.',
  },
  {
    id: 'blueprint_mastery',
    name: 'Master Blueprints',
    branch: 'lighting',
    tier: 3,
    cost: 135,
    requires: 'fluorescent_ward',
    effectSummary: '+2 Housing per Mattress Hut, +15% Army Cap, and +30% Research speed.',
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
