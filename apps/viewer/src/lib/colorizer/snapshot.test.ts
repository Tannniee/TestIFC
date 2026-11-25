/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { useViewerStore } from '@/store';
import { fixtureModel } from '@/test/store-fixture';
import { captureColorizerSnapshot } from './snapshot';

const initial = useViewerStore.getState();
afterEach(() => useViewerStore.setState(initial, true));

function seed(views = new Map<string, MutablePropertyView>()) {
  const model = { ...fixtureModel('a'), schemaVersion: 'IFC4' as const, sourceFile: new File(['ISO-10303-21;'], 'a.ifc') };
  useViewerStore.setState({ models: new Map([['a', model]]), mutationViews: views, georefMutations: new Map(),
    scheduleIsEdited: false, scheduleSourceModelId: null });
}

it('a panel registering an empty mutation view keeps the Colorizer draft valid', () => {
  seed();
  const snapshot = captureColorizerSnapshot('a');
  // Properties (multi-selection summary), zones and exports register a view lazily.
  useViewerStore.setState({ mutationViews: new Map([['a', new MutablePropertyView(null, 'a')]]) });
  assert.doesNotThrow(() => snapshot.validate());
});

it('a real attribute edit after capture still invalidates the Colorizer draft', () => {
  seed();
  const snapshot = captureColorizerSnapshot('a');
  const view = new MutablePropertyView(null, 'a');
  useViewerStore.setState({ mutationViews: new Map([['a', view]]) });
  view.setAttribute(1, 'Name', 'Edited');
  assert.throws(() => snapshot.validate(), /model changed/);
});

it('replacing an edited view is still a different editing revision', () => {
  const edited = new MutablePropertyView(null, 'a');
  edited.setAttribute(1, 'Name', 'Edited');
  seed(new Map([['a', edited]]));
  const snapshot = captureColorizerSnapshot('a');
  useViewerStore.setState({ mutationViews: new Map([['a', new MutablePropertyView(null, 'a')]]) });
  assert.throws(() => snapshot.validate(), /model changed/);
});
