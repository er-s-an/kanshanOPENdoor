// 知乎直答 API 客户端（OpenAI 兼容）+ 本地 prompt-hash 缓存。
// 仅此文件接触网络与 Secret；调用方只与返回的 JSON / 文本打交道。
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_ROOT, sha1Hex, log, err } from './util.mjs';

export class ZhihuError extends Error {
  constructor(message, { status = 0, body = '' } = {}) {
    super(message);
    this.name = 'ZhihuError';
    this.status = status;
    this.body = body;
  }
}

export async function postChat({ baseUrl, secret, model, messages, temperature = 0.3, timeoutMs = Number(process.env.ZHIHU_TIMEOUT_MS) || 300000 }) {
  // 部分 OpenAI 兼容端点（如 kimi-for-coding）只允许 temperature=1；ZHIHU_TEMPERATURE=omit 时不下发该字段
  const tempEnv = (process.env.ZHIHU_TEMPERATURE || '').trim();
  const body = { model, messages, stream: false };
  if (tempEnv === 'omit') { /* 不带 temperature */ }
  else body.temperature = tempEnv ? Number(tempEnv) : temperature;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch {
        /* ignore */
      }
      throw new ZhihuError(`知乎直答 HTTP ${res.status}：${bodyText.slice(0, 200)}`, { status: res.status, body: bodyText.slice(0, 300) });
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new ZhihuError('知乎直答返回空内容（choices[0].message.content 缺失）', { body: JSON.stringify(data).slice(0, 300) });
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

// 从模型输出中稳健地取出 JSON（容忍 ```json 围栏、前后缀文字）
export function extractJson(text) {
  const t = String(text || '').trim();
  if (!t) throw new ZhihuError('空输出，无法解析 JSON');
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : t;
  try {
    return JSON.parse(candidate);
  } catch {
    /* 尝试截取首个 { 到最后一个 } */
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      /* fallthrough */
    }
  }
  const as = candidate.indexOf('[');
  const ae = candidate.lastIndexOf(']');
  if (as >= 0 && ae > as) {
    try {
      return JSON.parse(candidate.slice(as, ae + 1));
    } catch {
      /* fallthrough */
    }
  }
  throw new ZhihuError(`模型输出不是合法 JSON：${clipText(candidate, 160)}`);
}

function clipText(s, n) {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

// ---- 本地缓存：pipeline/.cache/<sha1>.json ----
function cachePath(key) {
  return path.join(CACHE_ROOT, `${key}.json`);
}

function cacheGet(key) {
  try {
    const raw = fs.readFileSync(cachePath(key), 'utf8');
    const entry = JSON.parse(raw);
    if (entry && entry.ok && entry.data !== undefined) return entry.data;
  } catch {
    /* miss */
  }
  return null;
}

function cachePut(key, data) {
  try {
    fs.mkdirSync(CACHE_ROOT, { recursive: true });
    const tmp = cachePath(key) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ok: true, ts: Date.now(), data }), 'utf8');
    fs.renameSync(tmp, cachePath(key));
  } catch (e) {
    warnOnce(`缓存写入失败（不影响本次结果）：${e.message}`);
  }
}

let warnedCache = false;
function warnOnce(msg) {
  if (warnedCache) return;
  warnedCache = true;
  err(msg);
}

// 带重试与 schema 校验的 JSON 请求。
// opts: { baseUrl, secret, model, system, user, validate?, retries?, cacheKeyPrefix?, onRetry? }
// validate(data) -> problems: string[]（空数组表示通过）
export async function llmJson(opts) {
  const { baseUrl, secret, model, system, user, validate = () => [], retries = 2, force = false } = opts;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const key = sha1Hex(JSON.stringify({ model, messages }));
  if (!force) {
    const hit = cacheGet(key);
    if (hit !== null) return hit;
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const msgs =
      attempt === 0 || !lastErr?.raw
        ? messages
        : [
            ...messages,
            { role: 'assistant', content: lastErr?.raw || '' },
            {
              role: 'user',
              content: `你上一次的输出未通过校验。问题如下：\n${(lastErr?.problems || []).join('\n')}\n请修正后重新输出，只输出一个合法 JSON，不要 Markdown 代码块。`,
            },
          ];
    let content;
    try {
      content = await postChat({ baseUrl, secret, model, messages: msgs });
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        log(`  · 知乎直答调用失败（第 ${attempt + 1} 次）：${e.message}，重试…`);
        continue;
      }
      throw e;
    }
    let data;
    try {
      data = extractJson(content);
    } catch (e) {
      lastErr = new ZhihuError(`JSON 解析失败：${e.message}`, {});
      lastErr.raw = content;
      lastErr.problems = [`输出不是合法 JSON。已捕获：${clipText(content, 120)}`];
      if (attempt < retries) {
        log(`  · JSON 解析失败（第 ${attempt + 1} 次），附原文让模型自纠…`);
        continue;
      }
      throw lastErr;
    }
    const problems = validate(data);
    if (problems.length === 0) {
      cachePut(key, data);
      return data;
    }
    lastErr = new ZhihuError(`schema 校验失败：${problems.slice(0, 6).join('；')}`);
    lastErr.raw = content;
    lastErr.problems = problems;
    if (attempt < retries) {
      log(`  · schema 校验未通过（第 ${attempt + 1} 次），附问题让模型修订…`);
      continue;
    }
    throw lastErr;
  }
  throw lastErr || new ZhihuError('未知失败');
}

// 带缓存与 1 次重试的普通文本请求（如刘看山引导语）
export async function llmText(opts) {
  const { baseUrl, secret, model, system, user, force = false, retries = 1 } = opts;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const key = sha1Hex(JSON.stringify({ model, messages, kind: 'text' }));
  if (!force) {
    const hit = cacheGet(key);
    if (hit !== null) return hit;
  }
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const content = await postChat({ baseUrl, secret, model, messages });
      cachePut(key, content);
      return content;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        log(`  · 文本调用失败（第 ${attempt + 1} 次）：${e.message}，重试…`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
