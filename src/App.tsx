import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GeminiKeyModal } from './components/GeminiKeyModal';
import { InspectUnitModal } from './components/InspectUnitModal';
import { Minimap } from './components/Minimap';
import { NationPanel } from './components/NationPanel';
import { NewsTicker } from './components/NewsTicker';
import { ResearchTreeModal } from './components/ResearchTreeModal';
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
import { soundFX } from './game/sound';
import {
  BrushSize,
  HudSnapshot,
  SimSpeed,
  TechId,
  ToolId,
  Unit,
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
  const [viewSize, setViewSize] = useState({ w: 1280, h: 720 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SimEngine | null>(null);

  const activeToolRef = useRef<ToolId>(activeTool);
  const brushSizeRef = useRef<BrushSize>(brushSize);
  const geminiKeyRef = useRef<string>(geminiKey);
  const summitInFlightRef = useRef<boolean>(false);
  const loungeTurnInFlightRef = useRef<boolean>(false);
  const loungeAbortRef = useRef<AbortController | null>(null);
  const summitMessagesRef = useRef<SummitLoungeMessage[]>(summitMessages);
  const summitRemainingRef = useRef<number>(summitRemainingSec);
  const summitDurationRef = useRef<SummitDurationSec>(summitDurationSec);
  const summitSessionActiveRef = useRef<boolean>(summitSessionActive);
  const nextTurnCooldownRef = useRef<number>(0);

  activeToolRef.current = activeTool;
  brushSizeRef.current = brushSize;
  geminiKeyRef.current = geminiKey;
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
    paused: false,
    speed: 1,
    summitActive: false,
    auditNight: false,
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
          nations: aliveNations.map((n) => ({
            id: n.id,
            name: n.name,
            gov: n.government,
            ideology: n.ideology,
            techTier: n.techTier,
            pop: n.population,
            meatballs: Math.round(n.meatballs),
            scrap: Math.round(n.scrap),
            wrenches: Math.round(n.allenWrenches),
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
    panToTile(SUMMIT_X + 0.5, SUMMIT_Y + 0.5);
  }, [panToTile]);

  const handleToggleSummitLounge = useCallback(() => {
    setShowSummitLounge((open) => {
      const next = !open;
      if (next) {
        setSelectedNationId(null);
        setInspectedUnit(null);
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
      if (showGeminiModal) setShowGeminiModal(false);
      else if (showSettingsModal) setShowSettingsModal(false);
      else if (showResearchTree) setShowResearchTree(false);
      else if (showSummitLounge) setShowSummitLounge(false);
      else if (inspectedUnit) setInspectedUnit(null);
      else if (selectedNationId !== null) setSelectedNationId(null);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [
    showGeminiModal,
    showSettingsModal,
    showResearchTree,
    showSummitLounge,
    inspectedUnit,
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
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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

    const updateCanvasSize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
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
    const MAX_SUBSTEPS = 12;

    const frame = (now: number) => {
      const rawDt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      if (rawDt > 0.001) {
        fpsSmooth = fpsSmooth * 0.9 + (1 / rawDt) * 0.1;
      }

      const panSpeed = (520 / eng.camera.zoom) * rawDt;
      if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) eng.camera.y -= panSpeed;
      if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) eng.camera.y += panSpeed;
      if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) eng.camera.x -= panSpeed;
      if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) eng.camera.x += panSpeed;

      eng.camera.x = Math.max(0, Math.min(WORLD_PX_W, eng.camera.x));
      eng.camera.y = Math.max(0, Math.min(WORLD_PX_H, eng.camera.y));

      if (!eng.paused && eng.speed > 0) {
        accumulator += rawDt * eng.speed;
        let steps = 0;
        while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
          eng.step(FIXED_DT);
          accumulator -= FIXED_DT;
          steps++;
        }
        if (steps >= MAX_SUBSTEPS) {
          accumulator = 0;
        }
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
          const cssW = canvas.width / dpr;
          const cssH = canvas.height / dpr;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          eng.render(ctx, cssW, cssH);
        }
      }

      if (now - lastHudSync >= 300) {
        lastHudSync = now;
        setHud(eng.getHudSnapshot(fpsSmooth));
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
        return;
      }
    }

    // 3. Check nearest unit within 3 tiles
    let best: Unit | null = null;
    let bestD = 9;
    eng.spatialHash.queryRadius(eng.units, tx, ty, 3, (u, _idx, dSq) => {
      if (dSq < bestD) {
        bestD = dSq;
        best = u;
      }
    });

    if (best) {
      setInspectedUnit({ ...(best as Unit) });
      setSelectedNationId(null);
      return;
    }

    // 4. Check territory tile ownership
    const gx = Math.max(0, Math.min(GRID_W - 1, tx | 0));
    const gy = Math.max(0, Math.min(GRID_H - 1, ty | 0));
    const terr = eng.territory[gy * GRID_W + gx];
    if (terr >= 0) {
      setSelectedNationId(terr);
      setInspectedUnit(null);
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
          return;
        }
      }

      const isRightOrMiddle = e.button === 1 || e.button === 2;
      const tool = activeToolRef.current;

      if (isRightOrMiddle || tool === 'pan') {
        isPanningMouseRef.current = true;
        lastPanCenterRef.current = { x: e.clientX, y: e.clientY };
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
          tool === 'power_lightning';
        if (isSingleTapPower) return;
        const throttleMs = tool.startsWith('paint_') ? 25 : 110;
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
      ? hud.nations.find((n) => n.id === selectedNationId && n.alive)
      : undefined;

  useEffect(() => {
    if (!selectedNation && showResearchTree) {
      setShowResearchTree(false);
    }
  }, [selectedNation, showResearchTree]);

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
        onToggleSummitLounge={handleToggleSummitLounge}
        onResetWorld={() => {
          finishSummitLoungeSession();
          setSummitMessages([]);
          setSummitError(null);
          if (engineRef.current) {
            engineRef.current.resetWorld();
            setSelectedNationId(null);
            setInspectedUnit(null);
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

        {/* Top-Right Side News Ticker */}
        {!showSummitLounge && (
          <div className="pointer-events-none absolute top-3 right-3 z-20 flex flex-col items-end gap-2">
            <NewsTicker news={hud.news} isMobile={isPhone} />
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
          />
        )}

        {/* Nation Research Tree Modal */}
        {showResearchTree && selectedNation && (
          <ResearchTreeModal
            nation={selectedNation}
            onFocusTech={(techId: TechId) => {
              if (!engineRef.current) return;
              engineRef.current.setNationActiveResearch(selectedNation.id, techId);
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
            onClose={() => setInspectedUnit(null)}
            onOpenNation={(nid) => {
              setInspectedUnit(null);
              setSelectedNationId(nid);
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
          soundEnabled={soundEnabled}
          musicEnabled={musicEnabled}
          isMobile={isPhone}
          onChangeMaxPop={setMaxPop}
          onToggleSound={() => setSoundEnabled((s) => !s)}
          onToggleMusic={() => {
            soundFX.unlockAndStartMusic();
            setMusicEnabled((m) => !m);
          }}
          onResetWorld={() => {
            finishSummitLoungeSession();
            setSummitMessages([]);
            setSummitError(null);
            if (engineRef.current) {
              engineRef.current.resetWorld();
              setSelectedNationId(null);
              setInspectedUnit(null);
              setHud(engineRef.current.getHudSnapshot(hud.fps));
            }
          }}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}
