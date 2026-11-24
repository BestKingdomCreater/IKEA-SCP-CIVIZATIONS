import React, { useEffect, useRef, useState } from 'react';
import { GRID_H, GRID_W, SUMMIT_X, SUMMIT_Y, TILE_SIZE } from '../game/constants';
import { SimEngine } from '../game/engine';
import { CHUNK_H, CHUNK_W } from '../game/infiniteWorld';

interface MinimapProps {
  engineRef: React.RefObject<SimEngine | null>;
  viewSize: { w: number; h: number };
}

export const Minimap: React.FC<MinimapProps> = ({ engineRef, viewSize }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const [sectorLabel, setSectorLabel] = useState<string | null>(null);

  useEffect(() => {
    let raf = 0;
    let frameCounter = 0;
    const draw = () => {
      frameCounter++;
      if (frameCounter % 3 !== 1) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const c = canvasRef.current;
      const eng = engineRef.current;
      if (c && eng) {
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(eng.minimapCanvas, 0, 0, c.width, c.height);

          const tileToX = c.width / GRID_W;
          const tileToY = c.height / GRID_H;

          // Active war front lines & markers (only when at least one side is near window)
          const drawnWars = new Set<string>();
          for (const a of eng.nations) {
            if (!a.alive) continue;
            for (const b of eng.nations) {
              if (!b.alive || a.id >= b.id) continue;
              if (eng.getStance(a.id, b.id) !== 'WAR') continue;
              const key = `${a.id}-${b.id}`;
              if (drawnWars.has(key)) continue;
              drawnWars.add(key);

              const aIn = a.capitalX >= -15 && a.capitalX <= GRID_W + 15 && a.capitalY >= -15 && a.capitalY <= GRID_H + 15;
              const bIn = b.capitalX >= -15 && b.capitalX <= GRID_W + 15 && b.capitalY >= -15 && b.capitalY <= GRID_H + 15;
              if (!aIn && !bIn) continue;

              const ax = a.capitalX * tileToX;
              const ay = a.capitalY * tileToY;
              const bx = b.capitalX * tileToX;
              const by = b.capitalY * tileToY;

              ctx.save();
              ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
              ctx.lineWidth = 1;
              ctx.setLineDash([2, 2]);
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              ctx.stroke();
              ctx.setLineDash([]);

              const mx = Math.max(3, Math.min(c.width - 3, (ax + bx) * 0.5));
              const my = Math.max(3, Math.min(c.height - 3, (ay + by) * 0.5));
              ctx.strokeStyle = '#fb7185';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(mx - 2.5, my - 2.5);
              ctx.lineTo(mx + 2.5, my + 2.5);
              ctx.moveTo(mx + 2.5, my - 2.5);
              ctx.lineTo(mx - 2.5, my + 2.5);
              ctx.stroke();
              ctx.restore();
            }
          }

          // Neutral Summit Lounge gold diamond marker (edge-clamped if off-window)
          const summitLocalX = SUMMIT_X - eng.originTx;
          const summitLocalY = SUMMIT_Y - eng.originTy;
          const sx = Math.max(4, Math.min(c.width - 4, summitLocalX * tileToX));
          const sy = Math.max(4, Math.min(c.height - 4, summitLocalY * tileToY));
          ctx.fillStyle = '#ffda1a';
          ctx.strokeStyle = '#090c12';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, sy - 3);
          ctx.lineTo(sx + 3, sy);
          ctx.lineTo(sx, sy + 3);
          ctx.lineTo(sx - 3, sy);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Alive nation capital markers (edge-clamped diamond beacon if off-window)
          for (const n of eng.nations) {
            if (!n.alive) continue;
            const inWin =
              n.capitalX >= 0 &&
              n.capitalX < GRID_W &&
              n.capitalY >= 0 &&
              n.capitalY < GRID_H;
            if (inWin) {
              const cx = Math.round(n.capitalX * tileToX);
              const cy = Math.round(n.capitalY * tileToY);
              ctx.fillStyle = '#090c12';
              ctx.fillRect(cx - 2, cy - 2, 5, 5);
              ctx.fillStyle = n.color;
              ctx.fillRect(cx - 1, cy - 1, 3, 3);
            } else {
              const ex = Math.max(3, Math.min(c.width - 3, Math.round(n.capitalX * tileToX)));
              const ey = Math.max(3, Math.min(c.height - 3, Math.round(n.capitalY * tileToY)));
              ctx.fillStyle = '#090c12';
              ctx.fillRect(ex - 2, ey - 2, 4, 4);
              ctx.fillStyle = n.color;
              ctx.fillRect(ex - 1, ey - 1, 2, 2);
            }
          }

          // Draw camera viewport box
          const scaleX = c.width / (GRID_W * TILE_SIZE);
          const scaleY = c.height / (GRID_H * TILE_SIZE);
          const vw = (viewSize.w / eng.camera.zoom) * scaleX;
          const vh = (viewSize.h / eng.camera.zoom) * scaleY;
          const vx = eng.camera.x * scaleX - vw * 0.5;
          const vy = eng.camera.y * scaleY - vh * 0.5;

          ctx.strokeStyle = '#ffda1a';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(vx, vy, vw, vh);

          if (frameCounter % 12 === 1) {
            if (eng.infiniteWorldMode) {
              const secX = Math.round(eng.originTx / CHUNK_W);
              const secY = Math.round(eng.originTy / CHUNK_H);
              setSectorLabel(`∞ ${secX},${secY}`);
            } else {
              setSectorLabel(null);
            }
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engineRef, viewSize]);

  const panToClientPos = (clientX: number, clientY: number) => {
    const c = canvasRef.current;
    const eng = engineRef.current;
    if (!c || !eng) return;
    const rect = c.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    eng.camera.x = nx * GRID_W * TILE_SIZE;
    eng.camera.y = ny * GRID_H * TILE_SIZE;
    eng.updateCameraAndStream();
  };

  return (
    <div className="pointer-events-auto relative rounded-lg overflow-hidden border border-slate-700/90 bg-[#0d1117]/90 shadow-lg">
      <canvas
        ref={canvasRef}
        width={160}
        height={120}
        className="w-[124px] h-[93px] sm:w-[160px] sm:h-[120px] block cursor-crosshair touch-canvas-surface"
        onPointerDown={(e) => {
          e.stopPropagation();
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          panToClientPos(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          e.stopPropagation();
          panToClientPos(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
      />
      {sectorLabel && (
        <div className="pointer-events-none absolute top-1 left-1 px-1.5 py-0.5 rounded bg-[#090c12]/80 border border-cyan-500/40 text-[9px] font-mono-tabular text-cyan-300">
          {sectorLabel}
        </div>
      )}
    </div>
  );
};
