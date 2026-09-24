# รายงาน SEO: DocNory

ตรวจวันที่ 24 กันยายน 2026 ขอบเขต: https://docnori.com/ และ https://docnori.com/tools/fill-sign เท่านั้น เป็นการตรวจระดับหน้าโดยใช้ HTML จริง สคริปต์จาก SEO skill และโค้ดใน workspace

## A) Audit Summary

สถานะ: พบโอกาสปรับปรุง metadata, structured data และเนื้อหา โดยไม่พบหลักฐานว่าทั้งสองหน้าถูกบล็อก indexing คะแนนรวม: **Insufficient data** (Score confidence: Low) เพราะไม่มีข้อมูล Core Web Vitals หรือ Search Console ไม่ประเมินอันดับหรือปริมาณ traffic จาก HTML

สามประเด็นหลักก่อนแก้: title/H1 หน้าแรกยังไม่ชัดเรื่อง PDF, ทั้งสองหน้าไม่มี JSON-LD, metadata สำหรับแชร์ลิงก์ยังไม่ครบ สามโอกาสหลัก: สื่อเจตนาการค้นหาภาษาไทยให้ชัด, ระบุเว็บไซต์และแอปด้วย structured data, เพิ่มคำตอบใช้งานจริงและลิงก์เตรียมเอกสาร

**สถานะการส่งมอบ:** แก้ใน workspace แล้ว ยังไม่ได้ deploy เว็บจริง หลักฐาน `*-before.*` เป็น production; `*-after.html` เป็น local build ซึ่งใช้ PublicOrigin ค่าเริ่มต้น http://localhost:8080/ ต้องคง PublicOrigin=https://docnori.com ใน production

## B) Findings Table

ตารางนี้สร้างจาก findings-verified.json หลังรัน finding_verifier.py (11 findings ไม่มีรายการซ้ำ) Confirmed หมายถึงตรวจพบในหลักฐาน ณ เวลาตรวจ ไม่ใช่การยืนยันผลต่ออันดับ

| Area | Severity | Confidence | Finding | Evidence | Impact | Fix |
|---|---|---|---|---|---|---|
| On-page | Warning | Confirmed | Homepage title and H1 do not identify PDF tools | home-before.json: title=DocNory — เครื่องมือจัดการเอกสาร; H1=จัดการเอกสารให้เป็นเรื่องง่าย | Clearer page purpose in search and on-page. | Align title, H1 and introductory copy with Thai PDF tool intent. Implemented locally. |
| Schema | Warning | Confirmed | Both target pages lack JSON-LD | home-before.json and fill-sign-before.json: schema=[] | Explicit site and tool identity; no rich-result guarantee. | Add WebSite and WebPage on home; WebApplication, WebPage and BreadcrumbList on fill-sign. Implemented locally. |
| Social | Warning | Confirmed | Both target pages lack Twitter metadata and og:site_name | Both before JSON files: twitter_card={}; no og:site_name | More predictable link preview text. | Add consistent site name and Twitter summary metadata. Implemented locally. |
| Social | Warning | Confirmed | Both target pages lack a dedicated share image | Both before JSON files: no og:image | Improves visual link previews; not a confirmed ranking issue. | Provide a branded raster share image and absolute og:image/twitter:image URLs. Follow-up. |
| Content | Warning | Confirmed | Fill-sign has instructions but lacks focused Thai text and document preparation answers | fill-sign-before.html; existing sections cover signing steps, signature type and privacy | Answers practical tool questions and supports document preparation. | Add useful visible questions and contextual merge/split links. Implemented locally. |
| Performance | Info | Hypothesis | Core Web Vitals are unknown | home-speed.txt and fill-sign-speed.txt: rate limited; performance_score=null | Cannot assess performance or claim a ranking impact. | Measure with PageSpeed/CrUX or Search Console after deployment. |
| HTTP | Info | Confirmed | HEAD returned 405 while GET succeeded | redirects.txt reports 405; direct GET fetched HTML successfully | This is not evidence of a broken or non-indexable page. | Treat redirect script result as method-specific; verify redirects with GET. Optional HEAD support separately. |
| GEO | Info | Confirmed | llms.txt is absent | llms.txt: HTTP 404 | No evidence here that absence harms ranking or AI citations. | Optional documentation aid only; prioritize useful crawlable HTML. |
| Indexability | Pass | Confirmed | Both pages have self-referencing canonicals and index,follow | Both before JSON files: canonical matches target URL; meta_robots=index,follow; fetch GET returned 200 | Pages provide crawlable content and canonical signals; indexing itself is unknown. | Preserve setup and recheck deployed HTML after release. |
| Links | Pass | Confirmed | The sampled fill-sign links are healthy | links.txt: 10 healthy, 0 broken, 0 timeout | No broken links in this sample. | Preserve and periodically recheck. |
| Crawling | Pass | Confirmed | Robots exposes sitemap and allows the target pages | robots.txt audit: HTTP 200; wildcard Allow /; sitemap https://docnori.com/sitemap.xml | Target paths are not blocked; AI agents inherit wildcard rules. | Keep current policy unless crawler preferences change. |

## C) Prioritized Action Plan

1. **Quick wins — implemented locally:** ปรับ title/H1/บทนำหน้าแรก, description สองหน้า, og:site_name และ Twitter summary metadata
2. **Quick wins — implemented locally:** เพิ่ม WebSite/WebPage หน้าแรก และ WebPage/WebApplication/BreadcrumbList หน้าเซ็น PDF ด้วย JSON-LD ที่ serialize อย่างปลอดภัยและใช้ CSP nonce เดิม ไม่มีคะแนนรีวิวสมมติ
3. **Quick wins — implemented locally:** เพิ่มคำถามที่มองเห็นได้เรื่องข้อความภาษาไทย ราคา/ขนาดไฟล์ และลิงก์รวม/แยก PDF ไม่เพิ่ม FAQPage หรือ HowTo schema
4. **Release verification:** deploy ผ่านขั้นตอน release ของโครงการ แล้วตรวจ canonical, JSON-LD และ sitemap ใน production อีกครั้ง ก่อนขอ Google recrawl
5. **Maintenance:** เตรียมภาพแชร์ลิงก์, ตรวจ Search Console และวัด mobile CWV เมื่อ API พร้อมใช้งาน รายละเอียดใน ACTION-PLAN.md

### Validation

- `dotnet build src/SabuySign.Host --no-restore`: ผ่าน 0 warnings / 0 errors
- `npx playwright test tests/seo.spec.ts --workers=1`: ผ่าน 4/4 ตรวจ SSR, canonical/robots/sitemap, JSON-LD, metadata, ลิงก์ และการเริ่ม WebAssembly
- ก่อนเพิ่ม JSON-LD ทดสอบใหม่ล้มเหลวเพราะไม่พบ script; หลังแก้ผ่าน
- `validate_schema.py` กับ HTML หลังแก้ทั้งสองหน้า: exit 0
- Mobile 390px: document scrollWidth = clientWidth = 390 ทั้งสองหน้า มีภาพเก็บใน artifacts
- `git diff --check`: ผ่าน

## D) Unknowns and Follow-ups

### Approved keyword refinement

ปรับถ้อยคำเพิ่มเติมตามที่ผู้ใช้อนุมัติ: หน้าแรกใช้ title `เครื่องมือจัดการ PDF ออนไลน์ รองรับภาษาไทย — DocNory` และคง H1 เดิม ส่วนหน้า Fill & Sign ใช้ title `กรอกข้อความและเซ็น PDF ออนไลน์ฟรี — DocNory` และ H1 `กรอกข้อความภาษาไทยและเซ็น PDF ออนไลน์` โดยปรับ PageTitle ของตัว editor ให้ตรงกันด้วย เพิ่มคำว่า “พิมพ์ข้อความลง PDF” และ “กรอกแบบฟอร์ม PDF” ในคำตอบที่อธิบายการเพิ่มข้อความบนเอกสารอย่างชัดเจน Description หน้าแรกปรับให้สอดคล้องกับข้อความใหม่เรื่องเครื่องมือจัดการ PDF และการรองรับข้อความภาษาไทย ส่วนหน้า Fill & Sign คงเดิม ภาพและ HTML ใน artifacts เป็นหลักฐานก่อนการปรับถ้อยคำรอบนี้ ยังไม่ได้ deploy

- ไม่ทราบอันดับ, impressions, clicks, CTR, Google-selected canonical หรือสถานะ indexed จริง ต้องใช้ Search Console
- ไม่มี keyword-volume/competitor data คำค้นที่เลือกอิงความสามารถจริงและภาษาในหน้า ไม่อ้างว่าเป็นคำค้นยอดนิยม
- ไม่มีข้อมูล field LCP/INP/CLS หรือ PageSpeed score เพราะ API จำกัดคำขอ ไม่ตีความว่าเว็บช้า
- ไม่อ้าง software rich result eligibility: ไม่มี review/aggregateRating จริง และไม่ได้สร้างขึ้น
- og:image/twitter:image ยังไม่ได้เพิ่ม เป็นงาน social preview ต่อเนื่อง
- llms.txt ไม่ใช่ข้อบังคับ indexing; AI bots ที่ไม่มีชื่อเฉพาะใช้ wildcard robots rules ไม่ถือเป็นข้อผิดพลาด
- Readability/word count จากสคริปต์ภาษาอังกฤษไม่ใช่เกณฑ์ตัดสินข้อความไทย ไม่เพิ่มเนื้อหาเพื่อให้ครบจำนวนคำโดยไร้ประโยชน์
- HSTS ไม่ปรากฏใน headers audit เป็นงานพิจารณาระดับ deployment ไม่ใช่หลักฐาน SEO ranking issue

## Environment Limitations

เครื่องมือ web เปิดสอง URL ไม่สำเร็จ และ Python เริ่มต้นไม่มี requests; แก้ด้วย temporary virtualenv และ direct fetch ที่ได้รับอนุญาต จึงเก็บ HTML จริงได้สำเร็จ PageSpeed ของทั้งสอง URL ถูก rate limit ไม่มีค่าที่วัดได้ สคริปต์ redirect ใช้ HEAD ซึ่งเว็บตอบ 405 แต่ GET ตอบ 200 จึงไม่รายงานเป็น crawl blocker การติดตั้ง dependency ไม่เปลี่ยน dependency ของแอป

SEO skill reference บางไฟล์ลงวันที่ February/May 2026 เกิน 90 วัน จึงตรวจข้อมูล site name/software schema กับเอกสาร Google ปัจจุบัน และไม่ใช้ตัวเลขผล SEO หรือข้ออ้าง algorithm จาก reference ที่ไม่มีหลักฐาน

## Sources and evidence

- [Google: site names](https://developers.google.com/search/docs/appearance/site-names): WebSite บนหน้าแรกและ og:site_name ช่วยระบุชื่อเว็บไซต์
- [Google: software app structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app): ข้อกำหนดและข้อจำกัดการแสดง rich results
- `artifacts/seo-2026-09-24/`: HTML ก่อน/หลัง, parsed JSON, scripts outputs, findings ที่ตรวจแล้ว และภาพ mobile
- Source: PublicPage.razor, PublicStructuredData.cs, ToolHome.razor, ToolStart.razor และ tests/seo.spec.ts
