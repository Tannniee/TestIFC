/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function testTestIfcNavigation(page, result, reportDir) {
  await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().setTheme('dark'));
  const cube = page.getByTestId('viewcube-navigation');
  const layout = await cube.evaluate(root => {
    const size = selector => { const r = root.querySelector(selector).getBoundingClientRect(); return [r.width, r.height]; };
    return { cluster: size('.view-nav-cluster'), stage: size('.view-cube__stage'),
      quickViews: root.querySelectorAll('.view-controls button:not(.home-view)').length,
      surfaces: root.querySelectorAll('.view-cube__surface').length };
  });
  assert.deepEqual(layout, { cluster: [204, 234], stage: [158, 158], quickViews: 6, surfaces: 26 });
  await cube.screenshot({ path: join(reportDir, 'viewcube-layout.png') });
  result.tests.push({ name: 'ViewCube retains fixed dimensions, 26 surfaces and six quick views', layout });
  const pose = () => page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.getViewpoint());
  const restore = async p => { await page.evaluate(p => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.applyViewpoint(p, false), p); await page.waitForTimeout(100); };
  const distance = p => Math.hypot(p.position.x - p.target.x, p.position.y - p.target.y, p.position.z - p.target.z);
  const difference = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const close = (a, b, tolerance = 1e-4) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
  const tool = id => page.locator(`[data-quick-tool="${id}"]`);
  const properties = page.locator('[data-activity-bar]').getByRole('button', { name: 'Properties', exact: true });
  await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().showWorkspacePanel('properties'));
  await page.waitForTimeout(400);
  for (let i = 0; i < 3; i++) {
    await properties.click();
    await page.waitForFunction(() => globalThis.__ifc_lite_viewer_store__.getState().sidebarMode === 'collapsed');
    await properties.click();
    await page.waitForFunction(() => globalThis.__ifc_lite_viewer_store__.getState().sidebarMode === 'expanded');
  }
  result.tests.push({ name: 'Properties activity icon closes and reopens, including rapid clicks' });
  await tool('model').click();
  // The section scenario may leave a pole view. Start this independent
  // navigation scenario from the visible Home control.
  await page.getByTestId('viewcube-navigation').locator('.home-view').click();
  await page.waitForTimeout(700);
  const initial = await pose();
  assert.equal(initial.projectionMode, 'orthographic');
  const box = await page.locator('canvas[data-viewport="main"]').boundingBox();
  const x = box.x + box.width * .48, y = box.y + box.height * .52;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(150);
  const zoomed = await pose();
  close(zoomed.orthoSize, initial.orthoSize * .95); close(distance(zoomed), distance(initial));
  await page.waitForTimeout(300);
  assert.deepEqual(await pose(), zoomed, 'wheel has no trailing inertia');
  await page.mouse.wheel(0, 100); await page.waitForTimeout(150);
  const reversed = await pose(); close(reversed.orthoSize, initial.orthoSize);
  assert.ok(difference(reversed.target, initial.target) < .001);
  result.tests.push({ name: 'real wheel TestIFC ratio, no inertia, reversibility' });
  await restore(initial);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 90, y + 15, { steps: 8 }); await page.mouse.up();
  const released = await pose(); await page.waitForTimeout(250); const tail = await pose();
  assert.ok(difference(released.position, tail.position) > .0001, 'rotation continues smoothly after release');
  await page.waitForTimeout(1800); const settled = await pose();
  assert.ok(difference(settled.position, initial.position) > .1);
  assert.ok(difference(settled.target, initial.target) < .001, 'orbit does not re-pick target under pointer');
  close(distance(settled), distance(initial), .001);
  result.tests.push({ name: 'actual pointer orbit damping and stable pivot' });
  await restore(initial);
  const point = initial.target;
  const project = p => page.evaluate(p => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.projectToScreen(p), p);
  const beforePan = await project(point);
  await page.mouse.move(x, y); await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 60, y + 30, { steps: 10 }); await page.mouse.up({ button: 'right' });
  const panReleased = await pose(); await page.waitForTimeout(300);
  assert.ok(difference((await pose()).target, panReleased.target) > .0001);
  await page.waitForTimeout(1800); const afterPan = await project(point);
  close(afterPan.x - beforePan.x, 60, .05); close(afterPan.y - beforePan.y, 30, .05);
  result.tests.push({ name: 'real screen pan retains all pointer movement and damping tail' });
  await restore(initial);
  await tool('selection').click();
  await page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState(), m = [...s.models.values()][0];
    s.setSelectedEntityId(m.idOffset + 52); s.setSelectedEntity({ modelId: m.id, expressId: 52 });
  });
  await page.waitForTimeout(600);
  const bounds = await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.selectionBounds());
  assert.ok(bounds, 'native selected slab has canonical placed bounds');
  const selectionPose = await pose();
  // The current desktop contract keeps the view stationary on selection;
  // TestIFC pointer orbit retains camera.target across drags.
  assert.deepEqual(selectionPose, initial);
  close(selectionPose.orthoSize, initial.orthoSize); close(distance(selectionPose), distance(initial), .001);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 40, y + 20, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(1200);
  assert.ok(difference((await pose()).position, selectionPose.position) > .001, 'selection orbit actually moves the camera');
  assert.deepEqual((await pose()).target, selectionPose.target);
  await page.mouse.move(x, y); await page.mouse.wheel(0, -100); await page.waitForTimeout(150);
  close((await pose()).orthoSize, selectionPose.orthoSize * .95);
  result.tests.push({ name: 'selection preserves the view and real orbit retains the stable TestIFC target' });
  await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().clearSelection());
  await restore(initial);
  // A model's bounding-box center can be empty space. Click a projected
  // selected bound first, then sample the viewport for an actual visible hit.
  const center = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, (bounds.min[axis] + bounds.max[axis]) / 2]));
  const known = await project(center);
  const candidates = [];
  if (known && known.x > 0 && known.x < box.width && known.y > 0 && known.y < box.height) candidates.push(known);
  for (let row = 1; row < 8; row++) for (let col = 1; col < 8; col++) candidates.push({ x: box.width * col / 8, y: box.height * row / 8 });
  let picked = false;
  for (const candidate of candidates) {
    await page.mouse.click(box.x + candidate.x, box.y + candidate.y);
    await page.waitForTimeout(80);
    picked = await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().selectedEntityId !== null);
    if (picked) break;
  }
  assert.ok(picked, 'a real click on rendered geometry selects an entity');
  await page.waitForTimeout(600);
  const clickedBounds = await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks.selectionBounds());
  assert.ok(clickedBounds);
  assert.deepEqual(await pose(), initial);
  result.tests.push({ name: 'actual viewport click selects an IFC component without reframing the stationary view' });
  await tool('model').click(); await page.waitForTimeout(600); await restore(initial);
  await tool('multi').click();
  // Docks cover the fixed canvas rather than resizing it. Expose its full
  // rectangle before sending a real drag near the top/right edges.
  if (await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().sidebarMode === 'expanded')) {
    await properties.click();
  }
  await page.getByRole('button', { name: 'Collapse the ribbon', exact: true }).click();
  await page.waitForTimeout(450);
  await page.mouse.move(box.x + 100, box.y + 80); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 100, box.y + box.height - 80, { steps: 10 }); await page.mouse.up();
  await page.waitForFunction(() => globalThis.__ifc_lite_viewer_store__.getState().selectedEntityIds.size > 1);
  await page.waitForTimeout(250);
  result.tests.push({ name: 'Multi quick tool performs GPU rectangle selection', count: await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().selectedEntityIds.size) });
  await page.getByRole('button', { name: 'Expand the ribbon', exact: true }).click();
  await page.waitForTimeout(450);
  await tool('measure').click();
  assert.deepEqual(await page.evaluate(() => { const s = globalThis.__ifc_lite_viewer_store__.getState(); return [s.activeTool, s.measureMode]; }), ['measure', 'drag']);
  await page.getByTestId('viewcube-navigation').locator('.top-view').click();
  await page.waitForTimeout(650);
  const measureBox = await page.locator('canvas[data-viewport="main"]').boundingBox();
  const measurePoints = await page.evaluate(({ center, bounds }) => {
    const c = globalThis.__ifc_lite_viewer_store__.getState().cameraCallbacks;
    const offset = (bounds.max.x - bounds.min.x) * .25;
    return [-1, 1].map(sign => c.projectToScreen({ ...center, x: center.x + sign * offset }));
  }, { center, bounds });
  assert.ok(measurePoints.every(Boolean));
  const [start, end] = measurePoints.map(p => ({ x: p.x + measureBox.x, y: p.y + measureBox.y }));
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 }); await page.waitForTimeout(300); await page.mouse.up();
  await page.waitForFunction(() => globalThis.__ifc_lite_viewer_store__.getState().measurements.length > 0);
  const measurement = await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().measurements[0]);
  assert.ok(difference(measurement.start, measurement.end) > .001);
  result.tests.push({ name: 'Measure quick tool completes an actual snapped drag on IFC geometry', measurement });
  await page.locator('.testifc-quick-tools__options').getByRole('button', { name: 'Polyline', exact: true }).click();
  assert.equal(await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().measureMode), 'polyline');
  await page.mouse.click(start.x, start.y); await page.waitForTimeout(150); await page.mouse.click(end.x, end.y);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => globalThis.__ifc_lite_viewer_store__.getState().polylineMeasurements.length > 0);
  result.tests.push({ name: 'Measure quick tool and mode buttons use canonical IFC-Lite measurement state' });
  await tool('model').click(); await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().clearSelection());
  await restore(initial);
  await page.waitForTimeout(500);
  assert.deepEqual(await pose(), initial, 'an explicit pose cancels the previous tool animation');
  const style = await tool('model').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, border: getComputedStyle(el).borderTopColor }));
  assert.notEqual(style.background, 'rgba(0, 0, 0, 0)', 'quick tool selection uses the theme colors');
  result.tests.push({ name: 'quick tool active styling in dark theme', style });
  await page.screenshot({ path: join(reportDir, 'testifc-navigation.png') });
}
