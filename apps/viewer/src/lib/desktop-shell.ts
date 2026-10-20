/* SPDX-License-Identifier: MPL-2.0 */
/** The local host injects this before loading the web UI. No native imports. */
export function isLocalDesktop(): boolean {
  return !!(globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}
