// Markdown 渲染 + 净化（先渲染后净化），并提供“纯文本化”供打字机使用
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(src: string): string {
  if (!src) return '';
  const raw = marked.parse(src, { async: false });
  return DOMPurify.sanitize(typeof raw === 'string' ? raw : String(raw), { USE_PROFILES: { html: false } });
}

/** 按段落拆分 markdown，供打字机逐段推进 */
export interface Para {
  /** 最终整段渲染用的 markdown */
  md: string;
  /** 打字阶段展示的近似纯文本（剥掉行内语法） */
  plain: string;
}

export function paragraphs(md: string): Para[] {
  const blocks = md
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map((b) => ({ md: b, plain: inlineToPlain(b) }));
}

const INLINE_RULES: Array<[RegExp, string]> = [
  [/!\[([^\]]*)\]\([^)]*\)/g, '$1'], // 图片 → 替代文字
  [/\[([^\]]+)\]\([^)]*\)/g, '$1'], // 链接 → 文字
  [/\*\*\*([^*]+)\*\*\*/g, '$1'],
  [/\*\*([^*]+)\*\*/g, '$1'],
  [/\*([^*]+)\*/g, '$1'],
  [/__([^_]+)__/g, '$1'],
  [/_([^_]+)_/g, '$1'],
  [/~~([^~]+)~~/g, '$1'],
  [/`([^`]+)`/g, '$1'],
  [/^\s*#{1,6}\s+/gm, ''],
  [/^\s*[-*+]\s+/gm, '· '],
  [/^\s*\d+\.\s+/gm, ''],
  [/>\s?/gm, ''],
];

export function inlineToPlain(text: string): string {
  let out = text;
  for (const [re, sub] of INLINE_RULES) out = out.replace(re, sub);
  return out;
}
