<script lang="ts">
  import { onMount } from "svelte";
  import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
  import type { ManualAnchor } from "./api-contracts";
  import { footprintCoordinates, type GisModelBounds } from "./gis-footprint";

  export let anchor: ManualAnchor | null;
  export let bounds: GisModelBounds | null;
  export let onPick: (longitude: number, latitude: number) => void;
  export let onSave: () => void;
  export let onClose: () => void;
  export let saveDisabled: boolean;
  let host: HTMLDivElement;
  let map: MapLibreMap | null = null, marker: MapLibreMarker | null = null;
  let MarkerClass: (typeof import("maplibre-gl"))["Marker"] | null = null;
  let tileState = "Đang tải bản đồ thử nghiệm…";
  let useTiles = true;
  const configuredKey = import.meta.env.VITE_MAPTILER_API_KEY?.trim() ?? "";
  let tileStyle = configuredKey
    ? `https://api.maptiler.com/maps/streets-v4/style.json?key=${encodeURIComponent(configuredKey)}`
    : "https://demotiles.maplibre.org/style.json";
  let tileLabel = configuredKey ? "MapTiler streets" : "Demo tiles";
  let mapTilerKey = configuredKey;
  const emptyStyle = { version: 8 as const, sources: {},
    layers: [{ id: "background", type: "background" as const,
      paint: { "background-color": "#e8eff3" } }] };
  const footprintId = "gis-model-footprint";

  function syncPosition() {
    if (!map) return;
    if (anchor) {
      if (marker) marker.setLngLat([anchor.longitude, anchor.latitude]);
      else if (MarkerClass) marker = new MarkerClass({ color: "#d7453b" })
        .setLngLat([anchor.longitude, anchor.latitude]).addTo(map);
    } else { marker?.remove(); marker = null; }
    if (!map.isStyleLoaded()) return;
    const ring = anchor && bounds ? footprintCoordinates(anchor, bounds) : null;
    const data = { type: "FeatureCollection" as const, features: ring ? [{ type: "Feature" as const,
      properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } }] : [] };
    let source = map.getSource(footprintId) as GeoJSONSource | undefined;
    if (!source) {
      map.addSource(footprintId, { type: "geojson", data });
      map.addLayer({ id: `${footprintId}-fill`, type: "fill", source: footprintId,
        paint: { "fill-color": "#ed9b3b", "fill-opacity": 0.32 } });
      map.addLayer({ id: `${footprintId}-outline`, type: "line", source: footprintId,
        paint: { "line-color": "#ab571e", "line-width": 2 } });
    } else source.setData(data);
  }

  onMount(() => {
    let disposed = false;
    void (async () => {
      try {
        const { Map, Marker, NavigationControl } = await import("maplibre-gl");
        if (disposed) return;
        MarkerClass = Marker;
        map = new Map({ container: host, style: useTiles ? tileStyle : emptyStyle,
          center: anchor ? [anchor.longitude, anchor.latitude] : [105.8, 16], zoom: anchor ? 16 : 5 });
        map.addControl(new NavigationControl({ showCompass: false }), "top-right");
        map.on("click", event => onPick(event.lngLat.lng, event.lngLat.lat));
        map.on("style.load", () => {
          tileState = useTiles ? `${tileLabel} · cần Internet` : "Nền trống · không cần Internet";
          syncPosition();
        });
        map.on("error", () => {
          if (useTiles && map) { useTiles = false; map.setStyle(emptyStyle, { diff: false });
            tileState = "Không tải được tile; vẫn có thể chọn tọa độ."; }
        });
        syncPosition();
      } catch (error) { tileState = `Không mở được bản đồ: ${String(error)}`; }
    })();
    return () => { disposed = true; marker?.remove(); map?.remove(); marker = null; map = null; MarkerClass = null; };
  });
  $: if (map) { anchor; bounds; syncPosition(); }
  function toggleTiles() {
    if (!map) return;
    useTiles = !useTiles;
    map.setStyle(useTiles ? tileStyle : emptyStyle, { diff: false });
    tileState = useTiles ? `Đang tải ${tileLabel}…` : "Nền trống · không cần Internet";
  }
  function useMapTiler() {
    if (!map || !mapTilerKey.trim()) return;
    tileStyle = `https://api.maptiler.com/maps/streets-v4/style.json?key=${encodeURIComponent(mapTilerKey.trim())}`;
    tileLabel = "MapTiler streets";
    useTiles = true;
    map.setStyle(tileStyle, { diff: false });
    tileState = "Đang tải MapTiler streets…";
  }
  function goTo(longitude: number, latitude: number, zoom: number) {
    map?.flyTo({ center: [longitude, latitude], zoom, essential: true });
  }
</script>

<div class="gis-map-preview" aria-label="GIS anchor map preview">
  <div class="gis-map-heading"><div><strong>Chọn vị trí mô hình</strong><span>Bấm lên bản đồ để chọn điểm, sau đó lưu anchor.</span></div>
    <button type="button" onclick={onClose} aria-label="Đóng bản đồ GIS">×</button></div>
  <div class="gis-map-canvas" bind:this={host}></div>
  <div class="gis-map-caption"><span>{tileState}</span><div class="gis-map-actions">
    <button type="button" onclick={() => goTo(105.8, 16, 5)}>Việt Nam</button>
    <button type="button" onclick={() => goTo(0, 20, 2)}>Toàn cầu</button>
    {#if anchor}<button type="button" onclick={() => goTo(anchor.longitude, anchor.latitude, 19)}>Đến vị trí</button>{/if}
    <button type="button" onclick={toggleTiles}>{useTiles ? "Offline view" : tileLabel}</button>
    <button type="button" onclick={onSave} disabled={!anchor || saveDisabled}>Lưu vị trí</button>
  </div></div>
  <div class="gis-map-provider"><span>Demo tiles chỉ có ranh giới quốc gia. Bản đồ đường phố cần key riêng.</span>
    <input aria-label="MapTiler API key" type="password" autocomplete="off" placeholder="MapTiler API key" bind:value={mapTilerKey} />
    <button type="button" onclick={useMapTiler} disabled={!mapTilerKey.trim()}>Bản đồ chi tiết</button>
  </div>
  {#if anchor}<small>Marker: {anchor.latitude.toFixed(6)}°, {anchor.longitude.toFixed(6)}° · vị trí thủ công
    {#if bounds} · footprint từ bounding box, tâm tại marker{/if}</small>
  {:else}<small>Chưa chọn vị trí. Có thể kéo và phóng bản đồ đến quốc gia bất kỳ.</small>{/if}
</div>
