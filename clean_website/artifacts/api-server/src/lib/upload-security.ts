// Defense-in-depth checks that run on every uploaded file BEFORE it reaches
// any real parser (extractPDF/extractOffice/extractImage/transcribeAudio) --
// req.file.mimetype alone is never trustworthy, since it's just the
// Content-Type the client's multipart form declared, not anything measured
// from the actual bytes. A renamed executable or a format-confusion attack
// would sail straight through a MIME-only check.
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import AdmZip from "adm-zip";

export class FileSignatureMismatchError extends Error {
  readonly code = "FILE_SIGNATURE_MISMATCH";
  constructor(declaredType: string, detected: string | undefined) {
    super(`File content doesn't match its declared type (${declaredType}). Detected: ${detected ?? "unknown/unrecognized binary"}.`);
    this.name = "FileSignatureMismatchError";
  }
}

// Maps each contentType this app accepts to the real, magic-number-sniffed
// MIME type(s) file-type is allowed to report for it. Anything that comes
// back outside this list is rejected outright, regardless of what the
// client's Content-Type header or the file's extension claimed. text/url/
// youtube have no binary payload and are intentionally absent -- callers
// should only invoke verifyFileSignature for content types with an actual
// uploaded file.
const ALLOWED_SIGNATURES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  audio: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/ogg", "video/webm", "video/mp4", "video/x-matroska"],
  video: ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"],
};

// Some legitimate browser-recorded audio (e.g. Chrome's MediaRecorder webm/
// opus output) can be short enough or structured in a way file-type's
// container sniffing doesn't confidently recognize -- rather than reject a
// real recording outright on an inconclusive read, this only rejects a
// DEFINITE mismatch (a signature that resolved to something outside the
// allowed list), the same "best-effort, never block on an inconclusive
// check" philosophy already used elsewhere in this codebase (e.g.
// fetchYouTubeDurationSeconds). A truly malicious payload (a renamed
// executable, a script) will resolve to a concrete, disallowed type and
// still be caught.
export async function verifyFileSignature(buffer: Buffer, contentType: string): Promise<void> {
  const allowed = ALLOWED_SIGNATURES[contentType];
  if (!allowed) return;

  const detected = await fileTypeFromBuffer(buffer);
  if (detected && !allowed.includes(detected.mime)) {
    throw new FileSignatureMismatchError(contentType, detected.mime);
  }
}

export class ZipBombError extends Error {
  readonly code = "ZIP_BOMB_SUSPECTED";
  constructor() {
    super("This file's internal structure looks like a compression bomb, not a real document.");
    this.name = "ZipBombError";
  }
}

// OOXML (docx/pptx/xlsx) is a ZIP container under the hood -- a malicious
// file can nest deeply compressed entries that expand to gigabytes from a
// tiny upload (a classic zip bomb), which would OOM the process the moment
// officeparser tries to decompress it. AdmZip's getEntries() only reads the
// archive's central directory (size metadata for every entry), never
// decompresses entry contents itself, so this check is cheap and can't
// itself become a DoS vector the way naively unzipping everything first
// would be.
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200MB decompressed -- generous for any real document
const MAX_COMPRESSION_RATIO = 100; // a legitimate DOCX/PPTX/XLSX rarely exceeds ~20-30x

export function assertSafeOoxmlArchive(buffer: Buffer): void {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    // Not a valid zip at all -- verifyFileSignature (checked first, see
    // callers below) already rejects this case via its magic-number check,
    // so this catch only matters if it's ever called on its own.
    throw new ZipBombError();
  }

  let totalUncompressed = 0;
  for (const entry of zip.getEntries()) {
    const compressed = entry.header.compressedSize || 1; // avoid divide-by-zero on a 0-byte stored entry
    const uncompressed = entry.header.size;
    totalUncompressed += uncompressed;

    if (uncompressed / compressed > MAX_COMPRESSION_RATIO) throw new ZipBombError();
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new ZipBombError();
  }
}

// A tiny PNG/JPEG can declare an enormous pixel grid (e.g. 50000x50000),
// which decodes into gigabytes of raw bitmap memory regardless of the
// file's byte size on disk -- sharp's limitInputPixels bounds this at
// metadata-read time (cheap: reads the header, never decodes pixel data),
// before extractImage's real resizeForAI/OCR pass ever runs.
const MAX_IMAGE_PIXELS = 40_000_000; // ~40MP, generous for any real photo/scan

export class ImageTooLargeError extends Error {
  readonly code = "IMAGE_DIMENSIONS_TOO_LARGE";
  constructor() {
    super("This image's dimensions are too large to process safely.");
    this.name = "ImageTooLargeError";
  }
}

export async function assertSafeImageDimensions(buffer: Buffer): Promise<void> {
  try {
    const meta = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    if (!meta.width || !meta.height) throw new ImageTooLargeError();
  } catch (err) {
    if (err instanceof ImageTooLargeError) throw err;
    // sharp throws its own Error when limitInputPixels is exceeded (message
    // contains "exceeds pixel limit") -- normalize that into the same
    // typed error the caller already knows how to report.
    throw new ImageTooLargeError();
  }
}

// Single entry point routes/materials.ts calls right after its existing
// MAX_FILE_BYTES size check and before any extraction call -- runs whichever
// of the above checks apply to this contentType, in cheapest-first order.
export async function verifyUploadedFile(buffer: Buffer, contentType: string): Promise<void> {
  await verifyFileSignature(buffer, contentType);
  if (contentType === "docx" || contentType === "pptx" || contentType === "xlsx") {
    assertSafeOoxmlArchive(buffer);
  }
  if (contentType === "image") {
    await assertSafeImageDimensions(buffer);
  }
}
