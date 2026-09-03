import * as THREE from "three";
import type { SectionBoxState } from "./viewer-contracts";

type Face = { axis: "x" | "y" | "z"; side: "min" | "max" };
export class SectionBoxController {
  readonly scene = new THREE.Scene();
  private readonly geometry = (() => { const box = new THREE.BoxGeometry(1,1,1); const edges = new THREE.EdgesGeometry(box); box.dispose(); return edges; })();
  private readonly material = new THREE.LineBasicMaterial({ color: 0x67b8dc, transparent: true, opacity: .8, depthTest: false, depthWrite: false });
  private readonly outline = new THREE.LineSegments(this.geometry, this.material);
  private readonly handles: Array<{ face: Face; button: HTMLButtonElement; down: (e: PointerEvent) => void }> = [];
  private box: SectionBoxState | null = null;
  private display = { showBox: true, showHandles: true };
  private enabled = true;
  private drag: { face: Face; pointer: number; button: HTMLButtonElement; snapshot: SectionBoxState;
    x: number; y: number; dx: number; dy: number; scale: number } | null = null;
  constructor(private readonly host: HTMLElement, private readonly camera: THREE.OrthographicCamera,
    private readonly changed: (box: SectionBoxState, force: boolean) => void,
    private readonly navigation: (enabled: boolean) => void, private readonly editing: () => void) {
    this.scene.add(this.outline); this.outline.visible = false;
    for (const axis of ["x", "y", "z"] as const) for (const side of ["min", "max"] as const) {
      const face = { axis, side }, button = document.createElement("button");
      button.type = "button"; button.className = "section-box-handle";
      button.dataset.sectionFace = `${axis}-${side}`;
      const label = axis === "y" ? "Z" : axis === "z" ? "Y" : "X";
      const labelSide = axis === "z" ? (side === "min" ? "max" : "min") : side;
      button.setAttribute("aria-label", `Section Box ${label} ${labelSide}`);
      button.title = `${label} · ${labelSide}`;
      button.textContent = "◆"; button.hidden = true;
      const down = (event: PointerEvent) => this.start(face, button, event);
      button.addEventListener("pointerdown", down); button.addEventListener("lostpointercapture", this.lost);
      button.addEventListener("click", this.stopClick);
      this.host.append(button); this.handles.push({ face, button, down });
    }
    window.addEventListener("pointermove", this.move, true);
    window.addEventListener("pointerup", this.up, true);
    window.addEventListener("pointercancel", this.lost, true);
    window.addEventListener("blur", this.lost);
    window.addEventListener("keydown", this.key, true);
  }
  get dragging() { return this.drag !== null; }
  get visible() { return this.outline.visible; }
  setEnabled(enabled: boolean) { this.enabled = enabled; if (!enabled) this.cancel(); this.update(); }
  set(box: SectionBoxState | null, display = this.display) {
    this.box = box ? structuredClone(box) : null; this.display = { ...display }; this.update();
  }
  private center(face?: Face) {
    const box = this.box!;
    const p = new THREE.Vector3((box.min.x+box.max.x)/2,(box.min.y+box.max.y)/2,(box.min.z+box.max.z)/2);
    if (face) p[face.axis] = box[face.side][face.axis];
    return p;
  }
  update() {
    const box = this.box, width = Math.max(this.host.clientWidth,1), height = Math.max(this.host.clientHeight,1);
    this.outline.visible = Boolean(box && this.display.showBox);
    if (box) { this.outline.position.copy(this.center()); this.outline.scale.set(box.max.x-box.min.x, box.max.y-box.min.y, box.max.z-box.min.z); }
    this.camera.updateMatrixWorld();
    for (const { face, button } of this.handles) {
      const p = box ? this.center(face).project(this.camera) : null;
      button.hidden = !this.enabled || !p || !this.display.showHandles || p.z < -1 || p.z > 1 || Math.abs(p.x)>1.1 || Math.abs(p.y)>1.1;
      if (p) { button.style.left = `${(p.x*.5+.5)*width}px`; button.style.top = `${(-p.y*.5+.5)*height}px`; }
    }
  }
  private start(face: Face, button: HTMLButtonElement, event: PointerEvent) {
    if (!this.enabled || !this.box || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.cancel();
    const origin = this.center(face), a = origin.clone().project(this.camera);
    const unit = Math.max(this.camera.top-this.camera.bottom, 1e-6)/this.camera.zoom;
    origin[face.axis] += unit;
    const b = origin.project(this.camera);
    let dx = (b.x-a.x)*this.host.clientWidth/2, dy = -(b.y-a.y)*this.host.clientHeight/2;
    const length = Math.hypot(dx,dy);
    // A face parallel to the view ray still has an unambiguous vertical drag fallback.
    const scale = length > 2 ? unit/length : unit/Math.max(this.host.clientHeight,1);
    if (length > 2) { dx /= length; dy /= length; } else { dx = 0; dy = -1; }
    this.drag = { face, pointer: event.pointerId, button, snapshot: structuredClone(this.box), x: event.clientX, y: event.clientY, dx, dy, scale };
    this.navigation(false); this.editing(); button.setPointerCapture(event.pointerId);
  }
  private readonly move = (event: PointerEvent) => {
    const drag = this.drag; if (!drag || event.pointerId !== drag.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const box = structuredClone(drag.snapshot), { axis, side } = drag.face;
    const value = box[side][axis] + ((event.clientX-drag.x)*drag.dx + (event.clientY-drag.y)*drag.dy)*drag.scale;
    const extent = Math.max(...["x","y","z"].map(a => box.max[a as "x"]-box.min[a as "x"]),1e-6)*1e-7;
    box[side][axis] = side === "min" ? Math.min(value,box.max[axis]-extent) : Math.max(value,box.min[axis]+extent);
    this.changed(box,false);
  };
  private release() {
    const drag = this.drag; this.drag = null;
    if (drag?.button.hasPointerCapture(drag.pointer)) drag.button.releasePointerCapture(drag.pointer);
    this.navigation(true);
    return drag;
  }
  private readonly up = (event: PointerEvent) => {
    if (event.pointerId !== this.drag?.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.release(); if (this.box) this.changed(this.box,true);
  };
  cancel() { const drag = this.drag; if (!drag) return false; this.release(); this.changed(drag.snapshot,true); return true; }
  private readonly lost = () => { this.cancel(); };
  private readonly key = (event: KeyboardEvent) => { if (event.key === "Escape" && this.cancel()) { event.preventDefault(); event.stopImmediatePropagation(); } };
  private readonly stopClick = (event: Event) => { event.stopPropagation(); };
  dispose() {
    this.cancel();
    window.removeEventListener("pointermove",this.move,true); window.removeEventListener("pointerup",this.up,true);
    window.removeEventListener("pointercancel",this.lost,true); window.removeEventListener("blur",this.lost); window.removeEventListener("keydown",this.key,true);
    for (const {button,down} of this.handles) { button.removeEventListener("pointerdown",down); button.removeEventListener("lostpointercapture",this.lost); button.removeEventListener("click",this.stopClick); button.remove(); }
    this.geometry.dispose(); this.material.dispose(); this.scene.clear();
  }
}
