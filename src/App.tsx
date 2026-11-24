import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CustomKingdomModal } from './components/CustomKingdomModal';
import { GeminiKeyModal } from './components/GeminiKeyModal';
import { HallOfRecordsModal } from './components/HallOfRecordsModal';
import { InspectBuildingModal } from './components/InspectBuildingModal';
import { InspectUnitModal } from './components/InspectUnitModal';
import { Minimap } from './components/Minimap';
import { NationPanel } from './components/NationPanel';
import { NewsTicker } from './components/NewsTicker';
import { ResearchTreeModal } from './components/ResearchTreeModal';
import { SaveLoadModal } from './components/SaveLoadModal';
import { SettingsModal } from './components/SettingsModal';
import { SummitDurationSec, SummitLoungeModal } from './components/SummitLoungeModal';
import { TopHud } from './components/TopHud';
import { WarTracker } from './components/WarTracker';
import { WorldToolbar } from './components/WorldToolbar';
import {
  GRID_H,
  GRID_W,
  SUMMIT_X,
  SUMMIT_Y,
  TILE_SIZE,
  WORLD_PX_H,
  WORLD_PX_W,
} from './game/constants';
import {
  getStoredGeminiKey,
  requestSummitLoungeTurn,
  runGeminiDiplomacySummit,
  runGodWhisper,
  runHeuristicDiplomacyTurn,
  setStoredGeminiKey,
  SummitLoungeMessage,
} from './game/diplomacy';
import { SimEngine } from './game/engine';
import { SerializedWorldV1 } from './game/saveLoad';
import { soundFX } from './game/sound';
import {
  BrushSize,
  CustomKingdomConfig,
  DiplomaticStance,
  HudSnapshot,
  InspectedBuilding,
  SimSpeed,
  TechId,
  ToolId,
  Unit,
  WorldPreset,
} from './game/types';

interface PointerPos {
  id: number;
  x: number;
  y: number;
}

export default function App() {
  const isPhone = typeof window !== 'undefined' && window.innerWidth < 768;
  const isCoarsePointer =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  const [maxPop, setMaxPop] = useState<number>(isPhone ? 900 : 2000);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [musicEnabled, setMusicEnabled] = useState<boolean>(true);
  const [activeTool, setActiveTool] = useState<ToolId>(isCoarsePointer ? 'pan' : 'inspect');
  const [brushSize, setBrushSize] = useState<BrushSize>('M');

  const [geminiKey, setGeminiKey] = useState<string>(() => getStoredGeminiKey());
  const [showGeminiModal, setShowGeminiModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSaveLoadModal, setShowSaveLoadModal] = useState(false);
  const [showRecordsModal, setShowRecordsModal] = useState(false);
  const [showCustomKingdomModal, setShowCustomKingdomModal] = useState(false);
  const [pendingCustomKingdom, setPendingCustomKingdom] = useState<CustomKingdomConfig | null>(null);
  const [placementError, setPlacementError] = useState<string | null>(null);

  // Summit Lounge State (<= 5 min Gemini API / Heuristic Roundtable)
  const [showSummitLounge, setShowSummitLounge] = useState(false);
  const [summitDurationSec, setSummitDurationSec] = useState<SummitDurationSec>(180);
  const [summitRemainingSec, setSummitRemainingSec] = useState<number>(180);
  const [summitSessionActive, setSummitSessionActive] = useState<boolean>(false);
  const [summitSessionPaused, setSummitSessionPaused] = useState<boolean>(false);
  const [summitTurnLoading, setSummitTurnLoading] = useState<boolean>(false);
  const [summitError, setSummitError] = useState<string | null>(null);
  const [summitMessages, setSummitMessages] = useState<SummitLoungeMessage[]>([]);
  const [speakingNationId, setSpeakingNationId] = useState<number | null>(null);

  const [selectedNationId, setSelectedNationId] = useState<number | null>(null);
  const [showResearchTree, setShowResearchTree] = useState(false);
  const [inspectedUnit, setInspectedUnit] = useState<Unit | null>(null);
  const [inspectedBuilding, setInspectedBuilding] = useState<InspectedBuilding | null>(null);
  const [followUnitId, setFollowUnitId] = useState<number | null>(null);
  const [worldPreset, setWorldPreset] = useState<WorldPreset>('standard');
  const [viewSize, setViewSize] = useState({ w: 1280, h: 720 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SimEngine | null>(null);

  const activeToolRef = useRef<ToolId>(activeTool);
  const brushSizeRef = useRef<BrushSize>(brushSize);
  const geminiKeyRef = useRef<string>(geminiKey);
  const followUnitIdRef = useRef<number | null>(followUnitId);
  const inspectedUnitIdRef = useRef<number | null>(null);
  const inspectedBuildingLocRef = useRef<{ tx: number; ty: number } | null>(null);
  const summitInFlightRef = useRef<boolean>(false);
  const loungeTurnInFlightRef = useRef<boolean>(false);
  const loungeAbortRef = useRef<AbortController | null>(null);
  const summitMessagesRef = useRef<SummitLoungeMessage[]>(summitMessages);
  const summitRemainingRef = useRef<number>(summitRemainingSec);
  const summitDurationRef = useRef<SummitDurationSec>(summitDurationSec);
  const summitSessionActiveRef = useRef<boolean>(summitSessionActive);
  const nextTurnCooldownRef = useRef<number>(0);
  const pendingCustomKingdomRef = useRef<CustomKingdomConfig | null>(null);

  pendingCustomKingdomRef.current = pendingCustomKingdom;

  activeToolRef.current = activeTool;
  brushSizeRef.current = brushSize;
  geminiKeyRef.current = geminiKey;
  followUnitIdRef.current = followUnitId;
  inspectedUnitIdRef.current = inspectedUnit ? inspectedUnit.id : null;
  inspectedBuildingLocRef.current = inspectedBuilding
    ? { tx: inspectedBuilding.tx, ty: inspectedBuilding.ty }
    : null;
  summitMessagesRef.current = summitMessages;
  summitRemainingRef.current = summitRemainingSec;
  summitDurationRef.current = summitDurationSec;
  summitSessionActiveRef.current = summitSessionActive;

  const [hud, setHud] = useState<HudSnapshot>(() => ({
    day: 1,
    isNight: false,
    cycleProgress: 0,
    phaseRemainingSec: 35,
    fps: 60,
    totalUnits: 0,
    survivorCount: 0,
    staffCount: 0,
    cartCount: 0,
    nations: [],
    news: [],
    chronicle: [],
    records: {
      totalWarsDeclared: 0,
      totalPeaceTreaties: 0,
      totalBuildingsBuilt: 0,
      totalTechsUnlocked: 0,
      totalStaffSlain: 0,
      totalSurvDeaths: 0,
      peakPopulation: 0,
      peakPopDay: 1,
      auditNightsSurvived: 0,
    },
    paused: false,
    speed: 1,
    summitActive: false,
    auditNight: false,
    activeAnomaly: null,
    allowWildStaffKingdoms: false,
  }));

  const panToTile = useCallback((tx: number, ty: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.camera.x = Math.max(0, Math.min(WORLD_PX_W, tx * TILE_SIZE));
    eng.camera.y = Math.max(0, Math.min(WORLD_PX_H, ty * TILE_SIZE));
    if (eng.camera.zoom < 1.5) {
      eng.camera.zoom = 1.8;
    }
  }, []);

  const triggerDailyDiplomacySummit = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng || summitInFlightRef.current || summitSessionActiveRef.current) return;

    const key = geminiKeyRef.current.trim();
    if (!key) {
      runHeuristicDiplomacyTurn(
        eng.nations,
        eng.day,
        (act) => eng.applyDiplomaticAction(act),
        false
      );
      setHud(eng.getHudSnapshot(60));
      return;
    }

    summitInFlightRef.current = true;
    try {
      const recentEvents = eng.news.slice(0, 6).map((n) => n.text);
      const res = await runGeminiDiplomacySummit(
        key,
        eng.nations,
        eng.day,
        eng.isNight,
        recentEvents
      );
      if (res && res.actions.length > 0) {
        if (res.headline) {
          eng.addNews('DIPLOMACY', `Summit: ${res.headline}`);
        }
        for (const act of res.actions) {
          eng.applyDiplomaticAction(act);
        }
      } else {
        runHeuristicDiplomacyTurn(
          eng.nations,
          eng.day,
          (act) => eng.applyDiplomaticAction(act),
          false
        );
      }
    } finally {
      summitInFlightRef.current = false;
      setHud(eng.getHudSnapshot(60));
    }
  }, []);

  const finishSummitLoungeSession = useCallback(() => {
    loungeAbortRef.current?.abort();
    loungeAbortRef.current = null;
    loungeTurnInFlightRef.current = false;
    setSummitTurnLoading(false);
    setSummitSessionActive(false);
    setSummitSessionPaused(false);
    setSpeakingNationId(null);
    const eng = engineRef.current;
    if (eng) {
      eng.setSummitLoungeSession(false);
      setHud(eng.getHudSnapshot(60));
    }
  }, []);

  const runSummitLoungeTurn = useCallback(
    async (topicOverride?: string, isClosing = false) => {
      const eng = engineRef.current;
      if (!eng || loungeTurnInFlightRef.current) return;

      const aliveNations = eng.nations.filter((n) => n.alive);
      if (aliveNations.length < 2) {
        setSummitError('At least two living nations are required for a Summit Lounge talk.');
        return;
      }

      loungeTurnInFlightRef.current = true;
      setSummitTurnLoading(true);
      setSummitError(null);

      const controller = new AbortController();
      loungeAbortRef.current = controller;

      try {
        const nationMap = new Map(aliveNations.map((n) => [n.id, n]));
        const payload = {
          day: eng.day,
          isNight: eng.isNight,
          activeAnomaly: eng.activeAnomaly,
          nations: aliveNations.map((n) => ({
            id: n.id,
            name: n.name,
            gov: n.government,
            ideology: n.ideology,
            species: n.species,
            techTier: n.techTier,
            pop: n.population,
            meatballs: Math.round(n.meatballs),
            scrap: Math.round(n.scrap),
            wrenches: Math.round(n.allenWrenches),
            firearms: Math.round(n.firearms ?? 0),
            civilianGoods: Math.round(n.civilianGoods ?? 0),
            isUnion: Boolean(n.isUnion),
            unionMembers: n.unionMembers,
            happiness: Math.round(n.happiness),
            tax: n.taxRate,
            threat: Math.round(n.threatScore),
            leaderName: n.leader.name,
            leaderTraits: n.leader.traits,
            seated: eng.getLeaderLoungeStatus(n.id) === 'seated',
            relations: Object.entries(n.relations)
              .filter(([idStr]) => nationMap.has(Number(idStr)))
              .map(([idStr, rel]) => ({
                withId: Number(idStr),
                withName: nationMap.get(Number(idStr))!.name,
                stance: rel.stance,
              })),
          })),
          history: summitMessagesRef.current.slice(-14).map((m) => ({
            speakerNationId: m.speakerNationId,
            speakerName: m.speakerName,
            nationName: m.nationName,
            text: m.text,
            mood: m.mood,
          })),
          topic: topicOverride,
          remainingSec: summitRemainingRef.current,
          totalDurationSec: summitDurationRef.current,
          isClosing,
          recentEvents: eng.news.slice(0, 5).map((n) => n.text),
        };

        const res = await requestSummitLoungeTurn(
          geminiKeyRef.current,
          payload,
          controller.signal
        );
        if (!summitSessionActiveRef.current && !isClosing) return;

        const speaker = nationMap.get(res.speakerNationId) || aliveNations[0];
        eng.announceSummitSpeech(speaker.id, res.dialogue);
        setSpeakingNationId(speaker.id);

        let actionSummary: string | undefined;
        if (res.diplomaticAction) {
          eng.applyDiplomaticAction(res.diplomaticAction);
          const actor = nationMap.get(res.diplomaticAction.actorNationId);
          const target =
            typeof res.diplomaticAction.targetNationId === 'number'
              ? nationMap.get(res.diplomaticAction.targetNationId)
              : undefined;
          if (res.diplomaticAction.type === 'REFORM_GOV' && res.diplomaticAction.newGovernment) {
            actionSummary = `${actor?.name ?? speaker.name} reformed into ${res.diplomaticAction.newGovernment}`;
          } else if (target) {
            actionSummary = `${actor?.name ?? speaker.name} · ${target.name} — ${res.diplomaticAction.type.replace('_', ' ')}`;
          }
        }

        const nowLabel = new Date().toLocaleTimeString([], {
          minute: '2-digit',
          second: '2-digit',
        });

        const newMsg: SummitLoungeMessage = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          speakerNationId: speaker.id,
          speakerName: speaker.leader.name,
          nationName: speaker.name,
          nationColor: speaker.color,
          text: res.dialogue,
          mood: res.mood,
          timestamp: nowLabel,
          actionSummary,
        };

        setSummitMessages((prev) => [...prev, newMsg]);
        soundFX.playChime(580, 0.05);
        nextTurnCooldownRef.current = res.usedGemini ? 8 : 5;
        setHud(eng.getHudSnapshot(60));

        if (isClosing || res.shouldConclude) {
          eng.addNews('DIPLOMACY', `Summit Lounge talks concluded on Day ${eng.day}.`);
          setSummitSessionActive(false);
          setSummitSessionPaused(false);
          eng.setSummitLoungeSession(false);
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Failed to reach Gemini API.';
        setSummitError(msg);
      } finally {
        loungeTurnInFlightRef.current = false;
        setSummitTurnLoading(false);
      }
    },
    []
  );

  const startSummitLoungeSession = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    soundFX.unlockAndStartMusic();
    soundFX.playChime(660, 0.08);
    if (eng.paused) {
      eng.paused = false;
    }

    panToTile(SUMMIT_X + 0.5, SUMMIT_Y + 0.5);
    eng.setSummitLoungeSession(true);

    setSummitMessages([]);
    setSummitError(null);
    setSummitRemainingSec(summitDurationRef.current);
    setSummitSessionPaused(false);
    setSummitSessionActive(true);
    setSpeakingNationId(null);
    nextTurnCooldownRef.current = 2;
    setHud(eng.getHudSnapshot(60));
  }, [panToTile]);

  const handleOpenSummitLounge = useCallback(() => {
    setShowSummitLounge(true);
    setSelectedNationId(null);
    setInspectedUnit(null);
    setInspectedBuilding(null);
    setFollowUnitId(null);
    panToTile(SUMMIT_X + 0.5, SUMMIT_Y + 0.5);
  }, [panToTile]);

  const handleToggleSummitLounge = useCallback(() => {
    setShowSummitLounge((open) => {
      const next = !open;
      if (next) {
        setSelectedNationId(null);
        setInspectedUnit(null);
        setInspectedBuilding(null);
        setFollowUnitId(null);
        panToTile(SUMMIT_X + 0.5, SUMMIT_Y + 0.5);
      }
      return next;
    });
  }, [panToTile]);

  // Countdown + Auto-Turn Driver for the <= 5 min Summit Lounge Conversation
  useEffect(() => {
    if (!summitSessionActive || summitSessionPaused) return;

    const timerId = window.setInterval(() => {
      if (summitRemainingRef.current <= 1) {
        setSummitRemainingSec(0);
        if (!loungeTurnInFlightRef.current) {
          void runSummitLoungeTurn(undefined, true);
        } else {
          finishSummitLoungeSession();
        }
        return;
      }

      setSummitRemainingSec((prev) => Math.max(0, prev - 1));

      if (!loungeTurnInFlightRef.current && !summitError) {
        nextTurnCooldownRef.current -= 1;
        if (nextTurnCooldownRef.current <= 0) {
          nextTurnCooldownRef.current = 9;
          void runSummitLoungeTurn();
        }
      }
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [
    summitSessionActive,
    summitSessionPaused,
    summitError,
    runSummitLoungeTurn,
    finishSummitLoungeSession,
  ]);

  // Escape key closes open panels cleanly
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      if (pendingCustomKingdom) {
        setPendingCustomKingdom(null);
        setPlacementError(null);
      } else if (showCustomKingdomModal) setShowCustomKingdomModal(false);
      else if (showSaveLoadModal) setShowSaveLoadModal(false);
      else if (showRecordsModal) setShowRecordsModal(false);
      else if (showGeminiModal) setShowGeminiModal(false);
      else if (showSettingsModal) setShowSettingsModal(false);
      else if (showResearchTree) setShowResearchTree(false);
      else if (showSummitLounge) setShowSummitLounge(false);
      else if (inspectedUnit) {
        setInspectedUnit(null);
        setFollowUnitId(null);
      } else if (inspectedBuilding) setInspectedBuilding(null);
      else if (selectedNationId !== null) setSelectedNationId(null);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [
    pendingCustomKingdom,
    showCustomKingdomModal,
    showSaveLoadModal,
    showRecordsModal,
    showGeminiModal,
    showSettingsModal,
    showResearchTree,
    showSummitLounge,
    inspectedUnit,
    inspectedBuilding,
    selectedNationId,
  ]);

  // Initialize Engine & Main Loop
  useEffect(() => {
    const eng = new SimEngine(maxPop, isPhone, () => {
      void triggerDailyDiplomacySummit();
    });
    engineRef.current = eng;
    setHud(eng.getHudSnapshot(60));

    const unlockAudio = () => {
      soundFX.unlockAndStartMusic();
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

    const keysDown = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        eng.paused = !eng.paused;
        soundFX.setPhase(eng.isNight, eng.paused);
        setHud(engineRef.current ? engineRef.current.getHudSnapshot(60) : eng.getHudSnapshot(60));
        return;
      }
      keysDown.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysDown.delete(e.code);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    let currentDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let lowFpsFrames = 0;
    let highFpsFrames = 0;

    const updateCanvasSize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      canvas.width = Math.floor(w * currentDpr);
      canvas.height = Math.floor(h * currentDpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      setViewSize({ w, h });
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    window.addEventListener('orientationchange', updateCanvasSize);

    let rafId = 0;
    let lastTime = performance.now();
    let accumulator = 0;
    let lastHudSync = 0;
    let fpsSmooth = 60;
    const FIXED_DT = 1 / 30;

    const frame = (now: number) => {
      const rawDt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      if (rawDt > 0.001) {
        fpsSmooth = fpsSmooth * 0.9 + (1 / rawDt) * 0.1;
      }
      eng.currentFps = fpsSmooth;

      // Dynamic DPR governor keeps render thread >= 30 FPS on dense worlds or 10x speed
      const maxNativeDpr = Math.min(window.devicePixelRatio || 1, 1.5);
      if (fpsSmooth < 34) {
        lowFpsFrames++;
        highFpsFrames = 0;
        if (lowFpsFrames >= 60 && currentDpr > 1.0) {
          currentDpr = 1.0;
          updateCanvasSize();
        }
      } else if (fpsSmooth > 48) {
        highFpsFrames++;
        lowFpsFrames = 0;
        if (highFpsFrames >= 180 && currentDpr < maxNativeDpr) {
          currentDpr = maxNativeDpr;
          updateCanvasSize();
        }
      } else {
        lowFpsFrames = 0;
        highFpsFrames = 0;
      }

      const panSpeed = (520 / eng.camera.zoom) * rawDt;
      const manualKeyPan =
        keysDown.has('KeyW') ||
        keysDown.has('ArrowUp') ||
        keysDown.has('KeyS') ||
        keysDown.has('ArrowDown') ||
        keysDown.has('KeyA') ||
        keysDown.has('ArrowLeft') ||
        keysDown.has('KeyD') ||
        keysDown.has('ArrowRight');
      if (manualKeyPan && followUnitIdRef.current !== null) {
        setFollowUnitId(null);
      }
      if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) eng.camera.y -= panSpeed;
      if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) eng.camera.y += panSpeed;
      if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) eng.camera.x -= panSpeed;
      if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) eng.camera.x += panSpeed;

      if (!eng.paused && eng.speed > 0) {
        accumulator = Math.min(FIXED_DT * 3, accumulator + rawDt * eng.speed);
        const simBudgetMs = fpsSmooth < 34 ? 3.5 : fpsSmooth < 44 ? 5.0 : 8.0;
        const maxSubsteps = fpsSmooth < 32 ? 2 : fpsSmooth < 38 ? 4 : 10;
        const simStart = performance.now();
        let steps = 0;
        while (accumulator >= FIXED_DT && steps < maxSubsteps) {
          eng.step(FIXED_DT);
          accumulator -= FIXED_DT;
          steps++;
          if (steps >= 1 && performance.now() - simStart >= simBudgetMs) {
            accumulator = Math.min(accumulator, FIXED_DT * 2);
            break;
          }
        }
        if (steps >= maxSubsteps) {
          accumulator = 0;
        }
      }
      eng.particleScale = fpsSmooth < 35 ? 0.25 : fpsSmooth < 45 ? 0.4 : eng.isMobileViewport ? 0.5 : 1.0;

      if (followUnitIdRef.current !== null) {
        const targetUnit = eng.units.find((u) => u.alive && u.id === followUnitIdRef.current);
        if (targetUnit) {
          const targetPxX = targetUnit.x * TILE_SIZE;
          const targetPxY = targetUnit.y * TILE_SIZE;
          eng.camera.x += (targetPxX - eng.camera.x) * Math.min(1, rawDt * 12);
          eng.camera.y += (targetPxY - eng.camera.y) * Math.min(1, rawDt * 12);
        } else {
          setFollowUnitId(null);
        }
      }

      eng.camera.x = Math.max(0, Math.min(WORLD_PX_W, eng.camera.x));
      eng.camera.y = Math.max(0, Math.min(WORLD_PX_H, eng.camera.y));

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const cssW = canvas.width / currentDpr;
          const cssH = canvas.height / currentDpr;
          ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
          eng.render(ctx, cssW, cssH);
        }
      }

      if (now - lastHudSync >= 300) {
        lastHudSync = now;
        setHud(eng.getHudSnapshot(fpsSmooth));
        if (inspectedUnitIdRef.current !== null) {
          const liveUnit = eng.units.find((u) => u.alive && u.id === inspectedUnitIdRef.current);
          setInspectedUnit(liveUnit ? { ...liveUnit } : null);
        }
        if (inspectedBuildingLocRef.current) {
          const { tx, ty } = inspectedBuildingLocRef.current;
          setInspectedBuilding(eng.getBuildingAtTile(tx, ty));
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', updateCanvasSize);
      window.removeEventListener('orientationchange', updateCanvasSize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.maxPopulation = maxPop;
    }
  }, [maxPop]);

  useEffect(() => {
    soundFX.setFxEnabled(soundEnabled);
  }, [soundEnabled]);

  useEffect(() => {
    soundFX.setMusicEnabled(musicEnabled);
  }, [musicEnabled]);

  // ==================== POINTER, TOUCH, PINCH-ZOOM & WHEEL INPUTS ====================
  const pointersRef = useRef<Map<number, PointerPos>>(new Map());
  const pinchStartDistRef = useRef<number>(0);
  const pinchStartZoomRef = useRef<number>(1);
  const lastPanCenterRef = useRef<{ x: number; y: number } | null>(null);
  const isPaintingRef = useRef<boolean>(false);
  const isPanningMouseRef = useRef<boolean>(false);
  const lastPaintTimeRef = useRef<number>(0);

  const screenToWorldTile = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const eng = engineRef.current;
    if (!canvas || !eng) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const wxPx = (sx - rect.width * 0.5) / eng.camera.zoom + eng.camera.x;
    const wyPx = (sy - rect.height * 0.5) / eng.camera.zoom + eng.camera.y;
    return {
      sx,
      sy,
      tx: wxPx / TILE_SIZE,
      ty: wyPx / TILE_SIZE,
    };
  };

  const inspectAt = (sx: number, sy: number, tx: number, ty: number) => {
    const eng = engineRef.current;
    if (!eng) return;

    // 1. Check Summit Lounge Banner hitbox
    const sb = eng.summitBannerHitbox;
    if (sb && sx >= sb.sx && sx <= sb.sx + sb.w && sy >= sb.sy && sy <= sb.sy + sb.h) {
      handleOpenSummitLounge();
      return;
    }

    // 2. Check floating Nation Banner hitboxes
    for (const b of eng.bannerHitboxes) {
      if (sx >= b.sx && sx <= b.sx + b.w && sy >= b.sy && sy <= b.sy + b.h) {
        setSelectedNationId(b.nationId);
        setInspectedUnit(null);
        setInspectedBuilding(null);
        setFollowUnitId(null);
        return;
      }
    }

    // 3. Check building at exact clicked tile
    const bldg = eng.getBuildingAtTile(tx, ty);
    const unitSearchRad = bldg ? 1.35 : 3;

    // 4. Check nearest outdoor unit
    let best: Unit | null = null;
    let bestD = unitSearchRad * unitSearchRad;
    eng.spatialHash.queryRadius(eng.units, tx, ty, unitSearchRad, (u, _idx, dSq) => {
      if ((u.insideTimer ?? 0) > 0) return;
      if (dSq < bestD) {
        bestD = dSq;
        best = u;
      }
    });

    if (best) {
      setInspectedUnit({ ...(best as Unit) });
      setInspectedBuilding(null);
      setSelectedNationId(null);
      return;
    }

    if (bldg) {
      setInspectedBuilding(bldg);
      setInspectedUnit(null);
      setSelectedNationId(null);
      setFollowUnitId(null);
      return;
    }

    // 5. Check territory tile ownership
    const gx = Math.max(0, Math.min(GRID_W - 1, tx | 0));
    const gy = Math.max(0, Math.min(GRID_H - 1, ty | 0));
    const terr = eng.territory[gy * GRID_W + gx];
    if (terr >= 0) {
      setSelectedNationId(terr);
      setInspectedUnit(null);
      setInspectedBuilding(null);
      setFollowUnitId(null);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const eng = engineRef.current;
    if (!eng) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });

    const pts = Array.from(pointersRef.current.values());

    if (pts.length === 2) {
      isPaintingRef.current = false;
      isPanningMouseRef.current = false;
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchStartDistRef.current = Math.hypot(dx, dy) || 1;
      pinchStartZoomRef.current = eng.camera.zoom;
      lastPanCenterRef.current = {
        x: (pts[0].x + pts[1].x) * 0.5,
        y: (pts[0].y + pts[1].y) * 0.5,
      };
      return;
    }

    if (pts.length === 1) {
      const pos = screenToWorldTile(e.clientX, e.clientY);
      if (!pos) return;

      // Clicking the Summit Lounge banner opens the Summit Lounge panel
      const sb = eng.summitBannerHitbox;
      if (sb && pos.sx >= sb.sx && pos.sx <= sb.sx + sb.w && pos.sy >= sb.sy && pos.sy <= sb.sy + sb.h) {
        handleOpenSummitLounge();
        return;
      }

      // Always allow clicking a floating Nation Banner directly
      for (const b of eng.bannerHitboxes) {
        if (pos.sx >= b.sx && pos.sx <= b.sx + b.w && pos.sy >= b.sy && pos.sy <= b.sy + b.h) {
          setSelectedNationId(b.nationId);
          setInspectedUnit(null);
          setInspectedBuilding(null);
          setFollowUnitId(null);
          return;
        }
      }

      const isRightOrMiddle = e.button === 1 || e.button === 2;
      const tool = activeToolRef.current;

      if (pendingCustomKingdomRef.current && !isRightOrMiddle) {
        const res = eng.spawnCustomKingdom(pendingCustomKingdomRef.current, pos.tx, pos.ty);
        if (res.ok && res.nation) {
          setPendingCustomKingdom(null);
          setPlacementError(null);
          setSelectedNationId(res.nation.id);
          setInspectedUnit(null);
          setInspectedBuilding(null);
          setFollowUnitId(null);
          setHud(eng.getHudSnapshot(hud.fps));
        } else {
          setPlacementError(res.error || 'Choose an open aisle tile away from existing capitals.');
        }
        return;
      }

      if (isRightOrMiddle || tool === 'pan') {
        isPanningMouseRef.current = true;
        lastPanCenterRef.current = { x: e.clientX, y: e.clientY };
        setFollowUnitId(null);
        return;
      }

      if (tool === 'inspect') {
        inspectAt(pos.sx, pos.sy, pos.tx, pos.ty);
        return;
      }

      isPaintingRef.current = true;
      eng.applyTool(tool, brushSizeRef.current, pos.tx, pos.ty);
      lastPaintTimeRef.current = performance.now();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const eng = engineRef.current;
    const canvas = canvasRef.current;
    if (!eng || !canvas) return;
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });

    const pts = Array.from(pointersRef.current.values());

    if (pts.length === 2) {
      const cx = (pts[0].x + pts[1].x) * 0.5;
      const cy = (pts[0].y + pts[1].y) * 0.5;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const prevCenter = lastPanCenterRef.current || { x: cx, y: cy };

      const rect = canvas.getBoundingClientRect();
      const midRelX = cx - rect.left - rect.width * 0.5;
      const midRelY = cy - rect.top - rect.height * 0.5;

      const oldZoom = eng.camera.zoom;
      const newZoom = Math.max(0.45, Math.min(5.5, pinchStartZoomRef.current * (dist / pinchStartDistRef.current)));

      eng.camera.x -= (cx - prevCenter.x) / oldZoom;
      eng.camera.y -= (cy - prevCenter.y) / oldZoom;

      if (Math.abs(newZoom - oldZoom) > 0.001) {
        eng.camera.x += midRelX * (1 / oldZoom - 1 / newZoom);
        eng.camera.y += midRelY * (1 / oldZoom - 1 / newZoom);
        eng.camera.zoom = newZoom;
      }

      eng.camera.x = Math.max(0, Math.min(WORLD_PX_W, eng.camera.x));
      eng.camera.y = Math.max(0, Math.min(WORLD_PX_H, eng.camera.y));
      lastPanCenterRef.current = { x: cx, y: cy };
      return;
    }

    if (pts.length === 1) {
      if (isPanningMouseRef.current && lastPanCenterRef.current) {
        const dx = e.clientX - lastPanCenterRef.current.x;
        const dy = e.clientY - lastPanCenterRef.current.y;
        eng.camera.x = Math.max(0, Math.min(WORLD_PX_W, eng.camera.x - dx / eng.camera.zoom));
        eng.camera.y = Math.max(0, Math.min(WORLD_PX_H, eng.camera.y - dy / eng.camera.zoom));
        lastPanCenterRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      if (isPaintingRef.current) {
        const now = performance.now();
        const tool = activeToolRef.current;
        const isSingleTapPower =
          tool === 'power_coup' ||
          tool === 'power_peace' ||
          tool === 'power_war' ||
          tool === 'power_uplift' ||
          tool === 'power_meteor' ||
          tool === 'power_lightning' ||
          tool === 'power_time_shift' ||
          tool === 'power_restock' ||
          tool === 'power_anomaly' ||
          tool === 'power_supply_drop' ||
          tool === 'power_pacify_staff' ||
          tool === 'power_prosperity' ||
          tool === 'power_vortex' ||
          tool === 'power_enlighten' ||
          tool === 'build_spotlight' ||
          tool === 'build_watchtower' ||
          tool === 'build_bistro' ||
          tool === 'build_tech_lab' ||
          tool === 'build_escalator' ||
          tool === 'spawn_warden' ||
          tool === 'spawn_stalker' ||
          tool === 'spawn_announcer' ||
          tool === 'spawn_caravan' ||
          tool === 'spawn_mercenary';
        if (isSingleTapPower) return;
        const throttleMs = tool.startsWith('paint_') || tool === 'build_wall' ? 25 : 110;
        if (now - lastPaintTimeRef.current >= throttleMs) {
          lastPaintTimeRef.current = now;
          const pos = screenToWorldTile(e.clientX, e.clientY);
          if (pos) {
            eng.applyTool(tool, brushSizeRef.current, pos.tx, pos.ty);
          }
        }
      }
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (pointersRef.current.size === 0) {
      isPaintingRef.current = false;
      isPanningMouseRef.current = false;
      lastPanCenterRef.current = null;
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const eng = engineRef.current;
    const canvas = canvasRef.current;
    if (!eng || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const relX = e.clientX - rect.left - rect.width * 0.5;
    const relY = e.clientY - rect.top - rect.height * 0.5;

    const oldZoom = eng.camera.zoom;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const newZoom = Math.max(0.45, Math.min(5.5, oldZoom * factor));

    eng.camera.x += relX * (1 / oldZoom - 1 / newZoom);
    eng.camera.y += relY * (1 / oldZoom - 1 / newZoom);
    eng.camera.zoom = newZoom;
    eng.camera.x = Math.max(0, Math.min(WORLD_PX_W, eng.camera.x));
    eng.camera.y = Math.max(0, Math.min(WORLD_PX_H, eng.camera.y));
  };

  const handleWhisper = async (nationId: number, message: string): Promise<string> => {
    const eng = engineRef.current;
    if (!eng) return 'Simulation unavailable.';
    const nation = eng.getNation(nationId);
    if (!nation) return 'Nation not found.';

    const res = await runGodWhisper(geminiKey, nation, eng.nations, message, eng.day);
    if (res.taxChange) {
      nation.taxRate = res.taxChange;
      eng.addNews('POLITICS', `${nation.name} set taxes to ${res.taxChange} after a divine whisper.`);
    }
    if (res.govChange) {
      nation.government = res.govChange;
      eng.addNews('POLITICS', `${nation.name} reformed into a ${res.govChange}!`);
    }
    if (res.action) {
      eng.applyDiplomaticAction(res.action);
    }
    nation.lastQuote = res.reply;
    setHud(eng.getHudSnapshot(hud.fps));
    return res.reply;
  };

  const selectedNation =
    selectedNationId !== null
      ? hud.nations.find((n) => n.id === selectedNationId)
      : undefined;

  const livingNations = hud.nations.filter((n) => n.alive);

  useEffect(() => {
    if ((!selectedNation || !selectedNation.alive) && showResearchTree) {
      if (livingNations.length > 0) {
        setSelectedNationId(livingNations[0].id);
      } else {
        setShowResearchTree(false);
      }
    }
  }, [selectedNation, showResearchTree, livingNations]);

  const inspectedUnitNation =
    inspectedUnit && inspectedUnit.nationId >= 0
      ? hud.nations.find((n) => n.id === inspectedUnit.nationId)
      : undefined;

  const leaderSeats = hud.nations
    .filter((n) => n.alive && n.leader.alive)
    .map((n) => ({
      nation: n,
      status: engineRef.current ? engineRef.current.getLeaderLoungeStatus(n.id) : ('away' as const),
    }));

  return (
    <div className="relative w-full h-full flex flex-col bg-[#090c12] overflow-hidden">
      {/* Top HUD */}
      <TopHud
        hud={hud}
        hasGeminiKey={Boolean(geminiKey.trim())}
        musicEnabled={musicEnabled}
        summitLoungeOpen={showSummitLounge}
        summitSessionActive={summitSessionActive}
        onSetSpeed={(spd: SimSpeed) => {
          if (engineRef.current) {
            engineRef.current.speed = spd;
            engineRef.current.paused = false;
            soundFX.setPhase(engineRef.current.isNight, false);
            setHud(engineRef.current.getHudSnapshot(hud.fps));
          }
        }}
        onTogglePause={() => {
          if (engineRef.current) {
            engineRef.current.paused = !engineRef.current.paused;
            soundFX.setPhase(engineRef.current.isNight, engineRef.current.paused);
            setHud(engineRef.current.getHudSnapshot(hud.fps));
          }
        }}
        onToggleMusic={() => {
          soundFX.unlockAndStartMusic();
          setMusicEnabled((m) => !m);
        }}
        onOpenGeminiModal={() => setShowGeminiModal(true)}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenSaveLoad={() => setShowSaveLoadModal(true)}
        onOpenRecords={() => setShowRecordsModal(true)}
        onOpenCustomKingdom={() => {
          setPlacementError(null);
          setShowCustomKingdomModal(true);
        }}
        onOpenTechCenter={() => {
          const living = hud.nations.filter((n) => n.alive);
          if (living.length === 0) return;
          if (!selectedNation || !selectedNation.alive) {
            const topNation = [...living].sort((a, b) => b.population - a.population)[0];
            setSelectedNationId(topNation.id);
          }
          setShowResearchTree(true);
        }}
        onToggleSummitLounge={handleToggleSummitLounge}
        onResetWorld={() => {
          finishSummitLoungeSession();
          setSummitMessages([]);
          setSummitError(null);
          if (engineRef.current) {
            engineRef.current.resetWorld(worldPreset);
            setSelectedNationId(null);
            setInspectedUnit(null);
            setInspectedBuilding(null);
            setFollowUnitId(null);
            setHud(engineRef.current.getHudSnapshot(hud.fps));
          }
        }}
      />

      {/* Main Viewport Canvas Container */}
      <div
        ref={containerRef}
        className="relative flex-1 w-full overflow-hidden touch-canvas-surface"
      >
        <canvas
          ref={canvasRef}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
          onWheel={handleWheel}
          className={`block w-full h-full touch-canvas-surface ${
            activeTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
          }`}
        />

        {/* Custom Kingdom Placement Banner */}
        {pendingCustomKingdom && (
          <div className="pointer-events-auto absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-xl bg-[#11161f]/95 border border-[#ffda1a] shadow-2xl text-xs text-slate-100">
            <div>
              <div className="font-semibold">
                Click any open aisle tile to found{' '}
                <span style={{ color: pendingCustomKingdom.color }}>{pendingCustomKingdom.name}</span>
              </div>
              {placementError && <div className="text-[11px] text-rose-300 mt-0.5">{placementError}</div>}
            </div>
            <button
              type="button"
              onClick={() => {
                setPendingCustomKingdom(null);
                setPlacementError(null);
              }}
              className="min-h-[36px] px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold shrink-0"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Top-Right Side News Ticker */}
        {!showSummitLounge && (
          <div className="pointer-events-none absolute top-3 right-3 z-20 flex flex-col items-end gap-2">
            <NewsTicker news={hud.news} chronicle={hud.chronicle} isMobile={isPhone} />
          </div>
        )}

        {/* Bottom-Right Interactive Minimap */}
        <div className="pointer-events-none absolute bottom-3 right-3 z-20">
          <Minimap engineRef={engineRef} viewSize={viewSize} />
        </div>

        {/* Mobile compact FPS & Units chip */}
        <div className="pointer-events-none md:hidden absolute top-3 left-3 z-20 px-2 py-1 rounded bg-[#0d1117]/80 border border-slate-800 text-[10px] font-mono-tabular text-slate-300">
          {hud.fps} FPS · {hud.totalUnits} Units · {hud.staffCount} Staff
        </div>

        {/* Top-Left War, Trade, Army & Summit Lounge Tracker */}
        <div className="pointer-events-none absolute top-11 md:top-3 left-3 z-20">
          <WarTracker
            nations={hud.nations}
            summitActive={hud.summitActive}
            isNight={hud.isNight}
            isMobile={isPhone}
            onSelectNation={(nid) => {
              setSelectedNationId(nid);
              setInspectedUnit(null);
              setInspectedBuilding(null);
              setFollowUnitId(null);
            }}
            onPanToTile={panToTile}
            onOpenSummitLounge={handleOpenSummitLounge}
          />
        </div>

        {/* Nation Overview Panel */}
        {selectedNation && (
          <NationPanel
            nation={selectedNation}
            allNations={hud.nations}
            hasGeminiKey={Boolean(geminiKey.trim())}
            onClose={() => {
              setSelectedNationId(null);
              setShowResearchTree(false);
            }}
            onWhisper={handleWhisper}
            onSelectNation={(nid) => setSelectedNationId(nid)}
            onOpenResearchTree={() => setShowResearchTree(true)}
            onRenameNation={(nid, newName) => {
              if (!engineRef.current) return;
              engineRef.current.renameNation(nid, newName);
              setHud(engineRef.current.getHudSnapshot(hud.fps));
            }}
            onChangeBuildingSpacing={(nid, spacing) => {
              if (!engineRef.current) return;
              soundFX.playChime(520, 0.05);
              engineRef.current.setNationBuildingSpacing(nid, spacing);
              setHud(engineRef.current.getHudSnapshot(hud.fps));
            }}
            onSpawnUnitsForNation={(nid, unitType) => {
              if (!engineRef.current) return;
              soundFX.playChime(580, 0.06);
              engineRef.current.godSpawnForNation(nid, unitType);
              setHud(engineRef.current.getHudSnapshot(hud.fps));
            }}
            onSetDiplomacy={(aId, bId, stance: DiplomaticStance) => {
              if (!engineRef.current) return;
              soundFX.playPower();
              engineRef.current.godSetDiplomacy(aId, bId, stance);
              setHud(engineRef.current.getHudSnapshot(hud.fps));
            }}
            onUniteNations={(aId, bId) => {
              if (!engineRef.current) return;
              soundFX.playPower();
              engineRef.current.godUniteNations(aId, bId);
              setHud(engineRef.current.getHudSnapshot(hud.fps));
            }}
          />
        )}

        {/* Nation Research & SCP-IKEA Technology Center Modal */}
        {showResearchTree && selectedNation && selectedNation.alive && (
          <ResearchTreeModal
            nation={selectedNation}
            nations={livingNations}
            onSelectNation={(nid) => setSelectedNationId(nid)}
            onFocusTech={(techId: TechId) => {
              if (!engineRef.current) return;
              engineRef.current.setNationActiveResearch(selectedNation.id, techId);
              setHud(engineRef.current.getHudSnapshot(hud.fps));
            }}
            onBoostResearch={() => {
              if (!engineRef.current) return;
              soundFX.playChime(680, 0.07);
              engineRef.current.boostNationResearch(selectedNation.id, 20);
              setHud(engineRef.current.getHudSnapshot(hud.fps));
            }}
            onGrantTech={(techId: TechId) => {
              if (!engineRef.current) return;
              soundFX.playChime(740, 0.08);
              engineRef.current.grantNationResearch(selectedNation.id, techId);
              setHud(engineRef.current.getHudSnapshot(hud.fps));
            }}
            onClose={() => setShowResearchTree(false)}
          />
        )}

        {/* Summit Lounge Panel (Gemini API / Heuristic Leaders Talk <= 5 mins) */}
        {showSummitLounge && (
          <SummitLoungeModal
            nations={hud.nations}
            leaderSeats={leaderSeats}
            messages={summitMessages}
            activeAnomaly={hud.activeAnomaly}
            sessionActive={summitSessionActive}
            sessionPaused={summitSessionPaused}
            loadingTurn={summitTurnLoading}
            errorMsg={summitError}
            selectedDurationSec={summitDurationSec}
            remainingSec={summitRemainingSec}
            speakingNationId={speakingNationId}
            hasGeminiKey={Boolean(geminiKey.trim())}
            onOpenGeminiModal={() => setShowGeminiModal(true)}
            onSelectDuration={(sec) => {
              setSummitDurationSec(sec);
              if (!summitSessionActive) {
                setSummitRemainingSec(sec);
              }
            }}
            onStartSession={startSummitLoungeSession}
            onTogglePauseSession={() => setSummitSessionPaused((p) => !p)}
            onEndSession={finishSummitLoungeSession}
            onNextTurn={(topicOverride) => void runSummitLoungeTurn(topicOverride, false)}
            onFocusLounge={() => panToTile(SUMMIT_X + 0.5, SUMMIT_Y + 0.5)}
            onClose={() => setShowSummitLounge(false)}
          />
        )}

        {/* Inspect Unit Modal */}
        {inspectedUnit && (
          <InspectUnitModal
            unit={inspectedUnit}
            nation={inspectedUnitNation}
            isFollowing={followUnitId === inspectedUnit.id}
            onToggleFollow={() => {
              setFollowUnitId((prev) => (prev === inspectedUnit.id ? null : inspectedUnit.id));
            }}
            onClose={() => {
              setInspectedUnit(null);
              setFollowUnitId(null);
            }}
            onOpenNation={(nid) => {
              setInspectedUnit(null);
              setFollowUnitId(null);
              setSelectedNationId(nid);
            }}
            onUnitAction={(unitId, action) => {
              const eng = engineRef.current;
              if (!eng) return;
              const res = eng.giveUnitGift(unitId, action);
              if (res.ok) {
                soundFX.playPower();
              } else {
                soundFX.playChime(220, 0.08, 'sawtooth');
              }
              const updated = eng.units.find((u) => u.alive && u.id === unitId);
              setInspectedUnit(updated ? { ...updated } : null);
              setHud(eng.getHudSnapshot(hud.fps));
            }}
          />
        )}

        {/* Inspect Building Modal */}
        {inspectedBuilding && (
          <InspectBuildingModal
            building={inspectedBuilding}
            nation={
              inspectedBuilding.ownerId >= 0
                ? hud.nations.find((n) => n.id === inspectedBuilding.ownerId)
                : undefined
            }
            onClose={() => setInspectedBuilding(null)}
            onOpenNation={(nid) => {
              setInspectedBuilding(null);
              setSelectedNationId(nid);
            }}
            onInspectOccupant={(unitId) => {
              const u = engineRef.current?.units.find((unit) => unit.alive && unit.id === unitId);
              if (u) {
                setInspectedBuilding(null);
                setInspectedUnit({ ...u });
                setFollowUnitId(u.id);
              }
            }}
            onRepair={(idx) => {
              if (!engineRef.current) return;
              engineRef.current.repairBuildingAt(idx);
              setInspectedBuilding(
                engineRef.current.getBuildingAtTile(inspectedBuilding.tx, inspectedBuilding.ty)
              );
              soundFX.playPower();
            }}
            onDemolish={(idx) => {
              if (!engineRef.current) return;
              engineRef.current.demolishBuildingAt(idx);
              setInspectedBuilding(null);
              setHud(engineRef.current.getHudSnapshot(hud.fps));
              soundFX.playChime(180, 0.12, 'sawtooth');
            }}
          />
        )}
      </div>

      {/* Bottom WorldBox Toolbar */}
      <WorldToolbar
        activeTool={activeTool}
        brushSize={brushSize}
        onSelectTool={setActiveTool}
        onSelectBrush={setBrushSize}
      />

      {/* BYOK Gemini Key Modal (browser-local storage only) */}
      {showGeminiModal && (
        <GeminiKeyModal
          currentKey={geminiKey}
          onSaveKey={(key) => {
            setStoredGeminiKey(key);
            setGeminiKey(key);
          }}
          onClearKey={() => {
            setStoredGeminiKey('');
            setGeminiKey('');
          }}
          onClose={() => setShowGeminiModal(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal
          maxPop={maxPop}
          worldPreset={worldPreset}
          soundEnabled={soundEnabled}
          musicEnabled={musicEnabled}
          allowWildStaffKingdoms={Boolean(hud.allowWildStaffKingdoms)}
          isMobile={isPhone}
          onChangeMaxPop={setMaxPop}
          onChangeWorldPreset={(preset) => setWorldPreset(preset)}
          onToggleSound={() => setSoundEnabled((s) => !s)}
          onToggleMusic={() => {
            soundFX.unlockAndStartMusic();
            setMusicEnabled((m) => !m);
          }}
          onToggleWildStaffKingdoms={() => {
            if (!engineRef.current) return;
            engineRef.current.setAllowWildStaffKingdoms(!engineRef.current.allowWildStaffKingdoms);
            setHud(engineRef.current.getHudSnapshot(hud.fps));
          }}
          onResetWorld={(preset) => {
            finishSummitLoungeSession();
            setSummitMessages([]);
            setSummitError(null);
            if (engineRef.current) {
              engineRef.current.resetWorld(preset ?? worldPreset);
              setSelectedNationId(null);
              setInspectedUnit(null);
              setInspectedBuilding(null);
              setFollowUnitId(null);
              setHud(engineRef.current.getHudSnapshot(hud.fps));
            }
          }}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {/* Save & Load World Modal */}
      {showSaveLoadModal && (
        <SaveLoadModal
          currentDay={hud.day}
          onExportWorld={(label) => (engineRef.current ? engineRef.current.exportWorldState(label) : null)}
          onImportWorld={(data: SerializedWorldV1) => {
            if (!engineRef.current) return;
            finishSummitLoungeSession();
            setSummitMessages([]);
            setSummitError(null);
            engineRef.current.importWorldState(data);
            setSelectedNationId(null);
            setInspectedUnit(null);
            setInspectedBuilding(null);
            setFollowUnitId(null);
            setHud(engineRef.current.getHudSnapshot(hud.fps));
          }}
          onClose={() => setShowSaveLoadModal(false)}
        />
      )}

      {/* Hall of Records Modal */}
      {showRecordsModal && (
        <HallOfRecordsModal
          day={hud.day}
          records={hud.records}
          nations={hud.nations}
          onSelectNation={(nid) => {
            setSelectedNationId(nid);
            setInspectedUnit(null);
            setInspectedBuilding(null);
            setFollowUnitId(null);
          }}
          onClose={() => setShowRecordsModal(false)}
        />
      )}

      {/* Custom Kingdom Creator Modal */}
      {showCustomKingdomModal && (
        <CustomKingdomModal
          onStartMapPlacement={(config) => {
            setShowCustomKingdomModal(false);
            setPlacementError(null);
            setPendingCustomKingdom(config);
          }}
          onAutoPlace={(config) => {
            const eng = engineRef.current;
            if (!eng) return { ok: false, error: 'Simulation unavailable.' };
            const spot = eng.findOpenKingdomSpot();
            if (!spot) {
              return { ok: false, error: 'No open aisle wing found far enough from existing capitals.' };
            }
            const res = eng.spawnCustomKingdom(config, spot.tx, spot.ty);
            if (res.ok && res.nation) {
              panToTile(res.nation.capitalX, res.nation.capitalY);
              setSelectedNationId(res.nation.id);
              setInspectedUnit(null);
              setInspectedBuilding(null);
              setFollowUnitId(null);
              setHud(eng.getHudSnapshot(hud.fps));
            }
            return res;
          }}
          onClose={() => setShowCustomKingdomModal(false)}
        />
      )}
    </div>
  );
}
