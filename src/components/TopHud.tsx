import React from 'react';
import {
  Crown,
  Flag,
  KeyRound,
  Moon,
  Music,
  Pause,
  Play,
  RotateCcw,
  Save,
  Settings,
  Sun,
  Trophy,
  VolumeX,
} from 'lucide-react';
import { HudSnapshot, SimSpeed } from '../game/types';

interface TopHudProps {
  hud: HudSnapshot;
  hasGeminiKey: boolean;
  musicEnabled: boolean;
  summitLoungeOpen: boolean;
  summitSessionActive: boolean;
  onSetSpeed: (speed: SimSpeed) => void;
  onTogglePause: () => void;
  onToggleMusic: () => void;
  onOpenGeminiModal: () => void;
  onOpenSettings: () => void;
  onOpenSaveLoad: () => void;
  onOpenRecords: () => void;
  onOpenCustomKingdom: () => void;
  onToggleSummitLounge: () => void;
  onResetWorld: () => void;
}

const SPEEDS: SimSpeed[] = [1, 2, 5, 10];

export const TopHud: React.FC<TopHudProps> = ({
  hud,
  hasGeminiKey,
  musicEnabled,
  summitLoungeOpen,
  summitSessionActive,
  onSetSpeed,
  onTogglePause,
  onToggleMusic,
  onOpenGeminiModal,
  onOpenSettings,
  onOpenSaveLoad,
  onOpenRecords,
  onOpenCustomKingdom,
  onToggleSummitLounge,
  onResetWorld,
}) => {
  return (
    <header className="pointer-events-auto z-30 flex flex-wrap items-center justify-between gap-2 bg-[#0d1117]/92 backdrop-blur-md border-b border-slate-800 px-3 py-1.5 text-xs">
      {/* Left: Title & Day/Night Progress */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="inline-block w-2.5 h-2.5 bg-[#0058a3] border border-[#ffda1a]" />
          <span className="font-display text-base font-bold tracking-wide text-slate-100 whitespace-nowrap">
            SCP-3008
          </span>
        </div>

        <div className="flex items-center gap-2 min-w-[130px] sm:min-w-[180px]">
          {hud.isNight ? (
            <Moon className="w-3.5 h-3.5 text-amber-300 shrink-0" />
          ) : (
            <Sun className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
          )}
          <div className="flex-1 min-w-[72px]">
            <div className="flex items-center justify-between gap-2 text-[11px] leading-none mb-1 font-mono-tabular">
              <span className={hud.isNight ? 'text-rose-300 font-semibold' : 'text-amber-200 font-semibold'}>
                Day {hud.day} · {hud.isNight ? (hud.auditNight ? 'Audit Night' : 'Closed') : 'Open'}
              </span>
              <span className="text-slate-400">{hud.phaseRemainingSec}s</span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-sm overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ${
                  hud.isNight ? 'bg-rose-500' : 'bg-[#ffda1a]'
                }`}
                style={{ width: `${Math.round(hud.cycleProgress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Center: Speed Controls & FPS/Unit Counter */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-md p-0.5">
          <button
            type="button"
            onClick={onTogglePause}
            title="Pause / Resume (Space)"
            className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${
              hud.paused
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {hud.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            <span className="hidden sm:inline">{hud.paused ? 'Play' : 'Pause'}</span>
          </button>
          {SPEEDS.map((spd) => (
            <button
              key={spd}
              type="button"
              onClick={() => onSetSpeed(spd)}
              className={`px-2 py-1 rounded text-xs font-mono-tabular transition-colors whitespace-nowrap shrink-0 ${
                !hud.paused && hud.speed === spd
                  ? 'bg-[#0058a3] text-[#ffda1a] font-semibold'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
              }`}
            >
              {spd}x
            </button>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-300 font-mono-tabular px-1.5">
          <span>{hud.fps} FPS</span>
          <span className="text-slate-600">·</span>
          <span>{hud.totalUnits} Units</span>
          <span className="text-slate-600">·</span>
          <span className="text-amber-300">{hud.staffCount} Staff</span>
        </div>
      </div>

      {/* Right: Summit Lounge, BYOK Gemini Key, Audio, Settings, Reset */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className={`hidden xl:inline text-[11px] font-medium mr-1 whitespace-nowrap ${
            hasGeminiKey ? 'text-emerald-300' : 'text-slate-400'
          }`}
        >
          {hasGeminiKey ? 'Diplomacy: Gemini AI Active' : 'Diplomacy: Heuristic AI'}
        </span>

        <button
          type="button"
          onClick={onToggleSummitLounge}
          className={`px-2.5 py-1.5 rounded-md border font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
            summitSessionActive || summitLoungeOpen
              ? 'bg-[#0058a3] border-[#ffda1a]/70 text-[#ffda1a]'
              : hud.summitActive && !hud.isNight
                ? 'bg-amber-950/70 hover:bg-amber-900/70 border-amber-500/70 text-amber-200'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-100'
          }`}
          title={summitLoungeOpen ? 'Close Summit Lounge' : 'Open Summit Lounge'}
        >
          <Crown className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">
            {summitSessionActive ? 'Summit Live' : 'Summit Lounge'}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenCustomKingdom}
          className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          title="Found Custom Kingdom"
        >
          <Flag className="w-3.5 h-3.5 text-[#ffda1a] shrink-0" />
          <span className="hidden lg:inline">New Kingdom</span>
        </button>

        <button
          type="button"
          onClick={onOpenRecords}
          className="p-1.5 px-2 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
          title="Hall of Records & Controls"
        >
          <Trophy className="w-3.5 h-3.5 text-amber-300 shrink-0" />
          <span className="hidden xl:inline">Records</span>
        </button>

        <button
          type="button"
          onClick={onOpenSaveLoad}
          className="p-1.5 px-2 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
          title="Save & Load World"
        >
          <Save className="w-3.5 h-3.5 text-sky-300 shrink-0" />
          <span className="hidden xl:inline">Saves</span>
        </button>

        <button
          type="button"
          onClick={onOpenGeminiModal}
          className={`px-2.5 py-1.5 rounded-md border font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
            hasGeminiKey
              ? 'bg-emerald-950/70 border-emerald-700/70 text-emerald-200 hover:bg-emerald-900/70'
              : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
          }`}
          title="Add Optional Gemini API Key (Stored in your browser only)"
        >
          <KeyRound className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">{hasGeminiKey ? 'Gemini Key' : 'Add Gemini Key'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleMusic}
          className={`p-1.5 rounded-md border transition-colors ${
            musicEnabled
              ? hud.isNight
                ? 'bg-rose-950/70 border-rose-700/70 text-rose-200'
                : 'bg-sky-950/70 border-sky-700/70 text-sky-200'
              : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
          }`}
          title={
            musicEnabled
              ? hud.isNight
                ? 'Store Audio: Night Horror Active (Click to Mute)'
                : 'Store Audio: IKEA Muzak Active (Click to Mute)'
              : 'Store Music Muted (Click to Enable)'
          }
        >
          {musicEnabled ? <Music className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors"
          title="Simulation Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onResetWorld}
          className="p-1.5 rounded-md bg-slate-800 hover:bg-rose-900/60 border border-slate-700 text-slate-200 transition-colors"
          title="Generate New Store World"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
