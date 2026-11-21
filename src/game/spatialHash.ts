import { GRID_H, GRID_W, HASH_CELLS, HASH_H, HASH_W, MAX_UNITS_LIMIT, SPATIAL_CELL } from './constants';
import { Unit } from './types';

/**
 * Zero-allocation linked-list spatial hash grid backed by typed arrays.
 * Supports 3,500+ units at 60 FPS with zero GC churn per tick.
 */
export class SpatialHashGrid {
  private head = new Int32Array(HASH_CELLS);
  private next = new Int32Array(MAX_UNITS_LIMIT + 16);

  constructor() {
    this.head.fill(-1);
    this.next.fill(-1);
  }

  public clear(): void {
    this.head.fill(-1);
  }

  public rebuild(units: Unit[]): void {
    this.head.fill(-1);
    const len = units.length;
    if (len > this.next.length) {
      this.next = new Int32Array(len + 256);
    }
    for (let i = 0; i < len; i++) {
      const u = units[i];
      if (!u.alive) continue;
      const cx = Math.max(0, Math.min(HASH_W - 1, (u.x / SPATIAL_CELL) | 0));
      const cy = Math.max(0, Math.min(HASH_H - 1, (u.y / SPATIAL_CELL) | 0));
      const cellIdx = cy * HASH_W + cx;
      this.next[i] = this.head[cellIdx];
      this.head[cellIdx] = i;
    }
  }

  public queryRadius(
    units: Unit[],
    x: number,
    y: number,
    radius: number,
    callback: (unit: Unit, index: number, distSq: number) => void
  ): void {
    const minCx = Math.max(0, ((Math.max(0, x - radius)) / SPATIAL_CELL) | 0);
    const maxCx = Math.min(HASH_W - 1, ((Math.min(GRID_W - 1, x + radius)) / SPATIAL_CELL) | 0);
    const minCy = Math.max(0, ((Math.max(0, y - radius)) / SPATIAL_CELL) | 0);
    const maxCy = Math.min(HASH_H - 1, ((Math.min(GRID_H - 1, y + radius)) / SPATIAL_CELL) | 0);
    const rSq = radius * radius;

    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowOffset = cy * HASH_W;
      for (let cx = minCx; cx <= maxCx; cx++) {
        let idx = this.head[rowOffset + cx];
        while (idx !== -1) {
          const u = units[idx];
          if (u && u.alive) {
            const dx = u.x - x;
            const dy = u.y - y;
            const dSq = dx * dx + dy * dy;
            if (dSq <= rSq) {
              callback(u, idx, dSq);
            }
          }
          idx = this.next[idx];
        }
      }
    }
  }
}
