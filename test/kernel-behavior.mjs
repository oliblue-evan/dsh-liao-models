/**
 * 模拟内核自己挂在文档/根节点上的关闭逻辑。
 *
 * 【为什么需要】插件的面板挂在 `document.body`，而内核有两处**它自己的**逻辑
 * 会把「面板里的操作」误判成「用户离开了菜单」：
 *
 *   1. `closeOutside`：`document` 上**冒泡期**的 `mousedown`
 *      —— 落点不在 rootRef / menuRef 内就 `setOpen(false)`；
 *   2. `onBlur`：根节点上的失焦处理
 *      —— `relatedTarget` 不在 rootRef / menuRef 内就 `close()`。
 *
 * 面板两者都不在，所以**真实用户点面板**（会触发 mousedown 与焦点转移）时，
 * 内核会把菜单关掉。只用 `.click()` 的测试看不见这件事 —— `.click()`
 * 既不派发 mousedown，也不移动焦点。这个模块把内核的行为如实地补上，
 * 好让测试能在 jsdom 里复现真实时序。
 */

/**
 * 给一个已挂载的模型菜单接上内核的关闭行为。
 *
 * @param {Document} document - 文档。
 * @param {{ root: Element, menu: Element }} view - harness 返回的视图引用。
 * @returns {{ isOpen: () => boolean, closedBy: () => string|null }} 状态查询。
 */
export function attachKernelBehavior(document, view) {
  let open = true;
  /** 记录是被哪条内核逻辑关掉的（便于断言失败时定位）。 */
  let closedBy = null;

  /** 内核的 close()：把整棵菜单从 DOM 摘掉。 */
  function close(reason) {
    if (!open) return;
    open = false;
    closedBy = reason;
    if (view.root.parentNode !== null) view.root.parentNode.removeChild(view.root);
  }

  /** 复刻内核的 closeOutside（document 冒泡期 mousedown）。 */
  function closeOutside(event) {
    if (view.root.contains(event.target) === true) return;
    if (view.menu.contains(event.target) === true) return;
    close('closeOutside');
  }

  /** 复刻内核根节点的 onBlur（React 的 onBlur 走 focusout）。 */
  function onBlur(event) {
    const related = event.relatedTarget;
    if (related !== null && related !== undefined) {
      if (view.root.contains(related) === true) return;
      if (view.menu.contains(related) === true) return;
    }
    close('onBlur');
  }

  document.addEventListener('mousedown', closeOutside);
  view.root.addEventListener('focusout', onBlur);

  return {
    isOpen: () => open,
    closedBy: () => closedBy,
    /** 手动摘掉（测试收尾）。 */
    detach() {
      document.removeEventListener('mousedown', closeOutside);
      view.root.removeEventListener('focusout', onBlur);
    },
  };
}

/**
 * 模拟真实用户点击：mousedown → 焦点转移 → mouseup → click。
 *
 * 与 `node.click()` 的关键差别是会派发 `mousedown` 并移动焦点 —— 正是这两件事
 * 会触发内核的 closeOutside / onBlur。
 *
 * @param {Window} window - jsdom window。
 * @param {Element} node - 目标元素。
 * @param {{ focus?: boolean }} [options] - `focus: false` 时不移动焦点。
 */
export function realClick(window, node, options = {}) {
  const init = { bubbles: true, cancelable: true, composed: true };
  node.dispatchEvent(new window.MouseEvent('mousedown', init));
  // 默认动作：浏览器会在 mousedown 时把焦点移到可聚焦元素上
  const wantFocus = options.focus !== false;
  if (wantFocus && typeof node.focus === 'function') {
    try {
      node.focus();
    } catch (error) {
      /* 不可聚焦就跳过 */
    }
  }
  node.dispatchEvent(new window.MouseEvent('mouseup', init));
  node.dispatchEvent(new window.MouseEvent('click', init));
}
