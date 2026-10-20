/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { EntityRef } from './types.js';

/** A declared display symbol and its conversion to SI: `si = value * scale + offset`. */
export interface ResolvedUnit {
  symbol: string;
  siScale: number;
  /** Additive SI offset for `IfcConversionBasedUnitWithOffset`. */
  siOffset?: number;
}

/** Native current point provider; omitted readers retain parsed-source semantics. */
export type UnitEntityReader = (expressId: number) => { type: string; attributes: readonly unknown[] } | null;

/** Expected refusal of a current native context; source-only defaults stay unchanged. */
export class ProjectUnitReadError extends Error {}

export interface EntityByIdIndexLike {
  byId: { get(expressId: number): EntityRef | undefined };
}

/** Plain metadata survives native transport without nominal class identity. */
export interface ResolvedProjectUnits {
  byType: ReadonlyMap<string, ResolvedUnit | null>;
  monetary: ResolvedUnit | null;
}
