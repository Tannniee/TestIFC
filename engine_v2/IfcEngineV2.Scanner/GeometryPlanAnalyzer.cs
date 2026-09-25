using System.Buffers.Binary;
using System.Security.Cryptography;

namespace IfcEngineV2.Scanner;

internal static class GeometryPlanAnalyzer
{
    private const int MaximumReportedIssues = 5_000;

    public static GeometryPlanLedger Analyze(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        long maximumExpressId,
        TypeRegistry registry,
        int[] occurrenceCounts,
        long expectedBaseDefinitions,
        out IReadOnlyDictionary<int, GeneratedMesh> generatedMeshes,
        IReadOnlyDictionary<int, GeneratedMesh>? csgOverrides = null)
    {
        var plannedGeneratedMeshes = new Dictionary<int, GeneratedMesh>();
        generatedMeshes = plannedGeneratedMeshes;
        var issues = new List<string>();
        var angleScaleToRadians = AngleUnitResolver.ResolveRadiansPerUnit(source, entries, maximumExpressId, registry);
        var lengthUnitScaleToMetres = InstanceChunkWriter.ResolveLengthUnitScale(
            source, entries, checked((int)maximumExpressId + 1), registry);
        var coordinates = CoordinateStore.Build(source, entries, maximumExpressId, registry);
        var loopContext = new LoopAnalysisContext(source, entries, maximumExpressId, registry, coordinates);
        var generatedPlans = BuildGeneratedPlans(source, entries, maximumExpressId, registry, occurrenceCounts,
            angleScaleToRadians, lengthUnitScaleToMetres, csgOverrides);
        var shellIds = new List<int>(2);
        var faceIds = new List<int>(64);
        var boundIds = new List<int>(4);
        using var checksum = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        Span<byte> checksumEntry = stackalloc byte[28];
        long resolvedDefinitions = 0;
        long expandedOccurrences = 0;
        long faces = 0;
        long facesWithHoles = 0;
        long outerBounds = 0;
        long innerBounds = 0;
        long baseTriangles = 0;
        long expandedTriangles = 0;
        long cleanedBaseTriangles = 0;
        long cleanedExpandedTriangles = 0;
        long degenerateFaces = 0;

        for (var baseId = 0; baseId <= maximumExpressId; baseId++)
        {
            var occurrences = occurrenceCounts[checked((int)baseId)];
            if (occurrences == 0) continue;
            expandedOccurrences += occurrences;
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, baseId, out var definition, out var definitionTypeId))
            {
                AddIssue(issues, $"Base definition #{baseId} is missing from the index.");
                continue;
            }

            shellIds.Clear();
            var definitionKind = registry[definitionTypeId].Kind;
            var definitionTriangles = 0L;
            var cleanedDefinitionTriangles = 0L;
            var definitionFaces = 0L;
            var definitionValid = true;
            if (csgOverrides is not null && csgOverrides.TryGetValue(checked((int)baseId), out var replacement) &&
                definitionKind is (EntityKind.FacetedBrep or EntityKind.ShellBasedSurfaceModel or EntityKind.FaceBasedSurfaceModel or
                    EntityKind.TriangulatedFaceSet or EntityKind.PolygonalFaceSet))
            {
                plannedGeneratedMeshes.Add(checked((int)baseId), replacement);
                definitionTriangles = replacement.Indices.Count / 3;
                cleanedDefinitionTriangles = definitionTriangles;
                definitionFaces = replacement.FaceCount;
            }
            else if (definitionKind is EntityKind.ExtrudedAreaSolid or EntityKind.ExtrudedAreaSolidTapered or EntityKind.SweptDiskSolid or EntityKind.RevolvedAreaSolid or EntityKind.BooleanClippingResult or
                EntityKind.BooleanResult or EntityKind.TriangulatedFaceSet or EntityKind.PolygonalFaceSet)
            {
                if (!generatedPlans.TryGetValue(checked((int)baseId), out var generated))
                {
                    AddIssue(issues, $"Base definition #{baseId} has no generated geometry plan.");
                    definitionValid = false;
                    degenerateFaces++;
                }
                else if (generated.Mesh is null)
                {
                    AddIssue(issues, generated.Error ?? $"Base definition #{baseId} could not be planned.");
                    definitionValid = false;
                    degenerateFaces++;
                }
                else
                {
                    plannedGeneratedMeshes.Add(checked((int)baseId), generated.Mesh);
                    definitionTriangles = generated.Mesh.Indices.Count / 3;
                    cleanedDefinitionTriangles = definitionTriangles;
                    definitionFaces = generated.Mesh.FaceCount;
                }
            }
            else if (definitionKind == EntityKind.FacetedBrep)
            {
                if (!StepParsing.TryGetTopLevelArgument(definition, 0, out var shellArgument) ||
                    !StepParsing.TryReadSingleReference(shellArgument, out var shellId))
                {
                    AddIssue(issues, $"IfcFacetedBrep #{baseId} has no Outer shell.");
                    continue;
                }
                shellIds.Add(shellId);
            }
            else if (definitionKind == EntityKind.ShellBasedSurfaceModel)
            {
                if (!StepParsing.TryGetTopLevelArgument(definition, 0, out var shellsArgument))
                {
                    AddIssue(issues, $"IfcShellBasedSurfaceModel #{baseId} has no shell list.");
                    continue;
                }
                StepParsing.CollectReferences(shellsArgument, shellIds);
            }
            else if (definitionKind == EntityKind.FaceBasedSurfaceModel)
            {
                if (!StepParsing.TryGetTopLevelArgument(definition, 0, out var faceSetsArgument))
                {
                    AddIssue(issues, $"IfcFaceBasedSurfaceModel #{baseId} has no face-set list.");
                    continue;
                }
                StepParsing.CollectReferences(faceSetsArgument, shellIds);
            }
            else
            {
                AddIssue(issues, $"Geometry occurrence points to unsupported {registry[definitionTypeId].Name} #{baseId}.");
                continue;
            }

            if (definitionKind is (EntityKind.FacetedBrep or EntityKind.ShellBasedSurfaceModel or EntityKind.FaceBasedSurfaceModel) &&
                !plannedGeneratedMeshes.ContainsKey(checked((int)baseId)))
            {
                definitionValid = shellIds.Count > 0;
                foreach (var shellId in shellIds)
                {
                    if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, shellId, out var shell, out var shellTypeId) ||
                        registry[shellTypeId].Kind is not (EntityKind.ClosedShell or EntityKind.OpenShell or EntityKind.ConnectedFaceSet) ||
                        !StepParsing.TryGetTopLevelArgument(shell, 0, out var facesArgument))
                    {
                        AddIssue(issues, $"Base definition #{baseId} references invalid shell #{shellId}.");
                        definitionValid = false;
                        continue;
                    }
                    StepParsing.CollectReferences(facesArgument, faceIds);
                    foreach (var faceId in faceIds)
                    {
                        definitionFaces++;
                        if (!TryPlanFace(source, entries, registry, faceId, boundIds, ref loopContext, issues, out var facePlan))
                        {
                            definitionValid = false;
                            degenerateFaces++;
                            continue;
                        }
                        definitionTriangles += facePlan.RawTriangles;
                        cleanedDefinitionTriangles += facePlan.CleanedTriangles;
                        if (facePlan.Collapsed) degenerateFaces++;
                        outerBounds += facePlan.OuterBounds;
                        innerBounds += facePlan.InnerBounds;
                        if (facePlan.InnerBounds > 0) facesWithHoles++;
                    }
                }
            }

            faces += definitionFaces;
            baseTriangles += definitionTriangles;
            expandedTriangles = checked(expandedTriangles + definitionTriangles * occurrences);
            cleanedBaseTriangles += cleanedDefinitionTriangles;
            cleanedExpandedTriangles = checked(cleanedExpandedTriangles + cleanedDefinitionTriangles * occurrences);
            BinaryPrimitives.WriteInt32LittleEndian(checksumEntry, checked((int)baseId));
            BinaryPrimitives.WriteInt32LittleEndian(checksumEntry[4..], occurrences);
            BinaryPrimitives.WriteInt64LittleEndian(checksumEntry[8..], definitionTriangles);
            BinaryPrimitives.WriteInt64LittleEndian(checksumEntry[16..], cleanedDefinitionTriangles);
            BinaryPrimitives.WriteInt32LittleEndian(checksumEntry[24..], checked((int)definitionFaces));
            checksum.AppendData(checksumEntry);
            if (definitionValid) resolvedDefinitions++;
        }

        var coordinateLedger = loopContext.BuildLedger();
        var status = resolvedDefinitions == expectedBaseDefinitions && issues.Count == 0 &&
                     coordinateLedger.Status == "complete"
            ? "complete"
            : "incomplete";
        return new GeometryPlanLedger(
            status,
            Convert.ToHexString(checksum.GetHashAndReset()),
            expectedBaseDefinitions,
            resolvedDefinitions,
            expandedOccurrences,
            faces,
            facesWithHoles,
            outerBounds,
            innerBounds,
            baseTriangles,
            expandedTriangles,
            cleanedBaseTriangles,
            cleanedExpandedTriangles,
            degenerateFaces,
            coordinateLedger,
            issues);
    }

    private static unsafe Dictionary<int, GeneratedPlanResult> BuildGeneratedPlans(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        long maximumExpressId,
        TypeRegistry registry,
        int[] occurrenceCounts,
        double angleScaleToRadians,
        double lengthUnitScaleToMetres,
        IReadOnlyDictionary<int, GeneratedMesh>? csgOverrides)
    {
        var candidates = new List<(int Id, EntityKind Kind)>();
        for (var baseId = 0; baseId <= maximumExpressId; baseId++)
        {
            if (occurrenceCounts[checked((int)baseId)] == 0 ||
                !GraphCoverageAnalyzer.TryGetRecord(source, entries, baseId, out _, out var typeId)) continue;
            var kind = registry[typeId].Kind;
            if (kind is EntityKind.ExtrudedAreaSolid or EntityKind.ExtrudedAreaSolidTapered or EntityKind.SweptDiskSolid or EntityKind.RevolvedAreaSolid or EntityKind.BooleanClippingResult or
                EntityKind.BooleanResult or EntityKind.TriangulatedFaceSet or EntityKind.PolygonalFaceSet)
                candidates.Add((checked((int)baseId), kind));
        }

        var plans = new Dictionary<int, GeneratedPlanResult>(candidates.Count);
        if (candidates.Count == 0) return plans;
        var results = new GeneratedPlanResult[candidates.Count];
        var configuredWorkers = Environment.GetEnvironmentVariable("IFC_ENGINE_V2_GEOMETRY_WORKERS");
        // Large source mappings can already consume most of the desktop's memory budget.
        // Keep their generated geometry serial unless a benchmark explicitly opts in.
        var defaultWorkers = source.Length <= 256 * 1024 * 1024 ? Math.Min(2, Environment.ProcessorCount) : 1;
        var workerCount = configuredWorkers switch
        {
            "1" => 1,
            "2" => Math.Min(2, Environment.ProcessorCount),
            _ => defaultWorkers,
        };
        fixed (byte* sourcePointer = source, entriesPointer = entries)
        {
            var sourceAddress = (nint)sourcePointer;
            var entriesAddress = (nint)entriesPointer;
            var sourceLength = source.Length;
            var entriesLength = entries.Length;
            Parallel.For(0, candidates.Count, new ParallelOptions { MaxDegreeOfParallelism = workerCount }, index =>
            {
                var (id, kind) = candidates[index];
                if (csgOverrides is not null && csgOverrides.TryGetValue(id, out var overrideMesh))
                {
                    results[index] = new GeneratedPlanResult(overrideMesh, null);
                    return;
                }
                if (kind is EntityKind.SweptDiskSolid or EntityKind.RevolvedAreaSolid)
                {
                    results[index] = new GeneratedPlanResult(null, $"Base definition #{id} requires external shape conversion.");
                    return;
                }
                var mappedSource = new ReadOnlySpan<byte>((void*)sourceAddress, sourceLength);
                var mappedEntries = new ReadOnlySpan<byte>((void*)entriesAddress, entriesLength);
                GeneratedMesh mesh;
                string? error;
                var success = kind switch
                {
                    EntityKind.ExtrudedAreaSolid or EntityKind.ExtrudedAreaSolidTapered => ExtrusionGeometry.TryBuild(mappedSource, mappedEntries, registry, id, angleScaleToRadians, out mesh, out error),
                    EntityKind.BooleanClippingResult or EntityKind.BooleanResult => BooleanGeometry.TryBuild(mappedSource, mappedEntries, registry, id, angleScaleToRadians, out mesh, out error),
                    _ => DirectFaceSetGeometry.TryBuild(mappedSource, mappedEntries, registry, id,
                        lengthUnitScaleToMetres, out mesh, out error),
                };
                if (!success && error is not null &&
                    kind is (EntityKind.PolygonalFaceSet or EntityKind.TriangulatedFaceSet))
                    error = $"Base definition #{id}: {error}";
                results[index] = new GeneratedPlanResult(success ? mesh : null, error);
            });
        }
        for (var index = 0; index < candidates.Count; index++)
            plans.Add(candidates[index].Id, results[index]);
        return plans;
    }

    private readonly record struct GeneratedPlanResult(GeneratedMesh? Mesh, string? Error);

    private static bool TryPlanFace(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int faceId,
        List<int> boundIds,
        ref LoopAnalysisContext loopContext,
        List<string> issues,
        out FacePlan plan)
    {
        plan = default;
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, faceId, out var face, out var faceTypeId) ||
            registry[faceTypeId].Kind != EntityKind.Face ||
            !StepParsing.TryGetTopLevelArgument(face, 0, out var boundsArgument))
        {
            AddIssue(issues, $"Shell references invalid IfcFace #{faceId}.");
            return false;
        }

        StepParsing.CollectReferences(boundsArgument, boundIds);
        var outerCount = 0;
        var innerCount = 0;
        var rawVertexCount = 0L;
        var cleanedVertexCount = 0L;
        foreach (var boundId in boundIds)
        {
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, boundId, out var bound, out var boundTypeId))
            {
                AddIssue(issues, $"IfcFace #{faceId} references missing bound #{boundId}.");
                return false;
            }
            var boundKind = registry[boundTypeId].Kind;
            if (boundKind == EntityKind.FaceOuterBound) outerCount++;
            else if (boundKind == EntityKind.FaceBound) innerCount++;
            else
            {
                AddIssue(issues, $"IfcFace #{faceId} references unsupported {registry[boundTypeId].Name} #{boundId}.");
                return false;
            }
            if (!StepParsing.TryGetTopLevelArgument(bound, 0, out var loopArgument) ||
                !StepParsing.TryReadSingleReference(loopArgument, out var loopId) ||
                !loopContext.TryResolve(loopId, out var loopPlan))
            {
                AddIssue(issues, $"IfcFaceBound #{boundId} has no valid IfcPolyLoop.");
                return false;
            }
            if (loopPlan.CleanedVertices == 0)
            {
                if (boundKind == EntityKind.FaceOuterBound && boundIds.Count == 1)
                {
                    // Repeated points reduced this sole outer ring to at most
                    // an edge. It has exactly zero surface area; retain the
                    // face in the audit while emitting no triangles.
                    plan = new FacePlan(0, 0, 1, 0, true);
                    return true;
                }
                AddIssue(issues, $"IfcFaceBound #{boundId} collapses inside a bounded face.");
                return false;
            }
            rawVertexCount += loopPlan.RawVertices;
            cleanedVertexCount += loopPlan.CleanedVertices;
        }

        if (outerCount != 1)
        {
            AddIssue(issues, $"IfcFace #{faceId} has {outerCount} outer bounds; expected one.");
            return false;
        }
        var rawTriangles = rawVertexCount + 2L * innerCount - 2;
        var cleanedTriangles = cleanedVertexCount + 2L * innerCount - 2;
        if (rawTriangles <= 0 || cleanedTriangles <= 0)
        {
            AddIssue(issues, $"IfcFace #{faceId} has an invalid triangle plan.");
            return false;
        }
        plan = new FacePlan(rawTriangles, cleanedTriangles, outerCount, innerCount, false);
        return true;
    }

    private static void AddIssue(List<string> issues, string issue)
    {
        if (issues.Count < MaximumReportedIssues) issues.Add(issue);
    }

    private readonly record struct FacePlan(long RawTriangles, long CleanedTriangles, int OuterBounds, int InnerBounds, bool Collapsed);
    private readonly record struct LoopPlan(int RawVertices, int CleanedVertices);

    private readonly record struct Point3(double X, double Y, double Z)
    {
        public bool SameAs(Point3 other) => X == other.X && Y == other.Y && Z == other.Z;
    }

    private readonly record struct Point2(double X, double Y);

    private sealed class CoordinateStore
    {
        private readonly int[] _ordinalByExpressId;
        private readonly double[] _coordinates;

        private CoordinateStore(int[] ordinalByExpressId, double[] coordinates, long decoded, long invalid, IReadOnlyList<string> issues)
        {
            _ordinalByExpressId = ordinalByExpressId;
            _coordinates = coordinates;
            Decoded = decoded;
            Invalid = invalid;
            Issues = issues;
        }

        public long Decoded { get; }
        public long Invalid { get; }
        public IReadOnlyList<string> Issues { get; }

        public static CoordinateStore Build(
            ReadOnlySpan<byte> source,
            ReadOnlySpan<byte> entries,
            long maximumExpressId,
            TypeRegistry registry)
        {
            var expected = registry.Entries.Where(entry => entry.Kind == EntityKind.CartesianPoint).Sum(entry => entry.Count);
            var ordinals = new int[checked((int)maximumExpressId + 1)];
            var coordinateValues = new double[checked((int)expected * 3)];
            var issues = new List<string>();
            var ordinal = 0;
            long invalid = 0;
            Span<double> parsed = stackalloc double[4];
            for (var expressId = 0; expressId <= maximumExpressId; expressId++)
            {
                if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, expressId, out var record, out var typeId) ||
                    registry[typeId].Kind != EntityKind.CartesianPoint) continue;
                if (!StepParsing.TryGetTopLevelArgument(record, 0, out var coordinateArgument) ||
                    !StepParsing.TryParseDoubleList(coordinateArgument, parsed, out var count) || count is < 2 or > 3)
                {
                    invalid++;
                    AddCoordinateIssue(issues, $"IfcCartesianPoint #{expressId} has invalid coordinates.");
                    continue;
                }
                ordinals[checked((int)expressId)] = ordinal + 1;
                coordinateValues[ordinal * 3] = parsed[0];
                coordinateValues[ordinal * 3 + 1] = parsed[1];
                coordinateValues[ordinal * 3 + 2] = count == 3 ? parsed[2] : 0;
                ordinal++;
            }
            if (ordinal != expected - invalid)
            {
                AddCoordinateIssue(issues, $"Coordinate coverage mismatch: expected {expected}, decoded {ordinal}, invalid {invalid}.");
            }
            return new CoordinateStore(ordinals, coordinateValues, ordinal, invalid, issues);
        }

        public bool TryGet(int expressId, out Point3 point)
        {
            point = default;
            if ((uint)expressId >= (uint)_ordinalByExpressId.Length) return false;
            var stored = _ordinalByExpressId[expressId];
            if (stored == 0) return false;
            var offset = (stored - 1) * 3;
            point = new Point3(_coordinates[offset], _coordinates[offset + 1], _coordinates[offset + 2]);
            return true;
        }

        private static void AddCoordinateIssue(List<string> issues, string issue)
        {
            if (issues.Count < MaximumReportedIssues) issues.Add(issue);
        }
    }

    private ref struct LoopAnalysisContext
    {
        private readonly ReadOnlySpan<byte> _source;
        private readonly ReadOnlySpan<byte> _entries;
        private readonly TypeRegistry _registry;
        private readonly CoordinateStore _coordinates;
        private readonly int[] _rawCounts;
        private readonly int[] _cleanedCounts;
        private readonly byte[] _states;
        private readonly List<int> _pointIds;
        private readonly List<Point3> _points;
        private readonly List<Point2> _projected;
        private long _decodedLoops;
        private long _closingDuplicates;
        private long _consecutiveDuplicates;
        private long _collinearVertices;
        private long _invalidPointReferences;
        private readonly List<string> _issues;

        public LoopAnalysisContext(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries, long maximumExpressId, TypeRegistry registry, CoordinateStore coordinates)
        {
            _source = source;
            _entries = entries;
            _registry = registry;
            _coordinates = coordinates;
            _rawCounts = new int[checked((int)maximumExpressId + 1)];
            _cleanedCounts = new int[checked((int)maximumExpressId + 1)];
            _states = new byte[checked((int)maximumExpressId + 1)];
            _pointIds = new List<int>(16);
            _points = new List<Point3>(16);
            _projected = new List<Point2>(16);
            _decodedLoops = 0;
            _closingDuplicates = 0;
            _consecutiveDuplicates = 0;
            _collinearVertices = 0;
            _invalidPointReferences = 0;
            _issues = [];
        }

        public bool TryResolve(int loopId, out LoopPlan plan)
        {
            plan = default;
            if ((uint)loopId >= (uint)_states.Length) return false;
            if (_states[loopId] == 1)
            {
                plan = new LoopPlan(_rawCounts[loopId], _cleanedCounts[loopId]);
                return true;
            }
            if (_states[loopId] == 2) return false;
            if (!GraphCoverageAnalyzer.TryGetRecord(_source, _entries, loopId, out var loop, out var loopTypeId) ||
                _registry[loopTypeId].Kind != EntityKind.PolyLoop ||
                !StepParsing.TryGetTopLevelArgument(loop, 0, out var pointsArgument))
            {
                Fail(loopId, $"IfcPolyLoop #{loopId} is missing or malformed.");
                return false;
            }
            StepParsing.CollectReferences(pointsArgument, _pointIds);
            var rawCount = _pointIds.Count;
            if (rawCount < 3)
            {
                Fail(loopId, $"IfcPolyLoop #{loopId} has only {rawCount} point references.");
                return false;
            }

            _points.Clear();
            foreach (var pointId in _pointIds)
            {
                if (!_coordinates.TryGet(pointId, out var point))
                {
                    _invalidPointReferences++;
                    Fail(loopId, $"IfcPolyLoop #{loopId} references missing point #{pointId}.");
                    return false;
                }
                if (_points.Count > 0 && _points[^1].SameAs(point))
                {
                    _consecutiveDuplicates++;
                    continue;
                }
                _points.Add(point);
            }
            if (_points.Count > 1 && _points[0].SameAs(_points[^1]))
            {
                _points.RemoveAt(_points.Count - 1);
                _closingDuplicates++;
            }
            if (_points.Count < 3)
            {
                _rawCounts[loopId] = rawCount;
                _cleanedCounts[loopId] = 0;
                _states[loopId] = 1;
                _decodedLoops++;
                plan = new LoopPlan(rawCount, 0);
                return true;
            }

            ProjectToDominantPlane(_points, _projected);
            _collinearVertices += RemoveCollinear(_projected);
            if (_projected.Count < 3)
            {
                Fail(loopId, $"IfcPolyLoop #{loopId} collapses after collinear-point removal.");
                return false;
            }

            _rawCounts[loopId] = rawCount;
            _cleanedCounts[loopId] = _projected.Count;
            _states[loopId] = 1;
            _decodedLoops++;
            plan = new LoopPlan(rawCount, _projected.Count);
            return true;
        }

        public CoordinateAuditLedger BuildLedger()
        {
            var allIssues = _coordinates.Issues.Concat(_issues).Take(MaximumReportedIssues).ToArray();
            var invalid = _coordinates.Invalid + _invalidPointReferences;
            return new CoordinateAuditLedger(
                invalid == 0 && allIssues.Length == 0 ? "complete" : "incomplete",
                _coordinates.Decoded,
                _decodedLoops,
                _closingDuplicates,
                _consecutiveDuplicates,
                _collinearVertices,
                invalid,
                allIssues);
        }

        private void Fail(int loopId, string issue)
        {
            _states[loopId] = 2;
            if (_issues.Count < MaximumReportedIssues) _issues.Add(issue);
        }

        private static void ProjectToDominantPlane(List<Point3> points, List<Point2> destination)
        {
            var nx = 0d;
            var ny = 0d;
            var nz = 0d;
            for (var index = 0; index < points.Count; index++)
            {
                var current = points[index];
                var next = points[(index + 1) % points.Count];
                nx += (current.Y - next.Y) * (current.Z + next.Z);
                ny += (current.Z - next.Z) * (current.X + next.X);
                nz += (current.X - next.X) * (current.Y + next.Y);
            }
            var ax = Math.Abs(nx);
            var ay = Math.Abs(ny);
            var az = Math.Abs(nz);
            destination.Clear();
            foreach (var point in points)
            {
                destination.Add(ax >= ay && ax >= az
                    ? new Point2(point.Y, point.Z)
                    : ay >= az
                        ? new Point2(point.X, point.Z)
                        : new Point2(point.X, point.Y));
            }
        }

        private static int RemoveCollinear(List<Point2> points)
        {
            var removed = 0;
            var changed = true;
            while (changed && points.Count >= 3)
            {
                changed = false;
                for (var index = points.Count - 1; index >= 0; index--)
                {
                    var previous = points[(index - 1 + points.Count) % points.Count];
                    var current = points[index];
                    var next = points[(index + 1) % points.Count];
                    var ax = current.X - previous.X;
                    var ay = current.Y - previous.Y;
                    var bx = next.X - current.X;
                    var by = next.Y - current.Y;
                    var cross = ax * by - ay * bx;
                    var scale = Math.Max(1d, Math.Abs(ax * by) + Math.Abs(ay * bx));
                    if (Math.Abs(cross) > 1e-12 * scale) continue;
                    points.RemoveAt(index);
                    removed++;
                    changed = true;
                }
            }
            return removed;
        }
    }
}
