/**
 * dsh-model-organizer — 宿主半边。
 *
 * 这个插件的全部可见行为都在浏览器半边完成（见 ./client.js）：它把 composer 的
 * 模型选择菜单按来源（provider）折叠、滑出子面板，并加上置顶/最近/搜索/别名/隐藏。
 *
 * 宿主这边**只做一件事**：声明这个插件，好让 loader 把它挂起来。
 *
 * 为什么宿主侧没有任何服务、路由或持久化：
 *   · 模型的真实清单、选中态、切换动作都由内核已有的
 *     `@deepseek-ai/dsh-client-ui-model-selection` 掌握，插件不复制这份状态；
 *   · 置顶/最近/别名/隐藏都是**纯客户端偏好**，存在浏览器 localStorage，
 *     不需要跨越宿主往返，也不需要进入会话日志（按官方 practices：
 *     会话日志是模型可见内容的唯一真相；这些偏好不属于模型可见内容）。
 *
 * 因此这里刻意只导出 `name` / `inject` / `apply`。
 *
 * @module index.js
 */

/** 插件名，必须与 package.json 的 name 一致（loader 用它做 id 寻址）。 */
export const name = 'dsh-model-organizer';

/**
 * 不依赖任何宿主服务：没有服务就无法在缺服务的 profile 里退化——这里干脆不声明，
 * 于是它在任何 profile 里都能挂载。缺 webServer 之类的能力与它无关。
 */
export const inject = [];

/**
 * 挂载日志。可见 UI 全在渲染进程，宿主侧无副作用需要清理。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - 当前 profile 的 cordis 上下文。
 */
export function apply(ctx) {
  ctx.logger.info('dsh-model-organizer: started (client-side model-menu organizing)');
}
