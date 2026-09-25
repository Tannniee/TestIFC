using System.Text.Json;

namespace IfcEngineV2.Scanner;

internal static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0].Equals("self-test", StringComparison.OrdinalIgnoreCase))
            {
                SelfTests.Run();
                Console.WriteLine("Engine V2 scanner self-test passed.");
                return 0;
            }
            if (args.Length >= 2 && args[0].Equals("probe", StringComparison.OrdinalIgnoreCase))
            {
                string? outputPath = null;
                string? probeIndexPath = null;
                string? probeChunks = null;
                var checkExtrusions = false;
                var checkGraph = false;
                for (var index = 2; index < args.Length; index++)
                {
                    var option = args[index];
                    if (option == "--check-extrusions") { checkExtrusions = true; continue; }
                    if (option == "--check-graph") { checkGraph = true; continue; }
                    if (index + 1 >= args.Length) throw new ArgumentException($"Missing value for {option}.");
                    var value = args[++index];
                    switch (option)
                    {
                        case "--output": outputPath = value; break;
                        case "--index": probeIndexPath = value; break;
                        case "--chunks": probeChunks = value; break;
                        default: throw new ArgumentException($"Unknown option {option}.");
                    }
                }
                outputPath ??= Path.ChangeExtension(Path.GetFullPath(args[1]), ".engine-v2-probe.json");
                var probe = LargeStepProbe.Run(args[1], outputPath, probeIndexPath,
                    checkExtrusions, checkGraph, probeChunks);
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    probe.SourceBytes, probe.SourceSha256, probe.Schema, probe.EntityCount,
                    probe.MaximumExpressId, probe.ScanMilliseconds, probe.IndexMilliseconds,
                    probe.IndexBytes, probe.GeometryStatus, probe.ExtrusionMilliseconds,
                    extrusionSucceeded = probe.ExtrusionValidation?.Succeeded,
                    extrusionFailed = probe.ExtrusionValidation?.Failed,
                    graphStatus = probe.GraphValidation?.Status,
                    geometryPlanStatus = probe.GraphValidation?.GeometryPlan.Status,
                    probe.GraphMilliseconds,
                    probe.TessellationMilliseconds,
                    viewerReady = probe.Tessellation?.ViewerReady,
                    triangles = probe.Tessellation?.Triangles,
                    products = probe.Tessellation?.Products,
                    outputPath = Path.GetFullPath(outputPath),
                    indexPath = probeIndexPath is null ? null : Path.GetFullPath(probeIndexPath),
                }));
                return 0;
            }
            if (args.Length < 2 || !args[0].Equals("scan", StringComparison.OrdinalIgnoreCase))
            {
                PrintUsage();
                return 2;
            }

            var sourcePath = args[1];
            string? manifestPath = null;
            string? indexPath = null;
            string? chunkOutputDirectory = null;
            string? csgOverridePath = null;
            for (var index = 2; index < args.Length; index++)
            {
                var option = args[index];
                if (index + 1 >= args.Length)
                {
                    throw new ArgumentException($"Missing value for {option}.");
                }
                var value = args[++index];
                switch (option)
                {
                    case "--manifest":
                        manifestPath = value;
                        break;
                    case "--index":
                        indexPath = value;
                        break;
                    case "--chunks":
                        chunkOutputDirectory = value;
                        break;
                    case "--csg-overrides":
                        csgOverridePath = value;
                        break;
                    default:
                        throw new ArgumentException($"Unknown option {option}.");
                }
            }

            manifestPath ??= Path.ChangeExtension(Path.GetFullPath(sourcePath), ".engine-v2.json");
            var result = StepScanner.Scan(new ScanOptions(sourcePath, manifestPath, indexPath, chunkOutputDirectory,
                CsgOverridePath: csgOverridePath));
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                result.Manifest.Complete,
                result.Manifest.Source.SizeBytes,
                result.Manifest.Source.Sha256,
                result.Manifest.Source.Schema,
                result.Manifest.Scan.EntityCount,
                result.Manifest.Scan.MaximumExpressId,
                result.Manifest.Scan.HashAndScanMilliseconds,
                result.Manifest.Scan.IndexMilliseconds,
                result.Manifest.Scan.GraphCoverageMilliseconds,
                result.Manifest.Scan.TessellationMilliseconds,
                result.Manifest.Coverage.Status,
                graphStatus = result.Manifest.Coverage.Graph.Status,
                manifestPath = Path.GetFullPath(manifestPath),
                indexPath = indexPath is null ? null : Path.GetFullPath(indexPath),
                chunks = result.Manifest.Tessellation?.Directory,
            }));
            return 0;
        }
        catch (IfcSizeLimitException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return 3;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception.Message);
            return 1;
        }
    }

    private static void PrintUsage()
    {
        Console.Error.WriteLine("Usage:");
        Console.Error.WriteLine("  ifc-engine-v2-scanner self-test");
        Console.Error.WriteLine("  ifc-engine-v2-scanner probe <model.ifc> [--output <probe.json>] [--index <model.ifc2idx>] [--check-extrusions] [--check-graph] [--chunks <directory>]");
        Console.Error.WriteLine("  ifc-engine-v2-scanner scan <model.ifc> [--manifest <manifest.json>] [--index <model.ifc2idx>] [--chunks <directory>]");
    }
}
