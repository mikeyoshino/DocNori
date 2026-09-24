# แผน SEO สำหรับหน้าแรกและ Fill & Sign

วันที่ 24 กันยายน 2026 — รายงานหลัก: FULL-AUDIT-REPORT.md

ปรับคำตามการอนุมัติเพิ่มเติมแล้ว: หน้าแรกใช้ title “เครื่องมือจัดการ PDF ออนไลน์ รองรับภาษาไทย — DocNory”; หน้า Fill & Sign ใช้ title “กรอกข้อความและเซ็น PDF ออนไลน์ฟรี — DocNory” และ H1 “กรอกข้อความภาษาไทยและเซ็น PDF ออนไลน์” พร้อมคำอธิบายการพิมพ์ข้อความลง PDF/กรอกแบบฟอร์ม PDF

| ลำดับ | งาน | ผลที่คาดหวัง | Effort / Dependency | สถานะ |
|---|---|---|---|---|
| P1 | ปรับ title, H1 และบทนำหน้าแรกให้ชัดว่าเป็นเครื่องมือ PDF ออนไลน์ | สื่อหัวข้อและเจตนาการค้นหาชัดขึ้น | ต่ำ | แก้ใน workspace แล้ว |
| P1 | ปรับ description สองหน้า พร้อม site name และ Twitter summary | ข้อความสำหรับผลค้นหา/แชร์สอดคล้องกับหน้า | ต่ำ | แก้ใน workspace แล้ว |
| P1 | เพิ่ม JSON-LD WebSite/WebPage/WebApplication/BreadcrumbList | ช่วยระบบค้นหาเข้าใจเว็บไซต์ เครื่องมือ และตำแหน่งหน้า | ต่ำ; ใช้ PublicOrigin | แก้และทดสอบแล้ว |
| P2 | เพิ่มคำตอบการกรอกภาษาไทย การใช้ฟรี และลิงก์รวม/แยก PDF | ช่วยผู้ใช้เตรียมเอกสารและเข้าใจข้อจำกัด | ต่ำ | แก้และทดสอบแล้ว |
| P1 release | Deploy แล้วตรวจสอง URL และ sitemap อีกครั้ง | ทำให้การแก้มีผลบนเว็บจริง | ตามขั้นตอน release; รวมกับงานค้างใน workspace อย่างระมัดระวัง | ยังไม่ deploy |
| P2 | ส่ง sitemap และตรวจ URL Inspection ใน Search Console | ตรวจ indexing และขอ recrawl | ต้องมีสิทธิ์ Search Console และ deploy ก่อน | รอดำเนินการ |
| P2 | เพิ่มภาพแชร์ลิงก์พร้อม og:image/twitter:image | แสดง preview ที่มีภาพ | ต่ำ; ต้องมีภาพแบรนด์ที่เหมาะสม | งานต่อเนื่อง |
| P2 | วัด PageSpeed/CrUX บนมือถือ | หาปัญหา LCP/INP/CLS จากข้อมูลจริง | API ไม่ติด rate limit หรือมี Search Console data | Unknown |
| P3 | ติดตาม query, impressions, clicks และ CTR หลัง Google recrawl | ประเมินผลก่อน/หลังด้วยข้อมูล | ต้องมี baseline และช่วงเวลาเปรียบเทียบ | ยังไม่มีข้อมูล |

ไม่มีหลักฐาน blocker ที่ต้องแก้ robots/canonical เพิ่ม ไม่เติม reviews, ratings, FAQPage หรือ HowTo schema เพื่อหวัง rich results ไม่เปลี่ยน crawler policy โดยไม่มีเหตุจำเป็น

ตรวจแล้ว: build ผ่าน, SEO browser tests 4/4 ผ่าน, schema validator ผ่านทั้งสองหน้า และ mobile 390px ไม่ล้นแนวนอน การแก้ยังไม่ใช่ผลลัพธ์ที่ deploy แล้วและไม่รับประกันอันดับ
