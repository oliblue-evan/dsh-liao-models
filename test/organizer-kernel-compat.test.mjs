/**
 * 与内核自身行为的兼容性 —— 这是真实浏览器里最容易翻车的一层。
 *
 * 只用 `.click()` 的测试会漏掉两件真实发生的事：
 *   1. 用户按下鼠标会派发 `mousedown`，而内核在 `document` 冒泡期监听它做
 *      `closeOutside`（落点不在 rootRef/menuRef 内就关菜单）；
 *   2. 焦点会移动，而内核根节点上的 `onBlur` 发现 relatedTarget 不在
 *      rootRef/menuRef 内也会 `close()`。
 * 面板挂在 `body`，这两条判定的答案都是「不在里面」—— 如果插件不主动屏蔽，
 * 用户**一碰面板整个菜单就没了**，面板里的选择自然也失败了。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginEnv, settle } from './load-client.mjs';
import { mountModelMenu, defaultSpec } from './harness.mjs';
import { attachKernelBehavior, realClick } from './kernel-behavior.mjs';
/** 与插件 modelKey 等价：JSON 数组编码（键格式 v2）。 */
const moKey = (provider, model) => JSON.stringify([provider, model]);


const PANEL = 'dsh-liao-models-panel';

/** 建环境 + 挂菜单 + 接上内核行为。 */
async function setupWithKernel() {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  const kernel = attachKernelBehavior(env.document, view);
  await settle(env.window);
  return { env, view, kernel };
}

const panelOf = (env) => env.document.getElementById(PANEL);
const headingOf = (view, i) => view.sections[i].querySelector('[data-menu-group-heading]');
/** 用真实事件悬停打开面板。 */
function hover(window, node) {
  node.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
}

test('★ 关键：在面板里按下鼠标，内核的 closeOutside 不能关掉菜单', async () => {
  const { env, view, kernel } = await setupWithKernel();
  hover(env.window, headingOf(view, 0));
  assert.equal(panelOf(env).hidden, false, '前置条件：面板已打开');

  const row = panelOf(env).querySelector('[data-act="choose"]');
  assert.ok(row, '面板应有模型行');
  // 真实按下：派发 mousedown（内核在 document 冒泡期监听它）
  row.dispatchEvent(new env.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));

  assert.equal(kernel.isOpen(), true, '内核菜单不该被面板里的 mousedown 关掉（closedBy=' + kernel.closedBy() + '）');
  assert.equal(panelOf(env).hidden, false, '面板也应仍然打开');
  kernel.detach();
  env.dispose();
});

test('★ 关键：在面板里点击模型，能选中且菜单不被关掉', async () => {
  const { env, view, kernel } = await setupWithKernel();
  hover(env.window, headingOf(view, 1));

  let clicked = null;
  for (const button of view.items) {
    button.addEventListener('click', () => {
      clicked = button.getAttribute('title');
    });
  }
  const target = Array.from(panelOf(env).querySelectorAll('[data-act="choose"]'))
    .filter((r) => r.getAttribute('data-key') === moKey('Natsuki 网关','grok-4.7'))[0];
  assert.ok(target, '应找到目标行');

  realClick(env.window, target);

  assert.equal(kernel.isOpen(), true, '选中过程不该被内核判成点在外面（closedBy=' + kernel.closedBy() + '）');
  assert.equal(clicked, 'grok-4.7', '内核真实按钮应收到点击（选择由内核完成）');
  kernel.detach();
  env.dispose();
});

test('★ 关键：焦点进入面板后，内核的 onBlur 不能关掉菜单', async () => {
  const { env, view, kernel } = await setupWithKernel();
  hover(env.window, headingOf(view, 0));

  // 先把焦点放到菜单内的模型按钮（内核会这么做），再转移到面板里的搜索框
  const selected = view.items.filter((b) => b.getAttribute('aria-checked') === 'true')[0];
  selected.focus();
  const search = panelOf(env).querySelector('.mo-search');
  realClick(env.window, search, { focus: true });

  assert.equal(kernel.isOpen(), true, '焦点进面板不该让内核 close()（closedBy=' + kernel.closedBy() + '）');
  assert.equal(env.document.activeElement, search, '搜索框应真的拿到焦点，用户才能打字');
  kernel.detach();
  env.dispose();
});

test('★ 关键：能在面板搜索框里连续输入（焦点不被抢走）', async () => {
  const { env, view, kernel } = await setupWithKernel();
  hover(env.window, headingOf(view, 1));
  const search = panelOf(env).querySelector('.mo-search');
  realClick(env.window, search, { focus: true });

  // 逐字符输入，模拟打字
  for (const ch of 'grok') {
    search.value += ch;
    search.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  }
  assert.equal(search.value, 'grok', '搜索框内容应保持');
  assert.equal(kernel.isOpen(), true, '打字过程中菜单不该关闭');
  const labels = Array.from(panelOf(env).querySelectorAll('.mo-row-name')).map((n) => n.textContent);
  assert.ok(labels.length > 0 && labels.every((l) => l.toLowerCase().includes('grok')), '应按输入过滤：' + labels.join(','));
  kernel.detach();
  env.dispose();
});

test('★ 关键：管理视图里点 ★ / 🚫 不关菜单（真事件）', async () => {
  const { env, view, kernel } = await setupWithKernel();
  hover(env.window, headingOf(view, 0));
  realClick(env.window, panelOf(env).querySelector('[data-act="manage"]'));
  assert.equal(kernel.isOpen(), true, '进入管理视图不该关菜单');

  const fav = panelOf(env).querySelector('[data-act="fav"]');
  realClick(env.window, fav);
  assert.equal(kernel.isOpen(), true, '点 ★ 不该关菜单（closedBy=' + kernel.closedBy() + '）');
  const state = JSON.parse(env.window.localStorage.getItem('dsh-liao-models-state-v1'));
  assert.equal(state.favorites.length, 1, '置顶应生效');
  kernel.detach();
  env.dispose();
});

test('★ 关键：别名输入框能聚焦并保存（真事件）', async () => {
  const { env, view, kernel } = await setupWithKernel();
  hover(env.window, headingOf(view, 0));
  realClick(env.window, panelOf(env).querySelector('[data-act="manage"]'));

  realClick(env.window, panelOf(env).querySelector('[data-act="edit-alias"]'));
  const aliasInput = panelOf(env).querySelector('[data-act="alias"]');
  realClick(env.window, aliasInput, { focus: true });
  assert.equal(env.document.activeElement, aliasInput, '别名输入框应能聚焦');
  aliasInput.value = '短名';
  aliasInput.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  const state = JSON.parse(env.window.localStorage.getItem('dsh-liao-models-state-v1'));
  assert.equal(Object.values(state.aliases)[0], '短名', '别名应保存');
  assert.equal(kernel.isOpen(), true, '改名过程菜单不该关');
  kernel.detach();
  env.dispose();
});

test('反向保证：点菜单外面仍应正常关掉菜单（别把屏蔽做过头）', async () => {
  const { env, view, kernel } = await setupWithKernel();
  hover(env.window, headingOf(view, 0));
  assert.equal(panelOf(env).hidden, false);

  const outside = env.document.createElement('div');
  env.document.body.appendChild(outside);
  outside.dispatchEvent(new env.window.MouseEvent('mousedown', { bubbles: true }));

  assert.equal(kernel.isOpen(), false, '点真正的外部应关掉菜单');
  await settle(env.window);
  assert.equal(panelOf(env).hidden, true, '菜单关掉后插件面板也应收起');
  kernel.detach();
  env.dispose();
});

test('反向保证：点原生菜单里的模型项（非面板）不受影响', async () => {
  const { env, view, kernel } = await setupWithKernel();
  // hover 模式下原生列表是折叠的，但节点仍在；直接点它模拟列表模式
  const native = view.items[1];
  let clicked = null;
  native.addEventListener('click', () => {
    clicked = native.getAttribute('title');
  });
  native.dispatchEvent(new env.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  native.click();
  assert.equal(clicked, native.getAttribute('title'), '原生项点击应正常到达内核');
  kernel.detach();
  env.dispose();
});

test('★ 关键：划过来源标题打开面板，菜单不被判成点在外面（真事件）', async () => {
  const { env, view, kernel } = await setupWithKernel();
  const heading = view.sections[0].querySelector('[data-menu-group-heading]');
  heading.dispatchEvent(new env.window.MouseEvent('mouseover', { bubbles: true }));

  assert.equal(kernel.isOpen(), true, '悬停开面板不该被内核判成点在外面（closedBy=' + kernel.closedBy() + '）');
  assert.equal(panelOf(env).hidden, false, '应打开面板');
  kernel.detach();
  env.dispose();
});

test('★ 关键：面板里搜索能打字且菜单不关（真事件）', async () => {
  const { env, view, kernel } = await setupWithKernel();
  const heading = view.sections[1].querySelector('[data-menu-group-heading]');
  heading.dispatchEvent(new env.window.MouseEvent('mouseover', { bubbles: true }));
  assert.equal(panelOf(env).hidden, false);

  const search = panelOf(env).querySelector('.mo-search');
  realClick(env.window, search, { focus: true });
  assert.equal(env.document.activeElement, search, '搜索框应能聚焦');
  for (const ch of 'grok') {
    search.value += ch;
    search.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  }
  assert.equal(kernel.isOpen(), true, '打字过程中菜单不该关闭');
  const labels = Array.from(panelOf(env).querySelectorAll('.mo-row-name')).map((n) => n.textContent);
  assert.ok(labels.length > 0, '应有搜索结果：' + labels.join(','));
  kernel.detach();
  env.dispose();
});

test('★ 右键在面板里仍能弹出上下文菜单（只拦主键的默认动作）', async () => {
  // 早期实现对所有 mouse button 都 preventDefault，导致面板里按右键没反应。
  const { env, view, kernel } = await setupWithKernel();
  hover(env.window, headingOf(view, 0));
  const row = panelOf(env).querySelector('[data-act="choose"]');

  // 右键：默认动作不能被取消（否则 contextmenu 不出来）
  const right = new env.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 });
  const rightOk = row.dispatchEvent(right);
  assert.equal(rightOk, true, '右键 mousedown 不该被 preventDefault');
  // 但传播仍要被拦住，否则内核会把菜单关掉
  assert.equal(kernel.isOpen(), true, '右键也不该让内核关掉菜单');

  // 左键：默认动作要被取消，防止焦点转移触发内核 onBlur
  const left = new env.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  const leftOk = row.dispatchEvent(left);
  assert.equal(leftOk, false, '左键 mousedown 应被 preventDefault');
  kernel.detach();
  env.dispose();
});

test('★ 面板内的输入框不被 preventDefault（否则无法放光标/打字）', async () => {
  const { env, view, kernel } = await setupWithKernel();
  hover(env.window, headingOf(view, 0));
  const search = panelOf(env).querySelector('.mo-search');
  const md = new env.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  assert.equal(search.dispatchEvent(md), true, '搜索框 mousedown 不该被取消');
  assert.equal(kernel.isOpen(), true, '搜索框也不该让菜单关掉');
  kernel.detach();
  env.dispose();
});

test('★ 原生菜单里的点击不被插件拦截（内核行为保持原样）', async () => {
  const { env, view, kernel } = await setupWithKernel();
  // 原生模型项：插件不该 preventDefault（那是内核自己的行）
  const native = view.items[0];
  const md = new env.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  assert.equal(native.dispatchEvent(md), true, '原生项的 mousedown 不该被插件取消');
  // 内核自己的关闭判定仍应在菜单外生效（见上一个用例的反向保证）
  kernel.detach();
  env.dispose();
});

test('★ 键盘导航时展开，避免 Enter 选中看不见的模型', async () => {
  // 内核的上下键导航走它自己的 React 状态（visibleModels/data-highlighted），
  // 看不见插件在 CSS 里的隐藏 —— 若折叠着按方向键，高亮会在不可见的行之间移动，
  // 按 Enter 会选中一个用户根本看不见的模型。
  const { env, view, kernel } = await setupWithKernel();
  const collapsed = () => view.sections.map((s) => s.getAttribute('data-mo-collapsed'));
  assert.deepEqual(collapsed(), ['1', '1', '1'], '前置条件：默认折叠');

  // 真实按键来自菜单内的焦点元素（内核搜索框），不是 document
  view.trigger.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await settle(env.window, 200);
  assert.deepEqual(collapsed(), [null, null, null], '按方向键后应展开，高亮行必须可见');

  // 用户改用鼠标操作菜单 → 恢复折叠（否则折叠能力永久闲置）
  view.items[0].dispatchEvent(new env.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  await settle(env.window, 200);
  assert.deepEqual(collapsed(), ['1', '1', '1'], '鼠标接管后应恢复折叠');
  kernel.detach();
  env.dispose();
});

test('★ 内核自动把焦点放到它自己的搜索框，不应导致永久展开', async () => {
  // 这是最容易写错的判据：内核在进入模型面板且 showSearch 为真时会主动
  // searchRef.focus()，而模型数 >4 才出现搜索框 —— 恰好是本插件最需要折叠的场景。
  // 若用「焦点在菜单内」当展开条件，折叠会在绝大多数情况下被跳过，核心功能失效。
  const { env, view, kernel } = await setupWithKernel();
  view.searchInput.focus();
  await settle(env.window, 300);
  assert.deepEqual(
    view.sections.map((s) => s.getAttribute('data-mo-collapsed')),
    ['1', '1', '1'],
    '仅「焦点在搜索框」不应触发展开（折叠必须仍然生效）'
  );
  kernel.detach();
  env.dispose();
});

test('★ 菜单关闭后再打开，键盘状态清零（回到正常折叠）', async () => {
  const { env, view, kernel } = await setupWithKernel();
  view.trigger.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  await settle(env.window, 200);
  assert.deepEqual(view.sections.map((s) => s.getAttribute('data-mo-collapsed')), [null, null, null], 'Tab 应展开');

  // 菜单关闭（整体移除）→ 重新挂一个全新菜单
  view.root.remove();
  await settle(env.window, 300);
  const view2 = mountModelMenu(env.document, defaultSpec());
  await settle(env.window, 300);
  assert.deepEqual(
    view2.sections.map((s) => s.getAttribute('data-mo-collapsed')),
    ['1', '1', '1'],
    '新菜单应回到默认折叠'
  );
  kernel.detach();
  env.dispose();
});

test('★ 在插件面板里按方向/Tab/Enter，不得无谓展开原生菜单', async () => {
  // keyboardNav 标志曾只看按键、不看落点：用户在**插件自己的**搜索框里按方向键
  // 移动光标、按 Tab 换焦点、按 Enter 确认时，原生菜单会被无谓展开 ——
  // 折叠状态被冲掉，用户下次打开菜单发现所有来源都摊开了。
  const { env, view, kernel } = await setupWithKernel();
  const collapsed = () => view.sections.map((s) => s.getAttribute('data-mo-collapsed'));
  assert.deepEqual(collapsed(), ['1', '1', '1'], '前置条件：默认折叠');

  hover(env.window, headingOf(view, 0));
  const search = panelOf(env).querySelector('.mo-search');
  search.focus();
  assert.equal(env.document.activeElement, search, '前置条件：焦点在插件搜索框');

  for (const key of ['ArrowDown', 'ArrowUp', 'Tab', 'Enter']) {
    search.dispatchEvent(new env.window.KeyboardEvent('keydown', { key, bubbles: true }));
  }
  await settle(env.window, 300);
  assert.deepEqual(collapsed(), ['1', '1', '1'], '★ 面板内的按键不该展开原生菜单');
  assert.equal(kernel.isOpen(), true, '也不该关掉菜单');
  kernel.detach();
  env.dispose();
});

test('★ 原生菜单内按方向键仍会展开（合法键盘路径不受影响）', async () => {
  const { env, view, kernel } = await setupWithKernel();
  const collapsed = () => view.sections.map((s) => s.getAttribute('data-mo-collapsed'));
  // 焦点在内核自己的搜索框（菜单内）→ 属于内核键盘导航
  view.trigger.focus();
  view.trigger.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await settle(env.window, 250);
  assert.deepEqual(collapsed(), [null, null, null], '菜单内按方向键应展开（内核索引与可见集一致）');
  kernel.detach();
  env.dispose();
});
