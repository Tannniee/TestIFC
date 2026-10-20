/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Preserve exhaustive pick tie priority without scanning unrelated entities. */
export class PickOrderMap<V> extends Map<number, V> {
  private readonly ranks = new Map<number, number>();
  private nextRank = 0;

  constructor(entries?: Iterable<readonly [number, V]>) {
    super();
    if (entries) for (const [id, value] of entries) this.set(id, value);
  }

  override set(id: number, value: V): this {
    if (!this.has(id)) this.ranks.set(id, this.nextRank++);
    return super.set(id, value);
  }

  override delete(id: number): boolean {
    this.ranks.delete(id);
    return super.delete(id);
  }

  override clear(): void {
    super.clear();
    this.ranks.clear();
    this.nextRank = 0;
  }

  /** Undefined retains the exhaustive path; a supplied set retains map order. */
  orderedCandidates(ids?: ReadonlySet<number>): Set<number> | undefined {
    if (!ids) return undefined;
    return new Set([...ids].filter(id => this.has(id)).sort((a, b) =>
      this.ranks.get(a)! - this.ranks.get(b)!));
  }
}
