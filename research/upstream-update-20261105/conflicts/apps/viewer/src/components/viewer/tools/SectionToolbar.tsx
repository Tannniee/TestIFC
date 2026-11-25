/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Section tool's bar on the HUD's top-center region (#5499, charter
 * #5478 §6; two rows since #7545):
 *
 *   ✂ SECTION │ ◉A  ◉B  ◉C ⋯ │ ＋ Add plane │                       │ ✕
 *   Flip │ 1.20 m ▾ │ Cap ▾ │ ◉ Cut │ 2D section
 *
 * Row 1 says WHICH planes exist (chips, in creation order, the active one
 * filled, plus the one menu that adds a plane); row 2 edits the ACTIVE plane,
 * so no control has to say which plane it means. With no plane yet, row 2
 * offers the ways to start a cut instead (#8672):
 *
 *   ✂ SECTION │ Views ▾ ✕
 *   New cut: Down (Z)  Front (Y)  Side (X) │ Face…  Box
 *
 * Row 1 is then short enough to always keep the heading and the Views label,
 * so a first-time user sees which tool is open and what it can do.
 *
 * Registered as the `section` row's `Bar` in `TOOL_HUD`, so `ToolOverlays`
 * places it (top-center, order 0); this component never positions itself.
 */

import { Scissors, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import { tourAnchor, TOUR_ANCHORS } from '@/lib/tours/anchors';
import {
  HudPopover,
  HudPopoverAnchor,
  HudToolbar,
  useHudBarTier,
} from '../../viewport-ui/hud';
<<<<<<< custom-r7
import { HudDivider, HudToggle } from '../../viewport-ui/hud/HudToggle';
import { AXIS_INFO } from './sectionConstants';
import { SectionCapControls } from './SectionCapControls';
import { STOREY_SNAP_TOLERANCE_M, useSectionDistance } from './useSectionDistance';
import { storeyCutElevation } from '@/lib/section/section-distance';
import { sectionBoxFromBounds, sectionBoxSize } from '@/lib/section/section-box';
import type { SectionPlaneAxis } from '@/store/types';
import { AlignmentSectionControls } from './AlignmentSectionControls';
import { chooseAlignmentMode, leaveAlignmentMode, useAlignmentToolState } from '@/lib/section/alignment-controller';
import { beginBoxDraw, cancelBoxDraw } from '@/lib/section/testifc-box-controller';

type AxisSegment = SectionPlaneAxis | 'face' | 'box' | 'alignment';
||||||| previous-upstream
import { HudDivider, HudToggle } from '../../viewport-ui/hud/HudToggle';
import { AXIS_INFO } from './sectionConstants';
import { SectionCapControls } from './SectionCapControls';
import { STOREY_SNAP_TOLERANCE_M, useSectionDistance } from './useSectionDistance';
import { storeyCutElevation } from '@/lib/section/section-distance';
import { sectionBoxFromBounds, sectionBoxSize } from '@/lib/section/section-box';
import type { SectionPlaneAxis } from '@/store/types';
import { AlignmentSectionControls } from './AlignmentSectionControls';
import { chooseAlignmentMode, leaveAlignmentMode, useAlignmentToolState } from '@/lib/section/alignment-controller';

type AxisSegment = SectionPlaneAxis | 'face' | 'box' | 'alignment';
=======
import { HudDivider } from '../../viewport-ui/hud/HudToggle';
import { SectionActivePlaneRow } from './SectionActivePlaneRow';
import { SectionAddMenu, SectionEmptyAdd } from './SectionAddMenu';
import { SectionPlaneChips } from './SectionPlaneChips';
import { SectionViewsMenu } from './SectionViewsMenu';
import { useSectionPlaneSet } from './useSectionPlaneSet';
import { SectionBarMeasureContext } from './SectionBarMeasure';
>>>>>>> github-main

/** One unbreakable run of controls on the bar. */
const GROUP = 'flex items-center gap-1';
/** One row of the bar; wraps only as a last resort in a very narrow lane. */
const ROW = 'flex flex-wrap items-center justify-center gap-1';
/** The bar's forms (#6315): with the caption; without it; and without it with icon-only controls. */
const TIER_CAPTION = 0;
const TIER_NO_CAPTION = 1;
const TIER_COMPACT = 2;
const OFFSCREEN = { position: 'fixed', top: -9999, left: -9999, visibility: 'hidden' } as const;

export function SectionToolbar() {
  const { t } = useTranslation();
  // The bar must fit the top-center lane as ONE block of rows: when it does not, the caption
  // steps down (#5975), then the controls drop their words, instead of the bar pushing out
  // of its lane (#6315) or breaking mid-group. The two fuller forms are measured offscreen;
  // the compact one is the smallest and the fallback.
  const { measureRef, tier } = useHudBarTier(TIER_COMPACT);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const { count, atLimit } = useSectionPlaneSet();

<<<<<<< custom-r7
  // The box fits the selection when there is one (the same bounds Frame
  // uses, assemblies resolved to their parts), else the placed model bounds;
  // with neither known there is nothing to cut with, so the segment stays.
  const fitBox = useCallback(() => {
    const selected = hasSelection ? useViewerStore.getState().cameraCallbacks.selectionBounds?.() : null;
    const next = sectionBoxFromBounds(selected) ?? sectionBoxFromBounds(distance.bounds);
    if (next) setSectionBox(next);
  }, [hasSelection, distance.bounds, setSectionBox]);

  // A cardinal segment is a cardinal cut (drops any face-picked plane and
  // disarms the pick); from a face-picked plane, its own axis keeps the side
  // on screen (#5644, `resetSectionToAxis`). The Face segment arms the next
  // click — again, from a custom plane, so "pick another face" is the same
  // gesture.
  const handleAxis = useCallback((next: AxisSegment) => {
    cancelBoxDraw();
    if (next === 'alignment') { chooseAlignmentMode(); return; }
    leaveAlignmentMode();
    if (next === 'face') {
      setSectionPickMode(true);
      return;
    }
    if (sectionPickMode) setSectionPickMode(false);
    if (next === 'box') {
      if (!beginBoxDraw(distance.bounds)) fitBox();
      return;
    }
    resetSectionToAxis(useViewerStore.getState, next);
  }, [sectionPickMode, setSectionPickMode, fitBox, distance.bounds]);

  // Scrubbing thins a loaded scan to a quarter of its points so a >10M-point
  // cloud keeps up with the drag; restored on release (and on unmount, by
  // `SectionOverlay`).
  const handleScrubStart = useCallback(() => {
    if (pointCloudAssetCount > 0) setPreviewStride(4);
  }, [pointCloudAssetCount, setPreviewStride]);
  const handleScrubEnd = useCallback(() => setPreviewStride(1), [setPreviewStride]);

  // The Drawing panel is a bottom-strip panel (#5493): opening goes through
  // the table so it replaces whichever bottom panel is docked; the drawing
  // is cleared first so it regenerates against the current cut.
  const handleDrawing = useCallback(() => {
    if (drawingOpen) {
      toggleBottomPanel('drawing');
      return;
    }
    clearDrawing();
    openPanelInHome('drawing');
  }, [drawingOpen, toggleBottomPanel, clearDrawing, openPanelInHome]);

  const showStoreys = !isCustom && sectionPlane.axis === 'down' && distance.kind === 'world' && distance.storeys.length > 0;
  const unit = distance.kind === 'percent' ? t('sectionTool.distance.percentUnit') : t('sectionTool.distance.unit');
  const boxSize = box ? sectionBoxSize(box) : null;

  // The Cap popover is anchored to the whole bar, not to its trigger: when
  // the bar wraps in a narrow top-center lane the trigger can sit on a
  // middle row, and a trigger-anchored popover then opens over the rows
  // below it (#5481). Anchored to the bar it always opens under the bar.
||||||| previous-upstream
  // The box fits the selection when there is one (the same bounds Frame
  // uses, assemblies resolved to their parts), else the placed model bounds;
  // with neither known there is nothing to cut with, so the segment stays.
  const fitBox = useCallback(() => {
    const selected = hasSelection ? useViewerStore.getState().cameraCallbacks.selectionBounds?.() : null;
    const next = sectionBoxFromBounds(selected) ?? sectionBoxFromBounds(distance.bounds);
    if (next) setSectionBox(next);
  }, [hasSelection, distance.bounds, setSectionBox]);

  // A cardinal segment is a cardinal cut (drops any face-picked plane and
  // disarms the pick); from a face-picked plane, its own axis keeps the side
  // on screen (#5644, `resetSectionToAxis`). The Face segment arms the next
  // click — again, from a custom plane, so "pick another face" is the same
  // gesture.
  const handleAxis = useCallback((next: AxisSegment) => {
    if (next === 'alignment') { chooseAlignmentMode(); return; }
    leaveAlignmentMode();
    if (next === 'face') {
      setSectionPickMode(true);
      return;
    }
    if (sectionPickMode) setSectionPickMode(false);
    if (next === 'box') {
      fitBox();
      return;
    }
    resetSectionToAxis(useViewerStore.getState, next);
  }, [sectionPickMode, setSectionPickMode, fitBox]);

  // Scrubbing thins a loaded scan to a quarter of its points so a >10M-point
  // cloud keeps up with the drag; restored on release (and on unmount, by
  // `SectionOverlay`).
  const handleScrubStart = useCallback(() => {
    if (pointCloudAssetCount > 0) setPreviewStride(4);
  }, [pointCloudAssetCount, setPreviewStride]);
  const handleScrubEnd = useCallback(() => setPreviewStride(1), [setPreviewStride]);

  // The Drawing panel is a bottom-strip panel (#5493): opening goes through
  // the table so it replaces whichever bottom panel is docked; the drawing
  // is cleared first so it regenerates against the current cut.
  const handleDrawing = useCallback(() => {
    if (drawingOpen) {
      toggleBottomPanel('drawing');
      return;
    }
    clearDrawing();
    openPanelInHome('drawing');
  }, [drawingOpen, toggleBottomPanel, clearDrawing, openPanelInHome]);

  const showStoreys = !isCustom && sectionPlane.axis === 'down' && distance.kind === 'world' && distance.storeys.length > 0;
  const unit = distance.kind === 'percent' ? t('sectionTool.distance.percentUnit') : t('sectionTool.distance.unit');
  const boxSize = box ? sectionBoxSize(box) : null;

  // The Cap popover is anchored to the whole bar, not to its trigger: when
  // the bar wraps in a narrow top-center lane the trigger can sit on a
  // middle row, and a trigger-anchored popover then opens over the rows
  // below it (#5481). Anchored to the bar it always opens under the bar.
=======
>>>>>>> github-main
  const caption = (
    <span className="flex items-center gap-1 whitespace-nowrap px-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
      <Scissors aria-hidden className="h-3.5 w-3.5 text-overlay-accent" />
      {t('sectionTool.heading')}
    </span>
  );
  const empty = count === 0;
  const planes = empty ? null : (
    <>
      <SectionPlaneChips />
      <SectionAddMenu atLimit={atLimit} />
    </>
  );
  // Row 2: the active plane's controls, or with no plane yet the ways to start a cut.
  const row2 = (compact: boolean) => (empty ? <SectionEmptyAdd /> : <SectionActivePlaneRow compact={compact} />);
  const close = (compact: boolean) => (
    <>
      <HudDivider />
<<<<<<< custom-r7
      <HudToggle
        pressed={drawingOpen}
        onPressedChange={handleDrawing}
        title={t(drawingOpen ? 'sectionTool.drawing.closeTitle' : 'sectionTool.drawing.openTitle')}
        icon={<PencilRuler aria-hidden className="h-3.5 w-3.5" />}
      >
        {t('sectionTool.drawing.label')}
      </HudToggle>
      <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={() => { cancelBoxDraw(); setActiveTool('select'); }} title={t('sectionTool.closeTitle')} aria-label={t('sectionTool.closeTitle')}>
||||||| previous-upstream
      <HudToggle
        pressed={drawingOpen}
        onPressedChange={handleDrawing}
        title={t(drawingOpen ? 'sectionTool.drawing.closeTitle' : 'sectionTool.drawing.openTitle')}
        icon={<PencilRuler aria-hidden className="h-3.5 w-3.5" />}
      >
        {t('sectionTool.drawing.label')}
      </HudToggle>
      <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={() => setActiveTool('select')} title={t('sectionTool.closeTitle')} aria-label={t('sectionTool.closeTitle')}>
=======
      <SectionViewsMenu compact={compact} />
      <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={() => setActiveTool('select')} title={t('sectionTool.closeTitle')} aria-label={t('sectionTool.closeTitle')}>
>>>>>>> github-main
        <X className="h-3.5 w-3.5" />
      </Button>
    </>
  );

  // With no plane, row 1 holds only the heading, Views and close, so it never needs to step down.
  const row1 = (withCaption: boolean, compact: boolean) => (
    <span className={GROUP}>
      {(withCaption || empty) && caption}
      {withCaption && !empty && <HudDivider />}
      {planes}
      {close(compact && !empty)}
    </span>
  );
  /** One offscreen copy of the whole bar in a given form, to measure how wide that form is. */
  const measured = (form: number, withCaption: boolean) => (
    <HudPopover>
      <div ref={measureRef(form)} aria-hidden="true" inert style={OFFSCREEN} className="flex w-max flex-col gap-1 px-1.5">
        <SectionBarMeasureContext.Provider value>
          <div className="flex flex-nowrap items-center justify-center gap-1">{row1(withCaption, false)}</div>
          <div className="flex flex-nowrap items-center justify-center gap-1">{row2(false)}</div>
        </SectionBarMeasureContext.Provider>
      </div>
    </HudPopover>
  );

  return (
    <>
      {measured(TIER_CAPTION, true)}
      {measured(TIER_NO_CAPTION, false)}
      {/* The Cap popover is anchored to the whole bar, not to its trigger: when
          the bar wraps in a narrow top-center lane the trigger can sit on a
          middle row, and a trigger-anchored popover then opens over the rows
          below it (#5481). Anchored to the bar it always opens under the bar. */}
      <HudPopover>
        <HudPopoverAnchor asChild>
          <HudToolbar
            data-tool-bar="section"
            data-testid="section-toolbar"
            data-bar-tier={tier}
            className="flex-col flex-nowrap"
            {...tourAnchor(TOUR_ANCHORS.sectionPanel)}
          >
            <div className={ROW}>{row1(tier === TIER_CAPTION, tier === TIER_COMPACT)}</div>
            <div className={ROW} data-testid={empty ? 'section-start-row' : 'section-active-row'}>
              {row2(tier === TIER_COMPACT)}
            </div>
          </HudToolbar>
        </HudPopoverAnchor>
      </HudPopover>
    </>
  );
}
