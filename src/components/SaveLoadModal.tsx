import React, { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, Save, Trash2, Upload, X } from 'lucide-react';
import {
  deleteSaveSlot,
  listSaveSlots,
  readSaveSlot,
  SAVE_SLOTS,
  SaveSlotMeta,
  SerializedWorldV1,
  writeSaveSlot,
} from '../game/saveLoad';

interface SaveLoadModalProps {
  currentDay: number;
  onExportWorld: (label: string) => SerializedWorldV1 | null;
  onImportWorld: (data: SerializedWorldV1) => void;
  onClose: () => void;
}

function formatSavedTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const SaveLoadModal: React.FC<SaveLoadModalProps> = ({
  currentDay,
  onExportWorld,
  onImportWorld,
  onClose,
}) => {
  const [slots, setSlots] = useState<Record<string, SaveSlotMeta | null>>(() => listSaveSlots());
  const [label, setLabel] = useState<string>(`Day ${currentDay} Store Save`);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSlots(listSaveSlots());
  }, []);

  const handleSaveSlot = (slotId: string) => {
    const payload = onExportWorld(label.trim() || `Day ${currentDay} Store Save`);
    if (!payload) {
      setFeedback({ kind: 'err', text: 'World engine is not ready.' });
      return;
    }
    try {
      writeSaveSlot(slotId, payload);
      setSlots(listSaveSlots());
      setFeedback({ kind: 'ok', text: `Saved "${payload.label}" to Slot ${slotId}.` });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'QuotaExceededError'
          ? 'Browser storage quota exceeded. Export JSON or delete another slot.'
          : 'Could not write save to browser storage.';
      setFeedback({ kind: 'err', text: msg });
    }
  };

  const handleLoadSlot = (slotId: string) => {
    const data = readSaveSlot(slotId);
    if (!data) {
      setFeedback({ kind: 'err', text: `Slot ${slotId} is empty or corrupted.` });
      return;
    }
    try {
      onImportWorld(data);
      setFeedback({ kind: 'ok', text: `Loaded "${data.label}" (Day ${data.day}).` });
      onClose();
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to load save file.',
      });
    }
  };

  const handleDeleteSlot = (slotId: string) => {
    deleteSaveSlot(slotId);
    setSlots(listSaveSlots());
    setFeedback({ kind: 'ok', text: `Cleared Slot ${slotId}.` });
  };

  const handleDownloadJson = () => {
    const payload = onExportWorld(label.trim() || `Day ${currentDay} Store Save`);
    if (!payload) {
      setFeedback({ kind: 'err', text: 'World engine is not ready.' });
      return;
    }
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = payload.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scp3008-world';
      a.href = url;
      a.download = `${safeName}-day${payload.day}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setFeedback({ kind: 'ok', text: `Exported Day ${payload.day} store file.` });
    } catch {
      setFeedback({ kind: 'err', text: 'Failed to export JSON file.' });
    }
  };

  const handleUploadJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as SerializedWorldV1;
      if (!parsed || parsed.version !== 1 || !parsed.grids || !Array.isArray(parsed.nations)) {
        setFeedback({ kind: 'err', text: 'Invalid SCP-3008 world save file.' });
        return;
      }
      onImportWorld(parsed);
      onClose();
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Could not parse JSON save file.',
      });
    }
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#11161f] border border-slate-700 rounded-xl shadow-2xl p-5 text-sm text-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Save className="w-4 h-4 text-[#ffda1a]" />
            <h2 className="font-display text-lg font-bold text-white">Save & Load World</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center -mr-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close Save and Load"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="pt-4 space-y-4 text-xs">
          <div>
            <label htmlFor="save-world-label" className="block text-[11px] font-medium text-slate-400 mb-1">
              Save Label
            </label>
            <input
              id="save-world-label"
              type="text"
              maxLength={48}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`Day ${currentDay} Store Save`}
              className="w-full min-h-[40px] px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#ffda1a]"
            />
          </div>

          <div className="space-y-2">
            {SAVE_SLOTS.map((slotId) => {
              const meta = slots[slotId];
              return (
                <div
                  key={slotId}
                  className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono-tabular text-[11px] font-semibold text-[#ffda1a]">
                        Slot {slotId}
                      </span>
                      <span className="font-semibold text-slate-100 truncate">
                        {meta ? meta.label : 'Empty Slot'}
                      </span>
                    </div>
                    {meta ? (
                      <div className="text-[11px] text-slate-400 font-mono-tabular mt-0.5">
                        Day {meta.day} · {meta.nationCount} Kingdoms · {meta.unitCount} Units · {formatSavedTime(meta.savedAt)}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500 mt-0.5">No world stored</div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSaveSlot(slotId)}
                      className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#0058a3] hover:bg-[#0069c2] text-white font-semibold flex items-center gap-1"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Save</span>
                    </button>
                    {meta && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleLoadSlot(slotId)}
                          className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold flex items-center gap-1"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-emerald-300" />
                          <span>Load</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSlot(slotId)}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-rose-900/70 border border-slate-700 text-slate-400 hover:text-rose-200"
                          title={`Delete Slot ${slotId}`}
                          aria-label={`Delete Slot ${slotId}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadJson}
              className="min-h-[40px] flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-[#ffda1a]" />
              <span>Export JSON</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[40px] flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold flex items-center justify-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5 text-sky-300" />
              <span>Import JSON</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleUploadJson(e)}
              className="hidden"
            />
          </div>

          {feedback && (
            <div
              className={`p-2.5 rounded-lg border text-xs ${
                feedback.kind === 'ok'
                  ? 'bg-emerald-950/60 border-emerald-700/70 text-emerald-200'
                  : 'bg-rose-950/60 border-rose-700/70 text-rose-200'
              }`}
            >
              {feedback.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
