/**
 * 在 jsdom 里加载真实的 `client.js` 并把它挂起来。
 *
 * `client.js` 是给宿主 combo 脚本用的 loader 工厂（`window.__ModuleLoader__.load({id, factory})`），
 * 不能直接 import。这里提供一个最小的 `window.__ModuleLoader__` 收下工厂，再按宿主的
 * 调用约定执行 `factory(require)`，拿到插件对象；然后提供一个最小的 cordis `ctx`
 * （`effect` / `logger` / `slots` / `locale`），执行 `apply(ctx)`。
 *
 * 这样测试跑的是**真正要发布的那个文件**，而不是它的复制品。
 */
import { readFileSync } from 'node:fs';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createDom } from './harness.mjs';

/** 读 client.js 源码（统一换行）。 */
function readClient() {
  return readFileSync(new URL('../client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * 在给定 jsdom window 里求值 client.js，返回插件对象。
 *
 * 浏览器里 `window` / `document` / `MutationObserver` 都是全局；这里把它们作为
 * 求值函数的形参注入，等价于宿主把 bundle 当传统脚本执行时的全局环境。
 *
 * @param {object} window - jsdom window。
 * @returns {any} 插件对象（含 inject / apply）。
 */
export function evaluateClient(window) {
  let captured = null;
  window.__ModuleLoader__ = {
    /** 收下工厂并立刻执行，模拟 loader 的惰性工厂调用。 */
    load(spec) {
      captured = spec;
    },
  };
  const document = window.document;
  // 以传统脚本方式执行：没有 ESM import，所有依赖来自全局。
  const run = new Function(
    'window',
    'document',
    'MutationObserver',
    'setTimeout',
    'clearTimeout',
    readClient() + '\n;return null;'
  );
  run(window, document, window.MutationObserver, window.setTimeout.bind(window), window.clearTimeout.bind(window));
  if (captured === null) throw new Error('client.js 没有调用 window.__ModuleLoader__.load');
  if (captured.id !== 'dsh-model-organizer') {
    throw new Error('loader id 与包名不一致：' + captured.id);
  }
  // 宿主给工厂的 require：浏览器模块表里有 react / react-dom（设置卡用）。
  // 其余任何说明符都说明插件越界依赖了不该依赖的东西 —— 直接抛错暴露。
  const require = function (specifier) {
    if (specifier === 'react') return React;
    if (specifier === 'react-dom') return ReactDOM;
    throw new Error('dsh-model-organizer 不应 require：' + specifier);
  };
  return captured.factory(require);
}

/**
 * 建一个装好插件的环境。
 *
 * @param {object} [options] - 选项。
 * @param {boolean} [options.autoMount] - 是否自动调用 apply（默认 true）。
 * @returns {{ window:object, document:object, plugin:any, ctx:any, dispose:()=>void, disposers:Function[], logger:object, registrations:Map<string,any> }} 环境。
 */
export function createPluginEnv(options = {}) {
  const { window, document } = createDom();
  const plugin = evaluateClient(window);
  const disposers = [];
  const logger = { info() {}, debug() {}, warn() {}, error() {} };
  /** 槽位注册表：`slotName|key` -> { spec, Component }，供测试断言/渲染设置卡。 */
  const registrations = new Map();
  const ctx = {
    logger,
    /** 最小 effect：立即执行并保存清理函数，模拟 cordis 的托管生命周期。 */
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
    locale: {
      register() {
        return function () {};
      },
    },
    slots: {
      /** 注入回调：立即调用（模拟槽位出现），返回的 dispose 撤销本次注入。 */
      inject(slotName, callback) {
        callback();
        return function () {};
      },
      register(spec, Component) {
        registrations.set(spec.name + '|' + (spec.key || spec.id || ''), { spec, Component });
        return function () {};
      },
    },
  };
  const env = {
    window,
    document,
    plugin,
    ctx,
    disposers,
    logger,
    registrations,
    /** 卸载：倒序执行所有 disposer。 */
    dispose() {
      while (disposers.length > 0) {
        const fn = disposers.pop();
        try {
          fn();
        } catch (error) {
          /* 清理失败在测试里也要暴露，但不应阻断其余清理 */
          logger.error(error);
          throw error;
        }
      }
    },
  };
  if (options.autoMount !== false) plugin.apply(ctx);
  return env;
}

/**
 * 把设置卡渲染进一个容器（模拟宿主在插件页派发该槽位）。
 *
 * react-dom 在渲染/派发事件时读**全局** `window`（getCurrentEventPriority），
 * 而测试里 jsdom 的 window 只是函数参数 —— 所以渲染前把它挂到 globalThis。
 * client.js 本身不依赖全局（整个文件在 `new Function('window', …)` 的闭包里），
 * 挂全局只为喂给 react-dom。
 *
 * @param {object} env - createPluginEnv 的环境。
 * @param {object} [props] - 槽位属性（默认 `{ view: 'page' }`）。
 * @returns {{ container:object, unmount:()=>void }} 容器与卸载函数。
 */
export function mountSettingsCard(env, props = { view: 'page' }) {
  const entry = env.registrations.get('plugins.bundle.config|dsh-model-organizer');
  if (!entry) throw new Error('设置卡没有注册进 plugins.bundle.config');
  globalThis.window = env.window;
  globalThis.document = env.document;
  const container = env.document.createElement('div');
  env.document.body.appendChild(container);
  const root = createRoot(container);
  root.render(React.createElement(entry.Component, props));
  return {
    container,
    unmount() {
      root.unmount();
      if (container.parentNode) container.parentNode.removeChild(container);
    },
  };
}

/**
 * 等待 MutationObserver + 防抖（插件里是 120ms）跑完。
 *
 * @param {object} window - jsdom window。
 * @param {number} [ms] - 额外等待毫秒数，默认 200（> 120 防抖）。
 * @returns {Promise<void>} 完成信号。
 */
export function settle(window, ms = 200) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
