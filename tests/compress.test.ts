import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  degrees,
} from "pdf-lib";
import {
  compressPdf,
  openPdf,
  imageCandidate,
  MAX_BYTES,
} from "../src/SabuySign.Web/Client/compress/pdf";

test("compression preserves pages, text streams, forms and rotation", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 500]);
  page.drawText("Keep searchable text");
  page.setRotation(degrees(90));
  const field = doc.getForm().createTextField("name");
  field.setText("Alice");
  field.addToPage(page);
  const source = await doc.save({ useObjectStreams: false });
  const result = await compressPdf(source, "balanced", async () => undefined);
  assert.ok(result.bytes.length < source.length);
  const output = await PDFDocument.load(result.bytes);
  assert.equal(output.getPageCount(), 1);
  assert.equal(output.getPage(0).getRotation().angle, 90);
  assert.equal(output.getPage(0).getWidth(), 300);
  assert.equal(output.getForm().getTextField("name").getText(), "Alice");
  assert.equal(
    output.getPage(0).node.Contents()?.toString(),
    page.node.Contents()?.toString(),
  );
});

test("never returns a larger file and rejects malformed, huge and signed PDFs", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const source = await doc.save();
  const result = await compressPdf(source, "small", async () => undefined);
  assert.ok(result.bytes.length <= source.length);
  await assert.rejects(openPdf(new Uint8Array(MAX_BYTES + 1)), /50 MB/);
  await assert.rejects(openPdf(new TextEncoder().encode("not a pdf")), /PDF/);
  doc.context.register(
    doc.context.obj({ Type: "Sig", ByteRange: [0, 10, 20, 30] }),
  );
  await assert.rejects(openPdf(await doc.save()), /ลายเซ็นดิจิทัล/);
});

test("only opaque 8-bit RGB JPEGs with bounded dimensions can be rewritten", async () => {
  const doc = await PDFDocument.create();
  const dict = doc.context.obj({
    Type: "XObject",
    Subtype: "Image",
    Filter: "DCTDecode",
    ColorSpace: "DeviceRGB",
    BitsPerComponent: 8,
    Width: 2000,
    Height: 1000,
  });
  const stream = PDFRawStream.of(dict, new Uint8Array(10000));
  assert.deepEqual(imageCandidate(stream), { width: 2000, height: 1000 });
  for (const key of [
    "SMask",
    "Mask",
    "Decode",
    "DecodeParms",
    "ImageMask",
    "Alternates",
    "SMaskInData",
  ]) {
    dict.set(PDFName.of(key), PDFNumber.of(1));
    assert.equal(imageCandidate(stream), undefined);
    dict.delete(PDFName.of(key));
  }
  dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceCMYK"));
  assert.equal(imageCandidate(stream), undefined);
  dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
  dict.set(PDFName.of("Width"), PDFNumber.of(100000));
  assert.equal(imageCandidate(stream), undefined);
});

test("rewrites smaller image streams at the same reference and retains other objects", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const stream = doc.context.stream(new Uint8Array(10000), {
    Type: "XObject",
    Subtype: "Image",
    Filter: "DCTDecode",
    ColorSpace: "DeviceRGB",
    BitsPerComponent: 8,
    Width: 2000,
    Height: 1000,
  });
  const ref = doc.context.register(stream);
  const source = await doc.save();
  const result = await compressPdf(source, "balanced", async () => ({
    bytes: new Uint8Array(2000),
    width: 1000,
    height: 500,
  }));
  assert.equal(result.optimizedImages, 1);
  const output = await PDFDocument.load(result.bytes);
  const image = output.context.lookup(ref) as PDFRawStream;
  assert.equal(
    image.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber(),
    1000,
  );
  assert.equal(image.getContents().length, 2000);
});

test("rejects unsupported XFA, encryption and page limits before rewriting", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.catalog.set(
    PDFName.of("AcroForm"),
    doc.context.obj({ XFA: "dynamic form data" }),
  );
  await assert.rejects(openPdf(await doc.save()), /แบบฟอร์ม/);
  doc.catalog.delete(PDFName.of("AcroForm"));
  doc.context.trailerInfo.Encrypt = doc.context.register(
    doc.context.obj({ Filter: "Standard" }),
  );
  await assert.rejects(openPdf(await doc.save()), /รหัสผ่าน/);
  delete doc.context.trailerInfo.Encrypt;
  for (let i = 0; i < 100; i++) doc.addPage();
  await assert.rejects(openPdf(await doc.save()), /100 หน้า/);
});
