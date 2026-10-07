# 移动端 / iOS 兼容性诊断与改造清单

> 诊断对象：`/workspace/public`（数字人原型前端）
> 约束前提：**只改 `/public` 前端 HTML/CSS/JS，不碰 `/server` 后端、API、JSON 结构**
> 结论：**当前版本不能直接兼容手机与 iPhone/iOS**，但全部修复都在前端边界内，可安全改造。

---

## 一、结论速览

| 维度 | 现状 | 是否兼容 |
|---|---|---|
| 安卓手机（窄视口） | 桌面像素网格，无手机断点 | ❌ 错位/溢出 |
| iPhone / iOS Safari | 同上 + iOS 特有坑 | ❌ 错位 + 缩放 + 安全区遮挡 |
| iPad 横屏（≥1100px） | 命中现有 `max-width:1100px` 兜底 | ⚠️ 基本可用 |

根因：布局采用**写死的 `left/top` 绝对定位网格**（方框 1–5 坐标锁死），配套媒体查询只做「桌面窄屏降级」，从未做「手机重排」。

---

## 二、现有适配盘点（已具备 / 缺失）

| 项目 | 状态 | 位置 |
|---|---|---|
| `viewport` meta | ✅ 已有 `viewport-fit=cover` | `index.html:5` |
| 禁止用户缩放 | ❌ 未设 `user-scalable=no`（通常不需要，但输入框会触发自动放大） | — |
| 手机断点（`max-width:768/480`） | ❌ 缺失 | — |
| iOS 安全区 `env(safe-area-inset-*)` | ❌ 有 `cover` 但未使用 | — |
| `100dvh` 动态视口 | ❌ 背景层用 `100vh` | `app.css:60` |
| 输入框 `font-size ≥ 16px` | ❌ 聊天框 `14px` | `app.css:453 / 466` |
| 触屏点击（`click` 而非 `hover`） | ✅ 交互全用 `click` | `app.js` / `home.js` |
| 语音真实录音 API | ⚠️ 仅 UI 占位，未接 `getUserMedia` | `app.js:291` |

---

## 三、问题清单（按平台 + 严重度）

### A. 安卓 / 通用手机（窄视口 ≤ 430px）

1. **【P0】卡片溢出视口**
   - 状态卡 `left:425px; top:395px`（`app.css:157`），语音坞宽 `560px`（`app.css:543` 附近）。
   - iPhone 14 宽 393px、安卓常见 360–412px，左偏移 425px 直接超出右边界，卡片被裁切/重叠。
2. **【P0】标题不换行但容器溢出**
   - 招呼语 `font-size:46px; white-space:nowrap`（`app.css:128`）——桌面防折行，手机上整行超出视口。
3. **【P1】抽屉/面板宽度在手机上仍偏宽**
   - 现有 `max-width:1100px` 里 `.drawer{width:min(360px,90vw)}` 在 360px 屏只剩 324px，内容拥挤。
4. **【P1】`100vh` 地址栏问题**
   - 背景层 `height:100vh`（`app.css:60`）在移动浏览器地址栏伸缩时，底部 `voice-dock` 会被遮挡/跳动。

### B. iOS / Safari 特有问题

5. **【P0】输入框聚焦整页放大**
   - 聊天 `textarea` `font-size:14px`（`app.css:453/466`）< 16px，iPhone 点输入框 Safari 自动放大页面（经典 bug，需 ≥16px）。
6. **【P0】安全区未适配**
   - 有 `viewport-fit=cover` 但无 `env(safe-area-inset-top/right/bottom/left)`，刘海区 + 底部 Home 指示条会压住顶部导航与底部语音坞（`bottom:128px`）。
7. **【P1】点击态闪烁 / 300ms 延迟**
   - 交互已用 `click`，但 `:hover` 样式 7 处（`app.css` 全文件 `grep :hover` = 7）——触屏点按会残留 hover 态。建议补 `@media (hover:none)` 关闭 hover 视觉。
8. **【P2】语音录音真机限制（后续接入时）**
   - 当前 `micBtn` 仅 UI 占位（`app.js:291`），未接真实 `getUserMedia`/Web Speech。
   - iOS Safari 要求：**必须 HTTPS + 用户手势触发**；本地 `http://localhost` 无法在真机测语音。需后端/部署提供 HTTPS 域名。

---

## 四、改造清单（具体到文件 + 规则）

> 按优先级分 P0（必做）/ P1（建议）/ P2（增强）。全部落在 `/public`。

### P0 — 让手机「能用」

**1. 新增手机断点（重排方框 1–5 为竖向堆叠）** · `styles/app.css` 末尾新增
```css
@media (max-width: 768px) {
  /* 背景层改用动态视口，避免地址栏吃高度 */
  .bg { height: 100dvh; }

  /* 方框1 招呼语：顶部居中、允许换行、缩小字号 */
  .agent-greeting {
    left: 50%; top: calc(env(safe-area-inset-top, 0px) + 24px);
    transform: translateX(-50%);
    width: min(92vw, 420px); max-width: 92vw;
  }
  .agent-greeting h1 { white-space: normal; font-size: clamp(30px, 9vw, 40px); }

  /* 方框2 今日状态：招呼语下方堆叠 */
  .state-card {
    left: 50%; top: auto;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 168px);
    transform: translateX(-50%);
    width: min(92vw, 420px);
  }

  /* 语音坞：底部固定 + 安全区 + 全宽 */
  .voice-dock {
    bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
    left: 50%; transform: translateX(-50%);
    width: min(94vw, 560px);
  }
  /* 修复 iOS 输入聚焦缩放 */
  .voice-dock__typebox textarea { font-size: 16px; }
}
```

**2. 顶部导航安全区** · `styles/app.css`
```css
.app-nav { padding-top: env(safe-area-inset-top, 0px); }
```

**3. `viewport` 微调** · `index.html:5`
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover">
```
> 说明：`maximum-scale=1.0` 可彻底杜绝 iOS 双击/聚焦缩放，但会牺牲用户缩放能力；若产品允许缩放则保留现状、仅靠 `font-size≥16px` 防自动放大。

### P1 — 让手机「好用」

4. **关闭触屏 hover 残留** · `styles/app.css`
```css
@media (hover: none) {
  .app-nav__link:hover, .drawer__close:hover { /* 清空 hover 视觉 */ }
}
```
5. **抽屉在手机上近全宽** · `styles/app.css` `max-width:768px` 内
```css
.drawer { width: min(92vw, 420px); }
```
6. **小屏字号梯度** · 状态卡内 `font-size:13px` 等文本改 `clamp()` 或 `min()`，避免拥挤。

### P2 — 增强（后续迭代）

7. 语音接入时：`getUserMedia` 必须在 `click` 手势链内调用 + 部署到 HTTPS 域名才能真机验证。
8. 可选：横屏（≤780px 高）单独布局，避免内容被上下挤压。
9. 可选：用 `dvh`/`svh` 统一视口单位，平滑地址栏动画。

---

## 五、验收方式（不碰后端）

- **布局/安全区/输入缩放**：本地 `http://localhost:3000` + 浏览器 DevTools 设备模拟（iPhone 14 / Pixel）+ 真机 Safari（会暴露安全区与缩放问题）。
- **语音录音**：本地 `http` 无法验 iOS 语音，需 HTTPS 部署后真机点按 `micBtn` 验证。
- **不引入新依赖**：纯 CSS 媒体查询 + `env()`，无需改 JS 逻辑（除非接入 P2 语音）。

---

## 六、工作量估算

| 范围 | 改动量 | 风险 |
|---|---|---|
| P0（重排 + 安全区 + 防缩放） | `app.css` +30 行、`index.html` 1 行 | 低，纯样式，不影响桌面 |
| 完整重排（推荐档） | P0+P1，约 50 行 CSS | 低 |
| 仅 iOS 关键坑（最小档） | P0 的子集，约 15 行 | 最低 |

> 桌面端布局通过 `min()`/`clamp()` 与媒体查询隔离，**不会因手机改造而回退**。
