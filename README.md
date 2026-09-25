# DocNori

ศูนย์รวมเครื่องมือเอกสาร แบ่งหมวดแก้ไขและเซ็น, จัดการไฟล์ PDF, ลดขนาดไฟล์ และแปลงไฟล์ หน้าแรกกรองหมวดได้ กรอก/เซ็น รวม แยก PDF และแปลง PDF เป็น JPG / Word พร้อมใช้งาน ส่วนลดขนาด, Word เป็น PDF และแปลง PowerPoint/Excel ยังเป็น “เร็ว ๆ นี้”

เว็บกรอกข้อความไทย–อังกฤษลง PDF ด้วย Blazor Web App (Static SSR + Interactive WebAssembly) และ TypeScript สำหรับ desktop เปิดไฟล์ใน browser โดยไม่อัปโหลดและไม่บันทึกร่าง รองรับหลายหน้า วาง/ย้ายข้อความ กรอบปรับพอดีกับเนื้อหาอัตโนมัติ ปรับขนาดตัวอักษรจากแถบขวา สี การจัดแนว Undo/Redo ลายเซ็นจากคอม/มือถือ และ preview จาก PDF ผลลัพธ์จริงก่อนดาวน์โหลด

## เริ่มใช้งาน

ต้องมี .NET SDK 10.0.302 (หรือ patch ที่ compatible) และ Node.js 24

```sh
npm ci
npm run build
dotnet run --project src/SabuySign.Host --no-launch-profile --urls http://localhost:5180
```

เปิด http://localhost:5180 เมื่อแก้ TypeScript ให้รัน `npm run build` ใหม่ ส่วน `.razor` ใช้ `dotnet watch --project src/SabuySign.Host` ได้

## Docker Compose

```sh
docker compose -f infra/compose.yaml up --build -d web
```

เปิด http://localhost:8080 ผ่าน nginx ซึ่งส่งหน้าเว็บและ assets ไปยัง ASP.NET Core Host ส่วน `/api/pairing` ไปยัง relay โดยตรง หน้าแรกเป็น Static SSR และไม่โหลด WASM ส่วนเครื่องมือเป็น prerendered Interactive WebAssembly ไม่มี Interactive Server/Auto และไม่มี document upload endpoint

การขึ้น Contabo VPS ที่มี TrackZ อยู่แล้วใช้ Compose แยกและ GitHub Actions ตาม [คู่มือ deployment](docs/DEPLOYMENT.md) โดยใช้โดเมน `docnori.com` และไม่เปิดพอร์ตชนกับแอปเดิม

Blazor อาจเก็บ `blazor-resource-hash:SabuySign.Web` ใน localStorage เพื่อระบุเวอร์ชัน runtime เท่านั้น ไม่มีการเก็บ PDF ข้อความ หรือลายเซ็นใน localStorage/sessionStorage

CSP ใช้ nonce ใหม่ในแต่ละ response สำหรับ import map หน้าเว็บยังรับเฉพาะ GET/HEAD ผ่าน nginx การเปลี่ยนหน้าใช้ native navigation เพื่อคงคำเตือนก่อนทิ้งงานที่ยังไม่ได้บันทึก

ก่อน deploy ให้ตั้ง `PUBLIC_ORIGIN=https://your-domain.example` ใน environment ของ Docker Compose เพื่อสร้าง canonical URL และ sitemap ให้ตรงโดเมนจริง (ค่าเริ่มต้นสำหรับเครื่องพัฒนาคือ `http://localhost:8080`) หน้า `/sign`, เครื่องมือที่ยังไม่พร้อม และ 404 ใช้ `noindex` เครื่องมือพร้อมใช้งานอยู่ใน `/sitemap.xml` และมี `/robots.txt`

PostgreSQL แยกเป็น profile เพราะ editor ไม่ต้องใช้ฐานข้อมูล:

```sh
POSTGRES_PASSWORD='your-local-password' docker compose -f infra/compose.yaml --profile system-data up -d
```

ข้อมูล DB อยู่ใน named volume และไม่ publish port สู่ host ค่า default ใช้สำหรับ local development เท่านั้น Production ต้องตั้ง secret เอง เพิ่ม HTTPS ผ่าน reverse proxy และกำหนด backup เมื่อมี schema ข้อมูลระบบจริง

## โครงสร้าง

- `src/SabuySign.Host/`: ASP.NET Core host, Static SSR routing, SEO metadata, CSP และ sitemap
- `src/SabuySign.Web/`: client assembly สำหรับ Interactive WebAssembly และ component ที่ใช้ render HTML ร่วมกับ host
- `Features/Tools/`: หน้าแรกและ catalog เครื่องมือ/หมวดหมู่ แยกจาก editor สำหรับเพิ่มเครื่องมือในอนาคต
- `Features/PdfToWord/` และ `Client/convert-word/`: สร้าง DOCX ที่มีข้อความแก้ไขได้; หน้าที่ไม่มีข้อความจะเป็นรูปพร้อมเตือนก่อนแปลง; OCR สำหรับสมาชิกแบบชำระเงินยังไม่เปิดใช้งาน
- `Features/PdfToJpg/` และ `Client/convert-jpg/`: แปลงทุกหน้าเป็น JPG หรือดึงรูปภาพที่ฝังใน PDF; เลือกคุณภาพปกติ/สูง และดาวน์โหลด JPG หรือ ZIP โดยประมวลผลบนเครื่องผู้ใช้
- `Shared/ConversionProgress.razor`, `Shared/ConversionResult.razor` และ `Client/shared/zip.ts`: ส่วนกลางสำหรับเครื่องมือแปลงไฟล์
- `Features/PdfEditor/`: Blazor UI และ JS interop bridge
- `Client/editor/text-layout.ts`: วัดกรอบข้อความตามฟอนต์และจำนวนบรรทัด ให้พอดีทั้ง browser และ PDF
- `Client/editor/session.ts`: ข้อมูลกล่องข้อความและประวัติในหน่วยความจำ
- `Client/editor/index.ts`: browser interaction, หน้า/ซูม, lifecycle และ preview
- `Client/editor/pdf.ts`: ตรวจ PDF, พิกัดหน้า และเขียนข้อความ
- `Client/editor/shaped-font.ts`: shaping ภาษาไทยและสร้างฟอนต์ย่อยสำหรับเอกสาร
- `Client/editor/export.worker.ts`: ส่งออก PDF นอก UI thread
- `Features/Signatures/` และ `Client/signatures/`: หน้าวาดลายเซ็น คลังชั่วคราว QR และการเข้ารหัส
- `src/SabuySign.Relay/Features/Pairing/`: relay ในหน่วยความจำ พร้อมแยกสิทธิ์ส่ง/รับและ TTL
- `infra/`: nginx reverse proxy, ASP.NET Core host, relay และ PostgreSQL Compose

Relay เป็น feature folder ขนาดเล็ก แยก storage policy ออกจาก HTTP endpoints และใช้ TimeProvider ทดสอบ expiry ไม่สร้าง Domain/Application/Infrastructure ว่าง ๆ; เมื่อมี use case ระบบหรือฐานข้อมูลจึงแยก layer ตาม dependencies จริง

## ภาษาไทยและฟอนต์

ใช้ Sarabun (OFL-1.1) ที่เสิร์ฟจากเว็บเอง Fontkit จัดวาง glyph ของแต่ละ grapheme แล้ว OpenType.js สร้างฟอนต์ย่อยชื่อ `SabuyText` ฝังลง PDF พร้อม ToUnicode ที่เชื่อมกับข้อความต้นฉบับ วิธีนี้ยังเป็น PDF text ค้นหา/คัดลอกได้ ไม่วาดข้อความเป็นภาพหรือ path บนหน้า PDF

ข้อจำกัดปัจจุบัน: ไทย/อังกฤษ ฟอนต์ปกติหนึ่งแบบ ขึ้นบรรทัดด้วย Enter ไม่มีตัดคำอัตโนมัติ; tab เปลี่ยนเป็น 4 spaces; ไม่เปิด PDF เข้ารหัสหรือมีช่องลายเซ็นดิจิทัล; ไม่แก้ข้อความเดิมหรือ AcroForm/XFA โดยตรง

จำกัดเบื้องต้น 25 MB / 100 หน้า และขนาดหน้าที่รองรับตามข้อความแจ้งในแอป จำกัด canvas หลัก 16 ล้าน pixels ข้อจำกัดเหล่านี้เป็น guardrail ไม่ใช่คำรับรองเวลาโหลดสำหรับ PDF ภาพสแกนทุกชนิด

## ตรวจสอบ

```sh
npm run typecheck
npm run format:check
npm test
npm run build
dotnet restore
dotnet format --verify-no-changes --no-restore
dotnet build --no-restore
dotnet test tests/SabuySign.Relay.Tests --no-restore
npx playwright install chromium
npm run test:e2e
docker compose -f infra/compose.yaml config --quiet
```

สร้างตัวอย่าง PDF และผล benchmark สังเคราะห์:

```sh
node --import tsx scripts/pdf-probe.mts
```

ผลอยู่ใน `artifacts/pdf-probe/` ดู [รายงานการตรวจ](docs/verification/2026-09-21-editor.md) สำหรับสิ่งที่ทดสอบแล้วและข้อจำกัด โดยยังต้องตรวจ Adobe Acrobat/Safari และเอกสารจริงที่เป็นตัวแทนก่อนเปิด production

## ความเป็นส่วนตัว

ไม่มีบัญชี ไม่มี document API ไม่มี analytics ไม่มีการเขียนเอกสารลง localStorage/IndexedDB/Cache Storage การปิดหรือรีเฟรชทำให้งานหาย เตือนออกเมื่อมีงานยังไม่ดาวน์โหลดเท่าที่ browser รองรับ ไฟล์ที่ผู้ใช้กดดาวน์โหลดคือผลลัพธ์บนเครื่องของผู้ใช้เอง

การใช้ browser ยังต้องเชื่อถือโค้ดเว็บและอุปกรณ์ผู้ใช้ ข้อความ “ไม่ส่งเอกสารขึ้นเซิร์ฟเวอร์” ไม่ใช่คำรับรองความปลอดภัยทุกกรณี

ดู [แบบระบบ](docs/superpowers/specs/2026-09-21-document-editor-design.md) และ [Third-party notices](THIRD-PARTY-NOTICES.md)

## ลายเซ็นจากคอมและมือถือ

เปิด PDF → กด **สร้างลายเซ็น** ทางขวา → เลือก **สร้างบนคอม** หรือ **สร้างบนมือถือ** แต่ละหน้ามีปุ่ม **บันทึกลายเซ็น** ของตัวเอง บันทึกแล้วลากภาพจาก “ลายเซ็นของฉัน” ไปวางบน PDF หรือคลิกภาพแล้วคลิกตำแหน่งบน PDF ย้าย/ปรับขนาดโดยคงสัดส่วน วางซ้ำ และ Undo/Redo ได้ ดาวน์โหลดผ่าน preview เดิม ลายเซ็นฝังเป็นเส้น vector ไม่ลดคุณภาพข้อความไทย

“บันทึก” หมายถึงยืนยันลายเซ็นไว้ในหน่วยความจำของหน้านี้ เมื่อปิด/รีเฟรช/เปลี่ยนเอกสาร คลังจะหาย ไม่มีบัญชีหรือการกู้คืนลายเซ็น เป็นลายมือชื่อที่วาดลงหน้า PDF ไม่ใช่ certificate-based digital signature

โหมดมือถือใช้ Docker Compose ซึ่งเริ่ม relay ให้อัตโนมัติ (`dotnet run` ของ Web เพียงตัวเดียวรองรับการเซ็นบนคอม แต่ไม่มี relay) QR ใช้ได้ 5 นาทีและใช้ส่งหนึ่งลายเซ็น มือถือเปิดหน้า `/sign` โดยไม่รับ PDF เมื่อกดบันทึก เบราว์เซอร์เข้ารหัสด้วย AES-256-GCM + IV ใหม่และผูกข้อมูลกับ session ก่อนส่งผ่าน relay กุญแจอยู่ใน URL fragment ซึ่งไม่ถูกส่งใน HTTP request และถูกลบออกจาก address bar ทันทีที่โหลดหน้า กุญแจไม่ถูกเก็บบน relay

Relay เก็บ ciphertext ใน RAM จำกัด 128 KB ต่อชุด / 100 sessions ลบทันทีหลังคอมยืนยันการรับ หรือเมื่อหมดอายุ (sweep ทุก 15 วินาที) รีสตาร์ตแล้วข้อมูลหาย ไม่ใช้ PostgreSQL ไม่เขียน payload/token ลง log หรือไฟล์ เก็บเพียง hash ของ capability tokens และแยกสิทธิ์เจ้าของคอมกับผู้ส่งจากมือถือ Retry payload เดิมได้แต่เปลี่ยนทับลายเซ็นที่รับแล้วไม่ได้ ใครได้ QR จะมีสิทธิ์ส่งลายเซ็น จึงไม่ควรแชร์ QR

**ใช้งานกับมือถือจริง:** ต้องเปิดเว็บผ่าน HTTPS origin เดียวที่ทั้งคอมและมือถือเข้าถึงได้ การเปิด `localhost:8080` ใช้ทดสอบสองแท็บในคอมได้ แต่ QR localhost เปิดจากมือถือไม่ได้ Compose bind เฉพาะ loopback โดยตั้งใจ ให้ reverse proxy บน host ส่งต่อเข้า `127.0.0.1:8080` พร้อม TLS ที่เชื่อถือได้ ไม่จำเป็นต้องเปิด port relay หรือ PostgreSQL โค้ดไม่มีการสร้าง public tunnel หรือ deploy ให้อัตโนมัติ

รองรับ relay instance เดียวในรุ่นนี้; ห้าม load balance หลาย instance โดยไม่มี session routing หรือออกแบบ shared ephemeral storage เพิ่ม การเข้ารหัสระหว่างอุปกรณ์ยังต้องเชื่อถือโค้ดเว็บที่ถูกเสิร์ฟและอุปกรณ์ผู้ใช้ จึงไม่รับรองว่าผู้ให้บริการที่แก้โค้ดเว็บเองจะไม่มีทางเข้าถึงข้อมูล

## หน้าเครื่องมือและลิงก์ตรง

หน้าแรกเป็นรายการเครื่องมือเท่านั้น คลิกการ์ดแล้วไปหน้าเครื่องมือก่อน ไม่มีการเปิดตัวเลือกไฟล์อัตโนมัติ:

- `/tools/fill-sign`: คำอธิบาย วิธีใช้ พื้นที่ลากไฟล์ และปุ่มเลือก PDF ก่อนเข้า editor
- `/tools/merge`, `/tools/compress`, `/tools/word-to-pdf`: หน้ารายละเอียดและสถานะกำลังพัฒนา ยังไม่รับไฟล์
- `/sign`: หน้าสร้างลายเซ็นบนมือถือผ่าน QR

ใช้ native page navigation ตามรูปแบบเดิมของแอป ทำให้เปิดลิงก์ตรง รีเฟรช และใช้ Back ได้ รวมถึงคง beforeunload ที่เตือนงานยังไม่ดาวน์โหลด nginx ต้องส่ง fallback ไป index.html สำหรับ URL เหล่านี้ (Compose ตั้งไว้แล้ว)

### Local PDF split

`/tools/split` opens a preview workspace with a settings sidebar. Custom ranges
and fixed-size groups can be exported as individual PDFs in one ZIP download,
or combined into a single PDF. Page-selection mode supports clicking thumbnails,
text ranges such as `1-3, 5`, and downloading the remaining pages separately.
Combined output retains source order and removes duplicate pages.

Limits: one source PDF, 25 MB, 100 source pages and 100 exported pages across
all groups. Processing and file bytes stay in browser memory; reload clears the
session. Form appearances are flattened; bookmarks and digital signatures are
not retained. ZIP entries are stored without recompressing the PDF bytes.

## PDF เป็น Word

แปลงบน browser ด้วย PDF.js และ docx เป็น `.docx` จริง (ไม่ใช่ `.doc` รุ่นเก่า) รองรับข้อความไทย–อังกฤษ รูปภาพ raster ที่ฝังใน PDF และหลายไฟล์เป็น ZIP หน้าไม่มีข้อความที่ดึงได้จะเป็นรูปภาพใน Word โดยแจ้งก่อนแปลงและในผลลัพธ์ OCR แสดง “สำหรับสมาชิกแบบชำระเงิน · เร็ว ๆ นี้” ไม่มีการสมัคร/เรียกเก็บเงินในรุ่นนี้

การแปลงนี้เน้นนำข้อความไปแก้ไขต่อ: เรียงบรรทัดตามตำแหน่งและวางรูปภาพต่อจากข้อความของแต่ละหน้า ไม่ได้คงเลย์เอาต์ PDF แบบตรงทุกตำแหน่ง ตาราง/คอลัมน์ไม่ถูกสร้างเป็น Word tables, ไม่รักษาสีหรือฟอนต์เดิม และไม่สร้างเส้น/กราฟิก vector เป็นวัตถุ Word ฟอนต์ Word ใช้ Sarabun หรือฟอนต์ทดแทนของเครื่องผู้ใช้ สแกนที่มี text layer อยู่แล้วจะใช้ข้อความนั้น; การตรวจหน้าไม่มีข้อความไม่รับรองว่าจะตรวจเจอทุกภาพสแกนในหน้าผสม
