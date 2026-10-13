/**
 * 生命周期完整性：**逐一核对** start() 加的每一样东西，dispose() 是否都摘掉了。
 *
 * 【为什么单独测这个】上游 `dsh-model-fold` 的真实缺陷之一，就是注册了
 * `mouseover` / `mouseout` 却没在 dispose 里摘除 —— 而它的单例守卫恰恰依赖
 * 「拆旧实例」来防堆叠，于是热重载后监听器逐次累积。这类缺陷用功能测试**测不出来**
 * （功能照样正常，只是越用越卡、越用越怪），必须直接对账。
 *
 * 做法：在 jsdom 里给 `EventTarget.prototype` 的 add/removeEventListener 打桩，
 * 统计**尚未摘除**的监听器；dispose 之后必须回到 0。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginEnv, settle } from './load-client.mjs';
import { mountModelMenu, defaultSpec } from './harness.mjs';

const PANEL = 'dsh-model-organizer-panel';

/**
 * 给 add/removeEventListener 打桩，返回「未摘除」的监听器账本。
 *
 * 按 (target, type, listener, capture) 四元组记账：同一个函数以不同 capture
 * 注册是两条不同的记录（浏览器语义如此）。
 *
 * @param {object} window - jsdom window。
 * @returns {{ pending: () => Array<object>, restore: () => void }} 账本与还原函数。
 */
function instrumentListeners(window) {
  const proto = window.EventTarget.prototype;
  const originalAdd = proto.addEventListener;
  const originalRemove = proto.removeEventListener;
  /** key -> { target, type, listener, capture } */
  const live = new Map();

  proto.addEventListener = function (type, listener, options) {
    const capture = typeof options === 'boolean' ? options : options && options.capture === true;
    // 同一 target 上的同一 (type, listener, capture) 若重复注册，浏览器会去重
    const bucket = live.get(this) || new Map();
    bucket.set(type + '|' + capture + '|' + String(listener && listener.name) + '|' + indexOfListener(bucket, listener), {
      target: this,
      type,
      listener,
      capture,
    });
    live.set(this, bucket);
    return originalAdd.call(this, type, listener, options);
  };

  proto.removeEventListener = function (type, listener, options) {
    const capture = typeof options === 'boolean' ? options : options && options.capture === true;
    const bucket = live.get(this);
    if (bucket) {
      for (const [key, entry] of bucket) {
        if (entry.type === type && entry.listener === listener && entry.capture === capture) {
          bucket.delete(key);
          break;
        }
      }
    }
    return originalRemove.call(this, type, listener, options);
  };

  /** 仅用于生成稳定 key（listener 身份已由对象引用比较保证）。 */
  function indexOfListener(bucket, listener) {
    let n = 0;
    for (const entry of bucket.values()) {
      if (entry.listener === listener) n += 1;
    }
    return n;
  }

  return {
    pending() {
      const out = [];
      for (const bucket of live.values()) {
        for (const entry of bucket.values()) out.push(entry);
      }
      return out;
    },
    /**
     * 相对基线的**净新增**监听器。
     *
     * jsdom 自己在 `window` 上预注册了一批转发监听器（focus/click/keydown…），
     * 它们与插件无关，不能算作残留。所以只能断言「净增量归零」，
     * 而不是「总数归零」。
     */
    pendingSince(baseline) {
      const seen = new Set(baseline);
      return this.pending().filter((entry) => !seen.has(entry));
    },
    restore() {
      proto.addEventListener = originalAdd;
      proto.removeEventListener = originalRemove;
    },
  };
}

/** 描述一个监听器，便于断言失败时定位。 */
function describe(entry) {
  const t = entry.target;
  const id = t === undefined ? '?' : t.id ? '#' + t.id : t.tagName ? t.tagName.toLowerCase() : String(t);
  return id + ':' + entry.type + (entry.capture ? ' (capture)' : '');
}

test('★ dispose 之后没有残留监听器（上游真实缺陷的回归）', async () => {
  const env = createPluginEnv({ autoMount: false });
  const book = instrumentListeners(env.window);
  const view = mountModelMenu(env.document, defaultSpec());

  // 【为什么先预热一轮】jsdom 会在**首次**发生焦点/点击交互时，惰性地在 window 上
  // 注册一批自己的转发监听器（focus / click / keydown / mouseover…）。插件为了
  // 「折叠前先把焦点移回 trigger」会调用 focus()，于是这些监听器会被装进来 ——
  // 它们是 jsdom 的、与插件无关。先跑一轮 apply+dispose 把它们装齐，再取基线，
  // 之后测到的就纯粹是插件的净增量。
  env.plugin.apply(env.ctx);
  await settle(env.window);
  env.dispose();
  await settle(env.window, 120);
  const baseline = book.pending();

  env.plugin.apply(env.ctx);
  await settle(env.window);
  const added = book.pendingSince(baseline);
  assert.ok(added.length > 0, '插件应当确实注册了监听器（否则这个测试没有意义）');

  env.dispose();
  await settle(env.window, 120);
  const after = book.pendingSince(baseline);
  book.restore();

  assert.deepEqual(
    after.map(describe),
    [],
    'dispose 后仍有监听器残留（这正是上游 dsh-model-fold 的缺陷）：\n' + after.map(describe).join('\n')
  );
  // 自查：账本确实在记账（插件至少挂了这些：document 上 5 个捕获期 + 面板 2 个 + 启动按钮 1 个 + resize 1 个）
  assert.ok(added.length >= 7, '注册的监听器数量看起来太少，账本可能没生效：' + added.length + ' -> ' + added.map(describe).join(','));
  assert.equal(view.menu.getAttribute('data-mo-scope'), null);
});

test('★ 重复 apply + dispose 不累积监听器（热重载防护）', async () => {
  const env = createPluginEnv({ autoMount: false });
  const book = instrumentListeners(env.window);
  mountModelMenu(env.document, defaultSpec());

  // 同样先预热一轮，装齐 jsdom 自己的惰性监听器（理由见上一个用例）。
  env.plugin.apply(env.ctx);
  await settle(env.window);
  env.dispose();
  await settle(env.window, 120);
  const baseline = book.pending();

  // 模拟 HMR：反复 apply —— 单例守卫会先拆掉上一个实例
  for (let i = 0; i < 5; i++) {
    env.plugin.apply(env.ctx);
    await settle(env.window, 160);
  }
  const during = book.pendingSince(baseline).length;
  assert.ok(during < 40, '反复 apply 后监听器数量应保持有界（单例守卫生效），实际 ' + during);

  env.dispose();
  await settle(env.window, 120);
  const after = book.pendingSince(baseline);
  book.restore();
  assert.deepEqual(after.map(describe), [], 'dispose 后不应残留：\n' + after.map(describe).join('\n'));
});

test('★ dispose 摘净：自建节点、样式、标记属性全部还原', async () => {
  const env = createPluginEnv({ autoMount: false });
  const view = mountModelMenu(env.document, defaultSpec());
  env.plugin.apply(env.ctx);
  await settle(env.window);

  // 前置条件：确实加过东西
  assert.ok(env.document.getElementById(PANEL), '面板应已挂载');
  assert.ok(env.document.getElementById('dsh-model-organizer-style'), '样式应已注入');
  assert.equal(view.menu.getAttribute('data-mo-scope'), '1');

  env.dispose();
  await settle(env.window, 200);

  assert.equal(env.document.getElementById(PANEL), null, '面板应被移除');
  assert.equal(env.document.getElementById('dsh-model-organizer-style'), null, '样式应被移除');
  assert.equal(env.document.querySelectorAll('[data-mo-scope]').length, 0, '作用域标记应清空');
  assert.equal(env.document.querySelectorAll('[data-mo-collapsed]').length, 0, '折叠标记应清空');
  assert.equal(env.document.querySelectorAll('[data-mo-hidden]').length, 0, '隐藏标记应清空');
  assert.equal(env.document.querySelectorAll('[data-mo-section]').length, 0, '来源标记应清空');
  assert.equal(env.document.querySelectorAll('[data-mo-badge]').length, 0, '徽标应清空');
  // 关键：dispose 之后观察器/定时器不该再增强
  view.menu.setAttribute('data-mo-scope', ''); // 制造一次变动
  await settle(env.window, 250);
  assert.equal(view.menu.getAttribute('data-mo-scope'), '', 'dispose 后不应再被插件改写');
});

test('★ dispose 可重复调用且不抛错（幂等）', async () => {
  const env = createPluginEnv();
  await settle(env.window);
  env.dispose();
  assert.doesNotThrow(() => env.dispose(), '重复 dispose 不应抛错');
});
