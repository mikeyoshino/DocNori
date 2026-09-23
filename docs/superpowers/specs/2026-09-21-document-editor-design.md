# SabuySign: แบบระบบกรอกข้อความ PDF รุ่นแรก

วันที่: 21 กันยายน 2026

สถานะ: แบบที่ผู้ใช้อนุมัติให้เริ่ม implement แล้ว ข้อความด้านล่างเก็บบริบทการออกแบบก่อนพัฒนา; ผล implementation และข้อจำกัดล่าสุดอยู่ใน [รายงานการตรวจ](../../verification/2026-09-21-editor.md)

## 1. เป้าหมายและข้อสรุปที่ยืนยันแล้ว

สร้างเว็บเครื่องมือจัดการเอกสารที่เพิ่มความสามารถได้ในอนาคต เริ่มจากเปิด PDF เดิมแล้ววางข้อความไทยและอังกฤษลงตามตำแหน่ง ก่อนดาวน์โหลดไปใช้งาน โดยรักษารูปลักษณ์เอกสารต้นฉบับ

- ใช้ Blazor WebAssembly ร่วมกับ TypeScript สำหรับแกน editor
- รุ่นแรกเน้นคอมพิวเตอร์ เมาส์และคีย์บอร์ด
- เปิดเอกสารและกรอกข้อมูลโดยไม่ต้องล็อกอิน
- เงื่อนไขดาวน์โหลด การล็อกอิน และการหารายได้เป็นเรื่องสำหรับพิจารณาภายหลัง รุ่นทดลองต้องส่งออกไฟล์ได้เพื่อพิสูจน์คุณภาพ
- ประมวลผล PDF ใน browser ไม่ส่งไฟล์หรือข้อความที่กรอกขึ้น server
- ไม่เก็บเอกสารในบัญชี ไม่เก็บร่างอัตโนมัติหรือร่างบนเครื่อง
- รีเฟรชหรือปิดหน้าแล้วงานที่ยังไม่ดาวน์โหลดจะสูญหาย
- ข้อความใหม่ต้องเป็นข้อความจริง แสดงภาษาไทยถูก ฝังฟอนต์ ค้นหาและคัดลอกได้
- ใช้ PDF engine และ dependency แบบโอเพนซอร์สเท่านั้น ตรวจเงื่อนไขไลเซนส์ก่อนเลือก
- PostgreSQL บน Docker Compose เป็นข้อกำหนดสำหรับข้อมูลระบบในอนาคต ไม่ใช่ที่เก็บเอกสาร

ข้อสรุปเหล่านี้แทนข้อเสนอเดิมเรื่องร่าง การเก็บข้ามเครื่อง การเข้ารหัสเอกสารบน server และการกู้คืนเอกสารโดยผู้ดูแล ส่วน QR เซ็นเอกสารใน requirement เดิมยังอยู่นอกขอบเขตรุ่นแรก

## 2. ขอบเขตที่เสนอ

เปิด PDF หลายหน้า ดูภาพย่อ เลือกหน้า ซูม เพิ่มข้อความด้วยการคลิก แก้ไข ย้าย ปรับขนาดกล่อง ลบ ปรับขนาดและสีตัวอักษร จัดแนว และ Undo/Redo

เริ่มด้วย Sarabun ตัวปกติไฟล์เดียวที่ระบุเวอร์ชันและไลเซนส์ชัดเจน รองรับไทย อังกฤษ และข้อความผสม รวมถึงขึ้นบรรทัดด้วย Enter รุ่นแรกไม่ตัดคำไทยอัตโนมัติ ถ้าข้อความล้นกรอบต้องแจ้งและให้ขยายกรอบหรือปรับข้อความก่อนส่งออก ไม่ตัดข้อมูลเงียบ ๆ

ไม่แก้ข้อความเดิมใน PDF ไม่ทำ OCR ไม่จัดการ AcroForm/XFA เป็นฟอร์ม ไม่ทำลายเซ็นดิจิทัลหรือ QR และไม่แปลงทั้งหน้าเป็นภาพเพื่อส่งออก PDF ภาพสแกนใช้เป็นพื้นหลังแล้วเพิ่มข้อความได้

สำหรับรุ่นแรกเสนอให้ปฏิเสธไฟล์ที่เข้ารหัสหรือมีลายเซ็นดิจิทัล พร้อมข้อความอธิบายเพื่อไม่ให้เปลี่ยนความหมายของลายเซ็นโดยไม่ตั้งใจ ไฟล์เสียหายต้องแจ้งข้อผิดพลาดและคงต้นฉบับในเครื่องผู้ใช้ไว้

## 3. หน้าจอและลำดับใช้งาน

หน้าแรกอ้างอิงภาพแรก: พื้นขาว/เทาอ่อน สีฟ้าเป็นสีหลัก หัวข้อบอกงานที่ทำได้จริง และพื้นที่เปิด PDF เด่น ไม่มีคำโฆษณา AI หรือฟีเจอร์ที่ยังไม่มี

Editor อ้างอิงภาพที่สอง:

- ซ้าย: ภาพย่อและหมายเลขหน้า
- กลาง: หน้ากระดาษ PDF และกรอบข้อความที่เลือก
- ขวา: ค่าของข้อความที่เลือก ฟอนต์ ขนาด สี การจัดแนว และปุ่มดาวน์โหลด PDF
- แถบเครื่องมือ: เลือกวัตถุ เพิ่มข้อความ Undo/Redo และซูม
- ขณะพิมพ์ใช้ช่องข้อความ HTML เพื่อรองรับการป้อนภาษาไทยและการเลือกข้อความตามพฤติกรรม browser

ลำดับหลัก: เปิด PDF → แสดงหน้า → เพิ่ม/แก้ข้อความ → สร้าง PDF ผลลัพธ์ → เปิด preview จาก bytes ผลลัพธ์จริง → ดาวน์โหลด bytes ชุดเดียวกัน

การแก้ไขหลังสร้าง preview ทำให้ผลลัพธ์เดิมหมดอายุ ต้องสร้างใหม่ก่อนดาวน์โหลด เพื่อป้องกันดาวน์โหลดข้อมูลคนละรุ่นกับที่เห็น

สถานะที่ต้องรองรับ: ยังไม่มีไฟล์ กำลังเปิดไฟล์ พร้อมแก้ไข ไม่มีวัตถุที่เลือก กำลังสร้าง PDF preview พร้อมดาวน์โหลด และข้อผิดพลาดพร้อมวิธีแก้ ป้องกันการกดส่งออกซ้ำระหว่างประมวลผล และเก็บงานในหน่วยความจำไว้หากส่งออกล้มเหลว

แสดงข้อความว่าไม่เก็บร่างใกล้พื้นที่ทำงาน เตือนก่อนเปิดไฟล์ใหม่ทับงานเดิมและออกผ่าน navigation ภายในเว็บ ใช้ beforeunload เมื่อมีงานยังไม่ดาวน์โหลดเท่าที่ browser รองรับ โดยไม่รับประกันเตือนได้ทุกกรณี

## 4. สถาปัตยกรรมและความเป็นเจ้าของข้อมูล

```text
Browser
  Blazor UI (C#)
      ↕ commands / selection snapshots / status
  Editor module (TypeScript)
      ├─ Document session + Undo/Redo
      ├─ PDF renderer adapter → PDF.js candidate
      ├─ PDF export adapter → engine ที่ผ่านการทดลอง
      └─ Font assets + file download

Server: ส่ง static assets ให้ browser
Future API → PostgreSQL: เฉพาะข้อมูลระบบที่มี requirement จริง
```

Editor module ถือ document session, text objects และ Undo/Redo เป็นแหล่งข้อมูลหลัก Blazor ถือเฉพาะสถานะ UI และสำเนาค่าของวัตถุที่เลือก ไม่เก็บ document model อีกชุดที่แก้ไขได้อิสระ

การลากวางและซูมที่เกิดถี่ทำใน TypeScript ส่งการเปลี่ยนแปลงที่ยืนยันแล้วกลับ Blazor ไม่เรียกข้าม JS/C# ทุก pointer movement และไม่ส่ง PDF bytes ไปกลับระหว่างสอง runtime โดยไม่จำเป็น

ข้อมูลกล่องข้อความประกอบด้วย id, page index, ตำแหน่งและขนาดใน PDF user space, ข้อความต้นทาง Unicode, font id, ขนาดตัวอักษร, สี และการจัดแนว ต้องแปลง viewport ↔ PDF coordinates โดยคำนึงถึง CropBox, rotation และ page units; การซูมไม่เปลี่ยนข้อมูลตำแหน่งจริง

PDF adapter ต้องแยกหน้าที่แสดงผลกับส่งออก ไม่ผูก UI เข้ากับ API เฉพาะ engine และต้องรองรับการปิด session เพื่อคืน buffers, canvas, object URLs และ worker ที่ใช้งาน

Render เฉพาะหน้าที่มองเห็นและบริเวณใกล้เคียง thumbnail ลดความละเอียด แยกงานหนักออกจาก UI thread เมื่อ engine รองรับ worker ไม่สมมติว่า async เพียงอย่างเดียวทำให้งาน CPU ไม่บล็อกหน้าจอ

## 5. ความเป็นส่วนตัว

ไม่มี document upload endpoint สำหรับฟีเจอร์นี้ ไม่มีการส่ง PDF ชื่อไฟล์ ข้อความ thumbnails หรือ document-derived metadata เข้า API, logs, analytics หรือ crash reporting

ไม่เขียนเอกสารและงานแก้ไขลง localStorage, IndexedDB, Cache Storage หรือ server การดาวน์โหลดที่ผู้ใช้สั่งเป็นไฟล์ผลลัพธ์ที่ผู้ใช้เลือกเก็บเอง ไม่ถือเป็นร่างของแอป

ฟอนต์ PDF engine และ worker เสิร์ฟจากแอปเอง ไม่โหลด script จากบุคคลที่สามใน editor ใช้ Content Security Policy จำกัดแหล่งโหลดและการเชื่อมต่อให้แคบตามสิ่งที่ runtime ต้องใช้จริง

ทดสอบ network ทั้งเปิดไฟล์ กรอก preview ดาวน์โหลด และ error paths เพื่อยืนยันว่าไม่มีข้อมูลเอกสารออกจากเครื่อง ตรวจไม่ให้ error payload มีเนื้อหาเอกสาร

คำรับรองที่ใช้ได้เมื่อทดสอบผ่าน: “เอกสารถูกประมวลผลในเบราว์เซอร์และไม่ส่งขึ้นเซิร์ฟเวอร์” ไม่รับรองว่าไม่มีความเสี่ยงทุกกรณี เพราะยังต้องเชื่อถือโค้ดที่เว็บไซต์ส่งมา browser และอุปกรณ์ผู้ใช้ การคืนหน่วยความจำไม่ใช่การรับประกัน secure erase ระดับระบบปฏิบัติการ

## 6. โครงสร้างโปรเจกต์และ infrastructure

ใช้แอปที่แบ่งโมดูลชัดเจน ไม่เริ่มด้วย microservices จัด feature folders ภายในขอบเขตหน้าที่ และให้ dependency ชี้เข้าหา logic ที่ไม่ผูก infrastructure

```text
src/
  SabuySign.Web/
    Features/Home/
    Features/PdfEditor/
      Components/
      Interop/
    Client/editor/
      model/
      commands/
      rendering/
      export/
    Shared/
tests/
  Editor.Unit/
  Editor.E2E/
  PdfFixtures/
infra/
  compose.yaml
docs/
.editorconfig
global.json
Directory.Build.props
```

รุ่นแรกไม่สร้าง Domain/Application/Infrastructure projects ว่าง ๆ เพื่อให้ครบชื่อ Clean Architecture เมื่อมี backend feature จริงจึงเพิ่ม SabuySign.Api, Application, Domain และ Infrastructure ตามความจำเป็น โดยแยก EF Core/PostgreSQL ออกจาก business logic และจัด use case ตาม feature

Docker Compose เตรียม web host และ PostgreSQL พร้อม named volume/healthcheck ไม่เปิด DB สู่เครือข่ายสาธารณะ และให้ editor ใช้ได้โดยไม่ต้องพึ่ง DB ไม่มี document table, blob storage, queue หรือ Redis ในรุ่นแรก ไม่มี migration เปล่าจนกว่าจะมี schema ของระบบจริง

Pin SDK และ dependency versions ที่ผ่านการทดลอง เก็บ lockfiles ใช้ .editorconfig และ dotnet format สำหรับ C# พร้อม formatter/linter สำหรับ TypeScript/CSS

CI หลังมีโค้ด: restore → dotnet format --verify-no-changes → build → tests พร้อม frontend typecheck/lint และทดสอบ E2E ที่เกี่ยวข้อง การตรวจรูปแบบไม่แทนการทดสอบ PDF ภาษาไทย

Production ที่มีข้อมูลระบบในอนาคตต้องมี HTTPS, secrets แยกจาก repository และ backup/restore PostgreSQL ไม่มีข้อมูลเอกสารให้สำรองตามขอบเขตปัจจุบัน

## 7. ขอบเขตการทดลองเลือก PDF engine

นี่เป็นข้อเสนอการทดลองเพื่อพิสูจน์ feasibility ไม่ใช่แผน implementation เต็ม และยังไม่ได้รันทดลอง

เริ่มประเมิน PDF.js สำหรับ renderer และ pdf-lib + fontkit สำหรับ export เป็นตัวเลือกแรก ทั้งนี้การรองรับ custom font ไม่ถือเป็นหลักฐานว่าจัดตำแหน่งอักษรไทยหรือคัดลอกกลับได้ถูก

1. ระบุเวอร์ชัน dependency, font file/hash และ license ของทุกส่วน รวมถึง transitive dependencies ที่เกี่ยวข้องกับการแจกจ่าย
2. ใช้ PDF สังเคราะห์ที่ไม่มีข้อมูลส่วนบุคคล: หน้าปกติ หลายหน้า หน้าหมุน หน้าครอป ขนาดหน้าต่างกัน และภาพสแกน
3. เพิ่มข้อความ “ชื่อผู้สมัคร”, “ที่อยู่”, “น้ำ”, “กุ้ง”, “ปู่”, “ผู้รับรอง”, “สมชาย Smith 123/45” รวมทั้งหลายบรรทัดและหลายขนาด
4. สร้าง PDF โดยไม่แปลงข้อความเป็นรูปหรือเส้นวาด ฝังฟอนต์และรักษาข้อความต้นทาง/Unicode mapping
5. เปิดไฟล์ผลลัพธ์ใน PDF.js, Chrome และ Adobe Acrobat บน desktop ตรวจด้วยสายตา ค้นหา และคัดลอกกลับมาเทียบข้อความต้นทาง
6. ตรวจตำแหน่งที่ระดับซูม 50%, 100%, 200% และหน้าหมุน ใช้ fixture ที่มีจุดอ้างอิง เป้าหมายคลาดเคลื่อนไม่เกิน 1 PDF point สำหรับตำแหน่งอ้างอิง
7. ตรวจบนเครื่องหรือ environment ที่ไม่ได้ติดตั้งฟอนต์ และตรวจว่าฟอนต์ฝังอยู่ในผลลัพธ์จริง
8. ตรวจไม่มี document network traffic หรือ persistent draft หลังเปิด กรอก ส่งออก และรีเฟรช
9. บันทึกเวลาเปิด/ส่งออกและ memory behavior กับ fixture 1, 20 และ 100 หน้า รวมทั้งไฟล์ภาพสแกน ระบุ browser และเครื่องที่วัด ใช้ผลกำหนดขนาดไฟล์/จำนวนหน้าที่รองรับก่อน implementation จริง ไม่อ้างว่ารองรับไม่จำกัด

การคัดลอก: เปรียบเทียบข้อความหลัง normalize Unicode แบบ NFC และ line endings โดยไม่ลบสระ วรรณยุกต์ หรือช่องว่างภายในบรรทัด ตรวจการค้นหาด้วย viewer จริงเพิ่มเติม เพราะ text extraction อัตโนมัติอย่างเดียวไม่พิสูจน์ประสบการณ์ผู้ใช้

หาก export engine ไม่ผ่าน ให้ระบุว่าล้มเหลวที่ shaping, glyph positioning, font embedding หรือ Unicode mapping ก่อนเลือกแก้ adapter หรือเปลี่ยน engine โอเพนซอร์ส การใช้ HarfBuzz/WASM เป็นทางเลือกที่ต้องประเมินเพิ่มเติม ไม่ถือว่า HarfBuzz เขียน PDF ให้ได้เอง

ผลส่งมอบของการทดลอง: source ของ probe, input/output fixtures, dependency/license inventory และรายงานผลรายกรณีพร้อมคำแนะนำเลือก engine หากยังไม่ผ่านต้องรายงานตรง ๆ ไม่ลดข้อกำหนดภาษาไทยหรือใช้ server ประมวลผลแทน

## 8. ลำดับส่งมอบที่เสนอ

1. ตรวจและตกลงร่างแบบนี้
2. จัดทำแผน implementation โดยให้การทดลอง PDF ภาษาไทยเป็นจุดตัดสินใจก่อนงาน UI เต็ม
3. เมื่อทดลองผ่าน จึงสร้าง editor flow และหน้าจอตามภาพอ้างอิง
4. ตรวจภาษาไทย พิกัด Undo/Redo การปิดหน้า error states และความเป็นส่วนตัวครบก่อนส่งมอบ

เรื่องที่รอผลทดลอง: PDF engine/เวอร์ชัน, การต่อยอด shaping, ขีดจำกัดไฟล์/หน้า และ performance targets เรื่องเหล่านี้ตั้งใจยังไม่ล็อก และต้องสรุปก่อนเริ่ม implementation ที่พึ่งผลนั้น

## 9. แหล่งอ้างอิงที่ตรวจประกอบการออกแบบ

- [Blazor hosting models](https://learn.microsoft.com/en-us/aspnet/core/blazor/hosting-models)
- [JS interop performance](https://learn.microsoft.com/en-us/aspnet/core/blazor/performance/javascript-interoperability)
- [Rendering performance](https://learn.microsoft.com/en-us/aspnet/core/blazor/performance/rendering)
- [PDF.js](https://mozilla.github.io/pdf.js/)
- [pdf-lib และ custom fonts](https://github.com/Hopding/pdf-lib#embed-font-and-measure-text)
- [HarfBuzz shaping](https://harfbuzz.github.io/what-is-harfbuzz.html)
- [Ardalis Clean Architecture](https://github.com/ardalis/CleanArchitecture)
- [Feature folders](https://ardalis.com/api-feature-folders/)
- [dotnet format](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format)
- [Docker Compose healthcheck/startup](https://docs.docker.com/compose/how-tos/startup-order/)

เอกสารอ้างอิงอธิบายความสามารถและแนวทางของเครื่องมือ ไม่ใช่หลักฐานว่าระบบนี้ผ่านเกณฑ์ PDF ภาษาไทยแล้ว

## Approved follow-up: handwritten signatures

The original signature exclusion is superseded by [the signature plan](../plans/2026-09-21-signatures.md): desktop drawing and mobile QR capture into an ephemeral library, with vector placement/export. Accounts, saved drafts, cloud document storage and certificate signatures remain outside this implementation.
