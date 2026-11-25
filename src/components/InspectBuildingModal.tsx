import React from 'react';
import { Hammer, ShieldAlert, Trash2, Users, Wrench, X } from 'lucide-react';
import { getBuildingDisplayMeta } from '../game/constants';
import { InspectedBuilding, Nation, PropType, SurvivorRole } from '../game/types';

interface InspectBuildingModalProps {
  building: InspectedBuilding;
  nation?: Nation;
  onClose: () => void;
  onOpenNation: (nationId: number) => void;
  onInspectOccupant: (unitId: number) => void;
  onRepair: (idx: number) => void;
  onDemolish: (idx: number) => void;
  onBuilderDemolish?: (idx: number) => void;
}

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
  onBuilderDemolish,
}) => {
  const isStaff = nation?.species === 'staff';
  const info = getBuildingDisplayMeta(building.prop, isStaff);
  const hpPct = Math.max(0, Math.min(100, Math.round((building.hp / building.maxHp) * 100)));
  const isFlag = building.prop === PropType.CHECKOUT_FLAG;
  const isBarricade =
    building.prop === PropType.BARRICADE_WALL || building.prop === PropType.BARRICADE_GATE;

  return (
    <div className="pointer-events-auto fixed inset-x-4 bottom-20 sm:inset-x-auto sm:left-4 sm:bottom-20 z-40 w-auto sm:w-[310px] max-h-[82vh] overflow-y-auto bg-[#11161f]/96 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-4 text-xs text-slate-200">
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div>
          <h3 className="font-display text-base font-bold text-white">{info.name}</h3>
          <p className="text-[11px] text-slate-400 font-mono-tabular">
            {isStaff ? 'Staff Directorate · ' : ''}Sector ({building.tx}, {building.ty})
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

      <p className="pt-2.5 text-[11px] text-slate-300 leading-relaxed">
        {info.subtitle}
        {building.prop === PropType.BARRICADE_GATE && nation?.culture && (
          <span className="block mt-1 text-emerald-300 font-medium">
            Active Checkpoint Policy: {nation.culture.borderPolicy}
          </span>
        )}
      </p>

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

        {(building.kitchenOutput || building.chefsActive !== undefined) && (
          <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-700/50 space-y-1 font-sans text-[11px]">
            <div className="flex justify-between">
              <span className="text-amber-300 font-semibold">Kitchen Status</span>
              <span className="font-mono-tabular text-amber-200">
                {building.chefsActive ?? 0} Chef{(building.chefsActive ?? 0) === 1 ? '' : 's'} nearby
              </span>
            </div>
            {building.kitchenOutput && (
              <div className="text-slate-300">{building.kitchenOutput}</div>
            )}
          </div>
        )}

        {building.prop === PropType.ESCALATOR && building.linkedEscalators !== undefined && (
          <div className="p-2 rounded-lg bg-teal-950/40 border border-teal-700/50 flex justify-between font-sans text-[11px]">
            <span className="text-teal-300 font-semibold">Tunnel Network</span>
            <span className="font-mono-tabular text-teal-200">
              {building.linkedEscalators} linked exit{building.linkedEscalators === 1 ? '' : 's'}
            </span>
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

        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center gap-2 font-sans">
          <button
            type="button"
            onClick={() => onRepair(building.idx)}
            className="flex-1 min-w-[90px] min-h-[34px] px-2.5 py-1.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-700/70 text-emerald-200 font-semibold flex items-center justify-center gap-1.5"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Repair</span>
          </button>
          {!isFlag ? (
            <>
              {isBarricade && onBuilderDemolish && (
                <button
                  type="button"
                  onClick={() => onBuilderDemolish(building.idx)}
                  className="flex-1 min-w-[105px] min-h-[34px] px-2.5 py-1.5 rounded-lg bg-amber-950/70 hover:bg-amber-900/80 border border-amber-700/70 text-amber-200 font-semibold flex items-center justify-center gap-1.5"
                  title="Dispatch a Builder to dismantle this barricade and salvage Scrap & Allen Wrenches"
                >
                  <Hammer className="w-3.5 h-3.5" />
                  <span>Builder Delete</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onDemolish(building.idx)}
                className="flex-1 min-w-[90px] min-h-[34px] px-2.5 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 border border-rose-700/70 text-rose-200 font-semibold flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Demolish</span>
              </button>
            </>
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
