<script lang="ts">
  import SemanticStatus from "./lib/SemanticStatus.svelte";
  import ProjectBrowser from "./lib/ProjectBrowser.svelte";
  import PropertiesPanel from "./lib/PropertiesPanel.svelte";
  import WorkspaceTabs from "./lib/WorkspaceTabs.svelte";
  import { activeDocument, activeView, emptyWorkspace } from "./lib/workspace-contracts";
  import CacheSettings from "./lib/CacheSettings.svelte";
  import type { SectionBoxState } from "./lib/viewer-contracts";
  import { onMount } from "svelte";
  import AppRail from "./lib/AppRail.svelte";
  import HelpDialog from "./lib/HelpDialog.svelte";
  import Icon from "./lib/Icon.svelte";
  import ModelLoadDialog from "./lib/ModelLoadDialog.svelte";
  import { isOpeningModel } from "./lib/load-progress";
  import ViewCube from "./lib/ViewCube.svelte";
  import ViewerToolbar from "./lib/ViewerToolbar.svelte";
  import { AppShellService, type AppSettings, type BridgeProgress, type CameraOrientation, type FragmentMetrics, type MeasureMode, type SectionPlaneDefinition, type SectionSide, type ViewDirection, type ViewerProgress, type ViewerSelection, type ViewerTool, type ViewportBackground, type ViewPreset } from "./lib/app-shell";
  import { copy, helpTopics, type CopyText, type Locale } from "./lib/i18n";
  import { applyGeometryProgress, applySemanticProgress, beginModelLoad, emptyModelReadiness, geometryReady } from "./lib/model-readiness";

  const sectionAxes = ["x", "y", "z"] as const;

  let locale: Locale = "vi";
  let mode: "light" | "dark" = "light";
  let inspectorOpen = false;
  let displaySettingsOpen = false;
  let boxZoomActive = false;
  let sectionPanelOpen = false;
  let sectionBox: SectionBoxState | null = null;
  let sectionBoxPanelOpen = false;
  let sectionBoxPicking = false;
  let sectionMode: "surface" | "coordinate" = "surface";
  let sectionPickActive = false;
  let sectionAxis: "x" | "y" | "z" = "x";
  let sectionCoordinate = 0;
  let sectionSide: SectionSide = "positive";
  let sectionDefinition: SectionPlaneDefinition | null = null;
  let dragActive = false;
  let dragDepth = 0;
  let helpOpen = false;
  let identityExpanded = true;
  let selectedTopic = 0;
  let fileInput: HTMLInputElement;
  let viewerHost: HTMLDivElement;
  const shell = new AppShellService();
  let workspace = emptyWorkspace();
  let browserOpen = false;
  let browserWidth = 240;
  let propertiesViewContext = false;
  const resizeCleanups = new Set<() => void>();
  let browserResizing = false;
  $: workspaceDocument = activeDocument(workspace);
  $: workspaceView = activeView(workspace);
  $: runtimeModelKey = `${workspace.activeDocumentId ?? ""}:${shell.activeModel?.modelId ?? ""}`;
  let appVersion = "1.0.3";
  let modelStatus: string | null = null;
  let errorMessage: string | null = null;
  let selectedElement: ViewerSelection | null = null;
  let multiSelectionCount = 0;
  let interactionTool: ViewerTool = "pan";
  let measureMode: MeasureMode = "pointToPoint";
  let viewerProgress: ViewerProgress | null = null;
  let bridgeProgress: BridgeProgress | null = null;
  let readiness = emptyModelReadiness();
  let activeReadiness = emptyModelReadiness();
  let fragmentMetrics: FragmentMetrics | null = null;
  let drawerWidth = 300;
  let appLoadSequence = 0;
  let cancellingLoad = false;
  let gridVisible = true;
  let viewportBackground: ViewportBackground = "gray";
  let wheelZoomSpeed = 1;
  let rotationSpeed = 1;
  let cameraOrientation: CameraOrientation = { x: 0, y: 0, z: 0, w: 1 };
  let themeTransitioning = false;
  let themeTransitionTimer: number | null = null;

  $: t = copy[locale];
  $: topics = helpTopics[locale];
  $: hasModel = geometryReady(activeReadiness);
  $: themeLabel = mode === "light" ? t.themeDark : t.themeLight;
  $: viewCubeText = {
    viewCube: t.viewCube,
    directions: t.viewCubeDirections,
    quickViews: t.viewCubeQuickViews,
    viewFrom: t.viewCubeViewFrom,
    edge: t.viewCubeEdge,
    corner: t.viewCubeCorner,
    left: t.viewLeft,
    right: t.viewRight,
    back: t.viewBack,
    front: t.viewFront,
    top: t.viewTop,
    bottom: t.viewBottom,
    homeIso: t.viewHomeIso,
  };

  onMount(async () => {
    try {
      const health = await shell.health();
      appVersion = health.appVersion;
    } catch {
      // The source UI also runs without the Python bridge during visual work.
    }
  });

  onMount(() => {
    let cancelled = false;
    const fallbackSettings = shell.readLocalSettings();
    applySettings(fallbackSettings);
    const unsubscribeWorkspace = shell.subscribeWorkspace(state => {
      workspace = state;
      if (!state.busy) {
        const doc = activeDocument(state);
        activeReadiness = doc?.readiness ?? emptyModelReadiness();
        modelStatus = doc?.filename ?? null;
        if (doc) { viewerProgress = doc.readiness.geometry; bridgeProgress = doc.readiness.semantic; }
        else if (!state.documents.length) { viewerProgress = null; bridgeProgress = null; }
        errorMessage = state.error;
      }
    });

    const initializeViewer = async () => {
      const settings = await shell.initializeViewer(viewerHost, {
        onProgress(progress) {
          if (progress.loadSequence > readiness.loadSequence) readiness = beginModelLoad(progress.loadSequence, progress.detail ?? "IFC");
          const next = applyGeometryProgress(readiness, progress);
          if (next === readiness) return;
          readiness = next;
          viewerProgress = readiness.geometry;
          if (progress.stage === "ready") activeReadiness = readiness;
          errorMessage = progress.stage === "error" ? progress.detail ?? "Viewer error" : null;
        },
        onBridgeProgress(progress) {
          activeReadiness = applySemanticProgress(activeReadiness, progress);
          const next = applySemanticProgress(readiness, progress);
          readiness = next;
          bridgeProgress = hasModel ? activeReadiness.semantic : readiness.semantic;
        },
        onFragmentMetrics(metrics) {
          if (
            metrics.loadSequence === readiness.loadSequence
            && metrics.modelHash === readiness.modelHash
          ) {
            fragmentMetrics = metrics;
            window.dispatchEvent(new CustomEvent("ifc-fragment-metrics", { detail: metrics }));
          }
        },
        onSelection(selection) {
          selectedElement = selection;
          propertiesViewContext = false;
          if (selection) inspectorOpen = true;
        },
        onMultiSelectionChange(count) {
          multiSelectionCount = count;
        },
        onMeasurementChange() {},
        onBoxZoomActiveChange(active) {
          boxZoomActive = active;
        },
        onSectionPickActiveChange(active) {
          sectionPickActive = active;
        },
        onSectionPlaneChange(section) {
          sectionDefinition = section;
          if (section) sectionSide = section.side;
        },
        onSectionBoxChange(box) { sectionBox = box; sectionBoxPanelOpen = Boolean(box); },
        onSectionBoxPickActiveChange(active) { sectionBoxPicking = active; },
        onSectionBoxCreated() { sectionBoxPanelOpen = true; inspectorOpen = true; propertiesViewContext = true; },
        onSectionBoxEdit() { sectionBoxPanelOpen = true; inspectorOpen = true; propertiesViewContext = true; },
        onInteractionError(message) { errorMessage = message; },
        onCameraOrientationChange(orientation) {
          cameraOrientation = orientation;
        },
      }, fallbackSettings);
      if (cancelled) {
        void shell.dispose();
        return;
      }
      applySettings(settings);
    };

    void initializeViewer();
    return () => {
      unsubscribeWorkspace();
      for (const cleanup of resizeCleanups) cleanup();
      cancelled = true;
      if (themeTransitionTimer !== null) window.clearTimeout(themeTransitionTimer);
      void shell.dispose();
    };
  });

  function applySettings(settings: AppSettings) {
    locale = settings.locale;
    mode = settings.mode;
    gridVisible = settings.gridVisible;
    viewportBackground = settings.viewportBackground;
    wheelZoomSpeed = settings.wheelZoomSpeed;
    rotationSpeed = settings.rotationSpeed;
    document.documentElement.lang = locale;
    shell.applyViewerSettings(settings);
  }

  function currentSettings(): AppSettings {
    return { schemaVersion: 1, locale, mode, gridVisible, viewportBackground, wheelZoomSpeed, rotationSpeed };
  }

  function persistSettings(delay = 0) {
    shell.persistSettings(currentSettings(), delay);
  }

  function progressText(progress: ViewerProgress | null, text: CopyText): string | null {
    if (!progress) return null;
    if (progress.stage === "error") return progress.detail ?? "Error";
    const labels: Record<ViewerProgress["stage"], string> = {
      idle: text.noModel,
      cache: text.cache,
      reading: text.opening,
      hashing: text.loadHash,
      converting: text.converting,
      loading: text.loading,
      finalizing: text.loadFinalize,
      cancelled: text.loadCancelled,
      ready: text.ready,
      error: "Error",
    };
    const percent = progress.progress !== undefined && progress.stage !== "ready"
      ? ` ${Math.round(progress.progress * 100)}%`
      : "";
    const detail = progress.detail ? ` · ${progress.detail}` : "";
    return `${labels[progress.stage]}${percent}${detail}`;
  }

  function bridgeText(progress: BridgeProgress | null, language: Locale): string {
    if (!progress) return language === "vi" ? "INDEX: chưa bắt đầu" : "INDEX: idle";
    const labels: Record<BridgeProgress["stage"], string> = {
      idle: language === "vi" ? "chưa bắt đầu" : "idle",
      activating: language === "vi" ? "đang kích hoạt mô hình" : "activating model",
      uploading: language === "vi" ? "đang nhận file" : "receiving file",
      indexing_hot: language === "vi" ? "đang lập chỉ mục chính" : "building hot index",
      stalled: language === "vi" ? "chưa có tiến triển" : "no recent progress",
      indexing_cold: language === "vi" ? "đang lập chỉ mục chi tiết" : "building detail index",
      cancelled: language === "vi" ? "đã hủy" : "cancelled",
      ready: language === "vi" ? "sẵn sàng" : "ready",
      error: language === "vi" ? "có lỗi" : "error",
    };
    const percent = progress.progress === undefined ? "" : ` ${Math.round(progress.progress * 100)}%`;
    const detail = progress.stage === "error" && progress.detail ? ` · ${progress.detail}` : "";
    return `INDEX: ${labels[progress.stage]}${percent}${detail}`;
  }

  function switchLanguage() {
    locale = locale === "vi" ? "en" : "vi";
    selectedTopic = 0;
    document.documentElement.lang = locale;
    persistSettings();
  }

  function toggleTheme() {
    themeTransitioning = true;
    mode = mode === "light" ? "dark" : "light";
    persistSettings();
    if (themeTransitionTimer !== null) window.clearTimeout(themeTransitionTimer);
    themeTransitionTimer = window.setTimeout(() => {
      themeTransitioning = false;
      themeTransitionTimer = null;
    }, 340);
  }

  function openFilePicker() {
    fileInput.click();
  }

  function openHelp() {
    helpOpen = true;
  }

  function closeHelp() {
    helpOpen = false;
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && workspace.busy && isOpeningModel(viewerProgress)) { event.preventDefault(); void cancelIfcLoad(); return; }
    if (event.key === "Escape" && sectionBoxPicking) {
      event.preventDefault();
      shell.setBoxZoomEnabled(false);
      return;
    }
    if (event.key === "Escape" && interactionTool !== "pan") {
      event.preventDefault();
      void quitInteractionTool();
      return;
    }
    if (event.key === "Escape" && boxZoomActive) {
      shell.setBoxZoomEnabled(false);
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && sectionPickActive) {
      shell.setSectionPickEnabled(false);
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && displaySettingsOpen) {
      displaySettingsOpen = false;
      event.preventDefault();
      return;
    }
  }

  function startDrawerResize(event: PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = drawerWidth;
    const move = (moveEvent: PointerEvent) => {
      drawerWidth = Math.min(640, Math.max(280, startWidth + startX - moveEvent.clientX));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      resizeCleanups.delete(stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    resizeCleanups.add(stop);
  }
  function startBrowserResize(event: PointerEvent) {
    event.preventDefault();
    browserResizing = true;
    const start = event.clientX, width = browserWidth;
    const move = (e: PointerEvent) => { browserWidth = Math.min(380,Math.max(180,width+e.clientX-start)); };
    const stop = () => { browserResizing = false; window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",stop); window.removeEventListener("pointercancel",stop); resizeCleanups.delete(stop); };
    resizeCleanups.add(stop); window.addEventListener("pointermove",move); window.addEventListener("pointerup",stop); window.addEventListener("pointercancel",stop);
  }

  function resizeDrawerByKeyboard(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    drawerWidth = Math.min(640, Math.max(280, drawerWidth + (event.key === "ArrowLeft" ? 16 : -16)));
  }

  function toggleDisplaySettings() {
    displaySettingsOpen = !displaySettingsOpen;
    if (displaySettingsOpen) {
      sectionPanelOpen = false;
      shell.setSectionPickEnabled(false);
    }
  }

  function toggleBoxZoom() {
    const enabled = !boxZoomActive;
    selectTool("pan");
    shell.setBoxZoomEnabled(enabled);
  }

  function toggleSectionPanel() {
    if (workspaceView?.type === "sectionBox") { errorMessage = "Section Plane: chuyển sang 3D View trước."; return; }
    sectionPanelOpen = !sectionPanelOpen;
    if (sectionPanelOpen) displaySettingsOpen = false;
    else shell.setSectionPickEnabled(false);
  }

  function startSectionPick() {
    sectionMode = "surface";
    selectTool("pan");
    shell.setSectionPickEnabled(true);
  }

  function selectTool(tool: ViewerTool) {
    interactionTool = tool;
    if (tool !== "pan") {
      shell.setBoxZoomEnabled(false);
      shell.setSectionPickEnabled(false);
    }
    shell.setTool(tool);
  }

  function changeMeasureMode(nextMode: MeasureMode) {
    measureMode = nextMode;
    shell.setMeasureMode(nextMode);
  }

  async function quitInteractionTool() {
    interactionTool = await shell.quitTool();
  }

  function applyCoordinateSection() {
    const point = { x: 0, y: 0, z: 0 };
    const normal = { x: 0, y: 0, z: 0 };
    point[sectionAxis] = sectionCoordinate;
    normal[sectionAxis] = 1;
    shell.setSectionPlane({ point, normal, side: sectionSide });
  }

  function changeSectionSide(side: SectionSide) {
    sectionSide = side;
    shell.setSectionSide(side);
  }

  function flipSectionSide() {
    changeSectionSide(sectionSide === "positive" ? "negative" : "positive");
  }

  function clearSection() {
    shell.setSectionPickEnabled(false);
    shell.clearSectionPlane();
  }

  function formatVector(vector: { x: number; y: number; z: number }) {
    return `${vector.x.toFixed(3)}, ${vector.y.toFixed(3)}, ${vector.z.toFixed(3)}`;
  }

  function changeView(preset: ViewPreset) {
    shell.setView(preset);
  }

  function changeViewDirection(direction: ViewDirection) {
    shell.setViewDirection(direction);
  }

  function orbitFromViewCube(deltaAzimuth: number, deltaPolar: number) {
    shell.orbitView(deltaAzimuth, deltaPolar);
  }

  function changeGridVisibility(visible: boolean) {
    gridVisible = visible;
    shell.setGridVisible(visible);
    persistSettings();
  }

  function changeViewportBackground(background: ViewportBackground) {
    viewportBackground = background;
    shell.setBackground(background);
    persistSettings();
  }

  function changeWheelZoomSpeed(speed: number) {
    wheelZoomSpeed = Math.min(3, Math.max(0.25, speed));
    shell.setWheelZoomSpeed(wheelZoomSpeed);
    persistSettings(160);
  }

  function changeRotationSpeed(speed: number) {
    rotationSpeed = Math.min(3, Math.max(0.25, speed));
    shell.setRotationSpeed(rotationSpeed);
    persistSettings(160);
  }

  function beginSectionBox() {
    sectionPanelOpen = displaySettingsOpen = sectionBoxPanelOpen = false;
    interactionTool = "pan";
    inspectorOpen = true; propertiesViewContext = true;
    void shell.beginSectionBox().catch(reportWorkspaceError);
  }
  function reportWorkspaceError(error: unknown) { if (!shell.isCancelledLoad(error)) errorMessage = error instanceof Error ? error.message : String(error); }

  async function openIfcFile(file: File) {
    if (cancellingLoad) return;
    errorMessage = null;
    if (!/\.ifc$/i.test(file.name)) {
      errorMessage = t.unsupported;
      return;
    }
    const sequence = ++appLoadSequence;
    readiness = beginModelLoad(sequence, file.name);
    viewerProgress = readiness.geometry;
    if (!hasModel) bridgeProgress = readiness.semantic;
    modelStatus = `${t.opening} ${file.name}`;
    try {
      await shell.load(file);
      if (sequence !== appLoadSequence) return;
      modelStatus = file.name;
    } catch (error) {
      if (shell.isCancelledLoad(error) || sequence !== appLoadSequence) return;
      const message = error instanceof Error ? error.message : String(error);
      errorMessage = message;
      const progress: ViewerProgress = {
        loadSequence: readiness.loadSequence,
        modelHash: readiness.modelHash,
        stage: "error",
        detail: message,
      };
      readiness = applyGeometryProgress(readiness, progress);
      viewerProgress = readiness.geometry;
      modelStatus = activeReadiness.fileName;
      bridgeProgress = activeReadiness.semantic;
    }
  }

  async function cancelIfcLoad() {
    if (cancellingLoad) return;
    cancellingLoad = true;
    const sequence = ++appLoadSequence;
    try {
      await shell.cancelLoad();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      readiness = { ...readiness, loadSequence: sequence,
        geometry: { loadSequence: sequence, modelHash: readiness.modelHash, stage: "cancelled" },
        semantic: { loadSequence: sequence, modelHash: readiness.modelHash, stage: "cancelled" } };
      viewerProgress = readiness.geometry;
      bridgeProgress = readiness.semantic;
      bridgeProgress = hasModel ? activeReadiness.semantic : readiness.semantic;
      modelStatus = activeReadiness.fileName ?? t.loadCancelled;
      cancellingLoad = false;
    }
  }

  async function handleFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await openIfcFile(file);
    input.value = "";
  }

  function handleDragEnter(event: DragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    dragDepth += 1;
    dragActive = true;
  }

  function handleDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent) {
    if (!dragActive) return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    dragActive = dragDepth > 0;
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragDepth = 0;
    dragActive = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    const file = files.find((candidate) => /\.ifc$/i.test(candidate.name));
    if (!file) {
      errorMessage = t.unsupported;
      return;
    }
    void openIfcFile(file);
  }
</script>

<svelte:head><title>IFC Viewer</title></svelte:head>
<svelte:window onkeydown={handleGlobalKeydown} />

<main class={`app-shell qn-theme${themeTransitioning ? " theme-transitioning" : ""}`} data-mode={mode}>
  <input bind:this={fileInput} class="file-input" type="file" accept=".ifc" onchange={handleFile} />
  <AppRail
    text={t}
    {mode}
    hasModel={hasModel && !workspace.busy}
    {boxZoomActive}
    sectionActive={sectionPanelOpen || sectionPickActive || Boolean(sectionDefinition)}
    sectionBoxActive={sectionBoxPicking || Boolean(sectionBox?.enabled)}
    {displaySettingsOpen}
    {inspectorOpen}
    {helpOpen}
    {themeLabel}
    onOpen={openFilePicker}
    onFit={() => shell.fit()}
    onBoxZoom={toggleBoxZoom}
    onSection={toggleSectionPanel}
    onSectionBox={beginSectionBox}
    onDisplaySettings={toggleDisplaySettings}
    onTheme={toggleTheme}
    onLanguage={switchLanguage}
    onInspector={() => (inspectorOpen = !inspectorOpen)}
    onHelp={openHelp}
  />

  <section
    class:viewer-drop-active={dragActive}
    class:browser-resizing={browserResizing}
    class="viewer-surface"
    style={`--workspace-top: ${workspaceDocument ? 68 : 34}px; --browser-width: ${browserWidth}px; --properties-width: ${drawerWidth}px; --workspace-left: ${browserOpen ? browserWidth : 0}px; --workspace-right: ${inspectorOpen ? drawerWidth : 0}px`}
    aria-label={t.workspace}
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    <WorkspaceTabs state={workspace} onDocument={id => void shell.activateDocument(id).catch(reportWorkspaceError)}
      onView={id => void shell.activateView(id).catch(reportWorkspaceError)}
      onCloseDocument={id => void shell.closeDocument(id).catch(reportWorkspaceError)}
      onCloseView={id => void shell.closeView(id).catch(reportWorkspaceError)} onOpen={openFilePicker} onBrowser={() => (browserOpen = !browserOpen)} />
    {#if browserOpen}
      <ProjectBrowser state={workspace} modelKey={runtimeModelKey} service={shell.modelData}
        onView={id=>void shell.activateView(id).catch(reportWorkspaceError)} onSelect={ids=>void shell.selectItems(ids).catch(reportWorkspaceError)}
        onExpanded={ids=>shell.setExpandedNodes(ids)} onClose={()=>browserOpen=false} onResize={startBrowserResize} />
    {/if}
    <div bind:this={viewerHost} class="viewer-mount"></div>
    {#if sectionBoxPicking}<p class="viewer-sweep-hint">{locale === "vi" ? "Section Box · Quét vùng trên Top View · Esc để hủy" : "Section Box · Drag a region in Top View · Esc to cancel"}</p>{/if}
    <ViewerToolbar
      text={t}
      hasModel={hasModel && !workspace.busy}
      tool={interactionTool}
      {measureMode}
      onTool={selectTool}
      onMeasureMode={changeMeasureMode}
    />
    <div class="view-cube-host">
      <ViewCube
        disabled={!hasModel || workspace.busy || sectionBoxPicking}
        orientation={cameraOrientation}
        text={viewCubeText}
        onDirection={changeViewDirection}
        onIso={() => changeView("iso")}
        onOrbit={orbitFromViewCube}
      />
    </div>
    {#if displaySettingsOpen}
      <section class="viewer-settings" aria-label={t.displaySettings}>
        <header class="viewer-settings__header">
          <h2>{t.displaySettings}</h2>
          <button aria-label={t.close} onclick={() => (displaySettingsOpen = false)}>×</button>
        </header>
        <CacheSettings {locale} busy={isOpeningModel(viewerProgress)} loadInventory={() => shell.cacheInventory()} clearCache={scope => shell.clearCache(scope)} />
        <label class="viewer-settings__toggle">
          <input type="checkbox" checked={gridVisible} onchange={(event) => changeGridVisibility(event.currentTarget.checked)} />
          <span>{t.showGrid}</span>
        </label>
        <label class="viewer-settings__slider">
          <span class="viewer-settings__slider-label"><span>{t.wheelZoomSpeed}</span><output>{wheelZoomSpeed.toFixed(2)}×</output></span>
          <input
            type="range"
            min="0.25"
            max="3"
            step="0.25"
            value={wheelZoomSpeed}
            aria-label={t.wheelZoomSpeed}
            oninput={(event) => changeWheelZoomSpeed(event.currentTarget.valueAsNumber)}
          />
        </label>
        <label class="viewer-settings__slider">
          <span class="viewer-settings__slider-label"><span>{t.rotationSpeed}</span><output>{rotationSpeed.toFixed(2)}×</output></span>
          <input type="range" min="0.25" max="3" step="0.25" value={rotationSpeed}
            aria-label={t.rotationSpeed} oninput={(event) => changeRotationSpeed(event.currentTarget.valueAsNumber)} />
        </label>
        <fieldset class="viewer-settings__backgrounds">
          <legend>{t.background}</legend>
          <div class="viewer-settings__choices">
            <label class:viewer-settings__choice--active={viewportBackground === "gray"} class="viewer-settings__choice">
              <input type="radio" name="viewport-background" checked={viewportBackground === "gray"} onchange={() => changeViewportBackground("gray")} />
              <span class="background-swatch background-swatch-gray"></span><span>{t.backgroundGray}</span>
            </label>
            <label class:viewer-settings__choice--active={viewportBackground === "white"} class="viewer-settings__choice">
              <input type="radio" name="viewport-background" checked={viewportBackground === "white"} onchange={() => changeViewportBackground("white")} />
              <span class="background-swatch background-swatch-white"></span><span>{t.backgroundWhite}</span>
            </label>
            <label class:viewer-settings__choice--active={viewportBackground === "oled"} class="viewer-settings__choice">
              <input type="radio" name="viewport-background" checked={viewportBackground === "oled"} onchange={() => changeViewportBackground("oled")} />
              <span class="background-swatch background-swatch-oled"></span><span>{t.backgroundOled}</span>
            </label>
          </div>
        </fieldset>
      </section>
    {/if}
    {#if sectionPanelOpen}
      <section class="viewer-section-panel" aria-label={t.sectionPlane}>
        <header class="viewer-settings__header">
          <h2>{t.sectionPlane}</h2>
          <button aria-label={t.close} onclick={() => { sectionPanelOpen = false; shell.setSectionPickEnabled(false); }}>×</button>
        </header>

        <div class="viewer-section-tabs" role="tablist" aria-label={t.sectionMode}>
          <button class:viewer-section-tab-active={sectionMode === "surface"} role="tab" aria-selected={sectionMode === "surface"} onclick={() => (sectionMode = "surface")}>{t.sectionSurface}</button>
          <button class:viewer-section-tab-active={sectionMode === "coordinate"} role="tab" aria-selected={sectionMode === "coordinate"} onclick={() => { sectionMode = "coordinate"; shell.setSectionPickEnabled(false); }}>{t.sectionCoordinate}</button>
        </div>

        {#if sectionMode === "surface"}
          <button class:viewer-section-pick-active={sectionPickActive} class="viewer-section-pick" onclick={startSectionPick}>
            <Icon name="section" size={17} /> {sectionPickActive ? t.sectionPickActive : t.sectionPick}
          </button>
          <p class="viewer-section-hint">{t.sectionPickHint}</p>
          {#if sectionDefinition}
            <dl class="viewer-section-values">
              <div><dt>{t.sectionPoint}</dt><dd>{formatVector(sectionDefinition.point)}</dd></div>
              <div><dt>{t.sectionNormal}</dt><dd>{formatVector(sectionDefinition.normal)}</dd></div>
            </dl>
          {/if}
        {:else}
          <div class="viewer-section-label">{t.sectionAxis}</div>
          <div class="viewer-section-axis" role="group" aria-label={t.sectionAxis}>
            {#each sectionAxes as axis}
              <button class:viewer-section-axis-active={sectionAxis === axis} onclick={() => (sectionAxis = axis)}>{axis.toUpperCase()}</button>
            {/each}
          </div>
          <label class="viewer-section-label">
            <span>{t.sectionCoordinateValue}</span>
            <input type="number" step="any" bind:value={sectionCoordinate} />
          </label>
          <button class="viewer-section-apply" onclick={applyCoordinateSection}>{t.sectionApply}</button>
        {/if}

        <div class="viewer-section-label">{t.sectionKeepSide}</div>
        <div class="viewer-section-side" role="group" aria-label={t.sectionKeepSide}>
          <button class:viewer-section-side-active={sectionSide === "positive"} onclick={() => changeSectionSide("positive")}>{t.sectionPositive}</button>
          <button class:viewer-section-side-active={sectionSide === "negative"} onclick={() => changeSectionSide("negative")}>{t.sectionNegative}</button>
          <button onclick={flipSectionSide}>{t.sectionFlip}</button>
        </div>

        <div class="viewer-section-actions">
          <button disabled={!sectionDefinition} onclick={() => shell.viewSectionPlane()}>{t.sectionView}</button>
          <button disabled={!sectionDefinition} onclick={clearSection}>{t.sectionClear}</button>
        </div>
      </section>
    {/if}
    {#if dragActive}
      <div class="viewer-drop-overlay" aria-hidden="true">
        <Icon name="folder" size={36} />
        <strong>{t.dropIfc}</strong>
      </div>
    {/if}
    {#if (!hasModel || errorMessage) && !isOpeningModel(viewerProgress) && !cancellingLoad}
      <div class:viewer-empty-state-error={Boolean(errorMessage)} class="viewer-empty-state">
        <p>{errorMessage ?? progressText(viewerProgress, t) ?? modelStatus ?? t.empty}</p>
      </div>
    {/if}
    <footer class="qn-status-bar">
      <span>{progressText(viewerProgress, t) ?? modelStatus ?? t.noModel}</span>
      <SemanticStatus progress={bridgeProgress} text={bridgeText(bridgeProgress, locale)} {locale} onRetry={() => shell.retrySemantic().catch(reportWorkspaceError)} />
      <span title={fragmentMetrics ? `${fragmentMetrics.profile} · ${fragmentMetrics.fragmentBytes} bytes · ${Math.round(fragmentMetrics.totalMilliseconds)} ms` : undefined}>{t.modelData}: {hasModel ? `${t.modelReady} · ${modelStatus ?? ""}` : viewerProgress?.stage === "error" ? t.modelError : isOpeningModel(viewerProgress) ? t.modelLoading : t.nothingSelected}</span>
      <span>{t.element}: {multiSelectionCount ? `${multiSelectionCount} ${t.selectedElements}` : selectedElement?.name ?? selectedElement?.ifcType ?? t.nothingSelected}</span>
      <span>{t.version} {appVersion}</span>
    </footer>

    <PropertiesPanel open={inspectorOpen} view={workspaceView} selection={selectedElement} count={multiSelectionCount}
      box={sectionBox} {locale} bind:preferView={propertiesViewContext} busy={workspace.busy || sectionBoxPicking} service={shell.modelData}
      onClose={()=>inspectorOpen=false} onResizeStart={startDrawerResize} onResizeKeydown={resizeDrawerByKeyboard}
      onBox={box=>shell.setSectionBox(box)} onDraw={()=>void shell.beginSectionBox(true).catch(reportWorkspaceError)}
      onFit={()=>shell.fit()} onReset={()=>shell.fitSectionBox()} onDisplay={display=>shell.setBoxDisplay(display)} />
  </section>

  {#if viewerProgress && (isOpeningModel(viewerProgress) || cancellingLoad)}
    <ModelLoadDialog modal={false} progress={viewerProgress} fileName={readiness.fileName ?? ""} text={t} cancelling={cancellingLoad} onCancel={() => void cancelIfcLoad()} />
  {/if}

  {#if helpOpen}
    <HelpDialog
      text={t}
      version={appVersion}
      {topics}
      {selectedTopic}
      onSelectTopic={(index) => (selectedTopic = index)}
      onClose={closeHelp}
    />
  {/if}
</main>
