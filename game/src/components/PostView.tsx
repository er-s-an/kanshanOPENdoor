import { useMemo, useState } from 'react';
import type { Choice, PostEntry, Scene } from '../types';
import { choiceLocked } from '../lib/rules.mjs';
import { sfxClick } from '../lib/sound';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';
import '../post-ux.css';

type FeedFilter = 'all' | 'replyable' | 'dm';

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
      <small>{entry.handle ? `@${entry.handle}` : '故事账号'} · {entry.time || '刚刚'}</small>
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

  return <>
    <div className="post-feed__filters" role="group" aria-label="筛选社区回应">
      {([
        ['all', `全部 ${post.entries.length}`],
        ['replyable', `可回复 ${replyableCount}`],
        ['dm', `私信 ${dmCount}`],
      ] as const).map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
    </div>
    <p className="sr-only" role="status">当前显示 {visible.length} 条回应</p>
    <div className="post-feed" aria-label="帖子回应">
      {visible.map((entry) => {
        const choice = entry.actionChoiceId ? choiceById.get(entry.actionChoiceId) : undefined;
        const visited = Boolean(entry.visitedVar && vars[entry.visitedVar]);
        return <article key={entry.id} className={`post-entry${entry.pinned ? ' post-entry--pinned' : ''}${choice ? ' post-entry--actionable' : ''}`}>
          {entry.pinned ? <span className="post-entry__pin">值得查看</span> : null}
          <AccountMeta entry={entry} />
          <p className="post-entry__text">{entry.text}</p>
          <p className="post-entry__boundary"><span>知情边界</span>{entry.knowledge}</p>
          <footer className="post-entry__foot">
            <span>{typeof entry.likes === 'number' ? `${entry.likes} 赞同` : '刚出现的回应'}</span>
            {choice ? <ChoiceButton choice={choice} label={visited ? '再次查看' : entry.actionLabel} /> : <span className="post-entry__ambient">仅浏览</span>}
          </footer>
        </article>;
      })}
    </div>
    <div className="post-feed__exit">
      <p>不需要找出“最可疑的人”。先确认一条回应的来源边界，就可以继续。</p>
      {exitChoices.map((choice) => <ChoiceButton key={choice.id} choice={choice} />)}
    </div>
  </>;
}

function CommunityThread({ scene }: { scene: Scene }) {
  const post = scene.post!;
  const account = post.entries.find((entry) => entry.id === post.activeAccountId) || post.entries[0];
  return <div className="post-thread" aria-label={account.channel === 'dm' ? `与${account.name}的私信` : `与${account.name}的评论对话`}>
    <div className="post-thread__head">
      <AccountMeta entry={account} />
      <p><span>知情边界</span>{account.knowledge}</p>
    </div>
    <ol className="post-thread__messages">
      {(post.thread || []).map((message) => <li key={message.id} className={`post-message post-message--${message.side}`}>
        <small>{message.side === 'player' ? '你' : message.side === 'account' ? account.name : '系统提示'}{message.time ? ` · ${message.time}` : ''}</small>
        <p>{message.text}</p>
      </li>)}
    </ol>
    {post.feedback ? <aside className={`post-thread__feedback post-thread__feedback--${post.feedback.tone || 'boundary'}`} role="status">
      <strong>{post.feedback.label}</strong>
      <p>{post.feedback.text}</p>
    </aside> : null}
    <div className="post-thread__choices">
      <p>这条回应到这里为止。你可以继续看别人，或带着当前记录离开。</p>
      {(scene.choices || []).map((choice) => <ChoiceButton key={choice.id} choice={choice} />)}
    </div>
  </div>;
}

export function PostView({ scene }: { scene: Scene }) {
  const post = scene.post;
  if (!post) return <section className="post-scene"><p className="post-scene__broken">这一页暂时无法显示。</p></section>;
  return <section className="post-scene" aria-labelledby={`post-title-${scene.id}`}>
    <div className="post-scene__scroll">
      <div className="post-shell">
        <header className="post-context">
          <span>{post.community}</span>
          <strong>{post.view === 'thread' ? '回应详情' : '社区现场'}</strong>
        </header>
        <aside className="post-fiction-note" aria-label="角色身份说明">
          <span aria-hidden>◇</span>
          <p><strong>本幕身份说明</strong>{post.fictionNotice}</p>
        </aside>
        <article className="post-question">
          <div className="post-question__author">
            <span className="post-question__avatar" aria-hidden>{post.author.avatarText || '匿'}</span>
            <p><strong>{post.author.name}</strong><small>{post.author.handle ? `@${post.author.handle}` : ''}{post.author.label ? ` · ${post.author.label}` : ''}</small></p>
          </div>
          <h2 id={`post-title-${scene.id}`}>{post.questionTitle}</h2>
          {post.questionBody.split('\n').filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          {post.tags?.length ? <div className="post-question__tags" aria-label="帖子话题">{post.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
          {post.stats ? <footer>
            <span>{post.stats.views ?? 0} 浏览</span>
            <span>{post.stats.comments ?? 0} 条评论</span>
            {post.stats.dms ? <span>{post.stats.dms} 条新私信</span> : null}
          </footer> : null}
        </article>
        {post.view === 'feed' ? <CommunityFeed scene={scene} /> : <CommunityThread scene={scene} />}
      </div>
    </div>
  </section>;
}
