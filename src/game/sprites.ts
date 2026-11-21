/**
 * Pre-rendered offscreen radial-gradient glow sprites.
 * Zero ctx.shadowBlur usage anywhere in the codebase for locked 60 FPS on iPad/iPhone Safari.
 */
export interface GlowSprites {
  spotlightDay: HTMLCanvasElement;
  spotlightNight: HTMLCanvasElement;
  watchtowerNight: HTMLCanvasElement;
  foodGlow: HTMLCanvasElement;
  fireGlow: HTMLCanvasElement;
  feverGlow: HTMLCanvasElement;
  meatballGlow: HTMLCanvasElement;
}

function makeRadialSprite(
  size: number,
  stops: Array<[number, string]>
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (const [offset, color] of stops) {
    grad.addColorStop(offset, color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return c;
}

let cachedSprites: GlowSprites | null = null;

export function getGlowSprites(): GlowSprites {
  if (cachedSprites) return cachedSprites;
  cachedSprites = {
    spotlightDay: makeRadialSprite(128, [
      [0, 'rgba(254, 240, 138, 0.22)'],
      [0.5, 'rgba(253, 224, 71, 0.08)'],
      [1, 'rgba(253, 224, 71, 0)'],
    ]),
    spotlightNight: makeRadialSprite(256, [
      [0, 'rgba(254, 243, 199, 0.72)'],
      [0.35, 'rgba(253, 224, 71, 0.42)'],
      [0.7, 'rgba(250, 204, 21, 0.16)'],
      [1, 'rgba(250, 204, 21, 0)'],
    ]),
    watchtowerNight: makeRadialSprite(192, [
      [0, 'rgba(253, 230, 138, 0.52)'],
      [0.5, 'rgba(251, 191, 36, 0.18)'],
      [1, 'rgba(251, 191, 36, 0)'],
    ]),
    foodGlow: makeRadialSprite(96, [
      [0, 'rgba(251, 191, 36, 0.30)'],
      [0.6, 'rgba(245, 158, 11, 0.10)'],
      [1, 'rgba(245, 158, 11, 0)'],
    ]),
    fireGlow: makeRadialSprite(64, [
      [0, 'rgba(251, 146, 60, 0.65)'],
      [0.5, 'rgba(239, 68, 68, 0.25)'],
      [1, 'rgba(239, 68, 68, 0)'],
    ]),
    feverGlow: makeRadialSprite(96, [
      [0, 'rgba(244, 63, 94, 0.35)'],
      [0.6, 'rgba(244, 63, 94, 0.10)'],
      [1, 'rgba(244, 63, 94, 0)'],
    ]),
    meatballGlow: makeRadialSprite(96, [
      [0, 'rgba(180, 83, 9, 0.45)'],
      [0.6, 'rgba(245, 158, 11, 0.15)'],
      [1, 'rgba(245, 158, 11, 0)'],
    ]),
  };
  return cachedSprites;
}
