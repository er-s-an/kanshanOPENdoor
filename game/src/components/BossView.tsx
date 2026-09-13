// Boss 战：公开论证。
// 玩家先选择一条自己能够负责的主张，再用已取得的物证逐项回应质疑。
// 所有判定、消耗与结局分流都来自引擎；本组件只负责把状态讲清楚。
import { useCallback, useMemo, useState } from 'react';
import type { BossDecision, BossDecisionStatus, BossOutcome, ClueMeta, Scene } from '../types';
import { bossCases } from '../lib/boss-rules.mjs';
import { renderMarkdown } from '../lib/md';
import { sfxChime, sfxClick, sfxRescue } from '../lib/sound';
import { useDialog } from '../lib/useDialog';
import { useGame } from '../state/engine';
import { usePrefs } from '../state/prefs';
import { EvidenceDocument } from './EvidenceDocument';
import '../boss-ux.css';

type Feedback = {
  decision: BossDecision;
  clue?: ClueMeta;
};

const resultCopy: Partial<Record<BossDecisionStatus, { label: string; tone: 'good' | 'warn' | 'bad' }>> = {
  supported: { label: '证据支持主张', tone: 'good' },
  partial: { label: '证据部分支持', tone: 'warn' },
  countered: { label: '质疑已被回应', tone: 'good' },
  overreach: { label: '论证越界', tone: 'bad' },
  miss: { label: '证据与本轮无直接关系', tone: 'bad' },
  'not-held': { label: '这份材料尚未取得', tone: 'bad' },
  'already-used': { label: '这份材料已经进入论证', tone: 'warn' },
  'already-cleared': { label: '本轮质疑已经回应', tone: 'warn' },
};

function meterBounds(config?: { min?: number; max?: number }) {
  const min = Number.isFinite(config?.min) ? Number(config?.min) : 0;
  const max = Math.max(min, Number.isFinite(config?.max) ? Number(config?.max) : 100);
  return { min, max };
}

function Meter({
  label,
  value,
  config,
  tone,
}: {
  label: string;
  value: number;
  config?: { min?: number; max?: number };
  tone: 'credibility' | 'exposure';
}) {
  const { min, max } = meterBounds(config);
  const clamped = Math.min(max, Math.max(min, value));
  const progress = max === min ? 0 : ((clamped - min) / (max - min)) * 100;
  return (
    <div className={`boss__meter boss__meter--${tone}`}>
      <div className="boss__meter-label">
        <span>{label}</span>
        <b>{clamped}</b>
      </div>
      <div className="boss__meter-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <meter className="sr-only" min={min} max={max} value={clamped}>
        {clamped}
      </meter>
    </div>
  );
}

function outcomeDestination(scene: Scene, decision: BossDecision | null, outcome?: BossOutcome) {
  if (decision?.destination) return decision.destination;
  if (!scene.boss) return null;
  if (outcome === 'fold') return scene.boss.endings.fold;
  if (outcome === 'egg') return scene.boss.egg?.ending || null;
  if (outcome === 'truth') return scene.boss.endings.truth;
  return null;
}

export function BossView({ scene }: { scene: Scene }) {
  const {
    story,
    vars,
    bossRun,
    bossSelectClaim,
    bossSelectSuspect,
    bossPresentEvidence,
    bossAdvance,
    nav,
    backToDoor,
  } = useGame();
  const { prefs } = usePrefs();
  const boss = scene.boss;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastDecision, setLastDecision] = useState<BossDecision | null>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const dialogRef = useDialog(drawerOpen, closeDrawer);

  const clues = useMemo(() => story?.clues || [], [story]);
  const held = useMemo(() => clues.filter((clue) => vars[clue.id] === 'found'), [clues, vars]);
  const heldIds = useMemo(() => new Set(held.map((clue) => clue.id)), [held]);
  const cases = useMemo(() => bossCases(scene), [scene]);
  const currentCase = bossRun ? cases[bossRun.caseIndex] : undefined;
  const currentCleared = Boolean(currentCase && bossRun?.clearedCases.includes(currentCase.id));
  const hasClaims = Boolean(boss?.claims?.length);
  const looped = boss?.loopVar ? vars[boss.loopVar] !== undefined : false;
  const selectedClaim = boss?.claims?.find((claim) => claim.id === bossRun?.claimId);
  const selectedSuspect = boss?.suspects.find((suspect) => suspect.id === bossRun?.suspectId);
  const destination = outcomeDestination(scene, lastDecision, bossRun?.outcome);

  const heldResponses = useMemo(
    () => currentCase?.counters.filter((counter) => heldIds.has(counter.clue) && counter.result !== 'overreach') || [],
    [currentCase, heldIds],
  );

  const chooseClaim = useCallback((claimId: string) => {
    const decision = bossSelectClaim(claimId);
    if (!decision) return;
    if (prefs.sfx) sfxClick();
    setLastDecision(decision);
    setFeedback(null);
  }, [bossSelectClaim, prefs.sfx]);

  const chooseSuspect = useCallback((suspectId: string) => {
    const decision = bossSelectSuspect(suspectId);
    if (!decision) return;
    if (prefs.sfx) decision.accepted ? sfxClick() : sfxRescue();
    setLastDecision(decision);
    setFeedback(null);
  }, [bossSelectSuspect, prefs.sfx]);

  const presentEvidence = useCallback((clue: ClueMeta) => {
    const decision = bossPresentEvidence(clue.id);
    if (!decision) return;
    if (prefs.sfx) decision.accepted ? sfxChime() : sfxRescue();
    setDrawerOpen(false);
    setLastDecision(decision);
    setFeedback({ decision, clue });
  }, [bossPresentEvidence, prefs.sfx]);

  const advance = useCallback(() => {
    const decision = bossAdvance();
    if (!decision) return;
    if (prefs.sfx) sfxClick();
    setLastDecision(decision);
    setFeedback(null);
  }, [bossAdvance, prefs.sfx]);

  if (!boss || !bossRun) {
    return (
      <section className="boss boss--missing">
        <div className="boss__missing md" dangerouslySetInnerHTML={{ __html: renderMarkdown(scene.text || '这场公开论证还没有准备好。') }} />
      </section>
    );
  }

  const feedbackMeta = feedback ? resultCopy[feedback.decision.status] : null;
  const brief = (looped && boss.introLoop) || boss.intro;

  return (
    <section className="boss">
      <div className={`boss__scroll${bossRun.phase === 'claim' ? ' is-claim' : ''}`}>
        <figure className="boss__hero">
          {scene.image ? (
            <img
              src={scene.image}
              alt={scene.imageAlt || ''}
              onError={(event) => { event.currentTarget.hidden = true; }}
            />
          ) : null}
          <span className="boss__hero-shade" aria-hidden="true" />
          <figcaption>
            <p className="boss__eyebrow">{looped ? '公开记录 · 再次论证' : '公开记录 · 事实核验'}</p>
            <h2>{boss.question}</h2>
          </figcaption>
        </figure>

        <aside className="boss__brief" aria-label="看山提示">
          <img src="/art/character/motion/liu-kanshan-computer.gif" alt="刘看山在查阅资料" />
          <div>
            <b>看山提示</b>
            <p>{brief}</p>
          </div>
        </aside>

        {bossRun.phase === 'claim' ? (
          <section className="boss__claim-stage" aria-labelledby="boss-claim-title">
            {hasClaims ? (
              <>
                <div className="boss__section-head">
                  <p className="boss__step">01 · 确立论点</p>
                  <h2 id="boss-claim-title">选择一条你愿意公开负责的主张</h2>
                  <p>事实可以直接陈述；假设必须保留边界。选定后，你要逐项回应对方的质疑。</p>
                </div>
                <div className="boss__claim-grid">
                  {boss.claims!.map((claim) => (
                    <button key={claim.id} className="boss__claim" onClick={() => chooseClaim(claim.id)}>
                      <span className={`boss__certainty boss__certainty--${claim.certainty}`}>
                        {claim.certainty === 'fact' ? '事实主张' : '待证假设'}
                      </span>
                      <b>{claim.statement}</b>
                      {claim.summary ? <span>{claim.summary}</span> : null}
                      {(claim.credibility || claim.exposure) ? (
                        <small>
                          {claim.credibility ? `可信度 ${claim.credibility > 0 ? '+' : ''}${claim.credibility}` : ''}
                          {claim.credibility && claim.exposure ? ' · ' : ''}
                          {claim.exposure ? `暴露度 ${claim.exposure > 0 ? '+' : ''}${claim.exposure}` : ''}
                        </small>
                      ) : null}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="boss__section-head">
                  <p className="boss__step">兼容模式 · 原剧本指认</p>
                  <h2 id="boss-claim-title">现有剧本还没有提供可验证主张</h2>
                  <p>先保留原有指认入口。进入论证后，只以明确取得的物证回应质疑，不把热度当成真相。</p>
                </div>
                <div className="boss__claim-grid">
                  {boss.suspects.map((suspect) => (
                    <button key={suspect.id} className="boss__claim boss__claim--legacy" onClick={() => chooseSuspect(suspect.id)}>
                      <span className="boss__certainty">指认对象</span>
                      <b>{suspect.name}</b>
                      <span>{suspect.desc}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        ) : bossRun.phase === 'counter' ? (
          <div className="boss__argument-layout">
            <main className="boss__thread">
              <article className="boss__answer">
                <p className="boss__answer-badge">你的公开主张</p>
                <h2>{selectedClaim?.statement || `需要核验：${selectedSuspect?.name || '现有指认'}`}</h2>
                {selectedClaim?.summary ? <p>{selectedClaim.summary}</p> : null}
                {!hasClaims ? (
                  <div className="md boss__legacy-answer" dangerouslySetInnerHTML={{ __html: renderMarkdown(boss.answer) }} />
                ) : null}
              </article>

              <section className={`boss__challenge${currentCleared ? ' is-cleared' : ''}`} aria-labelledby="boss-challenge-title">
                <div className="boss__challenge-head">
                  <p className="boss__step">质疑 {bossRun.caseIndex + 1} / {cases.length}</p>
                  {currentCleared ? <span>已回应</span> : <span>等待证据</span>}
                </div>
                <h2 id="boss-challenge-title">{currentCase?.claim || '对方正在等待你的证据回应。'}</h2>
                {currentCase?.cue ? <p>{currentCase.cue}</p> : null}
              </section>

              <section className="boss__exchange">
                {feedback && feedbackMeta ? (
                  <>
                    <div className={`boss__result boss__result--${feedbackMeta.tone}`}>
                      <span>{feedbackMeta.label}</span>
                      {!feedback.decision.consumed ? <small>可更换证据重试，本次不消耗线索</small> : null}
                    </div>
                    <div className="boss__exchange-body">
                      {feedback.clue ? <EvidenceDocument clue={feedback.clue} compact selected={feedback.decision.accepted} /> : null}
                      <div className="boss__exchange-copy">
                        {feedback.decision.counter?.present ? (
                          <blockquote>
                            <b>你的回应</b>
                            <p>{feedback.decision.counter.present}</p>
                          </blockquote>
                        ) : feedback.clue ? (
                          <blockquote>
                            <b>你出示了</b>
                            <p>{feedback.clue.name}</p>
                          </blockquote>
                        ) : null}
                        {feedback.decision.counter?.rebuttal ? (
                          <blockquote className="boss__opponent">
                            <b>{feedback.decision.counter.speaker || '对方回应'}</b>
                            <p>{feedback.decision.counter.rebuttal}</p>
                          </blockquote>
                        ) : null}
                        <p className="boss__explanation">
                          {feedback.decision.explanation || (
                            feedback.decision.status === 'miss'
                              ? '这条材料不能直接回应当前质疑。它仍留在线索板中，你可以换一个论证角度。'
                              : '这次出示没有改变当前论证。'
                          )}
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="boss__exchange-empty">
                    <span aria-hidden="true">↳</span>
                    <p>打开证据板，选择一份能够直接回应上方质疑的材料。</p>
                  </div>
                )}
              </section>
            </main>

            <aside className="boss__workbench" aria-label="公开论证状态">
              <div className="boss__section-head boss__section-head--compact">
                <p className="boss__step">论证状态</p>
                <h2>这不是“真相血条”</h2>
                <p>可信度表示你的论证是否站得住；暴露度表示越界或无关材料给了对方多少反击空间。</p>
              </div>
              <div className="boss__meters">
                <Meter label="可信度" value={bossRun.credibility} config={boss.credibility} tone="credibility" />
                <Meter label="暴露度" value={bossRun.exposure} config={boss.exposure} tone="exposure" />
              </div>
              <div className="boss__knowledge">
                <div>
                  <b>当前可证明</b>
                  <p>
                    {currentCleared
                      ? '本轮质疑已经获得证据支持。'
                      : heldResponses.length
                        ? `你持有 ${heldResponses.length} 份可直接回应本轮的材料。`
                        : '现有材料还不能稳定回应本轮质疑。'}
                  </p>
                </div>
                <div>
                  <b>仍然未知</b>
                  <p>
                    {currentCleared
                      ? bossRun.caseIndex + 1 < cases.length
                        ? `整条论证尚未闭合，还有 ${cases.length - bossRun.caseIndex - 1} 项质疑。`
                        : '最终结论仍要在公开记录中接受复核。'
                      : '未被物证直接支持的部分，暂时不能写成事实。'}
                  </p>
                </div>
              </div>

              {currentCleared ? (
                <button className="btn btn--primary boss__main-action" onClick={advance}>
                  {bossRun.caseIndex + 1 >= cases.length ? '完成论证' : '进入下一项质疑'}
                </button>
              ) : (
                <button className="btn btn--primary boss__main-action" onClick={() => setDrawerOpen(true)}>
                  打开证据板
                </button>
              )}
              <button className="btn btn--ghost boss__pause" onClick={() => backToDoor(true)}>
                暂时离开，保留进度
              </button>
            </aside>
          </div>
        ) : (
          <section className="boss__resolved" aria-labelledby="boss-resolved-title">
            <p className="boss__step">公开论证 · 已结束</p>
            <h2 id="boss-resolved-title">
              {bossRun.outcome === 'fold'
                ? '这次指认没有站住'
                : bossRun.outcome === 'egg'
                  ? '你发现了更大的问题'
                  : '证据链已经闭合'}
            </h2>
            <p>
              {bossRun.outcome === 'fold'
                ? boss.foldWrong
                : bossRun.outcome === 'egg'
                  ? boss.egg?.present
                  : '你的结论来自已经公开的证据，而不是热度、猜测或立场。'}
            </p>
            {destination ? (
              <button className="btn btn--primary" onClick={() => nav(destination)}>进入结果</button>
            ) : (
              <button className="btn btn--primary" onClick={() => backToDoor(true)}>返回门厅</button>
            )}
          </section>
        )}

        <p className="sr-only" role="status" aria-live="polite">
          {feedbackMeta ? `${feedbackMeta.label}。${feedback?.decision.explanation || ''}` : ''}
        </p>
      </div>

      {drawerOpen ? (
        <div className="boss__drawer-mask" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
          <div ref={dialogRef} className="boss__drawer" role="dialog" aria-modal="true" aria-labelledby="boss-drawer-title">
            <div className="boss__drawer-head">
              <div>
                <p className="boss__step">证据板</p>
                <h2 id="boss-drawer-title">选择一份回应材料</h2>
              </div>
              <button className="boss__drawer-close" onClick={closeDrawer} aria-label="关闭证据板">×</button>
            </div>
            <div className="boss__drawer-context">
              <b>当前质疑</b>
              <p>{currentCase?.claim || '选择与当前论证直接相关的材料。'}</p>
              <small>无关或越界的尝试不会永久消耗线索，可以重新选择。</small>
            </div>
            <div className="boss__drawer-list">
              {held.length ? held.map((clue) => {
                const used = bossRun.usedClues.includes(clue.id);
                return (
                  <button
                    key={clue.id}
                    className="boss__clue"
                    disabled={used}
                    onClick={() => presentEvidence(clue)}
                    aria-label={`${used ? '已用于论证：' : '出示证据：'}${clue.name}`}
                  >
                    <EvidenceDocument clue={clue} selected={false} />
                    <span>{used ? '已用于论证' : '出示这份证据'}</span>
                  </button>
                );
              }) : (
                <div className="boss__drawer-empty">
                  <b>证据板还是空的</b>
                  <p>暂时离开并继续搜证；回来后论证进度会保留。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
