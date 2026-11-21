import React from 'react';
import { BookOpen, Check, Flame, Lock, Shield, Sparkles, Wrench, X } from 'lucide-react';
import {
  BRANCH_LABELS,
  canResearchTech,
  hasTech,
  RESEARCH_BY_ID,
  RESEARCH_TREE,
  ResearchNode,
} from '../game/research';
import { Nation, ResearchBranch, TechId } from '../game/types';

interface ResearchTreeModalProps {
  nation: Nation;
  onFocusTech: (techId: TechId) => void;
  onGrantTech: (techId: TechId) => void;
  onClose: () => void;
}

const BRANCH_ORDER: ResearchBranch[] = ['economy', 'military', 'lighting'];

const BRANCH_ICON: Record<ResearchBranch, React.ReactNode> = {
  economy: <Wrench className="w-4 h-4 text-amber-300 shrink-0" />,
  military: <Shield className="w-4 h-4 text-rose-400 shrink-0" />,
  lighting: <Flame className="w-4 h-4 text-sky-300 shrink-0" />,
};

export const ResearchTreeModal: React.FC<ResearchTreeModalProps> = ({
  nation,
  onFocusTech,
  onGrantTech,
  onClose,
}) => {
  const unlockedCount = nation.researchedTechs?.length ?? 0;
  const currentRp = nation.researchPoints ?? 0;
  const currentRate = nation.researchRate ?? 0;
  const activeNode = nation.activeResearchId ? RESEARCH_BY_ID[nation.activeResearchId] : undefined;
  const activePct = activeNode
    ? Math.max(0, Math.min(100, Math.round((currentRp / activeNode.cost) * 100)))
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#11161f]/98 border border-slate-700 rounded-xl shadow-2xl text-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-800 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="w-3.5 h-3.5 rounded-sm shrink-0 border border-white/20"
                style={{ backgroundColor: nation.color }}
              />
              <BookOpen className="w-4 h-4 text-sky-300 shrink-0" />
              <h2 className="font-display text-lg font-bold text-white truncate">
                {nation.name} · Research Tree
              </h2>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 font-mono-tabular">
              {unlockedCount}/9 Unlocked · +{currentRate.toFixed(1)} RP/s from{' '}
              {nation.buildings?.archives ?? 0} Billy Archives &amp; Tinkers
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-1 -mt-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            aria-label="Close Research Tree"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Active Research Progress Bar */}
        <div className="px-4 py-2.5 bg-slate-900/75 border-b border-slate-800 shrink-0">
          {activeNode ? (
            <div>
              <div className="flex items-center justify-between gap-2 text-xs mb-1">
                <span className="text-slate-300">
                  Active Project:{' '}
                  <span className="font-semibold text-sky-300">{activeNode.name}</span>
                </span>
                <span className="font-mono-tabular text-slate-300">
                  {Math.floor(currentRp)} / {activeNode.cost} RP ({activePct}%)
                </span>
              </div>
              <div className="h-2 w-full bg-slate-800 rounded overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-300"
                  style={{ width: `${activePct}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                {unlockedCount >= RESEARCH_TREE.length
                  ? 'All 9 IKEA technologies mastered!'
                  : 'Select an available project below to focus nation researchers.'}
              </span>
              <span className="font-mono-tabular text-emerald-400">
                {unlockedCount}/{RESEARCH_TREE.length} Complete
              </span>
            </div>
          )}
        </div>

        {/* 3-Branch Tech Columns */}
        <div className="p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-3 gap-4">
          {BRANCH_ORDER.map((branch) => {
            const branchNodes = RESEARCH_TREE.filter((n) => n.branch === branch).sort(
              (a, b) => a.tier - b.tier
            );
            return (
              <div key={branch} className="flex flex-col">
                <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-800">
                  {BRANCH_ICON[branch]}
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                    {BRANCH_LABELS[branch]}
                  </h3>
                </div>

                <div className="flex flex-col">
                  {branchNodes.map((node: ResearchNode, idx: number) => {
                    const unlocked = hasTech(nation, node.id);
                    const isActive = nation.activeResearchId === node.id;
                    const available = canResearchTech(nation, node);
                    const reqNode = node.requires ? RESEARCH_BY_ID[node.requires] : undefined;

                    const cardClasses = unlocked
                      ? 'bg-emerald-950/35 border-emerald-700/60'
                      : isActive
                        ? 'bg-sky-950/45 border-sky-500/70'
                        : available
                          ? 'bg-slate-900/90 border-slate-700'
                          : 'bg-slate-950/70 border-slate-800/80 opacity-85';

                    return (
                      <React.Fragment key={node.id}>
                        {idx > 0 && (
                          <div
                            className={`h-3 w-0.5 mx-auto ${
                              unlocked || isActive || available ? 'bg-sky-600/70' : 'bg-slate-800'
                            }`}
                          />
                        )}
                        <div className={`rounded-lg border p-3 text-xs transition-colors ${cardClasses}`}>
                          <div className="flex items-center justify-between gap-2 mb-1 font-mono-tabular">
                            <span className="text-[11px] text-slate-400">
                              Tier {node.tier} · {node.cost} RP
                            </span>
                            {unlocked ? (
                              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                                <Check className="w-3 h-3" />
                                Researched
                              </span>
                            ) : isActive ? (
                              <span className="text-[11px] font-semibold text-sky-300">
                                Active
                              </span>
                            ) : available ? (
                              <span className="text-[11px] font-medium text-amber-300">
                                Available
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                                <Lock className="w-3 h-3" />
                                Locked
                              </span>
                            )}
                          </div>

                          <div className="font-semibold text-slate-100 text-[13px] leading-snug">
                            {node.name}
                          </div>
                          <p className="text-[11px] text-slate-300/90 mt-1 leading-relaxed">
                            {node.effectSummary}
                          </p>

                          {!unlocked && reqNode && !hasTech(nation, reqNode.id) && (
                            <p className="text-[10px] text-slate-500 mt-1.5">
                              Requires: {reqNode.name}
                            </p>
                          )}

                          {isActive && (
                            <div className="mt-2 h-1.5 w-full bg-slate-800 rounded overflow-hidden">
                              <div
                                className="h-full bg-sky-400 transition-all"
                                style={{ width: `${activePct}%` }}
                              />
                            </div>
                          )}

                          {!unlocked && (
                            <div className="mt-2.5 flex items-center gap-1.5">
                              {available && !isActive && (
                                <button
                                  type="button"
                                  onClick={() => onFocusTech(node.id)}
                                  className="px-2.5 py-1 rounded bg-[#0058a3] hover:bg-sky-700 text-white text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
                                >
                                  Focus
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => onGrantTech(node.id)}
                                title="God Power: Instantly unlock this technology"
                                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-amber-900/70 border border-slate-700 hover:border-amber-500/60 text-amber-300 text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                              >
                                <Sparkles className="w-3 h-3" />
                                <span>Unlock</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
