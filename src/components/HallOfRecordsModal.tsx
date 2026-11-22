import React from 'react';
import { Crown, Keyboard, Trophy, X } from 'lucide-react';
import { HallOfRecords, Nation } from '../game/types';

interface HallOfRecordsModalProps {
  day: number;
  records: HallOfRecords;
  nations: Nation[];
  onSelectNation: (nationId: number) => void;
  onClose: () => void;
}

export const HallOfRecordsModal: React.FC<HallOfRecordsModalProps> = ({
  day,
  records,
  nations,
  onSelectNation,
  onClose,
}) => {
  const totalClaimed = nations.reduce((s, n) => s + (n.alive ? n.territoryTiles : 0), 0);
  const sortedNations = [...nations].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (b.territoryTiles !== a.territoryTiles) return b.territoryTiles - a.territoryTiles;
    return b.population - a.population;
  });

  const statItems: Array<{ label: string; value: string; accent?: string }> = [
    { label: 'Current Day', value: `Day ${day}`, accent: 'text-[#ffda1a]' },
    { label: 'Peak Population', value: `${records.peakPopulation} (Day ${records.peakPopDay})`, accent: 'text-emerald-300' },
    { label: 'Wars Declared', value: `${records.totalWarsDeclared}`, accent: 'text-rose-300' },
    { label: 'Peace Treaties', value: `${records.totalPeaceTreaties}`, accent: 'text-teal-300' },
    { label: 'Buildings Built', value: `${records.totalBuildingsBuilt}`, accent: 'text-sky-300' },
    { label: 'Techs Unlocked', value: `${records.totalTechsUnlocked}`, accent: 'text-purple-300' },
    { label: 'Staff Slain', value: `${records.totalStaffSlain}`, accent: 'text-amber-300' },
    { label: 'Survivor Losses', value: `${records.totalSurvDeaths}`, accent: 'text-slate-300' },
    { label: 'Audit Nights Survived', value: `${records.auditNightsSurvived}`, accent: 'text-yellow-300' },
  ];

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[#11161f] border border-slate-700 rounded-xl shadow-2xl p-5 text-sm text-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[#ffda1a]" />
            <h2 className="font-display text-lg font-bold text-white">Hall of Records</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center -mr-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close Hall of Records"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="pt-4 space-y-5 text-xs">
          {/* Cumulative Store Records */}
          <div className="grid grid-cols-3 gap-2">
            {statItems.map((item) => (
              <div
                key={item.label}
                className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800"
              >
                <div className="text-[10px] text-slate-400 leading-tight">{item.label}</div>
                <div className={`font-mono-tabular font-bold text-sm mt-1 ${item.accent || 'text-white'}`}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {/* Kingdom Standings */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Crown className="w-3.5 h-3.5 text-[#ffda1a]" />
                <span>Kingdom Standings</span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono-tabular">
                {nations.filter((n) => n.alive).length} Active / {nations.length} Total
              </span>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {sortedNations.map((n) => {
                const share =
                  n.alive && totalClaimed > 0
                    ? Math.round((n.territoryTiles / totalClaimed) * 100)
                    : 0;
                const statusLabel = n.alive
                  ? n.isUnion
                    ? 'Grand Union'
                    : n.overlordId !== null
                      ? 'Vassal'
                      : 'Active'
                  : n.defeatedStatus === 'UNITED'
                    ? `United into ${n.unitedIntoName || 'Union'}`
                    : n.defeatedStatus === 'CONQUERED'
                      ? `Conquered by ${n.conqueredByName || 'Rival'}`
                      : 'Depopulated';

                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      onSelectNation(n.id);
                      onClose();
                    }}
                    className={`w-full min-h-[42px] px-3 py-2 rounded-lg border text-left flex items-center justify-between gap-2 transition-colors ${
                      n.alive
                        ? 'bg-slate-900/90 hover:bg-slate-800 border-slate-800'
                        : 'bg-slate-950/70 hover:bg-slate-900 border-slate-800/60 opacity-75'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-3 h-3 rounded-sm shrink-0 border border-white/20"
                        style={{ backgroundColor: n.color }}
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-100 truncate">{n.name}</div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {statusLabel} · Founded Day {n.foundedDay}
                        </div>
                      </div>
                    </div>

                    {n.alive ? (
                      <div className="text-right font-mono-tabular shrink-0">
                        <div className="text-slate-100 font-semibold">
                          {n.population} Pop · {share}%
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {n.territoryTiles} tiles · T{n.techTier}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[11px] font-mono-tabular text-slate-500 shrink-0">
                        Day {n.defeatedDay ?? day}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Controls Hint */}
          <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Keyboard className="w-3.5 h-3.5 text-sky-300" />
              <span>Controls</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <div><span className="text-slate-200 font-mono-tabular">WASD / Arrows</span> Pan camera</div>
              <div><span className="text-slate-200 font-mono-tabular">Space</span> Pause / Resume</div>
              <div><span className="text-slate-200 font-mono-tabular">Wheel / Pinch</span> Zoom map</div>
              <div><span className="text-slate-200 font-mono-tabular">Right-Drag</span> Pan anytime</div>
              <div><span className="text-slate-200 font-mono-tabular">Esc</span> Close panels</div>
              <div><span className="text-slate-200 font-mono-tabular">Click Banner</span> Inspect kingdom</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
