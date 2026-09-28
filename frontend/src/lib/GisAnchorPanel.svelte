<script lang="ts">
  import { onDestroy } from "svelte";
  import GisMapPreview from "./GisMapPreview.svelte";
  import type { GisAnchorResponse, ManualAnchor } from "./api-contracts";

  export let modelHash: string | null;
  export let onRead: (modelHash: string) => Promise<GisAnchorResponse>;
  export let onSave: (modelHash: string, anchor: ManualAnchor) => Promise<GisAnchorResponse>;
  export let onDelete: (modelHash: string) => Promise<GisAnchorResponse>;

  let owner: string | null = null, sequence = 0, busy = false, status = "";
  let anchor: ManualAnchor | null = null, showMap = false;
  let longitude = "", latitude = "", elevationMeters = "0", rotationDegrees = "0", scale = "1";
  onDestroy(() => { sequence++; });
  $: if (owner !== modelHash) {
    owner = modelHash; sequence++; busy = false; status = ""; anchor = null; showMap = false;
    longitude = ""; latitude = ""; elevationMeters = "0"; rotationDegrees = "0"; scale = "1";
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
    try { const result = await onRead(hash); if (current === sequence && result.modelHash === hash) display(result); }
    catch (error) { if (current === sequence) status = String(error); }
    finally { if (current === sequence) busy = false; }
  }
  function number(value: string | number, label: string) {
    if (!String(value).trim()) throw new Error(`Thiếu ${label}`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${label} phải là số hữu hạn`);
    return parsed;
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!modelHash) return;
    const current = ++sequence, hash = modelHash; busy = true;
    try {
      const anchor = { longitude: number(longitude, "kinh độ"), latitude: number(latitude, "vĩ độ"),
        elevationMeters: number(elevationMeters, "cao độ"),
        rotationDegrees: number(rotationDegrees, "góc xoay"), scale: number(scale, "scale") };
      const result = await onSave(hash, anchor);
      if (current === sequence && result.modelHash === hash) display(result);
    } catch (error) { if (current === sequence) status = String(error); }
    finally { if (current === sequence) busy = false; }
  }
  async function remove() {
    if (!modelHash) return;
    const current = ++sequence, hash = modelHash; busy = true;
    try { const result = await onDelete(hash); if (current === sequence && result.modelHash === hash) display(result); }
    catch (error) { if (current === sequence) status = String(error); }
    finally { if (current === sequence) busy = false; }
  }
</script>

<details class="browser-gis-anchor" ontoggle={event => { if (event.currentTarget.open) void load(); }}>
  <summary>GIS · Manual anchor</summary>
  <p>Vị trí do người dùng nhập, chưa được xác minh bằng CRS IFC.</p>
  <form onsubmit={save}>
    <label>Kinh độ <input aria-label="GIS longitude" type="number" step="any" min="-180" max="180" bind:value={longitude} disabled={!modelHash || busy} /></label>
    <label>Vĩ độ <input aria-label="GIS latitude" type="number" step="any" min="-90" max="90" bind:value={latitude} disabled={!modelHash || busy} /></label>
    <label>Cao độ (m) <input aria-label="GIS elevation" type="number" step="any" bind:value={elevationMeters} disabled={!modelHash || busy} /></label>
    <label>Góc xoay (°) <input aria-label="GIS rotation" type="number" step="any" bind:value={rotationDegrees} disabled={!modelHash || busy} /></label>
    <label>Scale <input aria-label="GIS scale" type="number" step="any" min="0.000001" bind:value={scale} disabled={!modelHash || busy} /></label>
    <div><button type="submit" disabled={!modelHash || busy}>Save anchor</button>
      <button type="button" onclick={() => void remove()} disabled={!modelHash || busy}>Delete anchor</button></div>
  </form>
  {#if status}<small role="status">{status}</small>{/if}
  {#if anchor}<button class="gis-map-toggle" onclick={() => showMap = !showMap}>{showMap ? "Đóng bản đồ" : "Xem trên bản đồ"}</button>{/if}
  {#if anchor && showMap}<GisMapPreview {anchor} />{/if}
</details>
