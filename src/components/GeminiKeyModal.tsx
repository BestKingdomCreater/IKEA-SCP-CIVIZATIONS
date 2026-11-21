import React, { useState } from 'react';
import { CheckCircle2, KeyRound, Trash2, X } from 'lucide-react';
import { testGeminiKey } from '../game/diplomacy';

interface GeminiKeyModalProps {
  currentKey: string;
  onSaveKey: (key: string) => void;
  onClearKey: () => void;
  onClose: () => void;
}

export const GeminiKeyModal: React.FC<GeminiKeyModalProps> = ({
  currentKey,
  onSaveKey,
  onClearKey,
  onClose,
}) => {
  const [inputKey, setInputKey] = useState(currentKey);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setStatus(null);
    const res = await testGeminiKey(inputKey);
    setStatus({ ok: res.ok, text: res.message });
    setTesting(false);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveKey(inputKey.trim());
    setStatus({ ok: true, text: 'Saved locally in your browser only.' });
  };

  const handleClear = () => {
    setInputKey('');
    onClearKey();
    setStatus({ ok: true, text: 'Key cleared. Running on Heuristic AI.' });
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#11161f] border border-slate-700 rounded-xl shadow-2xl p-5 text-sm text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-sky-400" />
            <h2 className="font-display text-lg font-bold text-white">
              Add Gemini Key (BYOK)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-1 -mt-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close Modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="pt-4 space-y-4">
          <p className="text-xs leading-relaxed text-slate-300 bg-slate-900/90 border border-slate-800 rounded-lg p-3">
            Paste your own Gemini API key from Google AI Studio (aistudio.google.com).
            It is stored strictly in your own browser so nobody else can see it or use up your quota.
            Without a key, the game runs on Heuristic AI.
          </p>

          <div>
            <label htmlFor="gemini-byok-input" className="block text-xs font-medium text-slate-300 mb-1.5">
              Gemini API Key
            </label>
            <input
              id="gemini-byok-input"
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="AIza..."
              autoComplete="off"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {status && (
            <div
              className={`text-xs rounded-lg p-2.5 border ${
                status.ok
                  ? 'bg-emerald-950/60 border-emerald-700/70 text-emerald-200'
                  : 'bg-rose-950/60 border-rose-700/70 text-rose-200'
              }`}
            >
              {status.text}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !inputKey.trim()}
                className="min-h-[40px] px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-100 disabled:opacity-50 whitespace-nowrap"
              >
                {testing ? 'Testing...' : 'Test Key'}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="min-h-[40px] px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-900/70 border border-slate-700 text-xs font-semibold text-rose-300 flex items-center gap-1.5 whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Key</span>
              </button>
            </div>

            <button
              type="submit"
              className="min-h-[40px] px-4 py-2 rounded-lg bg-[#0058a3] hover:bg-sky-700 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Save Key</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
