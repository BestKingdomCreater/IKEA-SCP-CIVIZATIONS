import React, { useEffect, useState } from 'react';
import { Award, BadgeCheck, Crosshair, Crown, HeartHandshake, Home, ShieldAlert, Sparkles, X, Zap } from 'lucide-react';
import { WEAPON_LABELS } from '../game/constants';
import { isStaffKind, Nation, SurvivorRole, Unit, UnitKind } from '../game/types';

export type UnitGiftAction =
  | 'bless'
  | 'rifle'
  | 'plasma'
  | 'rail_cannon'
  | 'arc_caster'
  | 'pacify'
  | 'promote_warden'
  | 'promote_manager'
  | 'promote_forklift'
  | 'promote_director'
  | 'promote_colossus'
  | 'promote_tech'
  | 'promote_sniper'
  | 'promote_hazmat'
  | 'charter_human'
  | 'charter_staff';

interface InspectUnitModalProps {
  unit: Unit;
  nation?: Nation;
  nations?: Nation[];
  isFollowing: boolean;
  onToggleFollow: () => void;
  onClose: () => void;
  onOpenNation: (nationId: number) => void;
  onUnitAction?: (unitId: number, action: UnitGiftAction) => void;
  onGrantGreenCard?: (unitId: number, hostNationId: number) => void;
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
  nations = [],
  isFollowing,
  onToggleFollow,
  onClose,
  onOpenNation,
  onUnitAction,
  onGrantGreenCard,
}) => {
  const greenCardTargets = nations.filter((n) => n.alive && n.id !== unit.nationId);
  const [greenCardHostId, setGreenCardHostId] = useState<number>(greenCardTargets[0]?.id ?? -1);

  useEffect(() => {
    const first = nations.find((n) => n.alive && n.id !== unit.nationId);
    setGreenCardHostId(first ? first.id : -1);
  }, [unit.id, unit.nationId, nations]);

  const isStaff = isStaffKind(unit.kind);
  const kindLabel =
    unit.isCaravan
      ? 'Wandering Trade Caravan'
      : unit.isMercenary
        ? 'Free-Aisle Mercenary'
        : unit.kind === UnitKind.CART_RUNNER
          ? 'Supply Cart Runner'
          : unit.kind === UnitKind.SABOTEUR
            ? 'Dusk Saboteur'
            : unit.kind === UnitKind.STAFF_WARDEN
              ? 'SCP-3008-2 Siege Warden · Smashes Barricades'
              : unit.kind === UnitKind.STAFF_STALKER
                ? 'SCP-3008-2 Blackout Stalker · Cuts Spotlights'
                : unit.kind === UnitKind.STAFF_ANNOUNCER
                  ? 'SCP-3008-2 PA Hound · Closing Siren Buff'
                  : unit.kind === UnitKind.STAFF_FORKLIFT
                    ? 'SCP-3008-2 Forklift Juggernaut · 3x Ram'
                    : unit.kind === UnitKind.STAFF_THROWER
                      ? 'SCP-3008-2 Shelf Quartermaster · Ranged'
                      : unit.kind === UnitKind.STAFF_DISRUPTOR
                        ? 'SCP-3008-2 Barcode Scanner · EMP Jammer'
                        : unit.kind === UnitKind.STAFF_DIRECTOR
                          ? 'SCP-3008-2 Store Director · Mega Boss'
                          : unit.kind === UnitKind.STAFF_TECH
                            ? 'SCP-3008-2 Shift Technician · Healer & Gate Hack'
                            : unit.kind === UnitKind.STAFF_SNIPER
                              ? 'SCP-3008-2 Inventory Spotter · Long-Range'
                              : unit.kind === UnitKind.STAFF_HAZMAT
                                ? 'SCP-3008-2 Spill-Sweeper · Corrosive Spray'
                                : unit.kind === UnitKind.STAFF_COLOSSUS
                                  ? 'SCP-3008-2 Warehouse Goliath · Cleave Titan'
                                  : unit.kind === UnitKind.STAFF_MANAGER
                                    ? 'SCP-3008-2 Manager Brute'
                                    : unit.kind === UnitKind.STAFF_CRAWLER
                                      ? 'SCP-3008-2 Fast Crawler'
                                      : isStaff
                                        ? nation
                                          ? 'SCP-3008-2 Citizen'
                                          : 'SCP-3008-2 Entity'
                                        : ROLE_NAMES[unit.role];
  const isInsideBuilding = (unit.insideTimer ?? 0) > 0;
  const weaponLabel = unit.weapon ? (WEAPON_LABELS[unit.weapon] ?? unit.weapon) : WEAPON_LABELS.none;

  return (
    <div className="pointer-events-auto fixed inset-x-4 bottom-20 sm:inset-x-auto sm:left-4 sm:bottom-20 z-40 w-auto sm:w-[300px] max-h-[85vh] overflow-y-auto bg-[#11161f]/96 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-4 text-xs text-slate-200">
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold text-white truncate">{unit.name}</h3>
          <p className="text-[11px] text-slate-400">{kindLabel}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleFollow}
            className={`px-2 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition-colors ${
              isFollowing
                ? 'bg-[#0058a3] border-[#ffda1a] text-[#ffda1a]'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title={isFollowing ? 'Stop following unit' : 'Follow unit with camera'}
          >
            <Crosshair className="w-3 h-3" />
            <span>{isFollowing ? 'Following' : 'Follow'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-1 -mt-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close Inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {unit.veteranTitle && (
        <div className="mt-2.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-950/50 border border-amber-600/60 text-amber-200 text-[11px] font-semibold">
          <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Veteran · {unit.veteranTitle}</span>
        </div>
      )}

      {isInsideBuilding && (
        <div className="mt-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-950/50 border border-sky-700/60 text-sky-200 text-[11px]">
          <Home className="w-3.5 h-3.5 text-sky-300 shrink-0" />
          <span>Currently inside a kingdom building</span>
        </div>
      )}

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
        <div className="flex justify-between gap-2">
          <span className="text-slate-400">Weapon</span>
          <span className="text-right text-cyan-300 truncate">{weaponLabel}</span>
        </div>
        {unit.heroRelic && (
          <div className="flex justify-between gap-2">
            <span className="text-slate-400">Relic</span>
            <span className="text-right text-amber-300 truncate">{unit.heroRelic}</span>
          </div>
        )}
        {unit.cultureName && (
          <div className="flex justify-between gap-2 font-sans">
            <span className="text-slate-400">Culture</span>
            <span className="text-right text-pink-300 truncate">
              {unit.cultureName}
              {unit.originCultureName && unit.originCultureName !== unit.cultureName
                ? ` (${unit.originCultureName})`
                : ''}
            </span>
          </div>
        )}
        {unit.hasGreenCard && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-950/60 border border-emerald-600/60 text-emerald-200 font-sans text-[11px]">
            <BadgeCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">Green Card Holder · {unit.greenCardNationName || 'Foreign Realm'}</span>
          </div>
        )}
        {isStaff && unit.pacified && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 font-sans text-[11px]">
            <HeartHandshake className="w-3.5 h-3.5 shrink-0" />
            <span>Tamed · Friendly to humans</span>
          </div>
        )}
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

        {onUnitAction && unit.alive && (
          <div className="pt-2.5 border-t border-slate-800 space-y-1.5 font-sans">
            <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#ffda1a]" />
              <span>{isStaff ? 'Species & God Grants' : 'God Powers & Gear'}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {isStaff && !nation && (
                <>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'charter_staff')}
                    className="col-span-2 px-2 py-1.5 rounded-lg bg-amber-950/70 hover:bg-amber-900/80 border border-amber-500/70 text-amber-200 text-[11px] font-semibold flex items-center justify-center gap-1"
                  >
                    <Crown className="w-3.5 h-3.5 text-amber-300" />
                    <span>Found Staff Kingdom</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'pacify')}
                    className="px-2 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-700/70 text-emerald-200 text-[10px] font-semibold flex items-center justify-center gap-1"
                  >
                    <HeartHandshake className="w-3 h-3" />
                    <span>{unit.pacified ? 'Make Feral' : 'Tame Staff'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'promote_warden')}
                    className="px-2 py-1 rounded-lg bg-orange-950/60 hover:bg-orange-900/70 border border-orange-700/70 text-orange-200 text-[10px] font-semibold flex items-center justify-center gap-1"
                  >
                    <ShieldAlert className="w-3 h-3" />
                    <span>Evolve Warden</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'promote_manager')}
                    className="px-2 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 border border-rose-700/70 text-rose-200 text-[10px] font-semibold"
                  >
                    Evolve Manager
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'promote_forklift')}
                    className="px-2 py-1 rounded-lg bg-yellow-950/60 hover:bg-yellow-900/70 border border-yellow-700/70 text-yellow-200 text-[10px] font-semibold"
                  >
                    Evolve Forklift
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'promote_tech')}
                    className="px-2 py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/70 border border-cyan-700/70 text-cyan-200 text-[10px] font-semibold"
                  >
                    Evolve Tech
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'promote_sniper')}
                    className="px-2 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 border border-rose-700/70 text-rose-200 text-[10px] font-semibold"
                  >
                    Evolve Spotter
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'promote_hazmat')}
                    className="px-2 py-1 rounded-lg bg-lime-950/60 hover:bg-lime-900/70 border border-lime-700/70 text-lime-200 text-[10px] font-semibold"
                  >
                    Evolve Hazmat
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'promote_colossus')}
                    className="px-2 py-1 rounded-lg bg-orange-950/70 hover:bg-orange-900/80 border border-orange-500/70 text-orange-100 text-[10px] font-semibold"
                  >
                    Evolve Goliath
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'promote_director')}
                    className="col-span-2 px-2 py-1 rounded-lg bg-rose-950/75 hover:bg-rose-900/80 border border-rose-500/70 text-rose-100 text-[10px] font-semibold flex items-center justify-center gap-1"
                  >
                    <Crown className="w-3 h-3 text-[#ffda1a]" />
                    <span>Evolve Store Director (Boss)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'rifle')}
                    className="col-span-2 px-2 py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/70 border border-cyan-700/70 text-cyan-200 text-[10px] font-semibold"
                  >
                    Give Halogen Rifle
                  </button>
                </>
              )}

              {!isStaff && !nation && unit.kind === UnitKind.SURVIVOR && (
                <button
                  type="button"
                  onClick={() => onUnitAction(unit.id, 'charter_human')}
                  className="col-span-2 px-2 py-1.5 rounded-lg bg-sky-950/70 hover:bg-sky-900/80 border border-sky-500/70 text-sky-200 text-[11px] font-semibold flex items-center justify-center gap-1"
                >
                  <Crown className="w-3.5 h-3.5 text-[#ffda1a]" />
                  <span>Charter Kingdom Here</span>
                </button>
              )}

              {(nation || !isStaff) && (
                <>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'rifle')}
                    className="px-2 py-1 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/70 border border-cyan-700/70 text-cyan-200 text-[10px] font-semibold flex items-center justify-center gap-1"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>Halogen Rifle</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'plasma')}
                    className="px-2 py-1 rounded-lg bg-purple-950/60 hover:bg-purple-900/70 border border-purple-700/70 text-purple-200 text-[10px] font-semibold flex items-center justify-center gap-1"
                  >
                    <Zap className="w-3 h-3" />
                    <span>Plasma Stapler</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'rail_cannon')}
                    className="px-2 py-1 rounded-lg bg-orange-950/60 hover:bg-orange-900/70 border border-orange-700/70 text-orange-200 text-[10px] font-semibold flex items-center justify-center gap-1"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>Rail Cannon</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitAction(unit.id, 'arc_caster')}
                    className="px-2 py-1 rounded-lg bg-fuchsia-950/60 hover:bg-fuchsia-900/70 border border-fuchsia-700/70 text-fuchsia-200 text-[10px] font-semibold flex items-center justify-center gap-1"
                  >
                    <Zap className="w-3 h-3" />
                    <span>Arc Caster</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => onUnitAction(unit.id, 'bless')}
                className="col-span-2 px-2 py-1 rounded-lg bg-[#0058a3]/80 hover:bg-sky-700 border border-[#ffda1a]/60 text-white text-[10px] font-semibold flex items-center justify-center gap-1"
              >
                <Sparkles className="w-3 h-3 text-[#ffda1a]" />
                <span>Divine Blessing (+HP &amp; ATK)</span>
              </button>
              {onGrantGreenCard && greenCardTargets.length > 0 && (
                <div className="col-span-2 flex items-center gap-1 pt-1">
                  <select
                    value={greenCardHostId >= 0 ? greenCardHostId : greenCardTargets[0].id}
                    onChange={(e) => setGreenCardHostId(Number(e.target.value))}
                    className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    {greenCardTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      onGrantGreenCard(
                        unit.id,
                        greenCardHostId >= 0 ? greenCardHostId : greenCardTargets[0].id
                      )
                    }
                    className="px-2 py-1 rounded-lg bg-emerald-950/75 hover:bg-emerald-900/80 border border-emerald-600/70 text-emerald-200 text-[10px] font-semibold whitespace-nowrap flex items-center gap-1"
                  >
                    <BadgeCheck className="w-3 h-3" />
                    <span>Green Card</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
