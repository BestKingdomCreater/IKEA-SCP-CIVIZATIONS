import React from 'react';
import { Music, Volume2, VolumeX, X } from 'lucide-react';

interface SettingsModalProps {
  maxPop: number;
  soundEnabled: boolean;
  musicEnabled: boolean;
  isMobile: boolean;
  onChangeMaxPop: (val: number) => void;
  onToggleSound: () => void;
  onToggleMusic: () => void;
  onResetWorld: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  maxPop,
  soundEnabled,
  musicEnabled,
  isMobile,
  onChangeMaxPop,
  onToggleSound,
  onToggleMusic,
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
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onResetWorld();
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
