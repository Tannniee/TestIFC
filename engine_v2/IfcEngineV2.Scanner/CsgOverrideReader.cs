using System.Text;

namespace IfcEngineV2.Scanner;

internal static class CsgOverrideReader
{
    private const long MaximumBytes = 512L * 1024 * 1024;
    private const int MaximumMeshes = 50_000;
    private const int MaximumVerticesPerMesh = 1_000_000;
    private const int MaximumTrianglesPerMesh = 2_000_000;

    public static IReadOnlyDictionary<int, GeneratedMesh> Read(string path, byte[] sourceSha256)
    {
        using var stream = new FileStream(Path.GetFullPath(path), FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length < 44 || stream.Length > MaximumBytes)
            throw new InvalidDataException("CSG override file has an invalid size.");
        using var reader = new BinaryReader(stream, Encoding.ASCII, leaveOpen: true);
        if (!reader.ReadBytes(8).AsSpan().SequenceEqual("IFCOVR01"u8))
            throw new InvalidDataException("CSG override file has an invalid header.");
        if (!reader.ReadBytes(32).AsSpan().SequenceEqual(sourceSha256))
            throw new InvalidDataException("CSG override source hash does not match the IFC.");
        var count = reader.ReadInt32();
        if (count < 0 || count > MaximumMeshes)
            throw new InvalidDataException("CSG override mesh count exceeds its safety limit.");
        var meshes = new Dictionary<int, GeneratedMesh>(count);
        for (var meshIndex = 0; meshIndex < count; meshIndex++)
        {
            var id = reader.ReadInt32();
            var vertexCount = reader.ReadInt32();
            var triangleCount = reader.ReadInt32();
            if (id <= 0 || vertexCount > MaximumVerticesPerMesh || triangleCount > MaximumTrianglesPerMesh ||
                !((vertexCount == 0 && triangleCount == 0) || (vertexCount >= 3 && triangleCount >= 1)))
                throw new InvalidDataException($"CSG override #{id} has invalid mesh dimensions.");
            var expectedBytes = checked((long)vertexCount * 24 + (long)triangleCount * 12);
            if (stream.Length - stream.Position < expectedBytes)
                throw new InvalidDataException($"CSG override #{id} is truncated.");
            var points = new GeneratedPoint[vertexCount];
            for (var vertex = 0; vertex < vertexCount; vertex++)
            {
                var point = new GeneratedPoint(reader.ReadDouble(), reader.ReadDouble(), reader.ReadDouble());
                if (!point.IsFinite) throw new InvalidDataException($"CSG override #{id} has non-finite coordinates.");
                points[vertex] = point;
            }
            var indices = new int[checked(triangleCount * 3)];
            for (var triangle = 0; triangle < triangleCount; triangle++)
            {
                var a = reader.ReadInt32();
                var b = reader.ReadInt32();
                var c = reader.ReadInt32();
                if ((uint)a >= (uint)vertexCount || (uint)b >= (uint)vertexCount ||
                    (uint)c >= (uint)vertexCount || a == b || b == c || c == a)
                    throw new InvalidDataException($"CSG override #{id} has an invalid triangle.");
                indices[triangle * 3] = a;
                indices[triangle * 3 + 1] = b;
                indices[triangle * 3 + 2] = c;
            }
            if (!meshes.TryAdd(id, new GeneratedMesh(points, indices, triangleCount, 0)))
                throw new InvalidDataException($"CSG override #{id} is duplicated.");
        }
        if (stream.Position != stream.Length)
            throw new InvalidDataException("CSG override file has trailing bytes.");
        return meshes;
    }
}
