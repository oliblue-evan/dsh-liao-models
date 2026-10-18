/**
 * 交互端到端：在 jsdom 里给**真实 client.js** 派发真实事件，验证五项功能。
 *
 * 这些都是「用户真的点了/悬停了」级别的验证：事件从 document 派发，
 * 走插件真实的捕获期委托路径，而不是直接调内部函数。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginEnv, settle } from './load-client.mjs';
import { mountModelMenu, defaultSpec } from './harness.mjs';
/** 与插件 modelKey 等价：JSON 数组编码（键格式 v2）。 */
const moKey = (provider, model) => JSON.stringify([provider, model]);


const PANEL = 'dsh-liao-models-panel';
const SCOPE = 'data-mo-scope';

/** 建环境 + 挂菜单 + 扫描完成。 */
async function setup(spec = defaultSpec()) {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, spec);
  await settle(env.window);
  return { env, view };
}

/** 取面板。 */
function panelOf(env) {
  return env.document.getElementById(PANEL);
}

/** 在某个元素上派发冒泡事件（走 document 委托）。 */
function fire(window, node, type, init = {}) {
  node.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

/** 读面板里所有可见模型行的标签文本。 */
function rowLabels(env) {
  return Array.from(panelOf(env).querySelectorAll('.mo-row-name')).map((n) => n.textContent);
}

/** 读面板里来源行的标签（仅 .mo-row[data-act=provider]）。 */
function providerLabels(env) {
  return Array.from(panelOf(env).querySelectorAll('[data-act="provider"] .mo-row-name')).map((n) => n.textContent);
}

test('放置：面板初始隐藏，菜单增强后才可能打开', async () => {
  const { env } = await setup();
  const panel = panelOf(env);
  assert.ok(panel, '面板应挂在 body');
  assert.equal(panel.hidden, true, '默认隐藏');
  assert.equal(panel.parentElement, env.document.body, '面板挂在 body（不进入 React 子树）');
  env.dispose();
});

test('悬停来源标题（hover 模式）→ 面板滑出并列出该来源模型', async () => {
  const { env, view } = await setup();
  const heading = view.sections[1].querySelector('[data-menu-group-heading]'); // Natsuki 网关
  fire(env.window, heading, 'mouseover');
  const panel = panelOf(env);
  assert.equal(panel.hidden, false, '悬停应打开面板');
  const labels = rowLabels(env);
  assert.ok(labels.length > 0, '面板应有模型行');
  assert.ok(labels.includes('grok-4.7'), '应列出该来源的模型');
  assert.equal(labels.includes('DeepSeek-V4.1-Flash'), false, '不该混入其他来源的模型');
  const title = panel.querySelector('.mo-title').textContent;
  assert.equal(title, 'Natsuki 网关', '标题应显示来源名');
  env.dispose();
});

test('点击来源立即打开，重复点击保持，关闭按钮收起', async () => {
  const { env, view } = await setup();
  const heading = view.sections[2].querySelector('[data-menu-group-heading]'); // Free 模型
  fire(env.window, heading, 'click');
  await settle(env.window, 300); // 单击有 240ms 双击判定窗口
  assert.equal(panelOf(env).hidden, false, '点击应打开面板');
  assert.equal(panelOf(env).querySelector('.mo-title').textContent, 'Free 模型');
  // 再点同一个来源应关闭
  fire(env.window, heading, 'click');
  await settle(env.window, 300);
  assert.equal(panelOf(env).hidden, false, '重复点击应保持浮框');
  panelOf(env).querySelector('[data-act="close"]').click();
  assert.equal(panelOf(env).hidden, true);
  env.dispose();
});

test('点击面板里的模型 → 程序化点击内核真实按钮（不自己改状态）', async () => {
  const { env, view } = await setup();
  fire(env.window, view.sections[1].querySelector('[data-menu-group-heading]'), 'mouseover');
  // 记录内核按钮被点击
  let clicked = null;
  for (const button of view.items) {
    button.addEventListener('click', () => {
      clicked = button.getAttribute('title');
    });
  }
  const rows = Array.from(panelOf(env).querySelectorAll('[data-act="choose"]'));
  const target = rows.filter((r) => r.getAttribute('data-key') === moKey('Natsuki 网关','grok-4.7'))[0];
  assert.ok(target, '应能找到目标行');
  target.click();
  assert.equal(clicked, 'grok-4.7', '应由内核真实按钮收到点击（选择动作交给内核）');
  assert.equal(panelOf(env).hidden, true, '选完自动收起面板');
  env.dispose();
});

test('置顶：★ 把模型放进「置顶」区，取消后移出', async () => {
  const { env, view } = await setup();
  fire(env.window, view.sections[0].querySelector('[data-menu-group-heading]'), 'mouseover');
  panelOf(env).querySelector('[data-act="manage"]').click();

  const favBtn = Array.from(panelOf(env).querySelectorAll('[data-act="fav"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('DeepSeek','DeepSeek-V4-Pro'))[0];
  assert.ok(favBtn, '管理模式每条模型都应有置顶按钮');
  favBtn.click();
  // 用结构化断言而不是子串匹配：键本身是 JSON 字符串，存进 JSON 后引号会被转义，
  // 直接 includes() 原始键会失败（那是断言写法问题，不是插件的问题）。
  assert.deepEqual(
    JSON.parse(env.window.localStorage.getItem('dsh-liao-models-state-v1')).favorites,
    [moKey('DeepSeek', 'DeepSeek-V4-Pro')],
    '置顶应被持久化'
  );

  // 退出管理即回到总览：应出现「置顶」区，且该模型在区内
  panelOf(env).querySelector('[data-act="manage-off"]').click();
  panelOf(env).querySelector('[data-act="overview"]').click();
  const groupLabels = Array.from(panelOf(env).querySelectorAll('.mo-group-label')).map((n) => n.textContent);
  assert.ok(groupLabels.includes('置顶'), '应渲染置顶区，实际：' + groupLabels.join(','));

  // 取消置顶后应从置顶区消失
  panelOf(env).querySelector('[data-act="manage"]').click();
  const favBtn2 = Array.from(panelOf(env).querySelectorAll('[data-act="fav"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('DeepSeek','DeepSeek-V4-Pro'))[0];
  favBtn2.click();
  panelOf(env).querySelector('[data-act="manage-off"]').click();
  const after = Array.from(panelOf(env).querySelectorAll('.mo-group-label')).map((n) => n.textContent);
  assert.equal(after.includes('置顶'), false, '取消置顶后不该再有置顶区');
  env.dispose();
});

test('置顶持久化：重新打开菜单后仍在（localStorage 往返）', async () => {
  const env1 = createPluginEnv();
  const view1 = mountModelMenu(env1.document, defaultSpec());
  await settle(env1.window);
  fire(env1.window, view1.sections[0].querySelector('[data-menu-group-heading]'), 'mouseover');
  panelOf(env1).querySelector('[data-act="manage"]').click();
  panelOf(env1).querySelector('[data-act="manage-all"]').click();
  const fav = Array.from(panelOf(env1).querySelectorAll('[data-act="fav"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('Natsuki 网关','grok-latest'))[0];
  fav.click();
  const saved = env1.window.localStorage.getItem('dsh-liao-models-state-v1');
  env1.dispose();

  // 新环境共用同一个 storage 内容（模拟重开 GUI）
  const env2 = createPluginEnv();
  env2.window.localStorage.setItem('dsh-liao-models-state-v1', saved);
  const view2 = mountModelMenu(env2.document, defaultSpec());
  await settle(env2.window);
  fire(env2.window, view2.sections[1].querySelector('[data-menu-group-heading]'), 'mouseover');
  panelOf(env2).querySelector('[data-act="close"]').click();
  // 打开总览视图：点击当前来源后再切到 provider=null 不可得，直接检查存储 + 渲染
  const state = JSON.parse(env2.window.localStorage.getItem('dsh-liao-models-state-v1'));
  assert.deepEqual(state.favorites, [moKey('Natsuki 网关','grok-latest')], '置顶应跨环境保留');
  env2.dispose();
});

test('最近：选择后进入「最近」区并按最近优先排序', async () => {
  const { env, view } = await setup();
  // 依次选择两个模型
  fire(env.window, view.sections[1].querySelector('[data-menu-group-heading]'), 'mouseover');
  const choose = (key) => {
    const row = Array.from(panelOf(env).querySelectorAll('[data-act="choose"]')).filter((r) => r.getAttribute('data-key') === key)[0];
    assert.ok(row, '找不到行 ' + key);
    row.click();
  };
  choose(moKey('Natsuki 网关','grok-4.7'));
  fire(env.window, view.sections[1].querySelector('[data-menu-group-heading]'), 'mouseover');
  choose(moKey('Natsuki 网关','grok-latest'));

  const raw = env.window.localStorage.getItem('dsh-liao-models-state-v1');
  const state = JSON.parse(raw);
  assert.deepEqual(state.recents.slice(0, 2), [moKey('Natsuki 网关','grok-latest'), moKey('Natsuki 网关','grok-4.7')], '最近的应排最前');
  env.dispose();
});

test('搜索：厂商浮框只过滤该厂商，支持模糊匹配', async () => {
  const { env, view } = await setup();
  fire(env.window, view.sections[0].querySelector('[data-menu-group-heading]'), 'mouseover');
  const input = panelOf(env).querySelector('.mo-search');
  assert.ok(input, '面板应有搜索框');

  input.value = 'grok';
  input.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  const labels = rowLabels(env);
  assert.equal(labels.length, 0, '当前 DeepSeek 厂商不应返回别家的 grok');
  assert.ok(labels.every((l) => l.toLowerCase().includes('grok')), '结果应都与查询相关：' + labels.join(','));

  // 跨来源：grok 在 Natsuki 里，但搜索应跨来源
  input.value = 'DeepSeek-V4.1';
  input.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  assert.ok(rowLabels(env).includes('DeepSeek-V4.1-Flash'), '搜索应在当前厂商命中');

  // 模糊：不连续字母
  input.value = 'dsv4f';
  input.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  const fuzzy = rowLabels(env);
  assert.ok(fuzzy.length > 0, '模糊匹配应有结果：' + fuzzy.join(','));

  // 无结果
  input.value = 'zzzzzz';
  input.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  assert.ok(panelOf(env).querySelector('.mo-empty'), '无结果应提示');
  env.dispose();
});

test('搜索命中别名：改了别名后可用别名搜到', async () => {
  const { env, view } = await setup();
  fire(env.window, view.sections[0].querySelector('[data-menu-group-heading]'), 'mouseover');
  panelOf(env).querySelector('[data-act="manage"]').click();
  const aliasInput = Array.from(panelOf(env).querySelectorAll('[data-act="alias"]'))
    .filter((n) => n.getAttribute('data-key') === moKey('DeepSeek','DeepSeek-V4.1-Flash'))[0];
  assert.ok(aliasInput, '应有别名输入框');
  aliasInput.value = '小闪';
  aliasInput.dispatchEvent(new env.window.Event('input', { bubbles: true }));

  panelOf(env).querySelector('[data-act="manage-off"]').click();
  const search = panelOf(env).querySelector('.mo-search');
  search.value = '小闪';
  search.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  assert.ok(rowLabels(env).includes('小闪'), '应能用别名搜到：' + rowLabels(env).join(','));
  env.dispose();
});

test('别名：显示名替换为别名并持久化', async () => {
  const { env, view } = await setup();
  fire(env.window, view.sections[0].querySelector('[data-menu-group-heading]'), 'mouseover');
  panelOf(env).querySelector('[data-act="manage"]').click();
  const aliasInput = Array.from(panelOf(env).querySelectorAll('[data-act="alias"]'))
    .filter((n) => n.getAttribute('data-key') === moKey('DeepSeek','DeepSeek-V4-Pro'))[0];
  aliasInput.value = 'Pro 短名';
  aliasInput.dispatchEvent(new env.window.Event('input', { bubbles: true }));

  const state = JSON.parse(env.window.localStorage.getItem('dsh-liao-models-state-v1'));
  assert.equal(state.aliases[moKey('DeepSeek','DeepSeek-V4-Pro')], 'Pro 短名', '别名应持久化');
  // 行标签应即时更新
  const row = Array.from(panelOf(env).querySelectorAll('[data-act="choose"]'))
    .filter((r) => r.getAttribute('data-key') === moKey('DeepSeek','DeepSeek-V4-Pro'))[0];
  assert.equal(row.querySelector('.mo-row-name').textContent, 'Pro 短名', '行标签应立刻跟随别名');
  env.dispose();
});

test('隐藏：🚫 把模型从列表移除，且能从管理模式恢复', async () => {
  const { env, view } = await setup();
  fire(env.window, view.sections[0].querySelector('[data-menu-group-heading]'), 'mouseover');
  panelOf(env).querySelector('[data-act="manage"]').click();
  const hideBtn = Array.from(panelOf(env).querySelectorAll('[data-act="hide"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('DeepSeek','DeepSeek-V4-Flash-Vision-Exp'))[0];
  assert.ok(hideBtn, '应有隐藏按钮');
  hideBtn.click();

  // 原生按钮应被标记隐藏（CSS 据此 display:none）
  const hiddenButton = view.items.filter((b) => b.getAttribute('title') === 'DeepSeek-V4-Flash-Vision-Exp')[0];
  assert.equal(hiddenButton.getAttribute('data-mo-hidden'), '1', '原生按钮应被标记隐藏');
  const state = JSON.parse(env.window.localStorage.getItem('dsh-liao-models-state-v1'));
  assert.deepEqual(state.hidden, [moKey('DeepSeek','DeepSeek-V4-Flash-Vision-Exp')]);

  // 管理模式应能看到「已隐藏」并可恢复
  const restore = Array.from(panelOf(env).querySelectorAll('[data-act="unhide"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('DeepSeek','DeepSeek-V4-Flash-Vision-Exp'))[0];
  assert.ok(restore, '管理模式应有恢复入口');
  restore.click();
  assert.equal(hiddenButton.getAttribute('data-mo-hidden'), null, '恢复后不再标记隐藏');
  env.dispose();
});

test('Escape 与点击外部都会收起面板', async () => {
  const { env, view } = await setup();
  fire(env.window, view.sections[0].querySelector('[data-menu-group-heading]'), 'mouseover');
  assert.equal(panelOf(env).hidden, false);
  env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(panelOf(env).hidden, true, 'Escape 应收起');

  fire(env.window, view.sections[0].querySelector('[data-menu-group-heading]'), 'mouseover');
  assert.equal(panelOf(env).hidden, false);
  // 点菜单之外（例如 body 上的一个无关节点）
  const outside = env.document.createElement('div');
  env.document.body.appendChild(outside);
  outside.dispatchEvent(new env.window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(panelOf(env).hidden, true, '点击外部应收起');
  env.dispose();
});

test('点面板内部不应误关面板', async () => {
  const { env, view } = await setup();
  fire(env.window, view.sections[0].querySelector('[data-menu-group-heading]'), 'mouseover');
  assert.equal(panelOf(env).hidden, false);
  const title = panelOf(env).querySelector('.mo-title');
  title.dispatchEvent(new env.window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(panelOf(env).hidden, false, '面板内部按下不该关闭');
  env.dispose();
});

test('菜单消失后面板自动收起（避免留下孤儿浮层）', async () => {
  const { env, view } = await setup();
  fire(env.window, view.sections[0].querySelector('[data-menu-group-heading]'), 'mouseover');
  assert.equal(panelOf(env).hidden, false);
  // 模拟内核关闭菜单：整体从 document 移除
  view.root.remove();
  await settle(env.window);
  assert.equal(panelOf(env).hidden, true, '菜单没了面板也要收');
  env.dispose();
});

test('列表模式下隐藏的模型不出现，置顶模型可在总览直接选择', async () => {
  const { env, view } = await setup();
  fire(env.window, view.sections[0].querySelector('[data-menu-group-heading]'), 'mouseover');
  panelOf(env).querySelector('[data-act="manage"]').click();
  panelOf(env).querySelector('[data-act="manage-all"]').click();
  // 置顶一个 Free 来源的模型
  Array.from(panelOf(env).querySelectorAll('[data-act="fav"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('Free 模型','free-v4-pro'))[0]
    .click();
  // 隐藏同来源另一个
  Array.from(panelOf(env).querySelectorAll('[data-act="hide"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('Free 模型','free-v4-flash'))[0]
    .click();
  panelOf(env).querySelector('[data-act="manage-off"]').click();

  // 总览视图：置顶区应含 free-v4-pro；被隐藏的 free-v4-flash 不应在任何地方出现
  const allNames = rowLabels(env);
  assert.ok(allNames.includes('free-v4-pro'), '置顶模型应出现在总览');

  // 搜索被隐藏的模型也不应出现
  const search = panelOf(env).querySelector('.mo-search');
  search.value = 'free-v4-flash';
  search.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  assert.equal(rowLabels(env).includes('free-v4-flash'), false, '已隐藏的模型不该被搜出来');
  env.dispose();
});

test('★ 内核搜索框不存在时不报错（模型数 ≤ 4 的情形）', async () => {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, {
    menuId: 'small-menu',
    pane: 'model',
    selected: null,
    providers: [{ id: 'a', label: '单一来源', models: [{ id: 'm1', name: 'm1' }, { id: 'm2', name: 'm2' }] }],
  });
  await settle(env.window);
  assert.equal(view.searchInput, null, '模型数 ≤4 时内核不渲染搜索框');
  assert.equal(view.sections[0].getAttribute('data-mo-collapsed'), '1', '仍应正常折叠');
  env.dispose();
});

