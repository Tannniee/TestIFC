// Run the repository's root turbo test graph, selecting one existing viewer
// shard through its supported TEST_SHARD/TEST_SHARDS environment contract.
import { spawnSync } from 'node:child_process';
import { delimiter, resolve } from 'node:path';
const file = process.argv[2] || 'src/components/viewer/colorizer/ColorizerPanel.test.tsx';
const alphabet = ' !"#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz{|}~';
let hash = 0;
for (const character of file) hash = (hash * 31 + alphabet.indexOf(character) + 1) % 1000003;
const root = resolve(import.meta.dirname, '../..');
const git = 'C:/Users/tanng/AppData/Local/ifclite-build-tools/git/bin';
const result = spawnSync(process.execPath, [resolve(root, 'desktop/node_modules/pnpm/bin/pnpm.cjs'),
  'test', '--filter=@ifc-lite/viewer', '--env-mode=loose'], {
  cwd: root, stdio: 'inherit', env: { ...process.env,
    PATH: `${resolve(root, 'desktop/node_modules/.bin')}${delimiter}${git}${delimiter}${process.env.PATH ?? ''}`,
    npm_config_script_shell: `${git}/bash.exe`, TEST_SHARDS: '1000003', TEST_SHARD: String(hash),
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
