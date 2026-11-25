import { constants } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
const directory = await mkdtemp(join(tmpdir(), 'ifclite-dir-sync-'));
try {
  for (const [name, flags] of Object.entries({ read: constants.O_RDONLY | constants.O_DIRECTORY,
    write: constants.O_WRONLY | constants.O_DIRECTORY, readWrite: constants.O_RDWR | constants.O_DIRECTORY,
    readWriteSync: constants.O_RDWR | constants.O_DIRECTORY | constants.O_SYNC })) {
    let handle;
    try {
      handle = await open(directory, flags);
      await handle.sync();
      console.log(name, 'sync succeeded');
    } catch (error) { console.log(name, error.code, error.syscall); }
    finally { await handle?.close(); }
  }
  for (let ancestor = dirname(directory);; ancestor = dirname(ancestor)) {
    let handle;
    try { handle = await open(ancestor, constants.O_WRONLY | constants.O_DIRECTORY); await handle.sync(); console.log('ancestor', ancestor, 'sync succeeded'); }
    catch (error) { console.log('ancestor', ancestor, error.code, error.syscall); }
    finally { await handle?.close(); }
    if (dirname(ancestor) === ancestor) break;
  }
  for (const ancestor of ['F:\\Steel\\VBA\\IFC-Lite-Core104', 'F:\\Steel\\VBA', 'F:\\Steel', 'F:\\']) {
    let handle;
    try { handle = await open(ancestor, constants.O_WRONLY | constants.O_DIRECTORY); await handle.sync(); console.log('workspace ancestor', ancestor, 'sync succeeded'); }
    catch (error) { console.log('workspace ancestor', ancestor, error.code, error.syscall); }
    finally { await handle?.close(); }
  }
} finally { await rm(directory, { recursive: true }); }
