# Codex 独立验收 — R1 返工清单

2026-09-17。结论：**本轮不通过，继续返工；并非推倒重写。**

项目：/Users/xiejiachen/zhihu-hackathon-2026/kanshan-v2
基线：codex/initial-upload，HEAD ff5c4f1db32fe558d0a66b1bb2103a6ae76dc894，加本地 Kimi WIP。
权威范围：plans/ps1-creative-runtime-20260916/ENGINE-{ROADMAP,SYSTEMS,ACCEPTANCE}.md。
Codex 未改产品代码。测试在独立源文件副本 /tmp/kanshan-r1-audit-20260917.W8ISXV/repo 中运行，依赖 node_modules 软链复用；不把副本测试写回真实作品。无提交、推送、部署、真人/真机/外部模型验证。下面删除复现仅删除临时自建 sentinel，不涉及用户文件。

## 已复跑的正向证据

使用 /opt/homebrew/bin/node v25.9.0（默认登录 shell 的 node 是 v22.0.0，命令必须明确 Node >=24）。

| cwd（上述副本内） | 命令 | 结果 |
| --- | --- | --- |
| game-ps1 | npm run build | exit 0，tsc + Vite 通过 |
| game-ps1 | node --test --test-reporter=spec test/creative/*.test.ts | 首跑 518/519，1 个临时目录初始化失败；随后独立复跑 tools-loop 1/1，再整套 519/519 |
| packages/story-contract | npm test | 10/10 |
| studio | npm run build；npm test | 构建通过，3/3 |
| skills/story-to-ps1 | npm run check；npm run test:integration | 7/7 + 8/8 |
| repo root | npm test | 1/1 |
| repo root | node scripts/verify-ps1-studio.mjs --json | static-local-only，54 PASS |

未把 Kimi 的 B01 报告当作本轮重新观察画面的证据；本轮未重跑浏览器。没有新增覆盖率、审美分数或截图门禁。现有 Skill 的轻量视觉习惯符合用户要求，保留。

## 必须处理

### R01 / P1：导出会删除目标及邻接目录里的原有文件

证据：game-ps1/tools/lib/build-vite.mjs:61、83、96；build.mjs:96。
--out 任意路径被直接交给 emptyOutDir:true；临时目录固定为 outDir + '-boot'，finally 对它递归删除。

实际复现：临时 sentinel-output/keep.txt 和 sentinel-output-boot/keep.txt 预先存在；调用 exportBundle 后返回 ok:true，两个 keep.txt 均消失。原文件没有被安全拒绝或备份。

修复要求：构建先在独立 mkdtemp 目录完成，只清理自己创建的目录；对已有非空输出、安全路径/符号链接、输出位于源码内等情况明确拒绝或使用显式且安全的替换协议。失败不破坏旧产物，不自行增设默认强制覆盖。负例必须放临时测试目录，禁止以真实仓库/用户目录复现删除。

### R02 / P1：作者参数修好后，导出的游戏仍是旧参数

证据：build-vite.mjs:65–68 只调用 bootExperience(experience)；boot/browser-player.ts 没有加载 manifest.params 或 params.overrides.json；session-daemon.mjs:729 以后却单独应用 overlay。

实际复现：narrow-gate 默认构建与新增 {"gate.opening-width":1.3} 后构建均成功。
- 修改前 experienceDigest：ba6edd6a0bfb3802e90fc6de2df4d24ca00a28ccd08252831678c421fbf818bd
- 修改后 experienceDigest：2fd33619afebdca6da33be917684e399d14a43efcff762b543941892ca8c3786
- 两次 artifactDigest 完全相同：407446f59847f2f10eada0a43d2a95b8ade6ca9ab73920e54a3e00d30abaa855
- 两次只有同一个 assets/main-DwhYQvai.js；入口也没有运行时读取 overlay 的路径。

因此原工具闭环仅证明 headless 修复，不能代表最终作品修复。

修复要求：浏览器与 headless 共用参数初始化协议，明确 defaults/manifest/overlay 的优先级与校验；实例与 module 的 parameter registry 暴露方式保持一致。导出嵌入最终参数以及真实 experienceDigest/buildId，不能继续默认为 browser-session/browser。补“同一补丁影响真实导出实例的 collider/行为”回归，不仅比较包 hash。不要求人工截图。

### R03 / P1：作品身份漏掉入口和目录外依赖

证据：state/manifest.ts:229–262、298–306；core/identity.ts:52。
遍历作品目录内全部文件，identity inputs 不含 manifest.entry；实际 import 的目录外代码及 runtime 内容不在此闭包内。

实际复现：同一个 fixture 目录包含 src/a.ts 与 src/b.ts；entry 从 a 改为 b，并将 a 实际 import 的目录外依赖 version-one 改成 version-two，digest 仍为 fce5555c5895908aeb69dadae3be18efc7a6a0d68a7d33a0a5e68e0c2e4f6248，files 仅列 a、b。源码控制流也分别确认两项均未进入身份计算。

修复要求：基于实际入口及可解析依赖图、配置、参数、资产和明确的运行时版本/内容计算 canonical identity；排除无关日志/报告/绝对临时路径。分别测试入口切换、外部依赖变化、runtime/config 变化、无关报告变化、两干净目录一致。不能用 buildId 当存档身份。

### R04 / P1：含真实外部模型文件的标准资源构建失败

证据：build-vite.mjs:75 无相对子路径 base 配置；build-files.mjs 的 addRelativeRef / bundleClosure。

实际复现：作品中 new URL('./model.gltf', import.meta.url)，model.gltf 在源码存在且 Vite 已输出 assets/model-dOJOMEIn.gltf。构建却返回 BUILD_INCOMPLETE，missing 为 /assets/model-dOJOMEIn.gltf（前导斜杠），files 明明包含 assets/model-dOJOMEIn.gltf。

同一 glTF 引用源码中存在的 positions.bin，输出文件列表没有该 bin。当前 closure 仅扫描 html/js/css，不递归核验 glTF 外部 buffer/texture，这是源码确认的进一步缺口；不能只消除上述报错就当 GLTF 闭包已通过。

修复要求：真实资源的 base/URL 和子路径发布一致；模型外部 bin/纹理及必要解码器进入闭包；缺任何依赖明确失败。覆盖 new URL、GLTF 外部依赖和子路径静态包，不仅验证三个全部程序化资产的示例。

### R05 / P2：作品 CLI build 只转译，漏掉语义类型错误

证据：build-vite.mjs 只调用 Vite；game-ps1/tsconfig.json include 为 src/test，不保证覆盖新作品。

实际复现：新作品导出 const wrongType: number = 'SEMANTIC_TYPE_ERROR_FOR_AUDIT'。engine export 返回 ok:true；单独对该入口执行 tsc --noEmit --skipLibCheck --module esnext --moduleResolution bundler --target es2022 --allowImportingTsExtensions，exit 2，TS2322。

修复要求：作品作者验证链对实际入口和依赖运行类型检查；可放 build 前或强制 validate 阶段，但不能把仅转译称为类型验证完成。保留自由 TS，不为绕过类型错误改回固定模板。语法错误和语义类型错误各有负例。

### R06 / P1：G19 冻结后新作品证据不成立

证据：evidence/ps1-engine/r1/FREEZE.md:15–22 记录 holdout 通过后又修改 browser-player、session daemon、commands、工具隔离并重生成冻结 hash；RESULTS.md:63 却称第三作未改 core/systems/Skill/tools 任何一行、泛化验证通过。

ENGINE-ACCEPTANCE.md 第3节明确要求：改 core/systems/Skill/tools 后，重冻结并换一个新 brief，不能把原第三作原样通过当作新 holdout。

修复要求：先完成返工；保留历史，记录真实最终 freeze 时间和 hash；换一个未用于开发的新 brief，仅改作品代码/资产/参数/测试，完成公开输入及中途恢复到目标的验证。已有第三作保留为回归。若新 brief 仍要求改核心，报告真实能力缺口并依合同处理，不能重写旧时间线或重生成 hash 洗掉历史。当前 G19 不得标 PASS。

### R07 / P2：R1 最低功能被缩减，能力报告仍全 PASS

- S14/G14：tools/web/app.js:335 的 gizmoEditor 只有数值输入；RESULTS.md:102 将视口拖拽改名为 R2。路线图 R1 明列 transform gizmo。数值输入/吸附有用，但不是完整交付。
- G15.b：session-daemon.mjs:448 的 observe metrics 只有 tick、time、计数等，没有实际 CPU 阶段耗时；不能用 simulation time 冒充 CPU 计时。资源计数也需要与作用域分配/释放关联。
- 音频只实现 gain 衰减是报告已承认的范围限制；对照 S08 的空间位置/方向需求补最低可用能力或精确列未完成子项，不能用“听感未验证”遮盖实现缺失。

修复要求：补既定 R1 最低能力并给逻辑/工具证据；视口交互可用本地自动化或受控事件测试，不增设人工审美门禁。capabilities 按 feature 映射证据和限制，不用一个系统总 PASS 覆盖缺项。

### R08 / P2：测试依赖工作目录残留，且部分测试会写真实示例

证据：test/creative/tools-loop.test.ts:55 对未保证存在的 .kanshan 调 mkdtemp；首个隔离源副本运行结果为 518 pass / 1 fail，ENOENT loop-test-XXXXXX。其他测试创建目录后，独立 tools-loop 和整套均通过。

tools-web 等测试还在 experiences/noop-patch 写入/删除 params.overrides.json，因此本轮只在副本运行。

修复要求：每个测试拥有独立 mkdtemp 测试数据，自己创建所需父目录；不得依赖执行顺序或修改/删除用户示例的既有 overlay。从没有 .kanshan 的干净副本运行完整套件并验证作者文件 byte-for-byte 保留。

## 一并核对，但不要把未知写成已复现

1. browser-player 当前没有通用 checkpoint store/恢复注入，也没有整体 teardown 返回接口；测试里的 module factory({checkpoint}) 不等于导出页面刷新可恢复。按合同明确 SDK 恢复能力与最终 player 可操作恢复流程的区别，补应交付接入/测试，不声称本轮已执行浏览器丢档复现。
2. 新工具链可以独立于 legacy Studio，不要求强行合并 UI。但旧 audit 中的 public gate/路径安全否决仍应逐项说明保留与修复边界；“legacy”不是安全义务豁免，不能靠旧54个静态 PASS 消除旧代码缺陷。
3. artifactDigest 当前按文件内容直接串接，未框定逻辑路径和长度。建议改为 canonical 文件清单（路径、长度、内容 hash），明确 report.json 自引用排除规则并测试改名/分段歧义。

## 返工顺序与交付

先 R01 安全与 R08 测试隔离 → R02/R03/R04 导出及身份 → R05/R07 作者验证及能力缺项 → 完整集成 → 最后 R06 新 freeze/新 holdout。共享构建/身份接口由同一集成负责人协调，不能多方同时覆盖。

保留本报告不改，另写 RESPONSE.md，逐条给修改文件、实际命令、回归证据与未解决项；更新自己的 RESULTS/capabilities，不能删反例、缩小 R1 或加严视觉 Skill 来取得全绿。无 commit/push/deploy、无需真人/真机/provider/账号动作。发现超出当前授权的外部依赖，仅暂停相关项。

## 基线指纹（SHA-256）

- tools/lib/build-vite.mjs: e46c9a932961291555dc9473140a41d646c0b9edb8c787ebf4c899c8cd046dc7
- tools/lib/build.mjs: 8f277280bd813f75247b546e2b3bb7ab735c17eceba167d70b0eeb74496a19b4
- tools/lib/build-files.mjs: ebec320fb956c06438edf32bf001829c152c96b7dd6a6d55b7ab3c004e2a575f
- src/creative/state/manifest.ts: 6a7622c1f21ac1192e71038eb3bd1a93dc244b5338cbcb4fc83d7cd98a6d5611
- src/creative/boot/browser-player.ts: a9a919fcfe3bde0a9512074b811a279df1580198be9701645ad7a718e8e337d3
- r1/FREEZE.md: 10e0234c52bf00582782d5e7e415688e7fedd07ee0150c04928ed5f646579fe0
- r1/RESULTS.md: 67ea6006e31609a751a0b294c0e9404366a8fd5cc775796309f653f85b279011

临时复现文件：上述副本 game-ps1/codex-audit.mjs（phase one/two；当前 fixture 已在 phase two 状态）、codex-audit-gltf.mjs，experiences/codex-audit-*。它们是人工构造反例，不是交付作品。重跑删除反例只能重新创建独立临时 sentinel，禁止替换成真实用户目录。
