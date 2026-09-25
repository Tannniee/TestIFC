namespace IfcEngineV2.Scanner;

internal static class RepresentationPolicy
{
    private static readonly HashSet<string> AuxiliaryIdentifiers = new(StringComparer.Ordinal)
    {
        "AXIS",
        "BOX",
        "FOOTPRINT",
        "REFERENCE",
        "ANNOTATION",
        "COG",
    };

    public static bool IsAuxiliary(ReadOnlySpan<byte> representation)
    {
        if (!StepParsing.TryGetTopLevelArgument(representation, 1, out var identifier) ||
            StepParsing.IsOmitted(identifier))
        {
            return false;
        }
        return AuxiliaryIdentifiers.Contains(StepParsing.NormalizeStepString(identifier));
    }
}
