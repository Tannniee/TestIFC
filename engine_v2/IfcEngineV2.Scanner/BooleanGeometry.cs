using System.Diagnostics;

namespace IfcEngineV2.Scanner;

internal static class BooleanGeometry
{
    private const int MaximumDepth = 64;
    private const int MaximumBooleanNodes = 256;
    private const int MaximumVertices = 1_000_000;
    private const int MaximumTriangles = 2_000_000;
    private static readonly TimeSpan MaximumBuildTime = TimeSpan.FromSeconds(10);

    public static bool TryBuild(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int booleanId,
        double angleScaleToRadians,
        out GeneratedMesh mesh,
        out string? error)
    {
        try
        {
            mesh = Build(source, entries, registry, booleanId, angleScaleToRadians);
            error = null;
            return true;
        }
        catch (InvalidDataException exception)
        {
            mesh = new GeneratedMesh([], [], 0, 0);
            error = exception.Message;
            return false;
        }
    }

    public static GeneratedMesh Build(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int booleanId,
        double angleScaleToRadians)
    {
        var stopwatch = Stopwatch.StartNew();
        var nodes = 0;
        var mesh = BuildOperand(source, entries, registry, booleanId, angleScaleToRadians, 0, ref nodes, stopwatch);
        if (!IsClosedManifold(mesh)) mesh = ConformMesh(mesh, booleanId);
        ValidateClosedManifold(mesh, booleanId);
        return mesh;
    }

    private static GeneratedMesh BuildOperand(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int operandId,
        double angleScaleToRadians,
        int depth,
        ref int nodes,
        Stopwatch stopwatch)
    {
        Guard(depth, ref nodes, stopwatch, operandId);
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, operandId, out var operand, out var typeId))
            throw new InvalidDataException($"Boolean operand #{operandId} is missing.");
        var kind = registry[typeId].Kind;
        if (depth > 0 && kind is (EntityKind.BooleanClippingResult or EntityKind.BooleanResult))
            throw new InvalidDataException($"Nested boolean operand #{operandId} requires a validated CSG kernel; use the complete-model fallback.");
        if (kind == EntityKind.ExtrudedAreaSolid)
            return ExtrusionGeometry.Build(source, entries, registry, operandId, angleScaleToRadians);
        if (kind is EntityKind.TriangulatedFaceSet or EntityKind.PolygonalFaceSet)
            return DirectFaceSetGeometry.Build(source, entries, registry, operandId);
        if (kind is not (EntityKind.BooleanClippingResult or EntityKind.BooleanResult))
            throw new InvalidDataException($"Boolean operand {registry[typeId].Name} #{operandId} is not supported.");

        if (!StepParsing.TryGetTopLevelArgument(operand, 0, out var operation) ||
            !StepParsing.AsciiUpperString(StepParsing.Trim(operation)).Equals(".DIFFERENCE.", StringComparison.Ordinal))
            throw new InvalidDataException($"Boolean result #{operandId} is supported only for DIFFERENCE.");
        var firstId = RequireReference(operand, 1, $"Boolean result #{operandId} FirstOperand");
        var secondId = RequireReference(operand, 2, $"Boolean result #{operandId} SecondOperand");
        var first = BuildOperand(source, entries, registry, firstId, angleScaleToRadians, depth + 1, ref nodes, stopwatch);
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, secondId, out _, out var secondTypeId))
            throw new InvalidDataException($"Boolean second operand #{secondId} is missing.");
        var secondKind = registry[secondTypeId].Kind;
        GeneratedMesh clipped;
        if (secondKind is EntityKind.HalfSpaceSolid or EntityKind.PolygonalBoundedHalfSpace)
        {
            var halfSpace = ResolveHalfSpace(source, entries, registry, secondId, first, angleScaleToRadians);
            clipped = halfSpace.IsBounded
                ? halfSpace.Cutter is null ? first : CsgMeshBoolean.Difference(first, halfSpace.Cutter, operandId)
                : ClipByPlane(first, halfSpace, operandId);
        }
        else if (secondKind is EntityKind.ExtrudedAreaSolid or EntityKind.TriangulatedFaceSet or EntityKind.PolygonalFaceSet or
                 EntityKind.BooleanClippingResult or EntityKind.BooleanResult)
        {
            throw new InvalidDataException($"Boolean result #{operandId} with a solid second operand requires a validated CSG kernel; use the complete-model fallback.");
        }
        else
        {
            throw new InvalidDataException($"Boolean second operand {registry[secondTypeId].Name} #{secondId} is not supported.");
        }
        GuardMeshSize(clipped, operandId);
        if (!IsClosedManifold(clipped)) clipped = ConformMesh(clipped, operandId);
        ValidateClosedManifold(clipped, operandId);
        return clipped;
    }

    private static HalfSpace ResolveHalfSpace(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int halfSpaceId,
        GeneratedMesh operand,
        double angleScaleToRadians)
    {
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, halfSpaceId, out var halfSpace, out var typeId))
            throw new InvalidDataException($"Boolean half-space operand #{halfSpaceId} is missing.");
        var kind = registry[typeId].Kind;
        if (kind is not (EntityKind.HalfSpaceSolid or EntityKind.PolygonalBoundedHalfSpace))
            throw new InvalidDataException($"Boolean second operand {registry[typeId].Name} #{halfSpaceId} is not a supported half-space.");
        var surfaceId = RequireReference(halfSpace, 0, $"Half-space #{halfSpaceId} BaseSurface");
        var plane = RequireRecord(source, entries, registry, surfaceId, EntityKind.Plane);
        var placementId = RequireReference(plane, 0, $"IfcPlane #{surfaceId} Position");
        var planeFrame = ResolveFrame3(source, entries, registry, placementId);
        if (!StepParsing.TryGetTopLevelArgument(halfSpace, 1, out var agreementArgument) ||
            !StepParsing.TryParseLogical(agreementArgument, out var agreement))
            throw new InvalidDataException($"Half-space #{halfSpaceId} has invalid AgreementFlag.");

        GeneratedMesh? cutter = null;
        var isBounded = kind == EntityKind.PolygonalBoundedHalfSpace;
        if (isBounded)
        {
            var extent = CoordinateExtent(operand.Points);
            var tolerance = Math.Max(1e-9, extent * 1e-10);
            var materialKeepPositive = !agreement;
            var maximumMaterialDistance = operand.Points.Max(point =>
            {
                var distance = P3.From(point).Subtract(planeFrame.Origin).Dot(planeFrame.Z);
                return materialKeepPositive ? distance : -distance;
            });
            if (maximumMaterialDistance <= tolerance)
                return new HalfSpace(planeFrame.Origin, planeFrame.Z, agreement, true, null);
            var boundaryPlacementId = RequireReference(halfSpace, 2, $"IfcPolygonalBoundedHalfSpace #{halfSpaceId} Position");
            var boundaryCurveId = RequireReference(halfSpace, 3, $"IfcPolygonalBoundedHalfSpace #{halfSpaceId} PolygonalBoundary");
            var boundaryFrame = ResolveFrame3(source, entries, registry, boundaryPlacementId);
            var alignment = Math.Abs(planeFrame.Z.Dot(boundaryFrame.Z));
            if (alignment <= 1e-8)
                throw new InvalidDataException($"IfcPolygonalBoundedHalfSpace #{halfSpaceId} plane is perpendicular to its extrusion direction.");
            var boundary = ResolveBoundary(source, entries, registry, boundaryCurveId, halfSpaceId, angleScaleToRadians);
            cutter = BuildBoundedCutter(boundary, boundaryFrame, operand, planeFrame.Origin, planeFrame.Z, agreement, halfSpaceId);
        }

        return new HalfSpace(planeFrame.Origin, planeFrame.Z, agreement, isBounded, cutter);
    }

    private static GeneratedMesh ClipByPlane(GeneratedMesh source, HalfSpace halfSpace, int booleanId)
    {
        GuardMeshSize(source, booleanId);
        var extent = CoordinateExtent(source.Points);
        var tolerance = Math.Max(1e-9, extent * 1e-10);
        var points = new List<GeneratedPoint>(source.Points.Count + 64);
        var indices = new List<int>(source.Indices.Count + 96);
        // Independently intersected adjacent triangles can differ by a few ULPs after
        // large placement transforms. A small weld margin keeps their cut loop joined.
        var welder = new PointWelder(points, tolerance * 4);
        var cutEdges = new HashSet<Edge>();
        var cutOccurred = false;
        var inputBuffer = new Vertex[3];
        var polygonBuffer = new Vertex[6];
        var polygonIndexBuffer = new int[6];

        for (var triangle = 0; triangle < source.Indices.Count; triangle += 3)
        {
            var input = inputBuffer.AsSpan();
            for (var corner = 0; corner < 3; corner++)
            {
                var point = source.Points[source.Indices[triangle + corner]];
                var distance = SignedDistance(point, halfSpace);
                input[corner] = new Vertex(point, halfSpace.KeepPositive ? distance : -distance);
            }
            var polygon = polygonBuffer.AsSpan();
            var count = ClipTriangle(input, polygon, tolerance);
            if (count == 0) continue;
            var hasOutside = input[0].Distance < -tolerance || input[1].Distance < -tolerance || input[2].Distance < -tolerance;
            if (count != 3 || hasOutside) cutOccurred = true;

            var polygonIndices = polygonIndexBuffer.AsSpan();
            var planeVertices = new List<int>(2);
            for (var index = 0; index < count; index++)
            {
                polygonIndices[index] = welder.Add(polygon[index].Point);
                if (Math.Abs(polygon[index].Distance) <= tolerance && !planeVertices.Contains(polygonIndices[index]))
                    planeVertices.Add(polygonIndices[index]);
            }
            if (hasOutside && planeVertices.Count >= 2)
            {
                var first = planeVertices[0];
                var second = planeVertices[1];
                var best = DistanceSquared(points[first], points[second]);
                for (var left = 0; left < planeVertices.Count; left++)
                for (var right = left + 1; right < planeVertices.Count; right++)
                {
                    var distance = DistanceSquared(points[planeVertices[left]], points[planeVertices[right]]);
                    if (distance <= best) continue;
                    best = distance;
                    first = planeVertices[left];
                    second = planeVertices[right];
                }
                if (first != second && best > tolerance * tolerance)
                    cutEdges.Add(new Edge(first, second).Normalized());
            }

            for (var index = 1; index + 1 < count; index++)
                AddTriangle(points, indices, polygonIndices[0], polygonIndices[index], polygonIndices[index + 1], tolerance);
        }

        if (indices.Count == 0)
            throw new InvalidDataException($"Boolean result #{booleanId} removed the entire first operand.");
        var capFaces = 0;
        if (cutOccurred)
        {
            var intersectionEdges = cutEdges;
            var conformed = ConformMesh(new GeneratedMesh(points, indices, indices.Count / 3, 0), booleanId);
            points = conformed.Points.ToList();
            indices = conformed.Indices.ToList();
            cutEdges = FindOpenPlaneEdges(points, indices, halfSpace, tolerance, booleanId);
            if (cutEdges.Count == 0)
                throw new InvalidDataException($"Boolean result #{booleanId} changed topology without a closed cut boundary.");
            List<List<int>> loops;
            try
            {
                loops = BuildCutLoops(cutEdges, points, tolerance, booleanId);
            }
            catch (InvalidDataException openEdgeError)
            {
                try
                {
                    loops = BuildCutLoops(intersectionEdges, points, tolerance, booleanId);
                }
                catch (InvalidDataException intersectionError)
                {
                    throw new InvalidDataException($"{openEdgeError.Message} Direct plane-intersection ledger also failed: {intersectionError.Message}");
                }
            }
            capFaces = AddCaps(points, indices, loops, halfSpace, tolerance, booleanId);
        }
        return new GeneratedMesh(points, indices, indices.Count / 3, capFaces);
    }

    private static int ClipTriangle(ReadOnlySpan<Vertex> input, Span<Vertex> output, double tolerance)
    {
        var count = 0;
        var previous = input[^1];
        var previousInside = previous.Distance >= -tolerance;
        foreach (var current in input)
        {
            var currentInside = current.Distance >= -tolerance;
            if (currentInside != previousInside)
            {
                var denominator = previous.Distance - current.Distance;
                if (Math.Abs(denominator) <= tolerance * 1e-4)
                    throw new InvalidDataException("Boolean plane intersection is numerically unstable.");
                var t = previous.Distance / denominator;
                var point = Lerp(previous.Point, current.Point, t);
                output[count++] = new Vertex(point, 0);
            }
            if (currentInside) output[count++] = current;
            previous = current;
            previousInside = currentInside;
        }
        return count;
    }

    private static List<List<int>> BuildCutLoops(
        HashSet<Edge> edges,
        IReadOnlyList<GeneratedPoint> points,
        double tolerance,
        int booleanId)
    {
        var adjacency = new Dictionary<int, List<int>>();
        foreach (var edge in edges)
        {
            AddAdjacent(adjacency, edge.A, edge.B);
            AddAdjacent(adjacency, edge.B, edge.A);
        }
        var invalidDegrees = adjacency
            .Select(pair => pair.Value.Distinct().Count())
            .Where(degree => degree != 2)
            .GroupBy(degree => degree)
            .OrderBy(group => group.Key)
            .Select(group => $"degree {group.Key}: {group.Count():N0}")
            .ToArray();
        if (invalidDegrees.Length > 0)
        {
            var endpoints = adjacency.Where(pair => pair.Value.Distinct().Count() == 1).Select(pair => pair.Key).ToArray();
            var gap = endpoints.Length == 2 ? Math.Sqrt(DistanceSquared(points[endpoints[0]], points[endpoints[1]])) : double.NaN;
            var endpointText = endpoints.Length == 2
                ? $"; endpoints ({points[endpoints[0]].X:G17},{points[endpoints[0]].Y:G17},{points[endpoints[0]].Z:G17}) to ({points[endpoints[1]].X:G17},{points[endpoints[1]].Y:G17},{points[endpoints[1]].Z:G17})"
                : string.Empty;
            var invalidVertices = adjacency
                .Where(pair => pair.Value.Distinct().Count() != 2)
                .Take(4)
                .Select(pair => $"{pair.Key}:d{pair.Value.Distinct().Count()}@({points[pair.Key].X:G17},{points[pair.Key].Y:G17},{points[pair.Key].Z:G17})")
                .ToArray();
            throw new InvalidDataException($"Boolean result #{booleanId} cut boundary is not a closed two-manifold loop ({string.Join(", ", invalidDegrees)}; {edges.Count:N0} edges; endpoint gap {gap:G17}; tolerance {tolerance:G17}{endpointText}; invalid vertices {string.Join(" | ", invalidVertices)}).");
        }

        var remaining = new HashSet<Edge>(edges);
        var loops = new List<List<int>>();
        while (remaining.Count > 0)
        {
            var first = remaining.First();
            var loop = new List<int> { first.A };
            var previous = first.A;
            var current = first.B;
            remaining.Remove(first);
            while (current != loop[0])
            {
                loop.Add(current);
                if (loop.Count > edges.Count + 1)
                    throw new InvalidDataException($"Boolean result #{booleanId} cut loop exceeded its edge count.");
                var neighbors = adjacency[current];
                var next = neighbors[0] == previous ? neighbors[1] : neighbors[0];
                var edge = new Edge(current, next).Normalized();
                if (!remaining.Remove(edge))
                    throw new InvalidDataException($"Boolean result #{booleanId} cut loop reuses or misses an edge.");
                previous = current;
                current = next;
            }
            if (loop.Count < 3) throw new InvalidDataException($"Boolean result #{booleanId} produced a cut loop with fewer than three vertices.");
            loops.Add(loop);
        }
        return loops;
    }

    private static HashSet<Edge> FindOpenPlaneEdges(
        IReadOnlyList<GeneratedPoint> points,
        IReadOnlyList<int> indices,
        HalfSpace halfSpace,
        double tolerance,
        int booleanId)
    {
        var counts = new Dictionary<Edge, int>();
        for (var index = 0; index < indices.Count; index += 3)
        {
            CountEdge(counts, indices[index], indices[index + 1]);
            CountEdge(counts, indices[index + 1], indices[index + 2]);
            CountEdge(counts, indices[index + 2], indices[index]);
        }
        var result = new HashSet<Edge>();
        foreach (var pair in counts)
        {
            if (pair.Value != 1) continue;
            if (Math.Abs(SignedDistance(points[pair.Key.A], halfSpace)) <= tolerance &&
                Math.Abs(SignedDistance(points[pair.Key.B], halfSpace)) <= tolerance)
                result.Add(pair.Key);
        }
        if (counts.Any(pair => pair.Value == 1 && !result.Contains(pair.Key)))
            throw new InvalidDataException($"Boolean result #{booleanId} produced an open edge away from its clipping plane.");
        return result;
    }

    private static int AddCaps(
        List<GeneratedPoint> points,
        List<int> indices,
        List<List<int>> loops,
        HalfSpace halfSpace,
        double tolerance,
        int booleanId)
    {
        var normal = halfSpace.Normal;
        var u = Math.Abs(normal.X) < 0.8 ? new P3(1, 0, 0) : new P3(0, 1, 0);
        u = u.Subtract(normal.Scale(u.Dot(normal))).Normalize("Boolean cap X axis");
        var v = normal.Cross(u).Normalize("Boolean cap Y axis");
        var projected = loops.Select(loop => loop.Select(index => Project(points[index], halfSpace.Origin, u, v)).ToList()).ToList();
        var parents = Enumerable.Repeat(-1, loops.Count).ToArray();
        var areas = projected.Select(SignedArea).ToArray();
        for (var child = 0; child < loops.Count; child++)
        {
            var bestArea = double.PositiveInfinity;
            for (var candidate = 0; candidate < loops.Count; candidate++)
            {
                if (candidate == child || Math.Abs(areas[candidate]) <= Math.Abs(areas[child])) continue;
                if (!PointInPolygon(projected[child][0], projected[candidate])) continue;
                var candidateArea = Math.Abs(areas[candidate]);
                if (candidateArea < bestArea) { bestArea = candidateArea; parents[child] = candidate; }
            }
        }
        var depths = new int[loops.Count];
        for (var index = 0; index < loops.Count; index++)
        {
            var cursor = parents[index];
            while (cursor >= 0)
            {
                if (++depths[index] > loops.Count) throw new InvalidDataException($"Boolean result #{booleanId} has cyclic cap containment.");
                cursor = parents[cursor];
            }
        }

        var expected = halfSpace.KeepPositive ? normal.Scale(-1) : normal;
        var capFaces = 0;
        for (var outer = 0; outer < loops.Count; outer++)
        {
            if ((depths[outer] & 1) != 0) continue;
            var ringOrder = new List<int> { outer };
            for (var hole = 0; hole < loops.Count; hole++)
                if (parents[hole] == outer && depths[hole] == depths[outer] + 1) ringOrder.Add(hole);

            var flat = new List<double>();
            var flatToPoint = new List<int>();
            var holes = new List<int>();
            for (var ringPosition = 0; ringPosition < ringOrder.Count; ringPosition++)
            {
                var ringIndex = ringOrder[ringPosition];
                var pointOrder = Enumerable.Range(0, loops[ringIndex].Count).ToList();
                var shouldBeCounterClockwise = ringPosition == 0;
                if ((areas[ringIndex] > 0) != shouldBeCounterClockwise) pointOrder.Reverse();
                if (ringPosition > 0) holes.Add(flatToPoint.Count);
                foreach (var pointIndex in pointOrder)
                {
                    var projectedPoint = projected[ringIndex][pointIndex];
                    flat.Add(projectedPoint.X);
                    flat.Add(projectedPoint.Y);
                    flatToPoint.Add(loops[ringIndex][pointIndex]);
                }
            }
            var triangles = new List<int>();
            EarcutTriangulator.Triangulate(flat, holes, triangles);
            if (triangles.Count == 0 || EarcutTriangulator.Deviation(flat, holes, triangles) > 1e-8)
                throw new InvalidDataException($"Boolean result #{booleanId} cap could not be triangulated safely.");
            for (var index = 0; index < triangles.Count; index += 3)
                AddOrientedTriangle(points, indices, flatToPoint[triangles[index]], flatToPoint[triangles[index + 1]], flatToPoint[triangles[index + 2]], expected, tolerance);
            capFaces++;
        }
        return capFaces;
    }

    private static List<P2> ResolveBoundary(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int curveId,
        int halfSpaceId,
        double angleScaleToRadians)
    {
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, curveId, out var curve, out var typeId))
            throw new InvalidDataException($"IfcPolygonalBoundedHalfSpace #{halfSpaceId} boundary #{curveId} is missing.");
        var points = new List<P2>();
        if (registry[typeId].Kind == EntityKind.Polyline)
        {
            if (!StepParsing.TryGetTopLevelArgument(curve, 0, out var pointArgument))
                throw new InvalidDataException($"IfcPolyline #{curveId} has no points.");
            var pointIds = new List<int>();
            StepParsing.CollectReferences(pointArgument, pointIds);
            foreach (var pointId in pointIds)
            {
                var point = ResolvePoint3(source, entries, registry, pointId);
                points.Add(new P2(point.X, point.Y));
            }
        }
        else if (registry[typeId].Kind == EntityKind.IndexedPolyCurve)
        {
            var pointListId = RequireReference(curve, 0, $"IfcIndexedPolyCurve #{curveId} Points");
            var pointList = RequireRecord(source, entries, registry, pointListId, EntityKind.CartesianPointList2D);
            if (!StepParsing.TryGetTopLevelArgument(pointList, 0, out var coordinates))
                throw new InvalidDataException($"IfcCartesianPointList2D #{pointListId} has no coordinates.");
            var tuples = new List<double[]>();
            if (!StepParsing.TryParseDoubleTuples(coordinates, 2, tuples))
                throw new InvalidDataException($"IfcCartesianPointList2D #{pointListId} has invalid coordinates.");
            foreach (var tuple in tuples) points.Add(new P2(tuple[0], tuple[1]));
        }
        else if (registry[typeId].Kind == EntityKind.CompositeCurve)
        {
            foreach (var point in ExtrusionGeometry.ResolveBoundaryCurve(source, entries, registry, curveId, $"IfcPolygonalBoundedHalfSpace #{halfSpaceId} PolygonalBoundary", angleScaleToRadians))
                points.Add(new P2(point.X, point.Y));
        }
        else
        {
            throw new InvalidDataException($"IfcPolygonalBoundedHalfSpace #{halfSpaceId} boundary {registry[typeId].Name} #{curveId} is not yet supported.");
        }
        CleanBoundary(points, halfSpaceId);
        return points;
    }

    private static GeneratedMesh? BuildBoundedCutter(
        List<P2> boundary,
        Frame3 frame,
        GeneratedMesh operand,
        P3 planeOrigin,
        P3 planeNormal,
        bool agreement,
        int halfSpaceId)
    {
        if (SignedArea(boundary) < 0) boundary.Reverse();
        var maximumZ = double.NegativeInfinity;
        foreach (var point in operand.Points)
        {
            var local = frame.Inverse(P3.From(point));
            maximumZ = Math.Max(maximumZ, local.Z);
        }
        var extent = CoordinateExtent(operand.Points);
        var tolerance = Math.Max(1e-9, extent * 1e-10);
        if (maximumZ <= tolerance) return null;
        var top = maximumZ + Math.Max(1, extent * 0.01);
        var flat = new List<double>(boundary.Count * 2);
        foreach (var point in boundary) { flat.Add(point.X); flat.Add(point.Y); }
        var cap = new List<int>();
        EarcutTriangulator.Triangulate(flat, [], cap);
        if (cap.Count == 0 || EarcutTriangulator.Deviation(flat, [], cap) > 1e-8)
            throw new InvalidDataException($"IfcPolygonalBoundedHalfSpace #{halfSpaceId} boundary could not be triangulated safely.");

        var points = new List<GeneratedPoint>(boundary.Count * 2);
        foreach (var point in boundary) points.Add(frame.Transform(new P3(point.X, point.Y, 0)).ToPublic());
        foreach (var point in boundary) points.Add(frame.Transform(new P3(point.X, point.Y, top)).ToPublic());
        var indices = new List<int>(cap.Count * 2 + boundary.Count * 6);
        for (var index = 0; index < cap.Count; index += 3)
        {
            AddOrientedTriangle(points, indices, cap[index], cap[index + 1], cap[index + 2], frame.Z.Scale(-1), tolerance);
            AddOrientedTriangle(points, indices, cap[index] + boundary.Count, cap[index + 1] + boundary.Count, cap[index + 2] + boundary.Count, frame.Z, tolerance);
        }
        for (var index = 0; index < boundary.Count; index++)
        {
            var next = (index + 1) % boundary.Count;
            var edge = frame.TransformVector(new P3(boundary[next].X - boundary[index].X, boundary[next].Y - boundary[index].Y, 0));
            var outward = edge.Cross(frame.Z);
            AddOrientedTriangle(points, indices, index, next, next + boundary.Count, outward, tolerance);
            AddOrientedTriangle(points, indices, index, next + boundary.Count, index + boundary.Count, outward, tolerance);
        }
        var prism = new GeneratedMesh(points, indices, indices.Count / 3, 2);
        var materialHalfSpace = new HalfSpace(planeOrigin, planeNormal, !agreement, false, null);
        var distances = prism.Points.Select(point => (materialHalfSpace.KeepPositive ? 1 : -1) * SignedDistance(point, materialHalfSpace)).ToArray();
        if (distances.Max() <= tolerance) return null;
        if (distances.All(distance => distance >= -tolerance)) return prism;
        return ClipByPlane(prism, materialHalfSpace, halfSpaceId);
    }

    private static void CleanBoundary(List<P2> points, int halfSpaceId)
    {
        if (points.Count > 4096) throw new InvalidDataException($"IfcPolygonalBoundedHalfSpace #{halfSpaceId} boundary exceeds 4,096 points.");
        if (points.Count > 1 && DistanceSquared(points[0], points[^1]) <= 1e-20) points.RemoveAt(points.Count - 1);
        for (var index = points.Count - 1; index > 0; index--)
            if (DistanceSquared(points[index], points[index - 1]) <= 1e-20) points.RemoveAt(index);
        var changed = true;
        while (changed && points.Count >= 3)
        {
            changed = false;
            for (var index = points.Count - 1; index >= 0; index--)
            {
                var a = points[(index - 1 + points.Count) % points.Count];
                var b = points[index];
                var c = points[(index + 1) % points.Count];
                if (Math.Abs(Cross(a, b, c)) > 1e-12) continue;
                points.RemoveAt(index);
                changed = true;
            }
        }
        if (points.Count < 3 || Math.Abs(SignedArea(points)) <= 1e-12)
            throw new InvalidDataException($"IfcPolygonalBoundedHalfSpace #{halfSpaceId} boundary collapses after cleanup.");
    }

    private static void InsertCollinearBoundaryVertices(IReadOnlyList<double> flat, List<int> triangles)
    {
        var scale = flat.Select(Math.Abs).DefaultIfEmpty(1).Max();
        var tolerance = Math.Max(1e-10, scale * 1e-10);
        var maximumSplits = checked(flat.Count * 4);
        for (var split = 0; split < maximumSplits; split++)
        {
            var inserted = false;
            for (var triangle = 0; triangle < triangles.Count && !inserted; triangle += 3)
            {
                for (var edge = 0; edge < 3; edge++)
                {
                    var aPosition = triangle + edge;
                    var bPosition = triangle + (edge + 1) % 3;
                    var aIndex = triangles[aPosition];
                    var bIndex = triangles[bPosition];
                    var a = new P2(flat[aIndex * 2], flat[aIndex * 2 + 1]);
                    var b = new P2(flat[bIndex * 2], flat[bIndex * 2 + 1]);
                    for (var pointIndex = 0; pointIndex < flat.Count / 2; pointIndex++)
                    {
                        if (pointIndex == aIndex || pointIndex == bIndex) continue;
                        var point = new P2(flat[pointIndex * 2], flat[pointIndex * 2 + 1]);
                        if (!PointStrictlyOnSegment(point, a, b, tolerance)) continue;
                        var cIndex = triangles[triangle + (edge + 2) % 3];
                        triangles[aPosition] = aIndex;
                        triangles[bPosition] = pointIndex;
                        triangles[triangle + (edge + 2) % 3] = cIndex;
                        triangles.Add(pointIndex);
                        triangles.Add(bIndex);
                        triangles.Add(cIndex);
                        inserted = true;
                        break;
                    }
                    if (inserted) break;
                }
            }
            if (!inserted) return;
        }
        throw new InvalidDataException("Boolean cap collinear-vertex repair exceeded its bounded work limit.");
    }

    private static bool PointStrictlyOnSegment(P2 point, P2 a, P2 b, double tolerance)
    {
        var dx = b.X - a.X;
        var dy = b.Y - a.Y;
        var lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= tolerance * tolerance) return false;
        var t = ((point.X - a.X) * dx + (point.Y - a.Y) * dy) / lengthSquared;
        if (t <= tolerance || t >= 1 - tolerance) return false;
        var projected = new P2(a.X + dx * t, a.Y + dy * t);
        return DistanceSquared(point, projected) <= tolerance * tolerance;
    }

    private static bool PointStrictlyOnSegment(GeneratedPoint point, GeneratedPoint a, GeneratedPoint b, double tolerance)
    {
        var dx = b.X - a.X;
        var dy = b.Y - a.Y;
        var dz = b.Z - a.Z;
        var lengthSquared = dx * dx + dy * dy + dz * dz;
        if (lengthSquared <= tolerance * tolerance) return false;
        var t = ((point.X - a.X) * dx + (point.Y - a.Y) * dy + (point.Z - a.Z) * dz) / lengthSquared;
        if (t <= 1e-10 || t >= 1 - 1e-10) return false;
        var px = a.X + dx * t;
        var py = a.Y + dy * t;
        var pz = a.Z + dz * t;
        var ex = point.X - px;
        var ey = point.Y - py;
        var ez = point.Z - pz;
        return ex * ex + ey * ey + ez * ez <= tolerance * tolerance;
    }

    private static void ValidateClosedManifold(GeneratedMesh mesh, int expressId)
    {
        if (mesh.Indices.Count == 0 || mesh.Indices.Count % 3 != 0)
            throw new InvalidDataException($"Generated solid #{expressId} has no complete triangles.");
        var edges = new Dictionary<Edge, int>();
        for (var index = 0; index < mesh.Indices.Count; index += 3)
        {
            CountEdge(edges, mesh.Indices[index], mesh.Indices[index + 1]);
            CountEdge(edges, mesh.Indices[index + 1], mesh.Indices[index + 2]);
            CountEdge(edges, mesh.Indices[index + 2], mesh.Indices[index]);
        }
        var invalid = edges.Count(pair => pair.Value != 2);
        if (invalid != 0)
        {
            var open = edges.Count(pair => pair.Value == 1);
            var over = edges.Count(pair => pair.Value > 2);
            throw new InvalidDataException($"Generated solid #{expressId} is not closed two-manifold; {open:N0} open and {over:N0} over-connected edges were found.");
        }
    }

    private static bool IsClosedManifold(GeneratedMesh mesh)
    {
        if (mesh.Indices.Count == 0 || mesh.Indices.Count % 3 != 0) return false;
        var edges = new Dictionary<Edge, int>();
        for (var index = 0; index < mesh.Indices.Count; index += 3)
        {
            CountEdge(edges, mesh.Indices[index], mesh.Indices[index + 1]);
            CountEdge(edges, mesh.Indices[index + 1], mesh.Indices[index + 2]);
            CountEdge(edges, mesh.Indices[index + 2], mesh.Indices[index]);
        }
        return edges.All(pair => pair.Value == 2);
    }

    private static GeneratedMesh ConformMesh(GeneratedMesh mesh, int expressId)
    {
        var points = mesh.Points.ToList();
        var indices = mesh.Indices.ToList();
        var extent = CoordinateExtent(points);
        var tolerance = Math.Max(1e-9, extent * 1e-10);
        var maximumSplits = Math.Min(100_000, Math.Max(1024, points.Count * 16));
        for (var split = 0; split < maximumSplits; split++)
        {
            var counts = new Dictionary<Edge, int>();
            for (var index = 0; index < indices.Count; index += 3)
            {
                CountEdge(counts, indices[index], indices[index + 1]);
                CountEdge(counts, indices[index + 1], indices[index + 2]);
                CountEdge(counts, indices[index + 2], indices[index]);
            }
            var openEdges = counts.Where(pair => pair.Value == 1).Select(pair => pair.Key).ToArray();
            if (openEdges.Length == 0) return new GeneratedMesh(points, indices, indices.Count / 3, mesh.EarcutFaces);
            var openVertices = openEdges.SelectMany(edge => new[] { edge.A, edge.B }).Distinct().ToArray();
            var inserted = false;
            foreach (var openEdge in openEdges)
            {
                var a = points[openEdge.A];
                var b = points[openEdge.B];
                foreach (var pointIndex in openVertices)
                {
                    if (pointIndex == openEdge.A || pointIndex == openEdge.B ||
                        !PointStrictlyOnSegment(points[pointIndex], a, b, tolerance)) continue;
                    for (var triangle = 0; triangle < indices.Count && !inserted; triangle += 3)
                    {
                        for (var edge = 0; edge < 3; edge++)
                        {
                            var aPosition = triangle + edge;
                            var bPosition = triangle + (edge + 1) % 3;
                            var cPosition = triangle + (edge + 2) % 3;
                            if (new Edge(indices[aPosition], indices[bPosition]).Normalized() != openEdge) continue;
                            var aIndex = indices[aPosition];
                            var bIndex = indices[bPosition];
                            var cIndex = indices[cPosition];
                            indices[bPosition] = pointIndex;
                            indices.Add(pointIndex);
                            indices.Add(bIndex);
                            indices.Add(cIndex);
                            inserted = true;
                            break;
                        }
                    }
                    if (inserted) break;
                }
                if (inserted) break;
            }
            if (!inserted) return new GeneratedMesh(points, indices, indices.Count / 3, mesh.EarcutFaces);
        }
        throw new InvalidDataException($"Generated solid #{expressId} exceeded the bounded conforming-mesh repair limit.");
    }

    private static void Guard(int depth, ref int nodes, Stopwatch stopwatch, int expressId)
    {
        if (depth > MaximumDepth) throw new InvalidDataException($"Boolean DAG at #{expressId} exceeds depth {MaximumDepth}.");
        if (++nodes > MaximumBooleanNodes) throw new InvalidDataException($"Boolean DAG at #{expressId} exceeds {MaximumBooleanNodes} operands.");
        if (stopwatch.Elapsed > MaximumBuildTime) throw new InvalidDataException($"Boolean DAG at #{expressId} exceeded the {MaximumBuildTime.TotalSeconds:N0}-second work limit.");
    }

    private static void GuardMeshSize(GeneratedMesh mesh, int expressId)
    {
        if (mesh.Points.Count > MaximumVertices || mesh.Indices.Count / 3 > MaximumTriangles)
            throw new InvalidDataException($"Generated solid #{expressId} exceeds the bounded mesh work limit.");
    }

    private static int RequireReference(ReadOnlySpan<byte> record, int argumentIndex, string label)
    {
        if (!StepParsing.TryGetTopLevelArgument(record, argumentIndex, out var argument) ||
            !StepParsing.TryReadSingleReference(argument, out var id))
            throw new InvalidDataException($"{label} is missing or invalid.");
        return id;
    }

    private static ReadOnlySpan<byte> RequireRecord(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries, TypeRegistry registry, int id, EntityKind expected)
    {
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, id, out var record, out var typeId) || registry[typeId].Kind != expected)
            throw new InvalidDataException($"Expected {expected} at #{id}.");
        return record;
    }

    private static Frame3 ResolveFrame3(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries, TypeRegistry registry, int placementId)
    {
        var placement = RequireRecord(source, entries, registry, placementId, EntityKind.Axis2Placement3D);
        var origin = ResolvePoint3(source, entries, registry, RequireReference(placement, 0, $"IfcAxis2Placement3D #{placementId} Location"));
        var z = ResolveOptionalDirection(source, entries, registry, placement, 1, new P3(0, 0, 1));
        var reference = ResolveOptionalDirection(source, entries, registry, placement, 2, new P3(1, 0, 0));
        var x = reference.Subtract(z.Scale(reference.Dot(z))).Normalize($"IfcAxis2Placement3D #{placementId} RefDirection");
        var y = z.Cross(x).Normalize($"IfcAxis2Placement3D #{placementId} derived Y axis");
        return new Frame3(origin, x, y, z);
    }

    private static P3 ResolveOptionalDirection(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries, TypeRegistry registry, ReadOnlySpan<byte> owner, int argumentIndex, P3 fallback)
    {
        if (!StepParsing.TryGetTopLevelArgument(owner, argumentIndex, out var argument) || StepParsing.IsOmitted(argument)) return fallback;
        if (!StepParsing.TryReadSingleReference(argument, out var id)) throw new InvalidDataException("Axis direction reference is invalid.");
        var direction = RequireRecord(source, entries, registry, id, EntityKind.Direction);
        if (!StepParsing.TryGetTopLevelArgument(direction, 0, out var ratios)) throw new InvalidDataException($"IfcDirection #{id} is malformed.");
        Span<double> values = stackalloc double[3];
        if (!StepParsing.TryParseDoubleList(ratios, values, out var count) || count is < 2 or > 3)
            throw new InvalidDataException($"IfcDirection #{id} has invalid ratios.");
        return new P3(values[0], values[1], count == 3 ? values[2] : 0).Normalize($"IfcDirection #{id}");
    }

    private static P3 ResolvePoint3(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries, TypeRegistry registry, int id)
    {
        var point = RequireRecord(source, entries, registry, id, EntityKind.CartesianPoint);
        if (!StepParsing.TryGetTopLevelArgument(point, 0, out var coordinates)) throw new InvalidDataException($"IfcCartesianPoint #{id} is malformed.");
        Span<double> values = stackalloc double[3];
        if (!StepParsing.TryParseDoubleList(coordinates, values, out var count) || count is < 2 or > 3)
            throw new InvalidDataException($"IfcCartesianPoint #{id} has invalid coordinates.");
        return new P3(values[0], values[1], count == 3 ? values[2] : 0);
    }

    private static double SignedDistance(GeneratedPoint point, HalfSpace halfSpace) => P3.From(point).Subtract(halfSpace.Origin).Dot(halfSpace.Normal);
    private static GeneratedPoint Lerp(GeneratedPoint left, GeneratedPoint right, double t) => new(left.X + (right.X - left.X) * t, left.Y + (right.Y - left.Y) * t, left.Z + (right.Z - left.Z) * t);
    private static P2 Project(GeneratedPoint point, P3 origin, P3 u, P3 v) { var delta = P3.From(point).Subtract(origin); return new P2(delta.Dot(u), delta.Dot(v)); }
    private static double CoordinateExtent(IReadOnlyList<GeneratedPoint> points) => points.Select(point => Math.Max(Math.Abs(point.X), Math.Max(Math.Abs(point.Y), Math.Abs(point.Z)))).DefaultIfEmpty(1).Max();
    private static double DistanceSquared(P2 left, P2 right) { var dx = left.X - right.X; var dy = left.Y - right.Y; return dx * dx + dy * dy; }
    private static double DistanceSquared(GeneratedPoint left, GeneratedPoint right) { var dx = left.X - right.X; var dy = left.Y - right.Y; var dz = left.Z - right.Z; return dx * dx + dy * dy + dz * dz; }
    private static double Cross(P2 a, P2 b, P2 c) => (b.X - a.X) * (c.Y - b.Y) - (b.Y - a.Y) * (c.X - b.X);
    private static double SignedArea(IReadOnlyList<P2> polygon) { var area = 0d; for (var i = 0; i < polygon.Count; i++) { var n = polygon[(i + 1) % polygon.Count]; area += polygon[i].X * n.Y - n.X * polygon[i].Y; } return area * 0.5; }
    private static bool PointInPolygon(P2 point, IReadOnlyList<P2> polygon) { var inside = false; for (var i = 0; i < polygon.Count; i++) { var j = (i + polygon.Count - 1) % polygon.Count; if ((polygon[i].Y > point.Y) != (polygon[j].Y > point.Y) && point.X < (polygon[j].X - polygon[i].X) * (point.Y - polygon[i].Y) / (polygon[j].Y - polygon[i].Y) + polygon[i].X) inside = !inside; } return inside; }
    private static void AddAdjacent(Dictionary<int, List<int>> adjacency, int from, int to) { if (!adjacency.TryGetValue(from, out var values)) { values = []; adjacency.Add(from, values); } values.Add(to); }
    private static void CountEdge(Dictionary<Edge, int> edges, int a, int b) { var edge = new Edge(a, b).Normalized(); edges[edge] = edges.GetValueOrDefault(edge) + 1; }

    private static void AddTriangle(IReadOnlyList<GeneratedPoint> points, List<int> indices, int a, int b, int c, double tolerance)
    {
        if (a == b || b == c || c == a) return;
        var normal = P3.From(points[b]).Subtract(P3.From(points[a])).Cross(P3.From(points[c]).Subtract(P3.From(points[a])));
        if (normal.LengthSquared <= tolerance * tolerance * tolerance * tolerance) return;
        indices.Add(a); indices.Add(b); indices.Add(c);
    }

    private static void AddOrientedTriangle(IReadOnlyList<GeneratedPoint> points, List<int> indices, int a, int b, int c, P3 expected, double tolerance)
    {
        if (a == b || b == c || c == a) return;
        var normal = P3.From(points[b]).Subtract(P3.From(points[a])).Cross(P3.From(points[c]).Subtract(P3.From(points[a])));
        if (normal.LengthSquared <= tolerance * tolerance * tolerance * tolerance) return;
        if (normal.Dot(expected) < 0) (b, c) = (c, b);
        indices.Add(a); indices.Add(b); indices.Add(c);
    }

    private readonly record struct Vertex(GeneratedPoint Point, double Distance);
    private readonly record struct HalfSpace(P3 Origin, P3 Normal, bool KeepPositive, bool IsBounded, GeneratedMesh? Cutter);
    private readonly record struct Edge(int A, int B) { public Edge Normalized() => A <= B ? this : new Edge(B, A); }
    private readonly record struct P2(double X, double Y);
    private readonly record struct P3(double X, double Y, double Z)
    {
        public double LengthSquared => X * X + Y * Y + Z * Z;
        public P3 Subtract(P3 other) => new(X - other.X, Y - other.Y, Z - other.Z);
        public P3 Add(P3 other) => new(X + other.X, Y + other.Y, Z + other.Z);
        public P3 Scale(double value) => new(X * value, Y * value, Z * value);
        public double Dot(P3 other) => X * other.X + Y * other.Y + Z * other.Z;
        public P3 Cross(P3 other) => new(Y * other.Z - Z * other.Y, Z * other.X - X * other.Z, X * other.Y - Y * other.X);
        public P3 Normalize(string label) { var length = Math.Sqrt(LengthSquared); if (!double.IsFinite(length) || length <= 1e-15) throw new InvalidDataException($"{label} has zero or invalid magnitude."); return Scale(1 / length); }
        public static P3 From(GeneratedPoint point) => new(point.X, point.Y, point.Z);
        public GeneratedPoint ToPublic() => new(X, Y, Z);
    }
    private readonly record struct Frame3(P3 Origin, P3 X, P3 Y, P3 Z)
    {
        public P3 Inverse(P3 point) { var delta = point.Subtract(Origin); return new P3(delta.Dot(X), delta.Dot(Y), delta.Dot(Z)); }
        public P3 Transform(P3 point) => Origin.Add(TransformVector(point));
        public P3 TransformVector(P3 vector) => new(
            X.X * vector.X + Y.X * vector.Y + Z.X * vector.Z,
            X.Y * vector.X + Y.Y * vector.Y + Z.Y * vector.Z,
            X.Z * vector.X + Y.Z * vector.Y + Z.Z * vector.Z);
    }

    private sealed class PointWelder(List<GeneratedPoint> points, double tolerance)
    {
        private readonly Dictionary<Cell, List<int>> _cells = new();
        public int Add(GeneratedPoint point)
        {
            var cell = Cell.From(point, tolerance);
            for (var x = -1; x <= 1; x++) for (var y = -1; y <= 1; y++) for (var z = -1; z <= 1; z++)
            {
                var neighbor = new Cell(cell.X + x, cell.Y + y, cell.Z + z);
                if (!_cells.TryGetValue(neighbor, out var candidates)) continue;
                foreach (var candidate in candidates)
                {
                    var current = points[candidate];
                    var dx = current.X - point.X; var dy = current.Y - point.Y; var dz = current.Z - point.Z;
                    if (dx * dx + dy * dy + dz * dz <= tolerance * tolerance) return candidate;
                }
            }
            var index = points.Count;
            points.Add(point);
            if (!_cells.TryGetValue(cell, out var bucket)) { bucket = []; _cells.Add(cell, bucket); }
            bucket.Add(index);
            return index;
        }
    }

    private readonly record struct Cell(long X, long Y, long Z)
    {
        public static Cell From(GeneratedPoint point, double tolerance) => new(
            checked((long)Math.Floor(point.X / tolerance)),
            checked((long)Math.Floor(point.Y / tolerance)),
            checked((long)Math.Floor(point.Z / tolerance)));
    }
}
