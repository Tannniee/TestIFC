/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { GeometryProcessor as UpstreamProcessor, type GeometryProcessorOptions } from '../packages/geometry/src/index';
export * from '../packages/geometry/src/index';

// This desktop baseline packages the web engine. Native commands are a later slice.
export class GeometryProcessor extends UpstreamProcessor {
  constructor(options: GeometryProcessorOptions = {}) {
    super({ ...options, preferNative: options.preferNative ?? false });
  }
}
