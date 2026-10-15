import test from 'node:test';
import assert from 'node:assert/strict';
import { openSync, readSync, closeSync, existsSync } from 'node:fs';
import { act } from 'react';
import { createPluginEnv, mountSettingsCard, settle } from './load-client.mjs';
import { defaultSpec, mountModelMenu } from './harness.mjs';

const asar = process.env.DSH_ASAR || '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';

function readAsar(file) {
  const fd = openSync(asar, 'r');
  try {
    const header = Buffer.alloc(16);
    readSync(fd, header, 0, header.length, 0);
    const index = Buffer.alloc(header.readUInt32LE(12));
    readSync(fd, index, 0, index.length, 16);
    let entry = JSON.parse(index.toString());
    for (const name of file.split('/')) entry = entry.files[name];
    const data = Buffer.alloc(entry.size);
    readSync(fd, data, 0, data.length, 8 + header.readUInt32LE(4) + Number(entry.offset));
    return data.toString();
  } finally { closeSync(fd); }
}

test('真实 rc.2 加载器清理其他插件时，菜单和设置页样式保留且仍由各自生命周期清理', {
  skip: existsSync(asar) ? false : 'Set DSH_ASAR to the exact rc.2 desktop app.asar',
}, async () => {
  const root = 'dsh/node_modules/@deepseek-ai/dsh-client-modules/';
  assert.equal(JSON.parse(readAsar(root + 'package.json')).version, '0.2.0-rc.2');
  const prior = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const env = createPluginEnv();
  let card;
  try {
    const view = mountModelMenu(env.document, defaultSpec());
    await settle(env.window);
    await act(async () => { card = mountSettingsCard(env); });
    const styles = ['dsh-model-organizer-style', 'dsh-model-organizer-settings-style'].map(id => env.document.getElementById(id));
    assert.ok(styles.every(Boolean), 'Both real style injection paths must have mounted');
    const display = env.window.getComputedStyle(view.items[1]).display;
    const preferences = env.window.localStorage.getItem('dsh-model-organizer-state-v1');

    let registration;
    env.window.__ModuleLoader__ = { load: value => { registration = value; } };
    new Function('window', 'document', readAsar(root + 'lib/client.js'))(env.window, env.document);
    const bootstrap = { id: '@deepseek-ai/dsh-client-modules', exports: registration.factory(() => { throw Error('Unexpected loader dependency'); }) };
    const target = { mode: 'queue', pendingQueue: [], load(value) { this.pendingQueue.push(value); } };
    const modules = new bootstrap.exports.ClientModuleSystem({ manifest: { modules: [] }, staticModules: {}, registrationTarget: target, bootstrapModule: bootstrap });

    for (let cycle = 0; cycle < 2; cycle++) {
      const id = `foreign-style-probe-${cycle}`;
      modules.updateManifest({ modules: [{ id, rev: '1', url: `/??${id}/client.js&rev=1`, inject: [], external: [] }], plugins: [] }, []);
      modules.register({ id, factory() {
        const other = env.document.createElement('style');
        other.setAttribute('data-plugin', id);
        other.textContent = '.foreign-probe { display: block; }';
        env.document.head.append(other);
        return { apply() {} };
      } });
      await modules.import(id);
      const owners = styles.map(style => style.getAttribute('data-plugin'));
      modules.updateManifest({ modules: [], plugins: [] }, []);
      modules.prune([]);
      assert.ok(styles.every(style => style.isConnected), `Foreign cleanup removed organizer styles claimed as ${owners}`);
      assert.deepEqual(owners, ['dsh-model-organizer', 'dsh-model-organizer']);
      assert.equal(env.document.querySelector(`style[data-plugin="${id}"]`), null);
      assert.equal(env.window.getComputedStyle(view.items[1]).display, display);
      assert.equal(env.window.localStorage.getItem('dsh-model-organizer-state-v1'), preferences);
    }

    await act(async () => { card.unmount(); card = null; });
    assert.equal(styles[1].isConnected, false);
    assert.equal(styles[0].isConnected, true, 'Settings unmount must not remove menu styles');
    env.dispose();
    assert.equal(styles[0].isConnected, false);
  } finally {
    if (card) await act(async () => card.unmount());
    env.dispose();
    env.window.close();
    for (const [key, descriptor] of Object.entries(prior)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
