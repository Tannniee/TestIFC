<script lang="ts">
  import { onMount } from "svelte";
  import AppRail from "./lib/AppRail.svelte";
  import AuthDialog from "./lib/AuthDialog.svelte";
  import HelpDialog from "./lib/HelpDialog.svelte";
  import Icon from "./lib/Icon.svelte";
  import InspectorDrawer from "./lib/InspectorDrawer.svelte";
  import ViewCube from "./lib/ViewCube.svelte";
  import { AppShellService, type AppSettings, type AuthStatus, type BridgeProgress, type CameraOrientation, type SectionPlaneDefinition, type SectionSide, type ViewDirection, type ViewerProgress, type ViewerSelection, type ViewportBackground, type ViewPreset } from "./lib/app-shell";
  import { copy, helpTopics, type CopyText, type Locale } from "./lib/i18n";

  type ModelState = "empty" | "loading" | "ready" | "error";
  const sectionAxes = ["x", "y", "z"] as const;

  let locale: Locale = "vi";
  let mode: "light" | "dark" = "light";
  let inspectorOpen = false;
  let displaySettingsOpen = false;
  let boxZoomActive = false;
  let sectionPanelOpen = false;
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
  let appVersion = "0.4.0 ahihi";
  let modelStatus: string | null = null;
  let modelState: ModelState = "empty";
  let errorMessage: string | null = null;
  let selectedElement: ViewerSelection | null = null;
  let viewerProgress: ViewerProgress | null = null;
  let bridgeProgress: BridgeProgress = { stage: "cleared" };
  let authStatus: AuthStatus | null = null;
  let authOpen = false;
  let authBusy = true;
  let authError: string | null = null;
  let drawerWidth = 360;
  let appLoadSequence = 0;
  let gridVisible = true;
  let viewportBackground: ViewportBackground = "gray";
  let wheelZoomSpeed = 1;
  let cameraOrientation: CameraOrientation = { x: 0, y: 0, z: 0, w: 1 };
  let themeTransitioning = false;
  let themeTransitionTimer: number | null = null;

  $: t = copy[locale];
  $: topics = helpTopics[locale];
  $: hasModel = modelState === "ready";
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
      const [health] = await Promise.all([shell.health(), refreshAuth()]);
      appVersion = health.appVersion;
    } catch {
      // The source UI also runs without the Python bridge during visual work.
      authBusy = false;
    }
  });

  onMount(() => {
    let cancelled = false;
    const fallbackSettings = shell.readLocalSettings();
    applySettings(fallbackSettings);

    const initializeViewer = async () => {
      const settings = await shell.initializeViewer(viewerHost, {
        onProgress(progress) {
          viewerProgress = progress;
          errorMessage = progress.stage === "error" ? progress.detail ?? "Viewer error" : null;
          if (["reading", "cache", "converting", "loading"].includes(progress.stage)) modelState = "loading";
          if (progress.stage === "ready") modelState = "ready";
          if (progress.stage === "error") modelState = "error";
        },
        onBridgeProgress(progress) {
          bridgeProgress = progress;
        },
        onSelection(selection) {
          selectedElement = selection;
          if (selection) inspectorOpen = true;
        },
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
        onCameraOrientationChange(orientation) {
          cameraOrientation = orientation;
        },
        onAuthorizationRequired(error) {
          authError = error instanceof Error ? error.message : t.authRequired;
          authOpen = true;
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
    document.documentElement.lang = locale;
    shell.applyViewerSettings(settings);
  }

  function currentSettings(): AppSettings {
    return { schemaVersion: 1, locale, mode, gridVisible, viewportBackground, wheelZoomSpeed };
  }

  function persistSettings(delay = 0) {
    shell.persistSettings(currentSettings(), delay);
  }

  function progressText(progress: ViewerProgress | null, text: CopyText): string | null {
    if (!progress) return null;
    if (progress.stage === "error") return progress.detail ?? "Error";
    const labels: Record<ViewerProgress["stage"], string> = {
      uploading: text.uploading,
      cache: text.cache,
      reading: text.opening,
      converting: text.converting,
      loading: text.loading,
      ready: text.ready,
      selecting: text.selecting,
      error: "Error",
    };
    const percent = progress.progress !== undefined && progress.stage !== "ready"
      ? ` ${Math.round(progress.progress * 100)}%`
      : "";
    const detail = progress.detail ? ` · ${progress.detail}` : "";
    return `${labels[progress.stage]}${percent}${detail}`;
  }

  function bridgeText(progress: BridgeProgress, language: Locale): string {
    const labels: Record<BridgeProgress["stage"], string> = {
      activating: language === "vi" ? "đang kích hoạt mô hình" : "activating model",
      uploading: language === "vi" ? "đang nhận file" : "receiving file",
      preparing: language === "vi" ? "đang lập chỉ mục" : "building index",
      ready: language === "vi" ? "sẵn sàng" : "ready",
      cleared: language === "vi" ? "đã xoá lựa chọn" : "selection cleared",
      error: language === "vi" ? "có lỗi" : "error",
    };
    const percent = progress.progress === undefined ? "" : ` ${Math.round(progress.progress * 100)}%`;
    return `${language === "vi" ? "Cầu nối" : "Bridge"}: ${labels[progress.stage]}${percent}`;
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
    if (authStatus?.enforced && (!authStatus.authenticated || !authStatus.valid)) {
      authOpen = true;
      return;
    }
    fileInput.click();
  }

  async function refreshAuth() {
    authBusy = true;
    try {
      authStatus = await shell.authStatus();
      authOpen = authStatus.enforced && (!authStatus.authenticated || !authStatus.valid);
      authError = authOpen ? t.authRequired : null;
    } finally {
      authBusy = false;
    }
  }

  async function login() {
    authBusy = true;
    authError = null;
    try {
      authStatus = await shell.login();
      authOpen = authStatus.enforced && (!authStatus.authenticated || !authStatus.valid);
      if (authOpen) authError = t.authRequired;
    } catch (error) {
      authError = error instanceof Error ? error.message : t.authFailed;
    } finally {
      authBusy = false;
    }
  }

  async function logout() {
    authBusy = true;
    try {
      authStatus = await shell.logout();
      authOpen = authStatus.enforced;
      authError = authOpen ? t.authRequired : null;
    } catch (error) {
      authError = error instanceof Error ? error.message : t.authFailed;
    } finally {
      authBusy = false;
    }
  }

  function openHelp() {
    helpOpen = true;
  }

  function closeHelp() {
    helpOpen = false;
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
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
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
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
    shell.setBoxZoomEnabled(!boxZoomActive);
  }

  function toggleSectionPanel() {
    sectionPanelOpen = !sectionPanelOpen;
    if (sectionPanelOpen) displaySettingsOpen = false;
    else shell.setSectionPickEnabled(false);
  }

  function startSectionPick() {
    sectionMode = "surface";
    shell.setSectionPickEnabled(true);
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

  async function openIfcFile(file: File) {
    errorMessage = null;
    if (!/\.ifc$/i.test(file.name)) {
      errorMessage = t.unsupported;
      return;
    }
    if (authStatus?.enforced && (!authStatus.authenticated || !authStatus.valid)) {
      authOpen = true;
      return;
    }
    const sequence = ++appLoadSequence;
    modelState = "loading";
    selectedElement = null;
    viewerProgress = { stage: "reading", detail: file.name };
    bridgeProgress = { stage: "activating", detail: file.name };
    modelStatus = `${t.opening} ${file.name}`;
    try {
      await shell.load(file);
      if (sequence !== appLoadSequence) return;
      modelStatus = file.name;
      modelState = "ready";
    } catch (error) {
      if (shell.isCancelledLoad(error) || sequence !== appLoadSequence) return;
      const message = error instanceof Error ? error.message : String(error);
      errorMessage = message;
      viewerProgress = { stage: "error", detail: message };
      modelState = "error";
      if (shell.isAuthorizationFailure(error)) authOpen = true;
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
    {hasModel}
    {boxZoomActive}
    sectionActive={sectionPanelOpen || sectionPickActive || Boolean(sectionDefinition)}
    {displaySettingsOpen}
    {inspectorOpen}
    {helpOpen}
    {themeLabel}
    onOpen={openFilePicker}
    onFit={() => shell.fit()}
    onBoxZoom={toggleBoxZoom}
    onSection={toggleSectionPanel}
    onDisplaySettings={toggleDisplaySettings}
    onTheme={toggleTheme}
    onLanguage={switchLanguage}
    onInspector={() => (inspectorOpen = !inspectorOpen)}
    onHelp={openHelp}
  />

  <section
    class:viewer-drop-active={dragActive}
    class="viewer-surface"
    aria-label={t.workspace}
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    <div bind:this={viewerHost} class="viewer-mount"></div>
    <div class="view-cube-host">
      <ViewCube
        disabled={!hasModel}
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
    {#if !hasModel || errorMessage}
      <div class:viewer-empty-state-error={Boolean(errorMessage)} class="viewer-empty-state">
        <p>{errorMessage ?? progressText(viewerProgress, t) ?? modelStatus ?? t.empty}</p>
      </div>
    {/if}
    <footer class="qn-status-bar">
      <span>{progressText(viewerProgress, t) ?? modelStatus ?? t.noModel}</span>
      <span title={bridgeProgress.detail}>{bridgeText(bridgeProgress, locale)}</span>
      <span>{t.modelData}: {modelState === "ready" ? `${t.modelReady} · ${modelStatus ?? ""}` : modelState === "loading" ? t.modelLoading : modelState === "error" ? t.modelError : t.nothingSelected}</span>
      <span>{t.element}: {selectedElement?.name ?? selectedElement?.ifcType ?? t.nothingSelected}</span>
      <span>{t.version} {appVersion}</span>
    </footer>

    <InspectorDrawer
      text={t}
      open={inspectorOpen}
      width={drawerWidth}
      {identityExpanded}
      selection={selectedElement}
      onClose={() => (inspectorOpen = false)}
      onToggleIdentity={() => (identityExpanded = !identityExpanded)}
      onResizeStart={startDrawerResize}
      onResizeKeydown={resizeDrawerByKeyboard}
    />
  </section>

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

  {#if authOpen}
    <AuthDialog text={t} busy={authBusy} error={authError} status={authStatus} onLogin={login} onLogout={logout} />
  {/if}
</main>
