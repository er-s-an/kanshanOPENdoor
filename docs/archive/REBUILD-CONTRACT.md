# 本次重做共享契约（实现约定）

所有修改在 `/Users/xiejiachen/Documents/ChatGPT/rebuild/kanshan-rebuild-20260913`；实际项目最后做 hash guard 合并。

保留 V1 的 novel/chat/choice/ending 与 encounter。新加 `investigate`，通过下列可选字段扩展，不要求旧故事重编译。

```ts
interface DialogueTopic {
  id: string; prompt: string; keywords: string[]; reply: string;
  grants?: string[]; requires?: Record<string,string>;
}
interface InvestigationItem {
  id: string; title: string; keywords: string[]; text: string; clue: string;
  requires?: Record<string,string>; kind?: 'observation'|'testimony'|'record';
}
interface InvestigationCheck {
  id: string; prompt: string; claim: string;
  answer: string[]; grants: string[]; success: string; failure: string;
}
// Scene optional fields:
dialogue?: { topics: DialogueTopic[]; requiredClues?: string[]; leaveLabel?: string };
investigation?: { objective: string; searchPlaceholder?: string; hints: string[];
  items: InvestigationItem[]; checks: InvestigationCheck[] };
// ClueMeta optional: desc, sourceLabel, kind ('observation'|'testimony'|'inference')
// Scene optional: objective, continueLabel
```

Engine 增加 inspect(itemId), verify(checkId,evidenceIds):boolean；由 root 完成 types/rules/engine。
线索一律 `vars[id] === 'found'`，核验结论也进入线索簿但标为 inference。
调查界面读 story/scene/vars，通过 inspect/verify 调用内核；调查出口使用 ChoiceDeck，next/goto 保持兼容。

Chat body 新增 topicId?，已存在 cluesFound。网关只从本场景预编译 topics 选择能够授权的事实，不接受客户端自定义 grants。点击主题传 topicId；自由输入与 keywords 匹配可激活同一主题。requires 只含 clue_* 并根据已知线索检查。返回 done.clues、mode('ai'|'scripted')、testimony?（规范证言）。AI 对话不能生成额外线索；未匹配主题继续自由扮演。主题固定回复作为无密钥/上游故障回退，标为预写对白；不把故障当成完成目标。客户端只接收本场景 topics 中注册的 clue 授予；requiredClues 控制目标显示，但允许返回 hub 继续探索。自由输入不拦截“真相/凶手/证据”等游戏内词。

NPC 仅知道当前 scene/lore，不能知道全篇结局。事实证言与玩家推断分开。作者姓名以 raw API author_name 为准。

故事构建：蓝血/近视眼使用原官方 story.id，不用 playable-*；两个极短样例移出默认目录（release.status='lab'），西游保留完整旧版入口。完整指覆盖 API 开放片段并有阶段选择与后果，不虚构全书终局。
