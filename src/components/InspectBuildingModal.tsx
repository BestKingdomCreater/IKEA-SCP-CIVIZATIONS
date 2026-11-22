import React from 'react';
import { Hammer, ShieldAlert, Trash2, Users, Wrench, X } from 'lucide-react';
import { InspectedBuilding, Nation, PropType, SurvivorRole } from '../game/types';

interface InspectBuildingModalProps {
  building: InspectedBuilding;
  nation?: Nation;
  onClose: () => void;
  onOpenNation: (nationId: number) => void;
  onInspectOccupant: (unitId: number) => void;
  onRepair: (idx: number) => void;
  onDemolish: (idx: number) => void;
}

const BUILDING_INFO: Partial<Record<PropType, { name: string; role: string }>> = {
  [PropType.MATTRESS_HUT]: {
    name: 'Mattress Hut',
    role: 'Houses citizens (+housing cap) & heals/shelters weary survivors at night.',
  },
  [PropType.BISTRO]: {
    name: 'Meatball Bistro',
    role: 'Chefs cook meatballs inside and feed hungry citizens.',
  },
  [PropType.WORKSHOP]: {
    name: 'Wrench Workshop',
    role: 'Tinkers forge Allen Wrenches & craft stronger gear.',
  },
  [PropType.ARCHIVE]: {
    name: 'Billy Archive',
    role: 'Tinkers & scholars boost Research Points toward kingdom techs.',
  },
  [PropType.CART_DEPOT]: {
    name: 'Shopping Cart Depot',
    role: 'Logistics hub where Traders & Trade Carts dispatch shipments.',
  },
  [PropType.WATCHTOWER]: {
    name: 'Guard Watchtower',
    role: 'Illuminates borders and fires defensive bolts at Night Staff & raiders.',
  },
  [PropType.SPOTLIGHT]: {
    name: 'Emergency Spotlight',
    role: 'Keeps the endless store lit at night to repel SCP-3008-2 Staff.',
  },
  [PropType.CHECKOUT_FLAG]: {
    name: 'Checkout Flag (Capital)',
    role: 'Kingdom heart and illuminated safe zone. Conquer to defeat this realm.',
  },
  [PropType.BARRICADE_WALL]: {
    name: 'Furniture Barricade',
    role: 'Fortified Swedish shelf/sofa wall blocking raiders & Night Staff.',
  },
  [PropType.BARRICADE_GATE]: {
    name: 'Barricade Gate',
    role: 'Allows friendly & allied units through while blocking enemies.',
  },
};

const ROLE_LABELS: Record<SurvivorRole, string> = {
  [SurvivorRole.SCAVENGER]: 'Scavenger',
  [SurvivorRole.BUILDER]: 'Builder',
  [SurvivorRole.GUARD]: 'Guard',
  [SurvivorRole.LEADER]: 'Leader',
  [SurvivorRole.REFUGEE]: 'Refugee',
  [SurvivorRole.TRADER]: 'Trader',
  [SurvivorRole.CHEF]: 'Chef',
  [SurvivorRole.TINKER]: 'Tinker',
  [SurvivorRole.GENERAL]: 'General',
};

export const InspectBuildingModal: React.FC<InspectBuildingModalProps> = ({
  building,
  nation,
  onClose,
  onOpenNation,
  onInspectOccupant,
  onRepair,
  onDemolish,
}) => {
  const info = BUILDING_INFO[building.prop] ?? {
    name: 'Store Structure',
    role: 'Constructed sector structure.',
  };
  const hpPct = Math.max(0, Math.min(100, Math.round((building.hp / building.maxHp) * 100)));
  const isFlag = building.prop === PropType.CHECKOUT_FLAG;

  return (
    <div className="pointer-events-auto fixed inset-x-4 bottom-20 sm:inset-x-auto sm:left-4 sm:bottom-20 z-40 w-auto sm:w-[310px] max-h-[82vh] overflow-y-auto bg-[#11161f]/96 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-4 text-xs text-slate-200">
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div>
          <h3 className="font-display text-base font-bold text-white">{info.name}</h3>
          <p className="text-[11px] text-slate-400 font-mono-tabular">
            Sector ({building.tx}, {building.ty})
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 -mr-1 -mt-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          aria-label="Close Building Inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="pt-2.5 text-[11px] text-slate-300 leading-relaxed">{info.role}</p>

      <div className="pt-3 space-y-2.5 font-mono-tabular">
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-slate-400 font-sans">Structural HP</span>
            <span className={hpPct > 50 ? 'text-emerald-300' : 'text-amber-300'}>
              {Math.max(0, Math.round(building.hp))} / {building.maxHp}
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
            <div
              className={`h-full transition-all ${
                hpPct > 50 ? 'bg-emerald-500' : hpPct > 25 ? 'bg-amber-500' : 'bg-rose-500'
              }`}
              style={{ width: `${hpPct}%` }}
            />
          </div>
        </div>

        {building.disabled && (
          <div className="flex items-center gap-1.5 text-[11px] text-rose-300 bg-rose-950/50 border border-rose-800/70 rounded-lg px-2.5 py-1.5 font-sans">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>Light disabled by blackout or sabotage</span>
          </div>
        )}

        <div className="pt-1 border-t border-slate-800 space-y-1.5 font-sans">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Users className="w-3.5 h-3.5 text-amber-300" />
            <span>Inside Now ({building.occupants.length})</span>
          </div>
          {building.occupants.length === 0 ? (
            <p className="text-[11px] text-slate-500">Nobody inside right now.</p>
          ) : (
            <div className="space-y-1">
              {building.occupants.map((occ) => (
                <button
                  key={occ.id}
                  type="button"
                  onClick={() => onInspectOccupant(occ.id)}
                  className="w-full flex items-center justify-between px-2 py-1 rounded bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-left transition-colors"
                >
                  <span className="text-amber-200 font-medium truncate">{occ.name}</span>
                  <span className="text-[10px] text-slate-400">{ROLE_LABELS[occ.role]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {nation && (
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between font-sans">
            <span className="text-slate-400">Owner</span>
            <button
              type="button"
              onClick={() => onOpenNation(nation.id)}
              className="font-semibold underline hover:text-white"
              style={{ color: nation.color }}
            >
              {nation.name}
            </button>
          </div>
        )}

        <div className="pt-2 border-t border-slate-800 flex items-center gap-2 font-sans">
          <button
            type="button"
            onClick={() => onRepair(building.idx)}
            className="flex-1 min-h-[34px] px-2.5 py-1.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-700/70 text-emerald-200 font-semibold flex items-center justify-center gap-1.5"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Repair</span>
          </button>
          {!isFlag ? (
            <button
              type="button"
              onClick={() => onDemolish(building.idx)}
              className="flex-1 min-h-[34px] px-2.5 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 border border-rose-700/70 text-rose-200 font-semibold flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Demolish</span>
            </button>
          ) : (
            <div className="flex-1 min-h-[34px] px-2 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800 text-slate-500 text-[10px] flex items-center justify-center gap-1">
              <Hammer className="w-3 h-3" />
              <span>Capital Protected</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
