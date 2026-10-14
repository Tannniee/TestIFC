/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { DataModel, EntityMetadata } from '@ifc-lite/server-client';
import type { NativeInvoke } from './native-client';
import { NativeEntityColumns } from './native-entity-columns';
import type { NativeIfcResult } from '../apps/viewer/src/hooks/ingest/nativeIfcContract';
type PropertySet = DataModel['propertySets'] extends Map<number, infer T> ? T : never;

/** Decode only one record at a time. Neither the host nor the UI constructs a
 * model-sized JSON string; byte boundaries may split UTF-8 or a record. */
export async function readNativeSemantics(invoke: NativeInvoke, id: string, signal: AbortSignal,
  onProgress: (received: number, total: number) => void): Promise<DataModel & Pick<NativeIfcResult, 'projectUnits'>> {
  const total = await invoke<number>('native_prepare_semantics', { id, rootedOnly: true });
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Invalid native semantic stream length');
  const entities = new NativeEntityColumns();
  const projectUnits: NonNullable<NativeIfcResult['projectUnits']> = new Map();
  const model: Omit<DataModel, 'entities'> = { propertySets: new Map(), quantitySets: new Map(), relationships: [],
    classifications: [], materials: [], documents: [], spatialHierarchy: { project_id: 0, nodes: [],
      element_to_storey: new Map(), element_to_building: new Map(), element_to_site: new Map(), element_to_space: new Map() } };
  let carry = '', received = 0, complete = false, lastYield = Date.now();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const labels = new Map<string, string>();
  function label(value: string): string {
    const existing = labels.get(value);
    if (existing !== undefined) return existing;
    labels.set(value, value); return value;
  }
  function record(line: string) {
    if (complete) throw new Error('Unexpected record after native semantic completion');
    const [table, row]: [string, unknown] = JSON.parse(line);
    switch (table) {
      case 'projectUnits': {
        const [projectId, units] = row as [number, NonNullable<NativeIfcResult['projectUnits']> extends Map<number, infer T> ? T : never];
        if (!Number.isSafeInteger(projectId) || projectId <= 0 || projectUnits.has(projectId)
            || !units || typeof units.byType !== 'object' || units.byType === null) {
          throw new Error('Invalid native project units');
        }
        for (const unit of [...Object.values(units.byType), units.monetary]) {
          if (unit !== null && (!unit || typeof unit.symbol !== 'string'
              || !Number.isFinite(unit.siScale) || unit.siScale <= 0)) throw new Error('Invalid native project unit scale');
        }
        projectUnits.set(projectId, units); break;
      }
      case 'entityScope': if (row !== 'entities-rooted') throw new Error('Unexpected native entity scope'); break;
      case 'entities': entities.append(row as EntityMetadata); break;
      case 'propertySets': {
        const set = row as PropertySet;
        set.pset_name = label(set.pset_name);
        for (const property of set.properties) {
          property.property_name = label(property.property_name);
          property.property_type = label(property.property_type);
          if (property.data_type !== undefined) property.data_type = label(property.data_type);
        }
        model.propertySets.set(set.pset_id, set); break;
      }
      case 'quantitySets': {
        const set = row as DataModel['quantitySets'] extends Map<number, infer T> ? T : never;
        set.qset_name = label(set.qset_name);
        if (set.method_of_measurement !== undefined) set.method_of_measurement = label(set.method_of_measurement);
        for (const quantity of set.quantities) {
          quantity.quantity_name = label(quantity.quantity_name);
          quantity.quantity_type = label(quantity.quantity_type);
        }
        model.quantitySets.set(set.qset_id, set); break;
      }
      case 'relationships': {
        const relationship = row as DataModel['relationships'][number];
        relationship.rel_type = label(relationship.rel_type);
        model.relationships.push(relationship); break;
      }
      case 'classifications': model.classifications.push(row as DataModel['classifications'][number]); break;
      case 'materials': model.materials.push(row as DataModel['materials'][number]); break;
      case 'documents': model.documents.push(row as DataModel['documents'][number]); break;
      case 'projectId': model.spatialHierarchy.project_id = row as number; break;
      case 'spatialNodes': model.spatialHierarchy.nodes.push(row as DataModel['spatialHierarchy']['nodes'][number]); break;
      case 'elementToStorey': { const [id, target] = row as [number, number]; model.spatialHierarchy.element_to_storey.set(id, target); break; }
      case 'elementToBuilding': { const [id, target] = row as [number, number]; model.spatialHierarchy.element_to_building.set(id, target); break; }
      case 'elementToSite': { const [id, target] = row as [number, number]; model.spatialHierarchy.element_to_site.set(id, target); break; }
      case 'elementToSpace': { const [id, target] = row as [number, number]; model.spatialHierarchy.element_to_space.set(id, target); break; }
      case 'complete': if (row !== true) throw new Error('Invalid native semantic completion'); complete = true; break;
      default: throw new Error(`Unknown native semantic table: ${table}`);
    }
  }
  while (true) {
    signal.throwIfAborted();
    const packet = await invoke<ArrayBuffer>('native_next_semantic_packet', { id });
    signal.throwIfAborted();
    if (!packet.byteLength) break;
    if (packet.byteLength > 2 * 1024 * 1024 || received + packet.byteLength > total) {
      throw new Error('Native semantic packet exceeds its declared range');
    }
    received += packet.byteLength;
    carry += decoder.decode(packet, { stream: true });
    let start = 0, end: number;
    while ((end = carry.indexOf('\n', start)) >= 0) { record(carry.slice(start, end)); start = end + 1; }
    carry = carry.slice(start);
    onProgress(received, total);
    if (Date.now() - lastYield >= 16) {
      await new Promise<void>(resolve => setTimeout(resolve, 0)); lastYield = Date.now();
    }
  }
  carry += decoder.decode();
  if (carry || !complete || received !== total) throw new Error('Incomplete native semantic stream');
  signal.throwIfAborted();
  return { ...model, projectUnits, entities: entities.finish() };
}
