import React from 'react';
import {
  AlertTriangle,
  Armchair,
  ArrowUpDown,
  Beef,
  Biohazard,
  BrickWall,
  Castle,
  CloudLightning,
  Compass,
  Crosshair,
  Crown,
  Eraser,
  EyeOff,
  Flame,
  FlaskConical,
  Gift,
  Hand,
  HeartHandshake,
  HeartPulse,
  Lightbulb,
  Moon,
  Orbit,
  Package,
  PackageCheck,
  PackagePlus,
  Radio,
  Route,
  ScanLine,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldPlus,
  ShoppingBag,
  Skull,
  Sparkles,
  Sun,
  SunMoon,
  Swords,
  Target,
  TrendingUp,
  Truck,
  UserPlus,
  Users,
  Utensils,
  Warehouse,
  Wrench,
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
  { id: 'spawn_warden', label: 'Warden', group: 'Spawn', icon: <ShieldAlert className="w-4 h-4" />, accent: 'text-orange-400' },
  { id: 'spawn_stalker', label: 'Stalker', group: 'Spawn', icon: <EyeOff className="w-4 h-4" />, accent: 'text-indigo-300' },
  { id: 'spawn_announcer', label: 'PA Hound', group: 'Spawn', icon: <Radio className="w-4 h-4" />, accent: 'text-rose-400' },
  { id: 'spawn_forklift', label: 'Forklift', group: 'Spawn', icon: <Truck className="w-4 h-4" />, accent: 'text-yellow-400' },
  { id: 'spawn_thrower', label: 'Thrower', group: 'Spawn', icon: <Package className="w-4 h-4" />, accent: 'text-orange-400' },
  { id: 'spawn_disruptor', label: 'Scanner', group: 'Spawn', icon: <ScanLine className="w-4 h-4" />, accent: 'text-fuchsia-400' },
  { id: 'spawn_manager', label: 'Manager', group: 'Spawn', icon: <Skull className="w-4 h-4" />, accent: 'text-amber-400' },
  { id: 'spawn_director', label: 'Director', group: 'Spawn', icon: <Crown className="w-4 h-4" />, accent: 'text-rose-400' },
  { id: 'spawn_tech', label: 'Shift Tech', group: 'Spawn', icon: <Wrench className="w-4 h-4" />, accent: 'text-cyan-300' },
  { id: 'spawn_sniper', label: 'Spotter', group: 'Spawn', icon: <Target className="w-4 h-4" />, accent: 'text-rose-300' },
  { id: 'spawn_hazmat', label: 'Hazmat', group: 'Spawn', icon: <Biohazard className="w-4 h-4" />, accent: 'text-lime-400' },
  { id: 'spawn_colossus', label: 'Goliath', group: 'Spawn', icon: <Shield className="w-4 h-4" />, accent: 'text-orange-400' },
  { id: 'spawn_trader', label: 'Trader', group: 'Spawn', icon: <ShoppingBag className="w-4 h-4" />, accent: 'text-sky-300' },
  { id: 'spawn_caravan', label: 'Caravan', group: 'Spawn', icon: <Compass className="w-4 h-4" />, accent: 'text-amber-300' },
  { id: 'spawn_mercenary', label: 'Mercenary', group: 'Spawn', icon: <Crosshair className="w-4 h-4" />, accent: 'text-violet-300' },

  { id: 'paint_food', label: 'Food Court', group: 'Paint', icon: <Beef className="w-4 h-4" />, accent: 'text-yellow-300' },
  { id: 'paint_warehouse', label: 'Warehouse', group: 'Paint', icon: <Warehouse className="w-4 h-4" />, accent: 'text-slate-300' },
  { id: 'paint_showroom', label: 'Showroom', group: 'Paint', icon: <Armchair className="w-4 h-4" />, accent: 'text-amber-200' },
  { id: 'paint_dark', label: 'Dark Sector', group: 'Paint', icon: <Moon className="w-4 h-4" />, accent: 'text-indigo-300' },
  { id: 'paint_road', label: 'Walkway', group: 'Paint', icon: <Route className="w-4 h-4" />, accent: 'text-yellow-200' },
  { id: 'paint_eraser', label: 'Eraser', group: 'Paint', icon: <Eraser className="w-4 h-4" />, accent: 'text-rose-300' },

  { id: 'build_spotlight', label: 'Spotlight', group: 'Build', icon: <Lightbulb className="w-4 h-4" />, accent: 'text-yellow-200' },
  { id: 'build_watchtower', label: 'Tower', group: 'Build', icon: <Castle className="w-4 h-4" />, accent: 'text-amber-300' },
  { id: 'build_wall', label: 'Barricade', group: 'Build', icon: <BrickWall className="w-4 h-4" />, accent: 'text-orange-300' },
  { id: 'build_bistro', label: 'Bistro', group: 'Build', icon: <Utensils className="w-4 h-4" />, accent: 'text-sky-300' },
  { id: 'build_tech_lab', label: 'Tech Lab', group: 'Build', icon: <FlaskConical className="w-4 h-4" />, accent: 'text-cyan-300' },
  { id: 'build_escalator', label: 'Escalator', group: 'Build', icon: <ArrowUpDown className="w-4 h-4" />, accent: 'text-teal-300' },

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
  { id: 'power_staff_purge', label: 'Dawn Purge', group: 'Power', icon: <Sun className="w-4 h-4" />, accent: 'text-yellow-200' },
  { id: 'power_time_shift', label: 'Flip Time', group: 'Power', icon: <SunMoon className="w-4 h-4" />, accent: 'text-amber-300' },
  { id: 'power_rally_guard', label: 'Conscript', group: 'Power', icon: <ShieldPlus className="w-4 h-4" />, accent: 'text-sky-300' },
  { id: 'power_restock', label: 'Restock', group: 'Power', icon: <PackagePlus className="w-4 h-4" />, accent: 'text-yellow-300' },
  { id: 'power_plague', label: 'Spoiled Meat', group: 'Power', icon: <Biohazard className="w-4 h-4" />, accent: 'text-lime-400' },
  { id: 'power_anomaly', label: 'Anomaly', group: 'Power', icon: <Radio className="w-4 h-4" />, accent: 'text-fuchsia-300' },
  { id: 'power_supply_drop', label: 'Supply Drop', group: 'Power', icon: <PackageCheck className="w-4 h-4" />, accent: 'text-amber-300' },
  { id: 'power_pacify_staff', label: 'Tame Staff', group: 'Power', icon: <HeartHandshake className="w-4 h-4" />, accent: 'text-emerald-300' },
  { id: 'power_prosperity', label: 'Prosperity', group: 'Power', icon: <TrendingUp className="w-4 h-4" />, accent: 'text-yellow-300' },
  { id: 'power_vortex', label: 'Vortex', group: 'Power', icon: <Orbit className="w-4 h-4" />, accent: 'text-indigo-300' },
  { id: 'power_enlighten', label: 'Enlighten', group: 'Power', icon: <FlaskConical className="w-4 h-4" />, accent: 'text-cyan-300' },
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
