import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Crown, Eye, Handshake, Shield, Skull, Swords } from 'lucide-react';
import { SUMMIT_X, SUMMIT_Y } from '../game/constants';
import { DiplomaticStance, Nation } from '../game/types';

interface WarTrackerProps {
  nations: Nation[];
  summitActive: boolean;
  isNight: boolean;
  isMobile: boolean;
  originTx?: number;
  originTy?: number;
  onSelectNation: (nationId: number) => void;
  onPanToTile: (tx: number, ty: number) => void;
  onOpenSummitLounge: () => void;
}

interface DiplomaticPair {
  a: Nation;
  b: Nation;
  stance: DiplomaticStance;
}

export const WarTracker: React.FC<WarTrackerProps> = ({
  nations,
  summitActive,
  isNight,
  isMobile,
  originTx = 0,
  originTy = 0,
  onSelectNation,
  onPanToTile,
  onOpenSummitLounge,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(isMobile);

  const aliveNations = nations.filter((n) => n.alive);
  const fallenNations = nations.filter((n) => !n.alive);
  const nationById = new Map<number, Nation>(aliveNations.map((n) => [n.id, n]));

  const wars: DiplomaticPair[] = [];
  const pacts: DiplomaticPair[] = [];

  for (let i = 0; i < aliveNations.length; i++) {
    const a = aliveNations[i];
    for (const [otherIdStr, rel] of Object.entries(a.relations)) {
      const otherId = Number(otherIdStr);
      if (otherId <= a.id) continue;
      const b = nationById.get(otherId);
      if (!b) continue;
      if (rel.stance === 'WAR') {
        wars.push({ a, b, stance: 'WAR' });
      } else if (
        rel.stance === 'TRADE_PACT' ||
        rel.stance === 'ALLIANCE' ||
        rel.stance === 'UNION' ||
        rel.stance === 'COALITION'
      ) {
        pacts.push({ a, b, stance: rel.stance });
      }
    }
  }

  const sortedArmies = [...aliveNations].sort(
    (x, y) => (y.armyCount || 0) - (x.armyCount || 0)
  );

  return (
    <div className="pointer-events-auto w-[260px] sm:w-[290px] bg-[#0d1117]/92 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-xl text-xs text-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full min-h-[40px] px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-800/70 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 font-mono-tabular">
          <Swords className={`w-3.5 h-3.5 shrink-0 ${wars.length > 0 ? 'text-rose-400' : 'text-slate-400'}`} />
          <span className="font-semibold text-slate-100 truncate">
            Wars {wars.length} · Trade {pacts.length}
          </span>
          {summitActive && !isNight && (
            <span className="text-[10px] font-semibold text-amber-300 shrink-0">
              · Summit
            </span>
          )}
        </div>
        {collapsed ? (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-slate-800 px-3 py-2.5 space-y-3 max-h-[60vh] overflow-y-auto">
          {/* Active Wars */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold text-rose-300 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Swords className="w-3.5 h-3.5" />
                <span>Active Wars</span>
              </span>
              <span className="font-mono-tabular text-slate-400">{wars.length}</span>
            </div>
            {wars.length === 0 ? (
              <p className="text-[11px] text-slate-500">All kingdoms currently at peace.</p>
            ) : (
              <div className="space-y-1.5">
                {wars.map(({ a, b }) => {
                  const avgFatigue = Math.round((a.warExhaustion + b.warExhaustion) * 0.5);
                  const midX = Math.round((a.capitalX + b.capitalX) * 0.5);
                  const midY = Math.round((a.capitalY + b.capitalY) * 0.5);
                  return (
                    <div
                      key={`${a.id}-${b.id}`}
                      className="bg-slate-900/80 border border-rose-900/50 rounded-lg p-2 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-1 text-[11px]">
                        <button
                          type="button"
                          onClick={() => onSelectNation(a.id)}
                          className="font-semibold truncate hover:underline max-w-[95px] text-left"
                          style={{ color: a.color }}
                        >
                          {a.name}
                        </button>
                        <span className="text-rose-400 font-semibold shrink-0">vs</span>
                        <button
                          type="button"
                          onClick={() => onSelectNation(b.id)}
                          className="font-semibold truncate hover:underline max-w-[95px] text-right"
                          style={{ color: b.color }}
                        >
                          {b.name}
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono-tabular">
                        <span>
                          Armies {a.armyCount || 0}/{a.armyCap ?? (a.armyCount || 0)} vs {b.armyCount || 0}/{b.armyCap ?? (b.armyCount || 0)} · Fatigue {avgFatigue}%
                        </span>
                        <button
                          type="button"
                          onClick={() => onPanToTile(midX, midY)}
                          className="px-2 py-0.5 rounded bg-rose-950/70 hover:bg-rose-900 text-rose-200 border border-rose-800/60 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                          title="Pan camera to war front"
                        >
                          <Eye className="w-3 h-3" />
                          <span>View</span>
                        </button>
                      </div>
                      {(a.battlePlan || b.battlePlan) && (
                        <div className="pt-1 border-t border-slate-800/80 space-y-0.5 text-[10px] text-slate-300 font-mono-tabular">
                          {a.battlePlan && (
                            <div className="truncate">
                              <span className="font-semibold" style={{ color: a.color }}>
                                Gen. {a.battlePlan.generalName.split(' ')[0]}
                              </span>{' '}
                              <span className="text-slate-400">
                                · {a.battlePlan.formation} · {a.battlePlan.phase}
                              </span>
                            </div>
                          )}
                          {b.battlePlan && (
                            <div className="truncate">
                              <span className="font-semibold" style={{ color: b.color }}>
                                Gen. {b.battlePlan.generalName.split(' ')[0]}
                              </span>{' '}
                              <span className="text-slate-400">
                                · {b.battlePlan.formation} · {b.battlePlan.phase}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Trade Pacts & Alliances */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold text-sky-300 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Handshake className="w-3.5 h-3.5" />
                <span>Trade & Alliances</span>
              </span>
              <span className="font-mono-tabular text-slate-400">{pacts.length}</span>
            </div>
            {pacts.length === 0 ? (
              <p className="text-[11px] text-slate-500">No active trade routes yet.</p>
            ) : (
              <div className="space-y-1">
                {pacts.map(({ a, b, stance }) => (
                  <div
                    key={`${a.id}-${b.id}`}
                    className="flex items-center justify-between gap-1.5 text-[11px] bg-slate-900/60 border border-slate-800 rounded px-2 py-1"
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelectNation(a.id)}
                        className="truncate hover:underline max-w-[75px]"
                        style={{ color: a.color }}
                      >
                        {a.name}
                      </button>
                      <span className="text-slate-500">+</span>
                      <button
                        type="button"
                        onClick={() => onSelectNation(b.id)}
                        className="truncate hover:underline max-w-[75px]"
                        style={{ color: b.color }}
                      >
                        {b.name}
                      </button>
                    </div>
                    <span
                      className={`text-[10px] font-semibold shrink-0 ${
                        stance === 'TRADE_PACT'
                          ? 'text-sky-400'
                          : stance === 'UNION'
                            ? 'text-amber-300'
                            : 'text-emerald-400'
                      }`}
                    >
                      {stance === 'TRADE_PACT' ? 'TRADE' : stance}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Kingdom Armies */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                <span>Kingdom Armies</span>
              </span>
              <span className="font-mono-tabular text-slate-400">{aliveNations.length}</span>
            </div>
            <div className="space-y-1">
              {sortedArmies.map((n) => (
                <div
                  key={n.id}
                  className="flex items-center justify-between gap-2 text-[11px] bg-slate-900/50 rounded px-2 py-1 border border-slate-800/80"
                >
                  <button
                    type="button"
                    onClick={() => onSelectNation(n.id)}
                    className="flex items-center gap-1.5 min-w-0 hover:underline text-left"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: n.color }}
                    />
                    <span className="truncate text-slate-200">{n.name}</span>
                  </button>
                  <div className="flex items-center gap-2 shrink-0 font-mono-tabular">
                    <span className="text-amber-300">
                      {n.armyCount || 0}/{n.armyCap ?? (n.armyCount || 0)} Guards
                    </span>
                    <button
                      type="button"
                      onClick={() => onPanToTile(n.capitalX, n.capitalY)}
                      className="text-slate-400 hover:text-white"
                      title={`Jump to ${n.name} capital`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fallen / Defeated Kingdoms */}
          {fallenNations.length > 0 && (
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Skull className="w-3.5 h-3.5 text-slate-400" />
                  <span>Fallen Kingdoms</span>
                </span>
                <span className="font-mono-tabular text-slate-500">{fallenNations.length}</span>
              </div>
              <div className="space-y-1">
                {fallenNations.map((n) => (
                  <div
                    key={n.id}
                    className="flex items-center justify-between gap-2 text-[11px] bg-slate-900/40 rounded px-2 py-1 border border-slate-800/70"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectNation(n.id)}
                      className="flex items-center gap-1.5 min-w-0 hover:underline text-left"
                    >
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-slate-600" />
                      <span className="truncate text-slate-400">{n.name}</span>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0 font-mono-tabular">
                      <span
                        className={`text-[10px] font-semibold ${
                          n.defeatedStatus === 'UNITED'
                            ? 'text-amber-300'
                            : n.defeatedStatus === 'CONQUERED'
                              ? 'text-rose-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {n.defeatedStatus === 'UNITED'
                          ? 'United'
                          : n.defeatedStatus === 'CONQUERED'
                            ? 'Conquered'
                            : 'Depopulated'}
                      </span>
                      <button
                        type="button"
                        onClick={() => onPanToTile(n.capitalX, n.capitalY)}
                        className="text-slate-500 hover:text-slate-200"
                        title={`View ruins of ${n.name}`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Neutral Summit Lounge */}
          <div className="pt-1 border-t border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] min-w-0">
              <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className={`truncate ${summitActive && !isNight ? 'text-amber-300 font-semibold' : 'text-slate-400'}`}>
                {summitActive && !isNight
                  ? 'Summit Lounge Active'
                  : isNight
                    ? 'Lounge (Spotlights On)'
                    : 'Neutral Summit Lounge'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                onPanToTile(SUMMIT_X - originTx, SUMMIT_Y - originTy);
                onOpenSummitLounge();
              }}
              className="px-2 py-1 rounded bg-[#0058a3] hover:bg-sky-700 text-[#ffda1a] text-[10px] font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Open Lounge
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
