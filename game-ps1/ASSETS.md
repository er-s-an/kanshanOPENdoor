# ASSETS · 素材清单与版权说明

本游戏**零外部素材文件**：所有几何体代码程序化生成，所有音效 WebAudio 实时合成，UI 用系统字体栈。仓库内无任何 .glb / 贴图 / 音频 / 字体文件。

## 1. 文本素材（唯一的外部内容）

| 内容 | 来源 | 授权/边界 |
|---|---|---|
| 故事《近视眼勇闯恐怖游戏》正文与台词 | 知乎盐言故事，作者 **沈南因**；本项目管线缓存 `pipeline/stories/api/近视眼勇闯恐怖游戏-1747681485547843585.txt`（原文 2393 字，截断于第 113 行） | 仅用于知乎黑客松 2026 开发测试；不编造 113 行之后剧情；作者署名不可删 |

## 2. 程序化几何（运行时生成，无资产文件）

| 资产 | 生成位置 | 规模 |
|---|---|---|
| 30 层大平层（户型/墙体/地板/天花板/门窗） | `src/world/apartment.ts` + `src/world/kit.ts` | 全屋 ≈3,167 三角面 |
| 家具（沙发/茶几/CRT 电视柜/落地灯/小床/衣柜/洗手台柜/马桶/浴缸/吧台/大门/阳台玻璃/月亮楼影） | 同上 | 含在上述总量内 |
| 思思（血裙/白裙双形态、双马尾、血污脸/干净脸、被子） | `src/game/npcs.ts` | ≈812 三角面 |
| 大 Boss（高瘦黑影、颈环缝线、过长手臂） | 同上 | ≈568 三角面 |
| 血渍/血地板/玻璃碎裂演出 | world 锚点 userData（mesh/floorMat/panels） | — |

## 3. 程序化材质与贴图

无外部贴图文件。全部为 `MeshLambertMaterial` 调色板 + 程序 ShapeGeometry 血渍；墙皮与门扇使用 `src/world/kit.ts` 在运行时确定性生成的 32×32 / 16×16 `DataTexture`（nearest、repeat、无 mipmap），不加载也不落地任何图片。PS1 效果（低清渲染、顶点量化、仿放射纹理映射、雾、Bayer 抖动、暗角色散）由 `src/engine/renderer.ts` 渲染管线实时计算。

## 4. 合成音效（WebAudio，无音频文件）

`src/engine/audio.ts`：`doorCreak / step / sting / ui / squintOn / squintOff / thud / glass / kiss / bell` 十种，全部振荡器+噪声实时合成；心跳与环境嗡鸣由 `setFear` / `startAmbience` 驱动。无旋律 BGM。

## 5. UI 与字体

DOM 覆盖层（`src/game/hud.ts`）：惊悚值条/字幕/系统横幅/选项框/结局页。字体 = 系统衬线/等宽栈 + CSS 文字阴影，无字体文件。

## 6. 替换指引（赛后若接官方素材）

- 角色模型：替换 `createNPCs` 内几何构建为 glTF 加载即可，注意保持 `NPCController` 状态接口与 <8k 面预算。
- 场景图/封面：可放 `public/` 由 Vite 同源托管。
- 刘看山形象按黑客松规则使用官方素材替换 🦊 emoji。
