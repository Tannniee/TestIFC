<script lang="ts">
  import { onMount } from "svelte";
  import type { FragmentsModel } from "@thatopen/fragments";
  import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
  import type { ManualAnchor, ModelGeoreferenceResponse } from "./api-contracts";
  import { footprintCoordinates, type GisModelBounds } from "./gis-footprint";
  import type { GisModelOverlay, GisPlacement } from "./gis-model-layer";

  export let anchor: ManualAnchor | null;
  export let georeference: ModelGeoreferenceResponse | null;
  export let bounds: GisModelBounds | null;
  export let model: FragmentsModel | null;
  export let selectedIds: number[];
  export let onPick: (longitude: number, latitude: number) => void;
  export let onSelect: (localId: number) => void;
  export let onSave: () => void;
  export let onClose: () => void;
  export let saveDisabled: boolean;
  let host: HTMLDivElement;
  let map: MapLibreMap | null = null, marker: MapLibreMarker | null = null;
  let styleReady = false, styleTimer: ReturnType<typeof setTimeout> | null = null;
  let overlay: GisModelOverlay | null = null, overlayReady = false;
  let overlayPlacementKey = "";
  let autoFitDone = false;
  let useIfc = !anchor && !!georeference?.wgs84;
  $: ifcControls = georeference?.wgs84?.controlPoints ?? null;
  $: activePosition = useIfc && ifcControls
    ? { ...ifcControls.origin, rotationDegrees: 0, scale: 1 } : anchor;
  let modelState = model ? "Đang chuẩn bị hình học IFC…" : "Chưa có mô hình IFC trong viewer.";
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

  function scheduleTileFallback() {
    if (styleTimer) clearTimeout(styleTimer);
    styleTimer = useTiles ? setTimeout(() => {
      if (map && !styleReady && useTiles) {
        useTiles = false; map.setStyle(emptyStyle, { diff: false });
        tileState = "Bản đồ trực tuyến tải quá lâu; đã chuyển sang nền trống.";
      }
    }, 20_000) : null;
  }

  function syncOverlay() {
    if (!map || !styleReady || !overlay || !overlayReady) return;
    const placement: GisPlacement | null = useIfc && ifcControls
      ? { kind: "ifc", controlPoints: ifcControls }
      : anchor ? { kind: "manual", anchor } : null;
    const nextKey = JSON.stringify(placement);
    if (nextKey !== overlayPlacementKey) { overlayPlacementKey = nextKey; overlay.setPlacement(placement); }
    const exists = !!map.getLayer(overlay.layer.id);
    if (placement && !exists) map.addLayer(overlay.layer);
    if (!placement && exists) map.removeLayer(overlay.layer.id);
    host.dataset.gis3d = placement && map.getLayer(overlay.layer.id) ? "ready" : "pending";
  }

  function syncPosition() {
    if (!map) return;
    if (activePosition) {
      if (marker) marker.setLngLat([activePosition.longitude, activePosition.latitude]);
      else if (MarkerClass) {
        marker = new MarkerClass({ color: "#d7453b" })
          .setLngLat([activePosition.longitude, activePosition.latitude]).addTo(map);
        marker.getElement().style.pointerEvents = "none";
      }
    } else { marker?.remove(); marker = null; }
    if (!styleReady) return;
    syncOverlay();
    const ring = useIfc ? overlay?.footprint() ?? null
      : anchor && bounds ? footprintCoordinates(anchor, bounds) : null;
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
    if (activePosition && overlayReady && !autoFitDone) { autoFitDone = true; fitModel(); }
  }

  function fitModel() {
    const ring = overlay?.footprint();
    if (!map || !ring) return;
    const longitudes = ring.map(point => point[0]);
    const latitudes = ring.map(point => point[1]);
    const elevation = overlay?.elevationRange();
    const latitude = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
    const height = elevation ? Math.abs(elevation[1] - elevation[0]) : 0;
    const visibleHeight = Math.max(host.clientHeight * 0.6, 1);
    const heightZoom = height > 0
      ? Math.log2(40075016.68557849 * Math.cos(latitude * Math.PI / 180)
        * visibleHeight / (512 * height)) : 21;
    if (elevation) {
      map.setCenterClampedToGround(false);
      map.setCenterElevation((elevation[0] + elevation[1]) / 2);
    }
    map.fitBounds([[Math.min(...longitudes), Math.min(...latitudes)],
      [Math.max(...longitudes), Math.max(...latitudes)]],
      { padding: 64, maxZoom: Math.min(21, Math.max(1, heightZoom)), duration: 0 });
  }

  onMount(() => {
    let disposed = false;
    void (async () => {
      try {
        const { Map, Marker, NavigationControl } = await import("maplibre-gl");
        if (disposed) return;
        MarkerClass = Marker;
        map = new Map({ container: host, style: useTiles ? tileStyle : emptyStyle,
          center: activePosition ? [activePosition.longitude, activePosition.latitude] : [105.8, 16],
          zoom: activePosition ? 19 : 5,
          pitch: activePosition ? 55 : 0, canvasContextAttributes: { antialias: true } });
        map.addControl(new NavigationControl({ showCompass: false }), "top-right");
        map.on("click", event => {
          const localId = overlay?.pick(event.point, map!.getCanvas().clientWidth, map!.getCanvas().clientHeight);
          if (localId !== null && localId !== undefined) onSelect(localId);
          else { useIfc = false; autoFitDone = true; onPick(event.lngLat.lng, event.lngLat.lat); }
        });
        map.on("style.load", () => {
          styleReady = true;
          if (styleTimer) { clearTimeout(styleTimer); styleTimer = null; }
          tileState = useTiles ? `${tileLabel} · cần Internet` : "Nền trống · không cần Internet";
          syncPosition();
        });
        map.on("idle", syncOverlay);
        map.on("error", () => {
          if (useTiles && map) { useTiles = false; styleReady = false; map.setStyle(emptyStyle, { diff: false });
            tileState = "Không tải được tile; vẫn có thể chọn tọa độ."; }
        });
        scheduleTileFallback();
        syncPosition();
        if (model && bounds) {
          const { GisModelOverlay } = await import("./gis-model-layer");
          if (disposed) return;
          overlay = new GisModelOverlay(model, bounds);
          try {
            const stats = await overlay.build();
            if (disposed) return;
            overlayReady = true;
            overlay.setSelectedIds(selectedIds);
            modelState = stats.elements
              ? `Mô hình IFC 3D · ${stats.elements} phần hình học · ${Math.round(stats.triangles).toLocaleString()} tam giác${stats.truncated ? " · bản xem trước bị giới hạn 500.000 tam giác" : ""}`
              : "IFC không có hình học 3D để hiển thị trên bản đồ.";
            syncPosition();
          } catch (error) {
            if (!disposed) { modelState = `Không dựng được mô hình 3D: ${String(error)}`; overlay.dispose(); overlay = null; }
          }
        }
      } catch (error) { tileState = `Không mở được bản đồ: ${String(error)}`; }
    })();
    return () => { disposed = true; if (styleTimer) clearTimeout(styleTimer);
      marker?.remove(); overlay?.dispose(); map?.remove(); marker = null; map = null; MarkerClass = null; };
  });
  $: if (map) { anchor; bounds; georeference; useIfc; syncPosition(); }
  $: if (overlayReady && overlay) overlay.setSelectedIds(selectedIds);
  function toggleTiles() {
    if (!map) return;
    useTiles = !useTiles;
    styleReady = false;
    map.setStyle(useTiles ? tileStyle : emptyStyle, { diff: false });
    scheduleTileFallback();
    tileState = useTiles ? `Đang tải ${tileLabel}…` : "Nền trống · không cần Internet";
  }
  function useMapTiler() {
    if (!map || !mapTilerKey.trim()) return;
    tileStyle = `https://api.maptiler.com/maps/streets-v4/style.json?key=${encodeURIComponent(mapTilerKey.trim())}`;
    tileLabel = "MapTiler streets";
    useTiles = true;
    styleReady = false;
    map.setStyle(tileStyle, { diff: false });
    scheduleTileFallback();
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
    {#if activePosition}<button type="button" onclick={() => goTo(activePosition.longitude, activePosition.latitude, 19)}>{useIfc ? "Đến gốc IFC" : "Đến vị trí"}</button>{/if}
    {#if overlayReady}<button type="button" onclick={fitModel}>Đến mô hình</button>{/if}
    {#if ifcControls}<button type="button" aria-pressed={useIfc} onclick={() => { useIfc = true; autoFitDone = false; syncPosition(); }}>Vị trí IFC</button>{/if}
    {#if anchor && ifcControls}<button type="button" aria-pressed={!useIfc} onclick={() => { useIfc = false; autoFitDone = false; syncPosition(); goTo(anchor.longitude, anchor.latitude, 19); }}>Vị trí thủ công</button>{/if}
    <button type="button" onclick={toggleTiles}>{useTiles ? "Offline view" : tileLabel}</button>
    <button type="button" onclick={onSave} disabled={!anchor || saveDisabled}>Lưu vị trí</button>
  </div></div>
  <small>{modelState} · Bấm vào cấu kiện 3D để chọn trong viewer.</small>
  <div class="gis-map-provider"><span>Demo tiles chỉ có ranh giới quốc gia. Bản đồ đường phố cần key riêng.</span>
    <input aria-label="MapTiler API key" type="password" autocomplete="off" placeholder="MapTiler API key" bind:value={mapTilerKey} />
    <button type="button" onclick={useMapTiler} disabled={!mapTilerKey.trim()}>Bản đồ chi tiết</button>
  </div>
  {#if activePosition}<small>Marker: {activePosition.latitude.toFixed(6)}°, {activePosition.longitude.toFixed(6)}° · {useIfc ? `IFC CRS ${georeference?.crsName ?? ""} · cao độ IFC chưa xác minh hệ quy chiếu đứng` : "vị trí thủ công"}
    {#if bounds} · {useIfc ? "marker tại gốc tọa độ IFC; mô hình có thể cách gốc" : "mô hình 3D và footprint cùng tâm tại marker"}{/if}</small>
  {:else}<small>Chưa chọn vị trí. Có thể kéo và phóng bản đồ đến quốc gia bất kỳ.</small>{/if}
</div>
