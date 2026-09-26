using System.Globalization;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Tokens;

namespace SabuySign.Host.Features.DocumentTemplates;

public sealed record TemplateLimits(int MaxTemplates = 20, long MaxAccountBytes = 100 * 1024 * 1024, int MaxFileBytes = 25 * 1024 * 1024, int MaxPages = 100, int MaxFields = 100, int MaxPlacements = 300);
public sealed record TemplatePage(double Width, double Height);
public sealed record TemplateField(string Id, string Label, string Type, bool Required, string DefaultValue);
public sealed record TemplatePlacement(string Id, string FieldId, int Page, double X, double Y, double Width, double Height, double Size, string Color, string Align, bool Multiline);
public sealed record TemplateDefinition(TemplateField[] Fields, TemplatePlacement[] Placements)
{
    public static TemplateDefinition Empty => new([], []);
}
public sealed record TemplateSummary(Guid Id, string Name, int Version, DateTimeOffset UpdatedAt);
public sealed record TemplateDetail(Guid Id, string Name, int Version, TemplateDefinition Definition);
public sealed record TemplateSave(string Name, int Version, TemplateDefinition Definition);
public sealed class TemplateFailure(int status, string message) : Exception(message) { public int Status { get; } = status; }

public static partial class TemplateValidation
{
    private static void Require([System.Diagnostics.CodeAnalysis.DoesNotReturnIf(false)] bool valid, string message) { if (!valid) throw new TemplateFailure(400, message); }
    public static void Validate(string? name, TemplateDefinition? definition, TemplatePage[] pages, TemplateLimits limits)
    {
        Require(!string.IsNullOrWhiteSpace(name) && name.Length <= 160 && !name.Any(char.IsControl), "ชื่อแม่แบบต้องมีความยาว 1–160 ตัวอักษร");
        Require(definition?.Fields is not null && definition.Placements is not null, "ข้อมูลแม่แบบไม่ถูกต้อง");
        var d = definition!;
        Require(d.Fields.Length <= limits.MaxFields && d.Placements.Length <= limits.MaxPlacements, "จำนวนช่องเกินข้อจำกัด");
        var fields = new HashSet<string>(StringComparer.Ordinal);
        foreach (var f in d.Fields)
        {
            Require(f is not null && ValidId(f.Id) && fields.Add(f.Id), "รหัสช่องซ้ำหรือไม่ถูกต้อง");
            Require(!string.IsNullOrWhiteSpace(f!.Label) && f.Label.Length <= 160 && f.Type is "text" or "date" or "number" && f.DefaultValue is { Length: <= 10000 }, "ข้อมูลช่องไม่ถูกต้อง");
            if (f.DefaultValue.Length > 0 && f.Type == "date") Require(DateOnly.TryParseExact(f.DefaultValue, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _), "วันที่เริ่มต้นไม่ถูกต้อง");
            if (f.DefaultValue.Length > 0 && f.Type == "number") Require(NumberPattern().IsMatch(f.DefaultValue), "ตัวเลขเริ่มต้นไม่ถูกต้อง");
        }
        var placements = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in d.Placements)
        {
            Require(p is not null && ValidId(p.Id) && placements.Add(p.Id) && fields.Contains(p.FieldId), "ตำแหน่งอ้างอิงช่องไม่ถูกต้อง");
            Require(p!.Page >= 0 && p.Page < pages.Length, "เลขหน้าไม่ถูกต้อง");
            Require(new[] { p.X, p.Y, p.Width, p.Height, p.Size }.All(double.IsFinite), "พิกัดไม่ถูกต้อง");
            Require(p.X >= 0 && p.Y >= 0 && p.Width >= 1 && p.Height >= 1 && p.X + p.Width <= pages[p.Page].Width + .01 && p.Y + p.Height <= pages[p.Page].Height + .01 && p.Size is >= 4 and <= 200, "ตำแหน่งอยู่นอกหน้ากระดาษหรือขนาดไม่ถูกต้อง");
            Require(p.Color is not null && ColorPattern().IsMatch(p.Color) && p.Align is "left" or "center" or "right", "รูปแบบช่องไม่ถูกต้อง");
        }
    }
    private static bool ValidId(string? id) => id is { Length: > 0 and <= 80 } && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    [GeneratedRegex("^#[0-9a-fA-F]{6}$")] private static partial Regex ColorPattern();
    [GeneratedRegex(@"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$", RegexOptions.CultureInvariant)] private static partial Regex NumberPattern();
    public static TemplateDefinition Copy(TemplateDefinition definition)
    {
        var ids = definition.Fields.ToDictionary(f => f.Id, _ => Guid.NewGuid().ToString("N"));
        return new(definition.Fields.Select(f => f with { Id = ids[f.Id] }).ToArray(), definition.Placements.Select(p => p with { Id = Guid.NewGuid().ToString("N"), FieldId = ids[p.FieldId] }).ToArray());
    }
    public static TemplatePage[] Pdf(byte[] bytes, TemplateLimits limits)
    {
        Require(bytes.Length > 8 && bytes.Length <= limits.MaxFileBytes && bytes.AsSpan(0, 5).SequenceEqual("%PDF-"u8), "ไฟล์ PDF ไม่ถูกต้องหรือมีขนาดเกินข้อจำกัด");
        try
        {
            using var pdf = PdfDocument.Open(bytes, new ParsingOptions { UseLenientParsing = false });
            Require(!pdf.IsEncrypted, "กรุณาปลดรหัสผ่าน PDF บนอุปกรณ์ก่อนอัปโหลด");
            Require(pdf.NumberOfPages is > 0 && pdf.NumberOfPages <= limits.MaxPages, "จำนวนหน้าเกินข้อจำกัด");
            // Inspect parsed dictionaries, including objects inside compressed object streams.
            foreach (var reference in pdf.Structure.CrossReferenceTable.ObjectOffsets.Keys)
                Inspect(pdf.Structure.GetObject(reference).Data, 0);
            var pages = new List<TemplatePage>();
            foreach (var page in pdf.GetPages())
            {
                var crop = page.CropBox.Bounds; var media = page.MediaBox.Bounds;
                var width = Math.Min(crop.Right, media.Right) - Math.Max(crop.Left, media.Left);
                var height = Math.Min(crop.Top, media.Top) - Math.Max(crop.Bottom, media.Bottom);
                if (width <= 0 || height <= 0) { width = media.Width; height = media.Height; }
                var scale = page.Dictionary.TryGet(NameToken.Create("UserUnit"), out var unit) && unit is NumericToken number ? number.Double : 1;
                if (page.Rotation.SwapsAxis) (width, height) = (height, width);
                width *= scale; height *= scale;
                Require(double.IsFinite(width) && double.IsFinite(height) && width is >= 220 and <= 5000 && height is >= 80 and <= 5000, "ขนาดหน้ากระดาษยังไม่รองรับ");
                pages.Add(new(width, height));
            }
            return pages.ToArray();
        }
        catch (TemplateFailure) { throw; }
        catch { throw new TemplateFailure(400, "อ่าน PDF ไม่สำเร็จ ไฟล์อาจเสียหาย เข้ารหัส หรือใช้รูปแบบที่ไม่รองรับ"); }
    }
    private static void Inspect(IToken token, int depth)
    {
        Require(depth < 64, "โครงสร้าง PDF ซับซ้อนเกินไป");
        if (token is DictionaryToken d)
        {
            Require(!d.Data.ContainsKey(NameToken.Create("ByteRange")) && !(d.TryGet(NameToken.Create("FT"), out var type) && type is NameToken n && n.Data == "Sig"), "ยังไม่รองรับ PDF ที่มีลายเซ็นดิจิทัล");
            foreach (var value in d.Data.Values) Inspect(value, depth + 1);
        }
        else if (token is ArrayToken a) foreach (var value in a.Data) Inspect(value, depth + 1);
        else if (token is StreamToken s) Inspect(s.StreamDictionary, depth + 1);
    }
}
