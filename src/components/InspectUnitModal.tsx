import React from 'react';
import { X } from 'lucide-react';
import { Nation, SurvivorRole, Unit, UnitKind } from '../game/types';

interface InspectUnitModalProps {
  unit: Unit;
  nation?: Nation;
  onClose: () => void;
  onOpenNation: (nationId: number) => void;
}

const ROLE_NAMES: Record<SurvivorRole, string> = {
  [SurvivorRole.SCAVENGER]: 'Scavenger',
  [SurvivorRole.BUILDER]: 'Builder',
  [SurvivorRole.GUARD]: 'Army Guard',
  [SurvivorRole.LEADER]: 'Crowned Leader',
  [SurvivorRole.REFUGEE]: 'Refugee',
  [SurvivorRole.TRADER]: 'Merchant Trader',
  [SurvivorRole.CHEF]: 'Meatball Chef',
  [SurvivorRole.TINKER]: 'Wrench Tinker',
  [SurvivorRole.GENERAL]: 'War General',
};

export const InspectUnitModal: React.FC<InspectUnitModalProps> = ({
  unit,
  nation,
  onClose,
  onOpenNation,
}) => {
  const isStaff = unit.kind >= UnitKind.STAFF_NORMAL && unit.kind <= UnitKind.STAFF_MANAGER;
  const kindLabel =
    unit.kind === UnitKind.CART_RUNNER
      ? 'Supply Cart Runner'
      : unit.kind === UnitKind.SABOTEUR
        ? 'Dusk Saboteur'
        : isStaff
          ? 'SCP-3008-2 Entity'
          : ROLE_NAMES[unit.role];

  return (
    <div className="pointer-events-auto fixed inset-x-4 bottom-20 sm:inset-x-auto sm:left-4 sm:bottom-20 z-40 w-auto sm:w-[300px] max-h-[85vh] overflow-y-auto bg-[#11161f]/96 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-4 text-xs text-slate-200">
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div>
          <h3 className="font-display text-base font-bold text-white">{unit.name}</h3>
          <p className="text-[11px] text-slate-400">{kindLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 -mr-1 -mt-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          aria-label="Close Inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="pt-3 space-y-2 font-mono-tabular">
        <div className="flex justify-between">
          <span className="text-slate-400">Health</span>
          <span className="text-emerald-300">
            {Math.max(0, Math.round(unit.hp))} / {unit.maxHp}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Attack · Speed</span>
          <span>
            {unit.atk} · {unit.speed.toFixed(1)}
          </span>
        </div>
        {!isStaff && (
          <>
            <div className="flex justify-between">
              <span className="text-slate-400">Age · Kills</span>
              <span>
                {unit.age} yrs · {unit.kills}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Hunger</span>
              <span>{Math.round(unit.hunger)}%</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Traits</span>
              <span className="text-right text-amber-300">
                {unit.traits.length > 0 ? unit.traits.join(' · ') : 'None'}
              </span>
            </div>
            {unit.role === SurvivorRole.GENERAL && nation?.battlePlan && (
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Formation</span>
                  <span className="text-right text-rose-300 font-semibold">
                    {nation.battlePlan.formation}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">Battle Phase</span>
                  <span className="text-right text-amber-300 font-semibold">
                    {nation.battlePlan.phase}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
        {nation && (
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            <span className="text-slate-400">Faction</span>
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
      </div>
    </div>
  );
};
