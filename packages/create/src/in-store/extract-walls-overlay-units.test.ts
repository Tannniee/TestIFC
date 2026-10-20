/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A wall authored this session reads back in metres, whatever the file's
 * length unit (#6232). `addWallToStore` writes native units (mm in a
 * millimetre file, `native-units.test.ts`), but the overlay branch of
 * `extractWallSegmentsForStorey` took its axis as metres already, so in a
 * millimetre model a new wall came back 1000× too long — the Model
 * workspace's wall snap, its workplane outline and auto spaces all read it.
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { IfcParser, extractProjectUnits, EMPTY_SOURCE_BYTES } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { addWallToStore } from './wall.js';
import { extractWallSegmentsForStorey } from './extract-walls.js';

// Bonsai/IfcOpenShell IFC4 sample, one storey (#42); relabelled millimetre.
const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);

async function session(unit: 'metre' | 'millimetre') {
  let text = await readFile(SAMPLE, 'utf8');
  if (unit === 'millimetre') text = text.replace('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)', 'IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
  const bytes = new TextEncoder().encode(text);
  const store = await new IfcParser().parseColumnar(bytes.buffer as ArrayBuffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm');
  return { store, view, editor: new StoreEditor(store, view) };
}

describe('extractWallSegmentsForStorey: created walls in metres (#6232)', () => {
  for (const unit of ['metre', 'millimetre'] as const) {
    it(`#6232 reads a source-free native overlay wall in ${unit} units without a false unknown-unit warning`, async () => {
      const { store, view, editor } = await session(unit);
      const sourceAnchor = resolveSpatialAnchor(store, 42, view);
      const point = editor.addEntity('IfcCartesianPoint', [[0, 0, 0]]);
      const axis = editor.addEntity('IfcAxis2Placement3D', [`#${point.expressId}`, null, null]);
      const placement = editor.addEntity('IfcLocalPlacement', [null, `#${axis.expressId}`]);
      const storey = editor.addEntity('IfcBuildingStorey', ['0YvctVUKr0kugbFTf53O9M', null, 'Native overlay storey', null, null,
        `#${placement.expressId}`, null, null, '.ELEMENT.', 0]);
      const anchor = { ...sourceAnchor, storeyId: storey.expressId, storeyPlacementId: placement.expressId };
      const wall = addWallToStore(editor, anchor, { Start: [1, 2, 0], End: [5, 2, 0], Thickness: 0.2, Height: 3 });
      // Native transports resolved metadata and overlay entities, without STEP bytes.
      const projectId = store.entityIndex.byType.get('IFCPROJECT')?.[0];
      const declaredUnit = extractProjectUnits(store.source, store.entityIndex).resolvedForUnitType('LENGTHUNIT');
      if (projectId === undefined || !declaredUnit) throw new Error('Fixture has no declared length unit');
      store.entityIndex.projectUnits = new Map([[projectId, { byType: new Map([['LENGTHUNIT', declaredUnit]]), monetary: null }]]);
      store.lengthUnitScale = sourceAnchor.lengthUnitScale;
      delete store.lengthUnitSource;
      store.source = EMPTY_SOURCE_BYTES;
      const warn = vi.spyOn(console, 'warn');
      try {
        const result = extractWallSegmentsForStorey(store, storey.expressId, view);
        const i = result.contributingWallIds.indexOf(wall.wallId);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(result.segments[i]!.a).toEqual([1, 2]);
        expect(result.segments[i]!.b).toEqual([5, 2]);
        expect(warn.mock.calls.filter(args => String(args[0]).includes('[UnitExtractor]'))).toEqual([]);
        // Losing declared metadata must still report the original uncertainty.
        delete store.entityIndex.projectUnits;
        store.lengthUnitSource = 'default';
        const unconfirmed = extractWallSegmentsForStorey(store, storey.expressId, view);
        expect(unconfirmed.lengthUnitScale).toBe(1);
        expect(warn.mock.calls.some(args => String(args[0]).includes('[UnitExtractor]'))).toBe(true);
      } finally { warn.mockRestore(); }
    });
    it(`a created wall's axis reads back in metres in a ${unit} file`, async () => {
      const { store, view, editor } = await session(unit);
      const anchor = resolveSpatialAnchor(store, 42, view);
      expect(anchor.lengthUnitScale).toBe(unit === 'metre' ? 1 : 0.001);
      const wall = addWallToStore(editor, anchor, { Start: [1, 2, 0], End: [5, 2, 0], Thickness: 0.2, Height: 3 });
      const result = extractWallSegmentsForStorey(store, 42, view);
      const i = result.contributingWallIds.indexOf(wall.wallId);
      expect(i).toBeGreaterThanOrEqual(0);
      const { a, b } = result.segments[i]!;
      expect(a[0]).toBeCloseTo(1, 9);
      expect(a[1]).toBeCloseTo(2, 9);
      expect(b[0]).toBeCloseTo(5, 9);
      expect(b[1]).toBeCloseTo(2, 9);
    });
  }
});
