import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Crown,
  Flag,
  Handshake,
  Pencil,
  Send,
  Shield,
  Skull,
  Swords,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { NATION_PALETTE, TECH_TIER_NAMES, WEAPON_LABELS } from '../game/constants';
import { RESEARCH_BY_ID, RESEARCH_TREE } from '../game/research';
import { BannerEmblem, BannerStyle, BuildingSpacing, DiplomaticStance, Nation } from '../game/types';

interface NationPanelProps {
  nation: Nation;
  allNations: Nation[];
  hasGeminiKey: boolean;
  onClose: () => void;
  onWhisper: (nationId: number, message: string) => Promise<string>;
  onSelectNation: (nationId: number) => void;
  onOpenResearchTree: () => void;
  onRenameNation: (nationId: number, newName: string) => void;
  onUpdateNationBanner: (
    nationId: number,
    patch: {
      color?: string;
      secondaryColor?: string;
      bannerStyle?: BannerStyle;
      bannerEmblem?: BannerEmblem;
    }
  ) => void;
  onChangeBuildingSpacing: (nationId: number, spacing: BuildingSpacing) => void;
  onSpawnUnitsForNation: (nationId: number, unitType: 'citizen' | 'guard') => void;
  onSetDiplomacy: (aId: number, bId: number, stance: DiplomaticStance) => void;
  onUniteNations: (aId: number, bId: number) => void;
}

export const NationPanel: React.FC<NationPanelProps> = ({
  nation,
  allNations,
  hasGeminiKey,
  onClose,
  onWhisper,
  onSelectNation,
  onOpenResearchTree,
  onRenameNation,
  onUpdateNationBanner,
  onChangeBuildingSpacing,
  onSpawnUnitsForNation,
  onSetDiplomacy,
  onUniteNations,
}) => {
  const [whisperText, setWhisperText] = useState('');
  const [whisperReply, setWhisperReply] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingBanner, setEditingBanner] = useState(false);
  const [nameDraft, setNameDraft] = useState(nation.name);
  const [diploTargetId, setDiploTargetId] = useState<number | null>(null);

  const otherAliveNations = allNations.filter((n) => n.alive && n.id !== nation.id);

  useEffect(() => {
    setEditingName(false);
    setEditingBanner(false);
    setNameDraft(nation.name);
    const firstOther = allNations.find((n) => n.alive && n.id !== nation.id);
    setDiploTargetId(firstOther ? firstOther.id : null);
  }, [nation.id, nation.name, allNations]);

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
        <div className="min-w-0 flex-1">
          {editingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (nameDraft.trim()) {
                  onRenameNation(nation.id, nameDraft.trim());
                }
                setEditingName(false);
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={nameDraft}
                maxLength={28}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                className="flex-1 min-w-0 bg-slate-900 border border-[#ffda1a]/70 rounded px-2 py-1 text-xs font-semibold text-white focus:outline-none"
              />
              <button
                type="submit"
                className="p-1 rounded bg-[#0058a3] text-white hover:bg-sky-700"
                title="Save Name"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <span
                className="w-5 h-4 rounded-sm shrink-0 border border-white/25 flex items-center justify-center text-[9px] leading-none font-bold text-white shadow-sm"
                style={
                  nation.alive && nation.secondaryColor && nation.bannerStyle && nation.bannerStyle !== 'solid'
                    ? nation.bannerStyle === 'striped'
                      ? {
                          background: `repeating-linear-gradient(135deg, ${nation.color}, ${nation.color} 3px, ${nation.secondaryColor} 3px, ${nation.secondaryColor} 6px)`,
                        }
                      : nation.bannerStyle === 'crowned'
                        ? {
                            background: `linear-gradient(180deg, ${nation.secondaryColor} 0%, ${nation.secondaryColor} 38%, ${nation.color} 38%, ${nation.color} 100%)`,
                          }
                        : {
                            background: `linear-gradient(90deg, ${nation.color} 0%, ${nation.color} 50%, ${nation.secondaryColor} 50%, ${nation.secondaryColor} 100%)`,
                          }
                    : { backgroundColor: nation.alive ? nation.color : '#64748b' }
                }
              >
                {nation.bannerEmblem === 'crown'
                  ? '♛'
                  : nation.bannerEmblem === 'shield'
                    ? '🛡'
                    : nation.bannerEmblem === 'cart'
                      ? '🛒'
                      : nation.bannerEmblem === 'star'
                        ? '★'
                        : nation.bannerEmblem === 'bolt'
                          ? '⚡'
                          : ''}
              </span>
              <h2 className="font-display text-lg font-bold text-white truncate">
                {nation.name}
              </h2>
              {nation.alive && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setNameDraft(nation.name);
                      setEditingName(true);
                    }}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                    title="Rename Kingdom"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingBanner((prev) => !prev)}
                    className={`p-1 rounded transition-colors ${
                      editingBanner
                        ? 'bg-[#0058a3] text-[#ffda1a]'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                    title="Customize Flag & Banner"
                  >
                    <Flag className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-0.5">
            {nation.species === 'staff' && (
              <span className="text-yellow-300 font-semibold mr-1.5">Staff Kingdom ·</span>
            )}
            {nation.isUnion && (
              <span className="text-amber-300 font-semibold mr-1.5">Grand Union ·</span>
            )}
            Tier {nation.techTier}: {TECH_TIER_NAMES[nation.techTier]} · {nation.ideology}
          </p>
          {nation.isUnion && nation.unionMembers && nation.unionMembers.length > 1 && (
            <p className="text-[10px] text-amber-200/80 mt-0.5 truncate">
              Members: {nation.unionMembers.join(' + ')}
            </p>
          )}
          {nation.alive && (
            <div className="flex items-center gap-1.5 mt-2">
              <button
                type="button"
                onClick={() => onSpawnUnitsForNation(nation.id, 'citizen')}
                className="px-2 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-700/70 text-emerald-200 text-[10px] font-semibold flex items-center gap-1"
              >
                <UserPlus className="w-3 h-3" />
                <span>+3 Citizens</span>
              </button>
              <button
                type="button"
                onClick={() => onSpawnUnitsForNation(nation.id, 'guard')}
                className="px-2 py-1 rounded bg-sky-950/60 hover:bg-sky-900/70 border border-sky-700/70 text-sky-200 text-[10px] font-semibold flex items-center gap-1"
              >
                <Shield className="w-3 h-3" />
                <span>+2 Guards</span>
              </button>
              <button
                type="button"
                onClick={() => setEditingBanner((prev) => !prev)}
                className={`px-2 py-1 rounded border text-[10px] font-semibold flex items-center gap-1 transition-colors ${
                  editingBanner
                    ? 'bg-[#0058a3] border-[#ffda1a]/80 text-[#ffda1a]'
                    : 'bg-slate-900/80 hover:bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                <Flag className="w-3 h-3" />
                <span>Flag</span>
              </button>
            </div>
          )}

          {nation.alive && editingBanner && (
            <div className="mt-2.5 p-2.5 rounded-lg bg-slate-900/90 border border-slate-700/90 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-semibold text-slate-300">
                <span>Flag &amp; Union Banner</span>
                <button
                  type="button"
                  onClick={() => setEditingBanner(false)}
                  className="text-slate-400 hover:text-white"
                >
                  Done
                </button>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-slate-400">Primary Color</div>
                <div className="flex flex-wrap gap-1">
                  {NATION_PALETTE.slice(0, 10).map((p) => (
                    <button
                      key={`prim-${p.color}`}
                      type="button"
                      onClick={() => onUpdateNationBanner(nation.id, { color: p.color })}
                      className={`w-4 h-4 rounded-sm border transition-transform ${
                        nation.color === p.color
                          ? 'border-white scale-110 ring-1 ring-[#ffda1a]'
                          : 'border-white/20 hover:scale-105'
                      }`}
                      style={{ backgroundColor: p.color }}
                      title={p.name}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-slate-400">Secondary Trim</div>
                <div className="flex flex-wrap gap-1">
                  {[
                    '#ffda1a',
                    '#ffffff',
                    '#0f172a',
                    ...NATION_PALETTE.slice(0, 7).map((p) => p.color),
                  ].map((secColor) => (
                    <button
                      key={`sec-${secColor}`}
                      type="button"
                      onClick={() =>
                        onUpdateNationBanner(nation.id, {
                          secondaryColor: secColor,
                          bannerStyle:
                            !nation.bannerStyle || nation.bannerStyle === 'solid'
                              ? 'split'
                              : nation.bannerStyle,
                        })
                      }
                      className={`w-4 h-4 rounded-sm border transition-transform ${
                        (nation.secondaryColor || '#ffda1a') === secColor
                          ? 'border-white scale-110 ring-1 ring-[#ffda1a]'
                          : 'border-white/20 hover:scale-105'
                      }`}
                      style={{ backgroundColor: secColor }}
                      title={secColor}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-slate-400">Pattern</div>
                <div className="grid grid-cols-4 gap-1">
                  {(
                    [
                      { id: 'solid', label: 'Solid' },
                      { id: 'split', label: 'Split' },
                      { id: 'striped', label: 'Stripes' },
                      { id: 'crowned', label: 'Crown' },
                    ] as Array<{ id: BannerStyle; label: string }>
                  ).map((st) => {
                    const active = (nation.bannerStyle || 'solid') === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() =>
                          onUpdateNationBanner(nation.id, {
                            bannerStyle: st.id,
                            secondaryColor: nation.secondaryColor || '#ffda1a',
                          })
                        }
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                          active
                            ? 'bg-[#0058a3] border-[#ffda1a]/80 text-white'
                            : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-slate-400">Emblem</div>
                <div className="grid grid-cols-6 gap-1">
                  {(
                    [
                      { id: 'none', glyph: '—' },
                      { id: 'crown', glyph: '♛' },
                      { id: 'shield', glyph: '🛡' },
                      { id: 'cart', glyph: '🛒' },
                      { id: 'star', glyph: '★' },
                      { id: 'bolt', glyph: '⚡' },
                    ] as Array<{ id: BannerEmblem; glyph: string }>
                  ).map((em) => {
                    const active = (nation.bannerEmblem || 'none') === em.id;
                    return (
                      <button
                        key={em.id}
                        type="button"
                        onClick={() => onUpdateNationBanner(nation.id, { bannerEmblem: em.id })}
                        className={`py-0.5 rounded text-[11px] border ${
                          active
                            ? 'bg-[#0058a3] border-[#ffda1a]/80 text-[#ffda1a]'
                            : 'bg-slate-950 border-slate-700 text-slate-300 hover:text-white'
                        }`}
                        title={em.id}
                      >
                        {em.glyph}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
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

      {/* Defeated / Depopulated / Conquered / United State Banner */}
      {!nation.alive && (
        <div
          className={`mt-3 p-2.5 rounded-lg border space-y-1 ${
            nation.defeatedStatus === 'UNITED'
              ? 'bg-amber-950/40 border-amber-700/70 text-amber-200'
              : nation.defeatedStatus === 'CONQUERED'
                ? 'bg-rose-950/50 border-rose-800/70 text-rose-200'
                : 'bg-slate-900/90 border-slate-600/80 text-slate-200'
          }`}
        >
          <div className="flex items-center justify-between gap-2 font-semibold">
            <span className="flex items-center gap-1.5">
              {nation.defeatedStatus === 'UNITED' ? (
                <Crown className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              ) : nation.defeatedStatus === 'CONQUERED' ? (
                <Skull className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span>
                {nation.defeatedStatus === 'UNITED'
                  ? 'UNITED · MERGED'
                  : nation.defeatedStatus === 'CONQUERED'
                    ? 'DEFEATED · CONQUERED'
                    : 'DEFEATED · DEPOPULATED'}
              </span>
            </span>
            {nation.defeatedDay !== undefined && (
              <span className="font-mono-tabular text-[10px] text-slate-400">
                Day {nation.defeatedDay}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-300 leading-snug">
            {nation.defeatedStatus === 'UNITED' ? (
              <>
                Merged cleanly into{' '}
                <span className="font-semibold text-amber-200">
                  {nation.unitedIntoName || 'a Grand Union'}
                </span>
                . Citizens, buildings, and research live on under the united banner.
              </>
            ) : nation.defeatedStatus === 'CONQUERED' ? (
              <>
                Absorbed by{' '}
                <span className="font-semibold text-white">
                  {nation.conqueredByName || 'a conquering kingdom'}
                </span>
                . 0 living citizens remain.
              </>
            ) : (
              <>
                0 living citizens remain. Spawning is permanently halted unless a surviving kingdom
                colonizes or claims its {nation.territoryTiles} abandoned tiles.
              </>
            )}
          </p>
        </div>
      )}

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
      <div className="py-3 border-b border-slate-800 space-y-2.5">
        <div className="grid grid-cols-3 gap-2 font-mono-tabular">
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
            <div className="text-[10px] text-slate-400">Pop / Cap</div>
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
          <div>
            <div className="text-[10px] text-slate-400">Firearms</div>
            <div className="text-sm font-semibold text-cyan-300">{Math.round(nation.firearms ?? 0)}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Civilian Goods</div>
            <div className="text-sm font-semibold text-amber-200">{Math.round(nation.civilianGoods ?? 0)}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">Standard Arm</div>
            <div className="text-[11px] font-semibold text-rose-300 truncate">
              {WEAPON_LABELS[nation.bestWeapon ?? 'none'] ?? 'Unarmed'}
            </div>
          </div>
        </div>

        {/* Population Reproduction & Capacity Status */}
        {nation.alive && (
          <div className="bg-slate-900/75 border border-slate-800 rounded-lg p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span>Population Growth</span>
              </span>
              <span className="font-mono-tabular text-[11px]">
                {(nation.reproductionRate ?? 0) > 0 ? (
                  <span className="text-emerald-400 font-semibold">
                    +{Math.round(nation.reproductionProgress ?? 0)}%
                  </span>
                ) : (
                  <span className="text-amber-300">
                    {nation.population < 2
                      ? 'Needs 2+ citizens'
                      : nation.population >= nation.housingCap
                        ? 'At territory cap'
                      : nation.meatballs < Math.max(5, nation.population * 0.5)
                        ? 'Needs meatball supply'
                        : 'Paused (morale < 12%)'}
                  </span>
                )}
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
              <div
                className={`h-full transition-all ${
                  (nation.reproductionRate ?? 0) > 0 ? 'bg-emerald-500' : 'bg-slate-600'
                }`}
                style={{
                  width: `${Math.max(0, Math.min(100, Math.round(nation.reproductionProgress ?? 0)))}%`,
                }}
              />
            </div>
          </div>
        )}
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
          {nation.alive && (
            <div className="flex items-center justify-between gap-2 mb-2 font-sans">
              <span className="text-slate-400 text-[10px]">City Spacing</span>
              <div className="flex items-center gap-1">
                {(['Crowded', 'Balanced', 'Spaced'] as BuildingSpacing[]).map((sp) => {
                  const active = (nation.buildingSpacing ?? 'Balanced') === sp;
                  return (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => onChangeBuildingSpacing(nation.id, sp)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                        active
                          ? 'bg-[#0058a3] border-[#ffda1a]/80 text-white'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {sp}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
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
              <span className="text-cyan-300">Tech Labs</span>
              <span>{nation.buildings.techLabs ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sky-300">Cart Depots</span>
              <span>{nation.buildings.depots}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Mattress Huts</span>
              <span>{nation.buildings.huts}</span>
            </div>
            <div className="flex justify-between col-span-2">
              <span className="text-yellow-300">Watchtowers / Spotlights</span>
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
              <span>Technology &amp; Research</span>
              <span className="text-[11px] font-mono-tabular text-slate-400">
                ({nation.researchedTechs?.length ?? 0}/{RESEARCH_TREE.length})
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
              ) : (nation.researchedTechs?.length ?? 0) >= RESEARCH_TREE.length ? (
                <span className="text-emerald-400 font-sans">All {RESEARCH_TREE.length} techs unlocked</span>
              ) : (
                <span>+{(nation.researchRate ?? 0).toFixed(1)} RP/s · Idle</span>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={!nation.alive}
            onClick={onOpenResearchTree}
            className="px-2.5 py-1.5 rounded-lg bg-[#0058a3] hover:bg-sky-700 disabled:opacity-40 disabled:pointer-events-none text-white text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0"
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
                          : rel.stance === 'UNION'
                            ? 'text-amber-300'
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

        {nation.alive && otherAliveNations.length > 0 && (
          <div className="pt-2 border-t border-slate-800/70 space-y-1.5">
            <div className="text-[11px] text-slate-400 font-medium">Direct Diplomacy Decree</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={diploTargetId ?? otherAliveNations[0].id}
                onChange={(e) => setDiploTargetId(Number(e.target.value))}
                className="flex-1 min-w-[120px] bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-[11px] text-slate-100 focus:outline-none focus:border-sky-500"
              >
                {otherAliveNations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const tid = diploTargetId ?? otherAliveNations[0].id;
                  onSetDiplomacy(nation.id, tid, 'WAR');
                }}
                className="px-2 py-1 rounded bg-rose-950/70 hover:bg-rose-900/80 border border-rose-700/70 text-rose-200 text-[10px] font-semibold flex items-center gap-1"
                title="Spark War"
              >
                <Swords className="w-3 h-3" />
                <span>War</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const tid = diploTargetId ?? otherAliveNations[0].id;
                  onSetDiplomacy(nation.id, tid, 'ALLIANCE');
                }}
                className="px-2 py-1 rounded bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-700/70 text-emerald-200 text-[10px] font-semibold flex items-center gap-1"
                title="Forge Alliance"
              >
                <Handshake className="w-3 h-3" />
                <span>Ally</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const tid = diploTargetId ?? otherAliveNations[0].id;
                  onSetDiplomacy(nation.id, tid, 'UNION');
                }}
                className="px-2 py-1 rounded bg-amber-950/70 hover:bg-amber-900/80 border border-amber-700/70 text-amber-200 text-[10px] font-semibold flex items-center gap-1"
                title="Form Defense & Trade Union Pact"
              >
                <Shield className="w-3 h-3" />
                <span>Union</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const tid = diploTargetId ?? otherAliveNations[0].id;
                  onUniteNations(nation.id, tid);
                }}
                className="px-2 py-1 rounded bg-amber-600/80 hover:bg-amber-500 border border-amber-400/70 text-slate-950 text-[10px] font-bold flex items-center gap-1"
                title="Unite Both Kingdoms Into One Realm"
              >
                <Crown className="w-3 h-3" />
                <span>Unite</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const tid = diploTargetId ?? otherAliveNations[0].id;
                  onSetDiplomacy(nation.id, tid, 'NEUTRAL');
                }}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-[10px] font-semibold"
                title="Make Peace"
              >
                Peace
              </button>
            </div>
          </div>
        )}
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

        {nation.alive ? (
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
        ) : (
          <p className="text-[11px] text-slate-500">
            Kingdom fallen — divine whispers cannot reach a defeated realm.
          </p>
        )}
      </div>
    </div>
  );
};
