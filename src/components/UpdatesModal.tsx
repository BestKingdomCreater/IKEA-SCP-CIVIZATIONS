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
    title: 'Mega-Showroom Boss, Rail/Arc Turrets & Flag Customizer',
    badge: 'NEW',
    accent: 'text-[#ffda1a]',
    items: [
      {
        label: 'Mega-Showroom Boss: Rogue Store Director (Day 25+)',
        detail:
          'Every 25 nights (or spawned manually via the Director tool / Inspect menu), a massive Store Director marches with a crimson-gold rally aura, PA Megaphone ranged blasts, siege strength, and huge Director-Slayer loot drops.',
      },
      {
        label: 'Railgun & Arc-Tesla Watchtower Turrets',
        detail:
          'Unlocking Heavy Rivet Rail-Cannons or Quantum Barcodes visually upgrades kingdom Watchtowers with glowing orange rail mounts or neon magenta Tesla spires that fire piercing rail slugs and chaining arc lightning.',
      },
      {
        label: 'Union Flag & Banner Customization',
        detail:
          'Customize primary colors, secondary trim, Split/Striped/Crowned patterns, and emblems (Crown, Shield, Cart, Star, Bolt) in any Kingdom panel. Grand Unions automatically adopt split crowned banners on flags, towers, and HUD.',
      },
      {
        label: 'Fortified Union Corridors & Night Trade',
        detail:
          'Union Pacts and Grand Unions fortify linking corridors with flank barricades, spotlights, watchtowers, and Corridor Escort Guards so Union trade carts keep rolling safely through the night.',
      },
      {
        label: 'PA Invasion Radar, Tier 5–6 Tech & New Staff Types',
        detail:
          'Research PA Motion Sensors for Staff Invasion Alerts, climb all 24 techs through Tier 6, and face Forklift Juggernauts, Shelf Quartermasters, and Barcode Scanners.',
      },
    ],
  },
  {
    version: 'Recent Milestones',
    title: 'Infrastructure, Infinite Store & Species Powers',
    accent: 'text-sky-300',
    items: [
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
              <Shield className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200">Union Corridors</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200">PA Invasion Radar</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-2">
              <FlaskConical className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200">24 Techs (T1–T6)</span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-2">
              <Swords className="w-3.5 h-3.5 text-yellow-300 shrink-0" />
              <span className="text-[11px] font-medium text-slate-200">3 New Staff Types</span>
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
