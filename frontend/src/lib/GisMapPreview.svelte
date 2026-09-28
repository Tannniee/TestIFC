<script lang="ts">
  import { onMount } from "svelte";
  import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
  import type { ManualAnchor } from "./api-contracts";

  export let anchor: ManualAnchor;
  let host: HTMLDivElement;
  let map: MapLibreMap | null = null, marker: MapLibreMarker | null = null;
  let tileState = "Đang tải bản đồ thử nghiệm…";
  let useTiles = true;
  const emptyStyle = { version: 8 as const, sources: {},
    layers: [{ id: "background", type: "background" as const,
      paint: { "background-color": "#e8eff3" } }] };
  const demoStyle = "https://demotiles.maplibre.org/style.json";

  onMount(() => {
    let disposed = false;
    void (async () => {
      try {
        const { Map, Marker, NavigationControl } = await import("maplibre-gl");
        if (disposed) return;
        map = new Map({ container: host, style: useTiles ? demoStyle : emptyStyle,
          center: [anchor.longitude, anchor.latitude], zoom: 16 });
        map.addControl(new NavigationControl({ showCompass: false }), "top-right");
        marker = new Marker({ color: "#d7453b" }).setLngLat([anchor.longitude, anchor.latitude]).addTo(map);
        map.on("load", () => { tileState = useTiles ? "Demo tiles · cần Internet" : "Nền trống · không cần Internet"; });
        map.on("error", () => {
          if (useTiles && map) { useTiles = false; map.setStyle(emptyStyle, { diff: false }); tileState = "Không tải được tile; marker vẫn dùng tọa độ thủ công."; }
        });
      } catch (error) { tileState = `Không mở được bản đồ: ${String(error)}`; }
    })();
    return () => { disposed = true; marker?.remove(); map?.remove(); marker = null; map = null; };
  });
  $: if (map && marker) {
    marker.setLngLat([anchor.longitude, anchor.latitude]);
    map.jumpTo({ center: [anchor.longitude, anchor.latitude] });
  }
  function toggleTiles() {
    if (!map) return;
    useTiles = !useTiles;
    map.setStyle(useTiles ? demoStyle : emptyStyle, { diff: false });
    tileState = useTiles ? "Đang tải demo tiles…" : "Nền trống · không cần Internet";
  }
</script>

<div class="gis-map-preview" aria-label="GIS anchor map preview">
  <div class="gis-map-canvas" bind:this={host}></div>
  <div class="gis-map-caption"><span>{tileState}</span><button onclick={toggleTiles}>{useTiles ? "Offline view" : "Demo tiles"}</button></div>
  <small>Marker: {anchor.latitude.toFixed(6)}°, {anchor.longitude.toFixed(6)}° · manual anchor</small>
</div>
