import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAction, applyChoice, completedOutcome, inspectItem, verifyEvidence } from '../src/lib/rules.mjs';
import { ask, knownClues, walkStory } from './journey-walk.mjs';

const packages = [
  ['蓝血', '蓝血-2025684191967294692.json', ['e_web', 'e_hide', 'e_lamp']],
];

for (const [label, filename, expectedEndings] of packages) {
  const story = JSON.parse(readFileSync(new URL(`../stories/${filename}`, import.meta.url), 'utf8'));
  // Cache the real walkthrough across assertions; no fixture replaces production content.
  let walkthrough;
  const journey = () => (walkthrough ||= walkStory(story));
  const sceneOf = (id) => story.scenes.find((scene) => scene.id === id);
  const completedRuns = () => journey().states.filter((run) => sceneOf(run.sceneId).type === 'ending');

  test(`${label}: rebuilt official package retains a complete multi-chapter route to all three results`, () => {
    assert.match(story.version || '', /^2\.2(?:\b|[.-])/, 'This suite must run against the rebuilt 2.2 story');
    assert.equal(story.release?.status, 'preview');
    assert.equal(story.source?.kind, 'zhihu-hackathon');
    assert.equal(story.endings.length, 3);
    const expected = expectedEndings || story.endings.map((ending) => ending.id);
    assert.deepEqual([...journey().endings.keys()].sort(), [...expected].sort());
    const visited = new Set(journey().states.map((run) => run.sceneId));
    assert.deepEqual(story.scenes.filter((scene) => !visited.has(scene.id)).map((scene) => scene.id), [], 'A chapter or branch is unreachable');
    for (const [endingId, run] of journey().endings) {
      const { path } = run;
      assert.ok(path.length >= 12, `${endingId} shortcuts the chapter in only ${path.length} scenes: ${path.join(' → ')}`);
      const scenes = path.map(sceneOf);
      assert.ok(scenes.filter((scene) => scene.type === 'chat').length >= 3, `${endingId} bypasses NPC encounters`);
      assert.ok(scenes.filter((scene) => scene.type === 'investigate').length >= 3, `${endingId} bypasses investigation chapters`);
      assert.ok(scenes.some((scene) => scene.investigation?.checks.length), `${endingId} bypasses the evidence review`);
    }
  });

  test(`${label}: real conversations, observations and verification can supply every key clue`, () => {
    const declared = story.clues.map((clue) => clue.id);
    assert.ok(declared.length >= 6, 'A chapter needs more than the former two-button sample');
    const complete = completedRuns().find((run) => declared.every((id) => run.vars[id] === 'found'));
    assert.ok(complete, `No complete run collects: ${declared.join(', ')}`);
    for (const kind of ['talk', 'inspect', 'verify']) {
      const events = complete.events.filter((event) => event.kind === kind);
      assert.ok(events.length, `No ${kind} operation changed the actual chapter state`);
      for (const event of events) {
        assert.ok(knownClues(event.after).length > knownClues(event.before).length, `${event.sceneId}/${event.id} did not add knowledge`);
      }
    }
    const spokenTo = new Set(complete.events.filter((event) => event.kind === 'talk').map((event) => sceneOf(event.sceneId).npc));
    assert.ok(spokenTo.size >= 3, `Only ${spokenTo.size} NPCs supplied actual testimony`);
  });

  test(`${label}: missing a required fact keeps the final inference locked; restoring it unlocks the same choice`, () => {
    let tested = 0;
    for (const run of journey().states) {
      for (const choice of sceneOf(run.sceneId).choices || []) {
        if (sceneOf(choice.next)?.type !== 'ending' || !Object.keys(choice.requires || {}).length) continue;
        if (!applyChoice(story, run.sceneId, choice.id, run.vars)) continue;
        for (const key of Object.keys(choice.requires)) {
          const missing = { ...run.vars };
          delete missing[key];
          assert.equal(applyChoice(story, run.sceneId, choice.id, missing), null, `${choice.id} opens without ${key}`);
          assert.ok(applyChoice(story, run.sceneId, choice.id, run.vars));
          tested += 1;
        }
      }
    }
    assert.ok(tested > 0, 'The final judgment has no reachable evidence gate');
  });

  test(`${label}: a failed search or a wrong available evidence combination does not consume the chance to investigate`, () => {
    const events = completedRuns().flatMap((run) => run.events);
    const inspection = events.find((event) => event.kind === 'inspect');
    assert.ok(inspection);
    const snapshot = structuredClone(inspection.before);
    assert.equal(inspectItem(story, inspection.sceneId, 'a-place-that-does-not-exist', snapshot), null);
    assert.deepEqual(snapshot, inspection.before);
    assert.ok(inspectItem(story, inspection.sceneId, inspection.id, snapshot));

    const verification = events.find((event) => event.kind === 'verify'
      && knownClues(event.before).some((id) => event.result.check.answer.length !== 1 || event.result.check.answer[0] !== id));
    assert.ok(verification, 'A reachable check must allow trying a wrong known piece of evidence');
    const { check } = verification.result;
    const wrongId = knownClues(verification.before).find((id) => check.answer.length !== 1 || check.answer[0] !== id);
    const beforeAttempt = structuredClone(verification.before);
    const wrong = verifyEvidence(story, verification.sceneId, check.id, [wrongId], verification.before);
    assert.equal(wrong?.correct, false);
    assert.ok(wrong.check.failure.trim(), 'Wrong evidence needs useful authored feedback');
    assert.deepEqual(wrong.vars, beforeAttempt, 'A mistake must not spend or poison the evidence state');
    assert.deepEqual(verification.before, beforeAttempt, 'A mistake must not mutate the saved player state');
    const corrected = verifyEvidence(story, verification.sceneId, check.id, check.answer, wrong.vars);
    assert.equal(corrected?.correct, true);
    for (const id of check.grants) assert.equal(corrected.vars[id], 'found');
  });

  test(`${label}: choosing another NPC topic or observation changes which facts the player actually knows`, () => {
    const events = completedRuns().flatMap((run) => run.events);
    const talk = events.find((event) => event.kind === 'talk' && sceneOf(event.sceneId).dialogue.topics.some((topic) => {
      const alternative = ask(story, sceneOf(event.sceneId), event.before, { topicId: topic.id });
      return topic.id !== event.id && alternative.testimony && alternative.clues.join('|') !== event.result.clues.join('|');
    }));
    assert.ok(talk, 'No real NPC offers valid lines of inquiry with different effects on known facts');
    const scene = sceneOf(talk.sceneId);
    const alternative = scene.dialogue.topics.map((topic) => ask(story, scene, talk.before, { topicId: topic.id }))
      .find((result) => result.testimony && result.clues.join('|') !== talk.result.clues.join('|'));
    assert.notDeepEqual(alternative.vars, talk.after);
    const topic = scene.dialogue.topics.find((entry) => entry.id === talk.id);
    assert.ok(topic.keywords.length, 'Compiled topic needs a free-input route');
    const typed = ask(story, scene, talk.before, { text: topic.keywords[0] });
    assert.deepEqual(typed.clues, talk.result.clues, `${topic.id}: free text and the corresponding topic should reveal the same fact`);
    const unrelated = ask(story, scene, talk.before, { text: 'zz-unmatched-player-input-84912' });
    assert.deepEqual(unrelated.vars, talk.before, 'Unrelated free chat manufactured a clue');

    const observation = events.find((event) => event.kind === 'inspect' && sceneOf(event.sceneId).investigation.items.some((item) => {
      const other = inspectItem(story, event.sceneId, item.id, event.before);
      return other && item.clue !== event.result.item.clue && event.before[item.clue] !== 'found';
    }));
    assert.ok(observation, 'No investigation room offers distinct usable observations');
    const other = sceneOf(observation.sceneId).investigation.items
      .map((item) => inspectItem(story, observation.sceneId, item.id, observation.before))
      .find((result) => result && result.item.clue !== observation.result.item.clue && observation.before[result.item.clue] !== 'found');
    assert.notDeepEqual(other.vars, observation.after);
  });
}

// This chapter is about perception and care. Its three responses share a closing
// page; neither a murder verdict nor a mandatory evidence-combination puzzle fits it.
const myopic = JSON.parse(readFileSync(new URL('../stories/近视眼勇闯恐怖游戏-1747681485547843585.json', import.meta.url), 'utf8'));
let myopicWalk;
const myopicJourney = () => (myopicWalk ||= walkStory(myopic));
const myopicScene = (id) => myopic.scenes.find((scene) => scene.id === id);
const myopicState = (id) => {
  const state = myopicJourney().states.find((entry) => entry.sceneId === id);
  assert.ok(state, `The real journey cannot reach ${id}`);
  return state;
};

test('近视眼: the full day includes care, messages, housework and three distinct family responses', () => {
  assert.match(myopic.version || '', /^2\.2(?:\b|[.-])/);
  assert.equal(myopic.source?.kind, 'zhihu-hackathon');
  assert.equal(myopic.release?.status, 'preview');
  const runs = myopicJourney().states.filter((run) => myopicScene(run.sceneId).type === 'ending');
  assert.ok(runs.length, 'The player cannot finish the first day');
  assert.deepEqual([...new Set(runs.map((run) => run.vars.my_final_stance))].sort(), ['calm', 'distance', 'protect']);
  const visited = new Set(myopicJourney().states.map((run) => run.sceneId));
  assert.deepEqual(myopic.scenes.filter((scene) => !visited.has(scene.id)).map((scene) => scene.id), []);
  for (const run of runs) {
    assert.ok(run.path.length >= 12, 'The story finishes before a full chapter is experienced');
    const scenes = run.path.map(myopicScene);
    assert.ok(new Set(scenes.filter((scene) => scene.type === 'chat').map((scene) => scene.npc)).size >= 3);
    assert.ok(scenes.filter((scene) => scene.type === 'investigate').length >= 3);
    for (const id of ['m09_care', 'm10_sisi', 'm12_broadcast', 'm13_phone', 'm14_clean', 'm18_man', 'm20_choice']) {
      assert.ok(run.path.includes(id), `A result bypasses ${id}`);
    }
    const responseScene = { protect: 'm21_stand', calm: 'm22_soften', distance: 'm23_stepback' }[run.vars.my_final_stance];
    assert.ok(run.path.includes(responseScene), 'The chosen stance has no intervening narrative consequence');
  }
  assert.ok(runs.some((run) => myopic.clues.every((clue) => run.vars[clue.id] === 'found')), 'A complete day leaves authored experiences unobtainable');
});

test('近视眼: care is completed by ordered dialogue; a premature request does not skip or poison the sequence', () => {
  const room = myopicState('m09_care');
  const entered = applyChoice(myopic, room.sceneId, 'care_talk', room.vars);
  assert.equal(entered?.sceneId, 'm10_sisi');
  const scene = myopicScene(entered.sceneId);
  let vars = entered.vars;
  const early = ask(myopic, scene, vars, { topicId: 'sisi_nap' });
  assert.deepEqual(early.vars, vars);
  assert.equal(early.goalAchieved, false);
  assert.equal(applyChoice(myopic, scene.id, 'sisi_leave', vars), null);
  const sequence = [
    ['sisi_dress', ['clue_my_dry', 'clue_my_release']],
    ['sisi_face', ['clue_my_face']],
    ['sisi_family', ['clue_my_mom']],
    ['sisi_nap', ['clue_my_sleep']],
  ];
  for (let index = 0; index < sequence.length; index += 1) {
    const [topicId, expected] = sequence[index];
    const result = ask(myopic, scene, vars, { topicId });
    assert.deepEqual([...result.clues].sort(), [...expected].sort());
    assert.ok(result.testimony?.text.trim());
    assert.equal(result.goalAchieved, index === sequence.length - 1);
    vars = result.vars;
    if (index < sequence.length - 1) assert.equal(applyChoice(myopic, scene.id, 'sisi_leave', vars), null);
  }
  assert.equal(applyChoice(myopic, scene.id, 'sisi_leave', vars)?.sceneId, 'm11_mother');
});

test('近视眼: both housework orders work, resting preserves progress and one finished chore cannot end the day', () => {
  const phone = myopicState('m13_phone');
  const entered = applyChoice(myopic, phone.sceneId, 'phone_leave', phone.vars);
  assert.equal(entered?.sceneId, 'm14_clean');
  const scene = myopicScene(entered.sceneId);
  for (const order of [['mop_floor', 'clean_wall'], ['clean_wall', 'mop_floor']]) {
    const first = applyAction(scene, order[0], entered.vars);
    assert.ok(first, `${order[0]} must be usable on first entering the room`);
    assert.equal(completedOutcome(scene, first.vars), null);
    assert.equal(applyAction(scene, order[0], first.vars), null, 'A completed chore should not be repeatable');
    const rested = applyAction(scene, 'housework_pause', first.vars);
    assert.ok(rested, 'Resting should be available between chores');
    assert.equal(completedOutcome(scene, rested.vars), null, 'Rest must not silently terminate the chapter');
    for (const clue of knownClues(first.vars)) assert.equal(rested.vars[clue], 'found');
    const second = applyAction(scene, order[1], rested.vars);
    assert.ok(second, `Resting permanently locked ${order[1]}`);
    assert.equal(second.vars.clue_my_floorwhite, 'found');
    assert.equal(second.vars.clue_my_wallclean, 'found');
    assert.equal(completedOutcome(scene, second.vars)?.next, 'm15_nap');
  }
});

test('近视眼: players must bring the phone close before reading reports, which stay separate from system observation', () => {
  const broadcast = myopicState('m12_broadcast');
  assert.equal(broadcast.vars.clue_my_survivors, 'found');
  for (const id of ['clue_my_floor3', 'clue_my_floor10', 'clue_my_groupfear']) assert.notEqual(broadcast.vars[id], 'found');
  const scene = myopicScene('m13_phone');
  assert.equal(inspectItem(myopic, scene.id, 'phone_floor3', broadcast.vars), null);
  const focused = inspectItem(myopic, scene.id, 'phone_focus', broadcast.vars);
  assert.equal(focused?.vars.clue_my_phone, 'found');
  let vars = focused.vars;
  for (const id of ['phone_floor3', 'phone_floor10', 'phone_fear']) {
    const result = inspectItem(myopic, scene.id, id, vars);
    assert.ok(result, `${id} remains inaccessible after moving the phone`);
    assert.equal(result.item.kind, 'testimony', 'A group report must not become a firsthand observation');
    vars = result.vars;
  }
  assert.equal(applyChoice(myopic, scene.id, 'phone_leave', vars)?.sceneId, 'm14_clean');
});

test('近视眼: different questions and senses add different knowledge; an unknown inspection remains recoverable', () => {
  const first = myopicJourney().states.flatMap((run) => run.events).find((event) => event.kind === 'talk' && event.sceneId === 'm02_hong');
  assert.ok(first);
  const scene = myopicScene('m02_hong');
  const revival = ask(myopic, scene, first.before, { topicId: 'hong_revival' });
  const thrill = ask(myopic, scene, first.before, { text: '惊悚值' });
  assert.deepEqual(revival.clues, ['clue_my_revival']);
  assert.deepEqual(thrill.clues, ['clue_my_thrill']);
  assert.notDeepEqual(revival.vars, thrill.vars);

  const hallEvent = myopicJourney().states.flatMap((run) => run.events).find((event) => event.kind === 'inspect' && event.sceneId === 'm04_hall');
  assert.ok(hallEvent);
  const before = structuredClone(hallEvent.before);
  assert.equal(inspectItem(myopic, 'm04_hall', 'imagined-hidden-screen', before), null);
  assert.deepEqual(before, hallEvent.before);
  const air = inspectItem(myopic, 'm04_hall', 'hall_air', before);
  const view = inspectItem(myopic, 'm04_hall', 'hall_view', before);
  assert.equal(air?.vars.clue_my_air, 'found');
  assert.equal(view?.vars.clue_my_view, 'found');
  assert.notDeepEqual(air.vars, view.vars);
});
