# `@kanshan/story-contract`

纯 TypeScript 内容契约，供 PS1 Player、Studio 和离线编译器共享。此包不依赖 DOM、Three.js、文件系统、模型服务或网络。

## API

- `validateStructure(value)`：封闭 JSON 对象、类型、ID、大小和枚举检查。
- `validateSemantics(pkg)`：跨表引用、动作/选项、来源 span、effect 冲突检查。
- `validateStoryPackage(value)`：结构 + 语义 + 有界状态空间检查。
- `createInitialState(pkg)` / `reduceStoryState(state, event, pkg, options)`：唯一运行状态 reducer。
- `exploreStateSpace(pkg)`：最多 100,000 个状态或 30 秒；达到上限会返回 `INCONCLUSIVE_STATE_SPACE`，不是通过。
- `canonicalJson(value)` / `sha256Hex(value)` / `packageDigest(pkg)`：排序 object key、保留 array 顺序的确定性摘要。

## 本地开发

需要 Node 24 LTS 和 TypeScript CLI：

```sh
npm run check
npm test
```

`src/fixture.ts` 只有原创短文本，用于契约单元测试，不代表真实故事或授权证明。
