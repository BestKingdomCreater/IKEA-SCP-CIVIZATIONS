import React from 'react';
import {
  AlertTriangle,
  Crown,
  FlaskConical,
  Shield,
  Sparkles,
  Swords,
  X,
} from 'lucide-react';

interface UpdatesModalProps {
  onClose: () => void;
}

interface UpdateSection {
  version: string;
  title: string;
  badge?: string;
  accent: string;
  items: Array<{ label: string; detail: string }>;
}

const UPDATE_HISTORY: UpdateSection[] = [
  {
    version: 'Latest Update',
    title: 'Tier 7–8 Tech, 4 New Staff Classes, Culture & Builder Demolition',
    badge: 'NEW',
    accent: 'text-[#ffda1a]',
    items: [
      {
        label: '32 Technologies (Tiers 1–8 Across All 4 Branches)',
        detail:
          'Research Green Card Bureaus, Automated Factory Aisles, Hydraulic Breach Exosuits, Orbital Spotlight Satellites, Cultural Atrium Plazas, Perpetual Daylight Arrays, Anomalous Containment Fields, and Singularity Barcode Cores.',
      },
      {
        label: '4 New SCP-3008-2 Staff Types & Dominance Packs',
        detail:
          'When humans dominate the store, wild Staff rally into coordinated Tier 1–2 night attack packs featuring Shift Technicians (healers/gate hackers), Inventory Spotters (long-range snipers), Spill-Sweepers (corrosive AOE), and Warehouse Goliaths (siege cleave titans).',
      },
      {
        label: 'Culture Mixing, Border Policies & Green Cards',
        detail:
          'Staff kingdoms build distinct Uniform Depots and Shift Quarters with Staff culture, while visiting survivors mix cultures over time and kingdoms enforce Open Aisles, Passport Checks, Green Card Permits, or Closed Borders.',
      },
      {
        label: 'Builders Dismantle & Delete Obsolete Barricades',
        detail:
          'Kingdom Builders autonomously dismantle interior, walkway-blocking, or Union-border barricades to salvage Scrap and Allen Wrenches—or dispatch one manually via Builder Delete in the Building Inspector.',
      },
      {
        label: 'Upgraded Live Summit Lounge & Cultural Exchange',
        detail:
          'Summit Lounge leaders now debate Green Cards, Cultural Mixing, Staff Dominance Packs, and Tier 7–8 tech—and can sign Cultural Exchange accords alongside Treaties, Unions, and Trade Deals.',
      },
    ],
  },
  {
    version: 'Recent Milestones',
    title: 'Mega-Showroom Boss, Union Corridors & Infinite Store',
    accent: 'text-sky-300',
    items: [
      {
        label: 'Mega-Showroom Boss, Railguns & Arc-Tesla Turrets',
        detail:
          'Face the Rogue Store Director every 25 nights, upgrade Watchtowers with piercing Railguns and chaining Arc-Tesla spires, and customize Union banners and emblems.',
      },
      {
        label: 'Smart Infrastructure & 4-Gate Citadels',
        detail:
          'Kingdoms fortify their primary capital with 4 open cardinal entrances, line outer borders with barricades and watchtowers, and dispatch guards to defend outer infrastructure.',
      },
      {
        label: 'Optional Infinite Store Expansion',
        detail:
          'Enable Infinite Store Mode in Settings to explore procedurally generated aisles, biomes, Staff patrols, and dormant nation sectors beyond the initial viewport.',
      },
      {
        label: 'Coordinated Night Staff Packs & Sound FX',
        detail:
          'When survivor kingdoms grow dominant, Staff rally into coordinated nighttime packs while subtle weapon, radar, and alert sound effects play near the camera.',
      },
      {
        label: 'Proximity Votes, Spacing & Tech Crafting',
        detail:
          'Settlers placed next to a kingdom vote to join or stay independent, kingdoms adapt Crowded/Balanced/Spaced layouts, Tech Labs craft firearms & civilian goods, and wild Staff can be granted sovereign kingdoms.',
      },
    ],
  },
];

export const UpdatesModal: React.FC<UpdatesModalProps> = ({ onClose }) => {
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl max-h-[85vh] overflow-y-auto bg-[#11161f] border border-slate-700 rounded-xl shadow-2xl p-5 text-sm text-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#ffda1a]" />
            <h2 className="font-display text-lg font-bold text-white">Store Updates &amp; Patch Notes</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center -mr-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close Updates"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="pt-4 space-y-4 text-xs">
          {/* Quick feature icon strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-2">
              <FlaskConical className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200">32 Techs (T1–T8)</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-2">
              <Swords className="w-3.5 h-3.5 text-yellow-300 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200">4 New Staff Classes</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200">Builder Demolition</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200">Staff Pack Uprising</span>
            </div>
          </div>

          {UPDATE_HISTORY.map((section) => (
            <section
              key={section.version}
              className="rounded-xl border border-slate-800 bg-slate-900/65 p-3.5 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Crown className="w-3.5 h-3.5 text-[#ffda1a] shrink-0" />
                  <h3 className={`font-semibold text-sm ${section.accent}`}>{section.title}</h3>
                </div>
                {section.badge ? (
                  <span className="px-2 py-0.5 rounded bg-[#0058a3] text-[#ffda1a] text-[10px] font-bold tracking-wider">
                    {section.badge}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400 font-medium">{section.version}</span>
                )}
              </div>

              <div className="space-y-2">
                {section.items.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg bg-slate-950/70 border border-slate-800/80 px-3 py-2 space-y-0.5"
                  >
                    <div className="font-semibold text-slate-100">{item.label}</div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{item.detail}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
