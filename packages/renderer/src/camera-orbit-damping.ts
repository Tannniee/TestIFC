/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Spend the actual pointer displacement over frames, without inventing momentum.
 * Time-based decay keeps the same response on 60 Hz and 240 Hz displays. */
export class OrbitDamping {
  private x = 0;
  private y = 0;
  timeConstantMs = 60;

  add(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.x += x;
    this.y += y;
  }

  clear(): void { this.x = 0; this.y = 0; }

  step(deltaMs: number, apply: (x: number, y: number) => boolean): boolean {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0 || (this.x === 0 && this.y === 0)) return false;
    const fraction = Math.hypot(this.x, this.y) < .01 ? 1 : -Math.expm1(-Math.min(deltaMs, 100) / this.timeConstantMs);
    const x = this.x * fraction, y = this.y * fraction;
    if (!apply(x, y)) { this.clear(); return false; }
    this.x -= x;
    this.y -= y;
    return true;
  }
}
