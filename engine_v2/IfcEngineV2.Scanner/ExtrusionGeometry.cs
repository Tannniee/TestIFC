namespace IfcEngineV2.Scanner;

internal readonly record struct GeneratedPoint(double X, double Y, double Z)
{
    public bool IsFinite => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Z);
}

internal readonly record struct GeneratedPoint2(double X, double Y);

internal sealed record GeneratedMesh(
    IReadOnlyList<GeneratedPoint> Points,
    IReadOnlyList<int> Indices,
    int FaceCount,
    int EarcutFaces);

internal static class ExtrusionGeometry
{
    private const int CircleSegments = 96;

    public static bool TryBuild(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int extrusionId,
        double angleScaleToRadians,
        out GeneratedMesh mesh,
        out string? error)
    {
        try
        {
            mesh = Build(source, entries, registry, extrusionId, angleScaleToRadians);
            error = null;
            return true;
        }
        catch (InvalidDataException exception)
        {
            mesh = new GeneratedMesh([], [], 0, 0);
            error = $"Extrusion #{extrusionId}: {exception.Message}";
            return false;
        }
    }

    public static GeneratedMesh Build(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int extrusionId,
        double angleScaleToRadians)
    {
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, extrusionId, out var extrusion, out var typeId))
            throw new InvalidDataException($"Extrusion #{extrusionId} is missing.");
        if (registry[typeId].Kind == EntityKind.ExtrudedAreaSolidTapered)
            return BuildTapered(source, entries, registry, extrusionId, extrusion, angleScaleToRadians);
        if (registry[typeId].Kind != EntityKind.ExtrudedAreaSolid)
            throw new InvalidDataException($"Expected an extrusion at #{extrusionId}.");
        var profileId = RequireReference(extrusion, 0, $"IfcExtrudedAreaSolid #{extrusionId} SweptArea");
        var solidFrame = ResolveFrame3(source, entries, registry, extrusion, 1, $"IfcExtrudedAreaSolid #{extrusionId} Position");
        var directionId = RequireReference(extrusion, 2, $"IfcExtrudedAreaSolid #{extrusionId} ExtrudedDirection");
        var direction = ResolveDirection3(source, entries, registry, directionId);
        var depth = RequirePositiveDouble(extrusion, 3, $"IfcExtrudedAreaSolid #{extrusionId} Depth");
        var sweep = direction.Scale(depth);
        if (Math.Abs(direction.Z) <= 1e-12)
        {
            throw new InvalidDataException($"IfcExtrudedAreaSolid #{extrusionId} direction is parallel to its profile plane.");
        }

        var profile = BuildProfile(source, entries, registry, profileId, angleScaleToRadians);
        var flat2 = new List<double>();
        var holeStarts = new List<int>();
        foreach (var ring in profile.Rings)
        {
            if (flat2.Count > 0) holeStarts.Add(flat2.Count / 2);
            foreach (var point in ring)
            {
                flat2.Add(point.X);
                flat2.Add(point.Y);
            }
        }
        var cap = new List<int>();
        EarcutTriangulator.Triangulate(flat2, holeStarts, cap);
        RepairCapTriangulation(flat2, cap);
        if (cap.Count == 0 || cap.Count % 3 != 0 || EarcutTriangulator.Deviation(flat2, holeStarts, cap) > 1e-8)
        {
            throw new InvalidDataException($"IfcExtrudedAreaSolid #{extrusionId} profile could not be triangulated safely.");
        }

        var points = new List<GeneratedPoint>(flat2.Count);
        for (var index = 0; index < flat2.Count; index += 2)
        {
            points.Add(solidFrame.Transform(new P3(flat2[index], flat2[index + 1], 0)).ToPublic());
        }
        var basePointCount = points.Count;
        for (var index = 0; index < basePointCount; index++)
        {
            var point = P3.From(points[index]).Add(solidFrame.TransformVector(sweep));
            points.Add(point.ToPublic());
        }

        var indices = new List<int>(cap.Count * 2 + profile.Rings.Sum(ring => ring.Count) * 6);
        var profileNormal = solidFrame.Z;
        for (var index = 0; index < cap.Count; index += 3)
        {
            AddOrientedTriangle(points, indices, cap[index], cap[index + 1], cap[index + 2], profileNormal.Scale(-1), "base cap");
            AddOrientedTriangle(points, indices,
                cap[index] + basePointCount,
                cap[index + 1] + basePointCount,
                cap[index + 2] + basePointCount,
                profileNormal,
                "top cap");
        }

        var ringOffset = 0;
        foreach (var ring in profile.Rings)
        {
            for (var index = 0; index < ring.Count; index++)
            {
                var a = ringOffset + index;
                var b = ringOffset + (index + 1) % ring.Count;
                var expected = P3.From(points[b]).Subtract(P3.From(points[a])).Cross(solidFrame.TransformVector(sweep));
                AddOrientedTriangle(points, indices, a, b, b + basePointCount, expected, $"side ring edge {index}");
                AddOrientedTriangle(points, indices, a, b + basePointCount, a + basePointCount, expected, $"side ring edge {index}");
            }
            ringOffset += ring.Count;
        }

        if (points.Any(point => !point.IsFinite))
        {
            throw new InvalidDataException($"IfcExtrudedAreaSolid #{extrusionId} generated non-finite coordinates.");
        }
        ValidateClosedManifold(indices, extrusionId);
        return new GeneratedMesh(points, indices, 2 + profile.Rings.Sum(ring => ring.Count), 2);
    }

    private static GeneratedMesh BuildTapered(
        ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries, TypeRegistry registry,
        int id, ReadOnlySpan<byte> record, double angleScaleToRadians)
    {
        var startId = RequireReference(record, 0, $"Tapered extrusion #{id} SweptArea");
        var endId = RequireReference(record, 4, $"Tapered extrusion #{id} EndSweptArea");
        var startKind = BaseProfileKind(source, entries, registry, startId, 0);
        var endKind = BaseProfileKind(source, entries, registry, endId, 0);
        if (startKind != endKind)
            throw new InvalidDataException($"Tapered extrusion #{id} profiles have different base types.");
        if (startKind is not (EntityKind.RectangleProfile or EntityKind.RectangleHollowProfile or
            EntityKind.CircleProfile or EntityKind.CircleHollowProfile or EntityKind.IShapeProfile or
            EntityKind.LShapeProfile or EntityKind.CShapeProfile))
            throw new InvalidDataException($"Tapered extrusion #{id} profile correspondence is not verified for {startKind}.");
        if (HasMirroredDerivedProfile(source, entries, registry, startId, 0) ||
            HasMirroredDerivedProfile(source, entries, registry, endId, 0))
            throw new InvalidDataException($"Tapered extrusion #{id} has an unverified mirrored profile.");
        var start = BuildProfile(source, entries, registry, startId, angleScaleToRadians);
        var end = BuildProfile(source, entries, registry, endId, angleScaleToRadians);
        if (start.Rings.Count != end.Rings.Count ||
            start.Rings.Where((ring, index) => ring.Count != end.Rings[index].Count).Any())
            throw new InvalidDataException($"Tapered extrusion #{id} profiles have different topology.");
        var frame = ResolveFrame3(source, entries, registry, record, 1, $"Tapered extrusion #{id} Position");
        var directionId = RequireReference(record, 2, $"Tapered extrusion #{id} ExtrudedDirection");
        var direction = ResolveDirection3(source, entries, registry, directionId);
        var depth = RequirePositiveDouble(record, 3, $"Tapered extrusion #{id} Depth");
        if (Math.Abs(direction.Z) <= 1e-12)
            throw new InvalidDataException($"Tapered extrusion #{id} direction is parallel to its profile plane.");
        var sweep = frame.TransformVector(direction.Scale(depth));
        var points = new List<GeneratedPoint>();
        foreach (var ring in start.Rings)
            foreach (var point in ring)
                points.Add(frame.Transform(new P3(point.X, point.Y, 0)).ToPublic());
        var count = points.Count;
        foreach (var ring in end.Rings)
            foreach (var point in ring)
                points.Add(frame.Transform(new P3(point.X, point.Y, 0)).Add(sweep).ToPublic());
        if (points.Any(point => !point.IsFinite))
            throw new InvalidDataException($"Tapered extrusion #{id} generated non-finite coordinates.");
        var startCap = TriangulateProfile(start, id);
        var endCap = TriangulateProfile(end, id);
        var indices = new List<int>((startCap.Count + endCap.Count) + count * 6);
        var normal = frame.Z.Scale(Math.Sign(direction.Z));
        for (var index = 0; index < startCap.Count; index += 3)
            AddOrientedTriangle(points, indices, startCap[index], startCap[index + 1], startCap[index + 2], normal.Scale(-1), "base cap");
        for (var index = 0; index < endCap.Count; index += 3)
            AddOrientedTriangle(points, indices, endCap[index] + count, endCap[index + 1] + count, endCap[index + 2] + count, normal, "end cap");
        var offset = 0;
        foreach (var ring in start.Rings)
        {
            for (var index = 0; index < ring.Count; index++)
            {
                var a = offset + index;
                var b = offset + (index + 1) % ring.Count;
                var expected = P3.From(points[b]).Subtract(P3.From(points[a]))
                    .Cross(P3.From(points[a + count]).Subtract(P3.From(points[a])));
                if (direction.Z < 0) expected = expected.Scale(-1);
                AddOrientedTriangle(points, indices, a, b, b + count, expected, $"side ring edge {index}");
                AddOrientedTriangle(points, indices, a, b + count, a + count, expected, $"side ring edge {index}");
            }
            offset += ring.Count;
        }
        ValidateClosedManifold(indices, id);
        return new GeneratedMesh(points, indices, 2 + count, 2);
    }

    private static List<int> TriangulateProfile(Profile profile, int id)
    {
        var flat = new List<double>();
        var holes = new List<int>();
        foreach (var ring in profile.Rings)
        {
            if (flat.Count > 0) holes.Add(flat.Count / 2);
            foreach (var point in ring) { flat.Add(point.X); flat.Add(point.Y); }
        }
        var cap = new List<int>();
        EarcutTriangulator.Triangulate(flat, holes, cap);
        RepairCapTriangulation(flat, cap);
        if (cap.Count == 0 || cap.Count % 3 != 0 || EarcutTriangulator.Deviation(flat, holes, cap) > 1e-8)
            throw new InvalidDataException($"Tapered extrusion #{id} profile could not be triangulated safely.");
        return cap;
    }

    private static EntityKind BaseProfileKind(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries,
        TypeRegistry registry, int id, int depth)
    {
        if (depth > 8 || !GraphCoverageAnalyzer.TryGetRecord(source, entries, id, out var record, out var typeId))
            throw new InvalidDataException($"Tapered profile #{id} is missing or nested too deeply.");
        var kind = registry[typeId].Kind;
        return kind == EntityKind.DerivedProfile
            ? BaseProfileKind(source, entries, registry, RequireReference(record, 2, $"Derived profile #{id} ParentProfile"), depth + 1)
            : kind;
    }

    private static bool HasMirroredDerivedProfile(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries,
        TypeRegistry registry, int id, int depth)
    {
        if (depth > 8 || !GraphCoverageAnalyzer.TryGetRecord(source, entries, id, out var record, out var typeId))
            throw new InvalidDataException($"Tapered profile #{id} is missing or nested too deeply.");
        if (registry[typeId].Kind != EntityKind.DerivedProfile) return false;
        var operatorId = RequireReference(record, 3, $"Derived profile #{id} Operator");
        var frame = ResolveProfileOperator2D(source, entries, registry, operatorId);
        var determinant = frame.X.X * frame.Y.Y - frame.X.Y * frame.Y.X;
        if (determinant < 0) return true;
        var parentId = RequireReference(record, 2, $"Derived profile #{id} ParentProfile");
        return HasMirroredDerivedProfile(source, entries, registry, parentId, depth + 1);
    }

    internal static IReadOnlyList<GeneratedPoint2> ResolveBoundaryCurve(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int curveId,
        string label,
        double angleScaleToRadians)
    {
        var ring = ResolveCurveRing(source, entries, registry, curveId, label, angleScaleToRadians);
        CleanRing(ring, label);
        return ring.Select(point => new GeneratedPoint2(point.X, point.Y)).ToArray();
    }

    private static Profile BuildProfile(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int profileId,
        double angleScaleToRadians, int depth = 0)
    {
        if (depth > 8) throw new InvalidDataException($"Profile #{profileId} is nested too deeply.");
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, profileId, out var record, out var typeId))
            throw new InvalidDataException($"Swept profile #{profileId} is missing.");
        var kind = registry[typeId].Kind;
        if (kind == EntityKind.DerivedProfile)
        {
            var parentId = RequireReference(record, 2, $"IfcDerivedProfileDef #{profileId} ParentProfile");
            var operatorId = RequireReference(record, 3, $"IfcDerivedProfileDef #{profileId} Operator");
            var parent = BuildProfile(source, entries, registry, parentId, angleScaleToRadians, depth + 1);
            var transform = ResolveProfileOperator2D(source, entries, registry, operatorId);
            foreach (var ring in parent.Rings)
                for (var index = 0; index < ring.Count; index++) ring[index] = transform.Transform(ring[index]);
            for (var ringIndex = 0; ringIndex < parent.Rings.Count; ringIndex++)
                NormalizeWinding(parent.Rings[ringIndex], ringIndex == 0);
            ValidateVoids(parent.Rings, profileId);
            return parent;
        }
        List<List<P2>> rings = kind switch
        {
            EntityKind.RectangleProfile => Rectangle(record, profileId),
            EntityKind.RectangleHollowProfile => RectangleHollow(record, profileId),
            EntityKind.CircleProfile => Circle(record, profileId, false),
            EntityKind.CircleHollowProfile => Circle(record, profileId, true),
            EntityKind.IShapeProfile => IShape(record, profileId),
            EntityKind.LShapeProfile => LShape(record, profileId),
            EntityKind.CShapeProfile => CShape(record, profileId),
            EntityKind.ArbitraryClosedProfile => ArbitraryClosed(source, entries, registry, record, profileId, angleScaleToRadians),
            EntityKind.ArbitraryProfileWithVoids => ArbitraryWithVoids(source, entries, registry, record, profileId, angleScaleToRadians),
            _ => throw new InvalidDataException($"IfcExtrudedAreaSolid profile {registry[typeId].Name} #{profileId} is not supported."),
        };
        var hasPosition = kind is EntityKind.RectangleProfile or EntityKind.RectangleHollowProfile or
            EntityKind.CircleProfile or EntityKind.CircleHollowProfile or EntityKind.IShapeProfile or
            EntityKind.LShapeProfile or EntityKind.CShapeProfile;
        var frame = hasPosition
            ? ResolveFrame2(source, entries, registry, record, 2, $"Profile #{profileId} Position")
            : Frame2.Identity;
        for (var ringIndex = 0; ringIndex < rings.Count; ringIndex++)
        {
            var ring = rings[ringIndex];
            for (var index = 0; index < ring.Count; index++) ring[index] = frame.Transform(ring[index]);
            CleanRing(ring, $"Profile #{profileId} ring {ringIndex + 1}");
            NormalizeWinding(ring, counterClockwise: ringIndex == 0);
        }
        ValidateVoids(rings, profileId);
        return new Profile(rings);
    }

    private static Frame2 ResolveProfileOperator2D(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries,
        TypeRegistry registry, int id)
    {
        var record = RequireRecord(source, entries, registry, id, EntityKind.CartesianTransformationOperator2D);
        var originId = RequireReference(record, 2, $"IfcCartesianTransformationOperator2D #{id} LocalOrigin");
        var origin = ResolvePoint2(source, entries, registry, originId);
        var scale = 1d;
        if (StepParsing.TryGetTopLevelArgument(record, 3, out var scaleArg) && !StepParsing.IsOmitted(scaleArg))
        {
            if (!StepParsing.TryParseDouble(scaleArg, out scale) || !double.IsFinite(scale) || scale <= 0)
                throw new InvalidDataException($"IfcCartesianTransformationOperator2D #{id} Scale is invalid.");
        }
        P2? axis1 = null, axis2 = null;
        if (StepParsing.TryGetTopLevelArgument(record, 0, out var first) && !StepParsing.IsOmitted(first))
        {
            if (!StepParsing.TryReadSingleReference(first, out var axisId))
                throw new InvalidDataException($"IfcCartesianTransformationOperator2D #{id} Axis1 is invalid.");
            axis1 = ResolveDirection2(source, entries, registry, axisId);
        }
        if (StepParsing.TryGetTopLevelArgument(record, 1, out var second) && !StepParsing.IsOmitted(second))
        {
            if (!StepParsing.TryReadSingleReference(second, out var axisId))
                throw new InvalidDataException($"IfcCartesianTransformationOperator2D #{id} Axis2 is invalid.");
            axis2 = ResolveDirection2(source, entries, registry, axisId);
        }
        var x = axis1 ?? (axis2 is P2 yOnly ? new P2(yOnly.Y, -yOnly.X) : new P2(1, 0));
        var y = axis2 ?? new P2(-x.Y, x.X);
        if (Math.Abs(x.X * y.X + x.Y * y.Y) > 1e-8)
            throw new InvalidDataException($"IfcCartesianTransformationOperator2D #{id} axes are not perpendicular.");
        return new Frame2(origin, new P2(x.X * scale, x.Y * scale), new P2(y.X * scale, y.Y * scale));
    }

    private static List<List<P2>> Rectangle(ReadOnlySpan<byte> record, int id)
    {
        var width = RequirePositiveDouble(record, 3, $"IfcRectangleProfileDef #{id} XDim");
        var height = RequirePositiveDouble(record, 4, $"IfcRectangleProfileDef #{id} YDim");
        return [Box(width, height)];
    }

    private static List<List<P2>> RectangleHollow(ReadOnlySpan<byte> record, int id)
    {
        var width = RequirePositiveDouble(record, 3, $"IfcRectangleHollowProfileDef #{id} XDim");
        var height = RequirePositiveDouble(record, 4, $"IfcRectangleHollowProfileDef #{id} YDim");
        var thickness = RequirePositiveDouble(record, 5, $"IfcRectangleHollowProfileDef #{id} WallThickness");
        var innerRadius = OptionalNonNegativeDouble(record, 6, $"IfcRectangleHollowProfileDef #{id} InnerFilletRadius");
        var outerRadius = OptionalNonNegativeDouble(record, 7, $"IfcRectangleHollowProfileDef #{id} OuterFilletRadius");
        if (width <= 2 * thickness || height <= 2 * thickness)
            throw new InvalidDataException($"IfcRectangleHollowProfileDef #{id} wall thickness collapses the opening.");
        if (outerRadius > Math.Min(width, height) / 2 ||
            innerRadius > Math.Min(width, height) / 2 - thickness)
            throw new InvalidDataException($"IfcRectangleHollowProfileDef #{id} fillet radius exceeds the profile bounds.");
        return [RoundedBox(width, height, outerRadius),
            RoundedBox(width - 2 * thickness, height - 2 * thickness, innerRadius)];
    }

    private static List<List<P2>> Circle(ReadOnlySpan<byte> record, int id, bool hollow)
    {
        var radius = RequirePositiveDouble(record, 3, $"Circle profile #{id} Radius");
        var outer = CircleRing(radius);
        if (!hollow) return [outer];
        var thickness = RequirePositiveDouble(record, 4, $"IfcCircleHollowProfileDef #{id} WallThickness");
        if (thickness >= radius)
            throw new InvalidDataException($"IfcCircleHollowProfileDef #{id} wall thickness collapses the opening.");
        return [outer, CircleRing(radius - thickness)];
    }

    private static List<List<P2>> IShape(ReadOnlySpan<byte> record, int id)
    {
        var width = RequirePositiveDouble(record, 3, $"IfcIShapeProfileDef #{id} OverallWidth");
        var depth = RequirePositiveDouble(record, 4, $"IfcIShapeProfileDef #{id} OverallDepth");
        var web = RequirePositiveDouble(record, 5, $"IfcIShapeProfileDef #{id} WebThickness");
        var flange = RequirePositiveDouble(record, 6, $"IfcIShapeProfileDef #{id} FlangeThickness");
        var fillet = OptionalNonNegativeDouble(record, 7, $"IfcIShapeProfileDef #{id} FilletRadius");
        RequireZeroOrOmitted(record, 8, $"IfcIShapeProfileDef #{id} FlangeEdgeRadius");
        RequireZeroOrOmitted(record, 9, $"IfcIShapeProfileDef #{id} FlangeSlope");
        if (web >= width || 2 * flange >= depth)
            throw new InvalidDataException($"IfcIShapeProfileDef #{id} has invalid flange or web dimensions.");
        var maximumFillet = Math.Min((width - web) / 2, (depth - 2 * flange) / 2);
        if (fillet > maximumFillet + 1e-12)
            throw new InvalidDataException($"IfcIShapeProfileDef #{id} fillet radius exceeds the available web/flange clearance.");
        var x = width / 2;
        var y = depth / 2;
        var wx = web / 2;
        var bottom = -y + flange;
        var top = y - flange;
        if (fillet <= 1e-12)
        {
            return [[
                new(-x,-y), new(x,-y), new(x,bottom), new(wx,bottom),
                new(wx,top), new(x,top), new(x,y), new(-x,y),
                new(-x,top), new(-wx,top), new(-wx,bottom), new(-x,bottom),
            ]];
        }

        var ring = new List<P2>(44)
        {
            new(-x, -y), new(x, -y), new(x, bottom), new(wx + fillet, bottom),
        };
        AppendArc(ring, new P2(wx + fillet, bottom + fillet), fillet, -Math.PI / 2, -Math.PI, 8);
        ring.Add(new P2(wx, top - fillet));
        AppendArc(ring, new P2(wx + fillet, top - fillet), fillet, Math.PI, Math.PI / 2, 8);
        ring.AddRange([new P2(x, top), new P2(x, y), new P2(-x, y), new P2(-x, top), new P2(-wx - fillet, top)]);
        AppendArc(ring, new P2(-wx - fillet, top - fillet), fillet, Math.PI / 2, 0, 8);
        ring.Add(new P2(-wx, bottom + fillet));
        AppendArc(ring, new P2(-wx - fillet, bottom + fillet), fillet, 0, -Math.PI / 2, 8);
        ring.Add(new P2(-x, bottom));
        return [ring];
    }

    private static List<List<P2>> LShape(ReadOnlySpan<byte> record, int id)
    {
        var depth = RequirePositiveDouble(record, 3, $"IfcLShapeProfileDef #{id} Depth");
        var width = RequirePositiveDouble(record, 4, $"IfcLShapeProfileDef #{id} Width");
        var thickness = RequirePositiveDouble(record, 5, $"IfcLShapeProfileDef #{id} Thickness");
        var fillet = OptionalNonNegativeDouble(record, 6, $"IfcLShapeProfileDef #{id} FilletRadius");
        var edge = OptionalNonNegativeDouble(record, 7, $"IfcLShapeProfileDef #{id} EdgeRadius");
        RequireZeroOrOmitted(record, 8, $"IfcLShapeProfileDef #{id} LegSlope");
        if (thickness >= width || thickness >= depth)
            throw new InvalidDataException($"IfcLShapeProfileDef #{id} has invalid thickness.");
        if (edge > thickness || fillet + edge + thickness >= Math.Min(width, depth))
            throw new InvalidDataException($"IfcLShapeProfileDef #{id} fillet or edge radius exceeds the available leg.");
        var x = width / 2;
        var y = depth / 2;
        var ring = new List<P2>(56) { new(-x, -y), new(x, -y), new(x, -y + thickness - edge) };
        if (edge > 1e-12)
            AppendArc(ring, new P2(x - edge, -y + thickness - edge), edge, 0, Math.PI / 2, 8);
        else ring.Add(new P2(x, -y + thickness));
        ring.Add(new P2(-x + thickness + fillet, -y + thickness));
        if (fillet > 1e-12)
            AppendArc(ring, new P2(-x + thickness + fillet, -y + thickness + fillet),
                fillet, -Math.PI / 2, -Math.PI, 16);
        else ring.Add(new P2(-x + thickness, -y + thickness));
        ring.Add(new P2(-x + thickness, y - edge));
        if (edge > 1e-12)
            AppendArc(ring, new P2(-x + thickness - edge, y - edge), edge, 0, Math.PI / 2, 8);
        else ring.Add(new P2(-x + thickness, y));
        ring.Add(new P2(-x, y));
        return [ring];
    }

    private static List<List<P2>> CShape(ReadOnlySpan<byte> record, int id)
    {
        var depth = RequirePositiveDouble(record, 3, $"IfcCShapeProfileDef #{id} Depth");
        var width = RequirePositiveDouble(record, 4, $"IfcCShapeProfileDef #{id} Width");
        var thickness = RequirePositiveDouble(record, 5, $"IfcCShapeProfileDef #{id} WallThickness");
        var girth = RequirePositiveDouble(record, 6, $"IfcCShapeProfileDef #{id} Girth");
        RequireZeroOrOmitted(record, 7, $"IfcCShapeProfileDef #{id} InternalFilletRadius");
        if (width <= 2 * thickness || depth <= 2 * thickness || girth >= depth / 2 || girth <= thickness)
            throw new InvalidDataException($"IfcCShapeProfileDef #{id} has invalid wall or girth dimensions.");
        var x = width / 2;
        var y = depth / 2;
        return [[
            new(-x, -y), new(x, -y), new(x, -y + girth), new(x - thickness, -y + girth),
            new(x - thickness, -y + thickness), new(-x + thickness, -y + thickness),
            new(-x + thickness, y - thickness), new(x - thickness, y - thickness),
            new(x - thickness, y - girth), new(x, y - girth), new(x, y), new(-x, y),
        ]];
    }

    private static List<List<P2>> ArbitraryClosed(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> record,
        int id,
        double angleScaleToRadians)
    {
        var curveId = RequireReference(record, 2, $"IfcArbitraryClosedProfileDef #{id} OuterCurve");
        return [ResolveCurveRing(source, entries, registry, curveId, $"IfcArbitraryClosedProfileDef #{id} OuterCurve", angleScaleToRadians)];
    }

    private static List<List<P2>> ArbitraryWithVoids(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> record,
        int id,
        double angleScaleToRadians)
    {
        var curveId = RequireReference(record, 2, $"IfcArbitraryProfileDefWithVoids #{id} OuterCurve");
        if (!StepParsing.TryGetTopLevelArgument(record, 3, out var innerArgument))
            throw new InvalidDataException($"IfcArbitraryProfileDefWithVoids #{id} has no InnerCurves argument.");
        var innerIds = new List<int>();
        StepParsing.CollectReferences(innerArgument, innerIds);
        if (innerIds.Count == 0)
            throw new InvalidDataException($"IfcArbitraryProfileDefWithVoids #{id} has no inner curves.");
        var rings = new List<List<P2>>(innerIds.Count + 1)
        {
            ResolveCurveRing(source, entries, registry, curveId, $"IfcArbitraryProfileDefWithVoids #{id} OuterCurve", angleScaleToRadians),
        };
        foreach (var innerId in innerIds)
            rings.Add(ResolveCurveRing(source, entries, registry, innerId, $"IfcArbitraryProfileDefWithVoids #{id} InnerCurve", angleScaleToRadians));
        return rings;
    }

    private static List<P2> ResolveCurveRing(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int curveId,
        string label,
        double angleScaleToRadians)
    {
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, curveId, out var curve, out var typeId))
            throw new InvalidDataException($"{label} #{curveId} is missing.");
        return registry[typeId].Kind switch
        {
            EntityKind.Polyline => ResolvePolyline(source, entries, registry, curve, curveId, 3),
            EntityKind.IndexedPolyCurve => ResolveIndexedPolyCurve(source, entries, registry, curve, curveId),
            EntityKind.CompositeCurve => ResolveCompositeCurve(source, entries, registry, curve, curveId, angleScaleToRadians),
            _ => throw new InvalidDataException($"{label} uses unsupported {registry[typeId].Name} #{curveId}."),
        };
    }

    private static List<P2> ResolvePolyline(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> curve,
        int curveId,
        int minimumPoints)
    {
        if (!StepParsing.TryGetTopLevelArgument(curve, 0, out var pointsArgument))
            throw new InvalidDataException($"IfcPolyline #{curveId} has no Points argument.");
        var pointIds = new List<int>();
        StepParsing.CollectReferences(pointsArgument, pointIds);
        if (pointIds.Count < minimumPoints) throw new InvalidDataException($"IfcPolyline #{curveId} has fewer than {minimumPoints} points.");
        var result = new List<P2>(pointIds.Count);
        foreach (var pointId in pointIds) result.Add(ResolvePoint2(source, entries, registry, pointId));
        return result;
    }

    private static List<P2> ResolveCompositeCurve(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> curve,
        int curveId,
        double angleScaleToRadians)
    {
        if (!StepParsing.TryGetTopLevelArgument(curve, 0, out var segmentsArgument))
            throw new InvalidDataException($"IfcCompositeCurve #{curveId} has no Segments argument.");
        var segmentIds = new List<int>();
        StepParsing.CollectReferences(segmentsArgument, segmentIds);
        if (segmentIds.Count == 0 || segmentIds.Count > 4096)
            throw new InvalidDataException($"IfcCompositeCurve #{curveId} has an invalid segment count {segmentIds.Count}.");

        var result = new List<P2>(segmentIds.Count * 2);
        var lengthUnitScaleToMetres = InstanceChunkWriter.ResolveLengthUnitScale(
            source, entries, entries.Length / 16, registry);
        foreach (var segmentId in segmentIds)
        {
            var segment = RequireRecord(source, entries, registry, segmentId, EntityKind.CompositeCurveSegment);
            if (!StepParsing.TryGetTopLevelArgument(segment, 1, out var sameSenseArgument) ||
                !StepParsing.TryParseLogical(sameSenseArgument, out var sameSense))
                throw new InvalidDataException($"IfcCompositeCurveSegment #{segmentId} has invalid SameSense.");
            var parentId = RequireReference(segment, 2, $"IfcCompositeCurveSegment #{segmentId} ParentCurve");
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, parentId, out var parent, out var parentTypeId))
                throw new InvalidDataException($"IfcCompositeCurveSegment #{segmentId} parent curve #{parentId} is missing.");
            List<P2> points;
            switch (registry[parentTypeId].Kind)
            {
                case EntityKind.Polyline:
                    points = ResolvePolyline(source, entries, registry, parent, parentId, 2);
                    if (!sameSense) points.Reverse();
                    break;
                case EntityKind.TrimmedCurve:
                    points = ResolveTrimmedCircle(source, entries, registry, parent, parentId, sameSense, angleScaleToRadians);
                    break;
                default:
                    throw new InvalidDataException($"IfcCompositeCurveSegment #{segmentId} uses unsupported {registry[parentTypeId].Name} #{parentId}.");
            }
            AppendConnectedSegment(result, points, curveId, segmentId, lengthUnitScaleToMetres);
        }
        return result;
    }

    private static List<P2> ResolveTrimmedCircle(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> trimmed,
        int trimmedId,
        bool sameSense,
        double angleScaleToRadians)
    {
        var circleId = RequireReference(trimmed, 0, $"IfcTrimmedCurve #{trimmedId} BasisCurve");
        var circle = RequireRecord(source, entries, registry, circleId, EntityKind.Circle);
        var frame = ResolveFrame2(source, entries, registry, circle, 0, $"IfcCircle #{circleId} Position");
        var radius = RequirePositiveDouble(circle, 1, $"IfcCircle #{circleId} Radius");
        if (!StepParsing.TryGetTopLevelArgument(trimmed, 1, out var trim1) ||
            !StepParsing.TryGetTopLevelArgument(trimmed, 2, out var trim2))
            throw new InvalidDataException($"IfcTrimmedCurve #{trimmedId} has invalid trimming values.");
        var start = ResolveCircleTrim(source, entries, registry, trim1, frame, trimmedId, "Trim1", angleScaleToRadians);
        var end = ResolveCircleTrim(source, entries, registry, trim2, frame, trimmedId, "Trim2", angleScaleToRadians);
        if (!StepParsing.TryGetTopLevelArgument(trimmed, 3, out var senseArgument) ||
            !StepParsing.TryParseLogical(senseArgument, out var senseAgreement))
            throw new InvalidDataException($"IfcTrimmedCurve #{trimmedId} has invalid SenseAgreement.");
        // Trim1 is the start of the trimmed curve. A composite segment may
        // reverse it; SenseAgreement chooses which side of a closed circle is
        // retained. Neither flag can be substituted for the other.
        var arcStart = sameSense ? start : end;
        var arcEnd = sameSense ? end : start;
        var sweep = arcEnd - arcStart;
        if (sameSense == senseAgreement)
            while (sweep <= 1e-12) sweep += 2 * Math.PI;
        else
            while (sweep >= -1e-12) sweep -= 2 * Math.PI;
        if (Math.Abs(sweep) >= 2 * Math.PI - 1e-10)
            throw new InvalidDataException($"IfcTrimmedCurve #{trimmedId} resolves to a full or ambiguous circle.");
        var segments = Math.Clamp((int)Math.Ceiling(Math.Abs(sweep) / (2 * Math.PI / CircleSegments)), 1, CircleSegments);
        var points = new List<P2>(segments + 1);
        for (var index = 0; index <= segments; index++)
        {
            var angle = arcStart + sweep * index / segments;
            points.Add(frame.Transform(new P2(radius * Math.Cos(angle), radius * Math.Sin(angle))));
        }
        return points;
    }

    private static double ResolveCircleTrim(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> trim,
        Frame2 frame,
        int curveId,
        string label,
        double angleScaleToRadians)
    {
        var references = new List<int>(1);
        StepParsing.CollectReferences(trim, references);
        if (references.Count > 0)
        {
            var point = ResolvePoint2(source, entries, registry, references[0]);
            var local = frame.Inverse(point);
            return Math.Atan2(local.Y, local.X);
        }
        if (TryParseWrappedDouble(trim, out var parameter) && double.IsFinite(parameter))
            return parameter * angleScaleToRadians;
        throw new InvalidDataException($"IfcTrimmedCurve #{curveId} {label} is not a supported parameter or Cartesian point.");
    }

    private static bool TryParseWrappedDouble(ReadOnlySpan<byte> value, out double result)
    {
        value = StepParsing.Trim(value);
        while (value.Length >= 2 && value[0] == (byte)'(' && value[^1] == (byte)')')
            value = StepParsing.Trim(value[1..^1]);
        var open = value.IndexOf((byte)'(');
        if (open >= 0 && value[^1] == (byte)')') value = StepParsing.Trim(value[(open + 1)..^1]);
        return StepParsing.TryParseDouble(value, out result);
    }

    private static void AppendConnectedSegment(List<P2> destination, List<P2> segment, int curveId, int segmentId,
        double lengthUnitScaleToMetres)
    {
        if (segment.Count < 2) throw new InvalidDataException($"IfcCompositeCurveSegment #{segmentId} is empty.");
        if (destination.Count == 0)
        {
            destination.AddRange(segment);
            return;
        }
        // Arc and line endpoints exported from different parametric paths can
        // differ slightly. Compare the gap to the adjacent segment lengths,
        // never to a large profile coordinate or global translation.
        var scale = Math.Max(1d, Math.Max(
            Math.Sqrt(DistanceSquared(destination[0], destination[^1])),
            Math.Max(Math.Sqrt(DistanceSquared(destination[^2], destination[^1])),
                Math.Sqrt(DistanceSquared(segment[0], segment[^1])))));
        var tolerance = scale * 3e-4;
        var gap = Math.Sqrt(DistanceSquared(destination[^1], segment[0]));
        if (gap > tolerance)
        {
            // Some exporters emit a stray end point before a segment marked
            // continuous. Snap that endpoint to the next segment's start;
            // cap the repair at 10.1 mm and 15% of its adjacent span.
            if (gap <= 0.0101 / lengthUnitScaleToMetres && gap <= scale * 0.15)
            {
                destination[^1] = segment[0];
                destination.AddRange(segment.Skip(1));
                return;
            }
            throw new InvalidDataException($"IfcCompositeCurve #{curveId} is disconnected at segment #{segmentId}: gap {gap:G6}, tolerance {tolerance:G6}.");
        }
        destination.AddRange(segment.Skip(1));
    }

    private static List<P2> ResolveIndexedPolyCurve(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> curve,
        int curveId)
    {
        var pointListId = RequireReference(curve, 0, $"IfcIndexedPolyCurve #{curveId} Points");
        var pointList = RequireRecord(source, entries, registry, pointListId, EntityKind.CartesianPointList2D);
        if (!StepParsing.TryGetTopLevelArgument(pointList, 0, out var coordinatesArgument))
            throw new InvalidDataException($"IfcCartesianPointList2D #{pointListId} has no CoordList.");
        var tuples = new List<double[]>();
        if (!StepParsing.TryParseDoubleTuples(coordinatesArgument, 2, tuples) || tuples.Count < 3)
            throw new InvalidDataException($"IfcCartesianPointList2D #{pointListId} has invalid coordinates.");

        var order = new List<int>();
        if (StepParsing.TryGetTopLevelArgument(curve, 1, out var segments) && !StepParsing.IsOmitted(segments))
        {
            if (!StepParsing.TryParseIndexedLineSegments(segments, order))
                throw new InvalidDataException($"IfcIndexedPolyCurve #{curveId} contains unsupported or disconnected segments; only connected IfcLineIndex segments are supported.");
        }
        else
        {
            for (var index = 1; index <= tuples.Count; index++) order.Add(index);
        }
        if (order.Count < 3) throw new InvalidDataException($"IfcIndexedPolyCurve #{curveId} has fewer than three line indices.");
        var result = new List<P2>(order.Count);
        foreach (var oneBased in order)
        {
            if (oneBased > tuples.Count)
                throw new InvalidDataException($"IfcIndexedPolyCurve #{curveId} references point {oneBased}, but only {tuples.Count} exist.");
            result.Add(new P2(tuples[oneBased - 1][0], tuples[oneBased - 1][1]));
        }
        return result;
    }

    private static void CleanRing(List<P2> ring, string label)
    {
        if (ring.Count > 4096) throw new InvalidDataException($"{label} exceeds the 4,096-point safety limit.");
        var scale = 1d;
        foreach (var point in ring) scale = Math.Max(scale, Math.Max(Math.Abs(point.X), Math.Abs(point.Y)));
        var tolerance = scale * 1e-10;
        for (var index = ring.Count - 1; index > 0; index--)
        {
            if (DistanceSquared(ring[index], ring[index - 1]) <= tolerance * tolerance) ring.RemoveAt(index);
        }
        if (ring.Count > 1 && DistanceSquared(ring[0], ring[^1]) <= tolerance * tolerance) ring.RemoveAt(ring.Count - 1);
        var changed = true;
        while (changed && ring.Count >= 3)
        {
            changed = false;
            for (var index = ring.Count - 1; index >= 0; index--)
            {
                var previous = ring[(index - 1 + ring.Count) % ring.Count];
                var current = ring[index];
                var next = ring[(index + 1) % ring.Count];
                var cross = (current.X - previous.X) * (next.Y - current.Y) -
                    (current.Y - previous.Y) * (next.X - current.X);
                var previousLengthSquared = DistanceSquared(previous, current);
                var nextLengthSquared = DistanceSquared(current, next);
                var crossScale = Math.Sqrt(previousLengthSquared * nextLengthSquared);
                if (Math.Abs(cross) > 1e-12 * crossScale) continue;
                ring.RemoveAt(index);
                changed = true;
            }
        }
        if (ring.Count < 3 || Math.Abs(SignedArea(ring)) <= tolerance * tolerance)
            throw new InvalidDataException($"{label} collapses after duplicate and collinear-point cleanup.");
        for (var first = 0; first < ring.Count; first++)
        {
            var firstNext = (first + 1) % ring.Count;
            for (var second = first + 1; second < ring.Count; second++)
            {
                var secondNext = (second + 1) % ring.Count;
                if (first == second || firstNext == second || secondNext == first) continue;
                if (SegmentsIntersect(ring[first], ring[firstNext], ring[second], ring[secondNext], tolerance))
                    throw new InvalidDataException($"{label} self-intersects.");
            }
        }
    }

    private static void ValidateVoids(IReadOnlyList<List<P2>> rings, int profileId)
    {
        if (rings.Count <= 1) return;
        var outer = rings[0];
        for (var index = 1; index < rings.Count; index++)
        {
            if (!PointInPolygon(rings[index][0], outer) || RingsIntersect(rings[index], outer))
                throw new InvalidDataException($"Profile #{profileId} inner ring {index} is outside the outer ring.");
            for (var prior = 1; prior < index; prior++)
            {
                if (PointInPolygon(rings[index][0], rings[prior]) || PointInPolygon(rings[prior][0], rings[index]) ||
                    RingsIntersect(rings[index], rings[prior]))
                    throw new InvalidDataException($"Profile #{profileId} inner rings {prior} and {index} overlap.");
            }
        }
    }

    private static double SignedArea(IReadOnlyList<P2> ring)
    {
        var area = 0d;
        for (var index = 0; index < ring.Count; index++)
        {
            var next = ring[(index + 1) % ring.Count];
            area += ring[index].X * next.Y - next.X * ring[index].Y;
        }
        return area * 0.5;
    }

    private static double DistanceSquared(P2 left, P2 right)
    {
        var dx = left.X - right.X;
        var dy = left.Y - right.Y;
        return dx * dx + dy * dy;
    }

    private static bool SegmentsIntersect(P2 a, P2 b, P2 c, P2 d, double tolerance)
    {
        static double Cross(P2 p, P2 q, P2 r) =>
            (q.X - p.X) * (r.Y - p.Y) - (q.Y - p.Y) * (r.X - p.X);
        var abC = Cross(a, b, c);
        var abD = Cross(a, b, d);
        var cdA = Cross(c, d, a);
        var cdB = Cross(c, d, b);
        return ((abC > tolerance && abD < -tolerance) || (abC < -tolerance && abD > tolerance)) &&
               ((cdA > tolerance && cdB < -tolerance) || (cdA < -tolerance && cdB > tolerance));
    }

    private static bool RingsIntersect(IReadOnlyList<P2> left, IReadOnlyList<P2> right)
    {
        var scale = 1d;
        foreach (var point in left.Concat(right)) scale = Math.Max(scale, Math.Max(Math.Abs(point.X), Math.Abs(point.Y)));
        var tolerance = scale * 1e-10;
        for (var leftIndex = 0; leftIndex < left.Count; leftIndex++)
        {
            var leftNext = (leftIndex + 1) % left.Count;
            for (var rightIndex = 0; rightIndex < right.Count; rightIndex++)
            {
                var rightNext = (rightIndex + 1) % right.Count;
                if (SegmentsIntersect(left[leftIndex], left[leftNext], right[rightIndex], right[rightNext], tolerance)) return true;
            }
        }
        return false;
    }

    private static bool PointInPolygon(P2 point, IReadOnlyList<P2> ring)
    {
        var inside = false;
        for (int current = 0, previous = ring.Count - 1; current < ring.Count; previous = current++)
        {
            var a = ring[current];
            var b = ring[previous];
            if ((a.Y > point.Y) == (b.Y > point.Y)) continue;
            var crossing = (b.X - a.X) * (point.Y - a.Y) / (b.Y - a.Y) + a.X;
            if (point.X < crossing) inside = !inside;
        }
        return inside;
    }

    private static List<P2> Box(double width, double height)
    {
        var x = width / 2;
        var y = height / 2;
        return [new(-x,-y), new(x,-y), new(x,y), new(-x,y)];
    }

    private static List<P2> RoundedBox(double width, double height, double radius)
    {
        if (radius <= 1e-12) return Box(width, height);
        var x = width / 2;
        var y = height / 2;
        const int quarterSegments = 16;
        var ring = new List<P2>(4 * (quarterSegments + 1))
        {
            new(-x + radius, -y), new(x - radius, -y),
        };
        AppendArc(ring, new P2(x - radius, -y + radius), radius, -Math.PI / 2, 0, quarterSegments);
        ring.Add(new P2(x, y - radius));
        AppendArc(ring, new P2(x - radius, y - radius), radius, 0, Math.PI / 2, quarterSegments);
        ring.Add(new P2(-x + radius, y));
        AppendArc(ring, new P2(-x + radius, y - radius), radius, Math.PI / 2, Math.PI, quarterSegments);
        ring.Add(new P2(-x, -y + radius));
        AppendArc(ring, new P2(-x + radius, -y + radius), radius, Math.PI, 3 * Math.PI / 2, quarterSegments);
        ring.RemoveAt(ring.Count - 1); // Closing point is the first tangent again.
        return ring;
    }

    private static List<P2> CircleRing(double radius)
    {
        var ring = new List<P2>(CircleSegments);
        for (var index = 0; index < CircleSegments; index++)
        {
            var angle = 2 * Math.PI * index / CircleSegments;
            ring.Add(new P2(radius * Math.Cos(angle), radius * Math.Sin(angle)));
        }
        return ring;
    }

    private static void AppendArc(List<P2> destination, P2 center, double radius, double start, double end, int segments)
    {
        for (var index = 1; index <= segments; index++)
        {
            var angle = start + (end - start) * index / segments;
            destination.Add(new P2(center.X + radius * Math.Cos(angle), center.Y + radius * Math.Sin(angle)));
        }
    }

    private static Frame3 ResolveFrame3(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> owner,
        int argumentIndex,
        string label)
    {
        if (!StepParsing.TryGetTopLevelArgument(owner, argumentIndex, out var argument) || StepParsing.IsOmitted(argument))
            return Frame3.Identity;
        if (!StepParsing.TryReadSingleReference(argument, out var id)) throw new InvalidDataException($"{label} is invalid.");
        var record = RequireRecord(source, entries, registry, id, EntityKind.Axis2Placement3D);
        var locationId = RequireReference(record, 0, $"IfcAxis2Placement3D #{id} Location");
        var origin = ResolvePoint3(source, entries, registry, locationId);
        var z = ResolveOptionalDirection3(source, entries, registry, record, 1, new P3(0, 0, 1));
        var reference = ResolveOptionalDirection3(source, entries, registry, record, 2, new P3(1, 0, 0));
        var x = reference.Subtract(z.Scale(reference.Dot(z)));
        x = x.Normalize($"IfcAxis2Placement3D #{id} RefDirection");
        var y = z.Cross(x).Normalize($"IfcAxis2Placement3D #{id} derived Y axis");
        return new Frame3(origin, x, y, z);
    }

    private static Frame2 ResolveFrame2(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> owner,
        int argumentIndex,
        string label)
    {
        if (!StepParsing.TryGetTopLevelArgument(owner, argumentIndex, out var argument) || StepParsing.IsOmitted(argument))
            return Frame2.Identity;
        if (!StepParsing.TryReadSingleReference(argument, out var id)) throw new InvalidDataException($"{label} is invalid.");
        var record = RequireRecord(source, entries, registry, id, EntityKind.Axis2Placement2D);
        var locationId = RequireReference(record, 0, $"IfcAxis2Placement2D #{id} Location");
        var origin = ResolvePoint2(source, entries, registry, locationId);
        var x = new P2(1, 0);
        if (StepParsing.TryGetTopLevelArgument(record, 1, out var reference) && !StepParsing.IsOmitted(reference))
        {
            if (!StepParsing.TryReadSingleReference(reference, out var directionId))
                throw new InvalidDataException($"IfcAxis2Placement2D #{id} RefDirection is invalid.");
            x = ResolveDirection2(source, entries, registry, directionId);
        }
        return new Frame2(origin, x, new P2(-x.Y, x.X));
    }

    private static P3 ResolveOptionalDirection3(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        ReadOnlySpan<byte> owner,
        int argumentIndex,
        P3 fallback)
    {
        if (!StepParsing.TryGetTopLevelArgument(owner, argumentIndex, out var argument) || StepParsing.IsOmitted(argument)) return fallback;
        if (!StepParsing.TryReadSingleReference(argument, out var id)) throw new InvalidDataException("Axis direction reference is invalid.");
        return ResolveDirection3(source, entries, registry, id);
    }

    private static P3 ResolvePoint3(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries, TypeRegistry registry, int id)
    {
        var record = RequireRecord(source, entries, registry, id, EntityKind.CartesianPoint);
        if (!StepParsing.TryGetTopLevelArgument(record, 0, out var argument)) throw new InvalidDataException($"IfcCartesianPoint #{id} is malformed.");
        Span<double> values = stackalloc double[3];
        if (!StepParsing.TryParseDoubleList(argument, values, out var count) || count is < 2 or > 3)
            throw new InvalidDataException($"IfcCartesianPoint #{id} has invalid coordinates.");
        return new P3(values[0], values[1], count == 3 ? values[2] : 0);
    }

    private static P2 ResolvePoint2(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries, TypeRegistry registry, int id)
    {
        var point = ResolvePoint3(source, entries, registry, id);
        return new P2(point.X, point.Y);
    }

    private static P3 ResolveDirection3(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries, TypeRegistry registry, int id)
    {
        var record = RequireRecord(source, entries, registry, id, EntityKind.Direction);
        if (!StepParsing.TryGetTopLevelArgument(record, 0, out var argument)) throw new InvalidDataException($"IfcDirection #{id} is malformed.");
        Span<double> values = stackalloc double[3];
        if (!StepParsing.TryParseDoubleList(argument, values, out var count) || count is < 2 or > 3)
            throw new InvalidDataException($"IfcDirection #{id} has invalid ratios.");
        return new P3(values[0], values[1], count == 3 ? values[2] : 0).Normalize($"IfcDirection #{id}");
    }

    private static P2 ResolveDirection2(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries, TypeRegistry registry, int id)
    {
        var direction = ResolveDirection3(source, entries, registry, id);
        var length = Math.Sqrt(direction.X * direction.X + direction.Y * direction.Y);
        if (length <= 1e-15) throw new InvalidDataException($"IfcDirection #{id} has no 2D magnitude.");
        return new P2(direction.X / length, direction.Y / length);
    }

    private static ReadOnlySpan<byte> RequireRecord(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int id,
        EntityKind expected)
    {
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, id, out var record, out var typeId) || registry[typeId].Kind != expected)
            throw new InvalidDataException($"Expected {expected} at #{id}.");
        return record;
    }

    private static int RequireReference(ReadOnlySpan<byte> record, int argumentIndex, string label)
    {
        if (!StepParsing.TryGetTopLevelArgument(record, argumentIndex, out var argument) ||
            !StepParsing.TryReadSingleReference(argument, out var id))
            throw new InvalidDataException($"{label} is missing or invalid.");
        return id;
    }

    private static double RequirePositiveDouble(ReadOnlySpan<byte> record, int argumentIndex, string label)
    {
        if (!StepParsing.TryGetTopLevelArgument(record, argumentIndex, out var argument) ||
            !StepParsing.TryParseDouble(argument, out var value) || !double.IsFinite(value) || value <= 0)
            throw new InvalidDataException($"{label} must be a finite positive number.");
        return value;
    }

    private static double OptionalNonNegativeDouble(ReadOnlySpan<byte> record, int argumentIndex, string label)
    {
        if (!StepParsing.TryGetTopLevelArgument(record, argumentIndex, out var argument) || StepParsing.IsOmitted(argument)) return 0;
        if (!StepParsing.TryParseDouble(argument, out var value) || !double.IsFinite(value) || value < 0)
            throw new InvalidDataException($"{label} must be omitted or a finite non-negative number.");
        return value;
    }

    private static void RequireZeroOrOmitted(ReadOnlySpan<byte> record, int argumentIndex, string label)
    {
        if (!StepParsing.TryGetTopLevelArgument(record, argumentIndex, out var argument) || StepParsing.IsOmitted(argument)) return;
        if (!StepParsing.TryParseDouble(argument, out var value) || !double.IsFinite(value) || Math.Abs(value) > 1e-12)
            throw new InvalidDataException($"{label} is not supported unless omitted or zero.");
    }

    private static void NormalizeWinding(List<P2> ring, bool counterClockwise)
    {
        var area = 0d;
        for (var index = 0; index < ring.Count; index++)
        {
            var current = ring[index];
            var next = ring[(index + 1) % ring.Count];
            area += current.X * next.Y - next.X * current.Y;
        }
        if ((area > 0) != counterClockwise) ring.Reverse();
    }

    private static void RepairCapTriangulation(IReadOnlyList<double> flat, List<int> triangles)
    {
        var scale = flat.Select(Math.Abs).DefaultIfEmpty(1d).Max();
        var tolerance = Math.Max(1e-10, scale * 1e-10);
        var collinearVertices = new List<int>();
        for (var triangle = triangles.Count - 3; triangle >= 0; triangle -= 3)
        {
            var a = triangles[triangle];
            var b = triangles[triangle + 1];
            var c = triangles[triangle + 2];
            if (!IsDegenerate(flat, a, b, c)) continue;
            var middle = ResolveMiddleCollinearVertex(flat, a, b, c, tolerance);
            if (middle < 0)
                throw new InvalidDataException("Extrusion cap triangulation contains a collapsed triangle that cannot be repaired safely.");
            collinearVertices.Add(middle);
            triangles.RemoveRange(triangle, 3);
        }

        foreach (var pointIndex in collinearVertices.Distinct())
        {
            var point = new P2(flat[pointIndex * 2], flat[pointIndex * 2 + 1]);
            var repaired = false;
            for (var triangle = 0; triangle < triangles.Count && !repaired; triangle += 3)
            {
                for (var edge = 0; edge < 3; edge++)
                {
                    var aPosition = triangle + edge;
                    var bPosition = triangle + (edge + 1) % 3;
                    var cPosition = triangle + (edge + 2) % 3;
                    var aIndex = triangles[aPosition];
                    var bIndex = triangles[bPosition];
                    if (pointIndex == aIndex || pointIndex == bIndex) continue;
                    var a = new P2(flat[aIndex * 2], flat[aIndex * 2 + 1]);
                    var b = new P2(flat[bIndex * 2], flat[bIndex * 2 + 1]);
                    if (!PointStrictlyOnSegment(point, a, b, tolerance)) continue;
                    var cIndex = triangles[cPosition];
                    triangles[bPosition] = pointIndex;
                    triangles.Add(pointIndex);
                    triangles.Add(bIndex);
                    triangles.Add(cIndex);
                    repaired = true;
                    break;
                }
            }
            if (!repaired)
                throw new InvalidDataException($"Extrusion cap collinear vertex {pointIndex} has no containing triangle edge.");
        }

        if (triangles.Count == 0 || triangles.Count % 3 != 0 ||
            Enumerable.Range(0, triangles.Count / 3).Any(index =>
                IsDegenerate(flat, triangles[index * 3], triangles[index * 3 + 1], triangles[index * 3 + 2])))
        {
            throw new InvalidDataException("Extrusion cap triangulation contains an unrepaired degenerate triangle.");
        }
    }

    private static int ResolveMiddleCollinearVertex(IReadOnlyList<double> flat, int a, int b, int c, double tolerance)
    {
        var pa = new P2(flat[a * 2], flat[a * 2 + 1]);
        var pb = new P2(flat[b * 2], flat[b * 2 + 1]);
        var pc = new P2(flat[c * 2], flat[c * 2 + 1]);
        if (PointStrictlyOnSegment(pa, pb, pc, tolerance)) return a;
        if (PointStrictlyOnSegment(pb, pa, pc, tolerance)) return b;
        if (PointStrictlyOnSegment(pc, pa, pb, tolerance)) return c;
        return -1;
    }

    private static double Cross(IReadOnlyList<double> flat, int a, int b, int c) =>
        (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) -
        (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);

    private static bool IsDegenerate(IReadOnlyList<double> flat, int a, int b, int c)
    {
        var abX = flat[b * 2] - flat[a * 2];
        var abY = flat[b * 2 + 1] - flat[a * 2 + 1];
        var acX = flat[c * 2] - flat[a * 2];
        var acY = flat[c * 2 + 1] - flat[a * 2 + 1];
        var scale = Math.Sqrt((abX * abX + abY * abY) * (acX * acX + acY * acY));
        return Math.Abs(abX * acY - abY * acX) <= Math.Max(1e-12, scale * 1e-12);
    }

    private static bool PointStrictlyOnSegment(P2 point, P2 a, P2 b, double tolerance)
    {
        var dx = b.X - a.X;
        var dy = b.Y - a.Y;
        var lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= tolerance * tolerance) return false;
        var t = ((point.X - a.X) * dx + (point.Y - a.Y) * dy) / lengthSquared;
        if (t <= 1e-10 || t >= 1 - 1e-10) return false;
        var projected = new P2(a.X + dx * t, a.Y + dy * t);
        return DistanceSquared(point, projected) <= tolerance * tolerance;
    }

    private static void ValidateClosedManifold(IReadOnlyList<int> indices, int extrusionId)
    {
        var edges = new Dictionary<(int A, int B), int>();
        for (var index = 0; index < indices.Count; index += 3)
        {
            CountEdge(indices[index], indices[index + 1]);
            CountEdge(indices[index + 1], indices[index + 2]);
            CountEdge(indices[index + 2], indices[index]);
        }
        var open = edges.Count(pair => pair.Value == 1);
        var overConnected = edges.Count(pair => pair.Value > 2);
        if (open != 0 || overConnected != 0)
            throw new InvalidDataException($"Extrusion is not closed two-manifold; {open:N0} open and {overConnected:N0} over-connected edges were found.");
        return;

        void CountEdge(int left, int right)
        {
            var edge = left <= right ? (left, right) : (right, left);
            edges[edge] = edges.GetValueOrDefault(edge) + 1;
        }
    }

    private static void AddOrientedTriangle(
        IReadOnlyList<GeneratedPoint> points,
        List<int> indices,
        int a,
        int b,
        int c,
        P3 expected,
        string label)
    {
        var normal = P3.From(points[b]).Subtract(P3.From(points[a])).Cross(P3.From(points[c]).Subtract(P3.From(points[a])));
        if (normal.LengthSquared <= 1e-24)
            throw new InvalidDataException($"Extrusion generated a degenerate {label} triangle ({a}, {b}, {c}).");
        if (normal.Dot(expected) < 0) (b, c) = (c, b);
        indices.Add(a);
        indices.Add(b);
        indices.Add(c);
    }

    private sealed record Profile(List<List<P2>> Rings);

    private readonly record struct Frame2(P2 Origin, P2 X, P2 Y)
    {
        public static Frame2 Identity => new(new P2(0, 0), new P2(1, 0), new P2(0, 1));
        public P2 Transform(P2 point) => new(
            Origin.X + X.X * point.X + Y.X * point.Y,
            Origin.Y + X.Y * point.X + Y.Y * point.Y);
        public P2 Inverse(P2 point)
        {
            var dx = point.X - Origin.X;
            var dy = point.Y - Origin.Y;
            return new P2(dx * X.X + dy * X.Y, dx * Y.X + dy * Y.Y);
        }
    }

    private readonly record struct Frame3(P3 Origin, P3 X, P3 Y, P3 Z)
    {
        public static Frame3 Identity => new(new P3(0, 0, 0), new P3(1, 0, 0), new P3(0, 1, 0), new P3(0, 0, 1));
        public P3 Transform(P3 point) => Origin.Add(TransformVector(point));
        public P3 TransformVector(P3 vector) => new(
            X.X * vector.X + Y.X * vector.Y + Z.X * vector.Z,
            X.Y * vector.X + Y.Y * vector.Y + Z.Y * vector.Z,
            X.Z * vector.X + Y.Z * vector.Y + Z.Z * vector.Z);
    }

    private readonly record struct P2(double X, double Y);

    private readonly record struct P3(double X, double Y, double Z)
    {
        public double LengthSquared => X * X + Y * Y + Z * Z;
        public P3 Add(P3 other) => new(X + other.X, Y + other.Y, Z + other.Z);
        public P3 Subtract(P3 other) => new(X - other.X, Y - other.Y, Z - other.Z);
        public P3 Scale(double scale) => new(X * scale, Y * scale, Z * scale);
        public double Dot(P3 other) => X * other.X + Y * other.Y + Z * other.Z;
        public P3 Cross(P3 other) => new(Y * other.Z - Z * other.Y, Z * other.X - X * other.Z, X * other.Y - Y * other.X);
        public P3 Normalize(string label)
        {
            var length = Math.Sqrt(LengthSquared);
            if (!double.IsFinite(length) || length <= 1e-15) throw new InvalidDataException($"{label} has zero or invalid magnitude.");
            return Scale(1 / length);
        }
        public GeneratedPoint ToPublic() => new(X, Y, Z);
        public static P3 From(GeneratedPoint point) => new(point.X, point.Y, point.Z);
    }
}
