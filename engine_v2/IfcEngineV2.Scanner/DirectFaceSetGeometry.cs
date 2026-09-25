namespace IfcEngineV2.Scanner;

internal static class DirectFaceSetGeometry
{
    private const int MaximumCoordinateCount = 10_000_000;
    private const int MaximumFaceVertices = 1_000_000;

    public static bool TryBuild(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int definitionId,
        double lengthUnitScaleToMetres,
        out GeneratedMesh mesh,
        out string? error)
    {
        try
        {
            mesh = Build(source, entries, registry, definitionId, lengthUnitScaleToMetres);
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
        int definitionId,
        double lengthUnitScaleToMetres = 1)
    {
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, definitionId, out var definition, out var typeId))
            throw new InvalidDataException($"Direct face set #{definitionId} is missing.");
        return registry[typeId].Kind switch
        {
            EntityKind.TriangulatedFaceSet => BuildTriangulated(source, entries, registry, definition, definitionId),
            EntityKind.PolygonalFaceSet => BuildPolygonal(source, entries, registry, definition, definitionId,
                lengthUnitScaleToMetres),
            _ => throw new InvalidDataException($"{registry[typeId].Name} #{definitionId} is not a direct face set."),
        };
    }

    private static GeneratedMesh BuildTriangulated(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> definition,
        int definitionId)
    {
        var coordinates = ResolveCoordinates(source, entries, registry, definition, definitionId);
        if (StepParsing.TryGetTopLevelArgument(definition, 1, out var normalsArgument) && !StepParsing.IsOmitted(normalsArgument))
            throw new InvalidDataException($"IfcTriangulatedFaceSet #{definitionId} supplies vertex normals, which are not yet supported by the per-face normal artifact.");
        var closed = ParseClosed(definition, 2, definitionId, "IfcTriangulatedFaceSet");
        if (!StepParsing.TryGetTopLevelArgument(definition, 3, out var indexArgument))
            throw new InvalidDataException($"IfcTriangulatedFaceSet #{definitionId} has no CoordIndex.");
        var faces = new List<int[]>();
        if (!StepParsing.TryParsePositiveIntTuples(indexArgument, faces))
            throw new InvalidDataException($"IfcTriangulatedFaceSet #{definitionId} has an invalid CoordIndex.");
        var pointMap = ResolvePointMap(definition, 4, coordinates.Count, definitionId, "IfcTriangulatedFaceSet");
        var builder = new CompactMeshBuilder(coordinates);
        foreach (var face in faces)
        {
            if (face.Length != 3)
                throw new InvalidDataException($"IfcTriangulatedFaceSet #{definitionId} contains a non-triangle coordinate index.");
            var a = ResolveCoordinateOrdinal(face[0], pointMap, coordinates.Count, definitionId);
            var b = ResolveCoordinateOrdinal(face[1], pointMap, coordinates.Count, definitionId);
            var c = ResolveCoordinateOrdinal(face[2], pointMap, coordinates.Count, definitionId);
            builder.AddTriangle(a, b, c, definitionId);
        }
        return builder.Complete(faces.Count, 0, definitionId, closed);
    }

    private static GeneratedMesh BuildPolygonal(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> definition,
        int definitionId,
        double lengthUnitScaleToMetres)
    {
        var coordinates = ResolveCoordinates(source, entries, registry, definition, definitionId);
        var closed = ParseClosed(definition, 1, definitionId, "IfcPolygonalFaceSet");
        if (!StepParsing.TryGetTopLevelArgument(definition, 2, out var facesArgument))
            throw new InvalidDataException($"IfcPolygonalFaceSet #{definitionId} has no Faces argument.");
        var faceIds = new List<int>();
        StepParsing.CollectReferences(facesArgument, faceIds);
        if (faceIds.Count == 0) throw new InvalidDataException($"IfcPolygonalFaceSet #{definitionId} has no face references.");
        var pointMap = ResolvePointMap(definition, 3, coordinates.Count, definitionId, "IfcPolygonalFaceSet");
        var builder = new CompactMeshBuilder(coordinates);
        var indexScratch = new List<int>();
        var nestedScratch = new List<int[]>();
        var rings = new List<int[]>();
        var flattened = new List<int>();
        var projected = new List<double>();
        var holeStarts = new List<int>();
        var triangles = new List<int>();

        foreach (var faceId in faceIds)
        {
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, faceId, out var face, out var faceTypeId))
                throw new InvalidDataException($"IfcPolygonalFaceSet #{definitionId} references missing face #{faceId}.");
            var faceKind = registry[faceTypeId].Kind;
            if (faceKind is not (EntityKind.IndexedPolygonalFace or EntityKind.IndexedPolygonalFaceWithVoids))
                throw new InvalidDataException($"IfcPolygonalFaceSet #{definitionId} references unsupported {registry[faceTypeId].Name} #{faceId}.");
            if (!StepParsing.TryGetTopLevelArgument(face, 0, out var outerArgument) ||
                !StepParsing.TryParsePositiveIntList(outerArgument, indexScratch))
                throw new InvalidDataException($"Indexed polygonal face #{faceId} has an invalid CoordIndex.");

            rings.Clear();
            rings.Add(MapAndCleanRing(indexScratch, pointMap, coordinates, definitionId, faceId));
            if (faceKind == EntityKind.IndexedPolygonalFaceWithVoids)
            {
                if (!StepParsing.TryGetTopLevelArgument(face, 1, out var voidsArgument) ||
                    !StepParsing.TryParsePositiveIntTuples(voidsArgument, nestedScratch))
                    throw new InvalidDataException($"IfcIndexedPolygonalFaceWithVoids #{faceId} has invalid InnerCoordIndices.");
                foreach (var inner in nestedScratch)
                    rings.Add(MapAndCleanRing(inner, pointMap, coordinates, definitionId, faceId));
            }
            TriangulatePolygonFace(coordinates, rings, flattened, projected, holeStarts, triangles, builder,
                definitionId, faceId, lengthUnitScaleToMetres);
        }
        return builder.Complete(faceIds.Count, faceIds.Count, definitionId, closed);
    }

    private static bool ParseClosed(ReadOnlySpan<byte> definition, int argumentIndex, int definitionId, string typeName)
    {
        if (!StepParsing.TryGetTopLevelArgument(definition, argumentIndex, out var argument) || StepParsing.IsOmitted(argument)) return false;
        argument = StepParsing.Trim(argument);
        if (argument.SequenceEqual(".T."u8)) return true;
        if (argument.SequenceEqual(".F."u8)) return false;
        throw new InvalidDataException($"{typeName} #{definitionId} has an invalid Closed value.");
    }

    private static IReadOnlyList<Point3> ResolveCoordinates(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> definition,
        int definitionId)
    {
        if (!StepParsing.TryGetTopLevelArgument(definition, 0, out var coordinateReference) ||
            !StepParsing.TryReadSingleReference(coordinateReference, out var coordinateListId) ||
            !GraphCoverageAnalyzer.TryGetRecord(source, entries, coordinateListId, out var coordinateList, out var coordinateTypeId) ||
            registry[coordinateTypeId].Kind != EntityKind.CartesianPointList3D)
            throw new InvalidDataException($"Direct face set #{definitionId} has no valid IfcCartesianPointList3D.");
        if (!StepParsing.TryGetTopLevelArgument(coordinateList, 0, out var coordinateArgument))
            throw new InvalidDataException($"IfcCartesianPointList3D #{coordinateListId} has no CoordList.");
        var tuples = new List<double[]>();
        if (!StepParsing.TryParseDoubleTuples(coordinateArgument, 3, tuples) || tuples.Count == 0 || tuples.Count > MaximumCoordinateCount)
            throw new InvalidDataException($"IfcCartesianPointList3D #{coordinateListId} has an invalid or excessive CoordList.");
        var points = new Point3[tuples.Count];
        for (var index = 0; index < tuples.Count; index++)
        {
            var tuple = tuples[index];
            var point = new Point3(tuple[0], tuple[1], tuple[2]);
            if (!point.IsFinite) throw new InvalidDataException($"IfcCartesianPointList3D #{coordinateListId} contains a non-finite point.");
            points[index] = point;
        }
        return points;
    }

    private static int[]? ResolvePointMap(
        ReadOnlySpan<byte> definition,
        int argumentIndex,
        int coordinateCount,
        int definitionId,
        string typeName)
    {
        if (!StepParsing.TryGetTopLevelArgument(definition, argumentIndex, out var argument) || StepParsing.IsOmitted(argument)) return null;
        var values = new List<int>();
        if (!StepParsing.TryParsePositiveIntList(argument, values))
            throw new InvalidDataException($"{typeName} #{definitionId} has an invalid PnIndex.");
        foreach (var value in values)
        {
            if (value > coordinateCount)
                throw new InvalidDataException($"{typeName} #{definitionId} PnIndex references coordinate {value}, but only {coordinateCount} exist.");
        }
        return values.ToArray();
    }

    private static int ResolveCoordinateOrdinal(int oneBased, int[]? pointMap, int coordinateCount, int definitionId)
    {
        if (pointMap is not null)
        {
            if (oneBased > pointMap.Length)
                throw new InvalidDataException($"Direct face set #{definitionId} references PnIndex entry {oneBased}, but only {pointMap.Length} exist.");
            oneBased = pointMap[oneBased - 1];
        }
        if (oneBased <= 0 || oneBased > coordinateCount)
            throw new InvalidDataException($"Direct face set #{definitionId} references coordinate {oneBased}, but only {coordinateCount} exist.");
        return oneBased - 1;
    }

    private static int[] MapAndCleanRing(
        IReadOnlyList<int> source,
        int[]? pointMap,
        IReadOnlyList<Point3> coordinates,
        int definitionId,
        int faceId)
    {
        if (source.Count > MaximumFaceVertices)
            throw new InvalidDataException($"Indexed polygonal face #{faceId} exceeds the {MaximumFaceVertices:N0}-vertex safety limit.");
        var result = new List<int>(source.Count);
        foreach (var oneBased in source)
        {
            var ordinal = ResolveCoordinateOrdinal(oneBased, pointMap, coordinates.Count, definitionId);
            if (result.Count == 0 || !coordinates[result[^1]].SameAs(coordinates[ordinal])) result.Add(ordinal);
        }
        if (result.Count > 1 && coordinates[result[0]].SameAs(coordinates[result[^1]])) result.RemoveAt(result.Count - 1);
        if (result.Count < 3) throw new InvalidDataException($"Indexed polygonal face #{faceId} ring collapses below three vertices.");
        return result.ToArray();
    }

    private static void TriangulatePolygonFace(
        IReadOnlyList<Point3> coordinates,
        IReadOnlyList<int[]> rings,
        List<int> flattened,
        List<double> projected,
        List<int> holeStarts,
        List<int> triangles,
        CompactMeshBuilder builder,
        int definitionId,
        int faceId,
        double lengthUnitScaleToMetres)
    {
        flattened.Clear();
        projected.Clear();
        holeStarts.Clear();
        var expected = NewellNormal(coordinates, rings[0]);
        if (expected.LengthSquared <= 1e-24)
            throw new InvalidDataException($"Indexed polygonal face #{faceId} has a degenerate outer ring.");
        ValidatePlanarity(coordinates, rings, expected, faceId, lengthUnitScaleToMetres);
        var axis = DominantAxis(expected);
        foreach (var ring in rings)
        {
            if (flattened.Count > 0) holeStarts.Add(flattened.Count);
            foreach (var ordinal in ring)
            {
                flattened.Add(ordinal);
                var point = coordinates[ordinal];
                if (axis == 0) { projected.Add(point.Y); projected.Add(point.Z); }
                else if (axis == 1) { projected.Add(point.X); projected.Add(point.Z); }
                else { projected.Add(point.X); projected.Add(point.Y); }
            }
        }
        ValidateProjectedRings(projected, holeStarts, faceId);
        EarcutTriangulator.Triangulate(projected, holeStarts, triangles);
        if (triangles.Count == 0 || triangles.Count % 3 != 0 ||
            EarcutTriangulator.Deviation(projected, holeStarts, triangles) > 1e-8)
            throw new InvalidDataException($"Indexed polygonal face #{faceId} could not be triangulated safely.");
        for (var index = 0; index < triangles.Count; index += 3)
        {
            var a = flattened[triangles[index]];
            var b = flattened[triangles[index + 1]];
            var c = flattened[triangles[index + 2]];
            if (TriangleNormal(coordinates[a], coordinates[b], coordinates[c]).Dot(expected) < 0) (b, c) = (c, b);
            builder.AddTriangle(a, b, c, definitionId);
        }
    }

    private static void ValidatePlanarity(
        IReadOnlyList<Point3> coordinates,
        IReadOnlyList<int[]> rings,
        Point3 normal,
        int faceId,
        double lengthUnitScaleToMetres)
    {
        var origin = coordinates[rings[0][0]];
        var length = Math.Sqrt(normal.LengthSquared);
        var extent = 1d;
        var absolute = 1d;
        foreach (var ring in rings)
        {
            foreach (var ordinal in ring)
            {
                var point = coordinates[ordinal];
                extent = Math.Max(extent, Math.Sqrt(point.Subtract(origin).LengthSquared));
                absolute = Math.Max(absolute, Math.Max(Math.Abs(point.X), Math.Max(Math.Abs(point.Y), Math.Abs(point.Z))));
            }
        }
        // Exporters commonly round the coordinates of an otherwise planar
        // polygonal face independently. Keep the permitted warp small relative
        // to that face (including its void rings), rather than using one fixed
        // world-space threshold that changes with the model's coordinates.
        // Triangulation retains the source's 3D vertices. Admit at most 0.1 mm
        // of exporter warp, and at most 1% of a small face's extent.
        var physicalTolerance = 1e-4 / lengthUnitScaleToMetres;
        var tolerance = Math.Max(extent * 1e-7,
            Math.Max(Math.Min(physicalTolerance, extent * 0.01), absolute * 1e-13));
        foreach (var ring in rings)
        {
            foreach (var ordinal in ring)
            {
                var distance = Math.Abs(coordinates[ordinal].Subtract(origin).Dot(normal)) / length;
                if (distance > tolerance)
                    throw new InvalidDataException($"Indexed polygonal face #{faceId} deviates {distance:G6} from its plane (tolerance {tolerance:G6}).");
            }
        }
    }

    private static void ValidateProjectedRings(IReadOnlyList<double> points, IReadOnlyList<int> holeStarts, int faceId)
    {
        var vertexCount = points.Count / 2;
        var minimumX = double.PositiveInfinity;
        var minimumY = double.PositiveInfinity;
        var maximumX = double.NegativeInfinity;
        var maximumY = double.NegativeInfinity;
        var absolute = 1d;
        for (var vertex = 0; vertex < vertexCount; vertex++)
        {
            var x = points[vertex * 2];
            var y = points[vertex * 2 + 1];
            minimumX = Math.Min(minimumX, x); maximumX = Math.Max(maximumX, x);
            minimumY = Math.Min(minimumY, y); maximumY = Math.Max(maximumY, y);
            absolute = Math.Max(absolute, Math.Max(Math.Abs(x), Math.Abs(y)));
        }
        var extent = Math.Max(1d, Math.Max(maximumX - minimumX, maximumY - minimumY));
        var tolerance = Math.Max(extent * 1e-10, absolute * 1e-14);
        var ringCount = holeStarts.Count + 1;
        for (var ring = 0; ring < ringCount; ring++)
        {
            var start = ring == 0 ? 0 : holeStarts[ring - 1];
            var end = ring < holeStarts.Count ? holeStarts[ring] : vertexCount;
            if (Math.Abs(SignedArea(points, start, end)) <= tolerance * tolerance)
                throw new InvalidDataException($"Indexed polygonal face #{faceId} contains a degenerate projected ring.");
        }
        for (var hole = 0; hole < holeStarts.Count; hole++)
        {
            var start = holeStarts[hole];
            var end = hole + 1 < holeStarts.Count ? holeStarts[hole + 1] : vertexCount;
            var x = points[start * 2];
            var y = points[start * 2 + 1];
            var outerEnd = holeStarts[0];
            if (!PointInPolygon(points, x, y, 0, outerEnd) || RingsIntersect(points, start, end, 0, outerEnd, tolerance))
                throw new InvalidDataException($"Indexed polygonal face #{faceId} contains a void outside or touching its outer ring.");
            for (var prior = 0; prior < hole; prior++)
            {
                var priorStart = holeStarts[prior];
                var priorEnd = prior + 1 < holeStarts.Count ? holeStarts[prior + 1] : vertexCount;
                if (PointInPolygon(points, x, y, priorStart, priorEnd) ||
                    PointInPolygon(points, points[priorStart * 2], points[priorStart * 2 + 1], start, end) ||
                    RingsIntersect(points, start, end, priorStart, priorEnd, tolerance))
                {
                    throw new InvalidDataException($"Indexed polygonal face #{faceId} contains overlapping void rings.");
                }
            }
        }
    }

    private static double SignedArea(IReadOnlyList<double> points, int start, int end)
    {
        var area = 0d;
        for (int current = start, previous = end - 1; current < end; previous = current++)
            area += points[previous * 2] * points[current * 2 + 1] - points[current * 2] * points[previous * 2 + 1];
        return area * 0.5;
    }

    private static bool PointInPolygon(IReadOnlyList<double> points, double x, double y, int start, int end)
    {
        var inside = false;
        for (int current = start, previous = end - 1; current < end; previous = current++)
        {
            var ax = points[current * 2];
            var ay = points[current * 2 + 1];
            var bx = points[previous * 2];
            var by = points[previous * 2 + 1];
            if ((ay > y) == (by > y)) continue;
            if (x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
        }
        return inside;
    }

    private static bool RingsIntersect(
        IReadOnlyList<double> points,
        int firstStart,
        int firstEnd,
        int secondStart,
        int secondEnd,
        double tolerance)
    {
        for (var first = firstStart; first < firstEnd; first++)
        {
            var firstNext = first + 1 < firstEnd ? first + 1 : firstStart;
            for (var second = secondStart; second < secondEnd; second++)
            {
                var secondNext = second + 1 < secondEnd ? second + 1 : secondStart;
                if (SegmentsIntersect(points, first, firstNext, second, secondNext, tolerance)) return true;
            }
        }
        return false;
    }

    private static bool SegmentsIntersect(
        IReadOnlyList<double> points,
        int a,
        int b,
        int c,
        int d,
        double tolerance)
    {
        static double Cross(double ax, double ay, double bx, double by, double cx, double cy) =>
            (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        var ax = points[a * 2]; var ay = points[a * 2 + 1];
        var bx = points[b * 2]; var by = points[b * 2 + 1];
        var cx = points[c * 2]; var cy = points[c * 2 + 1];
        var dx = points[d * 2]; var dy = points[d * 2 + 1];
        var abC = Cross(ax, ay, bx, by, cx, cy);
        var abD = Cross(ax, ay, bx, by, dx, dy);
        var cdA = Cross(cx, cy, dx, dy, ax, ay);
        var cdB = Cross(cx, cy, dx, dy, bx, by);
        if (((abC > tolerance && abD < -tolerance) || (abC < -tolerance && abD > tolerance)) &&
            ((cdA > tolerance && cdB < -tolerance) || (cdA < -tolerance && cdB > tolerance))) return true;
        static bool OnSegment(double px, double py, double qx, double qy, double rx, double ry, double tol) =>
            qx >= Math.Min(px, rx) - tol && qx <= Math.Max(px, rx) + tol &&
            qy >= Math.Min(py, ry) - tol && qy <= Math.Max(py, ry) + tol;
        return Math.Abs(abC) <= tolerance && OnSegment(ax, ay, cx, cy, bx, by, tolerance) ||
               Math.Abs(abD) <= tolerance && OnSegment(ax, ay, dx, dy, bx, by, tolerance) ||
               Math.Abs(cdA) <= tolerance && OnSegment(cx, cy, ax, ay, dx, dy, tolerance) ||
               Math.Abs(cdB) <= tolerance && OnSegment(cx, cy, bx, by, dx, dy, tolerance);
    }

    private static Point3 NewellNormal(IReadOnlyList<Point3> points, IReadOnlyList<int> ring)
    {
        var normal = new Point3(0, 0, 0);
        for (var index = 0; index < ring.Count; index++)
        {
            var current = points[ring[index]];
            var next = points[ring[(index + 1) % ring.Count]];
            normal = normal.Add(new Point3(
                (current.Y - next.Y) * (current.Z + next.Z),
                (current.Z - next.Z) * (current.X + next.X),
                (current.X - next.X) * (current.Y + next.Y)));
        }
        return normal;
    }

    private static int DominantAxis(Point3 normal)
    {
        var x = Math.Abs(normal.X);
        var y = Math.Abs(normal.Y);
        var z = Math.Abs(normal.Z);
        return x >= y && x >= z ? 0 : y >= z ? 1 : 2;
    }

    private static Point3 TriangleNormal(Point3 a, Point3 b, Point3 c) => b.Subtract(a).Cross(c.Subtract(a));

    private sealed class CompactMeshBuilder(IReadOnlyList<Point3> source)
    {
        private readonly Dictionary<int, int> _compactBySource = new();
        private readonly Dictionary<long, EdgeUse> _edges = new();
        private readonly List<GeneratedPoint> _points = [];
        private readonly List<int> _indices = [];

        public void AddTriangle(int a, int b, int c, int definitionId)
        {
            if (a == b || b == c || a == c || TriangleNormal(source[a], source[b], source[c]).LengthSquared <= 1e-24)
                throw new InvalidDataException($"Direct face set #{definitionId} contains a degenerate triangle.");
            _indices.Add(AddPoint(a));
            _indices.Add(AddPoint(b));
            _indices.Add(AddPoint(c));
            AddEdge(a, b);
            AddEdge(b, c);
            AddEdge(c, a);
        }

        public GeneratedMesh Complete(int faceCount, int earcutFaces, int definitionId, bool closed)
        {
            if (faceCount <= 0 || _indices.Count == 0)
                throw new InvalidDataException($"Direct face set #{definitionId} produced no geometry.");
            if (closed && _edges.Values.Any(edge => edge.Count != 2 || edge.Balance != 0))
                throw new InvalidDataException($"Direct face set #{definitionId} declares Closed=.T. but is not an oriented two-manifold mesh.");
            return new GeneratedMesh(_points, _indices, faceCount, earcutFaces);
        }

        private void AddEdge(int start, int end)
        {
            var minimum = Math.Min(start, end);
            var maximum = Math.Max(start, end);
            var key = ((long)minimum << 32) | (uint)maximum;
            var current = _edges.GetValueOrDefault(key);
            _edges[key] = new EdgeUse(current.Count + 1, current.Balance + (start == minimum ? 1 : -1));
        }

        private int AddPoint(int sourceOrdinal)
        {
            if (_compactBySource.TryGetValue(sourceOrdinal, out var existing)) return existing;
            var point = source[sourceOrdinal];
            var ordinal = _points.Count;
            _points.Add(new GeneratedPoint(point.X, point.Y, point.Z));
            _compactBySource.Add(sourceOrdinal, ordinal);
            return ordinal;
        }

        private readonly record struct EdgeUse(int Count, int Balance);
    }

    private readonly record struct Point3(double X, double Y, double Z)
    {
        public bool IsFinite => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Z);
        public double LengthSquared => X * X + Y * Y + Z * Z;
        public bool SameAs(Point3 other) => X == other.X && Y == other.Y && Z == other.Z;
        public Point3 Add(Point3 other) => new(X + other.X, Y + other.Y, Z + other.Z);
        public Point3 Subtract(Point3 other) => new(X - other.X, Y - other.Y, Z - other.Z);
        public double Dot(Point3 other) => X * other.X + Y * other.Y + Z * other.Z;
        public Point3 Cross(Point3 other) => new(Y * other.Z - Z * other.Y, Z * other.X - X * other.Z, X * other.Y - Y * other.X);
    }
}
