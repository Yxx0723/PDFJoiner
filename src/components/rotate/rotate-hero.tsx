import { FileStack, History, RotateCw, ShieldCheck, WifiOff, Zap } from 'lucide-react';

import { DropZone } from '@/components/upload/drop-zone';
import { routeHref } from '@/lib/use-route';

const FEATURES = [
  {
    icon: RotateCw,
    title: '单页、选页、范围或全篇',
    description: '每一页都能单独左右转 90°、转 180°，也可以按页码范围或勾选结果批量旋转。',
  },
  {
    icon: FileStack,
    title: '只改方向，不动内容',
    description: '写入 PDF 页面的 /Rotate 属性，保留原始文字、矢量图形、图片和纸张尺寸，绝不转成图片。',
  },
  {
    icon: History,
    title: '可撤销、可重做',
    description: '每一步都进历史栈；恢复原始方向会回到导入时的角度，而不是粗暴地全部归零。',
  },
];

export function RotateHero({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <section className="mx-auto max-w-3xl pb-12 pt-6 text-center sm:pt-12">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-card/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
        <RotateCw className="size-3 text-primary" />
        纯浏览器旋转 · 无需注册
      </span>

      <h1 className="mt-5 text-balance text-[27px] font-semibold leading-[1.18] tracking-tight sm:text-[38px] lg:text-[42px]">
        把 PDF 页面转到正确方向
      </h1>
      <p className="mx-auto mt-3.5 max-w-[34rem] text-balance text-[13.5px] leading-relaxed text-muted-foreground sm:text-[15px]">
        扫描件歪了、横竖混排、单页方向不对？导入后逐页调整，实时预览，最后导出一份新的 PDF。
        全程在你的浏览器内存中完成，服务器从头到尾看不到你的文件。
      </p>

      <div className="mx-auto mt-7 max-w-2xl">
        <DropZone
          onFiles={onFiles}
          title="拖入 PDF，或点击选择文件"
          draggingTitle="松开即可载入这份 PDF"
          subtitle="一次处理一份 PDF · 单个文件最大 200 MB"
          cta="选择 PDF 文件"
        />
      </div>

      <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11.5px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <WifiOff className="size-3.5" />
          零上传、零第三方请求
        </li>
        <li className="flex items-center gap-1.5">
          <FileStack className="size-3.5" />
          原始文件只读，另存为新 PDF
        </li>
        <li className="flex items-center gap-1.5">
          <Zap className="size-3.5" />
          Web Worker 后台处理
        </li>
        <li className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" />
          关闭页面即清空
        </li>
      </ul>

      <div className="mt-10 grid gap-3 text-left sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-xl border border-border/70 bg-card/60 p-4 shadow-soft backdrop-blur-sm"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
              <feature.icon className="size-4" />
            </span>
            <h2 className="mt-2.5 text-[13px] font-medium tracking-tight">{feature.title}</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              {feature.description}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-6 text-[11px] text-muted-foreground/80">
        也可以先去别的工具处理：
        <a href={routeHref('merge')} className="mx-1 underline underline-offset-2 hover:text-foreground">
          PDF 合并
        </a>
        ·
        <a href={routeHref('split')} className="mx-1 underline underline-offset-2 hover:text-foreground">
          PDF 拆分
        </a>
        ·
        <a href={routeHref('images')} className="mx-1 underline underline-offset-2 hover:text-foreground">
          图片转 PDF
        </a>
      </p>
    </section>
  );
}
