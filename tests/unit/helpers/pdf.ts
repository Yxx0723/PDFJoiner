import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFPage,
} from 'pdf-lib';

export const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures');

export function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

function resolve(doc: PDFDocument, object: unknown): unknown {
  return object instanceof PDFRef ? doc.context.lookup(object) : object;
}

function contentStreams(page: PDFPage, doc: PDFDocument): PDFStream[] {
  const contents = page.node.get(PDFName.of('Contents'));
  if (!contents) return [];

  const raw = resolve(doc, contents);
  if (raw instanceof PDFArray) {
    const streams: PDFStream[] = [];
    for (let index = 0; index < raw.size(); index += 1) {
      const item = resolve(doc, raw.get(index));
      if (item instanceof PDFStream) streams.push(item);
    }
    return streams;
  }
  return raw instanceof PDFStream ? [raw] : [];
}

function hexToAscii(hex: string): string {
  let text = '';
  for (let index = 0; index + 1 < hex.length; index += 2) {
    text += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
  }
  return text;
}

/**
 * Collects the text drawn by a page, straight from its (decoded) content
 * stream. Good enough for fixtures whose text is not subset-encoded, and it
 * proves the page still contains text-drawing operators rather than pixels.
 */
export function pageText(page: PDFPage, doc: PDFDocument): string {
  const parts: string[] = [];

  for (const stream of contentStreams(page, doc)) {
    const filter = stream.dict.get(PDFName.of('Filter'));
    const contents = (stream as unknown as { contents: Uint8Array }).contents;
    const bytes = filter ? inflateSync(Buffer.from(contents)) : Buffer.from(contents);
    const source = bytes.toString('latin1');

    for (const match of source.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
      parts.push(hexToAscii(match[1].replace(/\s+/g, '')));
    }
    for (const match of source.matchAll(/\(((?:\\.|[^)])*)\)\s*Tj/g)) {
      parts.push(match[1]);
    }
  }

  return parts.join('\n');
}

/** True when the page draws text operators (as opposed to a single bitmap). */
export function pageHasTextOperators(page: PDFPage, doc: PDFDocument): boolean {
  return contentStreams(page, doc).some((stream) => {
    const filter = stream.dict.get(PDFName.of('Filter'));
    const contents = (stream as unknown as { contents: Uint8Array }).contents;
    const bytes = filter ? inflateSync(Buffer.from(contents)) : Buffer.from(contents);
    const source = bytes.toString('latin1');
    return source.includes('BT') && source.includes('Tj');
  });
}

/** Names of image XObjects referenced by a page, if any. */
export function imageXObjectNames(page: PDFPage, doc: PDFDocument): string[] {
  const resources = page.node.lookup(PDFName.of('Resources'));
  if (!(resources instanceof PDFDict)) return [];
  const xobjects = resources.lookup(PDFName.of('XObject'));
  if (!(xobjects instanceof PDFDict)) return [];

  const names: string[] = [];
  const entries = xobjects.entries();
  for (const [name, ref] of entries) {
    const stream = resolve(doc, ref);
    if (stream instanceof PDFStream) {
      const subtype = stream.dict.get(PDFName.of('Subtype'));
      if (subtype && subtype.toString() === '/Image') names.push(name.toString());
    }
  }
  return names;
}

export async function loadDoc(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

/** Decoded content stream of a page, as latin1 text (enough for operator checks). */
export function pageContent(page: PDFPage, doc: PDFDocument): string {
  return contentStreams(page, doc)
    .map((stream) => {
      const filter = stream.dict.get(PDFName.of('Filter'));
      const contents = (stream as unknown as { contents: Uint8Array }).contents;
      const bytes = filter ? inflateSync(Buffer.from(contents)) : Buffer.from(contents);
      return bytes.toString('latin1');
    })
    .join('\n');
}

export interface ImageXObject {
  name: string;
  dict: PDFDict;
}

/** Image XObjects referenced by a page, with their dictionaries resolved. */
export function imageXObjects(page: PDFPage, doc: PDFDocument): ImageXObject[] {
  const resources = page.node.lookup(PDFName.of('Resources'));
  if (!(resources instanceof PDFDict)) return [];
  const xobjects = resources.lookup(PDFName.of('XObject'));
  if (!(xobjects instanceof PDFDict)) return [];

  const found: ImageXObject[] = [];
  for (const [name, ref] of xobjects.entries()) {
    const stream = resolve(doc, ref);
    if (stream instanceof PDFStream) {
      const subtype = stream.dict.get(PDFName.of('Subtype'));
      if (subtype && subtype.toString() === '/Image') {
        found.push({ name: name.toString(), dict: stream.dict });
      }
    }
  }
  return found;
}

/** `/Width` and `/Height` of the first image XObject on a page. */
export function imagePixelSize(
  page: PDFPage,
  doc: PDFDocument,
): { width: number; height: number } | null {
  const [first] = imageXObjects(page, doc);
  if (!first) return null;
  const read = (key: string) => {
    const value = first.dict.get(PDFName.of(key));
    return value ? Number(value.toString()) : Number.NaN;
  };
  return { width: read('Width'), height: read('Height') };
}

