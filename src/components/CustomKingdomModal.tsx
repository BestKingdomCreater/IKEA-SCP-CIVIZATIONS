import React, { useState } from 'react';
import { Flag, MapPin, Sparkles, X } from 'lucide-react';
import { GOVERNMENTS, IDEOLOGIES, NATION_PALETTE, SETTLER_KINGDOM_NAMES } from '../game/constants';
import {
  BuildingPattern,
  CustomKingdomConfig,
  GovernmentType,
  Ideology,
} from '../game/types';

interface CustomKingdomModalProps {
  onStartMapPlacement: (config: CustomKingdomConfig) => void;
  onAutoPlace: (config: CustomKingdomConfig) => { ok: boolean; error?: string };
  onClose: () => void;
}

const BUILDING_PATTERNS: BuildingPattern[] = [
  'Iron Citadel',
  'Merchant Bazaar',
  'Showroom Plaza',
  'Cathedral Spire',
  'Imperial Concourse',
];

export const CustomKingdomModal: React.FC<CustomKingdomModalProps> = ({
  onStartMapPlacement,
  onAutoPlace,
  onClose,
}) => {
  const defaultPalette = NATION_PALETTE[Math.floor(Math.random() * NATION_PALETTE.length)];
  const defaultName =
    SETTLER_KINGDOM_NAMES[Math.floor(Math.random() * SETTLER_KINGDOM_NAMES.length)];

  const [name, setName] = useState<string>(defaultName);
  const [paletteIdx, setPaletteIdx] = useState<number>(
    Math.max(0, NATION_PALETTE.indexOf(defaultPalette))
  );
  const [government, setGovernment] = useState<GovernmentType>('Checkout Democracy');
  const [ideology, setIdeology] = useState<Ideology>('Merchant Cartel');
  const [buildingPattern, setBuildingPattern] = useState<BuildingPattern>('Showroom Plaza');
  const [startingPop, setStartingPop] = useState<number>(12);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const chosenPalette = NATION_PALETTE[paletteIdx] || NATION_PALETTE[0];

  const buildConfig = (): CustomKingdomConfig => ({
    name: name.trim() || defaultName,
    color: chosenPalette.color,
    borderColor: chosenPalette.border,
    government,
    ideology,
    buildingPattern,
    startingPop,
  });

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#11161f] border border-slate-700 rounded-xl shadow-2xl p-5 text-sm text-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Flag className="w-4 h-4 text-[#ffda1a]" />
            <h2 className="font-display text-lg font-bold text-white">Found Custom Kingdom</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center -mr-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close Kingdom Creator"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="pt-4 space-y-4 text-xs">
          {/* Kingdom Name */}
          <div>
            <label htmlFor="custom-kingdom-name" className="block text-[11px] font-medium text-slate-400 mb-1">
              Kingdom Name
            </label>
            <input
              id="custom-kingdom-name"
              type="text"
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Vittsjö Free State"
              className="w-full min-h-[40px] px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#ffda1a]"
            />
          </div>

          {/* Banner Color Swatches */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-slate-400">Banner Color</span>
              <span className="text-[11px] font-medium" style={{ color: chosenPalette.color }}>
                {chosenPalette.name}
              </span>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {NATION_PALETTE.map((pal, idx) => {
                const selected = idx === paletteIdx;
                return (
                  <button
                    key={pal.name}
                    type="button"
                    onClick={() => setPaletteIdx(idx)}
                    title={pal.name}
                    className={`min-h-[36px] rounded-md border-2 transition-transform ${
                      selected ? 'border-white scale-105' : 'border-slate-800 hover:border-slate-600'
                    }`}
                    style={{ backgroundColor: pal.color }}
                    aria-label={`Select ${pal.name} color`}
                  />
                );
              })}
            </div>
          </div>

          {/* Government & Ideology */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor="custom-gov" className="block text-[11px] font-medium text-slate-400 mb-1">
                Government
              </label>
              <select
                id="custom-gov"
                value={government}
                onChange={(e) => setGovernment(e.target.value as GovernmentType)}
                className="w-full min-h-[40px] px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-[#ffda1a]"
              >
                {GOVERNMENTS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="custom-ideology" className="block text-[11px] font-medium text-slate-400 mb-1">
                Ideology
              </label>
              <select
                id="custom-ideology"
                value={ideology}
                onChange={(e) => setIdeology(e.target.value as Ideology)}
                className="w-full min-h-[40px] px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-[#ffda1a]"
              >
                {IDEOLOGIES.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* City Layout Pattern */}
          <div>
            <label htmlFor="custom-pattern" className="block text-[11px] font-medium text-slate-400 mb-1">
              City Building Pattern
            </label>
            <select
              id="custom-pattern"
              value={buildingPattern}
              onChange={(e) => setBuildingPattern(e.target.value as BuildingPattern)}
              className="w-full min-h-[40px] px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:border-[#ffda1a]"
            >
              {BUILDING_PATTERNS.map((bp) => (
                <option key={bp} value={bp}>
                  {bp}
                </option>
              ))}
            </select>
          </div>

          {/* Starting Population */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-slate-400">Starting Citizens</span>
              <span className="font-mono-tabular font-semibold text-[#ffda1a]">{startingPop}</span>
            </div>
            <input
              type="range"
              min={6}
              max={24}
              step={1}
              value={startingPop}
              onChange={(e) => setStartingPop(Number(e.target.value))}
              className="w-full accent-[#0058a3]"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono-tabular mt-0.5">
              <span>6</span>
              <span>15</span>
              <span>24</span>
            </div>
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-700/70 text-rose-200 text-xs">
              {errorMsg}
            </div>
          )}

          {/* Actions */}
          <div className="pt-2 border-t border-slate-800 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                onStartMapPlacement(buildConfig());
              }}
              className="min-h-[42px] flex-1 px-3 py-2 rounded-lg bg-[#0058a3] hover:bg-[#0069c2] text-white font-semibold flex items-center justify-center gap-1.5"
            >
              <MapPin className="w-3.5 h-3.5 text-[#ffda1a]" />
              <span>Place on Map</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const res = onAutoPlace(buildConfig());
                if (res.ok) {
                  onClose();
                } else {
                  setErrorMsg(res.error || 'No open aisle space available right now.');
                }
              }}
              className="min-h-[42px] flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-300" />
              <span>Auto-Place Open Wing</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
