using System.IO.MemoryMappedFiles;

namespace IfcEngineV2.Scanner;

/// <summary>Exercises the current extrusion mesher on reachable definitions only.
/// This checks local mesh construction, not independent geometric parity.</summary>
internal static class ExtrusionProbe
{
    public static unsafe ExtrusionProbeResult Run(byte* source, long sourceLength, string indexPath,
        byte[] sourceSha256, long maximumExpressId, TypeRegistry registry, int[] extrusionIds)
    {
        if (sourceLength > int.MaxValue)
            throw new InvalidDataException("Extrusion validation still requires a 32-bit source span; use the 64-bit inventory probe at 2 GiB.");
        using var map = MemoryMappedFile.CreateFromFile(indexPath, FileMode.Open, null, 0, MemoryMappedFileAccess.Read);
        using var view = map.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
        byte* index = null;
        view.SafeMemoryMappedViewHandle.AcquirePointer(ref index);
        try
        {
            index += view.PointerOffset;
            var sourceSpan = new ReadOnlySpan<byte>(source, checked((int)sourceLength));
            var indexSpan = new ReadOnlySpan<byte>(index, checked((int)new FileInfo(indexPath).Length));
            var entries = GraphCoverageAnalyzer.ValidateIndex(indexSpan, sourceLength,
                sourceSha256, maximumExpressId);
            var angleScale = AngleUnitResolver.ResolveRadiansPerUnit(sourceSpan, entries,
                maximumExpressId, registry);
            var succeeded = 0L;
            var failed = 0L;
            var points = 0L;
            var triangles = 0L;
            var successByProfile = new Dictionary<string, long>(StringComparer.Ordinal);
            var failuresByProfile = new Dictionary<string, long>(StringComparer.Ordinal);
            var failureDetails = new List<string>();
            foreach (var id in extrusionIds)
            {
                var profile = ProfileName(sourceSpan, entries, registry, id);
                if (ExtrusionGeometry.TryBuild(sourceSpan, entries, registry, id, angleScale,
                    out var mesh, out var error))
                {
                    succeeded++;
                    points += mesh.Points.Count;
                    triangles += mesh.Indices.Count / 3;
                    successByProfile[profile] = successByProfile.GetValueOrDefault(profile) + 1;
                }
                else
                {
                    failed++;
                    failuresByProfile[profile] = failuresByProfile.GetValueOrDefault(profile) + 1;
                    if (failureDetails.Count < 40) failureDetails.Add(error ?? $"Extrusion #{id} failed without a reason.");
                }
            }
            return new ExtrusionProbeResult("local-mesh-construction-only", extrusionIds.Length,
                succeeded, failed, points, triangles, angleScale,
                successByProfile, failuresByProfile, failureDetails);
        }
        finally { view.SafeMemoryMappedViewHandle.ReleasePointer(); }
    }

    private static string ProfileName(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries,
        TypeRegistry registry, int extrusionId)
    {
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, extrusionId, out var extrusion, out _) ||
            !StepParsing.TryGetTopLevelArgument(extrusion, 0, out var argument) ||
            !StepParsing.TryReadSingleReference(argument, out var profileId) ||
            !GraphCoverageAnalyzer.TryGetRecord(source, entries, profileId, out _, out var typeId))
            return "MISSING_PROFILE";
        return registry[typeId].Name;
    }
}

internal sealed record ExtrusionProbeResult(string Scope, long ReachableUniqueExtrusions,
    long Succeeded, long Failed, long GeneratedPoints, long GeneratedTriangles,
    double AngleScaleToRadians, IReadOnlyDictionary<string, long> SucceededByProfile,
    IReadOnlyDictionary<string, long> FailedByProfile, IReadOnlyList<string> FailureDetails);
