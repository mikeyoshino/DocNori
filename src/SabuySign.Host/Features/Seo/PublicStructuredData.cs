using System.Text.Json;

namespace SabuySign.Host.Features.Seo;

public static class PublicStructuredData
{
    public static string Create(PublicSite site, string path, string title, string description)
    {
        var url = site.Url(path);
        var home = site.Url("/");
        var graph = new List<object>();
        if (path == "/")
        {
            graph.Add(new Dictionary<string, object>
            {
                ["@type"] = "WebSite",
                ["@id"] = home + "#website",
                ["name"] = "DocNori",
                ["url"] = home,
                ["inLanguage"] = "th"
            });
        }
        var page = new Dictionary<string, object>
        {
            ["@type"] = "WebPage",
            ["@id"] = url + "#webpage",
            ["name"] = title,
            ["description"] = description,
            ["url"] = url,
            ["inLanguage"] = "th",
            ["isPartOf"] = new Dictionary<string, object> { ["@id"] = home + "#website" }
        };
        graph.Add(page);
        if (path == "/tools/fill-sign")
        {
            page["mainEntity"] = new Dictionary<string, object> { ["@id"] = url + "#application" };
            page["breadcrumb"] = new Dictionary<string, object> { ["@id"] = url + "#breadcrumb" };
            graph.Add(new Dictionary<string, object>
            {
                ["@type"] = "WebApplication",
                ["@id"] = url + "#application",
                ["name"] = "DocNori กรอกและเซ็น PDF",
                ["url"] = url,
                ["description"] = description,
                ["inLanguage"] = "th",
                ["applicationCategory"] = "BusinessApplication",
                ["operatingSystem"] = "Web",
                ["browserRequirements"] = "Requires JavaScript and WebAssembly",
                ["isAccessibleForFree"] = true,
                ["offers"] = new Dictionary<string, object> { ["@type"] = "Offer", ["price"] = 0, ["priceCurrency"] = "THB" },
                ["featureList"] = new[] { "กรอกข้อความภาษาไทยและอังกฤษบน PDF", "วาดและวางลายเซ็น", "ใช้มือถือวาดลายเซ็นผ่าน QR Code", "ดาวน์โหลด PDF หลังกรอกและเซ็น" }
            });
            graph.Add(new Dictionary<string, object>
            {
                ["@type"] = "BreadcrumbList",
                ["@id"] = url + "#breadcrumb",
                ["itemListElement"] = new[]
                {
                    new Dictionary<string, object> { ["@type"] = "ListItem", ["position"] = 1, ["name"] = "หน้าแรก", ["item"] = home },
                    new Dictionary<string, object> { ["@type"] = "ListItem", ["position"] = 2, ["name"] = "กรอกและเซ็น PDF", ["item"] = url }
                }
            });
        }
        // Default escaping keeps HTML delimiters safe when emitted inside a script element.
        return JsonSerializer.Serialize(new Dictionary<string, object> { ["@context"] = "https://schema.org", ["@graph"] = graph });
    }
}
