import {
  SnappingClass,
  type FragmentsModel,
  type RaycastResult,
  type RectangleRaycastResult,
} from "@thatopen/fragments";
import * as THREE from "three";
import type { MeasureMode, MeasurementResult, ViewerTool } from "./viewer-contracts";
import { formatMeasurement, isFullyIncludedSweep, measurementMidpoint, pointAtDistance } from "./viewer-tool-math";

const SWEEP_MIN_SIZE_PX = 8;

interface SweepStart {
  pointerId: number;
  clientX: number;
  clientY: number;
  localX: number;
  localY: number;
}

interface MeasurementVisual {
  result: MeasurementResult;
  line: THREE.Line;
  points: THREE.Points;
  label: HTMLDivElement;
}

export interface ViewerInteractionCallbacks {
  activeModel(): FragmentsModel | null;
  onMultiSelection(result: RectangleRaycastResult | null): void;
  onMeasurements(measurements: MeasurementResult[]): void;
}

export class ViewerInteraction {
  private readonly sweepRectangle: HTMLDivElement;
  private tool: ViewerTool = "pan";
  private measureMode: MeasureMode = "pointToPoint";
  private sweepStart: SweepStart | null = null;
  private measurementStart: THREE.Vector3 | null = null;
  private draftPoint: THREE.Points | null = null;
  private snapPoint: THREE.Points | null = null;
  private snapEdge: THREE.Line | null = null;
  private measurements: MeasurementVisual[] = [];
  private nextMeasurementId = 1;
  private snapSequence = 0;
  private snapFrame: number | null = null;
  private snapPending = false;
  private queuedSnap: { x: number; y: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly callbacks: ViewerInteractionCallbacks,
  ) {
    this.sweepRectangle = document.createElement("div");
    this.sweepRectangle.className = "viewer-selection-rectangle";
    this.sweepRectangle.hidden = true;
    this.host.append(this.sweepRectangle);
    this.applyHostClasses();
  }

  setTool(tool: ViewerTool) {
    if (tool === this.tool) return;
    this.cancelSweep();
    this.clearDraft();
    this.tool = tool;
    this.applyHostClasses();
  }

  setMeasureMode(mode: MeasureMode) {
    if (mode === this.measureMode) return;
    this.measureMode = mode;
    this.clearDraft();
  }

  hasMeasurementState() {
    return Boolean(this.measurementStart || this.measurements.length);
  }

  clearMeasurements() {
    this.clearDraft();
    for (const visual of this.measurements) this.disposeMeasurement(visual);
    this.measurements = [];
    this.publishMeasurements();
  }

  setLatestMeasurementDistance(distance: number) {
    const visual = [...this.measurements].reverse().find((candidate) => candidate.result.mode === "pointToPoint");
    if (!visual) return false;
    const end = pointAtDistance(visual.result.start, visual.result.end, distance);
    if (!end) return false;
    visual.result = { ...visual.result, end, distance };
    this.updateMeasurementVisual(visual);
    this.publishMeasurements();
    return true;
  }

  cancelAction() {
    if (this.sweepStart) {
      this.cancelSweep();
      return true;
    }
    if (this.measurementStart) {
      this.clearDraft();
      return true;
    }
    return false;
  }

  reset() {
    this.cancelSweep();
    this.clearMeasurements();
  }

  handlePointerDown(event: PointerEvent): boolean {
    if (this.tool !== "multiSelect" || event.button !== 0 || event.altKey) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const point = this.localPoint(event.clientX, event.clientY);
    this.sweepStart = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      localX: point.x,
      localY: point.y,
    };
    this.canvas.setPointerCapture(event.pointerId);
    this.sweepRectangle.hidden = false;
    this.updateSweepRectangle(point.x, point.y);
    return true;
  }

  handlePointerMove(event: PointerEvent): boolean {
    const start = this.sweepStart;
    if (start?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = this.localPoint(event.clientX, event.clientY);
      this.updateSweepRectangle(point.x, point.y);
      return true;
    }
    if (this.tool !== "measure") return false;
    this.scheduleSnapPreview(event.clientX, event.clientY);
    return true;
  }

  handlePointerUp(event: PointerEvent): boolean {
    const start = this.sweepStart;
    if (!start || start.pointerId !== event.pointerId) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.finishSweep(start, event.clientX, event.clientY);
    this.cancelSweep();
    return true;
  }

  handlePointerCancel(event: PointerEvent): boolean {
    if (this.sweepStart?.pointerId !== event.pointerId) return false;
    this.cancelSweep();
    return true;
  }

  handleClick(event: MouseEvent): boolean {
    if (this.tool === "multiSelect") return true;
    if (this.tool !== "measure" || event.button !== 0) return false;
    void this.measure(event.clientX, event.clientY);
    return true;
  }

  updateOverlay() {
    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);
    for (const visual of this.measurements) {
      const midpoint = measurementMidpoint(visual.result);
      const projected = new THREE.Vector3(midpoint.x, midpoint.y, midpoint.z).project(this.camera);
      if (projected.z < -1 || projected.z > 1) {
        visual.label.hidden = true;
        continue;
      }
      visual.label.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
      visual.label.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
      visual.label.hidden = false;
    }
  }

  dispose() {
    this.cancelSweep();
    this.clearDraft();
    for (const visual of this.measurements) this.disposeMeasurement(visual);
    this.measurements = [];
    this.sweepRectangle.remove();
    this.host.classList.remove("viewer-pan-active", "viewer-multi-select-active", "viewer-measure-active");
  }

  private async finishSweep(start: SweepStart, endClientX: number, endClientY: number) {
    const model = this.callbacks.activeModel();
    if (!model) return;
    const end = this.localPoint(endClientX, endClientY);
    if (Math.abs(end.x - start.localX) < SWEEP_MIN_SIZE_PX || Math.abs(end.y - start.localY) < SWEEP_MIN_SIZE_PX) return;
    const result = await model.rectangleRaycast({
      camera: this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera,
      dom: this.canvas,
      topLeft: new THREE.Vector2(Math.min(start.clientX, endClientX), Math.min(start.clientY, endClientY)),
      bottomRight: new THREE.Vector2(Math.max(start.clientX, endClientX), Math.max(start.clientY, endClientY)),
      fullyIncluded: isFullyIncludedSweep(start.clientX, endClientX),
    });
    if (model !== this.callbacks.activeModel() || this.tool !== "multiSelect") return;
    this.callbacks.onMultiSelection(result);
  }

  private scheduleSnapPreview(clientX: number, clientY: number) {
    this.queuedSnap = { x: clientX, y: clientY };
    if (this.snapFrame !== null || this.snapPending) return;
    this.snapFrame = requestAnimationFrame(() => {
      this.snapFrame = null;
      const point = this.queuedSnap;
      this.queuedSnap = null;
      if (!point) return;
      this.snapPending = true;
      void this.updateSnapPreview(point.x, point.y).finally(() => {
        this.snapPending = false;
        if (this.queuedSnap) this.scheduleSnapPreview(this.queuedSnap.x, this.queuedSnap.y);
      });
    });
  }

  private async updateSnapPreview(clientX: number, clientY: number) {
    const sequence = ++this.snapSequence;
    const model = this.callbacks.activeModel();
    if (!model) return;
    const hit = await this.snapAt(model, clientX, clientY, this.measureMode);
    if (sequence !== this.snapSequence || model !== this.callbacks.activeModel() || this.tool !== "measure") return;
    this.drawSnapPreview(hit);
  }

  private async measure(clientX: number, clientY: number) {
    const model = this.callbacks.activeModel();
    if (!model) return;
    const mode = this.measureMode;
    const hit = await this.snapAt(model, clientX, clientY, mode);
    if (model !== this.callbacks.activeModel() || this.tool !== "measure" || this.measureMode !== mode || !hit) return;
    if (mode === "edge") {
      if (hit.snappedEdgeP1 && hit.snappedEdgeP2) this.commitMeasurement(hit.snappedEdgeP1, hit.snappedEdgeP2, mode);
      return;
    }
    this.acceptMeasurementPoint(hit.point);
  }

  private async snapAt(model: FragmentsModel, clientX: number, clientY: number, mode: MeasureMode) {
    const snappingClasses = mode === "edge"
      ? [SnappingClass.LINE]
      : [SnappingClass.POINT, SnappingClass.LINE, SnappingClass.FACE];
    const hits = await model.raycastWithSnapping({
      camera: this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera,
      mouse: new THREE.Vector2(clientX, clientY),
      dom: this.canvas,
      snappingClasses,
    });
    if (!hits?.length) return null;
    return [...hits].sort((left, right) => this.snapPriority(left) - this.snapPriority(right))[0];
  }

  private snapPriority(hit: RaycastResult) {
    const snapClass = hit.snappingClass;
    const classPriority = snapClass === SnappingClass.POINT ? 0 : snapClass === SnappingClass.LINE ? 1 : 2;
    return classPriority * 1_000_000 + (hit.rayDistance ?? 0);
  }

  private acceptMeasurementPoint(point: THREE.Vector3) {
    if (!this.measurementStart) {
      this.measurementStart = point.clone();
      this.disposeObject(this.draftPoint);
      this.draftPoint = this.createPoints([this.measurementStart], 0xffb020, 10);
      this.scene.add(this.draftPoint);
      return;
    }
    const start = this.measurementStart;
    this.clearDraft();
    this.commitMeasurement(start, point, "pointToPoint");
  }

  private commitMeasurement(start: THREE.Vector3, end: THREE.Vector3, mode: MeasureMode) {
    const distance = start.distanceTo(end);
    if (!Number.isFinite(distance) || distance <= Number.EPSILON) return;
    const result: MeasurementResult = {
      id: this.nextMeasurementId++,
      mode,
      start: { x: start.x, y: start.y, z: start.z },
      end: { x: end.x, y: end.y, z: end.z },
      distance,
    };
    const label = document.createElement("div");
    label.className = "viewer-measurement-label";
    label.textContent = formatMeasurement(distance);
    label.hidden = true;
    this.host.append(label);
    const visual: MeasurementVisual = {
      result,
      line: this.createLine([start, end], 0xffb020),
      points: this.createPoints([start, end], 0xffb020, 9),
      label,
    };
    this.scene.add(visual.line, visual.points);
    this.measurements.push(visual);
    this.publishMeasurements();
  }

  private updateMeasurementVisual(visual: MeasurementVisual) {
    const start = new THREE.Vector3(visual.result.start.x, visual.result.start.y, visual.result.start.z);
    const end = new THREE.Vector3(visual.result.end.x, visual.result.end.y, visual.result.end.z);
    visual.line.geometry.dispose();
    visual.points.geometry.dispose();
    visual.line.geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    visual.points.geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    visual.label.textContent = formatMeasurement(visual.result.distance);
  }

  private drawSnapPreview(hit: RaycastResult | null) {
    this.disposeObject(this.snapPoint);
    this.disposeObject(this.snapEdge);
    this.snapPoint = null;
    this.snapEdge = null;
    if (!hit) return;
    this.snapPoint = this.createPoints([hit.point], 0x32d6ff, 11);
    this.scene.add(this.snapPoint);
    if (hit.snappedEdgeP1 && hit.snappedEdgeP2) {
      this.snapEdge = this.createLine([hit.snappedEdgeP1, hit.snappedEdgeP2], 0x32d6ff);
      this.scene.add(this.snapEdge);
    }
  }

  private createLine(points: THREE.Vector3[], color: number) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    line.renderOrder = 999;
    return line;
  }

  private createPoints(points: THREE.Vector3[], color: number, size: number) {
    const object = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }),
    );
    object.renderOrder = 1000;
    return object;
  }

  private publishMeasurements() {
    this.callbacks.onMeasurements(this.measurements.map((visual) => ({ ...visual.result })));
  }

  private clearDraft() {
    this.measurementStart = null;
    this.snapSequence++;
    if (this.snapFrame !== null) cancelAnimationFrame(this.snapFrame);
    this.snapFrame = null;
    this.queuedSnap = null;
    this.disposeObject(this.draftPoint);
    this.disposeObject(this.snapPoint);
    this.disposeObject(this.snapEdge);
    this.draftPoint = null;
    this.snapPoint = null;
    this.snapEdge = null;
  }

  private disposeMeasurement(visual: MeasurementVisual) {
    this.disposeObject(visual.line);
    this.disposeObject(visual.points);
    visual.label.remove();
  }

  private disposeObject(object: THREE.Line | THREE.Points | null) {
    if (!object) return;
    this.scene.remove(object);
    object.geometry.dispose();
    (object.material as THREE.Material).dispose();
  }

  private cancelSweep() {
    const pointerId = this.sweepStart?.pointerId;
    if (pointerId !== undefined && this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    this.sweepStart = null;
    this.sweepRectangle.hidden = true;
  }

  private updateSweepRectangle(endX: number, endY: number) {
    const start = this.sweepStart;
    if (!start) return;
    const fullyIncluded = isFullyIncludedSweep(start.localX, endX);
    this.sweepRectangle.classList.toggle("viewer-selection-rectangle-crossing", !fullyIncluded);
    this.sweepRectangle.style.left = `${Math.min(start.localX, endX)}px`;
    this.sweepRectangle.style.top = `${Math.min(start.localY, endY)}px`;
    this.sweepRectangle.style.width = `${Math.abs(endX - start.localX)}px`;
    this.sweepRectangle.style.height = `${Math.abs(endY - start.localY)}px`;
  }

  private localPoint(clientX: number, clientY: number) {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: THREE.MathUtils.clamp(clientX - bounds.left, 0, bounds.width),
      y: THREE.MathUtils.clamp(clientY - bounds.top, 0, bounds.height),
    };
  }

  private applyHostClasses() {
    this.host.classList.toggle("viewer-pan-active", this.tool === "pan");
    this.host.classList.toggle("viewer-multi-select-active", this.tool === "multiSelect");
    this.host.classList.toggle("viewer-measure-active", this.tool === "measure");
  }
}
