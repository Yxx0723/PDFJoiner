/**
 * ZIP packaging for split results.
 *
 * JSZip is imported dynamically so the ~100 kB library never reaches the initial
 * bundle of a tool that does not need it until the user asks for a bundle.
 *
 * Compression is deliberately `STORE` (no deflate): PDFs are already compressed
 * internally, so deflating them again costs CPU on the main thread and typically
 * saves < 2%. Storing keeps the archive byte-for-byte identical to the PDFs the
 * user can download individually — which also makes the round-trip verifiable.
 */

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

export async function buildZip(entries: ZipEntry[]): Promise<Blob> {
  if (entries.length === 0) throw new Error('没有可打包的文件。');

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  for (const entry of entries) {
    zip.file(entry.name, entry.bytes);
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'STORE',
    platform: 'DOS',
  });
}
