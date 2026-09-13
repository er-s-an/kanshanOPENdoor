// 自动吸底：打字机 / 对话滚动时，若用户本就在底部则跟随；上翻则放手
import { useEffect, useRef } from 'react';

export function useStickToBottom(ref: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (!el) return;
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
      pinned.current = near;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
    // 依赖由调用方显式传入（打字进度 / 消息列表变化）
  }, deps);
}
