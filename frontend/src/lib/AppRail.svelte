<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { CopyText } from "./i18n";

  export let text: CopyText;
  export let mode: "light" | "dark";
  export let hasModel: boolean;
  export let boxZoomActive: boolean;
  export let sectionActive: boolean;
  export let displaySettingsOpen: boolean;
  export let inspectorOpen: boolean;
  export let helpOpen: boolean;
  export let themeLabel: string;
  export let onOpen: () => void;
  export let onFit: () => void;
  export let onBoxZoom: () => void;
  export let onSection: () => void;
  export let onDisplaySettings: () => void;
  export let onTheme: () => void;
  export let onLanguage: () => void;
  export let onInspector: () => void;
  export let onHelp: () => void;
</script>

<nav class="qn-rail" aria-label={text.rail}>
  <div class="qn-rail-brand" aria-hidden="true">IFC</div>
  <button class="qn-rail-button" title={text.open} aria-label={text.open} data-tooltip={text.open} onclick={onOpen}><Icon name="folder" /></button>
  <button class="qn-rail-button" title={text.fit} aria-label={text.fit} data-tooltip={text.fit} disabled={!hasModel} onclick={onFit}><Icon name="fit" /></button>
  <button class:qn-rail-button-active={boxZoomActive} class="qn-rail-button" title={text.boxZoom} aria-label={text.boxZoom} aria-pressed={boxZoomActive} data-tooltip={text.boxZoom} disabled={!hasModel} onclick={onBoxZoom}><Icon name="zoomBox" /></button>
  <button class:qn-rail-button-active={sectionActive} class="qn-rail-button" title={text.sectionPlane} aria-label={text.sectionPlane} aria-pressed={sectionActive} data-tooltip={text.sectionPlane} disabled={!hasModel} onclick={onSection}><Icon name="section" /></button>
  <button class:qn-rail-button-active={displaySettingsOpen} class="qn-rail-button" title={text.displaySettings} aria-label={text.displaySettings} aria-pressed={displaySettingsOpen} data-tooltip={text.displaySettings} onclick={onDisplaySettings}><Icon name="settings" /></button>
  <button class="qn-rail-button" title={themeLabel} aria-label={themeLabel} data-tooltip={themeLabel} onclick={onTheme}><Icon name={mode === "light" ? "moon" : "sun"} /></button>
  <button class="qn-rail-button" title={text.language} aria-label={text.language} data-tooltip={text.language} onclick={onLanguage}><Icon name="globe" /></button>
  <div class="qn-rail-divider"></div>
  <button class:qn-rail-button-active={inspectorOpen} class="qn-rail-button" title={text.inspector} aria-label={text.inspector} aria-pressed={inspectorOpen} data-tooltip={text.inspector} onclick={onInspector}><Icon name="panel" /></button>
  <button class:qn-rail-button-active={helpOpen} class="qn-rail-button" title={text.help} aria-label={text.help} aria-pressed={helpOpen} data-tooltip={text.help} onclick={onHelp}><Icon name="help" /></button>
</nav>
