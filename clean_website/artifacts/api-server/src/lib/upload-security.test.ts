import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import sharp from "sharp";
import {
  verifyFileSignature,
  FileSignatureMismatchError,
  assertSafeOoxmlArchive,
  ZipBombError,
  assertSafeImageDimensions,
} from "./upload-security";

describe("verifyFileSignature", () => {
  it("accepts a real PDF signature", async () => {
    const realPdf = Buffer.from("%PDF-1.4\n%some content here to pad it out past the header bytes\n");
    await expect(verifyFileSignature(realPdf, "pdf")).resolves.toBeUndefined();
  });

  it("rejects a renamed executable claiming to be a PDF", async () => {
    // \x7fELF -- the real magic number for a Linux executable, not a PDF.
    const fakeElf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(100)]);
    await expect(verifyFileSignature(fakeElf, "pdf")).rejects.toBeInstanceOf(FileSignatureMismatchError);
  });

  it("has no opinion on content types with no binary payload (text/url/youtube)", async () => {
    await expect(verifyFileSignature(Buffer.from("plain text"), "text")).resolves.toBeUndefined();
  });
});

describe("assertSafeOoxmlArchive", () => {
  it("accepts a normal, lightly-compressed zip entry", () => {
    const zip = new AdmZip();
    zip.addFile("document.xml", Buffer.from("<xml>normal document content</xml>"));
    expect(() => assertSafeOoxmlArchive(zip.toBuffer())).not.toThrow();
  });

  it("rejects a zip bomb (extreme compression ratio)", () => {
    const zip = new AdmZip();
    // 50MB of a single repeated byte compresses to almost nothing --
    // exactly the shape of a real zip-bomb payload, just smaller.
    zip.addFile("bomb.xml", Buffer.alloc(50 * 1024 * 1024, 0));
    expect(() => assertSafeOoxmlArchive(zip.toBuffer())).toThrow(ZipBombError);
  });

  it("rejects an invalid/corrupt zip buffer instead of throwing an unrelated error", () => {
    expect(() => assertSafeOoxmlArchive(Buffer.from("not a zip file at all"))).toThrow(ZipBombError);
  });
});

describe("assertSafeImageDimensions", () => {
  it("accepts a normal small image", async () => {
    const img = await sharp({ create: { width: 100, height: 100, channels: 3, background: "red" } }).png().toBuffer();
    await expect(assertSafeImageDimensions(img)).resolves.toBeUndefined();
  });
});
