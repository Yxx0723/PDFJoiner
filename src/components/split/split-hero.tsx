import { FileStack, Scissors, ShieldCheck, SplitSquareVertical, WifiOff, Zap } from 'lucide-react';

import { DropZone } from '@/components/upload/drop-zone';

const FEATURES = [
  {
    icon: SplitSquareVertical,
    title: '四种拆法',
    description: '按页码范围、提取指定页面、逐页拆分，或每 N 页一份，最后一份不足也照常生成。',
  },
  {
    icon: ShieldCheck,
    title: '文件不出浏览器',
    description: '没有上传接口、没有后端、没有第三方请求。PDF 只在当前标签页的内存里，刷新即清空。',
  },
  {
    icon: FileStack,
    title: '页面对象级复制',
    description: '每份结果都由 pdf-lib 复制原始页面对象生成，保留矢量文字、纸张尺寸与方向，不转图片。',
  },
];

export function SplitHero({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <section className="mx-auto max-w-3xl pb-12 pt-6 text-center sm:pt-12">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-card/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
        <Scissors className="size-3 text-primary" />
        纯浏览器拆分 · 无需注册
      </span>

      <h1 className="mt-5 text-balance text-[27px] font-semibold leading-[1.18] tracking-tight sm:text-[38px] lg:text-[42px]">
        把一份 PDF 拆成多份
      </h1>
      <p className="mx-auto mt-3.5 max-w-[34rem] text-balance text-[13.5px] leading-relaxed text-muted-foreground sm:text-[15px]">
        按页码范围、提取指定页、逐页拆开，或固定每 N 页一份。拆分全程在你的浏览器内存中完成，
        服务器从头到尾看不到你的文件。
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
          保留原始矢量与页面尺寸
        </li>
        <li className="flex items-center gap-1.5">
          <Zap className="size-3.5" />
          支持 ZIP 打包下载
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
