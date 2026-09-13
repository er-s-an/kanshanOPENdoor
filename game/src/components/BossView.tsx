// Boss 战：评论区对线（GDD §3.3）
// 知乎问题页形态：问题卡 → 选指控对象 → 你的回答卡（赞同数） → 回合制呈证/反驳 → 分流结局。
// 判定全确定性：呈证=点选线索板，命中 accept 即有效；运行时零自由文本解析。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BossSlot, Scene } from '../types';
import { renderMarkdown } from '../lib/md';
import { sfxChime, sfxClick, sfxRescue } from '../lib/sound';
import { useStickToBottom } from '../lib/useStick';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';
import '../boss-ux.css';

type Entry =
  | { kind: 'system'; text: string }
  | { kind: 'you'; text: string; clueId?: string }
  | { kind: 'npc'; name: string; text: string }
  | { kind: 'crowd'; name: string; text: string; likes?: number };

const SWAT_LINES = ['这与本场培训无关，请不要带节奏。', '情绪化的联想不能作为证据。', '相关内容已截图留存，我方保留追责权利。'];
const CROWD_NAMES = ['路过的好事者', '前培训从业者', '匿名用户', '隔壁工位吃瓜人', '正义路人甲', '深夜刷帖人', '老马识途', '一只围观的狐'];

function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}
function avatarStyle(name: string): React.CSSProperties {
  const h = hueOf(name);
  return { background: `linear-gradient(145deg, hsl(${h} 52% 34%), hsl(${(h + 40) % 360} 58% 20%))`, color: `hsl(${h} 30% 93%)` };
}

// ---- 物证卡素材映射：clue id → 卡面图（渐进增强，图缺失即回退纯文本）
const EXAM_CLUES = new Set(['clue_test_difference', 'clue_my_test', 'clue_other_test']);
const WEB_CLUES = new Set(['clue_web']);
const NOTE_CLUES = new Set(['clue_restaurant', 'clue_shop', 'clue_tail_pattern', 'clue_no_return']);

function evidenceArtFor(clueId: string): string {
  if (EXAM_CLUES.has(clueId)) return '/art/evidence/paper-exam-blank.png';
  if (WEB_CLUES.has(clueId)) return '/art/evidence/paper-web-printout-blank.png';
  if (NOTE_CLUES.has(clueId)) return '/art/evidence/note-witness-blank.png';
  return '/art/evidence/paper-statement-blank.png';
}

/** 物证小图：加载失败则回退 fallback（默认隐藏），不阻塞现有形态 */
function EvidenceArt({ clueId, className, fallback = null }: { clueId: string; className?: string; fallback?: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return <img className={className} src={evidenceArtFor(clueId)} alt="物证卡" loading="lazy" onError={() => setFailed(true)} />;
}

/** 数字滚动（赞同数暴涨的爽感来源） */
function useCountUp(target: number, ms = 750): number {
  const [val, setVal] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setVal(Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

export function BossView({ scene }: { scene: Scene }) {
  const { story, vars, nav } = useGame();
  const { prefs } = usePrefs();
  const boss = scene.boss;

  const looped = boss?.loopVar ? vars[boss.loopVar] !== undefined : false;
  const [phase, setPhase] = useState<'suspect' | 'fight'>('suspect');
  const [roundIdx, setRoundIdx] = useState(0);
  const [used, setUsed] = useState<ReadonlySet<string>>(new Set());
  const [roundHits, setRoundHits] = useState(0);
  const [likes, setLikes] = useState(boss?.baseLikes ?? 47);
  const [feed, setFeed] = useState<Entry[]>(() =>
    boss ? [{ kind: 'system', text: (looped && boss.introLoop) || boss.intro }] : [],
  );
  const [drawer, setDrawer] = useState(false);
  const [foldLine, setFoldLine] = useState<string | null>(null);
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const crowdIdx = useRef(0);
  const swatIdx = useRef(0);
  const navTimer = useRef<number | null>(null);

  const shownLikes = useCountUp(likes);
  useStickToBottom(scrollRef, [feed.length, drawer, foldLine]);

  useEffect(() => () => { if (navTimer.current) window.clearTimeout(navTimer.current); }, []);

  const clues = useMemo(() => story?.clues || [], [story]);
  const held = useMemo(() => clues.filter((c) => vars[c.id] !== undefined), [clues, vars]);
  const round = boss?.rounds[roundIdx];
  const push = useCallback((e: Entry) => setFeed((f) => [...f, e]), []);
  const crowd = useCallback(
    (pool: string[], n: number) => {
      for (let i = 0; i < n; i++) {
        const text = pool[crowdIdx.current % pool.length];
        crowdIdx.current++;
        push({ kind: 'crowd', name: CROWD_NAMES[crowdIdx.current % CROWD_NAMES.length], text, likes: 1 + ((crowdIdx.current * 37) % 48) });
      }
    },
    [push],
  );

  const navLater = useCallback((sceneId: string, delay: number) => {
    setPendingNav(sceneId);
    navTimer.current = window.setTimeout(() => nav(sceneId), delay);
  }, [nav]);

  // ---- 指控对象
  const pickSuspect = useCallback(
    (id: string) => {
      if (!boss || foldLine || pendingNav) return;
      const s = boss.suspects.find((x) => x.id === id);
      if (!s) return;
      if (prefs.sfx) sfxClick();
      push({ kind: 'you', text: `我要指认的是：${s.name}。` });
      if (!s.correct) {
        if (prefs.sfx) sfxRescue();
        setLikes((v) => Math.max(0, Math.round(v * 0.4)));
        setFoldLine(boss.foldWrong);
        return;
      }
      setPhase('fight');
      setFeed((f) => [
        ...f,
        { kind: 'system', text: '回答已发布。对方的官方账号几乎是秒回——这一仗，在评论区打。' },
        { kind: 'system', text: boss.rounds[0]?.cue || '' },
      ]);
      crowd(boss.crowdIdle || [], 2);
    },
    [boss, foldLine, pendingNav, prefs.sfx, push, crowd],
  );

  // ---- 呈上证据
  const present = useCallback(
    (clueId: string) => {
      if (!boss || !round || used.has(clueId) || pendingNav || foldLine) return;
      const clue = clues.find((c) => c.id === clueId);
      if (!clue) return;
      setUsed((u) => new Set(u).add(clueId));

      // 彩蛋：隐藏指控线
      if (boss.egg && clueId === boss.egg.clue) {
        if (prefs.sfx) sfxChime();
        push({ kind: 'you', text: boss.egg.present });
        push({ kind: 'system', text: '评论区忽然安静了。三分钟后，这条回复将被截图传遍整个网站。' });
        navLater(boss.egg.ending, 2200);
        return;
      }

      const slot: BossSlot | undefined = round.slots.find((s) => s.clue === clueId);
      if (slot && round.accept.includes(clueId)) {
        // 有效呈证
        if (prefs.sfx) sfxChime();
        push({ kind: 'you', text: slot.present, clueId });
        push({ kind: 'npc', name: slot.speaker || '官方账号', text: slot.rebuttal });
        setLikes((v) => v + (slot.likes ?? 512));
        setRoundHits((h) => h + 1);
        crowd(boss.crowdHits || [], 2);
      } else {
        // 被反驳：无效呈证
        if (prefs.sfx) sfxRescue();
        push({ kind: 'you', text: `（呈上）${clue.name}` });
        push({ kind: 'npc', name: '官方账号', text: SWAT_LINES[swatIdx.current++ % SWAT_LINES.length] });
        setLikes((v) => Math.max(0, v - 24));
        crowd(boss.crowdIdle || [], 1);
      }
    },
    [boss, round, used, pendingNav, foldLine, clues, prefs.sfx, push, crowd, navLater],
  );

  // ---- 压下一城 / 收网
  const advance = useCallback(() => {
    if (!boss || roundHits < 1 || pendingNav) return;
    if (prefs.sfx) sfxClick();
    const next = roundIdx + 1;
    if (next >= boss.rounds.length) {
      push({ kind: 'system', text: '证据链闭合。你的回答正在以肉眼可见的速度被顶上热榜——' });
      setLikes((v) => v * 3);
      navLater(boss.endings.truth, 2000);
      return;
    }
    setRoundIdx(next);
    setRoundHits(0);
    push({ kind: 'system', text: boss.rounds[next].cue });
    crowd(boss.crowdIdle || [], 1);
  }, [boss, roundHits, roundIdx, pendingNav, prefs.sfx, push, crowd, navLater]);

  if (!boss) {
    return (
      <section className="boss">
        <div className="boss__scroll md" dangerouslySetInnerHTML={{ __html: renderMarkdown(scene.text || '这场对峙还没有准备好。') }} />
      </section>
    );
  }

  const kindLabel = (k?: string) => (k === 'testimony' ? '证言' : k === 'inference' ? '推断' : '观察');

  return (
    <section className="boss">
      <div className="boss__scroll" ref={scrollRef}>
        {/* 问题卡 */}
        <header className="boss__question">
          <p className="boss__eyebrow">{looped ? '轮回 · 第二次发布' : '知乎 · 问题页'}</p>
          <h2>{boss.question}</h2>
        </header>

        {/* 指控对象 */}
        {phase === 'suspect' ? (
          <div className="boss__suspects">
            <p className="boss__phase">发布回答前，先想清楚——你要指认谁？</p>
            {boss.suspects.map((s) => (
              <button key={s.id} className="boss__suspect" disabled={Boolean(foldLine) || Boolean(pendingNav)} onClick={() => pickSuspect(s.id)}>
                <b>{s.name}</b>
                <span>{s.desc}</span>
              </button>
            ))}
            {foldLine ? (
              <div className="boss__fold">
                <p>{foldLine}</p>
                <p className="boss__fold-tag">你的回答已被折叠</p>
                <button className="btn btn--primary" onClick={() => nav(boss.endings.fold)}>查看结果 →</button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {/* 你的回答卡 */}
            <article className="boss__answer">
              <p className="boss__answer-badge">你的回答</p>
              <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(boss.answer) }} />
              <p className="boss__likes">
                <span aria-hidden>▲</span> 赞同 <b key={Math.floor(shownLikes / 50)}>{shownLikes.toLocaleString()}</b>
              </p>
            </article>

            {/* 评论区 feed */}
            <div className="boss__feed">
              <img
                className="boss__sysart"
                src="/art/evidence/liu-kanshan-presents-blank-clue.png"
                alt=""
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              {feed.slice(1).map((e, i) =>
                e.kind === 'system' ? (
                  <p key={i} className="boss__sysline">{e.text}</p>
                ) : e.kind === 'you' ? (
                  <div key={i} className="boss__entry boss__entry--you">
                    <span className="boss__avatar boss__avatar--you">你</span>
                    <div className="boss__bubble">
                      <p className="boss__name">你 <i>答主</i></p>
                      <p>{e.text}</p>
                      {e.clueId ? <EvidenceArt clueId={e.clueId} className="boss__evidence" /> : null}
                    </div>
                  </div>
                ) : e.kind === 'npc' ? (
                  <div key={i} className="boss__entry">
                    <span className="boss__avatar" style={avatarStyle(e.name)}>{e.name.slice(0, 1)}</span>
                    <div className="boss__bubble">
                      <p className="boss__name">{e.name} <i>官方</i></p>
                      <p>{e.text}</p>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="boss__entry boss__entry--crowd">
                    <span className="boss__avatar" style={avatarStyle(e.name)}>{e.name.slice(0, 1)}</span>
                    <div className="boss__bubble">
                      <p className="boss__name">{e.name}</p>
                      <p>{e.text}{e.likes ? <span className="boss__entry-likes"> ♥ {e.likes}</span> : null}</p>
                    </div>
                  </div>
                ),
              )}
            </div>
          </>
        )}
      </div>

      {/* 行动栏 */}
      {phase === 'fight' && !pendingNav ? (
        <div className="boss__bar">
          <span className="boss__round">第 {roundIdx + 1}/{boss.rounds.length} 轮 · 对峙中</span>
          <div className="boss__bar-actions">
            <button className="btn btn--ghost btn--sm" onClick={() => nav(boss.endings.fold)}>放弃发帖</button>
            <button className="btn btn--primary btn--sm" onClick={() => setDrawer(true)}>呈上证据</button>
            <button className="btn btn--amber btn--sm" disabled={roundHits < 1} onClick={advance}>
              {roundIdx + 1 >= boss.rounds.length ? '收网 →' : '压下一城 →'}
            </button>
          </div>
        </div>
      ) : null}

      {/* 线索板抽屉（点遮罩关闭） */}
      {drawer ? (
        <div className="boss__drawer-mask" onClick={() => setDrawer(false)}>
          <div className="boss__drawer" role="dialog" aria-modal="true" aria-label="线索板" onClick={(e) => e.stopPropagation()}>
          <div className="boss__drawer-head">
            <b>线索板 · 呈上一条证据</b>
            <button className="boss__drawer-close" onClick={() => setDrawer(false)} aria-label="关闭">✕</button>
          </div>
          <p className="boss__drawer-tip">{boss.egg && held.some((c) => c.id === boss.egg?.clue) ? '有一条线索似乎指向更大的东西……' : `本轮有效证据会写进评论区；无效的证据只会被抓住话柄。`}</p>
          <div className="boss__drawer-list">
            {held.length ? held.map((c) => {
              const isUsed = used.has(c.id);
              return (
                <button key={c.id} className="boss__clue" disabled={isUsed} onClick={() => { setDrawer(false); present(c.id); }}>
                  <EvidenceArt clueId={c.id} className="boss__clue-art" fallback={<span className="boss__clue-kind">{kindLabel(c.kind)}</span>} />
                  <span className="boss__clue-name">{c.name}</span>
                  {isUsed ? <span className="boss__clue-used">已呈上</span> : null}
                </button>
              );
            }) : <p className="boss__drawer-tip">线索板是空的——先回现场和评论区找证据。</p>}
          </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
