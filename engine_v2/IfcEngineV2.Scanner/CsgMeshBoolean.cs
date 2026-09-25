namespace IfcEngineV2.Scanner;

internal static class CsgMeshBoolean
{
    private const int MaximumBspDepth = 256;
    private const int MaximumPolygons = 4_000_000;

    public static GeneratedMesh Difference(GeneratedMesh left, GeneratedMesh right, int expressId)
    {
        var extent = Math.Max(Extent(left.Points), Extent(right.Points));
        var epsilon = Math.Max(1e-9, extent * 1e-10);
        var leftPolygons = ToPolygons(left, epsilon, expressId);
        var rightPolygons = ToPolygons(right, epsilon, expressId);
        var a = new Node(leftPolygons, epsilon, 0);
        var b = new Node(rightPolygons, epsilon, 0);
        a.Invert();
        a.ClipTo(b);
        b.ClipTo(a);
        b.Invert();
        b.ClipTo(a);
        b.Invert();
        a.Build(b.AllPolygons(), 0);
        a.Invert();
        return ToMesh(a.AllPolygons(), epsilon, expressId);
    }

    private static List<Polygon> ToPolygons(GeneratedMesh mesh, double epsilon, int expressId)
    {
        var polygons = new List<Polygon>(mesh.Indices.Count / 3);
        for (var index = 0; index < mesh.Indices.Count; index += 3)
        {
            var vertices = new List<Vertex>(3)
            {
                Vertex.From(mesh.Points[mesh.Indices[index]]),
                Vertex.From(mesh.Points[mesh.Indices[index + 1]]),
                Vertex.From(mesh.Points[mesh.Indices[index + 2]]),
            };
            if (Polygon.TryCreate(vertices, epsilon, out var polygon)) polygons.Add(polygon!);
        }
        if (polygons.Count == 0) throw new InvalidDataException($"CSG operand for #{expressId} has no non-degenerate polygons.");
        return polygons;
    }

    private static GeneratedMesh ToMesh(List<Polygon> polygons, double epsilon, int expressId)
    {
        if (polygons.Count == 0 || polygons.Count > MaximumPolygons)
            throw new InvalidDataException($"CSG result #{expressId} has an invalid polygon count {polygons.Count:N0}.");
        var points = new List<GeneratedPoint>();
        var indices = new List<int>();
        var welder = new PointWelder(points, epsilon);
        foreach (var polygon in polygons)
        {
            if (polygon.Vertices.Count < 3) continue;
            var first = welder.Add(polygon.Vertices[0].ToPublic());
            for (var index = 1; index + 1 < polygon.Vertices.Count; index++)
            {
                var second = welder.Add(polygon.Vertices[index].ToPublic());
                var third = welder.Add(polygon.Vertices[index + 1].ToPublic());
                if (first == second || second == third || third == first) continue;
                var normal = Vertex.From(points[second]).Subtract(Vertex.From(points[first]))
                    .Cross(Vertex.From(points[third]).Subtract(Vertex.From(points[first])));
                if (normal.LengthSquared <= epsilon * epsilon * epsilon * epsilon) continue;
                indices.Add(first); indices.Add(second); indices.Add(third);
            }
        }
        if (indices.Count == 0) throw new InvalidDataException($"CSG difference #{expressId} produced no triangles.");
        return new GeneratedMesh(points, indices, indices.Count / 3, 0);
    }

    private static double Extent(IReadOnlyList<GeneratedPoint> points) => points
        .Select(point => Math.Max(Math.Abs(point.X), Math.Max(Math.Abs(point.Y), Math.Abs(point.Z))))
        .DefaultIfEmpty(1).Max();

    private sealed class Node
    {
        private readonly double _epsilon;
        private Plane? _plane;
        private readonly List<Polygon> _polygons = [];
        private Node? _front;
        private Node? _back;

        public Node(IEnumerable<Polygon> polygons, double epsilon, int depth)
        {
            _epsilon = epsilon;
            Build(polygons.ToList(), depth);
        }

        private Node(double epsilon) => _epsilon = epsilon;

        public void Invert()
        {
            foreach (var polygon in _polygons) polygon.Flip();
            _plane?.Flip();
            _front?.Invert();
            _back?.Invert();
            (_front, _back) = (_back, _front);
        }

        public List<Polygon> ClipPolygons(List<Polygon> polygons)
        {
            if (_plane is null) return [.. polygons];
            var front = new List<Polygon>();
            var back = new List<Polygon>();
            foreach (var polygon in polygons)
                _plane.SplitPolygon(polygon, front, back, front, back, _epsilon);
            if (_front is not null) front = _front.ClipPolygons(front);
            if (_back is not null) back = _back.ClipPolygons(back);
            else back.Clear();
            front.AddRange(back);
            return front;
        }

        public void ClipTo(Node other)
        {
            var clipped = other.ClipPolygons(_polygons);
            _polygons.Clear();
            _polygons.AddRange(clipped);
            _front?.ClipTo(other);
            _back?.ClipTo(other);
        }

        public List<Polygon> AllPolygons()
        {
            var result = new List<Polygon>(_polygons);
            if (_front is not null) result.AddRange(_front.AllPolygons());
            if (_back is not null) result.AddRange(_back.AllPolygons());
            return result;
        }

        public void Build(List<Polygon> polygons, int depth)
        {
            if (polygons.Count == 0) return;
            if (depth > MaximumBspDepth || polygons.Count > MaximumPolygons)
                throw new InvalidDataException("CSG BSP exceeded its bounded work limits.");
            _plane ??= polygons[0].Plane.Clone();
            var front = new List<Polygon>();
            var back = new List<Polygon>();
            foreach (var polygon in polygons)
                _plane.SplitPolygon(polygon, _polygons, _polygons, front, back, _epsilon);
            if (front.Count > 0)
            {
                _front ??= new Node(_epsilon);
                _front.Build(front, depth + 1);
            }
            if (back.Count > 0)
            {
                _back ??= new Node(_epsilon);
                _back.Build(back, depth + 1);
            }
        }
    }

    private sealed class Polygon
    {
        private Polygon(List<Vertex> vertices, Plane plane) { Vertices = vertices; Plane = plane; }
        public List<Vertex> Vertices { get; }
        public Plane Plane { get; private set; }
        public static bool TryCreate(List<Vertex> vertices, double epsilon, out Polygon? polygon)
        {
            polygon = null;
            if (vertices.Count < 3) return false;
            for (var index = 2; index < vertices.Count; index++)
            {
                var normal = vertices[1].Subtract(vertices[0]).Cross(vertices[index].Subtract(vertices[0]));
                if (normal.LengthSquared <= epsilon * epsilon * epsilon * epsilon) continue;
                normal = normal.Normalize();
                polygon = new Polygon(vertices, new Plane(normal, normal.Dot(vertices[0])));
                return true;
            }
            return false;
        }
        public void Flip()
        {
            Vertices.Reverse();
            Plane.Flip();
        }
    }

    private sealed class Plane(Vertex normal, double w)
    {
        private const int Coplanar = 0;
        private const int Front = 1;
        private const int Back = 2;
        private const int Spanning = 3;
        public Vertex Normal { get; private set; } = normal;
        public double W { get; private set; } = w;
        public Plane Clone() => new(Normal, W);
        public void Flip() { Normal = Normal.Scale(-1); W = -W; }

        public void SplitPolygon(
            Polygon polygon,
            List<Polygon> coplanarFront,
            List<Polygon> coplanarBack,
            List<Polygon> front,
            List<Polygon> back,
            double epsilon)
        {
            var polygonType = Coplanar;
            var types = new int[polygon.Vertices.Count];
            for (var index = 0; index < polygon.Vertices.Count; index++)
            {
                var distance = Normal.Dot(polygon.Vertices[index]) - W;
                var type = distance < -epsilon ? Back : distance > epsilon ? Front : Coplanar;
                polygonType |= type;
                types[index] = type;
            }
            switch (polygonType)
            {
                case Coplanar:
                    (Normal.Dot(polygon.Plane.Normal) > 0 ? coplanarFront : coplanarBack).Add(polygon);
                    break;
                case Front:
                    front.Add(polygon);
                    break;
                case Back:
                    back.Add(polygon);
                    break;
                case Spanning:
                    var frontVertices = new List<Vertex>();
                    var backVertices = new List<Vertex>();
                    for (var index = 0; index < polygon.Vertices.Count; index++)
                    {
                        var next = (index + 1) % polygon.Vertices.Count;
                        var currentType = types[index];
                        var nextType = types[next];
                        var current = polygon.Vertices[index];
                        var following = polygon.Vertices[next];
                        if (currentType != Back) frontVertices.Add(current);
                        if (currentType != Front) backVertices.Add(current);
                        if ((currentType | nextType) != Spanning) continue;
                        var direction = following.Subtract(current);
                        var denominator = Normal.Dot(direction);
                        if (Math.Abs(denominator) <= epsilon * 1e-4) continue;
                        var t = (W - Normal.Dot(current)) / denominator;
                        var split = current.Lerp(following, t);
                        frontVertices.Add(split);
                        backVertices.Add(split);
                    }
                    if (Polygon.TryCreate(frontVertices, epsilon, out var frontPolygon)) front.Add(frontPolygon!);
                    if (Polygon.TryCreate(backVertices, epsilon, out var backPolygon)) back.Add(backPolygon!);
                    break;
            }
        }
    }

    private readonly record struct Vertex(double X, double Y, double Z)
    {
        public double LengthSquared => X * X + Y * Y + Z * Z;
        public Vertex Subtract(Vertex other) => new(X - other.X, Y - other.Y, Z - other.Z);
        public Vertex Scale(double value) => new(X * value, Y * value, Z * value);
        public double Dot(Vertex other) => X * other.X + Y * other.Y + Z * other.Z;
        public Vertex Cross(Vertex other) => new(Y * other.Z - Z * other.Y, Z * other.X - X * other.Z, X * other.Y - Y * other.X);
        public Vertex Normalize() => Scale(1 / Math.Sqrt(LengthSquared));
        public Vertex Lerp(Vertex other, double t) => new(X + (other.X - X) * t, Y + (other.Y - Y) * t, Z + (other.Z - Z) * t);
        public GeneratedPoint ToPublic() => new(X, Y, Z);
        public static Vertex From(GeneratedPoint point) => new(point.X, point.Y, point.Z);
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
