import { expect, test } from "@playwright/test";

test("centered and off-center Box Zoom publish intermediate projection changes and one final force", async ({ page }, testInfo) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { ViewerCamera } = await import(/* @vite-ignore */ "/src/lib/viewer-camera.ts");
    const host = document.createElement("div"); host.style.cssText = "width:800px;height:600px";
    const canvas = document.createElement("canvas"); host.append(canvas); document.body.append(host);
    const run = (left: number, top: number) => {
      const events: any[] = [];
      const camera = new ViewerCamera(host, canvas, { onOrientationChange() {}, onUpdate: (force: boolean, context: any) => events.push({ force, ...context }) });
      camera.resize(800, 600);
      const before = camera.captureState();
      camera.zoomToViewportBox(left, top, 80, 60, 800, 600);
      const animation = camera.animation;
      for (let t = 0; t < animation.durationMs; t += 16) camera.render(animation.startedAt + t);
      camera.render(animation.startedAt + animation.durationMs);
      const after = camera.captureState();
      camera.dispose();
      return { events, before: before.effectiveHeight, after: after.effectiveHeight,
        target: animation.to.effectiveHeight, positionError: after.position.distanceTo(animation.to.position),
        normals: events.filter(e => !e.force).length, forces: events.filter(e => e.force).length };
    };
    try { return [run(360, 270), run(80, 60)]; }
    finally { host.remove(); }
  });
  for (const result of results) {
    expect(result.normals).toBeGreaterThan(15);
    expect(result.forces).toBe(1);
    expect(result.after).toBeCloseTo(result.target, 10);
    expect(result.positionError).toBeLessThan(1e-10);
    expect(result.events.at(-1)).toMatchObject({ kind: "boxZoom", progress: 1, heightRatioToTarget: 1 });
    expect(new Set(result.events.map((e: any) => e.transitionId)).size).toBe(1);
  }
  await testInfo.attach("camera-updates", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
});

test("Section Box planes reject every outside face, validate bounds, and restore from JSON", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const clipping = await import(/* @vite-ignore */ "/src/lib/viewer-clipping.ts");
    const { sectionBoxPlanes, validSectionBox } = clipping;
    const box = { enabled: true, min: { x: -2, y: -3, z: -4 }, max: { x: 2, y: 3, z: 4 } };
    const planes = sectionBoxPlanes(JSON.parse(JSON.stringify(box)));
    return { count: planes.length, outside: [[-3,0,0],[3,0,0],[0,-4,0],[0,4,0],[0,0,-5],[0,0,5]].map(([x,y,z]) =>
      planes.filter((p: any) => p.normal.x*x + p.normal.y*y + p.normal.z*z + p.constant < 0).length),
      disabled: sectionBoxPlanes({ ...box, enabled: false }).length,
      invalid: validSectionBox({ ...box, max: { ...box.max, x: -2 } }),
      nan: validSectionBox({ ...box, min: { ...box.min, z: NaN } }) };
  });
  expect(result).toEqual({ count: 6, outside: [1,1,1,1,1,1], disabled: 0, invalid: false, nan: false });
});
