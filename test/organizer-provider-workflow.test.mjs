import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginEnv, settle, mountSettingsCard } from './load-client.mjs';
import { defaultSpec, mountModelMenu, openPanelViaHeading } from './harness.mjs';
import { attachKernelBehavior, realClick } from './kernel-behavior.mjs';

const STORAGE = 'dsh-liao-models-state-v1';
const type = (env, node, value) => { node.value = value; node.dispatchEvent(new env.window.Event('input', { bubbles: true })); };
const press = (env, node, key) => node.dispatchEvent(new env.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
async function setup() {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  await settle(env.window);
  return { env, view, panel: openPanelViaHeading(env, view) };
}

test('只保留悬浮，浮框和设置页不再出现模式切换', async (t) => {
  const { env, view, panel } = await setup(); t.after(() => env.dispose());
  assert.equal(panel.querySelector('[data-act="mode"]'), null);
  const card = mountSettingsCard(env); await settle(env.window, 50); t.after(() => card.unmount());
  assert.ok(!Array.from(card.container.querySelectorAll('button')).some((button) => ['面板', '悬浮', '列表'].includes(button.textContent)));
  view.sections[1].querySelector('[data-menu-group-heading]').click();
  assert.equal(panel.querySelector('.mo-title').textContent, 'Natsuki 网关', '点击无需双击等待');
  view.sections[1].querySelector('[data-menu-group-heading]').click();
  assert.equal(panel.hidden, false);
});

test('旧 panel 偏好迁移成 hover，置顶、别名、隐藏、字号保留', async (t) => {
  const env = createPluginEnv({ autoMount: false }); t.after(() => env.dispose());
  const modelKey = JSON.stringify(['DeepSeek', 'DeepSeek-V4-Pro']);
  env.window.localStorage.setItem(STORAGE, JSON.stringify({ version: 4, mode: 'panel', favorites: [modelKey], aliases: { [modelKey]: '小模型' }, hidden: [], fontSize: 14 }));
  env.plugin.apply(env.ctx); const view = mountModelMenu(env.document, defaultSpec()); await settle(env.window);
  const panel = openPanelViaHeading(env, view);
  assert.equal(panel.hidden, false, '旧 panel 用户也直接悬浮展开');
  assert.equal(panel.style.getPropertyValue('--mo-fs'), '14px');
  assert.ok(panel.textContent.includes('小模型'));
  panel.querySelector('[data-act="fav"]').click();
  const next = JSON.parse(env.window.localStorage.getItem(STORAGE));
  assert.equal(next.mode, 'hover'); assert.equal(next.version, 6); assert.equal(next.aliases[modelKey], '小模型');
});

test('厂商浮框的搜索不串到其他来源', async (t) => {
  const { env, view, panel } = await setup(); t.after(() => env.dispose());
  type(env, panel.querySelector('.mo-search'), 'grok');
  assert.equal(panel.querySelectorAll('[data-act="choose"]').length, 0);
  openPanelViaHeading(env, view, 1);
  type(env, panel.querySelector('.mo-search'), 'grok');
  assert.ok(panel.querySelectorAll('[data-act="choose"]').length > 0);
  assert.ok(Array.from(panel.querySelectorAll('[data-act="choose"]')).every((row) => JSON.parse(row.dataset.key)[0] === 'Natsuki 网关'));
});

test('主搜索只筛选厂商，阻止宿主按模型过滤，目录完整且保持折叠', async (t) => {
  const { env, view } = await setup(); t.after(() => env.dispose());
  let hostInput = 0;
  view.menu.addEventListener('input', () => hostInput++);
  view.menu.addEventListener('change', () => hostInput++);
  view.menu.addEventListener('search', () => hostInput++);
  assert.equal(view.searchInput.placeholder, '搜索厂商…');
  type(env, view.searchInput, 'natsuki');
  view.searchInput.dispatchEvent(new env.window.Event('change', { bubbles: true }));
  view.searchInput.dispatchEvent(new env.window.Event('search', { bubbles: true }));
  assert.equal(hostInput, 0);
  assert.deepEqual(view.sections.map((s) => s.hasAttribute('data-mo-provider-filtered')), [true, false, true]);
  assert.deepEqual(view.sections.map((s) => s.getAttribute('data-mo-collapsed')), ['1', '1', '1']);
  assert.equal(view.menu.querySelectorAll('button[role="menuitemradio"]').length, 32);
  type(env, view.searchInput, 'grok');
  assert.ok(view.sections.every((s) => s.hasAttribute('data-mo-provider-filtered')), '厂商不含 grok，不因模型名含 grok 返回来源');
  assert.equal(view.menu.hasAttribute('data-mo-empty-providers'), true);
  type(env, view.searchInput, '');
  assert.ok(view.sections.every((s) => !s.hasAttribute('data-mo-provider-filtered')));
});

test('厂商搜索后回车进入该厂商浮框，Esc 先清空厂商过滤', async (t) => {
  const { env, view, panel } = await setup(); t.after(() => env.dispose());
  const kernel = attachKernelBehavior(env.document, view); t.after(() => kernel.detach());
  type(env, view.searchInput, 'Free');
  press(env, view.searchInput, 'Enter');
  assert.equal(panel.querySelector('.mo-title').textContent, 'Free 模型');
  assert.equal(env.document.activeElement, panel.querySelector('.mo-search'));
  assert.equal(kernel.isOpen(), true);
  view.searchInput.focus(); press(env, view.searchInput, 'Escape');
  assert.equal(view.searchInput.value, '');
  assert.ok(view.sections.every((s) => !s.hasAttribute('data-mo-provider-filtered')));
});

test('插件卸载恢复原搜索属性、厂商显示与原生模型节点', async () => {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  const original = { placeholder: view.searchInput.placeholder, type: view.searchInput.type, label: view.searchInput.getAttribute('aria-label') };
  await settle(env.window); type(env, view.searchInput, 'Free');
  env.dispose();
  assert.equal(view.searchInput.placeholder, original.placeholder);
  assert.equal(view.searchInput.type, original.type);
  assert.equal(view.searchInput.getAttribute('aria-label'), original.label);
  assert.equal(view.searchInput.hasAttribute('data-mo-provider-search'), false);
  assert.ok(view.sections.every((s) => !s.hasAttribute('data-mo-provider-filtered')));
  assert.equal(view.items.length, 32);
});

test('整理默认只有紧凑行，按需打开一个别名编辑器，行点击不会切换模型', async (t) => {
  const { env, view, panel } = await setup(); t.after(() => env.dispose());
  const kernel = attachKernelBehavior(env.document, view); t.after(() => kernel.detach());
  let selected = 0; view.items.forEach((row) => row.addEventListener('click', () => selected++));
  realClick(env.window, panel.querySelector('[data-act="manage"]'));
  assert.equal(panel.querySelectorAll('.mo-alias-editor:not([hidden])').length, 0);
  realClick(env.window, panel.querySelector('[data-act="edit-alias"]'));
  assert.equal(panel.querySelectorAll('.mo-alias-editor:not([hidden])').length, 1);
  const input = env.document.activeElement;
  assert.equal(input.dataset.act, 'alias');
  type(env, input, '小闪'); press(env, input, 'Enter');
  assert.equal(panel.querySelectorAll('.mo-alias-editor:not([hidden])').length, 0);
  assert.equal(panel.querySelector('.mo-row-name').textContent, '小闪');
  panel.querySelector('[data-act="choose"]').click();
  assert.equal(selected, 0);
  assert.equal(kernel.isOpen(), true);
  panel.querySelector('[data-act="manage-off"]').click();
  assert.equal(panel.querySelector('.mo-title').textContent, 'DeepSeek', '完成后留在当前厂商');
});

test('整理筛选已置顶与已隐藏，隐藏项可恢复且厂商计数跟随', async (t) => {
  const { env, view, panel } = await setup(); t.after(() => env.dispose());
  panel.querySelector('[data-act="manage"]').click();
  panel.querySelector('[data-act="fav"]').click();
  panel.querySelector('[data-filter="pinned"]').click();
  assert.equal(panel.querySelectorAll('.mo-edit-row').length, 1);
  panel.querySelector('[data-filter="all"]').click();
  panel.querySelector('[data-act="hide"]').click();
  panel.querySelector('[data-filter="hidden"]').click();
  assert.equal(panel.querySelectorAll('.mo-edit-row').length, 1);
  assert.ok(panel.querySelector('[data-act="unhide"]'));
  assert.equal(view.sections[0].querySelector('[data-menu-group-heading]').getAttribute('data-mo-badge'), '(3)');
  panel.querySelector('[data-act="unhide"]').click();
  assert.equal(panel.querySelectorAll('.mo-edit-row').length, 0);
  assert.equal(view.sections[0].querySelector('[data-menu-group-heading]').getAttribute('data-mo-badge'), '(4)');
});

test('厂商搜索缩短菜单后仍贴着触发按钮，清空时按新高度重新定位', async (t) => {
  const { env, view } = await setup(); t.after(() => env.dispose());
  view.trigger.getBoundingClientRect = () => ({ top: 700, right: 900, width: 200, height: 28 });
  view.menu.getBoundingClientRect = () => ({ left: 30, top: 20, width: 240, height: 80 + 60 * view.sections.filter((section) => !section.hasAttribute('data-mo-provider-filtered')).length });
  view.menu.style.top = '20px'; view.menu.style.left = '30px';
  type(env, view.searchInput, 'DeepSeek');
  assert.equal(view.menu.style.getPropertyValue('--mo-menu-top'), '552px');
  assert.equal(view.menu.style.getPropertyValue('--mo-menu-left'), '660px');
  assert.equal(view.menu.style.top, '20px', '通过插件变量定位，不覆盖宿主 inline top');
  type(env, view.searchInput, '');
  assert.equal(view.menu.style.getPropertyValue('--mo-menu-top'), '432px');
  type(env, view.searchInput, '不存在');
  assert.equal(view.menu.style.getPropertyValue('--mo-menu-top'), '612px', '无结果时同样靠近触发按钮');
  env.dispose();
  assert.equal(view.menu.hasAttribute('data-mo-anchor'), false);
  assert.equal(view.menu.style.getPropertyValue('--mo-menu-top'), '');
  assert.equal(view.menu.style.getPropertyValue('--mo-menu-left'), '');
  assert.equal(view.menu.style.top, '20px'); assert.equal(view.menu.style.left, '30px');
});

test('菜单定位随窗口尺寸变化更新，贴靠点超出边界时保留安全边距', async (t) => {
  const { env, view } = await setup(); t.after(() => env.dispose());
  view.trigger.getBoundingClientRect = () => ({ top: 40, right: 1600, width: 200, height: 28 });
  view.menu.getBoundingClientRect = () => ({ width: 240, height: 140 });
  env.window.dispatchEvent(new env.window.Event('resize'));
  assert.equal(view.menu.style.getPropertyValue('--mo-menu-top'), '12px');
  assert.equal(view.menu.style.getPropertyValue('--mo-menu-left'), '772px');
  Object.defineProperty(env.window, 'innerWidth', { value: 800, configurable: true });
  env.window.dispatchEvent(new env.window.Event('resize'));
  assert.equal(view.menu.style.getPropertyValue('--mo-menu-left'), '548px');
});
