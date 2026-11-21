import React, { useState } from 'react';
import { BookOpen, Crown, Send, Shield, Swords, X } from 'lucide-react';
import { TECH_TIER_NAMES } from '../game/constants';
import { RESEARCH_BY_ID } from '../game/research';
import { Nation } from '../game/types';

interface NationPanelProps {
  nation: Nation;
  allNations: Nation[];
  hasGeminiKey: boolean;
  onClose: () => void;
  onWhisper: (nationId: number, message: string) => Promise<string>;
  onSelectNation: (nationId: number) => void;
  onOpenResearchTree: () => void;
}

export const NationPanel: React.FC<NationPanelProps> = ({
  nation,
  allNations,
  hasGeminiKey,
  onClose,
  onWhisper,
  onSelectNation,
  onOpenResearchTree,
}) => {
  const [whisperText, setWhisperText] = useState('');
  const [whisperReply, setWhisperReply] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const overlord =
    nation.overlordId !== null
      ? allNations.find((n) => n.id === nation.overlordId && n.alive)
      : undefined;
  const vassals = allNations.filter((n) => nation.vassalIds.includes(n.id) && n.alive);

  const relationsList = Object.entries(nation.relations)
    .map(([idStr, rel]) => ({
      other: allNations.find((n) => n.id === Number(idStr) && n.alive),
      rel,
    }))
    .filter((entry) => entry.other && entry.rel.stance !== 'NEUTRAL');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = whisperText.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      const reply = await onWhisper(nation.id, msg);
      setWhisperReply(reply);
      setWhisperText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pointer-events-auto fixed inset-x-3 top-14 sm:inset-x-auto sm:left-4 sm:top-16 z-40 w-auto sm:w-[370px] max-h-[85vh] overflow-y-auto bg-[#11161f]/96 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl p-4 text-xs text-slate-200">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="w-3.5 h-3.5 rounded-sm shrink-0 border border-white/20"
              style={{ backgroundColor: nation.color }}
            />
            <h2 className="font-display text-lg font-bold text-white truncate">
              {nation.name}
            </h2>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Tier {nation.techTier}: {TECH_TIER_NAMES[nation.techTier]} · {nation.ideology}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 -mr-1 -mt-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label="Close Nation Panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Government & Leader */}
      <div className="py-3 border-b border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Government</span>
          <span className="font-semibold text-sky-300">{nation.government}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Crown className="w-3.5 h-3.5 text-amber-400" />
            <span>Leader</span>
          </span>
          <span className="font-medium text-right text-slate-100">
            {nation.leader.name}{' '}
            <span className={nation.leader.alive ? 'text-emerald-400' : 'text-rose-400'}>
              ({nation.leader.alive ? 'Alive' : 'Fallen'})
            </span>
          </span>
        </div>
        {nation.leader.traits.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Leader Traits</span>
            <span className="text-slate-300">{nation.leader.traits.join(' · ')}</span>
          </div>
        )}
        {nation.battlePlan && (
          <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-rose-300 flex items-center gap-1.5 font-semibold">
                <Swords className="w-3.5 h-3.5" />
                <span>War Command</span>
              </span>
              <span className="font-semibold text-amber-300 font-mono-tabular">
                {nation.battlePlan.phase}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">General</span>
              <span className="text-slate-100 font-medium">{nation.battlePlan.generalName}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Formation</span>
              <span className="text-rose-300 font-medium">{nation.battlePlan.formation}</span>
            </div>
          </div>
        )}
      </div>

      {/* Politics: Happiness, Taxes, Threat */}
      <div className="py-3 border-b border-slate-800 space-y-2.5">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-slate-400">Citizen Happiness</span>
            <span className="font-mono-tabular font-semibold text-slate-100">
              {Math.round(nation.happiness)}%
            </span>
          </div>
          <div className="h-2 w-full bg-slate-800 rounded overflow-hidden">
            <div
              className={`h-full transition-all ${
                nation.happiness >= 60
                  ? 'bg-emerald-500'
                  : nation.happiness >= 30
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
              }`}
              style={{ width: `${Math.round(nation.happiness)}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1 font-mono-tabular">
          <div className="bg-slate-900/80 rounded-lg p-2 border border-slate-800">
            <div className="text-[10px] text-slate-400">Tax Rate</div>
            <div className="font-semibold text-slate-100 mt-0.5">{nation.taxRate}</div>
          </div>
          <div className="bg-slate-900/80 rounded-lg p-2 border border-slate-800">
            <div className="text-[10px] text-slate-400">Threat</div>
            <div className="font-semibold text-rose-300 mt-0.5">{Math.round(nation.threatScore)}</div>
          </div>
          <div className="bg-slate-900/80 rounded-lg p-2 border border-slate-800">
            <div className="text-[10px] text-slate-400">War Fatigue</div>
            <div className="font-semibold text-amber-300 mt-0.5">{Math.round(nation.warExhaustion)}%</div>
          </div>
        </div>
      </div>

      {/* Economy & Territory */}
      <div className="py-3 border-b border-slate-800 grid grid-cols-3 gap-2 font-mono-tabular">
        <div>
          <div className="text-[10px] text-slate-400">Meatballs</div>
          <div className="text-sm font-semibold text-amber-300">{Math.round(nation.meatballs)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Wood/Scrap</div>
          <div className="text-sm font-semibold text-slate-100">{Math.round(nation.scrap)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Wrenches</div>
          <div className="text-sm font-semibold text-sky-300">{Math.round(nation.allenWrenches)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Pop / Army Cap</div>
          <div className="text-sm font-semibold text-emerald-300">
            {nation.population}/{nation.housingCap}{' '}
            <span className="text-amber-300">
              ({nation.armyCount || 0}/{nation.armyCap ?? (nation.armyCount || 0)})
            </span>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Tiles</div>
          <div className="text-sm font-semibold text-slate-200">{nation.territoryTiles}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Founded</div>
          <div className="text-sm font-semibold text-slate-300">Day {nation.foundedDay}</div>
        </div>
      </div>

      {/* Citizen Workforce Jobs */}
      {nation.jobs && (
        <div className="py-2.5 border-b border-slate-800 text-[11px] font-mono-tabular">
          <div className="text-slate-400 mb-1.5 font-sans">Citizen Jobs</div>
          <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-slate-200">
            <div className="flex justify-between">
              <span className="text-emerald-300">Scavengers</span>
              <span>{nation.jobs.scavengers}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sky-300">Builders</span>
              <span>{nation.jobs.builders}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-amber-300">Chefs</span>
              <span>{nation.jobs.chefs}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-cyan-300">Tinkers</span>
              <span>{nation.jobs.tinkers}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-yellow-300">Traders</span>
              <span>{nation.jobs.traders}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-rose-300">Army</span>
              <span>
                {nation.jobs.guards}/{nation.armyCap ?? nation.jobs.guards}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* IKEA Resource Buildings */}
      {nation.buildings && (
        <div className="py-2.5 border-b border-slate-800 text-[11px] font-mono-tabular">
          <div className="flex items-center justify-between gap-2 mb-1.5 font-sans">
            <span className="text-slate-400">IKEA Resource Buildings</span>
            {nation.buildingPattern && (
              <span className="text-amber-300 font-medium">{nation.buildingPattern}</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-200">
            <div className="flex justify-between">
              <span className="text-amber-200">Meatball Bistros</span>
              <span>{nation.buildings.bistros}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-orange-300">Wrench Workshops</span>
              <span>{nation.buildings.workshops}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-purple-300">Billy Archives</span>
              <span>{nation.buildings.archives}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sky-300">Cart Depots</span>
              <span>{nation.buildings.depots}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Mattress Huts</span>
              <span>{nation.buildings.huts}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-yellow-300">Towers / Lights</span>
              <span>
                {nation.buildings.watchtowers}/{nation.buildings.spotlights}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Research & Technology Tree */}
      <div className="py-2.5 border-b border-slate-800 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-slate-300 font-medium">
              <BookOpen className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>Research Lab</span>
              <span className="text-[11px] font-mono-tabular text-slate-400">
                ({nation.researchedTechs?.length ?? 0}/9)
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 truncate font-mono-tabular">
              {nation.activeResearchId && RESEARCH_BY_ID[nation.activeResearchId] ? (
                <>
                  <span className="text-sky-300 font-sans font-medium">
                    {RESEARCH_BY_ID[nation.activeResearchId].name}
                  </span>{' '}
                  · {Math.floor(nation.researchPoints ?? 0)}/
                  {RESEARCH_BY_ID[nation.activeResearchId].cost} (+
                  {(nation.researchRate ?? 0).toFixed(1)}/s)
                </>
              ) : (nation.researchedTechs?.length ?? 0) >= 9 ? (
                <span className="text-emerald-400 font-sans">All 9 techs unlocked</span>
              ) : (
                <span>+{(nation.researchRate ?? 0).toFixed(1)} RP/s · Idle</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenResearchTree}
            className="px-2.5 py-1.5 rounded-lg bg-[#0058a3] hover:bg-sky-700 text-white text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            Research Tree
          </button>
        </div>
        {nation.activeResearchId && RESEARCH_BY_ID[nation.activeResearchId] && (
          <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
            <div
              className="h-full bg-sky-400 transition-all"
              style={{
                width: `${Math.min(
                  100,
                  Math.round(
                    ((nation.researchPoints ?? 0) / RESEARCH_BY_ID[nation.activeResearchId].cost) *
                      100
                  )
                )}%`,
              }}
            />
          </div>
        )}
      </div>

      {/* Vassals / Overlord & Relations */}
      <div className="py-3 border-b border-slate-800 space-y-2">
        {overlord && (
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Overlord (Loyalty {Math.round(nation.loyalty)}%)</span>
            <button
              type="button"
              onClick={() => onSelectNation(overlord.id)}
              className="font-semibold underline hover:text-white"
              style={{ color: overlord.color }}
            >
              {overlord.name}
            </button>
          </div>
        )}
        {vassals.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-400">Vassal States</span>
            <div className="flex flex-wrap justify-end gap-2">
              {vassals.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onSelectNation(v.id)}
                  className="font-semibold underline hover:text-white"
                  style={{ color: v.color }}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-slate-400 mb-1 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-slate-400" />
            <span>Active Diplomacy & Trade Routes</span>
          </div>
          {relationsList.length === 0 ? (
            <p className="text-slate-500">All neighbors currently Neutral.</p>
          ) : (
            <div className="space-y-1">
              {relationsList.map(({ other, rel }) => (
                <div key={other!.id} className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onSelectNation(other!.id)}
                    className="font-medium hover:underline truncate max-w-[190px]"
                    style={{ color: other!.color }}
                  >
                    {other!.name}
                  </button>
                  <span
                    className={`font-semibold ${
                      rel.stance === 'WAR'
                        ? 'text-rose-400'
                        : rel.stance === 'EMBARGO'
                          ? 'text-orange-400'
                          : rel.stance === 'TRADE_PACT'
                            ? 'text-sky-400'
                            : rel.stance === 'ALLIANCE' || rel.stance === 'COALITION'
                              ? 'text-emerald-400'
                              : 'text-slate-400'
                    }`}
                  >
                    {rel.stance.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Leader Quote & Whisper as God */}
      <div className="pt-3 space-y-2.5">
        <p className="italic text-slate-300 bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
          "{nation.lastQuote}"
        </p>

        {whisperReply && (
          <p className="text-sky-200 bg-sky-950/50 border border-sky-800/60 rounded-lg p-2.5">
            {whisperReply}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-1.5">
          <label className="block text-[11px] font-medium text-slate-400">
            Whisper as God{' '}
            <span className="text-slate-500">
              ({hasGeminiKey ? 'Gemini AI Active' : 'Heuristic AI · optional Gemini key'})
            </span>
          </label>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={whisperText}
              onChange={(e) => setWhisperText(e.target.value)}
              placeholder="e.g. Lower taxes or reform democracy..."
              className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              disabled={sending || !whisperText.trim()}
              className="min-h-[36px] px-3 py-2 rounded-lg bg-[#0058a3] hover:bg-sky-700 text-white font-semibold flex items-center gap-1 disabled:opacity-50 transition-colors shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{sending ? '...' : 'Send'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
