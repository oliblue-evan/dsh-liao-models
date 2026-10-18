/**
 * 用户旅程：一条测试走完这个插件存在的**全部理由**。
 *
 * 场景取自真实环境：单一来源就有 19 个模型，加上 DeepSeek 与 Free 来源共 32 个，
 * 菜单一屏排不完。用户在「随手用一下」和「换一个」两种心境下，走完整条路。
 *
 * 这条测试刻意用**真实事件序列**（mousedown → 焦点 → mouseup → click）驱动，
 * 并接上内核自己的关闭逻辑，尽可能接近真实浏览器里发生的事。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginEnv, settle } from './load-client.mjs';
import { mountModelMenu, defaultSpec } from './harness.mjs';
import { attachKernelBehavior, realClick } from './kernel-behavior.mjs';
/** 与插件 modelKey 等价：JSON 数组编码（键格式 v2）。 */
const moKey = (provider, model) => JSON.stringify([provider, model]);


const PANEL = 'dsh-liao-models-panel';
const KEY = 'dsh-liao-models-state-v1';

/** 建环境 + 菜单 + 内核行为模拟。 */
async function journey() {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  const kernel = attachKernelBehavior(env.document, view);
  await settle(env.window);
  return {
    env,
    view,
    kernel,
    panel: () => env.document.getElementById(PANEL),
    /** 打开总览（面板头部的 ⌂）—— 启动按钮已移除，总览改由 ⌂ 进入。 */
    overview: () => {
      const btn = env.document.getElementById(PANEL).querySelector('[data-act="overview"]');
      realClick(env.window, btn);
      return btn;
    },
    heading: (i) => view.sections[i].querySelector('[data-menu-group-heading]'),
    hover: (i) => env.document && view.sections[i].querySelector('[data-menu-group-heading]')
      .dispatchEvent(new env.window.MouseEvent('mouseover', { bubbles: true })),
    rows: () => Array.from(env.document.getElementById(PANEL).querySelectorAll('.mo-row-name')).map((n) => n.textContent),
    state: () => JSON.parse(env.window.localStorage.getItem(KEY)),
    pick: (key) => {
      const row = Array.from(env.document.getElementById(PANEL).querySelectorAll('[data-act="choose"]'))
        .filter((r) => r.getAttribute('data-key') === key)[0];
      assert.ok(row, '找不到模型行 ' + key);
      realClick(env.window, row);
    },
  };
}

test('★ 用户旅程：32 个模型里快速切换常用模型（完整流程）', async () => {
  const j = await journey();
  const { env, view, kernel } = j;

  // ── 第 0 步：菜单打开时，原生列表已被折叠成「来源清单」 ──
  assert.equal(view.sections.length, 3, '三个来源');
  for (const section of view.sections) {
    assert.equal(section.getAttribute('data-mo-collapsed'), '1', '每个来源都折叠');
  }
  const badges = view.sections.map((s) => s.querySelector('[data-menu-group-heading]').getAttribute('data-mo-badge'));
  assert.deepEqual(badges, ['(4)', '(19)', '(9)'], '来源行显示模型数');

  // ── 第 1 步：悬停「Natsuki 网关」→ 面板滑出，列出该来源 19 个模型 ──
  j.hover(1);
  assert.equal(j.panel().hidden, false, '面板应打开');
  assert.equal(kernel.isOpen(), true, '菜单不该被关掉');
  assert.equal(j.rows().length, 19, '应列出该来源全部 19 个模型');

  // ── 第 2 步：在面板里选一个（内核真实按钮收到点击） ──
  let chosen = null;
  for (const b of view.items) b.addEventListener('click', () => { chosen = b.getAttribute('title'); });
  j.pick(moKey('Natsuki 网关','grok-4.7'));
  assert.equal(chosen, 'grok-4.7', '选择应由内核自己的 onClick 完成');
  assert.equal(j.panel().hidden, true, '选完收起');
  assert.equal(kernel.isOpen(), true, '选中过程菜单不该被关掉');
  assert.deepEqual(j.state().recents, [moKey('Natsuki 网关','grok-4.7')], '应记入最近');

  // ── 第 3 步：从面板进「总览」（面板头部的 ⌂） ──
  j.hover(1); // 选完模型后已收起，先划过标题把面板叫回来
  j.overview();
  assert.equal(j.panel().hidden, false, '⌂ 应打开/留在面板');
  let labels = Array.from(j.panel().querySelectorAll('.mo-group-label')).map((n) => n.textContent);
  assert.ok(labels.includes('最近'), '总览应显示「最近」区：' + labels.join(','));
  assert.ok(labels.includes('来源'), '总览应显示「来源」区');
  assert.equal(kernel.isOpen(), true, '点 ⌂ 不该关菜单');

  // ── 第 4 步：置顶两个常用模型（整理视图） ──
  realClick(env.window, j.panel().querySelector('[data-act="manage"]'));
  for (const key of [moKey('DeepSeek','DeepSeek-V4.1-Flash'), moKey('Natsuki 网关','grok-latest')]) {
    const fav = Array.from(j.panel().querySelectorAll('[data-act="fav"]'))
      .filter((b) => b.getAttribute('data-key') === key)[0];
    assert.ok(fav, '找不到 ★ 按钮：' + key);
    realClick(env.window, fav);
  }
  assert.equal(kernel.isOpen(), true, '置顶过程菜单不该关');
  realClick(env.window, j.panel().querySelector('[data-act="manage-off"]'));

  // ── 第 5 步：隐藏用不上的模型 ──
  realClick(env.window, j.panel().querySelector('[data-act="manage"]'));
  const hide = Array.from(j.panel().querySelectorAll('[data-act="hide"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('Natsuki 网关', 'grok-imagine-video'))[0];
  realClick(env.window, hide);
  const nativeHidden = view.items.filter((b) => b.getAttribute('title') === 'grok-imagine-video')[0];
  assert.equal(nativeHidden.getAttribute('data-mo-hidden'), '1', '原生项应被标记隐藏');
  realClick(env.window, j.panel().querySelector('[data-act="manage-off"]'));

  // ── 第 6 步：置顶区在总览最前，且最近不含置顶项（不重复） ──
  labels = Array.from(j.panel().querySelectorAll('.mo-group-label')).map((n) => n.textContent);
  assert.deepEqual(labels.slice(0, 2), ['置顶', '最近'], '顺序应是 置顶 → 最近 → 来源');
  const favouriteRows = j.rows();
  // 置顶按「最近加入的在最前」排序（toggleInList 用 unshift），
  // 所以最后置顶的 grok-latest 应排在先置顶的 DeepSeek-V4.1-Flash 之前。
  assert.ok(
    favouriteRows.indexOf('grok-latest') < favouriteRows.indexOf('DeepSeek-V4.1-Flash'),
    '置顶应「新的在前」：' + favouriteRows.slice(0, 4).join(',')
  );

  // ── 第 7 步：搜索 —— 别名 + 模糊，跨来源 ──
  const search = j.panel().querySelector('.mo-search');
  realClick(env.window, search, { focus: true });
  assert.equal(env.document.activeElement, search, '搜索框应能聚焦');
  for (const ch of 'dsv4f') {
    search.value += ch;
    search.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  }
  const hits = j.rows();
  assert.ok(hits.includes('DeepSeek-V4.1-Flash'), '模糊搜索应跨来源命中：' + hits.join(','));
  assert.equal(hits.includes('grok-4.7'), false, '不相关的模型不该出现');
  assert.equal(kernel.isOpen(), true, '搜索打字期间菜单不该关');
  // 被隐藏的模型搜不到
  search.value = 'grok-imagine-video';
  search.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  assert.equal(j.rows().includes('grok-imagine-video'), false, '已隐藏的模型不该被搜出来');
  search.value = '';
  search.dispatchEvent(new env.window.Event('input', { bubbles: true }));

  // ── 第 8 步：给长名字起别名，并用别名搜到 ──
  realClick(env.window, j.panel().querySelector('[data-act="manage"]'));
  const aliasInput = Array.from(j.panel().querySelectorAll('[data-act="alias"]'))
    .filter((n) => n.getAttribute('data-key') === moKey('Natsuki 网关','grok-latest'))[0];
  realClick(env.window, aliasInput, { focus: true });
  aliasInput.value = '最新 Grok';
  aliasInput.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  realClick(env.window, j.panel().querySelector('[data-act="manage-off"]'));

  search.value = '最新';
  search.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  assert.ok(j.rows().includes('最新 Grok'), '别名应能搜到：' + j.rows().join(','));

  // ── 第 9 步：偏好持久化 —— 重开 GUI 后一切照旧 ──
  const saved = env.window.localStorage.getItem(KEY);
  const parsed = JSON.parse(saved);
  assert.deepEqual(parsed.favorites, [moKey('Natsuki 网关','grok-latest'), moKey('DeepSeek','DeepSeek-V4.1-Flash')]);
  assert.deepEqual(parsed.hidden, [moKey('Natsuki 网关', 'grok-imagine-video')]);
  assert.equal(parsed.aliases[moKey('Natsuki 网关','grok-latest')], '最新 Grok');
  assert.ok(parsed.recents.includes(moKey('Natsuki 网关','grok-4.7')));
  kernel.detach();
  env.dispose();

  // 全新环境（等价于重开 GUI），恢复同一份偏好
  const env2 = createPluginEnv();
  env2.window.localStorage.setItem(KEY, saved);
  const view2 = mountModelMenu(env2.document, defaultSpec());
  await settle(env2.window);
  const panel2 = env2.document.getElementById(PANEL);
  // 划过标题打开面板，再进总览（启动按钮已移除）
  view2.sections[0].querySelector('[data-menu-group-heading]')
    .dispatchEvent(new env2.window.MouseEvent('mouseover', { bubbles: true }));
  assert.equal(panel2.hidden, false, '重开后划过标题应能打开面板');
  realClick(env2.window, panel2.querySelector('[data-act="overview"]'));
  const names2 = Array.from(panel2.querySelectorAll('.mo-row-name')).map((n) => n.textContent);
  assert.ok(names2.includes('DeepSeek-V4.1-Flash'), '置顶应恢复');
  assert.ok(names2.includes('最新 Grok'), '别名应恢复');
  const hidden2 = view2.items.filter((b) => b.getAttribute('title') === 'grok-imagine-video')[0];
  assert.equal(hidden2.getAttribute('data-mo-hidden'), '1', '隐藏应恢复');
  env2.dispose();
});

test('★ 用户旅程：/model 弹窗始终不被污染（同一次会话里两者共存）', async () => {
  // 用户在 composer 打开模型菜单的同时，也可能用 /model 命令弹窗
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  await settle(env.window);
  // 此时插件已增强 composer 菜单
  assert.equal(view.menu.getAttribute('data-mo-scope'), '1');

  // 再挂一个 /model 弹窗（共用 MenuGroup 原语）
  const { mountCommandPopup } = await import('./harness.mjs');
  const popup = mountCommandPopup(env.document, {
    providers: [
      { id: 'deepseek-account', label: 'DeepSeek', options: ['DeepSeek-V4.1-Flash', 'DeepSeek-V4-Pro'] },
      { id: 'natsuki', label: 'Natsuki 网关', options: ['gpt-6-astra', 'grok-4.7'] },
    ],
    selected: 'DeepSeek-V4.1-Flash',
  });
  await settle(env.window, 300);

  // 弹窗必须毫无插件痕迹
  assert.equal(popup.listbox.getAttribute('data-mo-scope'), null, 'listbox 不该被标作用域');
  for (const section of popup.sections) {
    assert.equal(section.getAttribute('data-mo-section'), null, '弹窗分组不该被标记');
    assert.equal(section.getAttribute('data-mo-collapsed'), null, '弹窗分组不该被折叠');
    const heading = section.querySelector('[data-menu-group-heading]');
    assert.equal(heading.getAttribute('data-mo-badge'), null, '弹窗标题不该有徽标');
    assert.equal(heading.getAttribute('data-mo-current'), null, '弹窗标题不该有当前标记');
  }
  // 弹窗里的选项不该被隐藏
  for (const option of popup.options) {
    assert.equal(option.getAttribute('data-mo-hidden'), null, '弹窗选项不该被藏');
  }
  env.dispose();
});
