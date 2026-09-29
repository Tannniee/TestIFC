<script lang="ts">
  import { onDestroy } from "svelte";
  import GisMapPreview from "./GisMapPreview.svelte";
  import type { GisAnchorResponse, ManualAnchor } from "./api-contracts";
  import type { GisModelBounds } from "./gis-footprint";

  export let modelHash: string | null;
  export let modelBounds: GisModelBounds | null;
  export let onRead: (modelHash: string) => Promise<GisAnchorResponse>;
  export let onSave: (modelHash: string, anchor: ManualAnchor) => Promise<GisAnchorResponse>;
  export let onDelete: (modelHash: string) => Promise<GisAnchorResponse>;

  let owner: string | null = null, sequence = 0, dirty = false, busy = false, status = "";
  let anchor: ManualAnchor | null = null, showMap = false;
  let detailsElement: HTMLDetailsElement;
  let longitude = "", latitude = "", elevationMeters = "0", rotationDegrees = "0", scale = "1";
  $: draftPosition = [longitude, latitude, elevationMeters, rotationDegrees, scale].every(value => String(value).trim()
    && Number.isFinite(Number(value))) && Math.abs(Number(longitude)) <= 180
    && Math.abs(Number(latitude)) <= 90 && Number(scale) > 0 && Number(scale) <= 1_000_000
    ? { longitude: Number(longitude), latitude: Number(latitude), elevationMeters: Number(elevationMeters),
        rotationDegrees: Number(rotationDegrees), scale: Number(scale) } : null;
  onDestroy(() => { sequence++; });
  $: if (owner !== modelHash) {
    owner = modelHash; sequence++; dirty = false; busy = false; status = ""; anchor = null; showMap = false;
    longitude = ""; latitude = ""; elevationMeters = "0"; rotationDegrees = "0"; scale = "1";
    if (modelHash && detailsElement?.open) void load();
  }

  function display(result: GisAnchorResponse) {
    if (result.status !== "manual" || !result.anchor) { anchor = null; showMap = false; status = "Chưa có vị trí thủ công cho IFC này."; return; }
    anchor = result.anchor;
    longitude = String(result.anchor.longitude); latitude = String(result.anchor.latitude);
    elevationMeters = String(result.anchor.elevationMeters);
    rotationDegrees = String(result.anchor.rotationDegrees); scale = String(result.anchor.scale);
    status = `Vị trí thủ công · ${result.updatedAt ?? "đã lưu"}`;
  }
  async function load() {
    if (!modelHash) return;
    const current = ++sequence, hash = modelHash; busy = true;
    try { const result = await onRead(hash); if (current === sequence && !dirty && result.modelHash === hash) display(result); }
    catch (error) { if (current === sequence) status = String(error); }
    finally { if (current === sequence) busy = false; }
  }
  function number(value: string | number, label: string) {
    if (!String(value).trim()) throw new Error(`Thiếu ${label}`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${label} phải là số hữu hạn`);
    return parsed;
  }
  async function commit() {
    if (!modelHash) return;
    const current = ++sequence, hash = modelHash; busy = true;
    try {
      const anchor = { longitude: number(longitude, "kinh độ"), latitude: number(latitude, "vĩ độ"),
        elevationMeters: number(elevationMeters, "cao độ"),
        rotationDegrees: number(rotationDegrees, "góc xoay"), scale: number(scale, "scale") };
      const result = await onSave(hash, anchor);
      if (current === sequence && result.modelHash === hash) { dirty = false; display(result); }
    } catch (error) { if (current === sequence) status = String(error); }
    finally { if (current === sequence) busy = false; }
  }
  function save(event: SubmitEvent) { event.preventDefault(); void commit(); }
  async function remove() {
    if (!modelHash) return;
    const current = ++sequence, hash = modelHash; busy = true;
    try { const result = await onDelete(hash); if (current === sequence && result.modelHash === hash) { dirty = false; display(result); } }
    catch (error) { if (current === sequence) status = String(error); }
    finally { if (current === sequence) busy = false; }
  }
  function pick(longitudeValue: number, latitudeValue: number) {
    dirty = true;
    longitude = longitudeValue.toFixed(7);
    latitude = latitudeValue.toFixed(7);
    status = "Vị trí nháp trên bản đồ · bấm Save anchor để lưu cho IFC này.";
  }
</script>

<details class="browser-gis-anchor" bind:this={detailsElement} ontoggle={event => { if (event.currentTarget.open) void load(); }}>
  <summary>GIS · Manual anchor</summary>
  <p>Vị trí do người dùng chọn, chưa được xác minh bằng CRS IFC.</p>
  <form onsubmit={save} oninput={() => dirty = true}>
    <label>Kinh độ <input aria-label="GIS longitude" type="number" step="any" min="-180" max="180" bind:value={longitude} disabled={!modelHash || busy} /></label>
    <label>Vĩ độ <input aria-label="GIS latitude" type="number" step="any" min="-90" max="90" bind:value={latitude} disabled={!modelHash || busy} /></label>
    <label>Cao độ (m) <input aria-label="GIS elevation" type="number" step="any" bind:value={elevationMeters} disabled={!modelHash || busy} /></label>
    <label>Góc xoay (°) <input aria-label="GIS rotation" type="number" step="any" bind:value={rotationDegrees} disabled={!modelHash || busy} /></label>
    <label>Scale <input aria-label="GIS scale" type="number" step="any" min="0.000001" bind:value={scale} disabled={!modelHash || busy} /></label>
    <div><button type="submit" disabled={!modelHash || busy}>Save anchor</button>
      <button type="button" onclick={() => void remove()} disabled={!modelHash || busy}>Delete anchor</button></div>
  </form>
  {#if status}<small role="status">{status}</small>{/if}
  {#if modelHash}<button class="gis-map-toggle" onclick={() => showMap = !showMap}>{showMap ? "Đóng bản đồ" : anchor ? "Xem trên bản đồ" : "Chọn vị trí trên bản đồ"}</button>{/if}
  {#if showMap}<GisMapPreview anchor={draftPosition} bounds={modelBounds} onPick={pick}
    onSave={() => void commit()} onClose={() => showMap = false} saveDisabled={busy} />{/if}
</details>
