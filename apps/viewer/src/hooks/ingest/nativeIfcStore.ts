/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { NativeIfcResult } from './nativeIfcContract';
import { convertServerDataModel } from '../../utils/serverDataModel';
import type { GeometryResult } from '@ifc-lite/geometry';

export function nativeIfcStore(result: NativeIfcResult, file: File) {
  const dataStore = convertServerDataModel(result.dataModel, {
    cache_key: '', metadata: result.metadata, stats: result.stats,
  }, file, result.meshes);
  dataStore.lengthUnitScale = result.metadata.length_unit_scale ?? 1;
  const geo = result.metadata.georeferencing;
  if (geo) dataStore.georeferencing = {
    hasGeoreference: true, transformMatrix: geo.transform_matrix,
    source: geo.source === 'ePSetMapConversion' || geo.source === 'siteLocation' ? geo.source : 'mapConversion',
    // 0 denotes unavailable source identity; the native summary resolves values,
    // not IfcMapConversion / IfcProjectedCRS express IDs.
    mapConversion: { id: 0, sourceCRS: 0, targetCRS: 0, eastings: geo.eastings,
      northings: geo.northings, orthogonalHeight: geo.orthogonal_height,
      xAxisAbscissa: geo.x_axis_abscissa, xAxisOrdinate: geo.x_axis_ordinate,
      scale: geo.scale, factorX: geo.factor_x, factorY: geo.factor_y, factorZ: geo.factor_z },
    projectedCRS: { id: 0, name: geo.crs_name ?? '', description: geo.crs_description,
      geodeticDatum: geo.geodetic_datum, verticalDatum: geo.vertical_datum,
      mapProjection: geo.map_projection, mapZone: geo.map_zone,
      mapUnit: geo.map_unit, mapUnitScale: geo.map_unit_scale },
  };
  const geometryResult: GeometryResult = {
    meshes: result.meshes, coordinateInfo: result.coordinateInfo,
    totalVertices: result.stats.total_vertices, totalTriangles: result.stats.total_triangles,
  };
  return { dataStore, geometryResult };
}
