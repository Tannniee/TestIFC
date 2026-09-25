// Derived from Mapbox Earcut 3.2.3, with compatibility behavior aligned to the
// earcut.hpp 2.2.4 revision used by WebIFC 0.0.77. Copyright (c) 2026, Mapbox.
// ISC license; see engine_v2/THIRD_PARTY_NOTICES.md.

namespace IfcEngineV2.Scanner;

internal static class EarcutTriangulator
{
    public static void Triangulate(IReadOnlyList<double> coordinates, IReadOnlyList<int> holeIndices, List<int> triangles)
    {
        triangles.Clear();
        var hasHoles = holeIndices.Count > 0;
        var outerLength = hasHoles ? holeIndices[0] * 2 : coordinates.Count;
        var outer = LinkedList(coordinates, 0, outerLength, true);
        if (outer is null || outer.Next == outer.Prev) return;
        if (hasHoles) outer = EliminateHoles(coordinates, holeIndices, outer);
        EarcutLinked(outer, triangles, 0);
    }

    public static double Deviation(IReadOnlyList<double> coordinates, IReadOnlyList<int> holeIndices, IReadOnlyList<int> triangles)
    {
        var hasHoles = holeIndices.Count > 0;
        var outerLength = hasHoles ? holeIndices[0] * 2 : coordinates.Count;
        var polygonArea = Math.Abs(SignedArea(coordinates, 0, outerLength));
        for (var index = 0; index < holeIndices.Count; index++)
        {
            var start = holeIndices[index] * 2;
            var end = index < holeIndices.Count - 1 ? holeIndices[index + 1] * 2 : coordinates.Count;
            polygonArea -= Math.Abs(SignedArea(coordinates, start, end));
        }

        var triangleArea = 0d;
        for (var index = 0; index < triangles.Count; index += 3)
        {
            var a = triangles[index] * 2;
            var b = triangles[index + 1] * 2;
            var c = triangles[index + 2] * 2;
            triangleArea += Math.Abs(
                (coordinates[a] - coordinates[c]) * (coordinates[b + 1] - coordinates[a + 1]) -
                (coordinates[a] - coordinates[b]) * (coordinates[c + 1] - coordinates[a + 1]));
        }
        return polygonArea == 0 && triangleArea == 0
            ? 0
            : Math.Abs((triangleArea - polygonArea) / polygonArea);
    }

    private static Node? LinkedList(IReadOnlyList<double> data, int start, int end, bool clockwise)
    {
        Node? last = null;
        if (clockwise == (SignedArea(data, start, end) > 0))
        {
            for (var index = start; index < end; index += 2)
                last = InsertNode(index / 2, data[index], data[index + 1], last);
        }
        else
        {
            for (var index = end - 2; index >= start; index -= 2)
                last = InsertNode(index / 2, data[index], data[index + 1], last);
        }
        if (last is not null && Equals(last, last.Next))
        {
            RemoveNode(last);
            last = last.Next;
        }
        return last;
    }

    private static Node? FilterPoints(Node? start, Node? end = null)
    {
        if (start is null) return null;
        end ??= start;
        var current = start;
        bool again;
        do
        {
            again = false;
            if (!current.Steiner && (Equals(current, current.Next) || Area(current.Prev, current, current.Next) == 0))
            {
                RemoveNode(current);
                current = end = current.Prev;
                if (current == current.Next) break;
                again = true;
            }
            else
            {
                current = current.Next;
            }
        } while (again || current != end);
        return end;
    }

    private static void EarcutLinked(Node? ear, List<int> triangles, int pass)
    {
        if (ear is null) return;
        var stop = ear;
        while (ear.Prev != ear.Next)
        {
            var previous = ear.Prev;
            var next = ear.Next;
            if (IsEar(ear))
            {
                triangles.Add(previous.Index);
                triangles.Add(ear.Index);
                triangles.Add(next.Index);
                RemoveNode(ear);
                ear = next.Next;
                stop = next.Next;
                continue;
            }
            ear = next;
            if (ear != stop) continue;
            if (pass == 0)
            {
                EarcutLinked(FilterPoints(ear), triangles, 1);
            }
            else if (pass == 1)
            {
                ear = CureLocalIntersections(FilterPoints(ear)!, triangles);
                EarcutLinked(ear, triangles, 2);
            }
            else
            {
                SplitEarcut(ear, triangles);
            }
            break;
        }
    }

    private static bool IsEar(Node ear)
    {
        var a = ear.Prev;
        var b = ear;
        var c = ear.Next;
        if (Area(a, b, c) >= 0) return false;
        var minX = Math.Min(a.X, Math.Min(b.X, c.X));
        var minY = Math.Min(a.Y, Math.Min(b.Y, c.Y));
        var maxX = Math.Max(a.X, Math.Max(b.X, c.X));
        var maxY = Math.Max(a.Y, Math.Max(b.Y, c.Y));
        var point = c.Next;
        while (point != a)
        {
            if (point.X >= minX && point.X <= maxX && point.Y >= minY && point.Y <= maxY &&
                PointInTriangle(a.X, a.Y, b.X, b.Y, c.X, c.Y, point.X, point.Y) &&
                Area(point.Prev, point, point.Next) >= 0)
            {
                return false;
            }
            point = point.Next;
        }
        return true;
    }

    private static Node CureLocalIntersections(Node start, List<int> triangles)
    {
        var current = start;
        do
        {
            var a = current.Prev;
            var b = current.Next.Next;
            if (!Equals(a, b) && Intersects(a, current, current.Next, b) && LocallyInside(a, b) && LocallyInside(b, a))
            {
                triangles.Add(a.Index);
                triangles.Add(current.Index);
                triangles.Add(b.Index);
                RemoveNode(current);
                RemoveNode(current.Next);
                current = start = b;
            }
            current = current.Next;
        } while (current != start);
        return FilterPoints(current)!;
    }

    private static void SplitEarcut(Node start, List<int> triangles)
    {
        var a = start;
        do
        {
            var b = a.Next.Next;
            while (b != a.Prev)
            {
                if (a.Index != b.Index && IsValidDiagonal(a, b))
                {
                    var c = SplitPolygon(a, b);
                    a = FilterPoints(a, a.Next)!;
                    c = FilterPoints(c, c.Next)!;
                    EarcutLinked(a, triangles, 0);
                    EarcutLinked(c, triangles, 0);
                    return;
                }
                b = b.Next;
            }
            a = a.Next;
        } while (a != start);
    }

    private static Node EliminateHoles(IReadOnlyList<double> data, IReadOnlyList<int> holes, Node outer)
    {
        var queue = new List<Node>(holes.Count);
        for (var index = 0; index < holes.Count; index++)
        {
            var start = holes[index] * 2;
            var end = index < holes.Count - 1 ? holes[index + 1] * 2 : data.Count;
            var list = LinkedList(data, start, end, false)!;
            if (list == list.Next) list.Steiner = true;
            queue.Add(GetLeftmost(list));
        }
        queue.Sort(static (a, b) => a.X.CompareTo(b.X));
        foreach (var hole in queue) outer = EliminateHole(hole, outer);
        return outer;
    }

    private static Node EliminateHole(Node hole, Node outer)
    {
        var bridge = FindHoleBridge(hole, outer);
        if (bridge is null) return outer;
        var reverse = SplitPolygon(bridge, hole);
        FilterPoints(reverse, reverse.Next);
        return FilterPoints(bridge, bridge.Next)!;
    }

    private static Node? FindHoleBridge(Node hole, Node outer)
    {
        var current = outer;
        var hx = hole.X;
        var hy = hole.Y;
        var intersectionX = double.NegativeInfinity;
        Node? bridge = null;
        do
        {
            if (hy <= current.Y && hy >= current.Next.Y && current.Next.Y != current.Y)
            {
                var x = current.X + (hy - current.Y) * (current.Next.X - current.X) / (current.Next.Y - current.Y);
                if (x <= hx && x > intersectionX)
                {
                    intersectionX = x;
                    bridge = current.X < current.Next.X ? current : current.Next;
                    if (x == hx) return bridge;
                }
            }
            current = current.Next;
        } while (current != outer);
        if (bridge is null) return null;

        var stop = bridge;
        var bridgeX = bridge.X;
        var bridgeY = bridge.Y;
        var minimumTangent = double.PositiveInfinity;
        current = bridge;
        do
        {
            if (hx >= current.X && current.X >= bridgeX && hx != current.X &&
                PointInTriangle(
                    hy < bridgeY ? hx : intersectionX,
                    hy,
                    bridgeX,
                    bridgeY,
                    hy < bridgeY ? intersectionX : hx,
                    hy,
                    current.X,
                    current.Y))
            {
                var tangent = Math.Abs(hy - current.Y) / (hx - current.X);
                if (LocallyInside(current, hole) &&
                    (tangent < minimumTangent || tangent == minimumTangent &&
                        (current.X > bridge.X || current.X == bridge.X && SectorContainsSector(bridge, current))))
                {
                    bridge = current;
                    minimumTangent = tangent;
                }
            }
            current = current.Next;
        } while (current != stop);
        return bridge;
    }

    private static bool SectorContainsSector(Node a, Node b) =>
        Area(a.Prev, a, b.Prev) < 0 && Area(b.Next, a, a.Next) < 0;

    private static Node GetLeftmost(Node start)
    {
        var current = start;
        var leftmost = start;
        do
        {
            if (current.X < leftmost.X || current.X == leftmost.X && current.Y < leftmost.Y) leftmost = current;
            current = current.Next;
        } while (current != start);
        return leftmost;
    }

    private static bool PointInTriangle(double ax, double ay, double bx, double by, double cx, double cy, double px, double py) =>
        (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
        (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
        (bx - px) * (cy - py) >= (cx - px) * (by - py);

    private static bool IsValidDiagonal(Node a, Node b)
    {
        var zeroLength = Equals(a, b) && Area(a.Prev, a, a.Next) > 0 && Area(b.Prev, b, b.Next) > 0;
        return a.Next.Index != b.Index && a.Prev.Index != b.Index &&
               !IntersectsPolygon(a, b) &&
               (zeroLength || LocallyInside(a, b) && LocallyInside(b, a) && MiddleInside(a, b) &&
                   (Area(a.Prev, a, b.Prev) != 0 || Area(a, b.Prev, b) != 0));
    }

    private static double Area(Node p, Node q, Node r) =>
        (q.Y - p.Y) * (r.X - q.X) - (q.X - p.X) * (r.Y - q.Y);

    private static bool Equals(Node a, Node b) => a.X == b.X && a.Y == b.Y;

    private static bool Intersects(Node p1, Node q1, Node p2, Node q2)
    {
        var o1 = Math.Sign(Area(p1, q1, p2));
        var o2 = Math.Sign(Area(p1, q1, q2));
        var o3 = Math.Sign(Area(p2, q2, p1));
        var o4 = Math.Sign(Area(p2, q2, q1));
        if (o1 != o2 && o3 != o4) return true;
        if (o1 == 0 && OnSegment(p1, p2, q1)) return true;
        if (o2 == 0 && OnSegment(p1, q2, q1)) return true;
        if (o3 == 0 && OnSegment(p2, p1, q2)) return true;
        return o4 == 0 && OnSegment(p2, q1, q2);
    }

    private static bool OnSegment(Node p, Node q, Node r) =>
        q.X <= Math.Max(p.X, r.X) && q.X >= Math.Min(p.X, r.X) &&
        q.Y <= Math.Max(p.Y, r.Y) && q.Y >= Math.Min(p.Y, r.Y);

    private static bool IntersectsPolygon(Node a, Node b)
    {
        var current = a;
        do
        {
            if (current.Index != a.Index && current.Next.Index != a.Index &&
                current.Index != b.Index && current.Next.Index != b.Index &&
                Intersects(current, current.Next, a, b)) return true;
            current = current.Next;
        } while (current != a);
        return false;
    }

    private static bool LocallyInside(Node a, Node b) =>
        Area(a.Prev, a, a.Next) < 0
            ? Area(a, b, a.Next) >= 0 && Area(a, a.Prev, b) >= 0
            : Area(a, b, a.Prev) < 0 || Area(a, a.Next, b) < 0;

    private static bool MiddleInside(Node a, Node b)
    {
        var current = a;
        var inside = false;
        var x = (a.X + b.X) / 2;
        var y = (a.Y + b.Y) / 2;
        do
        {
            if ((current.Y > y) != (current.Next.Y > y) && current.Next.Y != current.Y &&
                x < (current.Next.X - current.X) * (y - current.Y) / (current.Next.Y - current.Y) + current.X)
            {
                inside = !inside;
            }
            current = current.Next;
        } while (current != a);
        return inside;
    }

    private static Node SplitPolygon(Node a, Node b)
    {
        var a2 = new Node(a.Index, a.X, a.Y);
        var b2 = new Node(b.Index, b.X, b.Y);
        var aNext = a.Next;
        var bPrevious = b.Prev;
        a.Next = b;
        b.Prev = a;
        a2.Next = aNext;
        aNext.Prev = a2;
        b2.Next = a2;
        a2.Prev = b2;
        bPrevious.Next = b2;
        b2.Prev = bPrevious;
        return b2;
    }

    private static Node InsertNode(int index, double x, double y, Node? last)
    {
        var node = new Node(index, x, y);
        if (last is null)
        {
            node.Prev = node;
            node.Next = node;
        }
        else
        {
            node.Next = last.Next;
            node.Prev = last;
            last.Next.Prev = node;
            last.Next = node;
        }
        return node;
    }

    private static void RemoveNode(Node node)
    {
        node.Next.Prev = node.Prev;
        node.Prev.Next = node.Next;
    }

    private static double SignedArea(IReadOnlyList<double> data, int start, int end)
    {
        var sum = 0d;
        for (int index = start, previous = end - 2; index < end; index += 2)
        {
            sum += (data[previous] - data[index]) * (data[index + 1] + data[previous + 1]);
            previous = index;
        }
        return sum;
    }

    private sealed class Node(int index, double x, double y)
    {
        public int Index { get; } = index;
        public double X { get; } = x;
        public double Y { get; } = y;
        public Node Prev { get; set; } = null!;
        public Node Next { get; set; } = null!;
        public bool Steiner { get; set; }
    }
}
