# 看山任意门 · 素材提示词包 v1（GPT Image 专用）

> 用途：黑客松旗舰故事《蓝血》全场景配图 + 门厅通用素材。
> 用法：每条提示词是一个完整块，直接整块复制去 GPT Image 生图；生好按标题的文件名保存，
> 放进 `kanshan-v2/game/public/art/blue/`（门厅通用两张放 `game/public/art/`）。
> 游戏 json 里我会按这些路径提前接线；图没到位时自动回退渐变占位，不影响任何功能。

## 全局规则（每张都适用，已写进每条提示词）

- **尺寸**：场景图一律横版 1536×1024（或 1792×1024）；头像 1024×1024 方形
- **《蓝血》视觉母题**：**蓝世界里的红异常**——画面整体冷蓝/灰蓝调，永远只有一处克制的暗红点缀（这是故事核心意象：世界说血是蓝的，只有你的血是红的）
- **避开**：任何文字/字母/数字（GPT Image 最爱乱加字）、真实品牌 logo、血腥特写、正脸大特写（人物一律背影/侧脸/剪影/手部，防恐怖谷也保证多图一致性）
- 觉得某张翻车就单张重抽，文件名不变即可

---

## 一、《蓝血》场景图（16 张）

### 01 · `blue-cover.png` —— 门厅封面
> Cinematic semi-realistic digital illustration, a quiet city apartment window at night, distant skyscrapers in deep teal-blue haze, on the glass windowsill a single small glass vial glowing faint crimson-red, the only warm-red object in an entirely blue world, muted dark teal and warm grey palette, volumetric moonlight, subtle film grain, restrained composition with large negative space, moody suspense, no text, no letters, no watermark, no logos

### 02 · `blue-training-hall.png` —— 01 章·急救培训现场（n_start）
> Cinematic semi-realistic digital illustration, a corporate training room seen from the back row, a CPR mannequin and projector screen at the front, dozens of employees taking notes in unison under cool blue fluorescent light, one person in the middle raising their hand while every head turns toward them, a faint red marker pen lying on that person's desk as the single red accent, muted teal-blue and grey palette, volumetric light beams, film grain, faces turned away or blurred, suspenseful conformity, no text, no letters, no watermark, no logos

### 03 · `blue-textbook.png` —— 02 章·教材特写（invest_blood）
> Cinematic semi-realistic digital illustration, close-up of an open first-aid training manual on an office desk, the anatomical diagram on the page rendered in clinical blue ink showing blue-colored blood vessels, a person's hand hovering hesitantly above the page, a small red paper-cut bandage wrapper at the desk corner as the only red accent, cool desaturated blue-grey palette, soft desk lamp glow, shallow depth of field, film grain, no readable text, only abstract diagram lines, no letters, no watermark, no logos

### 04 · `blue-restroom.png` —— 02 章·洗手间（n_restroom）
> Cinematic semi-realistic digital illustration, an empty corporate restroom with cold blue-white LED panels, a row of mirrors and white sinks, one sink with a faint small crimson-red drop staining the porcelain edge, the only red in the sterile blue scene, a person's silhouette partially visible in the mirror edge, desaturated teal-grey palette, hard reflections, film grain, unsettling stillness, no text, no letters, no watermark, no logos

### 05 · `blue-pantry.png` —— 03 章·茶水间（chat_zhangwei）
> Cinematic semi-realistic digital illustration, a small office pantry corner, two ceramic mugs steaming on a counter, two women's silhouettes leaning close in hushed conversation seen from behind, cool blue window light mixed with a faint warm-red indicator light on the water dispenser as the single red accent, muted teal-grey palette, intimate tense atmosphere, volumetric steam, film grain, no text, no letters, no watermark, no logos

### 06 · `blue-office-night.png` —— 04 章·深夜的屏幕（n_night / invest_desktop）
> Cinematic semi-realistic digital illustration, a dark apartment room at 2 a.m., a person from behind sitting at a desk, faceless, lit only by a cold blue monitor glow showing the vague blurred layout of a generic Q&A forum page, a small red LED dot on the webcam as the single red accent, deep teal-blue palette with warm-grey shadows, volumetric screen light, film grain, lonely paranoid mood, no readable text, no letters, no watermark, no logos

### 07 · `blue-exam.png` —— 06 章·复考考场（invest_test）
> Cinematic semi-realistic digital illustration, an empty examination room after hours, rows of desks under cold blue light, in the foreground two exam papers lying side by side on one desk, their printed question layouts visibly different from each other but unreadable, a red pencil lying across one paper as the single red accent, desaturated teal-blue palette, long shadows, film grain, quiet conspiracy atmosphere, no readable text, no letters, no watermark, no logos

### 08 · `blue-trainer.png` —— 06 章·收卷的人（chat_trainer / n_handover）
> Cinematic semi-realistic digital illustration, a middle-aged instructor in a blue uniform shirt standing at a lectern collecting exam papers, seen from a low side angle, face in shadow, hands neatly stacking papers with deliberate slowness, a faint red stamp pad on the lectern as the single red accent, cold blue-grey institutional palette, volumetric side light, film grain, quietly menacing bureaucratic mood, no text, no letters, no watermark, no logos

### 09 · `blue-street-tail.png` —— 07 章·反复碰面的人（n_tail / invest_tail）
> Cinematic semi-realistic digital illustration, an early-evening city shopping street in teal-blue dusk, crowd shown as soft blurred silhouettes, in a shop window reflection a distant figure in a grey jacket standing still and facing the viewer's direction, a small red neon sign fragment far away as the single red accent, muted blue-grey palette, wet pavement reflections, film grain, surveillance paranoia mood, no readable text, no letters, no watermark, no logos

### 10 · `blue-alley.png` —— 08 章·死胡同（invest_alley）
> Cinematic semi-realistic digital illustration, a narrow dead-end alley at night, brick walls converging to a sealed end wall, a single cold street lamp, scattered trash bins, wet ground reflecting blue moonlight, a faint red plastic cord tied on a drainpipe as the single red accent, deep teal-black palette, heavy shadows, film grain, trapped feeling, no text, no letters, no watermark, no logos

### 11 · `blue-evidence-desk.png` —— 09 章·纸上的问题（invest_final）
> Cinematic semi-realistic digital illustration, top-down view of a desk at night covered with an investigation spread: two different exam papers, printed web pages with blurred layouts, a phone face down, sticky notes, a cold coffee, everything in desaturated blue lamplight, one red string with two pins connecting two papers as the single red accent, dark teal palette, film grain, detective wall mood, no readable text, no letters, no watermark, no logos

### 12 · `blue-boss-post.png` —— Boss 战·发帖前夜（boss 场景）
> Cinematic semi-realistic digital illustration, over-the-shoulder view of a person at a desk in a dark room, finger hovering above an Enter key, the monitor glow painting the room cold blue, on the blurred screen the vague outline of a long post being drafted, a small red "record" indicator dot glowing as the single red accent, deep teal-blue palette, tense volumetric light, film grain, point-of-no-return mood, no readable text, no letters, no watermark, no logos

### 13 · `blue-ending-hot.png` —— 真结局·热榜（e_true）
> Cinematic semi-realistic digital illustration, dawn light breaking through blinds onto a desk, a monitor glowing with the blurred impression of a post rising on a trending list with an upward arrow motif, the first warm sunlight mixing with the cold blue screen, a thin red sunrise line on the horizon outside the window as the red accent, hopeful but unresolved mood, teal-to-warm gradient palette, film grain, no readable text, no letters, no watermark, no logos

### 14 · `blue-ending-fold.png` —— 折叠结局（e_fold）
> Cinematic semi-realistic digital illustration, a dark room where a monitor's content appears to sink and collapse downward like a folded curtain, grey-blue fog swallowing the screen light, the room dimming, a dying red standby LED as the single fading red accent, heavy desaturated grey-teal palette, suffocating stillness, film grain, defeat but not despair, no readable text, no letters, no watermark, no logos

### 15 · `blue-ending-egg.png` —— 彩蛋结局·更大的问题（e_egg）
> Cinematic semi-realistic digital illustration, a surreal city skyline at dusk where several famous-looking landmark towers appear subtly duplicated or misplaced, their reflections in the river not matching the sky, a lone figure on a bridge looking up, one landmark window glowing red as the single red accent, uncanny teal-blue palette, vast negative space, film grain, reality-glitch atmosphere, no readable text, no letters, no watermark, no logos

### 16 · `blue-ending-quiet.png` —— 普通结局·留灯/蛰伏（e_lamp / e_hide 共用）
> Cinematic semi-realistic digital illustration, a small warm desk lamp left on in an otherwise blue-dark apartment, curtains drawn with a thin gap of cold street light, a phone face-up on the desk beside an unread notebook, the lampshade glowing faintly amber-red as the red accent, muted teal and warm grey palette, quiet self-protection mood, film grain, no text, no letters, no watermark, no logos

---

## 二、NPC 头像（3 张，1024×1024，P2 可后补）

### 17 · `avatar-zhangwei.png` —— 张薇（同事，可借力的人）
> Semi-realistic portrait illustration of a young Chinese office woman in her late twenties, gentle tired eyes, hair in a low ponytail, plain blouse, three-quarter view against a soft teal-blue blurred office background, one small red hair tie as the single red accent, muted cinematic palette, soft volumetric light, film grain, warm but guarded expression, no text, no watermark, no logos

### 18 · `avatar-trainer.png` —— 培训师（执行者，回避解释的人）
> Semi-realistic portrait illustration of a middle-aged Chinese male corporate instructor, neat uniform shirt, polite professional smile that doesn't reach his eyes, three-quarter view against a cold blue institutional background, a small red pen in his chest pocket as the single red accent, muted cinematic palette, film grain, bureaucratic calm, no text, no watermark, no logos

### 19 · `avatar-manager.png` —— 经理（消息灵通的旁观方）
> Semi-realistic portrait illustration of a Chinese female office manager in her thirties, composed posture, blazer, observant sideways glance, three-quarter view against a blurred teal office corridor, a small red brooch as the single red accent, muted cinematic palette, soft rim light, film grain, calculating neutrality, no text, no watermark, no logos

---

## 三、门厅通用（2 张，放 `game/public/art/`）

### 20 · `portal-hall.png` —— 门厅主背景
> Cinematic semi-realistic digital illustration, a vast dark hall filled with floating upright doorframes of different shapes, each door cracked open leaking different colored light, thin fog on the obsidian floor, far in the distance a tiny white fox silhouette sitting and watching, deep ink-teal palette with amber and blue glows, strong volumetric light, film grain, mysterious threshold atmosphere, no text, no letters, no watermark, no logos

### 21 · `clue-board-texture.png` —— 线索板底纹
> Semi-realistic texture illustration of a dark cork investigation board, nearly empty, only a few faint pinholes, one short piece of red string and two silver pins in a corner, soft blue desk light from the left, deep teal-brown palette, subtle film grain, minimal and clean for UI background use, no text, no letters, no watermark, no logos

---

## 接线对照（我来改，不用你管）

| 文件 | 接到哪里 |
|---|---|
| blue-cover | 门厅故事卡 + n_start |
| blue-training-hall | n_start / chat_manager 附近 |
| blue-textbook | invest_blood |
| blue-restroom | n_restroom |
| blue-pantry | chat_zhangwei |
| blue-office-night | n_night / invest_desktop |
| blue-exam | n_test / invest_test |
| blue-trainer | chat_trainer / n_handover |
| blue-street-tail | n_tail / invest_tail |
| blue-alley | n_alley / invest_alley |
| blue-evidence-desk | n_paper / invest_final |
| blue-boss-post | boss 场景背景 |
| blue-ending-hot / fold / egg / quiet | 对应结局场景 |
| avatar-* | NPC 卡头像（P2，代码我加支持） |
| portal-hall | 门厅背景 |
| clue-board-texture | 线索簿底纹 |

---

## 四、v2 实装清单（2026-09-14）

这份提示词包中的图不再只作为背景。实际接入遵循“场景负责空间、纸张负责证据、刘看山负责引导”的分工：

| 素材类别 | 实装位置 | 使用边界 |
|---|---|---|
| 场景图 | 阅读、聊天、调查、行动、公开论证、结局 | 作为固定比例前景画面；调查图不裁切，保证热点坐标可靠 |
| 洗手间与试卷图 | 《蓝血》调查 | 热点只标真实对应的水池/镜面、左/右试卷；没有精确坐标的记录统一从文本搜寻发现 |
| 透明纸张 | 首次发现、线索簿、论证证据板 | 只作纸张底板；名称、正文、来源都由可访问的 DOM 文本渲染，不能把模型生成的文字烘焙进图片 |
| `liu-kanshan-lobby-guide.jpg` | 门厅系统引导 | 刘看山是引路人，不是卡片角落的装饰 |
| `liu-kanshan-opening-door-transition-v2.png` | 门厅进入剧本的约 650ms 转场 | 只在真正入戏时播放；故事内部换幕不得反复开门 |
| 刘看山动图 | 引导与公开论证 | 按状态按需加载；低动态偏好下隐藏，不能批量预加载 |

### 新增转场图

- `game/public/art/portal/liu-kanshan-opening-door-transition-v2.png`
- 生成方式：GPT Image，以授权的刘看山三视图作为角色参考；用途是“刘看山推开任意门”的全屏转场，不含文字或品牌标识。
- 不覆盖旧版 `liu-kanshan-opening-door-transition.jpg`，以版本化文件便于回退和比较。

### 后续生图原则

1. 先补“玩家能操作或读懂”的缺口，再补纯气氛图。
2. 每张调查场景必须先确定其可交互对象、文字搜索别名与键盘替代路径，才能生成或替换画面。
3. 不要让图片承担任何关键文本、证据结论或可访问性信息。
4. 线上缓存对已用文件名可能是不可变的；替图一律使用新版本文件名，并显式更新引用。
