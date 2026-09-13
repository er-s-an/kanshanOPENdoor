// 打字机正文：已完成段落走 markdown 渲染，当前段逐字推进；
// 点按正文跳过本段；底部提供“跳过全部”。onDone 汇报打字完成。
import { useEffect } from 'react';
import { renderMarkdown } from '../lib/md';
import { useTypewriter } from '../lib/useTypewriter';
import { usePrefs } from '../state/prefs';
import { tick } from '../lib/sound';

export function TypedProse({ md, autoTick, onDone }: { md: string; autoTick?: boolean; onDone?: (done: boolean) => void }) {
  const { prefs } = usePrefs();
  const tw = useTypewriter(md, prefs.speed, prefs.typewriter === true);

  useEffect(() => {
    onDone?.(tw.done);
  }, [tw.done, onDone]);

  useEffect(() => {
    if (!autoTick || !prefs.tick || !tw.typing) return;
    if (tw.n % 3 === 0) tick();
  }, [tw.n, tw.typing, autoTick, prefs.tick]);

  const tap = () => {
    if (!tw.done) tw.skipPara();
  };

  return (
    <div className={`prose ${tw.done ? 'prose--done' : 'prose--typing'}`} onPointerDown={tw.done ? undefined : tap}>
      {tw.paras.map((p, i) => {
        if (i < tw.curIdx) {
          return <div key={i} className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.md) }} />;
        }
        if (i === tw.curIdx && !tw.done) {
          return (
            <p key={i} className="tw">
              {p.plain.slice(0, tw.n)}
              <span className="tw__caret" aria-hidden />
            </p>
          );
        }
        return null;
      })}
      {!tw.done ? (
        <div className="typebar">
          <span className="typebar__hint">轻触正文加速</span>
          <button className="btn btn--micro" onPointerDown={(event) => event.stopPropagation()} onClick={tw.finishAll}>
            显示本幕全文
          </button>
        </div>
      ) : null}
    </div>
  );
}
