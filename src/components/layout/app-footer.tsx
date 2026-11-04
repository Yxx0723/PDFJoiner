import { Lock } from 'lucide-react';

export function AppFooter() {
  return (
    <footer className="border-t border-border/60 bg-background/40">
      <div className="container flex flex-col items-center justify-between gap-1.5 py-5 text-[11px] text-muted-foreground sm:flex-row">
        <p>PDFJoiner Web · 纯前端实现 · pdf-lib + PDF.js</p>
        <p className="flex items-center gap-1.5">
          <Lock className="size-3" />
          无后端 · 无账户 · 无第三方请求
        </p>
      </div>
    </footer>
  );
}
