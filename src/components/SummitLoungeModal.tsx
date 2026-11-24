import React, { useEffect, useRef, useState } from 'react';
import {
  Crown,
  Eye,
  KeyRound,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Send,
  Square,
  X,
} from 'lucide-react';
import { SummitLoungeMessage } from '../game/diplomacy';
import { ActiveAnomaly, Nation, StaffInvasionAlert } from '../game/types';

export type SummitDurationSec = 60 | 120 | 180 | 300;

interface LeaderSeatInfo {
  nation: Nation;
  status: 'seated' | 'walking' | 'away';
}

interface SummitLoungeModalProps {
  nations: Nation[];
  leaderSeats: LeaderSeatInfo[];
  messages: SummitLoungeMessage[];
  activeAnomaly?: ActiveAnomaly | null;
  staffInvasionAlert?: StaffInvasionAlert | null;
  sessionActive: boolean;
  sessionPaused: boolean;
  loadingTurn: boolean;
  errorMsg: string | null;
  selectedDurationSec: SummitDurationSec;
  remainingSec: number;
  speakingNationId: number | null;
  hasGeminiKey: boolean;
  onOpenGeminiModal: () => void;
  onSelectDuration: (sec: SummitDurationSec) => void;
  onStartSession: () => void;
  onTogglePauseSession: () => void;
  onEndSession: () => void;
  onNextTurn: (topicOverride?: string) => void;
  onFocusLounge: () => void;
  onClose: () => void;
}

const DURATION_OPTIONS: Array<{ sec: SummitDurationSec; label: string }> = [
  { sec: 60, label: '1 min' },
  { sec: 120, label: '2 min' },
  { sec: 180, label: '3 min' },
  { sec: 300, label: '5 min' },
];

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export const SummitLoungeModal: React.FC<SummitLoungeModalProps> = ({
  nations,
  leaderSeats,
  messages,
  activeAnomaly,
  staffInvasionAlert,
  sessionActive,
  sessionPaused,
  loadingTurn,
  errorMsg,
  selectedDurationSec,
  remainingSec,
  speakingNationId,
  hasGeminiKey,
  onOpenGeminiModal,
  onSelectDuration,
  onStartSession,
  onTogglePauseSession,
  onEndSession,
  onNextTurn,
  onFocusLounge,
  onClose,
}) => {
  const [topicInput, setTopicInput] = useState('');
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loadingTurn]);

  const aliveNations = nations.filter((n) => n.alive);
  const seatedCount = leaderSeats.filter((l) => l.status === 'seated').length;
  const elapsedPct =
    selectedDurationSec > 0
      ? Math.min(100, Math.max(0, ((selectedDurationSec - remainingSec) / selectedDurationSec) * 100))
      : 0;

  const handleTopicSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = topicInput.trim();
    if (!t || loadingTurn) return;
    setTopicInput('');
    onNextTurn(t);
  };

  return (
    <aside
      aria-label="Summit Lounge"
      className="pointer-events-auto fixed inset-x-3 top-14 sm:inset-x-auto sm:right-4 sm:top-16 z-50 w-auto sm:w-[420px] max-h-[calc(100dvh-8.5rem)] flex flex-col bg-[#11161f]/96 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl text-xs text-slate-200 overflow-hidden"
    >
      {/* Header with prominent Close button */}
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-800 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-[#ffda1a] shrink-0" />
            <h2 className="font-display text-lg font-bold tracking-wide text-white truncate">
              Summit Lounge
            </h2>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
            {hasGeminiKey
              ? 'Gemini AI Roundtable · Your Browser Key'
              : 'Heuristic AI Roundtable · Add Gemini Key for AI'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onFocusLounge}
            className="min-h-[34px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium text-slate-200 flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
            title="Pan camera to Neutral Summit Lounge"
          >
            <Eye className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden xs:inline">View</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[34px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-900/70 border border-slate-700 text-slate-200 hover:text-white flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
            aria-label="Close Summit Lounge"
            title="Close Summit Lounge (Esc)"
          >
            <X className="w-3.5 h-3.5" />
            <span>Close</span>
          </button>
        </div>
      </div>

      {/* Scrollable Inner Body so smaller screens never clip controls */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        {/* Duration Selector & Live Countdown */}
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50 space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.sec}
                  type="button"
                  disabled={sessionActive}
                  onClick={() => onSelectDuration(opt.sec)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                    selectedDurationSec === opt.sec
                      ? 'bg-[#0058a3] text-[#ffda1a] font-semibold'
                      : 'text-slate-400 hover:text-slate-100 disabled:hover:text-slate-400'
                  } disabled:opacity-60`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="text-right font-mono-tabular shrink-0">
              <div className="text-sm font-semibold text-white">
                {sessionActive ? formatClock(remainingSec) : formatClock(selectedDurationSec)}
              </div>
              <div className="text-[10px] text-slate-400">
                {sessionActive ? 'Remaining' : 'Max length'}
              </div>
            </div>
          </div>

          <div className="h-1.5 w-full bg-slate-800 rounded-sm overflow-hidden">
            <div
              className="h-full bg-[#ffda1a] transition-all duration-300"
              style={{ width: `${sessionActive ? elapsedPct : 0}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            {!sessionActive ? (
              <button
                type="button"
                disabled={aliveNations.length < 2}
                onClick={onStartSession}
                className="flex-1 min-h-[38px] px-4 py-2 rounded-lg bg-[#0058a3] hover:bg-sky-700 text-white font-semibold flex items-center justify-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-50 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5 text-[#ffda1a]" />
                <span>Sit Leaders & Start Talk</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={loadingTurn}
                  onClick={() => onNextTurn()}
                  className="flex-1 min-h-[36px] px-3 py-1.5 rounded-lg bg-[#0058a3] hover:bg-sky-700 text-white font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-[#ffda1a]" />
                  <span>{loadingTurn ? 'Speaking...' : 'Next Leader'}</span>
                </button>

                <button
                  type="button"
                  onClick={onTogglePauseSession}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  {sessionPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  <span>{sessionPaused ? 'Resume' : 'Pause'}</span>
                </button>

                <button
                  type="button"
                  onClick={onEndSession}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 border border-rose-800/70 text-rose-200 font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Square className="w-3 h-3" />
                  <span>End Talk</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Seated Leaders Roster */}
        <div className="px-4 py-2.5 border-b border-slate-800 shrink-0">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
            <span>Participating Leaders</span>
            <span className="font-mono-tabular">
              {seatedCount}/{leaderSeats.length} Seated in Lounge
            </span>
          </div>
          {leaderSeats.length === 0 ? (
            <p className="text-[11px] text-slate-500">At least 2 living nations are required.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[96px] overflow-y-auto">
              {leaderSeats.map(({ nation, status }) => {
                const isSpeaking = speakingNationId === nation.id;
                return (
                  <div
                    key={nation.id}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
                      isSpeaking
                        ? 'bg-slate-800/90 border-[#ffda1a]/70'
                        : 'bg-slate-900/60 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: nation.color }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="text-[11px] font-semibold text-slate-100 truncate">
                            {nation.leader.name}
                          </span>
                          {nation.species === 'staff' && (
                            <span className="px-1 py-0.2 rounded bg-yellow-500/20 text-yellow-300 text-[9px] font-semibold shrink-0">
                              Staff
                            </span>
                          )}
                          {nation.isUnion && (
                            <span className="px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[9px] font-semibold shrink-0">
                              Union
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {nation.name} · T{nation.techTier}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-medium shrink-0 ${
                        isSpeaking
                          ? 'text-[#ffda1a]'
                          : status === 'seated'
                            ? 'text-emerald-400'
                            : status === 'walking'
                              ? 'text-sky-400'
                              : 'text-slate-500'
                      }`}
                    >
                      {isSpeaking
                        ? 'Speaking'
                        : status === 'seated'
                          ? 'Seated'
                          : status === 'walking'
                            ? 'En route'
                            : 'Capital'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Live Conversation Transcript */}
        <div className="flex-1 min-h-[120px] overflow-y-auto px-4 py-3 space-y-2.5">
          {activeAnomaly && (
            <div className="rounded-lg border border-cyan-500/40 bg-cyan-950/35 px-2.5 py-2 text-[11px] text-cyan-200 flex items-center justify-between gap-2">
              <span className="font-semibold truncate">Store Anomaly: {activeAnomaly.label}</span>
              <span className="font-mono-tabular text-[10px] text-cyan-300 shrink-0">
                {Math.ceil(activeAnomaly.remainingSec)}s
              </span>
            </div>
          )}

          {staffInvasionAlert && (
            <div
              className={`rounded-lg border px-2.5 py-2 text-[11px] flex items-center justify-between gap-2 ${
                staffInvasionAlert.severity === 'CRITICAL'
                  ? 'border-rose-500/50 bg-rose-950/45 text-rose-200'
                  : 'border-amber-500/50 bg-amber-950/45 text-amber-200'
              }`}
            >
              <span className="font-semibold truncate">
                PA Radar: {staffInvasionAlert.title} ({staffInvasionAlert.nationName})
              </span>
              <span className="font-mono-tabular text-[10px] shrink-0">
                {staffInvasionAlert.enemyCount} Staff
              </span>
            </div>
          )}

          {!hasGeminiKey && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-2.5 flex items-center justify-between gap-2 text-[11px] text-slate-300">
              <span>
                Running on Heuristic AI so your quota stays private. Add your own key for live Gemini talks.
              </span>
              <button
                type="button"
                onClick={onOpenGeminiModal}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-sky-300 font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <KeyRound className="w-3 h-3" />
                <span>Add Key</span>
              </button>
            </div>
          )}

          {messages.length === 0 && !loadingTurn && !errorMsg && (
            <div className="py-4 text-center space-y-1.5">
              <p className="text-slate-300 font-medium">The showroom couches are ready.</p>
              <p className="text-[11px] text-slate-500 max-w-[300px] mx-auto leading-relaxed">
                Pick a talk length (1–5 mins) and press <strong>Sit Leaders &amp; Start Talk</strong> so
                nation leaders gather on the Showroom couches and converse.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className="rounded-lg border border-slate-800 bg-slate-900/75 p-2.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: msg.nationColor }}
                  />
                  <span className="font-semibold text-slate-100 truncate">
                    {msg.speakerName}
                  </span>
                  <span className="text-slate-500" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-[11px] text-slate-400 truncate">
                    {msg.nationName}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 shrink-0 font-mono-tabular">
                  <span className="capitalize">{msg.mood}</span>
                  <span aria-hidden="true">·</span>
                  <span>{msg.timestamp}</span>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-slate-200">{msg.text}</p>

              {msg.actionSummary && (
                <div className="rounded border border-amber-500/40 bg-amber-950/35 px-2 py-1 text-[11px] font-medium text-amber-200">
                  {msg.actionSummary}
                </div>
              )}
            </div>
          ))}

          {loadingTurn && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5 text-[11px] text-slate-400 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400 shrink-0" />
              <span>A leader in the Summit Lounge is speaking via Gemini API...</span>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-lg border border-rose-800/70 bg-rose-950/50 p-2.5 space-y-2 text-[11px] text-rose-200">
              <p>{errorMsg}</p>
              {sessionActive && (
                <button
                  type="button"
                  onClick={() => onNextTurn()}
                  className="px-2.5 py-1 rounded bg-rose-900/80 hover:bg-rose-800 text-rose-100 font-medium inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry Turn</span>
                </button>
              )}
            </div>
          )}

          <div ref={feedEndRef} />
        </div>
      </div>

      {/* Moderator / Topic Prompt Input */}
      <form
        onSubmit={handleTopicSubmit}
        className="px-4 py-3 border-t border-slate-800 bg-slate-900/60 shrink-0"
      >
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder={
              sessionActive
                ? 'Steer the talk (e.g. Settle the Food Court truce)...'
                : 'Start a session to steer the conversation...'
            }
            disabled={!sessionActive || loadingTurn}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!sessionActive || loadingTurn || !topicInput.trim()}
            className="min-h-[36px] px-3 py-2 rounded-lg bg-[#0058a3] hover:bg-sky-700 text-white font-semibold flex items-center gap-1 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Ask</span>
          </button>
        </div>
      </form>
    </aside>
  );
};
