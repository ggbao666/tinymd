// 查找 / 替换的纯逻辑：把「查询词」变成一组区间。
//
// 三条路共用这里的算位置逻辑：
//   - 富文本：返回 ProseMirror 文档坐标，交给 editor.ts 的装饰插件高亮；
//   - 纯文本：返回 textarea 的字符串下标，只能移动光标（textarea 没法做高亮层）；
//   - 替换：两种模式都从「当前命中」出发，按文档顺序逐个替换。
// UI（浮动查找条）在 main.ts，不进这里 —— 保持纯函数才好验证。

import type { Node as PMNode } from '@tiptap/pm/model'

export interface FindRange {
  /** 文档坐标 / 字符串下标（闭区间起点） */
  from: number
  /** 开区间终点 */
  to: number
}

const lower = (s: string, caseSensitive: boolean) => (caseSensitive ? s : s.toLowerCase())

/**
 * 在文档模型里找 query 的全部出现位置，返回文档坐标。
 *
 * 只在**单个文本节点内**匹配：跨行内节点（比如 `a<b>b`）的匹配极其罕见，
 * 而 decoration 只能作用在连续区间上，硬凑反而容易错位。
 */
export function findRangesInDoc(doc: PMNode, query: string, caseSensitive: boolean): FindRange[] {
  const out: FindRange[] = []
  if (!query) return out
  const needle = lower(query, caseSensitive)
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    const hay = lower(node.text, caseSensitive)
    let i = hay.indexOf(needle)
    while (i !== -1) {
      out.push({ from: pos + i, to: pos + i + query.length })
      i = hay.indexOf(needle, i + query.length)
    }
    return true
  })
  // descendants 按文档顺序遍历，但同一节点内多段文本（如代码块）也可能交错，兜底排一次
  return out.sort((a, b) => a.from - b.from)
}

/** 在纯文本里找 query 的全部出现位置，返回字符串下标 */
export function findRangesInText(text: string, query: string, caseSensitive: boolean): FindRange[] {
  const out: FindRange[] = []
  if (!query) return out
  const hay = lower(text, caseSensitive)
  const needle = lower(query, caseSensitive)
  let i = hay.indexOf(needle)
  while (i !== -1) {
    out.push({ from: i, to: i + query.length })
    i = hay.indexOf(needle, i + query.length)
  }
  return out
}

/**
 * 从 caret 出发找第 dir 方向的命中下标；走到尽头就绕回另一端。
 * 入参 ranges 必须是按 from 升序的。
 */
export function nextMatchIndex(ranges: FindRange[], caret: number, dir: 1 | -1): number {
  if (!ranges.length) return -1
  if (dir === 1) {
    for (let i = 0; i < ranges.length; i++) if (ranges[i].from >= caret) return i
    return 0
  }
  for (let i = ranges.length - 1; i >= 0; i--) if (ranges[i].from < caret) return i
  return ranges.length - 1
}
