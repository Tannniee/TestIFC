namespace IfcEngineV2.Scanner;

internal sealed class CoverageCollector
{
    private static readonly HashSet<string> SupportedRepresentationTypes = new(StringComparer.Ordinal)
    {
        "BREP",
        "CLIPPING",
        "MAPPEDREPRESENTATION",
        "SURFACEMODEL",
        "SWEPTSOLID",
        "TESSELLATION",
    };

    private readonly Dictionary<RegistryKey, ValueCounter> _representationTypes = new();
    private readonly long[] _loopBuckets = new long[7];
    private readonly long[] _pointDimensions = new long[5];

    private long _rootLocalPlacements;
    private long _nestedLocalPlacements;
    private long _explicitAxisPlacements;
    private long _defaultAxisPlacements;
    private long _translationOnlyOperators;
    private long _complexOperators;
    private long _faces;
    private long _faceBoundReferences;
    private int _maximumBoundsPerFace;
    private long _polyLoops;
    private long _polyLoopPointReferences;
    private int _maximumPointsPerLoop;
    private long _candidateTriangles;

    public void Observe(EntityKind kind, ReadOnlySpan<byte> record)
    {
        switch (kind)
        {
            case EntityKind.ShapeRepresentation:
                ObserveRepresentationType(record);
                break;
            case EntityKind.LocalPlacement:
                ObserveLocalPlacement(record);
                break;
            case EntityKind.Axis2Placement3D:
                ObserveAxisPlacement(record);
                break;
            case EntityKind.CartesianTransformationOperator3D:
                ObserveTransformOperator(record);
                break;
            case EntityKind.Face:
                ObserveFace(record);
                break;
            case EntityKind.PolyLoop:
                ObservePolyLoop(record);
                break;
            case EntityKind.CartesianPoint:
                ObserveCartesianPoint(record);
                break;
        }
    }

    public CoverageCensus Build(TypeRegistry registry, GraphCoverageLedger graph)
    {
        var entityCounts = registry.Entries.ToDictionary(entry => entry.Name, entry => entry.Count, StringComparer.Ordinal);
        var unsupported = registry.Entries
            .Where(entry => entry.Kind == EntityKind.UnsupportedGeometry && entry.Count > 0)
            .OrderBy(entry => entry.Name, StringComparer.Ordinal)
            .ToDictionary(entry => entry.Name, entry => entry.Count, StringComparer.Ordinal);
        var representationTypes = _representationTypes.Values
            .OrderBy(value => value.Name, StringComparer.Ordinal)
            .ToDictionary(value => value.Name, value => value.Count, StringComparer.Ordinal);

        var reasons = new List<string>();
        var baseDefinitions = registry.Entries
            .Where(entry => GraphCoverageAnalyzer.IsBaseGeometry(entry.Kind))
            .Sum(entry => entry.Count);
        if (graph.ProductDefinitions == 0) reasons.Add("No represented product definitions were found.");
        else if (graph.UniqueBaseDefinitionsReferenced == 0) reasons.Add("No supported reachable base geometry was found.");
        if (graph.Status != "complete")
        {
            reasons.AddRange(graph.Issues.Take(16));
            reasons.AddRange(graph.ProductBindings.Issues.Take(Math.Max(0, 24 - reasons.Count)));
            reasons.AddRange(graph.GeometryPlan.Issues.Take(Math.Max(0, 32 - reasons.Count)));
            if (reasons.Count == 0) reasons.Add("Geometry graph or tessellation plan is incomplete.");
        }

        var shellModels = entityCounts.GetValueOrDefault("IFCSHELLBASEDSURFACEMODEL");
        var mappedItems = entityCounts.GetValueOrDefault("IFCMAPPEDITEM");
        var loopBuckets = new Dictionary<string, long>(StringComparer.Ordinal)
        {
            ["0-2"] = _loopBuckets[0],
            ["3"] = _loopBuckets[1],
            ["4"] = _loopBuckets[2],
            ["5-8"] = _loopBuckets[3],
            ["9-16"] = _loopBuckets[4],
            ["17-32"] = _loopBuckets[5],
            [">32"] = _loopBuckets[6],
        };
        var pointDimensions = new Dictionary<string, long>(StringComparer.Ordinal)
        {
            ["unknown"] = _pointDimensions[0],
            ["1D"] = _pointDimensions[1],
            ["2D"] = _pointDimensions[2],
            ["3D"] = _pointDimensions[3],
            [">3D"] = _pointDimensions[4],
        };

        return new CoverageCensus(
            reasons.Count == 0 ? "fast-path-candidate" : "fallback-required",
            reasons,
            SupportedRepresentationTypes.Order(StringComparer.Ordinal).ToArray(),
            representationTypes,
            unsupported,
            baseDefinitions,
            mappedItems,
            entityCounts.GetValueOrDefault("IFCSTYLEDITEM"),
            entityCounts.GetValueOrDefault("IFCCOLOURRGB"),
            new PlacementCensus(
                _rootLocalPlacements,
                _nestedLocalPlacements,
                _explicitAxisPlacements,
                _defaultAxisPlacements,
                _translationOnlyOperators,
                _complexOperators),
            new TopologyCensus(
                _faces,
                _faceBoundReferences,
                _maximumBoundsPerFace,
                _polyLoops,
                _polyLoopPointReferences,
                _maximumPointsPerLoop,
                _candidateTriangles,
                loopBuckets,
                pointDimensions),
            graph);
    }

    private void ObserveRepresentationType(ReadOnlySpan<byte> record)
    {
        if (!StepParsing.TryGetTopLevelArgument(record, 2, out var value)) return;
        var token = StepParsing.TrimStepString(value);
        var key = new RegistryKey(StepParsing.HashAsciiUpper(token), token.Length);
        if (_representationTypes.TryGetValue(key, out var counter))
        {
            counter.Count++;
        }
        else
        {
            _representationTypes.Add(key, new ValueCounter(StepParsing.AsciiUpperString(token)));
        }
    }

    private void ObserveLocalPlacement(ReadOnlySpan<byte> record)
    {
        if (!StepParsing.TryGetTopLevelArgument(record, 0, out var parent)) return;
        if (StepParsing.IsOmitted(parent)) _rootLocalPlacements++;
        else _nestedLocalPlacements++;
    }

    private void ObserveAxisPlacement(ReadOnlySpan<byte> record)
    {
        var hasAxis = StepParsing.TryGetTopLevelArgument(record, 1, out var axis) && !StepParsing.IsOmitted(axis);
        var hasReference = StepParsing.TryGetTopLevelArgument(record, 2, out var reference) && !StepParsing.IsOmitted(reference);
        if (hasAxis || hasReference) _explicitAxisPlacements++;
        else _defaultAxisPlacements++;
    }

    private void ObserveTransformOperator(ReadOnlySpan<byte> record)
    {
        var complex = false;
        foreach (var argumentIndex in new[] { 0, 1, 3, 4 })
        {
            if (StepParsing.TryGetTopLevelArgument(record, argumentIndex, out var value) && !StepParsing.IsOmitted(value))
            {
                complex = true;
                break;
            }
        }
        if (complex) _complexOperators++;
        else _translationOnlyOperators++;
    }

    private void ObserveFace(ReadOnlySpan<byte> record)
    {
        _faces++;
        if (!StepParsing.TryGetTopLevelArgument(record, 0, out var bounds)) return;
        var count = StepParsing.CountReferences(bounds);
        _faceBoundReferences += count;
        _maximumBoundsPerFace = Math.Max(_maximumBoundsPerFace, count);
    }

    private void ObservePolyLoop(ReadOnlySpan<byte> record)
    {
        _polyLoops++;
        if (!StepParsing.TryGetTopLevelArgument(record, 0, out var points)) return;
        var count = StepParsing.CountReferences(points);
        _polyLoopPointReferences += count;
        _maximumPointsPerLoop = Math.Max(_maximumPointsPerLoop, count);
        _candidateTriangles += Math.Max(0, count - 2);
        _loopBuckets[LoopBucket(count)]++;
    }

    private void ObserveCartesianPoint(ReadOnlySpan<byte> record)
    {
        if (!StepParsing.TryGetTopLevelArgument(record, 0, out var coordinates))
        {
            _pointDimensions[0]++;
            return;
        }
        var dimension = StepParsing.CountListItems(coordinates);
        _pointDimensions[dimension switch
        {
            1 => 1,
            2 => 2,
            3 => 3,
            > 3 => 4,
            _ => 0,
        }]++;
    }

    private static int LoopBucket(int count) => count switch
    {
        <= 2 => 0,
        3 => 1,
        4 => 2,
        <= 8 => 3,
        <= 16 => 4,
        <= 32 => 5,
        _ => 6,
    };

    private sealed class ValueCounter(string name)
    {
        public string Name { get; } = name;
        public long Count { get; set; } = 1;
    }
}
