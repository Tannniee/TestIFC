/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { NativeIfcRuntime } from '../apps/viewer/src/hooks/ingest/nativeIfcContract';
import type { NativeInvoke } from './native-client';
import type { ColorizerRuntime } from '../apps/viewer/src/lib/colorizer/types';
const host = globalThis as typeof globalThis & {
  __TAURI_INTERNALS__?: { invoke: NativeInvoke }; __IFCLITE_NATIVE__?: NativeIfcRuntime;
  __IFCLITE_COLORIZER__?: ColorizerRuntime;
};
// Source-only editing is lazy and also works when geometry uses the WASM mode.
if (host.__TAURI_INTERNALS__) {
  host.__IFCLITE_COLORIZER__ = { async open(source, mutations, options) {
    const { createNativeColorizerRuntime } = await import('./native-colorizer');
    return createNativeColorizerRuntime(host.__TAURI_INTERNALS__!.invoke).open(source, mutations, options);
  } };
}
// Preview is deliberate until source-backed editing/export and large-file
// parity are verified. Ordinary browser builds never install this runtime.
if (host.__TAURI_INTERNALS__ && (import.meta.env.VITE_IFCLITE_NATIVE === '1'
    || new URLSearchParams(location.search).get('engine') === 'native')) {
  host.__IFCLITE_NATIVE__ = { async load(file, options) {
    const { createNativeIfcRuntime } = await import('./native-client');
    return createNativeIfcRuntime(host.__TAURI_INTERNALS__!.invoke).load(file, options);
  } };
}
