/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type GeometryStagingAllocator = (lane: 'vertices' | 'indices', bytes: number) => ArrayBuffer;

/** CPU scratch only: writeBuffer captures its data before returning. These
 * buffers never escape a synchronous batch upload or back any source meshes.
 * The retention limit bounds scratch memory, not model size or fidelity. */
export class GeometryStagingPool {
  private vertices = new ArrayBuffer(0);
  private indices = new ArrayBuffer(0);
  private inUse = false;
  constructor(private readonly maxLaneBytes = 16 * 1024 * 1024) {}

  use<T>(work: (allocate: GeometryStagingAllocator) => T): T {
    // A reentrant upload cannot overwrite its caller's staging.
    if (this.inUse) return work((_lane, bytes) => new ArrayBuffer(bytes));
    this.inUse = true;
    try {
      return work((lane, bytes) => {
        if (bytes > this.maxLaneBytes) return new ArrayBuffer(bytes);
        if (this[lane].byteLength < bytes) {
          this[lane] = new ArrayBuffer(Math.min(this.maxLaneBytes, Math.max(bytes, this[lane].byteLength * 2)));
        }
        return this[lane];
      });
    } finally {
      this.inUse = false;
    }
  }

  /** Keep scratch leased across yields; concurrent synchronous uploads get
   * private buffers until the asynchronous upload has consumed its data. */
  async useAsync<T>(work: (allocate: GeometryStagingAllocator) => Promise<T>): Promise<T> {
    if (this.inUse) return work((_lane, bytes) => new ArrayBuffer(bytes));
    this.inUse = true;
    try {
      return await work((lane, bytes) => {
        if (bytes > this.maxLaneBytes) return new ArrayBuffer(bytes);
        if (this[lane].byteLength < bytes) {
          this[lane] = new ArrayBuffer(Math.min(this.maxLaneBytes, Math.max(bytes, this[lane].byteLength * 2)));
        }
        return this[lane];
      });
    } finally {
      this.inUse = false;
    }
  }
}

export const batchGeometryStaging = new GeometryStagingPool();
