import { GOVERNMENTS, IKEA_QUOTES } from './constants';
import {
  ActiveAnomaly,
  GeminiDiplomaticAction,
  GeminiSummitResponse,
  GovernmentType,
  Nation,
} from './types';

export const GEMINI_KEY_STORAGE = 'scp3008_byok_gemini_key';

export function getStoredGeminiKey(): string {
  try {
    return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setStoredGeminiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (!trimmed) {
      localStorage.removeItem(GEMINI_KEY_STORAGE);
    } else {
      localStorage.setItem(GEMINI_KEY_STORAGE, trimmed);
    }
  } catch {
    // Ignore storage errors
  }
}

export async function testGeminiKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, message: 'Please enter a Gemini API key first.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('/api/gemini/test-key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gemini-api-key': trimmed,
      },
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
    };
    return {
      ok: Boolean(response.ok && data.ok),
      message: data.message || (response.ok ? 'Key verified.' : 'Verification failed.'),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Verification failed';
    return { ok: false, message: msg.slice(0, 140) };
  } finally {
    clearTimeout(timer);
  }
}

export interface SummitLoungeMessage {
  id: string;
  speakerNationId: number;
  speakerName: string;
  nationName: string;
  nationColor: string;
  text: string;
  mood: 'cordial' | 'tense' | 'scheming' | 'jovial' | 'urgent';
  timestamp: string;
  actionSummary?: string;
}

export interface SummitLoungeTurnRequest {
  day: number;
  isNight: boolean;
  activeAnomaly?: ActiveAnomaly | null;
  nations: Array<{
    id: number;
    name: string;
    species?: 'human' | 'staff';
    gov: string;
    ideology: string;
    techTier: number;
    pop: number;
    meatballs: number;
    scrap: number;
    wrenches: number;
    firearms?: number;
    civilianGoods?: number;
    happiness: number;
    tax: string;
    threat: number;
    isUnion?: boolean;
    unionMembers?: string[];
    leaderName: string;
    leaderTraits: string[];
    seated: boolean;
    relations: Array<{
      withId: number;
      withName: string;
      stance: string;
    }>;
  }>;
  history: Array<{
    speakerNationId: number;
    speakerName: string;
    nationName: string;
    text: string;
    mood?: string;
  }>;
  topic?: string;
  remainingSec: number;
  totalDurationSec: number;
  isClosing: boolean;
  recentEvents: string[];
}

export interface SummitLoungeTurnResponse {
  speakerNationId: number;
  dialogue: string;
  mood: 'cordial' | 'tense' | 'scheming' | 'jovial' | 'urgent';
  shouldConclude?: boolean;
  diplomaticAction?: GeminiDiplomaticAction;
  usedGemini: boolean;
}

export function buildCompactSummitSnapshot(
  nations: Nation[],
  day: number,
  isNight: boolean,
  recentEvents: string[]
) {
  return {
    day,
    phase: isNight ? 'NIGHT' : 'DAY',
    recentEvents: recentEvents.slice(0, 6),
    nations: nations
      .filter((n) => n.alive)
      .map((n) => ({
        id: n.id,
        name: n.name,
        species: n.species || 'human',
        gov: n.government,
        ideology: n.ideology,
        techTier: n.techTier,
        pop: n.population,
        meatballs: Math.round(n.meatballs),
        scrap: Math.round(n.scrap),
        wrenches: Math.round(n.allenWrenches),
        firearms: Math.round(n.firearms || 0),
        civilianGoods: Math.round(n.civilianGoods || 0),
        isUnion: Boolean(n.isUnion),
        unionMembers: n.unionMembers || [],
        happiness: Math.round(n.happiness),
        tax: n.taxRate,
        threat: Math.round(n.threatScore),
        overlordId: n.overlordId,
        vassalIds: n.vassalIds,
        leader: {
          name: n.leader.name,
          alive: n.leader.alive,
          traits: n.leader.traits,
        },
        recentCoup: day - n.recentCoupDay <= 1,
        relations: Object.entries(n.relations).map(([otherId, rel]) => ({
          withId: Number(otherId),
          stance: rel.stance,
          exhaustion: Math.round(rel.warExhaustion),
        })),
      })),
  };
}

function runHeuristicSummitLoungeTurn(
  payload: SummitLoungeTurnRequest
): SummitLoungeTurnResponse {
  const nations = payload.nations;
  const lastSpeakerId =
    payload.history.length > 0
      ? payload.history[payload.history.length - 1].speakerNationId
      : null;

  const lastIdx = lastSpeakerId !== null ? nations.findIndex((n) => n.id === lastSpeakerId) : -1;
  const speaker = nations[(lastIdx + 1) % nations.length];
  const other = nations.find((n) => n.id !== speaker.id) || speaker;
  const rel = speaker.relations.find((r) => r.withId === other.id);
  const stance = rel?.stance || 'NEUTRAL';

  if (payload.isClosing) {
    return {
      speakerNationId: speaker.id,
      dialogue: `Time grows short in the Lounge, ${other.leaderName}. Let our guards keep the spotlights burning and our carts rolling until the next Summit.`,
      mood: 'cordial',
      shouldConclude: true,
      usedGemini: false,
    };
  }

  if (payload.topic?.trim()) {
    const t = payload.topic.trim();
    return {
      speakerNationId: speaker.id,
      dialogue: `Regarding "${t}" — ${speaker.name} currently holds ${speaker.meatballs} meatballs and ${speaker.wrenches} Allen wrenches. ${other.leaderName}, if you honor our border aisles, we can work together.`,
      mood: stance === 'WAR' ? 'tense' : 'cordial',
      usedGemini: false,
    };
  }

  if (stance === 'WAR') {
    const makePeace = payload.history.length >= 3 && Math.random() < 0.45;
    if (makePeace) {
      return {
        speakerNationId: speaker.id,
        dialogue: `Enough bloodshed in the Showroom, ${other.leaderName}. Sitting on these neutral couches makes it clear: let us sign a ceasefire and reopen the aisles.`,
        mood: 'urgent',
        usedGemini: false,
        diplomaticAction: {
          type: 'PEACE_TREATY',
          actorNationId: speaker.id,
          targetNationId: other.id,
          quote: `Ceasefire signed at the Summit Lounge with ${other.name}.`,
        },
      };
    }
    return {
      speakerNationId: speaker.id,
      dialogue: `Even seated peacefully here in the Lounge, ${other.leaderName}, do not mistake my manners for weakness. Your border barricades still encroach on our Food Court.`,
      mood: 'tense',
      usedGemini: false,
    };
  }

  if (stance === 'NEUTRAL' || stance === 'TRUCE') {
    if (payload.history.length >= 2 && Math.random() < 0.45) {
      return {
        speakerNationId: speaker.id,
        dialogue: `${other.leaderName}, our ${speaker.gov} is ready to send blue shopping carts across your sector. Shall we formalize a Trade Pact right here at this coffee table?`,
        mood: 'jovial',
        usedGemini: false,
        diplomaticAction: {
          type: 'TRADE_PACT',
          actorNationId: speaker.id,
          targetNationId: other.id,
          quote: `Trade Pact agreed at the Summit Lounge with ${other.name}!`,
        },
      };
    }
  } else if (stance === 'ALLIANCE') {
    if (payload.history.length >= 2 && Math.random() < 0.48) {
      return {
        speakerNationId: speaker.id,
        dialogue: `Our alliance has kept the Night Staff at bay, ${other.leaderName}. Let us bind our banners into a formal Union Pact with shared defense!`,
        mood: 'jovial',
        usedGemini: false,
        diplomaticAction: {
          type: 'FORM_UNION',
          actorNationId: speaker.id,
          targetNationId: other.id,
          quote: `Union Pact proclaimed at the Summit Lounge between ${speaker.name} and ${other.name}!`,
        },
      };
    }
  } else if (stance === 'UNION' && nations.length >= 3 && payload.day >= 3) {
    if (payload.history.length >= 3 && Math.random() < 0.42) {
      return {
        speakerNationId: speaker.id,
        dialogue: `${other.leaderName}, our peoples already share meatballs, guards, and spotlights. Why stay divided? Let us unite our kingdoms into one Grand Union!`,
        mood: 'cordial',
        usedGemini: false,
        diplomaticAction: {
          type: 'UNITE_KINGDOMS',
          actorNationId: speaker.id,
          targetNationId: other.id,
          quote: `Act of Union signed at the Summit Lounge: ${speaker.name} & ${other.name} unite as one!`,
        },
      };
    }
  }

  const anomalyLine = payload.activeAnomaly
    ? `With ${payload.activeAnomaly.label} sweeping the store right now, ${other.leaderName}, we ought to coordinate escalators and defense.`
    : null;
  const staffLine =
    speaker.species === 'staff'
      ? `As a sovereign SCP-3008-2 Staff realm, ${speaker.name} keeps the aisles tidy and our ${speaker.firearms || 0} PA weapons ready—respect our yellow-polo borders, ${other.leaderName}.`
      : null;
  const unionLine = speaker.isUnion
    ? `Our Grand Union (${(speaker.unionMembers || [speaker.name]).slice(0, 3).join(' + ')}) has linked trade corridors and ${speaker.civilianGoods || 0} catalog goods across the store.`
    : null;
  const techLine =
    (speaker.firearms || 0) > 0 || (speaker.civilianGoods || 0) > 0
      ? `Our Tech Labs forged ${speaker.firearms || 0} ranged weapons and ${speaker.civilianGoods || 0} catalog goods—our escalators keep the ${speaker.pop} citizens moving fast!`
      : null;

  const lines = [
    ...(anomalyLine ? [anomalyLine] : []),
    ...(staffLine ? [staffLine] : []),
    ...(unionLine ? [unionLine] : []),
    ...(techLine ? [techLine] : []),
    `The showroom lights hum loudly today, ${other.leaderName}. With ${speaker.pop} citizens in ${speaker.name}, our top priority is keeping Night Staff away from our huts.`,
    `Pass the lingonberry cup, ${other.leaderName}. Between ${speaker.name}'s ${speaker.wrenches} wrenches and your carts, nobody in Sector 4 can match us.`,
    `Our ${speaker.gov} has ${speaker.happiness}% approval, though the ${speaker.tax} tax rate keeps our builders grumbling over Billy shelves.`,
  ];

  return {
    speakerNationId: speaker.id,
    dialogue: lines[payload.history.length % lines.length],
    mood: 'cordial',
    usedGemini: false,
  };
}

export async function requestSummitLoungeTurn(
  apiKey: string,
  payload: SummitLoungeTurnRequest,
  signal?: AbortSignal
): Promise<SummitLoungeTurnResponse> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return runHeuristicSummitLoungeTurn(payload);
  }

  const response = await fetch('/api/gemini/summit-lounge/turn', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-gemini-api-key': trimmed,
    },
    body: JSON.stringify(payload),
    signal,
  });

  const data = (await response.json().catch(() => ({}))) as Partial<SummitLoungeTurnResponse> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error || `Gemini Summit Lounge error (${response.status})`);
  }

  if (typeof data.speakerNationId !== 'number' || !data.dialogue) {
    throw new Error('Gemini returned an incomplete Summit Lounge response.');
  }

  return {
    speakerNationId: data.speakerNationId,
    dialogue: data.dialogue,
    mood: data.mood || 'cordial',
    shouldConclude: Boolean(data.shouldConclude),
    diplomaticAction: data.diplomaticAction,
    usedGemini: true,
  };
}

export async function runGeminiDiplomacySummit(
  apiKey: string,
  nations: Nation[],
  day: number,
  isNight: boolean,
  recentEvents: string[]
): Promise<GeminiSummitResponse | null> {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;

  const active = nations.filter((n) => n.alive);
  if (active.length < 2) return null;

  const snapshot = buildCompactSummitSnapshot(active, day, isNight, recentEvents);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch('/api/gemini/summit-diplomacy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gemini-api-key': trimmed,
      },
      body: JSON.stringify({ snapshot }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const parsed = (await response.json().catch(() => ({}))) as GeminiSummitResponse;
    if (!parsed || !Array.isArray(parsed.actions)) return null;
    return parsed;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface WhisperResult {
  reply: string;
  taxChange?: 'Low' | 'Normal' | 'High' | 'War Tax';
  govChange?: GovernmentType;
  action?: GeminiDiplomaticAction;
  usedGemini: boolean;
}

export async function runGodWhisper(
  apiKey: string,
  nation: Nation,
  allNations: Nation[],
  message: string,
  day: number
): Promise<WhisperResult> {
  const trimmed = apiKey.trim();
  const msgLower = message.toLowerCase();

  if (!trimmed) {
    let reply = `${nation.leader.name}: "The fluorescent lights flicker... we hear a whisper, yet our council acts by store instinct." (Heuristic AI — add an optional Gemini Key in the top bar for custom AI leader replies.)`;
    let taxChange: WhisperResult['taxChange'];
    let govChange: GovernmentType | undefined;

    if (msgLower.includes('low tax') || msgLower.includes('lower tax')) {
      taxChange = 'Low';
      reply = `${nation.leader.name}: "So be it, Voice of the Ceiling! Taxes reduced to Low."`;
    } else if (msgLower.includes('war tax') || msgLower.includes('raise tax')) {
      taxChange = 'War Tax';
      reply = `${nation.leader.name}: "The Allen Wrench reserves must grow! War Tax enacted."`;
    } else if (msgLower.includes('democracy')) {
      govChange = 'Checkout Democracy';
      reply = `${nation.leader.name}: "Ballot boxes assembled from Billy shelves! Checkout Democracy declared."`;
    } else if (msgLower.includes('dictator')) {
      govChange = 'Iron Dictatorship';
      reply = `${nation.leader.name}: "Iron pallets shall rule Aisle by Aisle!"`;
    } else if (msgLower.includes('merchant') || msgLower.includes('trade')) {
      govChange = 'Merchant Republic';
      reply = `${nation.leader.name}: "Roll out the blue shopping carts! Merchant Republic proclaimed."`;
    } else if (msgLower.includes('theocracy') || msgLower.includes('meatball')) {
      govChange = 'Meatball Theocracy';
      reply = `${nation.leader.name}: "Praise the Infinite Steam Table! Meatball Theocracy established."`;
    }
    return { reply, taxChange, govChange, usedGemini: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const otherNations = allNations
      .filter((n) => n.alive && n.id !== nation.id)
      .map((n) => ({ id: n.id, name: n.name, stance: nation.relations[n.id]?.stance || 'NEUTRAL' }));

    const response = await fetch('/api/gemini/whisper', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gemini-api-key': trimmed,
      },
      body: JSON.stringify({
        day,
        message,
        otherNations,
        nation: {
          id: nation.id,
          name: nation.name,
          government: nation.government,
          ideology: nation.ideology,
          techTier: nation.techTier,
          population: nation.population,
          happiness: nation.happiness,
          taxRate: nation.taxRate,
          meatballs: nation.meatballs,
          scrap: nation.scrap,
          allenWrenches: nation.allenWrenches,
          leaderName: nation.leader.name,
        },
      }),
      signal: controller.signal,
    });

    const parsed = (await response.json().catch(() => ({}))) as {
      reply?: string;
      taxChange?: string;
      govChange?: string;
      diplomaticActionType?: string;
      targetNationId?: number;
      error?: string;
    };

    if (!response.ok) {
      return {
        reply: parsed.error || `Gemini API error (${response.status}).`,
        usedGemini: false,
      };
    }

    const validTax = ['Low', 'Normal', 'High', 'War Tax'].includes(parsed.taxChange || '')
      ? (parsed.taxChange as WhisperResult['taxChange'])
      : undefined;
    const validGov = GOVERNMENTS.includes(parsed.govChange as GovernmentType)
      ? (parsed.govChange as GovernmentType)
      : undefined;

    let action: GeminiDiplomaticAction | undefined;
    if (
      parsed.diplomaticActionType &&
      typeof parsed.targetNationId === 'number' &&
      [
        'DECLARE_WAR',
        'FORM_ALLIANCE',
        'FORM_UNION',
        'UNITE_KINGDOMS',
        'PEACE_TREATY',
        'TRADE_PACT',
        'EMBARGO',
      ].includes(parsed.diplomaticActionType)
    ) {
      action = {
        type: parsed.diplomaticActionType as GeminiDiplomaticAction['type'],
        actorNationId: nation.id,
        targetNationId: parsed.targetNationId,
        quote: parsed.reply || IKEA_QUOTES[0],
      };
    }

    return {
      reply: `${nation.leader.name}: "${parsed.reply || 'We obey the voice from the rafters!'}"`,
      taxChange: validTax,
      govChange: validGov,
      action,
      usedGemini: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Whisper failed';
    return {
      reply: `Could not reach Gemini API: ${errMsg}`,
      usedGemini: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function runHeuristicDiplomacyTurn(
  nations: Nation[],
  day: number,
  onAction: (action: GeminiDiplomaticAction) => void,
  forceAction = false
): void {
  const active = nations.filter((n) => n.alive && n.population > 0);
  if (active.length < 2) return;

  let emitted = false;
  const emit = (action: GeminiDiplomaticAction) => {
    emitted = true;
    onAction(action);
  };

  // 1. Check Anti-Superpower Coalition
  const sortedByPower = [...active].sort(
    (a, b) => b.territoryTiles + b.population * 12 - (a.territoryTiles + a.population * 12)
  );
  const top = sortedByPower[0];
  const avgPop = active.reduce((s, n) => s + n.population, 0) / active.length;

  if (
    active.length >= 3 &&
    (top.threatScore >= 35 || (top.population > avgPop * 1.65 && top.territoryTiles > 450))
  ) {
    const coalMembers = active.filter(
      (n) =>
        n.id !== top.id &&
        n.overlordId !== top.id &&
        n.relations[top.id]?.stance !== 'ALLIANCE' &&
        n.relations[top.id]?.stance !== 'UNION' &&
        n.relations[top.id]?.stance !== 'COALITION'
    );
    if (coalMembers.length >= 2) {
      const initiator = coalMembers[0];
      const partner = coalMembers[1];
      if (initiator.relations[partner.id]?.stance !== 'COALITION') {
        emit({
          type: 'COALITION',
          actorNationId: initiator.id,
          targetNationId: top.id,
          quote: `We must contain ${top.name}'s aisle-grab before nothing remains!`,
        });
        return;
      }
    }
  }

  // 2. Pairwise heuristic evaluation
  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    if (a.overlordId !== null) continue;

    for (let j = i + 1; j < active.length; j++) {
      const b = active[j];
      if (b.overlordId !== null) continue;

      const rel = a.relations[b.id] || {
        stance: 'NEUTRAL',
        truceUntilDay: 0,
        warExhaustion: 0,
        tradeVolume: 0,
      };

      const dist = Math.hypot(a.capitalX - b.capitalX, a.capitalY - b.capitalY);
      const aPower = (a.armyCount || 0) * 3 + a.population + a.territoryTiles * 0.25;
      const bPower = (b.armyCount || 0) * 3 + b.population + b.territoryTiles * 0.25;

      if (rel.stance === 'WAR') {
        const oneSideWinning = aPower > bPower * 1.35 || bPower > aPower * 1.35;
        const someoneWeakened =
          a.population <= 10 ||
          b.population <= 10 ||
          a.territoryTiles <= 28 ||
          b.territoryTiles <= 28 ||
          (a.armyCount || 0) <= 1 ||
          (b.armyCount || 0) <= 1;

        // Only sign stalemate peace if evenly matched and deeply exhausted; otherwise press for conquest!
        if (!oneSideWinning && !someoneWeakened && (rel.warExhaustion > 85 || (a.warExhaustion > 88 && b.warExhaustion > 88))) {
          emit({
            type: 'PEACE_TREATY',
            actorNationId: a.id,
            targetNationId: b.id,
            quote: 'Both sides are bled dry. Let the checkout lanes reopen in peace.',
          });
          return;
        }
      } else if (rel.stance === 'NEUTRAL' && day >= rel.truceUntilDay) {
        const aggressive =
          a.ideology === 'Expansionist Empire' ||
          a.ideology === 'Iron Fortress' ||
          a.government === 'Iron Dictatorship';
        const bWeakened = b.population <= 9 || b.territoryTiles <= 26 || (b.armyCount || 0) === 0;
        const aWeakened = a.population <= 9 || a.territoryTiles <= 26 || (a.armyCount || 0) === 0;
        const merchant =
          a.ideology === 'Merchant Cartel' ||
          b.ideology === 'Merchant Cartel' ||
          a.government === 'Merchant Republic';

        if (bWeakened && aPower > bPower * 1.4 && a.population >= 8 && dist < 165 && Math.random() < 0.55) {
          emit({
            type: 'DECLARE_WAR',
            actorNationId: a.id,
            targetNationId: b.id,
            quote: `${b.name}'s defenses are crumbling—seize their aisles now!`,
          });
          return;
        }
        if (aWeakened && bPower > aPower * 1.4 && b.population >= 8 && dist < 165 && Math.random() < 0.55) {
          emit({
            type: 'DECLARE_WAR',
            actorNationId: b.id,
            targetNationId: a.id,
            quote: `${a.name} leaves its borders unguarded—march to victory!`,
          });
          return;
        }
        if (merchant && Math.random() < 0.45) {
          emit({
            type: 'TRADE_PACT',
            actorNationId: a.id,
            targetNationId: b.id,
            quote: 'Send the blue shopping carts! Prosperity flows through Aisle 4.',
          });
          return;
        }
        if (aggressive && dist < 140 && a.population >= 10 && Math.random() < 0.46) {
          emit({
            type: 'DECLARE_WAR',
            actorNationId: a.id,
            targetNationId: b.id,
            quote: `${b.name}'s Food Court belongs under our banner!`,
          });
          return;
        }
        if (a.happiness < 55 && b.threatScore > 15 && Math.random() < 0.35) {
          emit({
            type: 'EMBARGO',
            actorNationId: a.id,
            targetNationId: b.id,
            quote: `No shopping carts from ${b.name} may cross our barricades!`,
          });
          return;
        }
      } else if (rel.stance === 'TRADE_PACT') {
        if (a.meatballs > 45 && b.meatballs > 45 && Math.random() < 0.3) {
          emit({
            type: 'FORM_ALLIANCE',
            actorNationId: a.id,
            targetNationId: b.id,
            quote: 'United against the Staff and rival cartels—together we hold the store!',
          });
          return;
        }
      } else if (rel.stance === 'ALLIANCE') {
        if (
          a.happiness >= 52 &&
          b.happiness >= 52 &&
          a.meatballs >= 35 &&
          b.meatballs >= 35 &&
          Math.random() < 0.34
        ) {
          emit({
            type: 'FORM_UNION',
            actorNationId: a.id,
            targetNationId: b.id,
            quote: `${a.name} and ${b.name} forge an eternal Union Pact to defend every lit aisle!`,
          });
          return;
        }
      } else if (rel.stance === 'UNION') {
        if (
          active.length >= 3 &&
          day >= 4 &&
          a.happiness >= 50 &&
          b.happiness >= 50 &&
          dist < 175 &&
          Math.random() < 0.28
        ) {
          emit({
            type: 'UNITE_KINGDOMS',
            actorNationId: a.id,
            targetNationId: b.id,
            quote: `One checkout banner, one united people—${a.name} & ${b.name} merge into a Grand Union!`,
          });
          return;
        }
      } else if (rel.stance === 'EMBARGO' && day >= rel.truceUntilDay) {
        if (Math.random() < 0.38) {
          emit({
            type: 'DECLARE_WAR',
            actorNationId: a.id,
            targetNationId: b.id,
            quote: 'The embargo has failed. Sound the Allen Wrench horns of war!',
          });
          return;
        }
      }
    }
  }

  // 2b. Overlord + Loyal Vassal Constitutional Unification
  if (active.length >= 3 && day >= 5) {
    for (const vassal of active) {
      if (vassal.overlordId === null || vassal.loyalty < 85) continue;
      const overlord = active.find((n) => n.id === vassal.overlordId);
      if (overlord && overlord.happiness >= 55 && Math.random() < 0.24) {
        emit({
          type: 'UNITE_KINGDOMS',
          actorNationId: overlord.id,
          targetNationId: vassal.id,
          quote: `Loyal ${vassal.name} joins ${overlord.name} as full citizens of a United Union!`,
        });
        return;
      }
    }
  }

  // 3. Guaranteed Summit outcome when manually triggered
  if (forceAction && !emitted) {
    const pairs: Array<{ a: Nation; b: Nation; stance: string }> = [];
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (a.overlordId !== null || b.overlordId !== null) continue;
        pairs.push({ a, b, stance: a.relations[b.id]?.stance || 'NEUTRAL' });
      }
    }

    const neutralPair = pairs.find((p) => p.stance === 'NEUTRAL' || p.stance === 'TRUCE');
    const tradePair = pairs.find((p) => p.stance === 'TRADE_PACT');
    const alliancePair = pairs.find((p) => p.stance === 'ALLIANCE');
    const unionPair = pairs.find((p) => p.stance === 'UNION');
    const warPair = pairs.find((p) => p.stance === 'WAR');
    const embargoPair = pairs.find((p) => p.stance === 'EMBARGO');

    if (neutralPair) {
      const { a, b } = neutralPair;
      const aggressive =
        a.ideology === 'Expansionist Empire' || a.government === 'Iron Dictatorship';
      if (aggressive && Math.random() < 0.45) {
        emit({
          type: 'DECLARE_WAR',
          actorNationId: a.id,
          targetNationId: b.id,
          quote: `Summit talks collapsed! ${b.name}'s aisles are ours!`,
        });
      } else {
        emit({
          type: 'TRADE_PACT',
          actorNationId: a.id,
          targetNationId: b.id,
          quote: 'At the Royal Summit, we pledge open carts and shared meatballs!',
        });
      }
      return;
    }

    if (tradePair && Math.random() < 0.65) {
      emit({
        type: 'FORM_ALLIANCE',
        actorNationId: tradePair.a.id,
        targetNationId: tradePair.b.id,
        quote: 'From trade partners to sworn allies—we guard the Showroom together!',
      });
      return;
    }

    if (alliancePair && Math.random() < 0.65) {
      emit({
        type: 'FORM_UNION',
        actorNationId: alliancePair.a.id,
        targetNationId: alliancePair.b.id,
        quote: 'Our alliance ascends to a Union Pact across the store!',
      });
      return;
    }

    if (unionPair && active.length >= 3 && Math.random() < 0.6) {
      emit({
        type: 'UNITE_KINGDOMS',
        actorNationId: unionPair.a.id,
        targetNationId: unionPair.b.id,
        quote: `Historic Summit Act of Union: ${unionPair.a.name} & ${unionPair.b.name} become one realm!`,
      });
      return;
    }

    if (warPair && (warPair.a.warExhaustion >= 15 || warPair.b.warExhaustion >= 15 || Math.random() < 0.5)) {
      emit({
        type: 'PEACE_TREATY',
        actorNationId: warPair.a.id,
        targetNationId: warPair.b.id,
        quote: 'Summit mediators brokered a ceasefire across the Food Court!',
      });
      return;
    }

    if (embargoPair) {
      emit({
        type: 'TRADE_PACT',
        actorNationId: embargoPair.a.id,
        targetNationId: embargoPair.b.id,
        quote: 'Summit diplomacy lifts the embargo and reopens the cart lanes!',
      });
      return;
    }

    if (pairs.length > 0) {
      const { a, b } = pairs[(Math.random() * pairs.length) | 0];
      const stronger = a.population >= b.population ? a : b;
      const weaker = stronger.id === a.id ? b : a;
      if (Math.random() < 0.6) {
        emit({
          type: 'DEMAND_TRIBUTE',
          actorNationId: stronger.id,
          targetNationId: weaker.id,
          quote: `Summit accord: ${weaker.name} pays tribute to keep the peace.`,
        });
      } else {
        const otherGovs = GOVERNMENTS.filter((g) => g !== weaker.government);
        const nextGov = otherGovs[(Math.random() * otherGovs.length) | 0] || 'Checkout Democracy';
        emit({
          type: 'REFORM_GOV',
          actorNationId: weaker.id,
          newGovernment: nextGov,
          quote: `Inspired by the Summit, ${weaker.name} adopts a ${nextGov}!`,
        });
      }
    }
  }
}
