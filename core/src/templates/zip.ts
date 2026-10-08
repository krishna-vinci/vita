import { extname } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

export const UPLOAD_LIMIT = 10 * 1024 * 1024;
export const EXTENSIONS = new Set([
  ".tex",
  ".cls",
  ".sty",
  ".bst",
  ".bib",
  ".cfg",
  ".def",
  ".ttf",
  ".otf",
  ".png",
  ".jpg",
  ".pdf",
  ".eps",
]);
export class TemplateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TemplateError";
  }
}
export function safeFilename(name: string): string {
  const parts = name.split("/");
  if (
    !name ||
    /^[\\/]|^[a-zA-Z]:/.test(name) ||
    name.includes("\\") ||
    [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    parts.some((p) => !p || p === "." || p === ".." || p === ".git" || p === ".vita") ||
    !EXTENSIONS.has(extname(name).toLowerCase())
  ) {
    throw new TemplateError("invalid-entry", `Unsupported or unsafe template path: ${name}`);
  }
  return name;
}

// Read the central directory before inflating anything. Expanded bytes are capped as well as upload bytes.
export function unzip(bytes: Uint8Array): Map<string, Buffer> {
  const zip = Buffer.from(bytes);
  const fail = (): never => {
    throw new TemplateError("invalid-zip", "Invalid or unsupported ZIP archive");
  };
  try {
    let end = zip.length - 22;
    for (; end >= Math.max(0, zip.length - 65557); end--) {
      if (zip.readUInt32LE(end) === 0x06054b50 && end + 22 + zip.readUInt16LE(end + 20) === zip.length) break;
    }
    if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50) fail();
    const count = zip.readUInt16LE(end + 10);
    const size = zip.readUInt32LE(end + 12);
    let offset = zip.readUInt32LE(end + 16);
    if (
      zip.readUInt16LE(end + 4) ||
      zip.readUInt16LE(end + 6) ||
      zip.readUInt16LE(end + 8) !== count ||
      count < 1 ||
      count > 200 ||
      offset + size !== end
    )
      fail();
    const files = new Map<string, Buffer>();
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (zip.readUInt32LE(offset) !== 0x02014b50) fail();
      const flags = zip.readUInt16LE(offset + 8);
      const method = zip.readUInt16LE(offset + 10);
      const crc = zip.readUInt32LE(offset + 16);
      const compressed = zip.readUInt32LE(offset + 20);
      const expanded = zip.readUInt32LE(offset + 24);
      const nameLength = zip.readUInt16LE(offset + 28);
      const extra = zip.readUInt16LE(offset + 30);
      const comment = zip.readUInt16LE(offset + 32);
      const attributes = zip.readUInt32LE(offset + 38);
      const local = zip.readUInt32LE(offset + 42);
      const rawName = zip.subarray(offset + 46, offset + 46 + nameLength);
      const name = safeFilename(rawName.toString("utf8"));
      if (!Buffer.from(name).equals(rawName) || files.has(name)) fail();
      const kind = (attributes >>> 16) & 0xf000;
      if ((kind !== 0 && kind !== 0x8000) || attributes & 0x10)
        throw new TemplateError("invalid-entry", `ZIP entries must be regular files: ${name}`);
      total += expanded;
      if (total > UPLOAD_LIMIT) throw new TemplateError("upload-too-large", "Expanded template exceeds 10 MB");
      if (
        flags & ~0x808 ||
        ![0, 8].includes(method) ||
        zip.readUInt16LE(offset + 34) !== 0 ||
        local >= offset ||
        zip.readUInt32LE(local) !== 0x04034b50 ||
        zip.readUInt16LE(local + 6) !== flags ||
        zip.readUInt16LE(local + 8) !== method
      )
        fail();
      const localNameLength = zip.readUInt16LE(local + 26);
      const start = local + 30 + localNameLength + zip.readUInt16LE(local + 28);
      if (
        !zip.subarray(local + 30, local + 30 + localNameLength).equals(rawName) ||
        start + compressed > zip.readUInt32LE(end + 16)
      )
        fail();
      const payload = zip.subarray(start, start + compressed);
      const data =
        method === 0
          ? Buffer.from(payload)
          : inflateRawSync(payload, { maxOutputLength: Math.max(1, Math.min(expanded, UPLOAD_LIMIT)) });
      if (data.length !== expanded || crc32(data) !== crc) fail();
      files.set(name, data);
      offset += 46 + nameLength + extra + comment;
    }
    if (offset !== end) fail();
    return files;
  } catch (error) {
    if (error instanceof TemplateError) throw error;
    return fail();
  }
}
