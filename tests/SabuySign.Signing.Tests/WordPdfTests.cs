using SabuySign.Media;
using Xunit;
namespace SabuySign.Signing.Tests;

public class WordPdfTests
{
    [Fact]
    public void WordLimitsAreIndependentOfVideoLimits()
    {
        MediaStore.Validate(new("word-pdf", 50_000_000));
        Assert.Throws<MediaFailure>(() => MediaStore.Validate(new("word-pdf", 50_000_001)));
        Assert.Throws<MediaFailure>(() => MediaStore.Validate(new("word-pdf", 0)));
        MediaStore.Validate(new("mp3", 500_000_000));
        MediaStore.Validate(new("gif", 200_000_000, 0, 30));
        Assert.Throws<MediaFailure>(() => MediaStore.Validate(new("unknown", 10)));
    }
}
