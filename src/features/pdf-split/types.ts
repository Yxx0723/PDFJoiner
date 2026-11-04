/**
 * Types for the PDF split tool.
 *
 * Kept free of pdf-lib and DOM imports so the plan builder can be unit tested
 * in Node and reused by both the UI and the worker.
 */

export type SplitMode = 'ranges' | 'extract' | 'each' | 'chunks';

/** How output files are named. */
export type NamingRule = 'index' | 'pages';

export interface RangeRow {
  id: string;
  /** Raw text the user typed, e.g. `1-5` or `3,7,9-11`. */
  text: string;
}

export interface SplitSettings {
  mode: SplitMode;
  /** Only used by `mode: 'ranges'`. */
  ranges: RangeRow[];
  /** Ordered, 0-based pages. Only used by `mode: 'extract'`. */
  extractPages: number[];
  /** Pages per file. Only used by `mode: 'chunks'`. */
  chunkSize: number;
  /** File name stem for every output. */
  prefix: string;
  naming: NamingRule;
}

/** One file that will be produced. */
export interface SplitPlanOutput {
  id: string;
  /** Final file name, including `.pdf`. */
  name: string;
  /** Ordered, 0-based page indices copied into this file. */
  pages: number[];
  /** Short human description, e.g. `第 1–5 页`. */
  label: string;
  /** 1-based source page numbers, for chips in the UI. */
  pageNumbers: number[];
}

export interface SplitPlan {
  outputs: SplitPlanOutput[];
  /** Blocking problems. The build button stays disabled while non-empty. */
  errors: string[];
  /** Non-blocking remarks, e.g. pages that no range covers. */
  notes: string[];
  /** Validation message keyed by `RangeRow.id`. */
  rowErrors: Record<string, string>;
}

export const SPLIT_MODE_META: Record<
  SplitMode,
  { title: string; short: string; description: string }
> = {
  ranges: {
    title: '按页码范围',
    short: '范围',
    description: '每个范围生成一个 PDF，例如 1-5 / 6-10',
  },
  extract: {
    title: '提取指定页面',
    short: '提取',
    description: '把选中的页面合并成一个新 PDF，顺序由你决定',
  },
  each: {
    title: '每页单独拆分',
    short: '逐页',
    description: '每一页各存一个 PDF，编号连续',
  },
  chunks: {
    title: '按固定页数',
    short: '按份数',
    description: '每 N 页一份，最后一份不足也照常生成',
  },
};

export const DEFAULT_CHUNK_SIZE = 5;
