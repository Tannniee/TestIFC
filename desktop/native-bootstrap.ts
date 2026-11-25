/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { NativeIfcRuntime } from '../apps/viewer/src/hooks/ingest/nativeIfcContract';
import type { NativeInvoke } from './native-client';
const host = globalThis as typeof globalThis & {
  __TAURI_INTERNALS__?: { invoke: NativeInvoke }; __IFCLITE_NATIVE__?: NativeIfcRuntime;
};
// Preview is deliberate until source-backed editing/export and large-file
// parity are verified. Ordinary browser builds never install this runtime.
if (host.__TAURI_INTERNALS__ && (import.meta.env.VITE_IFCLITE_NATIVE === '1'
    || new URLSearchParams(location.search).get('engine') === 'native')) {
  host.__IFCLITE_NATIVE__ = { async load(file, options) {
    const { createNativeIfcRuntime } = await import('./native-client');
    return createNativeIfcRuntime(host.__TAURI_INTERNALS__!.invoke).load(file, options);
  } };
}
