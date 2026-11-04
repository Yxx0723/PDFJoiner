# PDFJoiner Web

浏览器内运行的两个 PDF 工具：**合并 PDF** 与 **图片转 PDF**。打开网页即可使用：不用注册、不用安装，文件 **不会离开这台设备**——解析、预览、排版、编码、导出全部在当前标签页里完成。

> 合并功能是同名桌面版（Python + PySide6）的 Web 重写。合并引擎、页码规则与错误语义参考了旧版实现，但前端与浏览器 PDF 处理链路是全新写的。图片转 PDF 是同一个应用里的第二个工具，共用设计系统、pdf.js 预览链路与 pdf-lib 依赖。

## 两个工具

顶部导航切换，两个工具各自保留自己的文件与设置，互不影响：

| 工具 | 路由 | 说明 |
| --- | --- | --- |
| PDF 合并 | `#/merge` | 多份 PDF 排序、选页，按页面对象合并，保留矢量内容 |
| 图片转 PDF | `#/images` | 多张图片排序、旋转，按纸张与边距排版，每张一页 |

合并工作区（浅色）：

![合并工作区](docs/screenshots/02-workspace-light.png)

合并预览弹窗支持缩放（下图 100%，页面从顶部开始、左右留白对称）：

![预览与缩放](docs/screenshots/07-preview-zoom.png)

图片转 PDF 工作区：左侧是「版面预览 + 图片网格」，右侧是页面设置。版面预览与最终输出调用**同一个排版函数**，改边距或适配方式时看到的裁切就是导出后的裁切。

![图片转 PDF 工作区](docs/screenshots/09-images-workspace.png)

生成结果可以直接用 PDF.js 回读（下图为上一步生成的 3 页 PDF 的真实渲染）：

![生成结果预览](docs/screenshots/13-images-pdf-preview.png)

## 快速开始

```bash
npm install

npm run dev          # 开发服务器 http://localhost:5173
npm run build        # 类型检查 + 生产构建，输出 dist/
npm run preview      # 本地预览 dist/（默认 4173 端口）

npm run test         # 单元测试（Vitest，106 个）
npm run test:e2e     # 端到端测试（Playwright，35 个用例 × 3 个内核）
npm run lint         # ESLint
npm run fixtures     # 重新生成测试用 PDF 样本
npm run fixtures:images  # 重新生成测试用图片样本（需要 Playwright 的 Chromium）
```

Node 版本要求：**>= 20**（开发时使用 22.22.2）。

首次跑端到端测试前需要下载浏览器内核：

```bash
npx playwright install chromium firefox webkit
```

## 功能：PDF 合并

**导入**
- 点击选择、一次多选、拖拽到页面任意位置
- 自动读取文件名 / 大小 / 页数
- 扩展名、空文件、体积上限（200 MB）、PDF 结构四层校验
- 重复文件（同名 + 同大小 + 同修改时间）自动跳过并提示
- 损坏文件、非 PDF 文件、加密文件分别给出可执行的错误说明

**文件管理**
- 卡片式列表，拖拽排序 + 上移/下移按钮（键盘可达）
- 单文件删除、一键清空
- 实时显示文件数、合并页数、输入总大小
- 侧栏「输出顺序」逐条列出最终拼接顺序

**页面预览与选择**
- PDF.js 渲染真实页面缩略图，页码标注
- 点击缩略图进入预览：可缩放 25%–300%，支持按钮、双击（适应窗口 ⇄ 100%）、`+`/`-`/`0` 快捷键、⌘/Ctrl + 滚轮（以光标为锚点），放大后可拖拽平移
- 预览中可翻页（← → 或按钮），显示纸张毫米尺寸与旋转角度
- 逐页勾选 / 取消，被排除的页面留位显示但置灰
- 页码输入框与缩略图选择双向同步；顺序自定义时缩略图左上角显示输出序号
- 按需渲染：首屏只挂载 60 个缩略图，横向滚动再追加；每个缩略图进入视口附近才开始渲染，渲染并发限制为 2

**合并与导出**
- pdf-lib 真实页面对象复制，保留矢量内容、原始页面尺寸与方向
- 页面范围：全部 / 单页 / 连续 / 多段 / 重复页
- 页面级进度（已完成 X / 共 Y 页），不使用伪造的字节百分比
- 可取消：在文件或每 25 页的批次边界响应取消
- 成功态显示页数、体积、耗时、是否二次校验，可改文件名后下载
- 「继续调整」保留文件，「清空并开始新任务」释放全部资源

**界面**
- 浅色/深色主题，跟随系统并记住选择
- 桌面两栏、移动端单栏 + 底部操作条
- 空 / 加载 / 读取中 / 处理中 / 成功 / 失败 六种状态都有独立设计

## 功能：图片转 PDF

**导入**
- 点击选择、一次多选、拖拽到页面任意位置、继续追加
- 用**文件头魔数**判断格式，不看扩展名：改了后缀的 PDF 会被拒绝，无后缀的真图片仍可用
- 支持 JPEG / PNG / WebP / BMP / GIF（取第一帧）；Safari 额外支持 HEIC/AVIF（由浏览器原生解码）
- 每张卡片显示缩略图、像素尺寸、体积、格式、输出序号；含透明通道的图片用棋盘格底衬
- 解码失败、无法识别的格式、超过 60 MB、超过 1.2 亿像素分别给出可执行的错误说明
- 重复图片（同名 + 同大小 + 同修改时间）自动跳过并提示

**图片管理**
- 卡片网格，拖拽排序（指针与键盘都可操作），顺序即 PDF 页面顺序
- 左旋 / 右旋 90°、单张删除、一键清空、继续添加
- 点击卡片浏览大图，可在预览里继续旋转与重置

**页面设置**
- 页面尺寸：A4 / A5 / Letter / Legal / 原图尺寸（按 DPI 换算，默认 300，可调 36–1200）/ 自定义（毫米）
- 页面方向：自动（按每张图片的宽高比逐页决定）/ 纵向 / 横向
- 图片适配：完整显示（contain）/ 填满页面（cover，超出内容区的部分被真实裁剪）/ 拉伸铺满（stretch）
- 页边距：无边距 / 普通 8 mm / 宽 18 mm / 自定义（毫米）
- 页面背景：白、浅灰、米白、深色或任意取色
- 输出质量：高质量（300 DPI 目标）/ 标准（200 DPI）/ 压缩（120 DPI），可按需直通原始字节

**生成与反馈**
- 每张图片一页，按排序输出；进度按**已处理张数**（`5 / 12 张`）而不是伪造的百分比
- 阶段区分「正在处理图片 → 正在写入 PDF → 正在校验输出」，可中途取消
- 成功态显示页数、体积、耗时与是否二次校验，可改文件名后下载
- 「预览」按钮用 PDF.js 把**生成出来的文件**逐页渲染出来，证明结果真的可读
- 手机端底部固定「生成 PDF」操作条，桌面端为右侧设置栏

## 技术栈

| 层 | 选择 |
| --- | --- |
| 框架 | React 18 + TypeScript 5.9 + Vite 5 |
| 样式 | Tailwind CSS 3.4 + shadcn/ui 风格的本地组件（Radix 原语 + CVA） |
| PDF 引擎 | pdf-lib 1.17（合并与图片排版共用） |
| 页面预览 | pdfjs-dist 4.10（worker + 自托管 cMaps/标准字体） |
| 图片解码/编码 | `createImageBitmap` + `OffscreenCanvas`（不可用时降级到主线程 canvas） |
| 拖拽排序 | dnd-kit |
| 状态 | Zustand 5 |
| 通知 | sonner |
| 测试 | Vitest 2 + Playwright 1.64 |

没有任何后端、数据库、账号系统或云存储。构建产物是纯静态文件。

## 目录结构

```text
pdfjoiner-web/
├── index.html                    # 单页入口，含防主题闪烁的内联脚本
├── src/
│   ├── main.tsx                  # 挂载、Promise.withResolvers 兜底、全局拖拽拦截
│   ├── App.tsx                   # 路由分发（合并 / 图片）、布局骨架、通知
│   ├── index.css                 # 设计令牌（HSL 变量）、层级与工具类
│   ├── components/
│   │   ├── ui/                   # button, badge, card, dialog, input, progress, tooltip
│   │   ├── layout/               # app-header、app-footer、hero、tool-nav（工具切换）
│   │   ├── upload/               # drop-zone（PDF / 图片两种模式）
│   │   ├── files/                # 【合并】file-list（dnd-kit）、file-card、range-editor
│   │   ├── pages/                # 【合并】page-strip、page-thumb、page-preview-dialog
│   │   ├── merge/                # 【合并】merge-panel（汇总 / 进度 / 结果卡）
│   │   ├── images/               # 【图片】网格、卡片、设置面板、版面预览、结果卡、结果 PDF 预览
│   │   ├── workspace.tsx         # 【合并】两栏布局编排
│   │   └── images/image-workspace.tsx  # 【图片】两栏布局编排
│   ├── features/
│   │   ├── pdf/                  # 【合并】
│   │   │   ├── engine.ts         #   纯函数层：inspect + merge（无 DOM 依赖，可在 Node 跑）
│   │   │   ├── engine-client.ts  #   主线程 RPC、字节按需投喂、worker 生命周期
│   │   │   ├── protocol.ts       #   主线程 ↔ worker 的消息类型
│   │   │   └── errors.ts         #   错误码与错误类型（错误文案的单一来源）
│   │   ├── image-pdf/            # 【图片】
│   │   │   ├── types.ts          #   设置项、纸张预设、质量档位、单位换算
│   │   │   ├── page-layout.ts    #   纯函数排版：页面尺寸 / 方向 / 适配 / 边距（预览与引擎共用）
│   │   │   ├── encode.ts         #   canvas 归一化：旋转、透明、目标像素、JPEG 直通判定
│   │   │   ├── build.ts          #   pdf-lib 组装：背景、裁剪路径、嵌入与二次校验
│   │   │   ├── format.ts         #   魔数识别 + 透明通道判定
│   │   │   ├── source.ts         #   解码（createImageBitmap → <img> 兜底）
│   │   │   ├── inspect.ts        #   导入前的尺寸 / 格式 / 像素上限检查
│   │   │   ├── client.ts         #   worker 或主线程双通道，能力探测与取消
│   │   │   ├── protocol.ts       #   主线程 ↔ 图片 worker 的消息类型
│   │   │   └── errors.ts
│   │   ├── page-range/           # 【合并】页码解析与格式化
│   │   └── preview/thumbnail-service.ts  # pdf.js 文档缓存、渲染信号量、LRU
│   ├── store/
│   │   ├── use-app-store.ts      # 【合并】文件、选择、合并状态
│   │   ├── use-image-store.ts    # 【图片】图片、设置、生成状态、对象 URL 生命周期
│   │   └── selectors.ts          # 【合并】汇总、门禁、结构风险提示
│   ├── hooks/                    # use-theme, use-file-drop, use-in-view
│   ├── workers/
│   │   ├── pdf.worker.ts         # 【合并】合并与解析 worker
│   │   └── image.worker.ts       # 【图片】解码 + OffscreenCanvas 编码 + 组装
│   └── lib/                      # utils、constants（上限与阈值）、use-route（hash 路由）
├── public/
│   ├── pdfjs/cmaps/              # 1.6 MB，避免向 CDN 请求中文字体映射
│   ├── pdfjs/standard_fonts/     # 800 KB
│   └── _headers                  # Cloudflare Pages 安全响应头
├── scripts/
│   ├── make-fixtures.mjs         # 用 pdf-lib 生成 PDF 测试样本
│   ├── make-fixtures-pypdf.py    # 用 pypdf 生成加密 / 书签 / 注释样本
│   └── make-image-fixtures.mjs   # 用 Chromium 编码 JPG/PNG/WebP，并手写 BMP/GIF 样本
├── tests/
│   ├── unit/                     # 7 个测试文件 + PDF 内容流 / PNG 生成辅助
│   ├── e2e/
│   │   ├── app.spec.ts           # 【合并】15 个用例
│   │   └── images.spec.ts        # 【图片】20 个用例
│   └── fixtures/
│       ├── *.pdf                 # 合并样本（含加密 / 损坏 / 300 页）
│       └── images/               # 图片样本（含透明 PNG / 大图 / 损坏 / 非图片）
├── docs/screenshots/             # 实际运行截图（由 e2e 用例生成）
├── dist/                         # 构建产物（npm run build 生成）
├── vite.config.ts                # 别名、worker 格式、pdf.js 单独分包
├── vitest.config.ts
├── playwright.config.ts          # 3 个浏览器项目，自动构建 + 预览
└── vercel.json
```

## 本次新增与修改的文件

图片转 PDF 是在现有工程内扩展的，没有新建项目、没有替换技术栈，也没有改动合并引擎的行为。

**新增**

| 路径 | 作用 |
| --- | --- |
| `src/lib/use-route.ts` | 极简 hash 路由（`#/merge`、`#/images`），用 `useSyncExternalStore` 订阅 `hashchange` |
| `src/components/layout/tool-nav.tsx` | 顶栏工具切换（真实 `<a href>`，支持中键与浏览器前进后退） |
| `src/components/images/image-workspace.tsx` | 图片工具的两栏编排、拖拽落区、移动端底部操作条 |
| `src/components/images/image-hero.tsx` | 空状态（含图片模式的拖放区） |
| `src/components/images/image-grid.tsx` | 卡片网格 + dnd-kit 排序（指针命中判定） |
| `src/components/images/image-card.tsx` | 单张图片卡片：缩略图、序号、拖拽手柄、旋转、删除、预览入口 |
| `src/components/images/image-preview-dialog.tsx` | 大图预览与旋转 |
| `src/components/images/rotated-image.tsx` | 按旋转角正确占位的图片组件（fill / contain 两种模式） |
| `src/components/images/page-layout-preview.tsx` | 版面预览：纸张、边距参考线、按内容区裁剪 |
| `src/components/images/settings-panel.tsx` | 页面尺寸 / 方向 / 适配 / 边距 / 背景 / 质量 / 文件名 / 进度 |
| `src/components/images/option-group.tsx` | 分段选择控件（`aria-pressed`） |
| `src/components/images/image-result-card.tsx` | 成功态、文件名、下载、预览入口 |
| `src/components/images/generated-pdf-dialog.tsx` | 用 PDF.js 渲染生成结果 |
| `src/features/image-pdf/types.ts` | 设置类型、纸张预设、质量档位、单位换算 |
| `src/features/image-pdf/page-layout.ts` | **预览与引擎共用的**排版纯函数 |
| `src/features/image-pdf/format.ts` | 魔数识别、透明通道判定、格式标签 |
| `src/features/image-pdf/encode.ts` | 旋转绘制、目标像素、直通判定、canvas 导出 |
| `src/features/image-pdf/source.ts` | 解码（`createImageBitmap` → `<img>` 兜底） |
| `src/features/image-pdf/inspect.ts` | 导入前的格式/尺寸/像素上限校验 |
| `src/features/image-pdf/build.ts` | pdf-lib 组装：背景、裁剪、嵌入、二次校验 |
| `src/features/image-pdf/protocol.ts` | 主线程 ↔ 图片 worker 的消息类型 |
| `src/features/image-pdf/client.ts` | worker / 主线程双通道与取消 |
| `src/features/image-pdf/errors.ts` | 错误码与错误类型 |
| `src/store/use-image-store.ts` | 图片、设置、生成状态与对象 URL 生命周期 |
| `src/workers/image.worker.ts` | 解码 + OffscreenCanvas 编码 + 组装 |
| `scripts/make-image-fixtures.mjs` | 用 Chromium 生成图片样本（BMP 手写、GIF 内置） |
| `tests/unit/image-layout.test.ts` | 19 个排版几何用例 |
| `tests/unit/image-encode.test.ts` | 11 个编码/矩阵用例 |
| `tests/unit/image-build.test.ts` | 11 个组装用例 |
| `tests/unit/helpers/png.ts` | 纯 Node 的 PNG 生成器（测试用真 PNG 嵌入） |
| `tests/e2e/images.spec.ts` | 20 个端到端用例 |
| `tests/fixtures/images/*` | 10 个图片样本（含透明、大图、损坏、非图片） |
| `docs/screenshots/08–13-*.png` | 新增的运行截图 |

**修改**

| 路径 | 改动 |
| --- | --- |
| `src/App.tsx` | 按路由渲染两个工具；`beforeunload` 与资源释放同时覆盖两套状态 |
| `src/components/layout/app-header.tsx` | 加入工具切换，副标题改为「浏览器内 PDF 工具」 |
| `src/components/upload/drop-zone.tsx` | 增加 `kind` / `accept` / 文案 props，PDF 模式的行为与文案保持不变 |
| `src/lib/constants.ts` | 追加图片相关的上限（数量、单张体积、像素、画布） |
| `tests/unit/helpers/pdf.ts` | 增加 `pageContent` / `imageXObjects` / `imagePixelSize` 辅助函数 |
| `index.html` | 标题与描述覆盖两个工具 |
| `package.json` | 新增 `fixtures:images` 脚本 |
| `README.md` | 本文 |

**未改动**：`src/features/pdf/*`、`src/store/use-app-store.ts`、`src/store/selectors.ts`、`src/components/merge/*`、`src/components/files/*`、`src/components/pages/*`、`src/workers/pdf.worker.ts`、`vite.config.ts`、`tailwind.config.ts`、设计令牌。合并功能的 15 个端到端用例与 65 个单元测试全部保持通过。

## 工作原理

### 1. 导入与校验

一个文件要经过四道检查才会进入列表：

1. 扩展名必须是 `.pdf`；
2. 大小不能为 0、不能超过 200 MB；
3. 同名 + 同大小 + 同修改时间视为重复，直接跳过；
4. 交给 worker 用 pdf-lib 真正解析一次——解析失败的进「无法处理」，抛 `EncryptedPDFError` 的进「已加密」。

第 4 步同时拿到页数、页面尺寸、是否存在 AcroForm / 数字签名 / 书签 / 注释，用于在卡片上提前告知「合并后会丢失什么」。

### 2. 合并引擎

`src/features/pdf/engine.ts` 是纯函数层，不碰 DOM，因此同一份代码既跑在 worker 里，也跑在 Node 的单测里。

```ts
const out = await PDFDocument.create();
for (const plan of plans) {
  const source = await PDFDocument.load(bytes);
  for (let i = 0; i < plan.pages.length; i += 25) {
    const copied = await out.copyPages(source, plan.pages.slice(i, i + 25));
    copied.forEach((page) => out.addPage(page));
    // 每批让出事件循环，取消与进度才能插进来
    await new Promise((r) => setTimeout(r, 0));
  }
}
```

关键点：

- **页面对象复制**，不是截图、不是二进制拼接。输出页保留 `/MediaBox`、`/Rotate`、`/Resources`，文字仍是文字，图形仍是矢量。
- 分 25 页一批，批间 `await` 一次宏任务，取消信号与进度事件才有机会被处理。
- 输出页数与计划页数不符时直接报错，不产出文件。
- 小于 64 MB 的输出会被重新解析一次做**二次校验**（页数比对）；更大的输出跳过校验并在界面标注「未做二次校验」，如实告知而不是假装验证过。
- 元数据：Producer/Creator 写入 `PDFJoiner Web`，标题取用户填写的输出名；单文件合并时沿用源文档的 Author/Subject/Keywords。

### 3. Worker 协议（按需投喂字节）

一次性把所有 PDF 塞进 worker，峰值内存 = 全部输入 + 输出。这里改成**主线程按需投喂**：

```text
主线程                         Worker
  │ merge {files:[{name,pages}]} │
  │─────────────────────────────▶│
  │◀───────── need-bytes(index) ─│   “把第 0 个文件的字节给我”
  │  file.arrayBuffer()          │
  │──── merge-bytes(transfer) ──▶│   零拷贝转移，主线程立即释放
  │◀──────────── progress ───────│
  │◀────────── merge-result ─────│   ArrayBuffer 转移回主线程
```

于是峰值内存约为「输出 + 当前这一个输入」，而不是「输出 + 所有输入」。合并结束或取消后 worker 直接 `terminate()`，pdf-lib 的内部对象一并回收。

### 4. 缩略图

`thumbnail-service.ts` 管理三件事：

- **文档**：每个文件一个 pdf.js `PDFDocumentProxy`，按文件 id 索引，删除文件时 `destroy()`；
- **并发**：信号量限制同时渲染 2 页，避免主线程被 canvas 绘制挤满；
- **缓存**：LRU 最多 180 条 data URL，键包含目标宽度（104 px 的缩略图与 720 px 的预览互不覆盖）。

组件侧用 `IntersectionObserver` 在元素进入视口前 360 px 才发起渲染；页面条首屏只挂载 60 个节点，滚动接近末尾再追加 60 个。因此 300 页文档不会一次性渲染 300 张图。

pdf.js 本身通过 `import()` 动态加载，只有用户真正展开页面时才下载这个约 360 KB 的 chunk。

### 5. 内存与资源释放

| 资源 | 释放时机 |
| --- | --- |
| pdf-lib worker 及其内存 | 每次合并结束 / 取消 / 清空（`terminate()`） |
| 输出 Blob URL | 重新合并、修改文件、点「继续调整」、清空、组件卸载 |
| pdf.js 文档 | 删除单个文件、清空、页面卸载 |
| 缩略图 data URL | LRU 淘汰或文件被删除 |
| 输入字节 | 每次 `getBytes` 都是新读一份，传给 worker 后立即转移所有权，主线程不留副本 |

## 工作原理：图片转 PDF

### 1. 一套排版，两处使用

`src/features/image-pdf/page-layout.ts` 只有一个纯函数：

```ts
computePageLayout({ settings, imageWidth, imageHeight, rotation })
// → { pageWidth, pageHeight, contentBox, imageBox, clipped, orientation }
```

界面上的版面预览与 pdf-lib 组装都调用它。预览把返回的 `imageBox` 换算成**页面盒子的百分比**去绝对定位，引擎把同一组数值写进 `drawImage` 的坐标——不存在「预览一套、导出一套」的第二份实现。

页面尺寸的三条换算规则：

| 页面尺寸 | 规则 |
| --- | --- |
| A4 / A5 / Letter / Legal | 固定毫米值，`mm × 72 / 25.4` 转点 |
| 原图尺寸 | `像素 / DPI × 25.4` 得到毫米，默认 300 DPI；页面永远按**旋转后**的像素算 |
| 自定义 | 用户输入的毫米值，限制在 20–2000 mm |

方向：`自动` 比较图片宽高比与纸张，必要时横竖互换；`纵向` / `横向` 强制页面，再由适配方式决定留白。边距换算成点后夹紧到「至少留 4 mm 内容区」，避免用户输入 400 mm 边距时算出负尺寸。

### 2. 编码策略：能不重编码就不重编码

| 情形 | 处理 | 结果 |
| --- | --- | --- |
| JPEG，无需旋转，目标像素 ≥ 原图 | **原字节直通** | 无损，`source: 'original'` |
| PNG（含透明），同上 | 原字节直通 | 透明通道随 `/SMask` 一起保留 |
| 需要旋转 / 缩小 / 格式转换 | canvas 归一化后重编码 | 有损，质量随档位 |
| 不透明图片 | 输出 JPEG（0.95 / 0.86 / 0.72） | 「压缩」档主要靠这一步变小 |
| 含透明通道 | 输出 PNG（永不转 JPEG） | 透明不会被拍成白/黑底 |

「目标像素」由 `imageBox` 的物理宽度 × 档位 DPI 得到，并**永不超过原始像素**（不放大）。旋转 90°/270° 会在 canvas 上真实重排像素，页面尺寸也随之从纵向变横向——不是给查看器加一个旋转标记。

### 3. 裁剪：`cover` 要裁在内容区，而不是页面边缘

PDF 查看器只保证裁到页面边界；「填满页面」+ 页边距时，图片必须裁在**内容区**，否则会溢到留白里。pdf-lib 的高层 API 没有裁剪，这里直接用内容流操作符：

```ts
page.pushOperators(
  pushGraphicsState(),
  rectangle(box.x, box.y, box.width, box.height),
  clip(),
  endPath(),
);
page.drawImage(image, { x, y, width, height });   // 超出部分被上面的路径裁掉
page.pushOperators(popGraphicsState());
```

单元测试把内容流解压后，用正则取出 `… re W n` 的四个数值，与 `contentBox` 逐项比对；同时断言图片实际绘制尺寸**大于**裁剪框（证明真的发生了裁剪，而不是缩小到刚好放下）。

### 4. 双通道：worker 优先，主线程兜底

```text
canEncodeOffscreen() ?
  ├─ true  → image.worker：createImageBitmap + OffscreenCanvas + pdf-lib，主线程只收最终字节
  └─ false → 主线程：同样的 buildImagePdf，只把 canvas 工厂换成 <canvas>
```

两条通道共用 `buildImagePdf` 与 `encodeImage`，唯一的差别是画布来源。降级时界面会明确提示「当前浏览器缺少 OffscreenCanvas，图片会在主线程处理」。`images.spec.ts` 里有一个用例用 `Object.defineProperty(window, 'OffscreenCanvas', …)` 把 API 抹掉，真实跑通这条降级路径。

Blob 通过结构化克隆按引用传给 worker（不复制字节），编码完成后立即 `bitmap.close()` 并把 canvas 宽高置 1，峰值内存约为「当前这一张 + 输出的图片对象」。

### 5. 进度、取消与校验

- 进度以**图片张数**为单位（`5 / 12 张`），阶段为 `encoding → saving → verifying`；没有伪造的字节百分比。
- 每处理 4 张让出一次事件循环，取消消息才有机会被 worker 读到；取消在图片边界生效。
- 输出会被重新 `PDFDocument.load()` 一次：页数不符直接抛错（绝不产出「失败但显示成功」的结果），页面尺寸与预期不一致则把 `verified` 置为 `false`。
- 生成结束后 worker `terminate()`，pdf-lib 的内部对象随之回收。

## 页码语法

页码从 1 开始，输出顺序与输入顺序完全一致。

| 输入 | 含义 |
| --- | --- |
| 空 / `all` / `全部` | 全部页面 |
| `3` | 第 3 页 |
| `1-5` | 第 1 到 5 页（含两端） |
| `1-3,6,9-12` | 多段 |
| `1,1,3` | 第 1 页放两次，再放第 3 页 |
| `3,1` | 先第 3 页，再第 1 页 |

校验行为：全角逗号与破折号自动归一化；`0`、超出总页数、`5-3` 这类倒序、`1-`、`1.5`、`1-2-3` 都会得到带页码总数或修正建议的中文提示，且**不会悄悄丢弃**任何一段。

## 隐私与安全

文案说的每一条，都有代码对应：

| 承诺 | 代码依据 |
| --- | --- |
| 文件不上传 | `src/` 内不存在 `fetch` / `XMLHttpRequest` / `sendBeacon` / `WebSocket` / `EventSource`（可用 `grep -rn "fetch(" src/` 复核）；合并与图片两条链路各有一个 e2e 用例在真实浏览器里断言「只有同源 GET」，图片侧的用例还会先打开 PDF.js 预览，把静态资源请求也纳入审计 |
| 不接第三方 | 没有分析脚本、没有 CDN、没有 Web 字体；pdf.js 的 cMaps 与标准字体自托管在 `public/pdfjs/` |
| 不需要注册 | 无账号系统、无 localStorage 用户标识，只存一个主题偏好 |
| 不收集内容 | 没有日志上报；`src/` 内没有任何 `console.*` |
| 只在内存中 | 文件对象只存在于 Zustand 内存态，不写 IndexedDB / Cache API / 磁盘 |
| 及时释放 | 见上一节表格 |
| 关闭即消失 | `beforeunload` 提醒未保存的合并任务；刷新后状态不恢复（这是刻意设计） |

构建产物可直接部署为静态站点；`public/_headers` 与 `vercel.json` 已经带上 `X-Content-Type-Options`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY` 等响应头。

> 生产环境如需加 CSP，注意 `index.html` 里有一小段内联主题脚本，需要为其保留 hash 或 nonce。仓库默认**没有**下发 CSP，避免给出一个会打断应用的示例配置。

## 测试

### 单元测试（Vitest，106 个）

```bash
npm run test
```

| 文件 | 覆盖 |
| --- | --- |
| `page-range.test.ts` | 全部 / 单页 / 连续 / 多段 / 重复页 / 倒序 / 越界 / 语法错误 / 全角符号 / 往返格式化 |
| `engine.test.ts` | 页数与页面尺寸解析、混合纸张检测、加密与损坏识别、签名结构识别、多文件合并顺序、非升序选择、重复页、尺寸与方向保留、矢量内容校验（内容流含 `BT/Tj`、无 Image XObject）、注释保留、书签丢失、表单被拍平、元数据、进度单调性、取消、越界与空计划 |
| `store.test.ts` | 导入校验、重复跳过、加密文件入列、逐页勾选、范围草稿校验、排序、合并计划构造、取消回退、失败不误报成功、清空 |
| `selectors.test.ts` | 字节/时长格式化、文件名净化、汇总、合并门禁、结构风险提示 |
| `image-layout.test.ts` | 纸张预设换算、原图尺寸与 DPI、自定义毫米、自动/强制方向、旋转后换向、三种适配的几何、四档边距与夹紧 |
| `image-encode.test.ts` | `drawRotated` 的变换矩阵（把四角映射回画布，证明不多不少正好填满）、目标像素不放大、旋转后宽高互换、画布像素上限、`hexToRgb` |
| `image-build.test.ts` | 每图一页与顺序、页面尺寸、背景填充色、contain 不裁剪、cover 的 `re W n` 裁剪框与溢出、stretch 精确铺满、透明 PNG 的 `/SMask`、旋转后像素尺寸、取消、空计划、原字节被拒时的重编码回退 |

引擎测试直接读取 `tests/fixtures/` 下的真实 PDF，并通过解压内容流断言「文字仍是文字」：

```ts
expect(pageHasTextOperators(page, doc)).toBe(true);   // 内容流里有 BT / Tj
expect(imageXObjectNames(page, doc)).toEqual([]);     // 页面资源里没有图片 XObject
```

### 端到端测试（Playwright，35 个用例）

```bash
npm run test:e2e                                    # 三个浏览器全跑
npx playwright test --project=chromium              # 只跑 Chromium
```

`playwright.config.ts` 会自动执行 `npm run build && npm run preview`，所以跑的是**生产构建产物**，不是 dev server。

**合并（`app.spec.ts`，15 个）**：空状态、多文件导入与汇总、缩略图渲染、预览居中断言、缩放（按钮 / 双击 / 快捷键，并校验 100% = 794 CSS px）、逐页取消、页码多段与校验、合并后**下载真实文件并用 pdf-lib 复核页数与页面尺寸**、加密文件拒绝、损坏文件报错、重复文件跳过、上移下移改变顺序、同源 GET 请求审计（证明无上传）、手机尺寸（390×844）完整流程且无横向溢出、300 页文档合并（进度可见 + 页数正确）、截图。

**图片转 PDF（`images.spec.ts`，20 个）**：工具切换与状态互不干扰、JPG/PNG 导入信息、五种格式混合出 5 页、重复跳过与损坏/非图片报错、拖拽排序改变输出顺序、旋转 90°（同时断言页面转横向**且**嵌入图片的像素宽高互换）、删除减页、A5/自定义/原图尺寸（300 DPI）、三种适配（含 `re W n` 裁剪与精确铺满）、宽边距缩小可用区域、**预览裁剪范围与引擎一致**（比较 DOM 里的裁剪框与页面盒子）、透明 PNG 的 `/SMask` 与背景色、压缩档位真的更小、缺 OffscreenCanvas 时降级、PDF.js 回读生成结果、改文件名下载、取消不产出结果、同源 GET 审计、手机尺寸全流程、截图。

合并与图片两侧都做了「下载真实文件 → 用 pdf-lib 重新解析 → 断言页数 / 页面尺寸 / 嵌入图片的像素尺寸 / 内容流」的闭环，而不是只检查界面文案。

### 浏览器验证矩阵

完整回归 `npx playwright test`：**101 通过 / 4 跳过**（跳过的是两个「界面截图」用例，按设计只在 Chromium 生成一次截图）。

| 浏览器 | 实际内核（Playwright 1.64.1） | 结果 |
| --- | --- | --- |
| Chrome / Chromium | Chromium 156.0.8078.4 | 35/35 通过 |
| Firefox | Firefox 157.0 | 34/34 通过（1 个截图用例跳过） |
| Safari（WebKit 内核） | WebKit 27.2 | 34/34 通过（1 个截图用例跳过） |
| Microsoft Edge | 与 Chromium 同内核 | **未验证**：没有在真实 Edge 中运行过，只覆盖了同内核的 Chromium |
| iOS Safari | — | **未验证**：没有真机环境 |

Playwright 的 WebKit 与真机 Safari 并不完全等价（字体、下载行为、内存策略都有差异）。上表能证明「Safari 内核下核心流程可用」，不能替代真机验收。

## 构建与部署

```bash
npm run build     # → dist/
```

`dist/` 是纯静态资源，可直接丢到任何静态托管。两个平台的现成配置：

### Cloudflare Pages

1. 仓库连到 Cloudflare Pages；
2. Build command：`npm run build`，Build output directory：`dist`；
3. Node 版本设为 20 或以上；
4. `public/_headers` 会被复制到 `dist/_headers`，Cloudflare 自动识别其中的安全响应头与缓存策略。

没有构建环境时，直接把 `dist/` 拖进 Cloudflare Pages 的 Direct Upload 也可以。

### Vercel

```bash
npm i -g vercel
vercel --prod
```

仓库内的 `vercel.json` 已声明 `framework: vite`、`buildCommand`、`outputDirectory` 与响应头，CLI 会自动读取。

### 自托管（Nginx 片段）

```nginx
location / {
  root /var/www/pdfjoiner;
  try_files $uri $uri/ /index.html;
  add_header X-Content-Type-Options nosniff;
  add_header Referrer-Policy no-referrer;
}
```

单页应用只有一个入口，不需要额外 rewrite 规则；`/pdfjs/*` 是静态字体与 CMap，建议设置长缓存。

## 已知限制

**能力边界：PDF 合并**

| 项 | 现状 | 原因 |
| --- | --- | --- |
| 加密 PDF | 明确拒绝，提示先解密 | pdf-lib 不支持解密；项目内**不存在** `ignoreEncryption: true`，不会假装成功 |
| 文档书签（Outlines） | 合并后丢失，导入时提前提示 | pdf-lib 没有 outline 写入 API，页面级复制不会带目录树 |
| 交互表单 | 字段被拍平：外观保留、不可再编辑，导入时提示 | AcroForm 是文档级结构，新建文档时不会被复制 |
| 数字签名 | 合并后原签名失效，导入时提示 | 页面对象被重新序列化，签名覆盖范围必然改变；这是 PDF 规范层面的结果，不是实现缺陷 |
| 页面注释 | 保留（已用测试验证） | 注释挂在页面 `/Annots` 上，随页面对象一起复制 |
| 单文件上限 | 200 MB | 纯内存方案的现实边界，超出会提示分批处理 |
| 内存不足 | 捕获后提示减少文件或分批 | 浏览器标签页内存上限由设备与浏览器决定 |
| 重复判定 | 文件名 + 大小 + 修改时间 | 内容哈希对大文件代价过高；同内容不同元数据不会被判为重复 |

**能力边界：图片转 PDF**

| 项 | 现状 | 原因 |
| --- | --- | --- |
| HEIC / HEIF | Safari 可解码；Chrome / Firefox / Edge 明确提示「当前浏览器无法解码」，不假装支持 | 浏览器原生解码是唯一零依赖的路径。引入 WASM 解码器要额外 1–3 MB 并带来兼容性风险，本次评估后未采用 |
| WebP / BMP / GIF | 支持，但一律经 canvas 重编码为 JPEG 或 PNG | pdf-lib 只能嵌入 JPEG/PNG；这不是「不支持」，而是先解码再以标准格式写入 |
| GIF 动画 | 只取第一帧 | PDF 页面是静态的 |
| 旋转 | 90°/270° 会重采样像素（JPEG 0.95 / 标准 0.86 / 压缩 0.72） | 写的是旋转后的真实位图，而不是给页面加旋转标记；代价是一次重编码 |
| 带透明通道的「压缩」 | 保持 PNG，只降分辨率 | 转 JPEG 会丢透明，宁可文件大一些也不改变画面 |
| 单张图片 | 60 MB / 1.2 亿像素 | 纯内存方案边界，超出时提示先缩小 |
| 一次任务 | 100 张 | 同上 |
| EXIF 方向 | 由浏览器解码时应用（`imageOrientation: 'from-image'`） | 界面显示的宽高即「看得见的宽高」，与导出结果一致 |
| 预览清晰度 | 版面预览是 CSS 缩放，放大后是插值；受检查的是版式而非像素 | 导出始终使用原始像素或按 DPI 计算的目标像素 |

**实现取舍**

- 输出小于 64 MB 才做二次校验，更大的文件跳过校验并在界面明确标注。
- 取消在批次边界生效（每 25 页或每个文件），单个超大文件内部不会立即中断。
- pdf.js 4.10 依赖 `Promise.withResolvers`（Chrome 119 / Safari 17.4 / Firefox 121 起支持），`main.tsx` 里有兜底 polyfill，但更老的浏览器仍可能因其它 API 不可用而失败。
- 缩略图缓存上限 180 张，滚动很长的文档时较早的缩略图会重新渲染（有轻微闪烁）。
- 预览按 200 px 分档请求位图，单张渲染宽度上限 1100 CSS px（约 200% 时达到上限）；继续放大是对该位图的插值放大，会略软。这只影响预览，合并始终使用原始矢量页面。
- 预览的 100% 按 96 dpi 换算（1 pt = 4/3 CSS px），与系统缩放/显示器 DPI 无关。
- 主题偏好写入 `localStorage`，这是本项目唯一的持久化数据。
- 图片的「目标像素」按 120 / 200 / 300 DPI 换算，并**不超过原图**，所以小图不会被拉大、大图才会缩小。
- 「原图尺寸」模式下页面大小由「像素 ÷ DPI」决定，因此降低分辨率不会改变页面尺寸，只改变 PDF 里的像素量。
- 已排序的图片被删除或新增时，版面预览会自动切到仍然存在的图片；预览索引没有做「记住上一次」的持久化。

**未验证项（如实标注）**

- 真实 Safari 桌面版与 iOS Safari：未在真机验证，仅有 Playwright WebKit 的结果（见上表）。
- 真实 Edge：未单独运行，仅覆盖同内核的 Chromium。
- 中文/复杂字体 PDF 的缩略图渲染：样本为内置 Helvetica；cMaps 已自托管，但未用真实中文 PDF 做逐页比对。
- 真实 HEIC / HEIF 文件：手边没有样本，只有代码路径与错误文案；「Safari 能解码」来自 API 能力，未在真机验证。
- 超过 60 MB 的单张图片：只按代码路径推断会被拦截，未做实际压测。
- CMYK / 16-bit / 渐进式 JPEG 的「原字节被 pdf-lib 拒绝 → 自动重编码」分支：单元测试用一个截断的 PNG 覆盖了回退逻辑，但没有真实 CMYK 样本。
- 表单字段「外观是否完整保留」只验证了字段不再可交互，未逐像素比对。
- 超过 100 MB 的单文件：仅按代码路径推断，未做实际压测。

## 与旧版桌面版的关系

| | 桌面版（旧） | Web 版（本仓库） |
| --- | --- | --- |
| 技术 | Python 3 + PySide6 + pypdf | React + TypeScript + pdf-lib |
| 页码规则 | 1 基、允许重复、顺序即输入顺序 | 完全一致 |
| 加密 PDF | 支持输入密码 | 第一版明确拒绝 |
| 预览 | 无缩略图 | PDF.js 按需渲染 |
| 输出位置 | 写本地文件（临时文件 + 原子替换） | 浏览器下载 |
| 进度 | 按文件粒度 | 按页粒度，可取消 |
| 图片转 PDF | 无此功能 | 新增：多图排序、旋转、纸张/边距/适配/背景/质量 |

旧版的 `pdfjoiner/core.py` 只作为行为参考，未参与构建。

## 许可

本仓库为项目交付代码。第三方依赖许可见 `node_modules` 中各包的 LICENSE：pdf-lib（MIT）、pdfjs-dist（Apache-2.0）、React（MIT）、dnd-kit（MIT）、Radix（MIT）。对外分发前请自行核对。
