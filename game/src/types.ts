// game.json 契约类型（与编译管线共享，严格遵守）
export type SceneType = 'novel' | 'chat' | 'choice' | 'ending' | 'encounter' | 'investigate' | 'boss';

export interface DialogueTopic {
  id: string; prompt: string; keywords: string[]; reply: string;
  grants?: string[]; requires?: Vars;
}
export interface InvestigationItem {
  id: string; title: string; keywords: string[]; text: string; clue: string;
  requires?: Vars; kind?: 'observation' | 'testimony' | 'record';
}
export interface InvestigationCheck {
  id: string; prompt: string; claim: string; answer: string[]; grants: string[]; candidates?: string[];
  success: string; failure: string;
}

export interface EncounterCondition { key: string; op: 'eq' | 'ne' | 'gte' | 'lte'; value: string | number }
export interface EncounterAction {
  id: string; text: string; hint: string; cost?: string; once?: boolean;
  requires?: EncounterCondition[];
  effects: Array<{ op: 'set' | 'add'; key: string; value: string | number }>;
  feedback: string;
}
export interface EncounterOutcome { id: string; when: EncounterCondition[]; next: string; text: string }
export interface Encounter {
  objective: string;
  resources: Array<{ key: string; label: string; min: number; max: number; unit?: string }>;
  actions: EncounterAction[];
  outcomes: EncounterOutcome[];
}
export interface StorySource {
  kind: string; workId: string; title: string; author: string;
  authorStatus?: 'not_provided';
  scope: 'excerpt'; adaptationNote: string; sourceUrl?: string;
}

export interface StoryMeta {
  id: string;
  title: string;
  author: string;
  tags: string[];
}

export interface Choice {
  id: string;
  text: string;
  next: string;
  set?: Record<string, string>;
  /** 条件门：vars 全部匹配时才可选；不满足时灰显锁定（剧本杀「指认证据门槛」） */
  requires?: Record<string, string>;
  /** requires 未满足时的锁定提示（如「还缺关键证据」），缺省由引擎兜底 */
  lockedHint?: string;
}

/** chat 场景可聊出的线索：玩家对话触及 when 描述的语义时，NPC 自然揭示并授予 */
export interface ClueDrop {
  /** 线索变量名（clue_ 前缀），如 clue_knife */
  id: string;
  /** 语义触发条件，如「玩家追问手术刀编号/来源时」 */
  when: string;
}

// ---------------------------------------------------------------- Boss 战
// 评论区对线：结构化指认 + 编译期反驳脚本 + 赞同数演出。判定全确定性（选中即判定），
// 运行时零自由文本解析（GDD §3.3）。
export interface BossSlot {
  /** 呈上这条线索时触发（玩家须已持有） */
  clue: string;
  /** 你的呈证台词（回怼语气） */
  present: string;
  /** NPC/反派反驳台词 */
  rebuttal: string;
  /** 反驳方显示名（缺省用场景默认） */
  speaker?: string;
  /** 有效呈证的赞同增量 */
  likes?: number;
}
export interface BossRound {
  id: string;
  /** 本轮引导语（系统/群众催促） */
  cue: string;
  /** 本轮有效线索 id 列表；呈上无效线索会被反驳且不推进 */
  accept: string[];
  slots: BossSlot[];
}
export interface BossSuspect {
  id: string;
  name: string;
  desc: string;
  correct: boolean;
}
export interface BossData {
  /** 问题页标题（知乎形态） */
  question: string;
  /** 开场系统简报（feed 顶部系统条目） */
  intro: string;
  /** 你的指控回答正文（回答卡内容） */
  answer: string;
  /** 轮回（二周目）差分开场 */
  introLoop?: string;
  /** 轮回标记变量名（折叠结局的「再来一次」选项负责置位） */
  loopVar?: string;
  suspects: BossSuspect[];
  /** 选错指控对象时的折叠文案 */
  foldWrong: string;
  rounds: BossRound[];
  /** 彩蛋：任何轮次呈上该线索 → 隐藏指控 → 彩蛋结局 */
  egg?: { clue: string; present: string; ending: string };
  endings: { truth: string; fold: string };
  baseLikes?: number;
  /** 群众氛围评论（闲置滚动） */
  crowdIdle?: string[];
  /** 有效呈证后的群众爆发评论 */
  crowdHits?: string[];
}

export interface Scene {
  id: string;
  type: SceneType;
  chapter?: string;
  /** 场景氛围图路径（绝对/相对 URL，空串则用渐变+噪点占位） */
  image?: string;
  /** markdown 叙事文本 */
  text?: string;
  objective?: string;
  continueLabel?: string;
  /** Facts already explicitly witnessed in this scene; never a hidden branch reward. */
  onEnter?: Vars;
  dialogue?: { topics: DialogueTopic[]; requiredClues?: string[]; leaveLabel?: string };
  investigation?: { objective: string; searchPlaceholder?: string; hints: string[];
    items: InvestigationItem[]; checks: InvestigationCheck[] };
  npc?: string;
  lore?: string[];
  choices?: Choice[];
  next?: string;
  /** chat 场景对话目标 */
  goal?: string;
  /** Legacy V1 semantic clue drops; encounter effects use deterministic rules. */
  clueDrops?: ClueDrop[];
  goto?: string;
  encounter?: Encounter;
  /** boss 场景数据（type==='boss' 时必填） */
  boss?: BossData;
  /** 评论区氛围评论（chat 场景楼层化展示用） */
  comments?: Array<{ name: string; text: string; likes?: number }>;
}

export interface NpcCard {
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
}

export interface Npc {
  id: string;
  name: string;
  card: NpcCard;
}

export interface LoreEntry {
  id: string;
  content: string;
}

export interface EndingMeta {
  id: string;
  title: string;
  tone?: string;
  /** 结局评级（复盘/海报展示；缺省由引擎按门控推断） */
  rating?: 'normal' | 'rare' | 'legend' | 'egg';
}

/** 线索元数据：编译期从 clue_* 变量派生，供引擎渲染线索簿 */
export interface ClueMeta {
  /** 变量名（clue_ 前缀），如 clue_knife */
  id: string;
  /** 展示名，如「手术刀的编号」 */
  name: string;
  /** 一句话说明（可选） */
  desc?: string;
  sourceLabel?: string;
  kind?: 'observation' | 'testimony' | 'inference';
}

export interface Kanshan {
  intro?: string;
  rescueLines?: string[];
}

export interface GameJson {
  version?: string;
  initialVars?: Vars;
  source?: StorySource;
  release?: { status: string };
  story: StoryMeta;
  start: string;
  scenes: Scene[];
  npcs?: Npc[];
  lore?: LoreEntry[];
  endings?: EndingMeta[];
  clues?: ClueMeta[];
  kanshan?: Kanshan;
}

// ---------------------------------------------------------------- 运行态类型
export interface ChatTurn {
  role: 'user' | 'assistant' | 'kanshan' | 'system';
  content: string;
  /** 由网关回传的目标达成标记（只对 assistant 有意义） */
  goal?: boolean;
  error?: boolean;
  mode?: 'ai' | 'scripted';
  clues?: string[];
  testimony?: { topicId: string; text: string; clues: string[] };
}

export type Vars = Record<string, string>;

export type MemoEntry =
  | { kind: 'choice'; sceneId: string; text: string }
  | { kind: 'action'; sceneId: string; actionId: string; text: string; feedback: string; changes: Array<{ key: string; label: string; before: string; after: string }> }
  | { kind: 'scene'; sceneId: string; chapter?: string };

export interface StorySummary {
  source?: StorySource;
  id: string;
  title: string;
  author: string;
  tags: string[];
  start: string | null;
  sceneCount: number;
  endingCount: number;
  intro?: string;
}

export interface SaveData {
  v: 1;
  storyVersion?: string;
  storyId: string;
  sceneId: string;
  vars: Vars;
  memo: MemoEntry[];
  /** 正在进行的 chat 场景最近窗口，刷新续玩用 */
  chat?: { sceneId: string; turns: ChatTurn[]; goalMet: boolean; failedStreak: number };
  chats?: Record<string, { sceneId: string; turns: ChatTurn[]; goalMet: boolean; failedStreak: number }>;
}

export interface Prefs {
  /** 逐字呈现为可选；默认直接阅读全文。 */
  typewriter?: boolean;
  /** 打字速度 0 慢 / 1 标准 / 2 快 */
  speed: 0 | 1 | 2;
  sfx: boolean;
  tick: boolean;
  /** 简化动画（减弱闪烁） */
  calm: boolean;
}
