namespace SabuySign.Web.Features.Tools;

public sealed record ToolCategory(string Id, string Label);
public sealed record DocumentTool(string Id, string Category, string Name, string Description, string Icon, string Formats, bool Available);

public static class ToolCatalog
{
    public static IReadOnlyList<ToolCategory> Categories { get; } = [
        new("edit", "แก้ไขและเซ็น"),
        new("organize", "จัดการไฟล์ PDF"),
        new("optimize", "ลดขนาดไฟล์"),
        new("convert", "แปลงไฟล์")
    ];
    public static IReadOnlyList<DocumentTool> Tools { get; } = [
        new("fill-sign", "edit", "กรอกและเซ็น PDF", "เพิ่มข้อความไทย–อังกฤษ วางลายเซ็น และตรวจเอกสารก่อนดาวน์โหลด", "text", "PDF", true),
        new("merge", "organize", "รวมไฟล์ PDF", "รวมเอกสารหลายไฟล์เป็น PDF เดียว พร้อมจัดลำดับไฟล์ตามต้องการ", "merge", "PDF + PDF", true),
        new("split", "organize", "แยกไฟล์ PDF", "แยกหน้าที่ต้องการจาก PDF ออกเป็นเอกสารใหม่", "split", "PDF → PDF", true),
        new("compress", "optimize", "ลดขนาด PDF", "เตรียมไฟล์ขนาดเล็กลงสำหรับแนบอีเมล ส่งต่อ หรืออัปโหลด", "compress", "PDF", false),
        new("word-to-pdf", "convert", "Word เป็น PDF", "แปลงเอกสาร Word เป็น PDF สำหรับส่งต่อและเปิดอ่าน", "convert", "DOC / DOCX → PDF", false),
        new("pdf-to-jpg", "convert", "PDF เป็น JPG", "แปลงแต่ละหน้าเป็นรูป JPG หรือดึงรูปภาพใน PDF เลือกคุณภาพแล้วดาวน์โหลดได้ฟรี ไฟล์ไม่ถูกส่งขึ้นเซิร์ฟเวอร์", "to-jpg", "PDF → JPG", true),
        new("pdf-to-word", "convert", "PDF เป็น Word", "แปลง PDF เป็นเอกสาร Word เพื่อนำไปแก้ไขต่อ", "from-pdf", "PDF → DOCX", false),
        new("pdf-to-powerpoint", "convert", "PDF เป็น PowerPoint", "แปลง PDF เป็นสไลด์ PowerPoint สำหรับนำเสนอและแก้ไขต่อ", "to-powerpoint", "PDF → PPTX", false),
        new("pdf-to-excel", "convert", "PDF เป็น Excel", "แปลงตารางใน PDF เป็นไฟล์ Excel สำหรับจัดการข้อมูลต่อ", "to-excel", "PDF → XLSX", false)
    ];
}
