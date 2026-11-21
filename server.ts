import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GOVERNMENTS = [
  'Checkout Democracy',
  'Iron Dictatorship',
  'Merchant Republic',
  'Meatball Theocracy',
] as const;

const DIPLOMATIC_ACTIONS = [
  'DECLARE_WAR',
  'FORM_ALLIANCE',
  'PEACE_TREATY',
  'TRADE_PACT',
  'DEMAND_TRIBUTE',
  'VASSALIZE',
  'EMBARGO',
  'COALITION',
  'REFORM_GOV',
] as const;

interface SummitNationInput {
  id: number;
  name: string;
  gov: string;
  ideology: string;
  techTier: number;
  pop: number;
  meatballs: number;
  scrap: number;
  wrenches: number;
  happiness: number;
  tax: string;
  threat: number;
  leaderName: string;
  leaderTraits: string[];
  seated?: boolean;
  relations: Array<{
    withId: number;
    withName: string;
    stance: string;
  }>;
}

interface SummitHistoryEntry {
  speakerNationId: number;
  speakerName: string;
  nationName: string;
  text: string;
  mood?: string;
}

function getGeminiClientFromRequest(req: Request): GoogleGenAI | null {
  const headerKey = req.header('x-gemini-api-key')?.trim();
  if (!headerKey) return null;
  return new GoogleGenAI({
    apiKey: headerKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractApiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      message: 'Gemini API permission denied (403). Please verify your API key in Settings > Secrets.',
    };
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('API key not valid') || raw.includes('400')) {
    return {
      status: 400,
      message: 'Invalid Gemini API key or request (400). Please check Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message: 'Gemini API rate limit reached (429). Please wait a moment and retry.',
    };
  }
  if (raw.includes('NOT_FOUND') || raw.includes('404')) {
    return {
      status: 404,
      message: 'Requested Gemini model was not found (404).',
    };
  }
  return {
    status: 500,
    message: raw.slice(0, 220) || 'Gemini API request failed.',
  };
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('timed out')) {
      await new Promise((r) => setTimeout(r, 650));
      return await fn();
    }
    throw err;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/gemini/test-key', async (req: Request, res: Response) => {
    const ai = getGeminiClientFromRequest(req);
    if (!ai) {
      res.status(400).json({ ok: false, message: 'Please enter a Gemini API key first.' });
      return;
    }
    try {
      const result = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: 'Respond with exactly: READY',
        })
      );
      if (result.text) {
        res.json({
          ok: true,
          message: 'Key verified. Gemini Summit Lounge & God Whisper active for your browser session.',
        });
        return;
      }
      res.status(500).json({ ok: false, message: 'Key responded with empty output.' });
    } catch (err) {
      const { status, message } = extractApiError(err);
      res.status(status).json({ ok: false, message });
    }
  });

  // 1. Live Summit Lounge Conversation Turn (<= 5 min seated leaders discussion)
  app.post('/api/gemini/summit-lounge/turn', async (req: Request, res: Response) => {
    const ai = getGeminiClientFromRequest(req);
    if (!ai) {
      res.status(401).json({
        error: 'No Gemini API key provided. Click "Add Gemini Key" in the top bar to use your own key.',
      });
      return;
    }

    const body = req.body as {
      day?: number;
      isNight?: boolean;
      nations?: SummitNationInput[];
      history?: SummitHistoryEntry[];
      topic?: string;
      remainingSec?: number;
      totalDurationSec?: number;
      isClosing?: boolean;
      recentEvents?: string[];
    };

    const nations = Array.isArray(body.nations) ? body.nations : [];
    if (nations.length < 2) {
      res.status(400).json({ error: 'At least two living nations are required for a Summit Lounge talk.' });
      return;
    }

    const history = Array.isArray(body.history) ? body.history.slice(-14) : [];
    const lastSpeakerId = history.length > 0 ? history[history.length - 1].speakerNationId : null;
    const validIds = new Set(nations.map((n) => n.id));
    const remainingSec = Math.max(0, Math.min(300, Math.round(body.remainingSec ?? 180)));
    const totalDurationSec = Math.max(30, Math.min(300, Math.round(body.totalDurationSec ?? 300)));
    const isClosing = Boolean(body.isClosing || remainingSec <= 12);

    const prompt = `You are orchestrating a live roundtable Summit Lounge conversation inside SCP-3008 (The Infinite IKEA).
The nation leaders have walked to the Neutral Showroom Lounge and are sitting down on showroom couches around a coffee table to talk directly with one another.

Current Store State (Day ${body.day ?? 1}, ${body.isNight ? 'Store Closed / Spotlights On' : 'Store Open'}):
Remaining Summit Time: ${remainingSec}s of ${totalDurationSec}s max (session limit <= 5 minutes).
${isClosing ? 'CLOSING TURN: Time is nearly up. The speaking leader should deliver a concise closing remark or final deal/ultimatum to conclude the lounge talk.' : ''}
${body.topic?.trim() ? `Moderator / Cosmic Voice Topic: "${body.topic.trim()}"` : ''}
Recent Store Events: ${JSON.stringify((body.recentEvents || []).slice(0, 5))}

Seated Nations & Leaders:
${JSON.stringify(nations, null, 2)}

Recent Lounge Transcript:
${history.length === 0 ? '(The leaders have just sat down on the showroom couches. Start the conversation.)' : history.map((h) => `${h.speakerName} (${h.nationName}): "${h.text}"`).join('\n')}

Instructions:
1. Pick speakerNationId from [${nations.map((n) => n.id).join(', ')}] — prefer a different leader from the last speaker (${lastSpeakerId ?? 'none'}) so the leaders actually converse back-and-forth.
2. Write 1 to 3 natural, witty, darkly comedic yet politically sharp sentences in-character as that leader addressing the other seated leaders by name or nation. Reference real IKEA survival details (meatballs, Allen wrenches, Billy shelves, shopping carts, Night Staff, spotlights, current wars or trade pacts).
3. If the conversation naturally calls for a concrete diplomatic breakthrough or breakdown right now (and not on every turn—only when earned by the dialogue), include diplomaticAction using ONLY valid nation IDs from the seated list and allowed types: ${DIPLOMATIC_ACTIONS.join(', ')}. For REFORM_GOV, newGovernment must be one of: ${GOVERNMENTS.join(', ')}.
4. Set shouldConclude to true ONLY if this is a closing turn or the leaders have clearly wrapped up all business early.`;

    try {
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction:
              'You write vivid, characterful multi-leader diplomatic dialogue set in an SCP-3008 Infinite IKEA showroom lounge. Always respond with valid JSON matching the schema.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                speakerNationId: {
                  type: Type.INTEGER,
                  description: 'Nation ID of the leader speaking this turn.',
                },
                dialogue: {
                  type: Type.STRING,
                  description: '1 to 3 spoken sentences in character.',
                },
                mood: {
                  type: Type.STRING,
                  description: 'One of: cordial, tense, scheming, jovial, urgent',
                },
                shouldConclude: {
                  type: Type.BOOLEAN,
                  description: 'True if the summit talk has reached a natural conclusion.',
                },
                diplomaticAction: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    actorNationId: { type: Type.INTEGER },
                    targetNationId: { type: Type.INTEGER },
                    newGovernment: { type: Type.STRING },
                    quote: { type: Type.STRING },
                  },
                  required: ['type', 'actorNationId', 'quote'],
                },
              },
              required: ['speakerNationId', 'dialogue', 'mood'],
            },
          },
        })
      );

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as {
        speakerNationId?: number;
        dialogue?: string;
        mood?: string;
        shouldConclude?: boolean;
        diplomaticAction?: {
          type?: string;
          actorNationId?: number;
          targetNationId?: number;
          newGovernment?: string;
          quote?: string;
        };
      };

      let speakerNationId = Number(parsed.speakerNationId);
      if (!validIds.has(speakerNationId)) {
        const fallback = nations.find((n) => n.id !== lastSpeakerId) || nations[0];
        speakerNationId = fallback.id;
      }

      const allowedMoods = ['cordial', 'tense', 'scheming', 'jovial', 'urgent'];
      const mood = allowedMoods.includes((parsed.mood || '').toLowerCase())
        ? (parsed.mood || 'cordial').toLowerCase()
        : 'cordial';

      let diplomaticAction:
        | {
            type: string;
            actorNationId: number;
            targetNationId?: number;
            newGovernment?: string;
            quote: string;
          }
        | undefined;

      const actionObj = parsed.diplomaticAction;
      const actionType = actionObj?.type;
      if (
        actionObj &&
        actionType &&
        DIPLOMATIC_ACTIONS.includes(actionType as (typeof DIPLOMATIC_ACTIONS)[number]) &&
        validIds.has(Number(actionObj.actorNationId))
      ) {
        const targetId = actionObj.targetNationId;
        const hasValidTarget =
          typeof targetId === 'number' &&
          validIds.has(targetId) &&
          targetId !== Number(actionObj.actorNationId);

        if (actionType === 'REFORM_GOV') {
          if (GOVERNMENTS.includes(actionObj.newGovernment as (typeof GOVERNMENTS)[number])) {
            diplomaticAction = {
              type: 'REFORM_GOV',
              actorNationId: Number(actionObj.actorNationId),
              newGovernment: actionObj.newGovernment,
              quote: actionObj.quote || parsed.dialogue || 'The council reforms!',
            };
          }
        } else if (hasValidTarget) {
          diplomaticAction = {
            type: actionType,
            actorNationId: Number(actionObj.actorNationId),
            targetNationId: targetId,
            quote: actionObj.quote || parsed.dialogue || 'Accord reached at the Lounge.',
          };
        }
      }

      res.json({
        speakerNationId,
        dialogue: (parsed.dialogue || '').trim() || 'Let us keep the meatballs warm and the carts moving.',
        mood,
        shouldConclude: Boolean(parsed.shouldConclude),
        diplomaticAction,
      });
    } catch (err) {
      const { status, message } = extractApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 2. Daily Storewide Automated Diplomacy Summit
  app.post('/api/gemini/summit-diplomacy', async (req: Request, res: Response) => {
    const ai = getGeminiClientFromRequest(req);
    if (!ai) {
      res.status(401).json({
        error: 'No Gemini API key provided.',
      });
      return;
    }

    const { snapshot } = req.body as { snapshot?: unknown };
    if (!snapshot) {
      res.status(400).json({ error: 'Missing world snapshot.' });
      return;
    }

    const prompt = `You are the grand-strategy diplomacy AI for SCP-3008 (The Infinite IKEA).
Analyze this compact world snapshot and return 1 to 3 diplomatic or political actions that make sense for the factions' ideologies, happiness, threat scores, resources, and wars, along with funny in-character IKEA-themed quotes.
Only use valid nation IDs present in the snapshot.
Allowed action types: ${DIPLOMATIC_ACTIONS.join(', ')}.
For REFORM_GOV, set newGovernment to one of: ${GOVERNMENTS.join(', ')}.

Snapshot JSON:
${JSON.stringify(snapshot)}`;

    try {
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction:
              'Output concise, valid JSON matching the schema. Keep quotes punchy (under 18 words) and darkly comedic in SCP-3008 IKEA style.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                headline: {
                  type: Type.STRING,
                  description: 'Short storewide diplomatic summit summary.',
                },
                actions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: { type: Type.STRING },
                      actorNationId: { type: Type.INTEGER },
                      targetNationId: { type: Type.INTEGER },
                      newGovernment: { type: Type.STRING },
                      quote: { type: Type.STRING },
                    },
                    required: ['type', 'actorNationId', 'quote'],
                  },
                },
              },
              required: ['actions'],
            },
          },
        })
      );

      const raw = (response.text ?? '{}').trim();
      const parsed = JSON.parse(raw);
      res.json(parsed);
    } catch (err) {
      const { status, message } = extractApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 3. God Whisper to Nation Leader
  app.post('/api/gemini/whisper', async (req: Request, res: Response) => {
    const ai = getGeminiClientFromRequest(req);
    if (!ai) {
      res.status(401).json({
        error: 'No Gemini API key provided.',
      });
      return;
    }

    const { nation, otherNations, message, day } = req.body as {
      nation?: {
        id: number;
        name: string;
        government: string;
        ideology: string;
        techTier: number;
        population: number;
        happiness: number;
        taxRate: string;
        meatballs: number;
        scrap: number;
        allenWrenches: number;
        leaderName: string;
      };
      otherNations?: Array<{ id: number; name: string; stance: string }>;
      message?: string;
      day?: number;
    };

    if (!nation || !message?.trim()) {
      res.status(400).json({ error: 'Nation and whisper message are required.' });
      return;
    }

    const prompt = `A cosmic God inside SCP-3008 (The Infinite IKEA) whispers to ${nation.leaderName}, leader of ${nation.name}.
Nation State (Day ${day ?? 1}):
- Government: ${nation.government}, Ideology: ${nation.ideology}, Tech Tier: ${nation.techTier}
- Pop: ${nation.population}, Happiness: ${Math.round(nation.happiness)}%, Tax: ${nation.taxRate}
- Stocks: Meatballs ${Math.round(nation.meatballs)}, Scrap ${Math.round(nation.scrap)}, Allen Wrenches ${Math.round(nation.allenWrenches)}
- Neighbors: ${JSON.stringify(otherNations || [])}
God's Whisper: "${message.trim()}"

Respond in character (1-2 sentences) and optionally adjust taxRate, newGovernment, or trigger one diplomatic action toward a neighbor.`;

    try {
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: { type: Type.STRING },
                taxChange: {
                  type: Type.STRING,
                  description: 'Optional: Low, Normal, High, or War Tax',
                },
                govChange: {
                  type: Type.STRING,
                  description:
                    'Optional: Checkout Democracy, Iron Dictatorship, Merchant Republic, or Meatball Theocracy',
                },
                diplomaticActionType: {
                  type: Type.STRING,
                  description:
                    'Optional: DECLARE_WAR, FORM_ALLIANCE, PEACE_TREATY, TRADE_PACT, EMBARGO',
                },
                targetNationId: { type: Type.INTEGER },
              },
              required: ['reply'],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const { status, message: errMsg } = extractApiError(err);
      res.status(status).json({ error: errMsg });
    }
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`SCP-3008 server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
