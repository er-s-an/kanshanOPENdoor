import { useMemo, useState, type ReactNode } from 'react';
import type { Choice, PostEntry, PostExtractable, Scene } from '../types';
import { choiceLocked } from '../lib/rules.mjs';
import { sfxClick } from '../lib/sound';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';
import '../post-ux.css';

type FeedFilter = 'all' | 'replyable' | 'dm';

function ExtractableText({ text, extractables = [] }: { text: string; extractables?: PostExtractable[] }) {
  const { vars, savePostExtractable } = useGame();
  const pieces: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor < text.length) {
    const next = extractables.map((fragment) => ({ fragment, index: text.indexOf(fragment.text, cursor) }))
      .filter((candidate) => candidate.index >= 0)
      .sort((a, b) => a.index - b.index || b.fragment.text.length - a.fragment.text.length)[0];
    if (!next) {
      pieces.push(text.slice(cursor));
      break;
    }
    if (next.index > cursor) pieces.push(text.slice(cursor, next.index));
    const saved = Object.keys(next.fragment.set).every((name) => vars[name] === 'saved');
    pieces.push(<button key={`${next.fragment.id}-${key++}`} type="button" className={`post-extractable${saved ? ' is-saved' : ''}`} aria-label={`划下这句：${next.fragment.text}`} aria-pressed={saved} onClick={() => savePostExtractable(next.fragment.id)}>
      {next.fragment.text}
    </button>);
    cursor = next.index + next.fragment.text.length;
  }
  return <>{pieces}</>;
}

function Avatar({ entry }: { entry: PostEntry }) {
  return <span className="post-avatar" aria-hidden>{entry.avatarText || entry.name.slice(0, 1)}</span>;
}

function ChoiceButton({ choice, label }: { choice: Choice; label?: string }) {
  const { vars, chooseAndNav, navBusy } = useGame();
  const { prefs } = usePrefs();
  const locked = choiceLocked(choice, vars);
  return <button
    className={`post-action${locked ? ' post-action--locked' : ''}`}
    disabled={Boolean(locked) || navBusy}
    onClick={() => {
      if (prefs.sfx) sfxClick();
      chooseAndNav(choice);
    }}
  >
    <span>{label || choice.text}</span>
    <small>{locked || (label ? '打开回应' : '继续')} <span aria-hidden>→</span></small>
  </button>;
}

function AccountMeta({ entry }: { entry: PostEntry }) {
  return <div className="post-entry__meta">
    <Avatar entry={entry} />
    <span className="post-entry__identity">
      <strong>{entry.name}</strong>
      <small>{entry.handle ? `@${entry.handle}` : '用户'} · {entry.time || '刚刚'}</small>
    </span>
    {entry.channel === 'dm' ? <span className="post-entry__channel">私信</span> : null}
  </div>;
}

function CommunityFeed({ scene }: { scene: Scene }) {
  const { vars } = useGame();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const post = scene.post!;
  const choiceById = useMemo(() => new Map((scene.choices || []).map((choice) => [choice.id, choice])), [scene.choices]);
  const accountChoiceIds = new Set(post.entries.flatMap((entry) => entry.actionChoiceId ? [entry.actionChoiceId] : []));
  const exitChoices = (scene.choices || []).filter((choice) => !accountChoiceIds.has(choice.id));
  const visible = post.entries.filter((entry) => {
    if (filter === 'replyable') return Boolean(entry.actionChoiceId);
    if (filter === 'dm') return entry.channel === 'dm';
    return true;
  });
  const replyableCount = post.entries.filter((entry) => entry.actionChoiceId).length;
  const dmCount = post.entries.filter((entry) => entry.channel === 'dm').length;
  const availableExitChoices = exitChoices.filter((choice) => !choiceLocked(choice, vars));

  return <>
    <div className="post-feed__filters" role="group" aria-label="筛选社区回应">
      {([
        ['all', `全部回应 ${post.entries.length}`],
        ['replyable', `作者赞过 ${replyableCount}`],
        ['dm', `私信 ${dmCount}`],
      ] as const).map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
    </div>
    <p className="sr-only" role="status">当前显示 {visible.length} 条回应</p>
    <div className="post-feed" aria-label="帖子回应">
      {visible.map((entry) => {
        const choice = entry.actionChoiceId ? choiceById.get(entry.actionChoiceId) : undefined;
        const visited = Boolean(entry.visitedVar && vars[entry.visitedVar]);
        return <article key={entry.id} className={`post-entry${entry.pinned ? ' post-entry--pinned' : ''}${choice ? ' post-entry--actionable' : ''}`}>
          {entry.pinned ? <span className="post-entry__pin">作者赞过</span> : null}
          <AccountMeta entry={entry} />
          <p className="post-entry__text"><ExtractableText text={entry.text} extractables={post.extractables} /></p>
          <footer className="post-entry__foot">
            <span>{typeof entry.likes === 'number' ? `${entry.likes} 赞同` : '刚出现的回应'}</span>
            {choice ? <ChoiceButton choice={choice} label={visited ? '再次查看' : entry.actionLabel} /> : null}
          </footer>
        </article>;
      })}
    </div>
    {availableExitChoices.length ? <div className="post-feed__exit">
      {availableExitChoices.map((choice) => <ChoiceButton key={choice.id} choice={choice} />)}
    </div> : null}
  </>;
}

function CommunityThread({ scene }: { scene: Scene }) {
  const post = scene.post!;
  const account = post.entries.find((entry) => entry.id === post.activeAccountId) || post.entries[0];
  return <div className="post-thread" aria-label={account.channel === 'dm' ? `与${account.name}的私信` : `与${account.name}的评论对话`}>
    <div className="post-thread__head">
      <AccountMeta entry={account} />
    </div>
    <ol className="post-thread__messages">
      {(post.thread || []).map((message) => <li key={message.id} className={`post-message post-message--${message.side}`}>
        <small>{message.side === 'player' ? '你' : message.side === 'account' ? account.name : '系统提示'}{message.time ? ` · ${message.time}` : ''}</small>
        <p>{message.text}</p>
      </li>)}
    </ol>
    <div className="post-thread__choices">
      {(scene.choices || []).map((choice) => <ChoiceButton key={choice.id} choice={choice} />)}
    </div>
  </div>;
}

export function PostView({ scene }: { scene: Scene }) {
  const post = scene.post;
  const { vars } = useGame();
  if (!post) return <section className="post-scene"><p className="post-scene__broken">这一页暂时无法显示。</p></section>;
  const savedExtractables = (post.extractables || []).filter((fragment) => Object.keys(fragment.set).every((name) => vars[name] === 'saved'));
  return <section className="post-scene" aria-labelledby={`post-title-${scene.id}`}>
    <div className="post-scene__scroll">
      <div className="post-shell">
        <header className="post-context">
          <span>{post.community}</span>
          <strong>{post.view === 'thread' ? '回应详情' : '最新回应'}</strong>
        </header>
        <article className="post-question">
          <div className="post-question__author">
            <span className="post-question__avatar" aria-hidden>{post.author.avatarText || '匿'}</span>
            <p><strong>{post.author.name}</strong><small>{post.author.handle ? `@${post.author.handle}` : ''}{post.author.label ? ` · ${post.author.label}` : ''}</small></p>
          </div>
          <h2 id={`post-title-${scene.id}`}>{post.questionTitle}</h2>
          {post.questionBody.split('\n').filter(Boolean).map((paragraph, index) => <p key={index}><ExtractableText text={paragraph} extractables={post.extractables} /></p>)}
          {post.tags?.length ? <div className="post-question__tags" aria-label="帖子话题">{post.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
          {post.stats ? <footer>
            <span>{post.stats.views ?? 0} 浏览</span>
            <span>{post.stats.comments ?? 0} 条评论</span>
            {post.stats.dms ? <span>{post.stats.dms} 条新私信</span> : null}
          </footer> : null}
        </article>
        {savedExtractables.length ? <aside className="post-notes" aria-label="划下的原话">
          <div><strong>划下的原话</strong><span>{savedExtractables.length} 条</span></div>
          <ul>{savedExtractables.map((fragment) => <li key={fragment.id}>{fragment.note}</li>)}</ul>
        </aside> : null}
        {post.view === 'feed' ? <CommunityFeed scene={scene} /> : <CommunityThread scene={scene} />}
      </div>
    </div>
  </section>;
}
