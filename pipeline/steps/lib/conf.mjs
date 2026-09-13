// 配置解析：模型名 / 知乎直答 API 端点 / Access Secret 解析
// Secret 优先级：环境变量 ZHIHU_ACCESS_SECRET > pipeline/.env > 本地开发文件。
// 只读取存在性判断与来源名称，绝不打印 secret 内容本身。
import fs from 'node:fs';
import { PKG_ROOT, loadDotEnv } from './util.mjs';

export const DEFAULT_BASE_URL = 'https://developer.zhihu.com/v1';
export const MODEL_THINKING = 'zhida-thinking-1p5'; // 分析 / 生成：需要结构化推理
export const MODEL_FAST = 'zhida-fast-1p5'; // 简单步骤：例如刘看山引导语这类短文本

export const DEV_SECRET_FILE = '/Users/xiejiachen/zhihu-hackathon-2026/.access_secret';

export function resolveConfig() {
  loadDotEnv();
  const baseUrl = (process.env.ZHIHU_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const modelThinking = process.env.ZHIHU_MODEL_THINKING || MODEL_THINKING;
  const modelFast = process.env.ZHIHU_MODEL_FAST || MODEL_FAST;
  return {
    baseUrl,
    modelThinking,
    modelFast,
    // 简单步骤（如 kanshan 引导文案）用 fast 模型；其余用 thinking 模型
    modelFor(kind) {
      return kind === 'fast' ? modelFast : modelThinking;
    },
  };
}

export function resolveSecret() {
  loadDotEnv();
  // 显式设置了（哪怕为空）即视为“权威值”，不再回退开发文件——便于测试与 CI 强制离线
  if (Object.prototype.hasOwnProperty.call(process.env, 'ZHIHU_ACCESS_SECRET')) {
    const env = process.env.ZHIHU_ACCESS_SECRET;
    if (env && env.trim()) return { secret: env.trim(), source: 'env:ZHIHU_ACCESS_SECRET' };
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(process.env, 'ZHIHU_ACCESS_SECRET_FILE')) {
    const file = (process.env.ZHIHU_ACCESS_SECRET_FILE || '').trim();
    if (!file) return null;
    try {
      const s = fs.readFileSync(file, 'utf8').trim();
      if (s) return { secret: s, source: `file:${file}` };
    } catch {
      /* 读取失败按未配置处理 */
    }
    return null;
  }
  // 本地开发便捷通道（README 声明路径）
  const dev = process.env.ZHIHU_DEV_SECRET_FILE || (fs.existsSync(DEV_SECRET_FILE) ? DEV_SECRET_FILE : null);
  if (dev) {
    try {
      const s = fs.readFileSync(dev, 'utf8').trim();
      if (s) return { secret: s, source: `file:${dev}` };
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function forceMockFromEnv() {
  loadDotEnv();
  return process.env.ZHIHU_MOCK === '1' || process.env.LLM_MOCK === '1';
}

export function describeSecret(secretInfo) {
  if (!secretInfo) return '未配置（将自动使用 mock）';
  return `${secretInfo.source}（已配置，内容不落日志）`;
}
