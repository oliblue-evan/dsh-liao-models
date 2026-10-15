import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginEnv, settle } from './load-client.mjs';
import { defaultSpec, mountModelMenu, openPanelViaHeading } from './harness.mjs';
import { clientScope } from './extract-client.mjs';

const STORAGE = 'dsh-model-organizer-state-v1';
const idKey = (provider, model) => JSON.stringify(['id', provider, model]);
const labelKey = (provider, model) => JSON.stringify([provider, model]);
const stored = (env) => JSON.parse(env.window.localStorage.getItem(STORAGE));
const type = (env, input, value) => { input.value = value; input.dispatchEvent(new env.window.Event('input', { bubbles: true })); };
const press = (env, input, key) => input.dispatchEvent(new env.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const catalogOf = (spec) => spec.providers.map((provider) => ({ id: provider.id, name: provider.label || provider.id, models: provider.models.map((model) => ({ ...model })) }));

async function setup({ state, spec = defaultSpec(), groups, catalog = true } = {}) {
  const env = createPluginEnv({ autoMount: false });
  const listeners = new Set();
  const cached = { groups: groups || catalogOf(spec) };
  const store = { getSnapshot: () => ({ value: cached }), subscribe: (callback) => { listeners.add(callback); return () => listeners.delete(callback); } };
  if (catalog) env.ctx.get = (name) => name === 'modelDirectories' ? { catalog: { store, load() { throw new Error('插件不应发起目录加载'); } } } : null;
  if (state) env.window.localStorage.setItem(STORAGE, JSON.stringify({ version: 5, ...state }));
  env.plugin.apply(env.ctx);
  const view = mountModelMenu(env.document, spec);
  await settle(env.window);
  const panel = openPanelViaHeading(env, view);
  return { env, view, panel, cached, listeners, emit: () => listeners.forEach((callback) => callback()) };
}

test('旧置顶、最近、隐藏和别名迁移到宿主 ID，保留字号与顺序', async (t) => {
  const oldA = labelKey('DeepSeek', 'DeepSeek-V4.1-Flash');
  const oldB = labelKey('DeepSeek', 'DeepSeek-V4-Pro');
  const { env, view, panel } = await setup({ state: { favorites: [oldA], recents: [oldA, oldB], hidden: [oldB], aliases: { [oldA]: '小闪' }, fontSize: 14 } });
  t.after(() => env.dispose());
  const next = stored(env);
  assert.equal(next.version, 6);
  assert.deepEqual(next.favorites, [idKey('deepseek-account', 'DeepSeek-V4.1-Flash')]);
  assert.deepEqual(next.recents, [idKey('deepseek-account', 'DeepSeek-V4.1-Flash'), idKey('deepseek-account', 'DeepSeek-V4-Pro')]);
  assert.deepEqual(next.hidden, [idKey('deepseek-account', 'DeepSeek-V4-Pro')]);
  assert.equal(next.aliases[next.favorites[0]], '小闪');
  assert.equal(next.fontSize, 14);
  assert.equal(view.items[1].getAttribute('data-mo-hidden'), '1');
  assert.equal(panel.querySelector('.mo-row-name').textContent, '小闪');
});

test('厂商和模型都改显示名，重新打开窗口后偏好仍按同一 ID 生效', async () => {
  const initial = defaultSpec();
  const old = labelKey('DeepSeek', 'DeepSeek-V4.1-Flash');
  const first = await setup({ state: { favorites: [old], aliases: { [old]: '小闪' }, hidden: [labelKey('DeepSeek', 'DeepSeek-V4-Pro')] } });
  first.cached.groups[0].name = '厂商新名称';
  first.cached.groups[0].models[0].name = '新版显示名 · x0.08';
  first.view.sections[0].querySelector('[data-menu-group-heading]').textContent = '厂商新名称';
  first.view.items[0].title = '新版显示名 · x0.08';
  first.view.items[0].querySelector('[class*="modelName"]').textContent = '新版显示名 · x0.08';
  first.emit(); await settle(first.env.window);
  assert.equal(first.panel.querySelector('.mo-title').textContent, '厂商新名称');
  assert.equal(first.panel.querySelector('.mo-row-name').textContent, '小闪');
  assert.equal(first.panel.querySelector('[data-act="fav"]').getAttribute('aria-pressed'), 'true');
  const saved = first.env.window.localStorage.getItem(STORAGE);
  first.env.dispose();
  initial.providers[0].label = '厂商新名称'; initial.providers[0].models[0].name = '新版显示名 · x0.08';
  const second = await setup({ spec: initial, state: JSON.parse(saved) });
  assert.equal(second.panel.querySelector('.mo-row-name').textContent, '小闪');
  assert.equal(second.panel.querySelector('[data-act="fav"]').getAttribute('aria-pressed'), 'true');
  assert.equal(second.view.items[1].getAttribute('data-mo-hidden'), '1');
  second.env.dispose();
});

test('旧费用后缀变化可唯一匹配时迁移，无法匹配的旧偏好保留', async (t) => {
  const spec = defaultSpec(); spec.providers[0].models[1].name = 'DeepSeek-V4-Pro · x0.05';
  const old = labelKey('DeepSeek', 'DeepSeek-V4-Pro · x0.15→x0.08');
  const unknown = labelKey('以前的厂商', '以前的模型');
  const { env, panel } = await setup({ spec, state: { favorites: [old, unknown], aliases: { [old]: 'Pro' } } });
  t.after(() => env.dispose());
  assert.deepEqual(stored(env).favorites, [idKey('deepseek-account', 'DeepSeek-V4-Pro'), unknown]);
  assert.equal(panel.querySelectorAll('.mo-row-name')[1].textContent, 'Pro');
});

test('同名模型使用不同 ID，歧义旧名字不迁移到任何一个模型', async (t) => {
  const spec = { providers: [{ id: 'P', label: 'P', models: [{ id: 'one', name: '同名' }, { id: 'two', name: '同名' }] }] };
  const old = labelKey('P', '同名');
  const { env, panel } = await setup({ spec, state: { favorites: [old], aliases: { [old]: '旧别名' } } });
  t.after(() => env.dispose());
  assert.deepEqual(Array.from(panel.querySelectorAll('[data-act="choose"]')).map((row) => row.dataset.key), [idKey('P', 'one'), idKey('P', 'two')]);
  assert.deepEqual(stored(env).favorites, [old]);
  assert.equal(stored(env).aliases[old], '旧别名');
  assert.equal(panel.querySelector('.mo-row-name').textContent, '同名');
});

test('迟到的目录缓存通知会迁移偏好；卸载后取消订阅', async () => {
  const spec = defaultSpec();
  const old = labelKey('DeepSeek', 'DeepSeek-V4.1-Flash');
  const setupEnv = await setup({ groups: [], state: { favorites: [old], aliases: { [old]: '小闪' } } });
  assert.equal(setupEnv.panel.querySelector('[data-act="choose"]').dataset.key, old);
  setupEnv.cached.groups = catalogOf(spec); setupEnv.emit();
  assert.equal(setupEnv.panel.querySelector('[data-act="choose"]').dataset.key, idKey('deepseek-account', 'DeepSeek-V4.1-Flash'));
  assert.equal(setupEnv.panel.querySelector('.mo-row-name').textContent, '小闪');
  assert.equal(setupEnv.listeners.size, 1);
  setupEnv.env.dispose(); assert.equal(setupEnv.listeners.size, 0);
});

test('仅 disabled 与 aria-checked 变化也刷新可用状态、勾选与厂商高亮', async (t) => {
  const { env, view, panel } = await setup(); t.after(() => env.dispose());
  view.items[0].disabled = true;
  view.items[0].setAttribute('aria-checked', 'false');
  view.items[1].setAttribute('aria-checked', 'true');
  await settle(env.window, 300);
  const rows = panel.querySelectorAll('[data-act="choose"]');
  assert.equal(rows[0].getAttribute('data-disabled'), '1');
  assert.equal(rows[0].getAttribute('aria-disabled'), 'true');
  assert.equal(rows[0].getAttribute('data-selected'), null);
  assert.equal(rows[1].getAttribute('data-selected'), '1');
  view.items[0].disabled = false; await settle(env.window, 300);
  assert.equal(panel.querySelector('[data-act="choose"]').getAttribute('data-disabled'), null);
});

test('状态刷新期间保留正在编辑的别名文本、焦点与光标位置', async (t) => {
  const { env, view, panel } = await setup(); t.after(() => env.dispose());
  panel.querySelector('[data-act="manage"]').click(); panel.querySelector('[data-act="edit-alias"]').click();
  const input = env.document.activeElement;
  type(env, input, '暂存别名 '); input.setSelectionRange(2, 4);
  const modelKey = input.dataset.key;
  view.items[0].disabled = true; await settle(env.window, 300);
  assert.equal(env.document.activeElement.dataset.key, modelKey);
  assert.equal(env.document.activeElement.value, '暂存别名 ');
  assert.equal(env.document.activeElement.selectionStart, 2);
  assert.equal(env.document.activeElement.selectionEnd, 4);
});

test('编辑后切总览、完成或关闭，不残留会拦截 Esc 的编辑状态', async (t) => {
  const { env, view, panel } = await setup(); t.after(() => env.dispose());
  for (const action of ['overview', 'manage-off', 'close']) {
    openPanelViaHeading(env, view);
    panel.querySelector('[data-act="manage"]').click(); panel.querySelector('[data-act="edit-alias"]').click();
    panel.querySelector('[data-act="' + action + '"]').click();
    if (action === 'close') openPanelViaHeading(env, view);
    const search = panel.querySelector('.mo-search');
    type(env, search, 'DeepSeek'); press(env, search, 'Escape');
    assert.equal(search.value, '', action + ' 后第一次 Esc 就应清空搜索');
    assert.equal(panel.hidden, false);
  }
});

test('当前厂商只显示自己的隐藏数量，总览统计目录内全部隐藏项', async (t) => {
  const { env, panel } = await setup({ state: { hidden: [labelKey('Free 模型', 'free-v4-flash'), labelKey('不存在', '已下架')] } });
  t.after(() => env.dispose());
  assert.equal(panel.querySelector('.mo-foot').hidden, true);
  assert.equal(panel.querySelector('.mo-summary').textContent, '4 模型');
  panel.querySelector('[data-act="overview"]').click();
  assert.equal(panel.querySelector('.mo-foot').textContent, '已隐藏 1');
  const free = Array.from(panel.querySelectorAll('[data-act="provider"]')).find((row) => row.dataset.key === 'Free 模型'); free.click();
  assert.equal(panel.querySelector('.mo-foot').textContent, '已隐藏 1');
  assert.equal(panel.querySelector('.mo-summary').textContent, '8 模型');
});

test('稳定键与旧键不碰撞，迁移去重且已有 ID 别名优先', () => {
  const { stableModelKey, remapPreferenceKeys } = clientScope(['stableModelKey', 'remapPreferenceKeys']);
  assert.notEqual(stableModelKey('A', 'B'), labelKey('A', 'B'));
  const old = labelKey('A', 'B'); const stable = stableModelKey('P', 'M');
  const next = remapPreferenceKeys({ version: 5, favorites: [old, stable], recents: [stable, old], aliases: { [old]: '旧', [stable]: '新' } }, new Map([[old, stable]]));
  assert.deepEqual(next.favorites, [stable]); assert.deepEqual(next.recents, [stable]); assert.equal(next.aliases[stable], '新');
});
