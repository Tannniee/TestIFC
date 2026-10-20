/* SPDX-License-Identifier: MPL-2.0 */
import type { NativeInvoke } from './native-client';
import type { ColorizerCatalog, ColorizerRuntime } from '../apps/viewer/src/lib/colorizer/types';

const CHUNK = 2 * 1024 * 1024;
export function createNativeColorizerRuntime(invoke: NativeInvoke): ColorizerRuntime {
  return { async open(source, mutations, { signal, onProgress }) {
    signal.throwIfAborted();
    const id = await invoke<string>('native_create_job');
    let closed = false;
    let exporting = false;
    const check = () => {
      signal.throwIfAborted();
      if (closed) throw new Error('The Colorizer session is closed');
    };
    const close = async () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', abort);
      await invoke('native_close_job', { id });
    };
    const abort = () => { void close().catch(error => console.error('[Colorizer] cleanup failed', error)); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      check();
      for (let offset = 0; offset < source.size; offset += CHUNK) {
        check();
        const bytes = new Uint8Array(await source.slice(offset, offset + CHUNK).arrayBuffer());
        check();
        await invoke('native_append_source', bytes, { headers: { 'x-ifc-job': id } });
        onProgress?.(Math.min(source.size, offset + bytes.length), source.size);
      }
      check();
      await invoke('native_colorizer_prepare', { id, mutations });
      check();
      return {
        async catalog(grouping) {
          check();
          const result = await invoke<ColorizerCatalog>('native_colorizer_catalog', { id, grouping });
          check();
          return result;
        },
        async export(batches, progress) {
          check();
          if (exporting) throw new Error('A Colorizer export is already in progress');
          exporting = true;
          try {
          const length = await invoke<number>('native_colorizer_export', { id, request: { batches } });
          check();
          if (!Number.isSafeInteger(length) || length <= 0) throw new Error('Invalid Colorizer output size');
          const chunks: ArrayBuffer[] = [];
          let received = 0;
          while (true) {
            check();
            const packet = await invoke<ArrayBuffer>('native_colorizer_next_packet', { id });
            check();
            if (packet.byteLength > CHUNK || received + packet.byteLength > length) throw new Error('Invalid Colorizer download packet');
            if (packet.byteLength === 0) break;
            received += packet.byteLength;
            chunks.push(packet);
            progress?.(received, length);
          }
          if (received !== length) throw new Error('Incomplete Colorizer download');
          return new Blob(chunks, { type: 'text/plain' });
          } finally { exporting = false; }
        },
        close,
      };
    } catch (error) {
      try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Colorizer failed and could not close its source'); }
      throw error;
    }
  } };
}
