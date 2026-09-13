// 后端接口：故事加载 + chat SSE 客户端。
// 约定：POST /api/chat 返回 text/event-stream，事件 data 为 JSON：
//   { type:'delta', content }         台词增量
//   { type:'done', reply, goalAchieved, cache?, model? }
//   { type:'error', code, message }    时空信号中断类错误（code: NO_KEY/TIMEOUT/RATE_LIMIT/AUTH/...）
import type { GameJson, StorySummary } from '../types';

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export async function fetchStories(): Promise<StorySummary[]> {
  const data = await getJSON<{ ok: boolean; stories: StorySummary[] }>('/api/stories');
  return data.stories || [];
}

export async function fetchStory(id?: string): Promise<GameJson> {
  const q = id ? `?id=${encodeURIComponent(id)}` : '';
  return getJSON<GameJson>(`/api/story${q}`);
}

export interface ChatRequest {
  storyId: string;
  sceneId: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  choiceSummary?: string;
  /** 玩家已拿到的线索变量名（网关据此避免重复授予） */
  cluesFound?: string[];
  /** 本场景编译好的询问主题；自由输入可省略，由 keywords 匹配。 */
  topicId?: string;
  noCache?: boolean;
  model?: string;
}

export interface ChatResult {
  reply: string;
  goalAchieved: boolean;
  /** 本轮对话中新挖出的线索变量名（clue_*） */
  clues?: string[];
  mode?: 'ai' | 'scripted';
  testimony?: { topicId: string; text: string; clues: string[] };
  reason?: string;
  cache?: string;
  error?: string;
  code?: string;
  aborted?: boolean;
}

/** 事件回调；返回 false 可提前中止（比如组件已卸载） */
export interface ChatHandlers {
  onDelta: (chunk: string) => void;
  onDone: (r: ChatResult) => void;
  onError: (code: string, message: string) => void;
}

export function streamChat(req: ChatRequest, h: ChatHandlers, signal?: AbortSignal) {
  void (async () => {
    let res: Response;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(req),
        signal,
      });
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      return aborted ? h.onError('ABORTED', '') : h.onError('NETWORK', '连不上传讯塔（前端网络错误）。');
    }
    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* ignore */
      }
      return h.onError('HTTP', msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            let j: { type?: string };
            try {
              j = JSON.parse(raw);
            } catch {
              continue;
            }
            if (j.type === 'delta' && typeof (j as { content?: unknown }).content === 'string') {
              h.onDelta((j as { content: string }).content);
            } else if (j.type === 'done') {
              const dj = j as { reply?: unknown; goalAchieved?: boolean; cache?: string; clues?: unknown; mode?: unknown; testimony?: unknown; reason?: unknown };
              const testimony = dj.testimony as Partial<NonNullable<ChatResult['testimony']>> | undefined;
              h.onDone({
                reply: typeof dj.reply === 'string' ? dj.reply : '',
                goalAchieved: dj.goalAchieved === true,
                clues: Array.isArray(dj.clues) ? dj.clues.filter((c): c is string => typeof c === 'string') : undefined,
                mode: dj.mode === 'ai' || dj.mode === 'scripted' ? dj.mode : undefined,
                testimony: testimony && typeof testimony.topicId === 'string' && typeof testimony.text === 'string' && Array.isArray(testimony.clues)
                  ? { topicId: testimony.topicId, text: testimony.text, clues: testimony.clues.filter((c): c is string => typeof c === 'string') } : undefined,
                reason: typeof dj.reason === 'string' ? dj.reason : undefined,
                cache: dj.cache,
              });
              return;
            } else if (j.type === 'error') {
              const e = j as { code?: string; message?: string };
              h.onError(e.code || 'UNKNOWN', e.message || '未知错误');
              return;
            }
          }
        }
      }
      h.onError('EOF', '传讯流意外结束。');
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      h.onError(aborted ? 'ABORTED' : 'STREAM', aborted ? '' : '读取传讯流失败。');
    } finally {
      reader.releaseLock();
    }
  })();
}
