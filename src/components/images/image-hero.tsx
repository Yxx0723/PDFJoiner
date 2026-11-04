import { Gauge, Images, LayoutTemplate, ShieldCheck, Sparkles, WifiOff } from 'lucide-react';

import { DropZone } from '@/components/upload/drop-zone';

const FEATURES = [
  {
    icon: LayoutTemplate,
    title: '每张图片一页',
    description:
      '用 pdf-lib 写入真实页面：A4 / A5 / Letter / Legal / 原图尺寸 / 自定义，配合边距、方向与三种适配方式。',
  },
  {
    icon: Gauge,
    title: '不牺牲清晰度',
    description:
      'JPEG、PNG 在无需旋转与缩放时按原字节嵌入；只有必须的情况下才重编码，压缩模式也会保留 PNG 的透明通道。',
  },
  {
    icon: ShieldCheck,
    title: '图片不出浏览器',
    description:
      '没有上传接口、没有第三方转换 API。解码、旋转与排版都在这台设备的 Worker 里完成，关闭页面即清空。',
  },
];

export function ImageHero({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <section className="mx-auto max-w-3xl pb-12 pt-6 text-center sm:pt-12">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-card/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
        <Sparkles className="size-3 text-primary" />
        纯浏览器转换 · 无需注册
      </span>

      <h1 className="mt-5 text-balance text-[27px] font-semibold leading-[1.18] tracking-tight sm:text-[38px] lg:text-[42px]">
        把图片拼成一份 PDF
      </h1>
      <p className="mx-auto mt-3.5 max-w-[34rem] text-balance text-[13.5px] leading-relaxed text-muted-foreground sm:text-[15px]">
        拖入照片、截图或扫描件，排序、旋转、设定纸张与边距，一键生成。图片始终停留在这台设备上。
      </p>

      <div className="mx-auto mt-7 max-w-2xl">
        <DropZone onFiles={onFiles} kind="image" />
      </div>

      <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11.5px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <WifiOff className="size-3.5" />
          零上传、零第三方请求
        </li>
        <li className="flex items-center gap-1.5">
          <Images className="size-3.5" />
          支持 JPG / PNG / WebP / BMP / GIF
        </li>
        <li className="flex items-center gap-1.5">
          <LayoutTemplate className="size-3.5" />
          预览即输出的排版规则
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
