import React from 'react';
import { Crown, Infinity as InfinityIcon, Map, Music, Volume2, VolumeX, X } from 'lucide-react';
import { WorldPreset } from '../game/types';

interface SettingsModalProps {
  maxPop: number;
  worldPreset: WorldPreset;
  soundEnabled: boolean;
  musicEnabled: boolean;
  allowWildStaffKingdoms: boolean;
  infiniteWorldMode: boolean;
  isMobile: boolean;
  onChangeMaxPop: (val: number) => void;
  onChangeWorldPreset: (preset: WorldPreset) => void;
  onToggleSound: () => void;
  onToggleMusic: () => void;
  onToggleWildStaffKingdoms: () => void;
  onToggleInfiniteWorld: () => void;
  onResetWorld: (preset?: WorldPreset) => void;
  onClose: () => void;
}

const PRESET_OPTIONS: Array<{ id: WorldPreset; label: string; desc: string }> = [
  { id: 'standard', label: 'Infinite Store', desc: 'Balanced aisles, showrooms & food courts' },
  { id: 'warehouse_maze', label: 'Warehouse Maze', desc: 'Dense shelf corridors & choke points' },
  { id: 'food_arena', label: 'Food Court Arena', desc: 'Abundant meatballs & fast border wars' },
  { id: 'nightmare_dark', label: 'Nightmare Dark', desc: 'Sparse lit islands in sprawling Dark Sectors' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  maxPop,
  worldPreset,
  soundEnabled,
  musicEnabled,
  allowWildStaffKingdoms,
  infiniteWorldMode,
  isMobile,
  onChangeMaxPop,
  onChangeWorldPreset,
  onToggleSound,
  onToggleMusic,
  onToggleWildStaffKingdoms,
  onToggleInfiniteWorld,
  onResetWorld,
  onClose,
}) => {
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-[#11161f] border border-slate-700 rounded-xl shadow-2xl p-5 text-sm text-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h2 className="font-display text-lg font-bold text-white">Simulation Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-1 -mt-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close Settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="pt-4 space-y-5 text-xs">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-slate-200">Max Population Cap</span>
              <span className="font-mono-tabular font-semibold text-[#ffda1a]">{maxPop}</span>
            </div>
            <input
              type="range"
              min={300}
              max={3500}
              step={100}
              value={maxPop}
              onChange={(e) => onChangeMaxPop(Number(e.target.value))}
              className="w-full accent-[#0058a3]"
            />
            <div className="flex justify-between text-[11px] text-slate-500 mt-1 font-mono-tabular">
              <span>300</span>
              <span>Default: {isMobile ? '900 (Phone)' : '2,000'}</span>
              <span>3,500</span>
            </div>
          </div>

          <div className="space-y-2 py-2.5 border-t border-slate-800">
            <div className="flex items-center gap-1.5 font-medium text-slate-200">
              <Map className="w-3.5 h-3.5 text-[#ffda1a]" />
              <span>Store Map Preset (Next Reset)</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESET_OPTIONS.map((p) => {
                const active = worldPreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onChangeWorldPreset(p.id)}
                    className={`p-2 rounded-lg border text-left transition-colors ${
                      active
                        ? 'bg-[#0058a3]/80 border-[#ffda1a] text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-semibold text-[11px]">{p.label}</div>
                    <div className="text-[10px] text-slate-400 leading-tight mt-0.5">{p.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2.5 py-2.5 border-y border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-slate-200">IKEA Store Soundtrack</div>
                <div className="text-[11px] text-slate-400">Day Muzak / Night Horror</div>
              </div>
              <button
                type="button"
                onClick={onToggleMusic}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg border font-semibold flex items-center gap-1.5 ${
                  musicEnabled
                    ? 'bg-sky-950/60 border-sky-700 text-sky-200'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {musicEnabled ? <Music className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                <span>{musicEnabled ? 'Playing' : 'Muted'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-200">Synthesized Sound FX</span>
              <button
                type="button"
                onClick={onToggleSound}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg border font-semibold flex items-center gap-1.5 ${
                  soundEnabled
                    ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                <span>{soundEnabled ? 'Enabled' : 'Muted'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <div>
                <div className="font-medium text-slate-200">Wild Staff Kingdoms</div>
                <div className="text-[11px] text-slate-400">Allow Staff groups to found realms automatically</div>
              </div>
              <button
                type="button"
                onClick={onToggleWildStaffKingdoms}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg border font-semibold flex items-center gap-1.5 shrink-0 ${
                  allowWildStaffKingdoms
                    ? 'bg-amber-950/70 border-amber-500 text-amber-200'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                <Crown className="w-3.5 h-3.5" />
                <span>{allowWildStaffKingdoms ? 'Allowed' : 'Manual'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <div>
                <div className="font-medium text-slate-200">Infinite Chunk Store</div>
                <div className="text-[11px] text-slate-400">Stream endless 30×30 IKEA sectors as you pan</div>
              </div>
              <button
                type="button"
                onClick={onToggleInfiniteWorld}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg border font-semibold flex items-center gap-1.5 shrink-0 ${
                  infiniteWorldMode
                    ? 'bg-cyan-950/70 border-cyan-500 text-cyan-200'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                <InfinityIcon className="w-3.5 h-3.5" />
                <span>{infiniteWorldMode ? 'Infinite' : 'Fixed'}</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onResetWorld(worldPreset);
                onClose();
              }}
              className="min-h-[40px] flex-1 py-2 rounded-lg bg-rose-900/50 hover:bg-rose-800/70 border border-rose-700/70 text-rose-100 font-semibold"
            >
              Generate New Store
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
