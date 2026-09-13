# 知乎社交 API 事实边界与异步互助路线

核对日期：2026-09-13  
依据：`hackathon-oauth.md`、`hackathon-user-profile-api.md`、`user-api.md`、`oauth.md` 及其 HTTP 契约。  
范围：只做文档核实；没有发网络业务请求、读取凭证或修改代码。

## 结论

“死亡搁浅式”异步互助可以先做陌生人帮助：玩家提交一个脱敏的行动结果/提示，后来的玩家在同一故事节点看到可选帮助，并记录帮助来源和版本。

知乎关系优先分发可以作为第二阶段 OAuth 能力，但当前文档不足以支持“直接读取任意好友/粉丝”或“官方好友关系”这类承诺。已知用户关注接口只明确提供某个用户的 `followees`（关注的人），没有 followers、互关、好友或关系查询端点。

## 事实边界表

| 问题 | 当前资料能确认的事实 | 不能据此声称 |
|---|---|---|
| Access Secret 代表谁 | 代表 Access Secret 所属知乎账号；CLI 只使用这一身份（`hackathon-oauth.md`、`user-api.md` 身份模型） | 用开发者的一把 Secret 读取每个玩家的关系 |
| Access Secret 能读什么关系 | `GET https://developer.zhihu.com/api/v1/user/followees`，读取该账号公开范围内的关注用户列表 | followers、好友、互关列表 |
| followee 字段 | `Fullname`、`UrlToken`、`Url`、`AvatarUrl`、`Headline`、`Gender`、`FollowerCount`（`user-api.md` 用户关注） | 关注时间、对方是否关注当前账号、私密关系、游戏账号 ID |
| OAuth 用户能读什么关系 | 应用后端仍需 Access Secret，并在同一请求加入该用户 OAuth token（`X-OAuth-Token`）和时间戳；返回被授权用户公开范围的 followees | 仅凭 OAuth 登录就读关注；无用户授权时代表该用户调用 |
| OAuth 基础身份 | `GET https://openapi.zhihu.com/user` 使用 OAuth Bearer token，返回 `uid`、`hash_id`、`fullname`、`avatar_path`、`url` 等（`hackathon-user-profile-api.md`） | 把示例字段当成全部必返；把 email/phone 当作关系标识 |
| followers 是否可读 | 在当前指定资料中没有 followers 接口 | 存在可直接调用的粉丝列表 |
| 好友/互关是否可读 | 在当前指定资料中没有 friend、mutual、relationship 接口或互关字段 | 能用一个 API 得到“好友”或确认双向关注 |
| openid 映射 | 当前 OAuth token 响应资料只有 `access_token`、`token_type`、`expires_in`；没有 openid。用户基础信息提供 `uid`/`hash_id` | 假设 OAuth 返回 openid，或以昵称映射账号 |
| Access Secret + OAuth | 两者职责不同：Secret 鉴权应用调用，OAuth token 指定被代表用户；关注接口两者都需要 | 用 Access Secret 伪装成任意游戏玩家 |

## 两类身份的准确路线

### 1. 只用当前 Access Secret

可以读取 Secret 所属账号的公开关注列表：

```text
GET https://developer.zhihu.com/api/v1/user/followees
Authorization: Bearer <access_secret>
X-Request-Timestamp: <unix seconds>
```

列表项可保存 `Fullname`、`UrlToken`、`Url`、头像、签名和粉丝数。它适合开发者自己的数据检查或静态策划样本，不代表每个游戏玩家。

### 2. 读取某位已授权玩家

玩家先走 Authorization Code Flow：应用使用赛事分配的 `app_id/app_key` 换取 OAuth access token；后端通过 `GET /user` 得到该玩家的 `uid`/`hash_id`/昵称等基础身份，再建立应用自己的 `gameAccountId ↔ zhihuHashId/uid` 会话映射。

读取这位玩家关注的人时，后端发：

```text
GET https://developer.zhihu.com/api/v1/user/followees?Offset=0&Limit=20
Authorization: Bearer <access_secret>
X-OAuth-Token: <oauth_access_token>
X-Request-Timestamp: <unix seconds>
```

分页按 `Paging.IsEnd` 与 `Paging.NextOffset` 处理。OAuth token 留在服务端；玩家退出、过期或鉴权失败时停止访问，不能静默切换回 Secret 所属账号。

### 3. 关注人如何映射到本游戏账号

最小可行映射是：玩家登录后，用 `/user` 返回的 `uid` 或 `hash_id` 建立自己的游戏账号；其 followees 列表暂存 `UrlToken`/主页 URL；只有当另一位玩家也登录并完成应用映射，且双方标识能在同一字段体系中匹配，才可标记为“可能的知乎关注人”。

当前资料存在字段缺口：`/user` 给出 `uid`、`hash_id`，followee 项给出 `UrlToken`，没有明确的 followee `uid`/`hash_id` 或用户详情换算端点。因此不能直接保证 `UrlToken` 一定能与本地 `uid/hash_id` 无损匹配。应先向官方确认标识语义，或只在应用内使用用户主动提供/已验证的映射。

## 不应采用的假设

- 不假设开发应用持有的 Access Secret 可以遍历所有参赛玩家的关注关系。
- 不假设 `/followees` 可以通过参数改成任意用户、followers 或好友列表；资料只定义“当前调用身份”的关注列表。
- 不用昵称、头像或主页显示名判断好友；昵称可重复或变化。
- 不把“对方出现在我的 followees”写成互关；当前响应没有对方是否关注我的字段。
- 不把 OAuth 登录成功写成已取得关注权限；关注接口要求 OAuth token 与 Access Secret 双凭证。
- 不把历史协议实测中的缺失 `state`、无 refresh token 等问题隐去；正式接入仍需按黑客松 OAuth 资料和平台当前行为验证。

## 社交 MVP 技术路线

### M0：先跑陌生人异步帮助

1. 在现有故事节点/公共 action-state 结果上增加 `helpArtifact`：故事 ID、规则版本、节点 ID、行动摘要、可见提示、创建时间和脱敏帮助者标签。
2. 帮助内容必须来自已完成行动或人工审核模板；不把 LLM 自由生成的“我已经替你完成”当作硬状态。
3. 当前玩家只接收与自己节点、规则版本兼容的帮助；展示“陌生玩家帮助”或匿名标签，不伪造知乎好友。
4. 记录帮助被采用/跳过以及结果，支持撤回、过期和版本淘汰；先用内存/受控存储做单机 Demo，明确多实例限制。
5. 先验证一个主循环：玩家 A 完成行动并留下帮助，玩家 B 在相同节点看见并采用，B 的本局状态按本地规则变化。

### M1：OAuth 登录只做身份绑定

1. 增加服务端 OAuth 回调、不可预测 `state`、短期会话和 HttpOnly/Secure Cookie。
2. `/user` 成功后保存 `gameAccountId ↔ uid/hash_id`；不把 OAuth token 放浏览器、URL、日志或前端响应。
3. 先只展示“已绑定知乎账号”，不承诺社交关系功能已开通。

### M2：关系优先级作为可选排序信号

1. 在官方确认标识字段可映射后，按每位已授权玩家自己的 followees 列表建立关系候选。
2. 帮助分发顺序为：同节点同版本的陌生人帮助先保证可用；若关系映射已验证，再将“已确认关注关系”作为排序加权。
3. 关系不可读、未授权、token 过期或标识无法匹配时，回退陌生人帮助并显示普通提示，不猜测好友。
4. 不实现 followers、互关或好友筛选，除非官方新增并确认对应端点与字段。

## 验收与对外表述

`Implemented` 只能写当前本地异步帮助闭环已经实际跑通的部分。OAuth、真实关注读取、标识映射和公网多用户协作在没有端到端验证前标为 `NOT_RUN`。

3 分钟演示优先展示陌生人帮助：同一故事节点、两个玩家行动、帮助被后续玩家采用、规则状态产生可见后果。若展示 OAuth，只演示用户主动登录和“已绑定”身份，不把关注列表或好友推荐做成假数据。

计划书可写：未来在用户授权且平台字段确认后，按知乎关注关系优先分发互助内容。当前应写成“陌生人帮助已验证/关系优先为后续阶段”，而不是“读取知乎好友并精准匹配”。

