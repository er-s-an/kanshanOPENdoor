// 运行时常量：文案关键词 / 降级台词 / 打字机参数 / 存档键
import type { Prefs } from '../types';

export const STORAGE_SAVE = 'kanshan:save:v1';
// V2 makes paced story text the authored default. Keeping a new key prevents
// an untouched V1 `typewriter:false` value from silently masking the release.
export const STORAGE_PREFS = 'kanshan:prefs:v2';

export const TYPING_MS = [40, 22, 12] as const; // 慢 / 标准 / 快（每字符毫秒）

export const DEFAULT_PREFS: Prefs = { speed: 1, typewriter: true, sfx: false, tick: false, calm: false };

/** 玩家输入命中这些词 → 触发刘看山剧透拦截（内容安全闸） */
export const SPOILER_WORDS = [
  '结局', '剧透', '凶手', '最后怎么了', '后来呢', '是不是死了', '谁死了', '死了吗',
  '真相是什么', '告诉我结局', '后面发生了什么', '结局是什么', '我会不会死',
];

export const FOX = '🦊';
export const FOX_NAME = '刘看山';

/** 降级时刘看山/旁白的“时空信号中断”文案（游戏内占位，继续可玩） */
export const DEGRADE_COPY = {
  title: '时空信号中断',
  offline: '信号断了——门后那头只剩下沙沙的电流声。别担心，故事不会停在这里。',
  foxIntro: '（一只白狐狸从你们中间的门缝探出半个脑袋）我是刘看山，这片盐言世界的引路人。传讯塔刚才被雾咬了一口，我帮你把线牵回来。',
};

/** 剧透拦截台词（与 rescueLines 同风格，但专用于内容安全闸） */
export const SPOILER_LINES = [
  '（刘看山一爪子按住了话头）嘘——结局是要你自己走到才算数的，我可不能让你提前翻到最后一页。',
  '（白狐狸竖起耳朵，表情严肃）再问下去，这个故事就要从内部塌方了。我们换个方向走吧？',
  '（刘看山用尾巴卷起一缕雾，把即将出口的答案又堵了回去）剧透是最重的一种罪，我是来救你的，不是来剧透的。',
];

/** chat 场景对白连续 4 轮无进展时的救场台词（轮换） */
export const WANDER_LINES = [
  '（刘看山从雾里踱出来，爪子在船板上敲了敲）你们聊到岔路上去了。主线在那边，我帮你们把话题拉回正轨？',
  '（白狐狸打了个哈欠，甩了甩尾巴）这么绕下去，天都要亮了。要不我们先回主线，把该问的问清楚？',
  '（刘看山蹲在你们中间，耳朵转了转）我听到故事在催更了。这段先记着，我们先把正事办了。',
];

/** 降级 / 救场时给玩家的 3 个“回归主线”选项 */
export const RESCUE_OPTIONS = {
  refocus: '回到正题，继续聊',
  hint: '刘看山，主线提示是什么？',
  advance: '跳过这段，推进剧情',
};

/** 章节 → 顶栏进度（0~1）。按章节首次出现序排，当前章节占中位偏进。 */
export function chapterProgress(scenes: { id: string; chapter?: string }[], currentId: string): number {
  const order: string[] = [];
  for (const s of scenes) {
    if (s.chapter && !order.includes(s.chapter)) order.push(s.chapter);
  }
  const cur = scenes.find((s) => s.id === currentId);
  if (!cur?.chapter || order.length === 0) return 0;
  const idx = order.indexOf(cur.chapter);
  return order.length === 1 ? 0.45 : (idx + 0.6) / order.length;
}
