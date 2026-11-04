import { Gauge, Layers, ShieldCheck, Sparkles, WifiOff, Zap } from 'lucide-react';

import { DropZone } from '@/components/upload/drop-zone';

const FEATURES = [
  {
    icon: Layers,
    title: '真实页面合并',
    description:
      '用 pdf-lib 复制原始页面对象，保留矢量文字、页面尺寸与方向，不会把页面转成低清图片。',
  },
  {
    icon: ShieldCheck,
    title: '文件不出浏览器',
    description:
      '没有上传接口、没有后端、没有第三方请求。PDF 只在当前标签页的内存里，刷新即清空。',
  },
  {
    icon: Gauge,
    title: '大文件也不卡',
    description:
      '解析与合并都在 Web Worker 中执行，缩略图按需渲染并按页缓存，主线程始终保持可交互。',
  },
];

export function Hero({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <section className="mx-auto max-w-3xl pb-12 pt-6 text-center sm:pt-12">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-card/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
        <Sparkles className="size-3 text-primary" />
        纯浏览器合并 · 无需注册
      </span>

      <h1 className="mt-5 text-balance text-[27px] font-semibold leading-[1.18] tracking-tight sm:text-[38px] lg:text-[42px]">
        把多个 PDF 合成一份
      </h1>
      <p className="mx-auto mt-3.5 max-w-[34rem] text-balance text-[13.5px] leading-relaxed text-muted-foreground sm:text-[15px]">
        拖进来、排好序、选好页面，一键下载。解析与合并全部在你的浏览器内存中完成，
        服务器从头到尾看不到你的文件。
      </p>

      <div className="mx-auto mt-7 max-w-2xl">
        <DropZone onFiles={onFiles} />
      </div>

      <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11.5px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <WifiOff className="size-3.5" />
          零上传、零第三方请求
        </li>
        <li className="flex items-center gap-1.5">
          <Layers className="size-3.5" />
          保留原始矢量与页面尺寸
        </li>
        <li className="flex items-center gap-1.5">
          <Zap className="size-3.5" />
          无需安装
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
    </section>
  );
}
