// ingest：txt → raw.json（纯文本处理，不调用 LLM）
// 分段策略：优先按空行分块；无空行时按行。块内保留原文换行。
// 支持可选元信息行：`标题：…` / `作者：…`（不含则从文件名/首行猜测标题）。
import fs from 'node:fs';
import path from 'node:path';
import { slugify, cjkCount, clip } from './util.mjs';

export function ingestFile(file) {
  const abs = path.resolve(file);
  let text = fs.readFileSync(abs, 'utf8');
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  let title = '';
  let author = '';
  // 元信息（前 5 个非空块内找 标题/作者：）
  const pre = [];
  const lines = text.split('\n');
  const firstLines = lines.filter((l) => l.trim());
  for (let i = 0; i < Math.min(firstLines.length, 5); i++) {
    const l = firstLines[i].trim();
    const mt = l.match(/^(?:标题|书名)\s*[:：]\s*(.{1,60})$/);
    const ma = l.match(/^作者\s*[:：]\s*(.{1,60})$/);
    if (mt && !title) { title = mt[1].trim(); pre.push(l); continue; }
    if (ma && !author) { author = ma[1].trim(); pre.push(l); continue; }
  }
  // 从原文剔除元信息行（逐行处理，保留段落结构）
  const keep = lines.filter((l) => !pre.includes(l.trim()));
  text = keep.join('\n');

  // 分块：优先空行块，其次按行
  const blockSplits = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const unit = blockSplits.length >= 2 ? blockSplits : text.split('\n').map((l) => l.trim()).filter(Boolean);

  const paragraphs = [];
  for (const u of unit) {
    const segs = u.split('\n').map((l) => l.trim()).filter(Boolean);
    // 智能连接：前一行以标点/引号收尾时不加空格（避免“。 木门”式双空格）
    let cleaned = '';
    for (const ln of segs) {
      if (!cleaned) { cleaned = ln; continue; }
      const prevEnd = cleaned[cleaned.length - 1];
      const nextStart = ln[0];
      const tight = /[。！？!?…：:；;，,、）)》」』”’]/.test(prevEnd) || /^[“「（(『]/.test(nextStart);
      cleaned += tight ? '' : ' ';
      cleaned += ln;
    }
    cleaned = normalizeQuotes(cleaned.trim());
    if (!cleaned) continue;
    // 纯分隔线跳过
    if (/^[-—=_*]{3,}$/.test(cleaned)) continue;
    paragraphs.push(cleaned);
  }
  if (!paragraphs.length) paragraphs.push('（空文档）');

  const storyId = slugify(path.basename(abs));
  if (!title) title = guessTitle(paragraphs[0], path.basename(abs));
  const wordCount = cjkCount(paragraphs.join(''));
  return {
    schema: 'kanshan/raw/1',
    storyId,
    sourceFile: abs,
    fileName: path.basename(abs),
    title,
    author,
    wordCount,
    fullText: paragraphs.join('\n\n'),
    paragraphs: paragraphs.map((p, i) => ({ index: i + 1, text: p })),
  };
}

// 把 ASCII 双引号规整为中文弯引号（开/关交替，跨段落关闭自动补），
// 让 “说："…"” 这类原文能统一被对话/引文逻辑识别。
function normalizeQuotes(s) {
  let out = '';
  let open = true;
  for (const ch of s) {
    if (ch === '"') {
      out += open ? '“' : '”';
      open = !open;
    } else {
      out += ch;
    }
  }
  if (!open) out += '”';
  return out;
}

function guessTitle(firstPara, fileName) {
  const p = String(firstPara || '').trim();
  const cjk = cjkCount(p);
  const bare = p.replace(/^[《「『#]|[》」』]$/g, '').trim();
  const looksLikeTitle =
    cjk >= 2 && cjk <= 20 &&
    !/[。！？!?…]$/.test(bare) &&
    !/^(我|他|她|它|那|这|于是|然后|可是|但是|突然|那天|那天晚上|我站|我走|我推|我回|你|谁|有)/.test(bare);
  if (looksLikeTitle) return clip(bare, 30);
  const base = String(fileName).replace(/\.txt$/i, '').trim();
  return base || '未命名故事';
}
