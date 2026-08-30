<script lang="ts">
  import { onMount, tick } from "svelte";
  import Icon from "./lib/Icon.svelte";
  import ViewCube from "./lib/ViewCube.svelte";
  import { api, isAuthorizationError, type AuthStatus } from "./lib/api";
  import { copy, helpTopics, type Locale } from "./lib/i18n";
  import { loadDesktopSettings, saveDesktopSettings, type AppSettings } from "./lib/settings";
  import { ViewerService, isLoadCancelledError, type BridgeProgress, type CameraOrientation, type SectionPlaneDefinition, type SectionSide, type ViewDirection, type ViewerProgress, type ViewerSelection, type ViewportBackground, type ViewPreset } from "./lib/viewer";

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
  let viewer: ViewerService | null = null;
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
  let helpDialog: HTMLDivElement;
  let helpCloseButton: HTMLButtonElement;
  let previousFocus: HTMLElement | null = null;
  let drawerWidth = 360;
  let appLoadSequence = 0;
  let gridVisible = true;
  let viewportBackground: ViewportBackground = "gray";
  let wheelZoomSpeed = 1;
  let cameraOrientation: CameraOrientation = { x: 0, y: 0, z: 0, w: 1 };
  let settingsInitialized = false;
  let settingsSaveTimer: number | null = null;
  let themeTransitioning = false;
  let themeTransitionTimer: number | null = null;

  $: t = copy[locale];
  $: topics = helpTopics[locale];
  $: topic = topics[selectedTopic] ?? topics[0];
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
      const [health] = await Promise.all([api.health(), refreshAuth()]);
      appVersion = health.appVersion;
    } catch {
      // The source UI also runs without the Python bridge during visual work.
      authBusy = false;
    }
  });

  onMount(() => {
    let cancelled = false;
    const fallbackSettings = readLocalSettings();
    applySettings(fallbackSettings);

    const initializeViewer = async () => {
      const desktopSettings = await loadDesktopSettings();
      if (cancelled) return;
      applySettings(desktopSettings ?? fallbackSettings);

      viewer = new ViewerService(viewerHost, {
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
      });
      viewer.setBackground(viewportBackground);
      viewer.setGridVisible(gridVisible);
      viewer.setWheelZoomSpeed(wheelZoomSpeed);
      settingsInitialized = true;
      if (!desktopSettings) void saveDesktopSettings(currentSettings());
    };

    void initializeViewer();
    return () => {
      cancelled = true;
      settingsInitialized = false;
      if (settingsSaveTimer !== null) window.clearTimeout(settingsSaveTimer);
      if (themeTransitionTimer !== null) window.clearTimeout(themeTransitionTimer);
      void viewer?.dispose();
      viewer = null;
    };
  });

  function readLocalSettings(): AppSettings {
    const savedLocale = localStorage.getItem("ifc-viewer-locale");
    const savedMode = localStorage.getItem("ifc-viewer-theme");
    const savedBackground = localStorage.getItem("ifc-viewer-background");
    const savedZoomSpeed = Number(localStorage.getItem("ifc-viewer-wheel-zoom-speed"));
    return {
      schemaVersion: 1,
      locale: savedLocale === "en" ? "en" : "vi",
      mode: savedMode === "dark" ? "dark" : "light",
      gridVisible: localStorage.getItem("ifc-viewer-grid") !== "hidden",
      viewportBackground: savedBackground === "white" || savedBackground === "oled" ? savedBackground : "gray",
      wheelZoomSpeed: Number.isFinite(savedZoomSpeed) && savedZoomSpeed >= 0.25 && savedZoomSpeed <= 3 ? savedZoomSpeed : 1,
    };
  }

  function applySettings(settings: AppSettings) {
    locale = settings.locale;
    mode = settings.mode;
    gridVisible = settings.gridVisible;
    viewportBackground = settings.viewportBackground;
    wheelZoomSpeed = settings.wheelZoomSpeed;
    document.documentElement.lang = locale;
    viewer?.setBackground(viewportBackground);
    viewer?.setGridVisible(gridVisible);
    viewer?.setWheelZoomSpeed(wheelZoomSpeed);
  }

  function currentSettings(): AppSettings {
    return { schemaVersion: 1, locale, mode, gridVisible, viewportBackground, wheelZoomSpeed };
  }

  function persistSettings(delay = 0) {
    const settings = currentSettings();
    localStorage.setItem("ifc-viewer-locale", settings.locale);
    localStorage.setItem("ifc-viewer-theme", settings.mode);
    localStorage.setItem("ifc-viewer-grid", settings.gridVisible ? "visible" : "hidden");
    localStorage.setItem("ifc-viewer-background", settings.viewportBackground);
    localStorage.setItem("ifc-viewer-wheel-zoom-speed", String(settings.wheelZoomSpeed));
    if (!settingsInitialized) return;
    if (settingsSaveTimer !== null) window.clearTimeout(settingsSaveTimer);
    settingsSaveTimer = window.setTimeout(() => {
      settingsSaveTimer = null;
      void saveDesktopSettings(currentSettings());
    }, delay);
  }

  function progressText(progress: ViewerProgress | null): string | null {
    if (!progress) return null;
    if (progress.stage === "error") return progress.detail ?? "Error";
    const labels: Record<ViewerProgress["stage"], string> = {
      uploading: t.uploading,
      cache: t.cache,
      reading: t.opening,
      converting: t.converting,
      loading: t.loading,
      ready: t.ready,
      selecting: t.selecting,
      error: "Error",
    };
    const percent = progress.progress !== undefined && progress.stage !== "ready"
      ? ` ${Math.round(progress.progress * 100)}%`
      : "";
    const detail = progress.detail ? ` · ${progress.detail}` : "";
    return `${labels[progress.stage]}${percent}${detail}`;
  }

  function bridgeText(progress: BridgeProgress): string {
    const labels: Record<BridgeProgress["stage"], string> = {
      activating: locale === "vi" ? "đang kích hoạt mô hình" : "activating model",
      uploading: locale === "vi" ? "đang nhận file" : "receiving file",
      preparing: locale === "vi" ? "đang lập chỉ mục" : "building index",
      ready: locale === "vi" ? "sẵn sàng" : "ready",
      cleared: locale === "vi" ? "đã xoá lựa chọn" : "selection cleared",
      error: locale === "vi" ? "có lỗi" : "error",
    };
    const percent = progress.progress === undefined ? "" : ` ${Math.round(progress.progress * 100)}%`;
    return `${locale === "vi" ? "Cầu nối" : "Bridge"}: ${labels[progress.stage]}${percent}`;
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
      authStatus = await api.authStatus();
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
      await api.login();
      authStatus = await api.authStatus();
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
      await api.logout();
      authStatus = await api.authStatus();
      authOpen = authStatus.enforced;
      authError = authOpen ? t.authRequired : null;
    } catch (error) {
      authError = error instanceof Error ? error.message : t.authFailed;
    } finally {
      authBusy = false;
    }
  }

  async function openHelp() {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    helpOpen = true;
    await tick();
    helpCloseButton?.focus();
  }

  async function closeHelp() {
    helpOpen = false;
    await tick();
    previousFocus?.focus();
    previousFocus = null;
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && boxZoomActive) {
      viewer?.setBoxZoomEnabled(false);
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && sectionPickActive) {
      viewer?.setSectionPickEnabled(false);
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && displaySettingsOpen) {
      displaySettingsOpen = false;
      event.preventDefault();
      return;
    }
    if (!helpOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      void closeHelp();
      return;
    }
    if (event.key !== "Tab" || !helpDialog) return;
    const focusable = [...helpDialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleHelpBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) void closeHelp();
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
      viewer?.setSectionPickEnabled(false);
    }
  }

  function toggleBoxZoom() {
    viewer?.setBoxZoomEnabled(!boxZoomActive);
  }

  function toggleSectionPanel() {
    sectionPanelOpen = !sectionPanelOpen;
    if (sectionPanelOpen) displaySettingsOpen = false;
    else viewer?.setSectionPickEnabled(false);
  }

  function startSectionPick() {
    sectionMode = "surface";
    viewer?.setSectionPickEnabled(true);
  }

  function applyCoordinateSection() {
    const point = { x: 0, y: 0, z: 0 };
    const normal = { x: 0, y: 0, z: 0 };
    point[sectionAxis] = sectionCoordinate;
    normal[sectionAxis] = 1;
    viewer?.setSectionPlane({ point, normal, side: sectionSide });
  }

  function changeSectionSide(side: SectionSide) {
    sectionSide = side;
    viewer?.setSectionSide(side);
  }

  function flipSectionSide() {
    changeSectionSide(sectionSide === "positive" ? "negative" : "positive");
  }

  function clearSection() {
    viewer?.setSectionPickEnabled(false);
    viewer?.clearSectionPlane();
  }

  function formatVector(vector: { x: number; y: number; z: number }) {
    return `${vector.x.toFixed(3)}, ${vector.y.toFixed(3)}, ${vector.z.toFixed(3)}`;
  }

  function changeView(preset: ViewPreset) {
    viewer?.setView(preset);
  }

  function changeViewDirection(direction: ViewDirection) {
    viewer?.setViewDirection(direction);
  }

  function orbitFromViewCube(deltaAzimuth: number, deltaPolar: number) {
    viewer?.orbitView(deltaAzimuth, deltaPolar);
  }

  function changeGridVisibility(visible: boolean) {
    gridVisible = visible;
    viewer?.setGridVisible(visible);
    persistSettings();
  }

  function changeViewportBackground(background: ViewportBackground) {
    viewportBackground = background;
    viewer?.setBackground(background);
    persistSettings();
  }

  function changeWheelZoomSpeed(speed: number) {
    wheelZoomSpeed = Math.min(3, Math.max(0.25, speed));
    viewer?.setWheelZoomSpeed(wheelZoomSpeed);
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
      await viewer?.load(file);
      if (sequence !== appLoadSequence) return;
      modelStatus = file.name;
      modelState = "ready";
    } catch (error) {
      if (isLoadCancelledError(error) || sequence !== appLoadSequence) return;
      const message = error instanceof Error ? error.message : String(error);
      errorMessage = message;
      viewerProgress = { stage: "error", detail: message };
      modelState = "error";
      if (isAuthorizationError(error)) authOpen = true;
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
  <nav class="qn-rail" aria-label={t.rail}>
    <div class="qn-rail-brand" aria-hidden="true">IFC</div>
    <input
      bind:this={fileInput}
      class="file-input"
      type="file"
      accept=".ifc"
      onchange={handleFile}
    />

    <button class="qn-rail-button" title={t.open} aria-label={t.open} data-tooltip={t.open} onclick={openFilePicker}>
      <Icon name="folder" />
    </button>
    <button class="qn-rail-button" title={t.fit} aria-label={t.fit} data-tooltip={t.fit} disabled={!hasModel} onclick={() => viewer?.fit()}>
      <Icon name="fit" />
    </button>
    <button
      class:qn-rail-button-active={boxZoomActive}
      class="qn-rail-button"
      title={t.boxZoom}
      aria-label={t.boxZoom}
      aria-pressed={boxZoomActive}
      data-tooltip={t.boxZoom}
      disabled={!hasModel}
      onclick={toggleBoxZoom}
    >
      <Icon name="zoomBox" />
    </button>
    <button
      class:qn-rail-button-active={sectionPanelOpen || sectionPickActive || Boolean(sectionDefinition)}
      class="qn-rail-button"
      title={t.sectionPlane}
      aria-label={t.sectionPlane}
      aria-pressed={sectionPanelOpen}
      data-tooltip={t.sectionPlane}
      disabled={!hasModel}
      onclick={toggleSectionPanel}
    >
      <Icon name="section" />
    </button>
    <button
      class:qn-rail-button-active={displaySettingsOpen}
      class="qn-rail-button"
      title={t.displaySettings}
      aria-label={t.displaySettings}
      aria-pressed={displaySettingsOpen}
      data-tooltip={t.displaySettings}
      onclick={toggleDisplaySettings}
    >
      <Icon name="settings" />
    </button>
    <button
      class="qn-rail-button"
      title={themeLabel}
      aria-label={themeLabel}
      data-tooltip={themeLabel}
      onclick={toggleTheme}
    >
      <Icon name={mode === "light" ? "moon" : "sun"} />
    </button>
    <button class="qn-rail-button" title={t.language} aria-label={t.language} data-tooltip={t.language} onclick={switchLanguage}>
      <Icon name="globe" />
    </button>

    <div class="qn-rail-divider"></div>

    <button
      class:qn-rail-button-active={inspectorOpen}
      class="qn-rail-button"
      title={t.inspector}
      aria-label={t.inspector}
      aria-pressed={inspectorOpen}
      data-tooltip={t.inspector}
      onclick={() => (inspectorOpen = !inspectorOpen)}
    >
      <Icon name="panel" />
    </button>
    <button
      class:qn-rail-button-active={helpOpen}
      class="qn-rail-button"
      title={t.help}
      aria-label={t.help}
      aria-pressed={helpOpen}
      data-tooltip={t.help}
      onclick={openHelp}
    >
      <Icon name="help" />
    </button>
  </nav>

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
          <button aria-label={t.close} onclick={() => { sectionPanelOpen = false; viewer?.setSectionPickEnabled(false); }}>×</button>
        </header>

        <div class="viewer-section-tabs" role="tablist" aria-label={t.sectionMode}>
          <button class:viewer-section-tab-active={sectionMode === "surface"} role="tab" aria-selected={sectionMode === "surface"} onclick={() => (sectionMode = "surface")}>{t.sectionSurface}</button>
          <button class:viewer-section-tab-active={sectionMode === "coordinate"} role="tab" aria-selected={sectionMode === "coordinate"} onclick={() => { sectionMode = "coordinate"; viewer?.setSectionPickEnabled(false); }}>{t.sectionCoordinate}</button>
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
          <button disabled={!sectionDefinition} onclick={() => viewer?.viewSectionPlane()}>{t.sectionView}</button>
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
        <p>{errorMessage ?? progressText(viewerProgress) ?? modelStatus ?? t.empty}</p>
      </div>
    {/if}
    <footer class="qn-status-bar">
      <span>{progressText(viewerProgress) ?? modelStatus ?? t.noModel}</span>
      <span title={bridgeProgress.detail}>{bridgeText(bridgeProgress)}</span>
      <span>{t.modelData}: {modelState === "ready" ? `${t.modelReady} · ${modelStatus ?? ""}` : modelState === "loading" ? t.modelLoading : modelState === "error" ? t.modelError : t.nothingSelected}</span>
      <span>{t.element}: {selectedElement?.name ?? selectedElement?.ifcType ?? t.nothingSelected}</span>
      <span>{t.version} {appVersion}</span>
    </footer>

    <aside class:qn-drawer-open={inspectorOpen} class="qn-drawer" aria-label={t.selection} style:width={`${drawerWidth}px`}>
      <button class="qn-drawer-handle" aria-label="Resize panel" onpointerdown={startDrawerResize} onkeydown={resizeDrawerByKeyboard}></button>
      <header class="qn-drawer-header">
        <h2>{t.selection}</h2>
        <button class="qn-drawer-close" aria-label={t.close} onclick={() => (inspectorOpen = false)}><Icon name="close" size={17} /></button>
      </header>
      <div class="qn-drawer-body">
        <div class="drawer-heading"><span class="qn-badge qn-badge-soft">{selectedElement?.ifcType ?? t.nothingSelected}</span></div>
        <section class="qn-property-group">
          <button class="qn-property-group__header" aria-expanded={identityExpanded} onclick={() => (identityExpanded = !identityExpanded)}><span>{identityExpanded ? "▾" : "▸"}</span> {t.identity}</button>
          {#if identityExpanded}<div class="qn-property-group__body">
            <div class="qn-property-row"><span class="qn-property-label">{t.status}</span><span class="qn-property-value">{selectedElement ? "selected" : t.nothingSelected}</span></div>
            {#if selectedElement}
              <div class="qn-property-row"><span class="qn-property-label">Name</span><span class="qn-property-value">{selectedElement.name ?? "—"}</span></div>
              <div class="qn-property-row"><span class="qn-property-label">IFC type</span><span class="qn-property-value">{selectedElement.ifcType ?? "—"}</span></div>
              <div class="qn-property-row"><span class="qn-property-label">GlobalId</span><span class="qn-property-value" title={selectedElement.globalId ?? undefined}>{selectedElement.globalId ?? "—"}</span></div>
              <div class="qn-property-row"><span class="qn-property-label">Express ID</span><span class="qn-property-value">{selectedElement.expressId ?? "—"}</span></div>
            {/if}
          </div>{/if}
        </section>
        <p class="inspector-empty">{selectedElement?.name ? `${t.element.replace(t.nothingSelected, selectedElement.name)}` : t.element}</p>
      </div>
    </aside>
  </section>

  {#if helpOpen}
    <div class="dialog-backdrop" role="presentation" onclick={handleHelpBackdrop}>
      <div bind:this={helpDialog} class="qn-dialog qn-dialog-lg help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header class="qn-dialog__header">
          <h2 id="help-title">{t.helpTitle} · v{appVersion}</h2>
          <button bind:this={helpCloseButton} class="qn-dialog__close" aria-label={t.closeDialog} onclick={closeHelp}>×</button>
        </header>
        <div class="qn-help">
          <nav class="qn-help__nav" aria-label={t.topics}>
            {#each topics as item, index}
              {#if index === 0 || item.group !== topics[index - 1].group}
                <h4 class="qn-help__heading">{item.group}</h4>
              {/if}
              <button class:qn-help__topic--active={selectedTopic === index} class="qn-help__topic" onclick={() => (selectedTopic = index)}>
                <span class="qn-help__topic-number">{index - topics.findIndex((candidate) => candidate.group === item.group) + 1}.</span>
                <span>{item.title}</span>
              </button>
            {/each}
          </nav>
          <article class="qn-help__body">
            <h3>{topics.findIndex((candidate) => candidate.group === topic.group) <= selectedTopic ? selectedTopic - topics.findIndex((candidate) => candidate.group === topic.group) + 1 : 1}. {topic.title}</h3>
            {#if topic.intro}<p>{topic.intro}</p>{/if}
            <ol>{#each topic.steps as step}<li>{step}</li>{/each}</ol>
            {#if topic.note}<p class="qn-help__note">{topic.note}</p>{/if}
          </article>
        </div>
      </div>
    </div>
  {/if}

  {#if authOpen}
    <div class="dialog-backdrop auth-backdrop">
      <div class="qn-dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <header class="qn-dialog__header"><h2 id="auth-title">{t.authTitle}</h2></header>
        <div class="auth-dialog__body">
          <p>{t.authIntro}</p>
          {#if authBusy}<p>{t.authChecking}</p>{/if}
          {#if authError}<p class="auth-error" role="alert">{authError}</p>{/if}
          {#if authStatus?.name}<p>{authStatus.name}{authStatus.email ? ` · ${authStatus.email}` : ""}</p>{/if}
          <div class="auth-actions">
            {#if authStatus?.authenticated}
              <button class="qn-action-button qn-action-button-secondary" disabled={authBusy} onclick={logout}>{t.authLogout}</button>
            {/if}
            <button class="qn-action-button" disabled={authBusy} onclick={login}>{t.authLogin}</button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</main>
