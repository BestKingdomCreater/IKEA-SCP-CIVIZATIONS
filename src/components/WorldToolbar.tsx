import React from 'react';
import {
  AlertTriangle,
  Armchair,
  Beef,
  CloudLightning,
  Eraser,
  Flame,
  Gift,
  Hand,
  HeartPulse,
  Moon,
  Orbit,
  Search,
  ShieldCheck,
  ShoppingBag,
  Skull,
  Sparkles,
  Swords,
  UserPlus,
  Users,
  Warehouse,
  Zap,
  ZapOff,
} from 'lucide-react';
import { BrushSize, ToolId } from '../game/types';

interface WorldToolbarProps {
  activeTool: ToolId;
  brushSize: BrushSize;
  onSelectTool: (tool: ToolId) => void;
  onSelectBrush: (size: BrushSize) => void;
}

interface ToolDef {
  id: ToolId;
  label: string;
  group: string;
  icon: React.ReactNode;
  accent?: string;
}

const TOOLS: ToolDef[] = [
  { id: 'pan', label: 'Move', group: 'Nav', icon: <Hand className="w-4 h-4" />, accent: 'text-sky-300' },
  { id: 'inspect', label: 'Inspect', group: 'Nav', icon: <Search className="w-4 h-4" />, accent: 'text-slate-200' },

  { id: 'spawn_survivor', label: 'Survivor', group: 'Spawn', icon: <UserPlus className="w-4 h-4" />, accent: 'text-emerald-300' },
  { id: 'spawn_staff', label: 'Staff', group: 'Spawn', icon: <Users className="w-4 h-4" />, accent: 'text-yellow-300' },
  { id: 'spawn_manager', label: 'Manager', group: 'Spawn', icon: <Skull className="w-4 h-4" />, accent: 'text-amber-400' },
  { id: 'spawn_trader', label: 'Trader', group: 'Spawn', icon: <ShoppingBag className="w-4 h-4" />, accent: 'text-sky-300' },

  { id: 'paint_food', label: 'Food Court', group: 'Paint', icon: <Beef className="w-4 h-4" />, accent: 'text-yellow-300' },
  { id: 'paint_warehouse', label: 'Warehouse', group: 'Paint', icon: <Warehouse className="w-4 h-4" />, accent: 'text-slate-300' },
  { id: 'paint_showroom', label: 'Showroom', group: 'Paint', icon: <Armchair className="w-4 h-4" />, accent: 'text-amber-200' },
  { id: 'paint_dark', label: 'Dark Sector', group: 'Paint', icon: <Moon className="w-4 h-4" />, accent: 'text-indigo-300' },
  { id: 'paint_eraser', label: 'Eraser', group: 'Paint', icon: <Eraser className="w-4 h-4" />, accent: 'text-rose-300' },

  { id: 'power_meatball', label: 'Meatballs', group: 'Power', icon: <Beef className="w-4 h-4" />, accent: 'text-amber-400' },
  { id: 'power_fever', label: 'Black Friday', group: 'Power', icon: <Zap className="w-4 h-4" />, accent: 'text-rose-400' },
  { id: 'power_outage', label: 'Blackout', group: 'Power', icon: <ZapOff className="w-4 h-4" />, accent: 'text-sky-400' },
  { id: 'power_firebomb', label: 'Firebomb', group: 'Power', icon: <Flame className="w-4 h-4" />, accent: 'text-orange-400' },
  { id: 'power_bless', label: 'Bless', group: 'Power', icon: <Sparkles className="w-4 h-4" />, accent: 'text-cyan-300' },
  { id: 'power_heal', label: 'Heal', group: 'Power', icon: <HeartPulse className="w-4 h-4" />, accent: 'text-emerald-400' },
  { id: 'power_uplift', label: 'Gift', group: 'Power', icon: <Gift className="w-4 h-4" />, accent: 'text-amber-300' },
  { id: 'power_lightning', label: 'Lightning', group: 'Power', icon: <CloudLightning className="w-4 h-4" />, accent: 'text-yellow-300' },
  { id: 'power_meteor', label: 'Meteor', group: 'Power', icon: <Orbit className="w-4 h-4" />, accent: 'text-orange-300' },
  { id: 'power_peace', label: 'Peace', group: 'Power', icon: <ShieldCheck className="w-4 h-4" />, accent: 'text-teal-300' },
  { id: 'power_war', label: 'Spark War', group: 'Power', icon: <Swords className="w-4 h-4" />, accent: 'text-rose-400' },
  { id: 'power_coup', label: 'Trigger Coup', group: 'Power', icon: <AlertTriangle className="w-4 h-4" />, accent: 'text-purple-400' },
];

export const WorldToolbar: React.FC<WorldToolbarProps> = ({
  activeTool,
  brushSize,
  onSelectTool,
  onSelectBrush,
}) => {
  return (
    <div className="pointer-events-auto z-30 flex items-center gap-2 bg-[#0d1117]/94 backdrop-blur-md border-t border-slate-800 px-2.5 py-2">
      {/* Brush Size S/M/L */}
      <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-lg p-0.5 shrink-0">
        {(['S', 'M', 'L'] as BrushSize[]).map((sz) => (
          <button
            key={sz}
            type="button"
            onClick={() => onSelectBrush(sz)}
            className={`min-w-[34px] min-h-[38px] rounded-md text-xs font-mono-tabular font-semibold transition-colors ${
              brushSize === sz
                ? 'bg-[#0058a3] text-[#ffda1a]'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
            }`}
            title={`Brush Size ${sz}`}
          >
            {sz}
          </button>
        ))}
      </div>

      {/* Horizontally scrollable tools with >=40px touch targets */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 flex-1">
        {TOOLS.map((t, idx) => {
          const isSelected = activeTool === t.id;
          const prevGroup = idx > 0 ? TOOLS[idx - 1].group : t.group;
          const showDivider = idx > 0 && prevGroup !== t.group;
          return (
            <React.Fragment key={t.id}>
              {showDivider && <div className="w-px h-7 bg-slate-800 shrink-0 mx-0.5" />}
              <button
                type="button"
                onClick={() => onSelectTool(t.id)}
                className={`min-h-[42px] min-w-[54px] px-2.5 py-1 rounded-lg border flex flex-col items-center justify-center gap-0.5 shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-[#0058a3]/90 border-[#ffda1a] text-white'
                    : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className={isSelected ? 'text-[#ffda1a]' : t.accent}>{t.icon}</span>
                <span className="text-[10px] leading-none font-medium whitespace-nowrap">
                  {t.label}
                </span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
