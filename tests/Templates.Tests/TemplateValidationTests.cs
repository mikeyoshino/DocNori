using SabuySign.Host.Features.DocumentTemplates;
using Xunit;

public class TemplateValidationTests
{
    private readonly TemplateLimits limits = new();
    private readonly TemplatePage[] pages = [new(595, 842)];
    private static TemplateDefinition Valid() => new([new("f", "Company", "text", false, "")], [new("p", "f", 0, 20, 20, 180, 40, 16, "#172433", "left", false)]);
    [Fact] public void ValidDefinitionAccepted() => TemplateValidation.Validate("Contract", Valid(), pages, limits);
    [Fact] public void UnknownFieldRejected() => Assert.Throws<TemplateFailure>(() => TemplateValidation.Validate("Contract", Valid() with { Fields = [] }, pages, limits));
    [Fact]
    public void OffPageAndNonfiniteCoordinatesRejected()
    {
        foreach (var placement in new[] { Valid().Placements[0] with { X = 594 }, Valid().Placements[0] with { Width = double.NaN }, Valid().Placements[0] with { Page = 1 } })
            Assert.Throws<TemplateFailure>(() => TemplateValidation.Validate("Contract", Valid() with { Placements = [placement] }, pages, limits));
    }
    [Fact]
    public void DuplicateIdsAndInvalidDefaultsRejected()
    {
        var d = Valid();
        Assert.Throws<TemplateFailure>(() => TemplateValidation.Validate("Contract", d with { Fields = [d.Fields[0], d.Fields[0]] }, pages, limits));
        Assert.Throws<TemplateFailure>(() => TemplateValidation.Validate("Contract", d with { Fields = [d.Fields[0] with { Type = "date", DefaultValue = "tomorrow" }] }, pages, limits));
    }
    [Fact]
    public void DuplicateRekeysReferences()
    {
        var d = TemplateValidation.Copy(Valid());
        Assert.NotEqual("f", d.Fields[0].Id);
        Assert.NotEqual("p", d.Placements[0].Id);
        Assert.Equal(d.Fields[0].Id, d.Placements[0].FieldId);
    }
    [Fact] public void InvalidPdfRejected() => Assert.Throws<TemplateFailure>(() => TemplateValidation.Pdf("%PDF-1.7\nbroken"u8.ToArray(), limits));
}
