import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  PageBreak,
  WidthType,
} from "docx";
import { writeFile, readFile } from "node:fs/promises";
const p = (text) =>
  new Paragraph({
    children: [new TextRun({ text, font: "Sarabun", size: 28 })],
  });
const image = await readFile("src/SabuySign.Web/wwwroot/favicon-32x32.png");
const doc = new Document({
  creator: "DocNori test",
  styles: { default: { document: { run: { font: "Sarabun", size: 28 } } } },
  sections: [
    {
      properties: {},
      children: [
        p("เอกสารทดสอบภาษาไทย"),
        p("กำลังตรวจสอบสระและวรรณยุกต์ น้ำ ผู้ใช้ กุ้ง"),
        p("Word to PDF layout verification"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [p("รายการ")] }),
                new TableCell({ children: [p("จำนวน")] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [p("เอกสารภาษาไทย")] }),
                new TableCell({ children: [p("123")] }),
              ],
            }),
          ],
        }),
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: image,
              transformation: { width: 80, height: 40 },
            }),
          ],
        }),
        new Paragraph({ children: [new PageBreak()] }),
        p("หน้าที่สอง"),
        p("Second page - preserved page break"),
      ],
    },
  ],
});
await writeFile("tests/fixtures/word-thai.docx", await Packer.toBuffer(doc));
