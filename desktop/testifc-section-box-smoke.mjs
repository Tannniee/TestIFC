/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function sweepCurrentBox(page) {
  const overlay = page.getByTestId('testifc-box-draw');
  await page.waitForFunction(() => document.querySelector('[data-testid="testifc-box-draw"]')?.getAttribute('data-phase') === 'drawing');
  const r = await overlay.boundingBox();
  await page.mouse.move(r.x + r.width * .35, r.y + r.height * .3);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * .7, r.y + r.height * .7, { steps: 12 });
  await page.mouse.up();
  await overlay.waitFor({ state: 'detached' });
  await page.waitForTimeout(650);
}

export async function testTestIfcSectionBox(page, result, reportDir) {
  const state = () => page.evaluate(() => {
    const s = globalThis.__ifc_lite_viewer_store__.getState();
    return { plane: s.sectionPlane, pose: s.cameraCallbacks.getViewpoint(), interaction: s.interactionMode };
  });
  const panel = page.getByTestId('testifc-box-panel');
  const bar = page.locator('[data-tool-bar="section"]');
  const direction = pose => {
    const v = ['x', 'y', 'z'].map(k => pose.position[k] - pose.target[k]), length = Math.hypot(...v);
    return v.map(n => n / length);
  };
  const assertDirection = (a, b) => direction(a).forEach((v, i) => assert.ok(Math.abs(v - direction(b)[i]) < .0001));
  const assertHandleProjection = async () => {
    const projected = await page.evaluate(() => {
      const s = globalThis.__ifc_lite_viewer_store__.getState(), b = s.sectionPlane.box;
      const canvas = document.querySelector('canvas[data-viewport="main"]').getBoundingClientRect();
      return [...document.querySelectorAll('[data-section-face]')].filter(el => el.getBoundingClientRect().width).map(el => {
        const face = el.dataset.sectionFace, axis = 'XYZ'.indexOf(face.at(-1)), side = face.startsWith('min') ? 'min' : 'max';
        const c = b.min.map((v, i) => (v + b.max[i]) / 2); c[axis] = b[side][axis];
        const p = s.cameraCallbacks.projectToScreen({ x: c[0], y: c[1], z: c[2] }), r = el.getBoundingClientRect();
        return { face, error: Math.hypot(r.x + r.width / 2 - canvas.x - p.x, r.y + r.height / 2 - canvas.y - p.y) };
      });
    });
    assert.ok(projected.length > 0);
    projected.forEach(p => assert.ok(p.error < 1, `${p.face} is ${p.error}px away from its native projection`));
  };
  await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().setTheme('dark'));
  await page.locator('[data-tour="tool-section"]').click();
  const before = await state();
  await bar.getByRole('radio', { name: 'Box', exact: true }).click();
  await sweepCurrentBox(page);
  const swept = await state();
  assert.equal(swept.plane.enabled, true);
  assertDirection(swept.pose, before.pose);
  assert.equal(await page.locator('[data-section-face]').count(), 6);
  assert.equal(await page.locator('[data-section-face]').first().innerText(), '◆');
  assert.equal(await page.locator('[data-quick-tool]').count(), 0, 'Box panel clears the quick-tool rail');
  result.tests.push({ name: 'TestIFC Top sweep creates canonical Box, restores source orientation, six diamond handles' });
  await page.screenshot({ path: join(reportDir, 'testifc-box-sweep.png') });

  const p = swept.plane.box;
  const yMin = panel.locator('[data-box-limit="Y-min"]');
  assert.ok(Math.abs(Number(await yMin.inputValue()) + p.max[2]) < 1e-8);
  const newY = -p.max[2] + (p.max[2] - p.min[2]) * .15;
  await yMin.fill(String(newY)); await yMin.press('Enter');
  await page.waitForFunction(expected => Math.abs(globalThis.__ifc_lite_viewer_store__.getState().sectionPlane.box.max[2] + expected) < 1e-8, newY);
  const edited = await state();
  assert.deepEqual(edited.plane.box.min, p.min);
  const xMin = panel.locator('[data-box-limit="X-min"]');
  await xMin.fill(String(edited.plane.box.max[0] + 10)); await xMin.press('Enter');
  await panel.getByRole('alert').waitFor();
  assert.deepEqual((await state()).plane.box, edited.plane.box, 'invalid input cannot invert clipping');
  await xMin.fill(String(edited.plane.box.min[0])); await xMin.press('Enter');
  result.tests.push({ name: 'IFC Y uses negative world Z with exchanged limits; inverted numeric input rejected' });

  const h = page.locator('[data-section-face="maxX"]');
  const hr = await h.boundingBox();
  assert.ok(hr);
  await page.mouse.move(hr.x + hr.width / 2, hr.y + hr.height / 2); await page.mouse.down();
  await page.mouse.move(hr.x + hr.width / 2 + 25, hr.y + hr.height / 2 - 15, { steps: 8 });
  assert.notDeepEqual((await state()).plane.box, edited.plane.box);
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.deepEqual((await state()).plane.box, edited.plane.box);
  result.tests.push({ name: 'Actual face drag changes clipping; Escape restores all bounds and releases capture' });

  await page.getByTestId('viewcube-navigation').locator('.top-view').click(); await page.waitForTimeout(600);
  await assertHandleProjection();
  const edgeBefore = await state();
  const eh = page.locator('[data-section-face="maxY"]'), er = await eh.boundingBox();
  await page.mouse.move(er.x + er.width / 2, er.y + er.height / 2); await page.mouse.down();
  await page.mouse.move(er.x + er.width / 2, er.y + er.height / 2 - 40, { steps: 10 }); await page.mouse.up();
  assert.ok((await state()).plane.box.max[1] > edgeBefore.plane.box.max[1], 'edge-on elevation face uses vertical fallback');
  result.tests.push({ name: 'Top-view elevation face can be dragged even when its axis projects to a point' });

  const beforeCancel = await state();
  await panel.getByRole('button', { name: 'Draw again', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="testifc-box-draw"]')?.getAttribute('data-phase') === 'drawing');
  await page.keyboard.press('Escape');
  await page.getByTestId('testifc-box-draw').waitFor({ state: 'detached' });
  assert.deepEqual((await state()).plane, beforeCancel.plane);
  assert.deepEqual((await state()).pose, beforeCancel.pose);
  result.tests.push({ name: 'Draw again + Escape restores the exact previous camera and section state' });

  await panel.getByLabel('Show Box', { exact: true }).uncheck();
  assert.equal(await page.locator('[data-scene-primitive="plane-outline"]').count(), 0);
  assert.equal(await page.locator('[data-section-face]').count(), 6);
  await panel.getByLabel('Show Handles', { exact: true }).uncheck();
  assert.equal(await page.locator('[data-section-face]').count(), 0);
  assert.deepEqual((await state()).plane.box, beforeCancel.plane.box);
  await panel.getByLabel('Show Box', { exact: true }).check();
  await panel.getByLabel('Show Handles', { exact: true }).check();
  result.tests.push({ name: 'Outline and handle visibility are independent of active clipping' });

  await panel.getByRole('button', { name: 'Reset Bounds', exact: true }).click();
  const reset = await state();
  assert.notDeepEqual(reset.plane.box, beforeCancel.plane.box);
  await panel.getByRole('button', { name: 'Fit View', exact: true }).click(); await page.waitForTimeout(650);
  await assertHandleProjection();
  assert.deepEqual((await state()).plane.box, reset.plane.box, 'Fit View moves camera without resetting bounds');
  assertDirection((await state()).pose, reset.pose);
  result.tests.push({ name: 'Reset Bounds uses placed model bounds; Fit View preserves bounds and orientation' });

  // Hold the camera fixed; hide overlays during capture so only GPU pixels can differ.
  const capture = { style: '[data-scene-overlay-root], [data-hud-region], [data-testid="viewcube-navigation"], [role="tooltip"] { opacity: 0 !important; }' };
  await panel.locator('[data-box-limit="X-max"]').fill(String((p.min[0] + p.max[0]) / 2));
  await panel.locator('[data-box-limit="X-max"]').press('Enter');
  await page.getByTestId('viewcube-navigation').locator('.home-view').click(); await page.waitForTimeout(700);
  await assertHandleProjection();
  const canvas = page.locator('canvas[data-viewport="main"]');
  await canvas.screenshot({ ...capture, path: join(reportDir, 'testifc-box-cut-on.png') });
  const cut = await state();
  await bar.getByRole('button', { name: 'Cut', exact: true }).click(); await page.waitForTimeout(300);
  const off = await canvas.screenshot({ ...capture, path: join(reportDir, 'testifc-box-cut-off.png') });
  await bar.getByRole('button', { name: 'Cut', exact: true }).click(); await page.waitForTimeout(300);
  const on = await canvas.screenshot(capture);
  assert.notDeepEqual(on, off, 'same camera with cut on/off must produce different pixels');
  assert.deepEqual((await state()).plane.box, cut.plane.box);
  assert.deepEqual((await state()).pose, cut.pose);
  result.tests.push({ name: 'Actual WebGPU cut toggle changes canvas pixels without changing bounds or camera' });

  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal((await state()).plane.enabled, true, 'closing controls keeps native scene cut');
  await page.locator('[data-tour="tool-section"]').click(); await panel.waitFor();
  assert.deepEqual((await state()).plane.box, cut.plane.box);
  await bar.getByRole('radio', { name: 'Front', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  assert.equal((await state()).plane.box, undefined);
  await bar.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => globalThis.__ifc_lite_viewer_store__.getState().setSectionPlaneEnabled(false));
  result.tests.push({ name: 'Close/reopen preserves native cut; Front exits Box and keeps native plane controls' });
}
