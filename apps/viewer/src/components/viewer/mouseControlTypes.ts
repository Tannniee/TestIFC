// SPDX-License-Identifier: MPL-2.0
import type { MutableRefObject, RefObject } from 'react';
import type { Renderer, PickResult, SnapTarget } from '@ifc-lite/renderer';
import type { MeshData } from '@ifc-lite/geometry';
import type { MeasurePoint, SnapVisualization, ActiveMeasurement, EdgeLockState, SectionPlane } from '@/store';
import type { HoverState, MeasurementConstraintEdge, OrthogonalAxis } from '@/store/types.js';

export interface MouseState {
  isDragging: boolean;
  isPanning: boolean;
  lastX: number;
  lastY: number;
  button: number;
  startX: number;
  startY: number;
  didDrag: boolean;
  /**
   * True while the user is mid-drag in rectangle-select mode (Ctrl/âŒ˜
   * held over the canvas in select tool). Suppresses orbit/pan in
   * the drag handlers and triggers `pickRect` on mouseup.
   */
  isRectSelecting?: boolean;
}

export interface UseMouseControlsParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: MutableRefObject<Renderer | null>;
  isInitialized: boolean;

  // Mouse state
  mouseStateRef: MutableRefObject<MouseState>;

  // Tool/state refs
  activeToolRef: MutableRefObject<string>;
  activeMeasurementRef: MutableRefObject<ActiveMeasurement | null>;
  snapEnabledRef: MutableRefObject<boolean>;
  edgeLockStateRef: MutableRefObject<EdgeLockState>;
  measurementConstraintEdgeRef: MutableRefObject<MeasurementConstraintEdge | null>;
  /** Section tool: when true, the next click picks a face for the clip plane (issue #243). */
  sectionPickModeRef: MutableRefObject<boolean>;
  /** Renderer model bounds; passed to face-pick so the cardinal-fallback `position` % is correct. */
  modelBoundsRef: MutableRefObject<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null>;

  // Visibility/selection refs
  hiddenEntitiesRef: MutableRefObject<Set<number>>;
  isolatedEntitiesRef: MutableRefObject<Set<number> | null>;
  selectedEntityIdRef: MutableRefObject<number | null>;
  selectedModelIndexRef: MutableRefObject<number | undefined>;
  clearColorRef: MutableRefObject<[number, number, number, number]>;

  // Section/geometry refs
  sectionPlaneRef: MutableRefObject<SectionPlane>;
  sectionRangeRef: MutableRefObject<{ min: number; max: number } | null>;
  geometryRef: MutableRefObject<MeshData[] | null>;

  // Measure raycast refs
  measureRaycastPendingRef: MutableRefObject<boolean>;
  measureRaycastFrameRef: MutableRefObject<number | null>;
  lastMeasureRaycastDurationRef: MutableRefObject<number>;
  lastHoverSnapTimeRef: MutableRefObject<number>;

  // Hover refs
  lastHoverCheckRef: MutableRefObject<number>;
  hoverTooltipsEnabledRef: MutableRefObject<boolean>;

  // Interaction state â€” set during drag, cleared on mouseup
  isInteractingRef: MutableRefObject<boolean>;

  // Click detection refs
  lastClickTimeRef: MutableRefObject<number>;
  lastClickPosRef: MutableRefObject<{ x: number; y: number } | null>;

  // Camera tracking
  lastCameraStateRef: MutableRefObject<{
    position: { x: number; y: number; z: number };
    rotation: { azimuth: number; elevation: number };
    distance: number;
    canvasWidth: number;
    canvasHeight: number;
  } | null>;

  // Callbacks
  handlePickForSelection: (pickResult: PickResult | null) => void;
  setHoverState: (state: HoverState & { entityId: number }) => void;
  /**
   * Called during a rectangle-selection drag with the current rect
   * (CSS pixels, canvas-relative). Passed `null` on drag end to clear
   * any visual overlay. The hook handles the actual `pickRect` call
   * + selection update internally; this callback is only for the
   * overlay visual.
   */
  setRectSelection?: (rect: { x0: number; y0: number; x1: number; y1: number } | null) => void;
  clearHover: () => void;
  openContextMenu: (entityId: number | null, screenX: number, screenY: number) => void;
  startMeasurement: (point: MeasurePoint) => void;
  updateMeasurement: (point: MeasurePoint) => void;
  finalizeMeasurement: () => void;
  setSnapTarget: (target: SnapTarget | null) => void;
  setSnapVisualization: (viz: Partial<SnapVisualization> | null) => void;
  setEdgeLock: (edge: { v0: { x: number; y: number; z: number }; v1: { x: number; y: number; z: number } }, meshExpressId: number, edgeT: number) => void;
  updateEdgeLockPosition: (edgeT: number, isCorner: boolean, cornerValence: number) => void;
  clearEdgeLock: () => void;
  incrementEdgeLockStrength: () => void;
  setMeasurementConstraintEdge: (edge: MeasurementConstraintEdge) => void;
  updateConstraintActiveAxis: (axis: OrthogonalAxis | null) => void;
  updateMeasurementScreenCoords: (projector: (worldPos: { x: number; y: number; z: number }) => { x: number; y: number } | null) => void;
  updateCameraRotationRealtime: (rotation: { azimuth: number; elevation: number }) => void;
  toggleSelection: (entityId: number) => void;
  calculateScale: () => void;
  getPickOptions: () => { isStreaming: boolean; hiddenIds: Set<number>; isolatedIds: Set<number> | null };
  hasPendingMeasurements: () => boolean;
  /** Section face-pick: set the clip plane through a world-space face (issue #243). */
  setSectionPlaneFromFace: (
    normal: [number, number, number],
    point:  [number, number, number],
    bounds?: { min: [number, number, number]; max: [number, number, number] },
  ) => void;
  /** Section face-pick: arm/disarm the "next click picks a face" mode. */
  setSectionPickMode: (enabled: boolean) => void;
  /**
   * Section face-pick hover preview (issue #243 follow-up). Set by the
   * dwell handler when the cursor pauses ~200ms over a face; cleared
   * (passed `null`) when the cursor leaves the canvas, moves to a
   * different face, or pick mode is disarmed. Purely visual â€” does not
   * touch `sectionPlane`.
   */
  setSectionPickPreview: (
    preview: { normal: [number, number, number]; point: [number, number, number]; faceKey: string } | null,
  ) => void;

  // Constants
  HOVER_SNAP_THROTTLE_MS: number;
  SLOW_RAYCAST_THRESHOLD_MS: number;
  hoverThrottleMs: number;
  /** When true, wheel zoom uses unrestricted pure-dolly mode (Cesium) */
  fastZoomRef: MutableRefObject<boolean>;
}

