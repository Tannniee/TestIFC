/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** A bounded input-processing gap after expensive continuous frames. Ordinary
 * frames run at the next available rAF; idle effects never train a moving-frame
 * EMA or leave subsequent gestures stuck in a 25/33 ms hysteresis tier. */
export class InteractionRenderBudget {
  private nextRenderAt = 0;
  intervalMs = 0;

  shouldRender(frameAt: number, continuous: boolean): boolean {
    return !continuous || frameAt >= this.nextRenderAt;
  }

  rendered(frameAt: number, renderMs: number, continuous: boolean): void {
    const recoveryMs = continuous && renderMs > 32 ? Math.min(8, (renderMs - 32) / 4) : 0;
    this.intervalMs = recoveryMs > 0 ? renderMs + recoveryMs : 0;
    this.nextRenderAt = recoveryMs > 0 ? frameAt + this.intervalMs : 0;
  }
}
