using System.Buffers.Binary;
using System.Collections;
using System.IO.MemoryMappedFiles;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace IfcEngineV2.Scanner;

internal static class TessellationChunkWriter
{
    private const int ChunkHeaderBytes = 32;
    private const ushort ChunkVersion = 1;
    private const ushort PositionChunkKind = 1;
    private const ushort MeshChunkKind = 2;
    private const ushort IndexChunkKind = 3;
    private const ushort InstanceChunkKind = 4;
    private const ushort ProductChunkKind = 5;
    private const ushort MaterialChunkKind = 6;
    private const ushort InstanceMaterialChunkKind = 7;
    private const ushort TriangleNormalChunkKind = 8;
    private const ushort HighPrecisionPositionChunkKind = 9;
    private const ushort SemanticRecordChunkKind = 10;
    private const ushort SemanticStringChunkKind = 11;
    private const ushort DeepSemanticIndexChunkKind = 12;
    private const ushort DeepSemanticValueChunkKind = 13;
    private const double MaximumAllowedDeviation = 1e-8;
    private const double WebIfcTriangleNormalTolerance = 1e-10;
    private static readonly byte[] ChunkMagic = "IFCV2CHK"u8.ToArray();

    public static unsafe TessellationArtifactManifest Write(
        string sourcePath,
        string indexPath,
        string outputDirectory,
        long sourceLength,
        long maximumExpressId,
        string sourceSha256,
        TypeRegistry registry,
        int[] occurrenceCounts,
        int[] representativeProductIds,
        int[] productDefinitionIdsByProduct,
        GraphCoverageLedger coverage,
        IReadOnlyDictionary<int, GeneratedMesh> generatedMeshes)
    {
        if (coverage.Status != "complete" || coverage.GeometryPlan.Status != "complete")
        {
            throw new InvalidDataException("Tessellation requires complete graph and geometry-plan coverage.");
        }
        if (occurrenceCounts.Length != checked((int)maximumExpressId + 1))
        {
            throw new InvalidDataException("Base-definition occurrence ledger has the wrong Express-ID range.");
        }
        if (representativeProductIds.Length != occurrenceCounts.Length)
        {
            throw new InvalidDataException("Representative-product ledger has the wrong Express-ID range.");
        }
        if (productDefinitionIdsByProduct.Length != occurrenceCounts.Length)
        {
            throw new InvalidDataException("Product-to-definition ledger has the wrong Express-ID range.");
        }

        var finalDirectory = Path.GetFullPath(outputDirectory);
        if (Directory.Exists(finalDirectory) || File.Exists(finalDirectory))
        {
            throw new IOException($"Tessellation output already exists: {finalDirectory}");
        }
        var parent = Path.GetDirectoryName(finalDirectory) ?? Directory.GetCurrentDirectory();
        Directory.CreateDirectory(parent);
        var partialDirectory = Path.Combine(parent, $".{Path.GetFileName(finalDirectory)}.{Guid.NewGuid():N}.partial");
        Directory.CreateDirectory(partialDirectory);

        try
        {
            using var sourceMap = MemoryMappedFile.CreateFromFile(sourcePath, FileMode.Open, null, 0, MemoryMappedFileAccess.Read);
            using var sourceView = sourceMap.CreateViewAccessor(0, sourceLength, MemoryMappedFileAccess.Read);
            var indexLength = new FileInfo(indexPath).Length;
            using var indexMap = MemoryMappedFile.CreateFromFile(indexPath, FileMode.Open, null, 0, MemoryMappedFileAccess.Read);
            using var indexView = indexMap.CreateViewAccessor(0, indexLength, MemoryMappedFileAccess.Read);
            byte* sourcePointer = null;
            byte* indexPointer = null;
            sourceView.SafeMemoryMappedViewHandle.AcquirePointer(ref sourcePointer);
            indexView.SafeMemoryMappedViewHandle.AcquirePointer(ref indexPointer);
            TessellationBuildResult build;
            try
            {
                sourcePointer += sourceView.PointerOffset;
                indexPointer += indexView.PointerOffset;
                var source = new ReadOnlySpan<byte>(sourcePointer, checked((int)sourceLength));
                var index = new ReadOnlySpan<byte>(indexPointer, checked((int)indexLength));
                var entries = GraphCoverageAnalyzer.ValidateIndex(index, sourceLength, Convert.FromHexString(sourceSha256), maximumExpressId);
                var points = PointTable.Build(source, entries, maximumExpressId, registry);
                build = WriteChunks(
                    partialDirectory,
                    source,
                    entries,
                    registry,
                    points,
                    occurrenceCounts,
                    representativeProductIds,
                    productDefinitionIdsByProduct,
                    coverage,
                    generatedMeshes);
            }
            finally
            {
                indexView.SafeMemoryMappedViewHandle.ReleasePointer();
                sourceView.SafeMemoryMappedViewHandle.ReleasePointer();
            }

            var chunks = new[]
            {
                DescribeChunk(partialDirectory, "positions.ifcv2", PositionChunkKind, build.CartesianPoints),
                DescribeChunk(partialDirectory, "meshes.ifcv2", MeshChunkKind, build.BaseDefinitions),
                DescribeChunk(partialDirectory, "indices.ifcv2", IndexChunkKind, build.Indices),
                DescribeChunk(partialDirectory, "instances.ifcv2", InstanceChunkKind, build.Instances),
                DescribeChunk(partialDirectory, "products.ifcv2", ProductChunkKind, build.Products),
                DescribeChunk(partialDirectory, "materials.ifcv2", MaterialChunkKind, build.Materials.MaterialDefinitions),
                DescribeChunk(partialDirectory, "instance-materials.ifcv2", InstanceMaterialChunkKind, build.Materials.InstanceAssignments),
                DescribeChunk(partialDirectory, "normals.ifcv2", TriangleNormalChunkKind, build.Triangles),
                DescribeChunk(partialDirectory, "positions-f64.ifcv2", HighPrecisionPositionChunkKind, build.CartesianPoints),
                DescribeChunk(partialDirectory, "semantic-records.ifcv2", SemanticRecordChunkKind, build.Semantic.Records),
                DescribeChunk(partialDirectory, "semantic-strings.ifcv2", SemanticStringChunkKind, build.Semantic.StringBytes),
                DescribeChunk(partialDirectory, "semantic-deep-index.ifcv2", DeepSemanticIndexChunkKind, build.Semantic.Deep.Records),
                DescribeChunk(partialDirectory, "semantic-deep-values.ifcv2", DeepSemanticValueChunkKind, build.Semantic.Deep.ValueBytes),
            };
            var manifest = new TessellationArtifactManifest(
                "ifc-engine-v2-tessellation",
                5,
                EngineContract.EngineVersion,
                true,
                build.Materials.Complete,
                finalDirectory,
                sourceSha256,
                "ifc-local-source-units",
                build.CartesianPoints,
                build.BaseDefinitions,
                build.Products,
                build.Instances,
                build.UniqueFaces,
                build.ExpandedFaces,
                build.Triangles,
                build.ExpandedTriangles,
                build.Indices,
                build.FastPathFaces,
                build.EarcutFaces,
                build.NonSimpleFaces,
                build.RecoveredDisjointFaces,
                build.EmptyFaces,
                build.DegenerateFaces,
                build.ContainmentRejectedFaces,
                build.MaximumAreaDeviation,
                build.LengthUnitScaleToMetres,
                build.SourceToViewerTransform,
                "float64-source-adaptive-triangle-cluster-rebase-before-float32-upload",
                "octahedral-snorm16-per-triangle",
                build.Materials.ToManifest(),
                registry.Entries.Select(entry => entry.Name).ToArray(),
                build.Semantic.ToManifest(),
                build.NonSimpleFaceDetails,
                chunks);
            WriteManifest(Path.Combine(partialDirectory, "manifest.json"), manifest);
            Directory.Move(partialDirectory, finalDirectory);
            return manifest;
        }
        catch
        {
            TryDeleteDirectory(partialDirectory);
            throw;
        }
    }

    private static TessellationBuildResult WriteChunks(
        string directory,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        PointTable points,
        int[] occurrenceCounts,
        int[] representativeProductIds,
        int[] productDefinitionIdsByProduct,
        GraphCoverageLedger coverage,
        IReadOnlyDictionary<int, GeneratedMesh> generatedMeshes)
    {
        var preparedGeneratedMeshes = PrepareGeneratedMeshes(source, entries, registry, points, occurrenceCounts, generatedMeshes);
        var positionPath = Path.Combine(directory, "positions.ifcv2");
        var highPrecisionPositionPath = Path.Combine(directory, "positions-f64.ifcv2");
        using (var stream = CreateChunkStream(positionPath))
        using (var highPrecisionStream = CreateChunkStream(highPrecisionPositionPath))
        using (var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true))
        using (var highPrecisionWriter = new BinaryWriter(highPrecisionStream, Encoding.UTF8, leaveOpen: true))
        {
            WriteEmptyHeader(writer);
            WriteEmptyHeader(highPrecisionWriter);
            for (var ordinal = 0; ordinal < points.Count; ordinal++)
            {
                var expressId = points.ExpressIdAt(ordinal);
                writer.Write(expressId);
                var point = points.AtOrdinal(ordinal);
                writer.Write(CheckedFloat(point.X, $"IfcCartesianPoint #{points.ExpressIdAt(ordinal)} X"));
                writer.Write(CheckedFloat(point.Y, $"IfcCartesianPoint #{points.ExpressIdAt(ordinal)} Y"));
                writer.Write(CheckedFloat(point.Z, $"IfcCartesianPoint #{points.ExpressIdAt(ordinal)} Z"));
                highPrecisionWriter.Write(expressId);
                highPrecisionWriter.Write(0);
                highPrecisionWriter.Write(point.X);
                highPrecisionWriter.Write(point.Y);
                highPrecisionWriter.Write(point.Z);
            }
            CompleteHeader(stream, PositionChunkKind, checked((ulong)points.Count * 16), checked((uint)points.Count));
            CompleteHeader(highPrecisionStream, HighPrecisionPositionChunkKind, checked((ulong)points.Count * 32), checked((uint)points.Count));
        }

        var meshPath = Path.Combine(directory, "meshes.ifcv2");
        var indexPath = Path.Combine(directory, "indices.ifcv2");
        var normalPath = Path.Combine(directory, "normals.ifcv2");
        using var meshStream = CreateChunkStream(meshPath);
        using var indexStream = CreateChunkStream(indexPath);
        using var normalStream = CreateChunkStream(normalPath);
        using var meshWriter = new BinaryWriter(meshStream, Encoding.UTF8, leaveOpen: true);
        using var indexWriter = new BinaryWriter(indexStream, Encoding.UTF8, leaveOpen: true);
        using var normalWriter = new BinaryWriter(normalStream, Encoding.UTF8, leaveOpen: true);
        WriteEmptyHeader(meshWriter);
        WriteEmptyHeader(indexWriter);
        WriteEmptyHeader(normalWriter);

        var context = new FaceContext(source, entries, registry, points, checked(occurrenceCounts.Length));
        var shellIds = new List<int>(2);
        var faceIds = new List<int>(64);
        var seenFaces = new BitArray(occurrenceCounts.Length);
        long baseDefinitions = 0;
        long uniqueFaces = 0;
        long expandedFaces = 0;
        long indices = 0;
        long triangles = 0;
        long expandedTriangles = 0;
        long fastPathFaces = 0;
        long earcutFaces = 0;
        long nonSimpleFaces = 0;
        long recoveredDisjointFaces = 0;
        long emptyFaces = 0;
        long degenerateFaces = 0;
        long containmentRejectedFaces = 0;
        var maximumDeviation = 0d;
        var nonSimpleFaceDetails = new List<NonSimpleFaceManifest>();
        var unrecoverableDefinitions = new List<int>();

        for (var baseId = 0; baseId < occurrenceCounts.Length; baseId++)
        {
            var occurrences = occurrenceCounts[baseId];
            if (occurrences == 0) continue;
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, baseId, out var definition, out var definitionTypeId))
            {
                throw new InvalidDataException($"Referenced base definition #{baseId} is missing from the index.");
            }
            var definitionKind = registry[definitionTypeId].Kind;
            if (preparedGeneratedMeshes.ContainsKey(baseId) ||
                definitionKind is EntityKind.ExtrudedAreaSolid or EntityKind.ExtrudedAreaSolidTapered or EntityKind.SweptDiskSolid or EntityKind.RevolvedAreaSolid or EntityKind.TriangulatedFaceSet or EntityKind.PolygonalFaceSet or
                    EntityKind.BooleanClippingResult or EntityKind.BooleanResult)
            {
                if (!preparedGeneratedMeshes.TryGetValue(baseId, out var generated))
                    throw new InvalidDataException($"Generated geometry #{baseId} was not prepared.");
                var firstGeneratedIndex = indices;
                var generatedBounds = Bounds3.Empty;
                foreach (var ordinal in generated.PointOrdinals) generatedBounds.Include(points.AtOrdinal(ordinal));
                for (var index = 0; index < generated.Indices.Count; index += 3)
                {
                    var a = generated.PointOrdinals[generated.Indices[index]];
                    var b = generated.PointOrdinals[generated.Indices[index + 1]];
                    var c = generated.PointOrdinals[generated.Indices[index + 2]];
                    indexWriter.Write(checked((uint)a));
                    indexWriter.Write(checked((uint)b));
                    indexWriter.Write(checked((uint)c));
                    var pa = points.AtOrdinal(a);
                    var pb = points.AtOrdinal(b);
                    var pc = points.AtOrdinal(c);
                    var normal = new Vector3(pb.X - pa.X, pb.Y - pa.Y, pb.Z - pa.Z)
                        .Cross(new Vector3(pc.X - pa.X, pc.Y - pa.Y, pc.Z - pa.Z));
                    WriteOctahedralNormal(normalWriter, normal);
                }
                var generatedIndexCount = generated.Indices.Count;
                indices = checked(indices + generatedIndexCount);
                var generatedTriangles = generatedIndexCount / 3;
                triangles = checked(triangles + generatedTriangles);
                expandedTriangles = checked(expandedTriangles + (long)generatedTriangles * occurrences);
                uniqueFaces = checked(uniqueFaces + generated.FaceCount);
                expandedFaces = checked(expandedFaces + (long)generated.FaceCount * occurrences);
                earcutFaces += generated.EarcutFaces;
                fastPathFaces += generated.FaceCount - generated.EarcutFaces;
                WriteMeshRecord(
                    meshWriter,
                    baseId,
                    representativeProductIds[baseId],
                    occurrences,
                    firstGeneratedIndex,
                    generatedIndexCount,
                    generated.FaceCount,
                    generatedBounds);
                baseDefinitions++;
                continue;
            }
            ResolveFaceSets(definition, registry[definitionTypeId].Kind, baseId, shellIds);
            var firstIndex = indices;
            var faceCount = 0;
            var bounds = Bounds3.Empty;
            var unrecoverable = false;
            foreach (var shellId in shellIds)
            {
                if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, shellId, out var shell, out var shellTypeId) ||
                    registry[shellTypeId].Kind is not (EntityKind.ClosedShell or EntityKind.OpenShell or EntityKind.ConnectedFaceSet) ||
                    !StepParsing.TryGetTopLevelArgument(shell, 0, out var facesArgument))
                {
                    throw new InvalidDataException($"Base definition #{baseId} references invalid shell #{shellId}.");
                }
                StepParsing.CollectReferences(facesArgument, faceIds);
                foreach (var faceId in faceIds)
                {
                    FaceResult result;
                    try
                    {
                        result = context.Triangulate(faceId, indexWriter, normalWriter, ref bounds);
                    }
                    catch (InvalidDataException)
                    {
                        unrecoverable = true;
                        break;
                    }
                    if (result.ContainmentRejected || (result.Empty && result.NonSimple))
                    {
                        unrecoverable = true;
                        break;
                    }
                    faceCount++;
                    indices = checked(indices + result.IndexCount);
                    triangles = checked(triangles + result.IndexCount / 3);
                    if (result.UsedEarcut) earcutFaces++;
                    else fastPathFaces++;
                    if (result.NonSimple) nonSimpleFaces++;
                    if (result.RecoveredIslands > 0) recoveredDisjointFaces++;
                    if (result.Empty) emptyFaces++;
                    if (result.Degenerate) degenerateFaces++;
                    if (result.ContainmentRejected) containmentRejectedFaces++;
                    if (result.NonSimple)
                    {
                        nonSimpleFaceDetails.Add(new NonSimpleFaceManifest(
                            baseId,
                            representativeProductIds[baseId],
                            faceId,
                            occurrences,
                            result.Vertices,
                            result.Holes,
                            result.IndexCount / 3,
                            result.Empty,
                            result.ContainmentRejected,
                            result.RecoveredIslands));
                    }
                    maximumDeviation = Math.Max(maximumDeviation, result.AreaDeviation);
                    if (!seenFaces[faceId])
                    {
                        seenFaces[faceId] = true;
                        uniqueFaces++;
                    }
                }
                if (unrecoverable) break;
            }
            if (unrecoverable)
            {
                unrecoverableDefinitions.Add(baseId);
                continue;
            }
            if (faceCount == 0 || !bounds.IsValid)
            {
                throw new InvalidDataException($"Base definition #{baseId} produced no valid faces.");
            }
            expandedFaces = checked(expandedFaces + (long)faceCount * occurrences);
            expandedTriangles = checked(expandedTriangles + (indices - firstIndex) / 3 * occurrences);
            WriteMeshRecord(
                meshWriter,
                baseId,
                representativeProductIds[baseId],
                occurrences,
                firstIndex,
                indices - firstIndex,
                faceCount,
                bounds);
            baseDefinitions++;
        }

        if (unrecoverableDefinitions.Count > 0)
        {
            throw new InvalidDataException("Bounded faces in " +
                string.Join("; ", unrecoverableDefinitions.Select(id => $"base definition #{id}")) +
                " cannot be triangulated without losing surface geometry.");
        }
        if (baseDefinitions != coverage.UniqueBaseDefinitionsReferenced)
        {
            throw new InvalidDataException($"Base-definition coverage mismatch: expected {coverage.UniqueBaseDefinitionsReferenced:N0}, wrote {baseDefinitions:N0}.");
        }
        if (maximumDeviation > MaximumAllowedDeviation)
        {
            throw new InvalidDataException($"Maximum triangulation area deviation {maximumDeviation:G17} exceeds {MaximumAllowedDeviation:G17}.");
        }
        CompleteHeader(meshStream, MeshChunkKind, checked((ulong)baseDefinitions * 56), checked((uint)baseDefinitions));
        CompleteHeader(indexStream, IndexChunkKind, checked((ulong)indices * 4), checked((uint)indices));
        CompleteHeader(normalStream, TriangleNormalChunkKind, checked((ulong)triangles * 4), checked((uint)triangles));
        var instances = InstanceChunkWriter.Write(directory, source, entries, registry, productDefinitionIdsByProduct, coverage);
        var semantic = SemanticChunkWriter.Write(
            directory, source, entries, registry, productDefinitionIdsByProduct, instances.LengthUnitScaleToMetres);
        return new TessellationBuildResult(
            points.Count,
            baseDefinitions,
            instances.Products,
            instances.Instances,
            uniqueFaces,
            expandedFaces,
            triangles,
            expandedTriangles,
            indices,
            fastPathFaces,
            earcutFaces,
            nonSimpleFaces,
            recoveredDisjointFaces,
            emptyFaces,
            degenerateFaces,
            containmentRejectedFaces,
            maximumDeviation,
            instances.LengthUnitScaleToMetres,
            instances.SourceToViewerTransform,
            instances.Materials,
            semantic,
            nonSimpleFaceDetails);
    }

    private static Dictionary<int, PreparedGeneratedMesh> PrepareGeneratedMeshes(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        PointTable points,
        int[] occurrenceCounts,
        IReadOnlyDictionary<int, GeneratedMesh> generatedMeshes)
    {
        var prepared = new Dictionary<int, PreparedGeneratedMesh>();
        for (var baseId = 0; baseId < occurrenceCounts.Length; baseId++)
        {
            if (occurrenceCounts[baseId] == 0 ||
                !GraphCoverageAnalyzer.TryGetRecord(source, entries, baseId, out _, out var typeId) ||
                (!generatedMeshes.ContainsKey(baseId) &&
                 registry[typeId].Kind is not (EntityKind.ExtrudedAreaSolid or EntityKind.ExtrudedAreaSolidTapered or EntityKind.SweptDiskSolid or EntityKind.RevolvedAreaSolid or EntityKind.TriangulatedFaceSet or EntityKind.PolygonalFaceSet or
                     EntityKind.BooleanClippingResult or EntityKind.BooleanResult)))
            {
                continue;
            }
            if (!generatedMeshes.TryGetValue(baseId, out var mesh))
                throw new InvalidDataException($"Resolved geometry plan is missing generated base definition #{baseId}.");
            var ordinals = new int[mesh.Points.Count];
            for (var index = 0; index < mesh.Points.Count; index++)
            {
                var point = mesh.Points[index];
                ordinals[index] = points.AppendSynthetic(new Point3(point.X, point.Y, point.Z));
            }
            prepared.Add(baseId, new PreparedGeneratedMesh(ordinals, mesh.Indices, mesh.FaceCount, mesh.EarcutFaces));
        }
        return prepared;
    }

    private static void ResolveFaceSets(ReadOnlySpan<byte> definition, EntityKind kind, int baseId, List<int> shellIds)
    {
        shellIds.Clear();
        if (kind == EntityKind.FacetedBrep)
        {
            if (!StepParsing.TryGetTopLevelArgument(definition, 0, out var shellArgument) ||
                !StepParsing.TryReadSingleReference(shellArgument, out var shellId))
            {
                throw new InvalidDataException($"IfcFacetedBrep #{baseId} has no valid Outer shell.");
            }
            shellIds.Add(shellId);
        }
        else if (kind == EntityKind.ShellBasedSurfaceModel)
        {
            if (!StepParsing.TryGetTopLevelArgument(definition, 0, out var shellsArgument))
            {
                throw new InvalidDataException($"IfcShellBasedSurfaceModel #{baseId} has no shell list.");
            }
            StepParsing.CollectReferences(shellsArgument, shellIds);
        }
        else if (kind == EntityKind.FaceBasedSurfaceModel)
        {
            if (!StepParsing.TryGetTopLevelArgument(definition, 0, out var faceSetsArgument))
            {
                throw new InvalidDataException($"IfcFaceBasedSurfaceModel #{baseId} has no face-set list.");
            }
            StepParsing.CollectReferences(faceSetsArgument, shellIds);
        }
        else
        {
            throw new InvalidDataException($"Express ID #{baseId} is not supported base geometry.");
        }
        if (shellIds.Count == 0) throw new InvalidDataException($"Base definition #{baseId} has no face sets.");
    }

    private static void WriteMeshRecord(
        BinaryWriter writer,
        int baseId,
        int representativeProductId,
        int occurrences,
        long firstIndex,
        long indexCount,
        int faceCount,
        Bounds3 bounds)
    {
        writer.Write(baseId);
        writer.Write(representativeProductId);
        writer.Write(firstIndex);
        writer.Write(checked((int)indexCount));
        writer.Write(faceCount);
        writer.Write(occurrences);
        writer.Write(0);
        writer.Write(CheckedFloat(bounds.MinimumX, $"Base definition #{baseId} minimum X"));
        writer.Write(CheckedFloat(bounds.MinimumY, $"Base definition #{baseId} minimum Y"));
        writer.Write(CheckedFloat(bounds.MinimumZ, $"Base definition #{baseId} minimum Z"));
        writer.Write(CheckedFloat(bounds.MaximumX, $"Base definition #{baseId} maximum X"));
        writer.Write(CheckedFloat(bounds.MaximumY, $"Base definition #{baseId} maximum Y"));
        writer.Write(CheckedFloat(bounds.MaximumZ, $"Base definition #{baseId} maximum Z"));
    }

    private static FileStream CreateChunkStream(string path) =>
        new(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 1024 * 1024, FileOptions.SequentialScan);

    private static void WriteEmptyHeader(BinaryWriter writer) => writer.Write(new byte[ChunkHeaderBytes]);

    private static void CompleteHeader(FileStream stream, ushort kind, ulong payloadBytes, uint records)
    {
        if (checked((ulong)(stream.Length - ChunkHeaderBytes)) != payloadBytes)
        {
            throw new InvalidDataException($"Chunk kind {kind} payload length is inconsistent.");
        }
        Span<byte> header = stackalloc byte[ChunkHeaderBytes];
        ChunkMagic.CopyTo(header);
        BinaryPrimitives.WriteUInt16LittleEndian(header[8..], ChunkVersion);
        BinaryPrimitives.WriteUInt16LittleEndian(header[10..], kind);
        BinaryPrimitives.WriteUInt32LittleEndian(header[12..], ChunkHeaderBytes);
        BinaryPrimitives.WriteUInt64LittleEndian(header[16..], payloadBytes);
        BinaryPrimitives.WriteUInt32LittleEndian(header[24..], records);
        BinaryPrimitives.WriteUInt32LittleEndian(header[28..], 0);
        stream.Position = 0;
        stream.Write(header);
        stream.Flush(flushToDisk: true);
    }

    private static ChunkFileManifest DescribeChunk(string directory, string file, ushort kind, long recordCount)
    {
        var path = Path.Combine(directory, file);
        var info = new FileInfo(path);
        using var stream = File.OpenRead(path);
        return new ChunkFileManifest(
            file,
            kind,
            info.Length,
            info.Length - ChunkHeaderBytes,
            recordCount,
            Convert.ToHexString(SHA256.HashData(stream)));
    }

    private static void WriteManifest(string path, TessellationArtifactManifest manifest)
    {
        var json = JsonSerializer.Serialize(manifest, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
        });
        File.WriteAllText(path, json + Environment.NewLine, new UTF8Encoding(false));
    }

    private static float CheckedFloat(double value, string label)
    {
        if (!double.IsFinite(value) || value > float.MaxValue || value < -float.MaxValue)
        {
            throw new InvalidDataException($"{label} cannot be represented as float32.");
        }
        return (float)value;
    }

    private static void WriteOctahedralNormal(BinaryWriter writer, Vector3 normal)
    {
        var length = Math.Sqrt(normal.LengthSquared);
        if (!normal.IsFinite || length <= 0) throw new InvalidDataException("Triangle normal is not finite.");
        var x = normal.X / length;
        var y = normal.Y / length;
        var z = normal.Z / length;
        var inverseL1 = 1 / (Math.Abs(x) + Math.Abs(y) + Math.Abs(z));
        x *= inverseL1;
        y *= inverseL1;
        z *= inverseL1;
        if (z < 0)
        {
            var previousX = x;
            x = (1 - Math.Abs(y)) * SignNotZero(previousX);
            y = (1 - Math.Abs(previousX)) * SignNotZero(y);
        }
        writer.Write(QuantizeSnorm16(x));
        writer.Write(QuantizeSnorm16(y));
    }

    private static short QuantizeSnorm16(double value) =>
        checked((short)Math.Round(Math.Clamp(value, -1, 1) * short.MaxValue, MidpointRounding.AwayFromZero));

    private static double SignNotZero(double value) => value >= 0 ? 1 : -1;

    private static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path)) Directory.Delete(path, true); }
        catch { }
    }

    private ref struct FaceContext
    {
        private readonly ReadOnlySpan<byte> _source;
        private readonly ReadOnlySpan<byte> _entries;
        private readonly TypeRegistry _registry;
        private readonly PointTable _points;
        private readonly int _expressIdRange;
        private readonly List<int> _boundIds;
        private readonly List<int> _pointIds;
        private readonly List<Vertex3> _currentRing;
        private readonly List<Vertex3> _outer;
        private readonly List<Vertex3> _holes;
        private readonly List<int> _holeBufferStarts;
        private readonly List<int> _holeStarts;
        private readonly List<int> _flatOrdinals;
        private readonly List<double> _coordinates;
        private readonly List<int> _triangles;

        public FaceContext(
            ReadOnlySpan<byte> source,
            ReadOnlySpan<byte> entries,
            TypeRegistry registry,
            PointTable points,
            int expressIdRange)
        {
            _source = source;
            _entries = entries;
            _registry = registry;
            _points = points;
            _expressIdRange = expressIdRange;
            _boundIds = new List<int>(4);
            _pointIds = new List<int>(16);
            _currentRing = new List<Vertex3>(16);
            _outer = new List<Vertex3>(16);
            _holes = new List<Vertex3>(8);
            _holeBufferStarts = new List<int>(2);
            _holeStarts = new List<int>(2);
            _flatOrdinals = new List<int>(24);
            _coordinates = new List<double>(48);
            _triangles = new List<int>(48);
        }

        public FaceResult Triangulate(int faceId, BinaryWriter indexWriter, BinaryWriter normalWriter, ref Bounds3 meshBounds)
        {
            if ((uint)faceId >= (uint)_expressIdRange ||
                !GraphCoverageAnalyzer.TryGetRecord(_source, _entries, faceId, out var face, out var faceTypeId) ||
                _registry[faceTypeId].Kind != EntityKind.Face ||
                !StepParsing.TryGetTopLevelArgument(face, 0, out var boundsArgument))
            {
                throw new InvalidDataException($"Shell references invalid IfcFace #{faceId}.");
            }
            StepParsing.CollectReferences(boundsArgument, _boundIds);
            _outer.Clear();
            _holes.Clear();
            _holeBufferStarts.Clear();
            var outerCount = 0;
            foreach (var boundId in _boundIds)
            {
                if (!GraphCoverageAnalyzer.TryGetRecord(_source, _entries, boundId, out var bound, out var boundTypeId))
                {
                    throw new InvalidDataException($"IfcFace #{faceId} references missing bound #{boundId}.");
                }
                var boundKind = _registry[boundTypeId].Kind;
                var isOuter = boundKind == EntityKind.FaceOuterBound;
                if (!isOuter && boundKind != EntityKind.FaceBound)
                {
                    throw new InvalidDataException($"IfcFace #{faceId} references unsupported bound #{boundId}.");
                }
                if (!StepParsing.TryGetTopLevelArgument(bound, 0, out var loopArgument) ||
                    !StepParsing.TryReadSingleReference(loopArgument, out var loopId) ||
                    !StepParsing.TryGetTopLevelArgument(bound, 1, out var orientationArgument) ||
                    !StepParsing.TryParseLogical(orientationArgument, out var orientation))
                {
                    throw new InvalidDataException($"IfcFaceBound #{boundId} is malformed.");
                }
                var collapsed = LoadRing(loopId, faceId);
                if (collapsed)
                {
                    if (isOuter && _boundIds.Count == 1)
                        return new FaceResult(0, false, false, true, true, false, _pointIds.Count, 0, 0, 0);
                    throw new InvalidDataException($"IfcPolyLoop #{loopId} collapses inside a bounded face.");
                }
                if (!orientation) _currentRing.Reverse();
                if (isOuter)
                {
                    outerCount++;
                    _outer.AddRange(_currentRing);
                }
                else
                {
                    _holeBufferStarts.Add(_holes.Count);
                    _holes.AddRange(_currentRing);
                }
            }
            if (outerCount != 1 || _outer.Count < 3)
            {
                throw new InvalidDataException($"IfcFace #{faceId} has {outerCount} valid outer bounds; expected one.");
            }

            var normal = Newell(_outer);
            foreach (var vertex in _outer) meshBounds.Include(vertex.Point);
            foreach (var vertex in _holes) meshBounds.Include(vertex.Point);
            if (_holeBufferStarts.Count == 1 && SameBoundary(_outer, _holes))
            {
                // A hole with precisely the same closed boundary removes the
                // entire face. It contributes no surface or triangle normals.
                return new FaceResult(0, false, false, true, true, false,
                    _outer.Count + _holes.Count, 1, 0, 0);
            }
            if (!normal.IsFinite)
            {
                throw new InvalidDataException($"IfcFace #{faceId} has a non-finite outer normal.");
            }
            if (_holes.Count == 0 && _outer.Count == 3 && normal.LengthSquared <= WebIfcTriangleNormalTolerance * WebIfcTriangleNormalTolerance)
            {
                // WebIFC 0.77 sends three-point bounds through AddFace(a,b,c),
                // which drops triangles whose cross-product length is <= 1e-10.
                return new FaceResult(0, false, false, true, true, false, 3, 0, 0, 0);
            }
            if (normal.LengthSquared == 0)
            {
                throw new InvalidDataException($"IfcFace #{faceId} has a degenerate outer normal.");
            }
            if (_holes.Count == 0 && TryTriangulateRuledStrip(indexWriter, normalWriter, out var stripIndices))
                return new FaceResult(stripIndices, false, true, false, false, false, _outer.Count, 0, 0, 0);
            if (!TryProjectWebIfc(out normal))
            {
                throw new InvalidDataException($"IfcFace #{faceId} has no stable projection basis.");
            }
            while (TryDropRedundantNestedHole())
            {
                if (!TryProjectWebIfc(out normal))
                    throw new InvalidDataException($"IfcFace #{faceId} has no stable projection after removing a redundant hole.");
            }
            var flattenedCrossingHole = TryDropCrossingCongruentHole(normal);
            if (flattenedCrossingHole && !TryProjectWebIfc(out normal))
                throw new InvalidDataException($"IfcFace #{faceId} has no stable projection after removing a crossing hole.");
            var recoveredIslands = 0;
            var recoveredDeviation = 0d;
            var recovered = false;
            if (!TrySelectContainingOuter(ref normal))
            {
                recovered = TryTriangulateDisjointBounds(normal, out recoveredIslands, out recoveredDeviation);
                if (!recovered)
                    return new FaceResult(0, true, true, true, false, true, _flatOrdinals.Count, _holeStarts.Count, 0, 0);
            }

            var invalidIntersections = !recovered && HasInvalidIntersections();
            if (_holeStarts.Count > 0 && !recovered &&
                (invalidIntersections || HasNestedBounds()))
                return new FaceResult(0, true, true, true, false, true, _flatOrdinals.Count, _holeStarts.Count, 0, 0);
            var nonSimple = recovered || invalidIntersections || flattenedCrossingHole;
            var usedEarcut = recovered || _holes.Count > 0 || nonSimple || !IsStrictlyConvex(_coordinates, _outer.Count);
            if (!recovered)
            {
                _triangles.Clear();
                if (!usedEarcut)
                {
                    for (var index = 1; index < _outer.Count - 1; index++)
                    {
                        _triangles.Add(0);
                        _triangles.Add(index);
                        _triangles.Add(index + 1);
                    }
                }
                else
                {
                    EarcutTriangulator.Triangulate(_coordinates, _holeStarts, _triangles);
                }
            }
            if (_triangles.Count == 0)
            {
                if (!nonSimple) throw new InvalidDataException($"IfcFace #{faceId} could not be triangulated.");
                return new FaceResult(0, true, true, true, false, false, _flatOrdinals.Count, _holeStarts.Count, 0, 0);
            }
            if (_triangles.Count % 3 != 0)
            {
                throw new InvalidDataException($"IfcFace #{faceId} produced an incomplete triangle.");
            }
            var deviation = recovered ? recoveredDeviation : nonSimple ? 0 : EarcutTriangulator.Deviation(_coordinates, _holeStarts, _triangles);
            if (!double.IsFinite(deviation) || deviation > MaximumAllowedDeviation)
            {
                throw new InvalidDataException($"IfcFace #{faceId} triangulation area deviation is {deviation:G17}.");
            }
            for (var index = 0; index < _triangles.Count; index += 3)
            {
                var a = _triangles[index];
                var b = _triangles[index + 1];
                var c = _triangles[index + 2];
                if (TriangleNormalDot(a, b, c, normal) < 0)
                {
                    (b, c) = (c, b);
                }
                indexWriter.Write(checked((uint)_flatOrdinals[a]));
                indexWriter.Write(checked((uint)_flatOrdinals[b]));
                indexWriter.Write(checked((uint)_flatOrdinals[c]));
                // WebIFC assigns the projected face normal to every vertex of an
                // Earcut polygon, including zero-area triangles retained by its
                // indexed AddFace path. Preserve that shading contract exactly.
                WriteOctahedralNormal(normalWriter, normal);
            }
            return new FaceResult(_triangles.Count, usedEarcut, nonSimple, false, false, false, _flatOrdinals.Count, _holeStarts.Count, deviation, recoveredIslands);
        }

        private bool TryTriangulateRuledStrip(BinaryWriter indexWriter, BinaryWriter normalWriter, out int indexCount)
        {
            indexCount = 0;
            if (_outer.Count < 6 || (_outer.Count & 1) != 0) return false;
            var half = _outer.Count / 2;
            var offset = Subtract(_outer[^1].Point, _outer[0].Point);
            var extent = Math.Sqrt(offset.LengthSquared);
            if (extent <= 1e-12) return false;
            for (var index = 0; index < half; index++)
            {
                var actual = Subtract(_outer[_outer.Count - 1 - index].Point, _outer[index].Point);
                extent = Math.Max(extent, Distance(_outer[index].Point, _outer[0].Point));
                if (!actual.IsFinite) return false;
            }
            var tolerance = Math.Max(extent * 1e-9, 1e-12);
            for (var index = 1; index < half; index++)
            {
                var actual = Subtract(_outer[_outer.Count - 1 - index].Point, _outer[index].Point);
                var difference = new Vector3(actual.X - offset.X, actual.Y - offset.Y, actual.Z - offset.Z);
                if (Math.Sqrt(difference.LengthSquared) > tolerance) return false;
            }

            // The two boundary chains are translations of one another. Each
            // corresponding pair of edges bounds a planar quad, even when the
            // entire IFC face is a folded strip and has no single face plane.
            var triangles = new List<(Vertex3 A, Vertex3 B, Vertex3 C, Vector3 Normal)>((half - 1) * 2);
            for (var index = 0; index < half - 1; index++)
            {
                var a = _outer[index];
                var b = _outer[index + 1];
                var c = _outer[_outer.Count - 2 - index];
                var d = _outer[_outer.Count - 1 - index];
                var first = Subtract(b.Point, a.Point).Cross(Subtract(c.Point, a.Point));
                var second = Subtract(c.Point, a.Point).Cross(Subtract(d.Point, a.Point));
                var minimumArea = 1e-20 * extent * extent;
                if (first.LengthSquared <= minimumArea || second.LengthSquared <= minimumArea ||
                    first.Dot(second) <= 0) return false;
                triangles.Add((a, b, c, Normalize(first)));
                triangles.Add((a, c, d, Normalize(second)));
            }
            foreach (var triangle in triangles)
            {
                indexWriter.Write(checked((uint)triangle.A.Ordinal));
                indexWriter.Write(checked((uint)triangle.B.Ordinal));
                indexWriter.Write(checked((uint)triangle.C.Ordinal));
                WriteOctahedralNormal(normalWriter, triangle.Normal);
            }
            indexCount = triangles.Count * 3;
            return true;
        }

        private static bool SameBoundary(IReadOnlyList<Vertex3> outer, IReadOnlyList<Vertex3> inner)
        {
            if (outer.Count != inner.Count || outer.Count < 3) return false;
            for (var start = 0; start < inner.Count; start++)
            {
                if (!outer[0].Point.SameAs(inner[start].Point)) continue;
                for (var direction = -1; direction <= 1; direction += 2)
                {
                    var match = true;
                    for (var index = 1; index < outer.Count; index++)
                    {
                        var innerIndex = (start + direction * index + inner.Count) % inner.Count;
                        if (outer[index].Point.SameAs(inner[innerIndex].Point)) continue;
                        match = false;
                        break;
                    }
                    if (match) return true;
                }
            }
            return false;
        }

        private bool TryDropRedundantNestedHole()
        {
            if (_holeStarts.Count < 2) return false;
            var ringCount = _holeStarts.Count + 1;
            for (var contained = 1; contained < ringCount; contained++)
            {
                var containedStart = RingStart(contained);
                var containedEnd = RingEnd(contained);
                if (RingSelfIntersects(containedStart, containedEnd)) continue;
                for (var container = 1; container < ringCount; container++)
                {
                    if (container == contained) continue;
                    var containerStart = RingStart(container);
                    var containerEnd = RingEnd(container);
                    if (RingSelfIntersects(containerStart, containerEnd) ||
                        RingsIntersect(containedStart, containedEnd, containerStart, containerEnd) ||
                        !PointInRing(container, containedStart) ||
                        PointInRing(contained, containerStart) ||
                        !HolePlanesCoincide(container - 1, contained - 1))
                        continue;

                    var holeIndex = contained - 1;
                    var start = _holeBufferStarts[holeIndex];
                    var end = holeIndex + 1 < _holeBufferStarts.Count
                        ? _holeBufferStarts[holeIndex + 1]
                        : _holes.Count;
                    var length = end - start;
                    _holes.RemoveRange(start, length);
                    _holeBufferStarts.RemoveAt(holeIndex);
                    for (var index = holeIndex; index < _holeBufferStarts.Count; index++)
                        _holeBufferStarts[index] -= length;
                    return true;
                }
            }
            return false;
        }

        private bool TryDropCrossingCongruentHole(Vector3 normal)
        {
            if (_holeStarts.Count != 1 || _outer.Count != _holes.Count || _outer.Count < 3)
                return false;
            var origin = _outer[0].Point;
            var extent = 0d;
            foreach (var vertex in _outer)
                extent = Math.Max(extent, Distance(vertex.Point, origin));
            if (extent <= 1e-10) return false;
            var projectedTolerance = extent * 1e-5;
            var planeTolerance = extent * 1e-6;
            var crossesPositive = false;
            var crossesNegative = false;
            foreach (var vertex in _holes)
            {
                var distance = Subtract(vertex.Point, origin).Dot(normal);
                crossesPositive |= distance > planeTolerance;
                crossesNegative |= distance < -planeTolerance;
            }
            if (!crossesPositive || !crossesNegative) return false;

            // The two rings must be congruent in the face projection. A tilted
            // inner ring that crosses the outer plane is not a planar hole;
            // independent IFC kernels retain the complete outer face.
            var count = _outer.Count;
            var toleranceSquared = projectedTolerance * projectedTolerance;
            var matched = false;
            for (var start = 0; start < count && !matched; start++)
            for (var direction = -1; direction <= 1 && !matched; direction += 2)
            {
                var allMatch = true;
                for (var index = 0; index < count; index++)
                {
                    var holeIndex = (start + direction * index + count) % count;
                    var dx = _coordinates[index * 2] - _coordinates[(count + holeIndex) * 2];
                    var dy = _coordinates[index * 2 + 1] - _coordinates[(count + holeIndex) * 2 + 1];
                    if (dx * dx + dy * dy <= toleranceSquared) continue;
                    allMatch = false;
                    break;
                }
                matched = allMatch;
            }
            if (!matched) return false;
            _holes.Clear();
            _holeBufferStarts.Clear();
            return true;
        }

        private bool HolePlanesCoincide(int containerIndex, int containedIndex)
        {
            var start = _holeBufferStarts[containerIndex];
            var end = containerIndex + 1 < _holeBufferStarts.Count
                ? _holeBufferStarts[containerIndex + 1]
                : _holes.Count;
            var ring = _holes.GetRange(start, end - start);
            var normal = Newell(ring);
            var length = Math.Sqrt(normal.LengthSquared);
            if (length <= 1e-20) return false;
            var origin = ring[0].Point;
            var extent = ring.Max(vertex => Distance(origin, vertex.Point));
            var tolerance = Math.Max(extent * 1e-8, 1e-10);
            var containedStart = _holeBufferStarts[containedIndex];
            var containedEnd = containedIndex + 1 < _holeBufferStarts.Count
                ? _holeBufferStarts[containedIndex + 1]
                : _holes.Count;
            for (var index = containedStart; index < containedEnd; index++)
            {
                var distance = Math.Abs(Subtract(_holes[index].Point, origin).Dot(normal)) / length;
                if (distance > tolerance) return false;
            }
            return true;
        }

        private bool LoadRing(int loopId, int faceId)
        {
            if (!GraphCoverageAnalyzer.TryGetRecord(_source, _entries, loopId, out var loop, out var loopTypeId) ||
                _registry[loopTypeId].Kind != EntityKind.PolyLoop ||
                !StepParsing.TryGetTopLevelArgument(loop, 0, out var pointsArgument))
            {
                throw new InvalidDataException($"IfcFace #{faceId} references invalid IfcPolyLoop #{loopId}.");
            }
            StepParsing.CollectReferences(pointsArgument, _pointIds);
            _currentRing.Clear();
            foreach (var pointId in _pointIds)
            {
                if (!_points.TryGet(pointId, out var ordinal, out var point))
                {
                    throw new InvalidDataException($"IfcPolyLoop #{loopId} references invalid point #{pointId}.");
                }
                if (_currentRing.Count > 0 && _currentRing[^1].Point.SameAs(point)) continue;
                _currentRing.Add(new Vertex3(ordinal, point));
            }
            if (_currentRing.Count > 1 && _currentRing[0].Point.SameAs(_currentRing[^1].Point))
                _currentRing.RemoveAt(_currentRing.Count - 1);
            // An exact A-B-A excursion traverses the same edge in both
            // directions and encloses no surface. Some exporters leave this
            // spur in an otherwise valid inner loop.
            for (var index = 0; index + 2 < _currentRing.Count;)
            {
                if (!_currentRing[index].Point.SameAs(_currentRing[index + 2].Point))
                {
                    index++;
                    continue;
                }
                _currentRing.RemoveRange(index + 1, 2);
                index = Math.Max(0, index - 1);
            }
            return _currentRing.Count < 3;
        }

        private bool TryProjectWebIfc(out Vector3 normal)
        {
            normal = default;
            var origin = _outer[0].Point;
            var second = origin;
            foreach (var vertex in _outer)
            {
                if (vertex.Point.SameAs(origin)) continue;
                second = vertex.Point;
                break;
            }
            var third = origin;
            var found = false;
            double[] tolerances = [100, 1, 0.01, 0.001];
            foreach (var tolerance in tolerances)
            {
                foreach (var vertex in _outer)
                {
                    if (!TrySafeNormal(origin, second, vertex.Point, tolerance, out _)) continue;
                    third = vertex.Point;
                    found = true;
                    break;
                }
                if (found) break;
            }
            if (!found)
            {
                var farthestDistance = 0d;
                foreach (var vertex in _outer)
                {
                    var distance = Distance(origin, vertex.Point);
                    if (distance <= farthestDistance) continue;
                    farthestDistance = distance;
                    second = vertex.Point;
                }
                var maximumDistanceSum = 0d;
                foreach (var vertex in _outer)
                {
                    var distanceSum = Distance(origin, vertex.Point) + Distance(second, vertex.Point);
                    if (distanceSum <= maximumDistanceSum) continue;
                    maximumDistanceSum = distanceSum;
                    third = vertex.Point;
                }
                if (!TrySafeNormal(origin, second, third, 1e-8, out _)) return false;
            }

            var axisX = Normalize(Subtract(third, second));
            var axisY = Normalize(Subtract(origin, second));
            normal = Normalize(axisX.Cross(axisY));
            axisX = axisY.Cross(normal);
            if (!normal.IsFinite || normal.LengthSquared == 0 || !axisX.IsFinite || !axisY.IsFinite) return false;

            _coordinates.Clear();
            _flatOrdinals.Clear();
            _holeStarts.Clear();
            AppendProjected(_outer, origin, axisX, axisY);
            if (!ProjectedOuterIsCounterClockwise(_outer.Count))
            {
                normal = new Vector3(-normal.X, -normal.Y, -normal.Z);
                (axisX, axisY) = (axisY, axisX);
                _coordinates.Clear();
                _flatOrdinals.Clear();
                AppendProjected(_outer, origin, axisX, axisY);
            }
            for (var ringIndex = 0; ringIndex < _holeBufferStarts.Count; ringIndex++)
            {
                var start = _holeBufferStarts[ringIndex];
                var end = ringIndex + 1 < _holeBufferStarts.Count ? _holeBufferStarts[ringIndex + 1] : _holes.Count;
                _holeStarts.Add(_flatOrdinals.Count);
                AppendProjected(_holes, start, end, origin, axisX, axisY);
            }
            return true;
        }

        private void AppendProjected(IEnumerable<Vertex3> vertices, Point3 origin, Vector3 axisX, Vector3 axisY)
        {
            foreach (var vertex in vertices)
            {
                _flatOrdinals.Add(vertex.Ordinal);
                var relative = Subtract(vertex.Point, origin);
                _coordinates.Add(relative.Dot(axisX));
                _coordinates.Add(relative.Dot(axisY));
            }
        }

        private void AppendProjected(
            IReadOnlyList<Vertex3> vertices,
            int start,
            int end,
            Point3 origin,
            Vector3 axisX,
            Vector3 axisY)
        {
            for (var index = start; index < end; index++)
            {
                var vertex = vertices[index];
                _flatOrdinals.Add(vertex.Ordinal);
                var relative = Subtract(vertex.Point, origin);
                _coordinates.Add(relative.Dot(axisX));
                _coordinates.Add(relative.Dot(axisY));
            }
        }

        private bool ProjectedOuterIsCounterClockwise(int count)
        {
            var sum = 0d;
            for (var index = 0; index < count; index++)
            {
                var previous = (index - 1 + count) % count;
                var previousX = _coordinates[previous * 2];
                var previousY = _coordinates[previous * 2 + 1];
                var currentX = _coordinates[index * 2];
                var currentY = _coordinates[index * 2 + 1];
                sum += (currentX - previousX) * (currentY + previousY);
            }
            return sum < 0;
        }

        private static bool TrySafeNormal(Point3 first, Point3 second, Point3 third, double epsilon, out Vector3 normal)
        {
            normal = Subtract(second, first).Cross(Subtract(third, first));
            var length = Math.Sqrt(normal.LengthSquared);
            if (length <= epsilon) return false;
            normal = new Vector3(normal.X / length, normal.Y / length, normal.Z / length);
            return true;
        }

        private static Vector3 Normalize(Vector3 vector)
        {
            var length = Math.Sqrt(vector.LengthSquared);
            return length == 0
                ? default
                : new Vector3(vector.X / length, vector.Y / length, vector.Z / length);
        }

        private static Vector3 Subtract(Point3 left, Point3 right) =>
            new(left.X - right.X, left.Y - right.Y, left.Z - right.Z);

        private static double Distance(Point3 left, Point3 right) => Math.Sqrt(Subtract(left, right).LengthSquared);

        private static bool IsStrictlyConvex(IReadOnlyList<double> coordinates, int vertices)
        {
            if (vertices == 3) return true;
            var sign = 0;
            for (var index = 0; index < vertices; index++)
            {
                var previous = (index - 1 + vertices) % vertices;
                var next = (index + 1) % vertices;
                var ax = coordinates[index * 2] - coordinates[previous * 2];
                var ay = coordinates[index * 2 + 1] - coordinates[previous * 2 + 1];
                var bx = coordinates[next * 2] - coordinates[index * 2];
                var by = coordinates[next * 2 + 1] - coordinates[index * 2 + 1];
                var cross = ax * by - ay * bx;
                var scale = Math.Max(1d, Math.Abs(ax * by) + Math.Abs(ay * bx));
                if (Math.Abs(cross) <= 1e-12 * scale) return false;
                var currentSign = Math.Sign(cross);
                if (sign == 0) sign = currentSign;
                else if (sign != currentSign) return false;
            }
            return true;
        }

        private bool TrySelectContainingOuter(ref Vector3 normal)
        {
            if (_holeStarts.Count == 0) return true;
            var ringCount = _holeStarts.Count + 1;
            var declaredOuterIsValid = true;
            for (var ringIndex = 1; ringIndex < ringCount; ringIndex++)
            {
                var pointIndex = RingStart(ringIndex);
                if (PointInRing(0, pointIndex)) continue;
                declaredOuterIsValid = false;
                break;
            }
            if (declaredOuterIsValid) return true;

            var trueOuter = -1;
            for (var candidate = 0; candidate < ringCount; candidate++)
            {
                var containsAll = true;
                for (var other = 0; other < ringCount; other++)
                {
                    if (candidate == other) continue;
                    if (PointInRing(candidate, RingStart(other))) continue;
                    containsAll = false;
                    break;
                }
                if (!containsAll) continue;
                trueOuter = candidate;
                break;
            }
            if (trueOuter < 0) return false;
            if (trueOuter == 0) return true;

            PromoteHoleToOuter(trueOuter - 1);
            if (!TryProjectWebIfc(out normal)) return false;
            return true;
        }

        private bool TryTriangulateDisjointBounds(Vector3 normal, out int islands, out double deviation)
        {
            islands = 0;
            deviation = 0;
            if (_holeStarts.Count == 0 || HasInvalidIntersections()) return false;

            // A bounded face cannot have disconnected components under IFC2X3.
            // Recover only completely separate, coplanar rings, and record them
            // explicitly. Intersecting or nested rings still fail closed.
            var origin = _outer[0].Point;
            var maximumSpan = 1d;
            foreach (var vertex in _outer)
                maximumSpan = Math.Max(maximumSpan, Distance(vertex.Point, origin));
            var planeTolerance = 1e-8 * maximumSpan;
            foreach (var vertex in _outer)
            {
                if (Math.Abs(Subtract(vertex.Point, origin).Dot(normal)) > planeTolerance)
                    return false;
            }
            foreach (var vertex in _holes)
            {
                if (Math.Abs(Subtract(vertex.Point, origin).Dot(normal)) > planeTolerance)
                    return false;
            }

            var interior = new List<int> { 0 };
            var exterior = new List<int>();
            var ringCount = _holeStarts.Count + 1;
            for (var ringIndex = 1; ringIndex < ringCount; ringIndex++)
            {
                if (PointInRing(ringIndex, 0)) return false;
                if (PointInRing(0, RingStart(ringIndex))) interior.Add(ringIndex);
                else exterior.Add(ringIndex);
                for (var other = 1; other < ringIndex; other++)
                {
                    if (PointInRing(ringIndex, RingStart(other)) ||
                        PointInRing(other, RingStart(ringIndex))) return false;
                }
            }
            if (exterior.Count == 0) return false;

            _triangles.Clear();
            if (!AppendTriangulatedComponent(interior, out deviation)) return false;
            foreach (var ringIndex in exterior)
            {
                if (!AppendTriangulatedComponent([ringIndex], out var islandDeviation)) return false;
                deviation = Math.Max(deviation, islandDeviation);
            }
            islands = exterior.Count;
            return true;
        }

        private bool AppendTriangulatedComponent(IReadOnlyList<int> rings, out double deviation)
        {
            deviation = 0;
            var coordinates = new List<double>();
            var globalIndices = new List<int>();
            var holeStarts = new List<int>();
            foreach (var ringIndex in rings)
            {
                if (globalIndices.Count > 0) holeStarts.Add(globalIndices.Count);
                for (var index = RingStart(ringIndex); index < RingEnd(ringIndex); index++)
                {
                    globalIndices.Add(index);
                    coordinates.Add(_coordinates[index * 2]);
                    coordinates.Add(_coordinates[index * 2 + 1]);
                }
            }
            var triangles = new List<int>();
            EarcutTriangulator.Triangulate(coordinates, holeStarts, triangles);
            if (triangles.Count == 0 || triangles.Count % 3 != 0) return false;
            deviation = EarcutTriangulator.Deviation(coordinates, holeStarts, triangles);
            if (!double.IsFinite(deviation) || deviation > MaximumAllowedDeviation) return false;
            foreach (var index in triangles) _triangles.Add(globalIndices[index]);
            return true;
        }

        private bool PointInRing(int ringIndex, int pointIndex)
        {
            var pointX = _coordinates[pointIndex * 2];
            var pointY = _coordinates[pointIndex * 2 + 1];
            var start = RingStart(ringIndex);
            var end = RingEnd(ringIndex);
            var inside = false;
            for (int current = start, previous = end - 1; current < end; previous = current++)
            {
                var currentX = _coordinates[current * 2];
                var currentY = _coordinates[current * 2 + 1];
                var previousX = _coordinates[previous * 2];
                var previousY = _coordinates[previous * 2 + 1];
                if ((currentY > pointY) != (previousY > pointY) &&
                    pointX < currentX + (previousX - currentX) * (pointY - currentY) / (previousY - currentY + 1e-10))
                {
                    inside = !inside;
                }
            }
            return inside;
        }

        private void PromoteHoleToOuter(int promotedHoleIndex)
        {
            var previousOuter = _outer.ToArray();
            var previousHoles = _holes.ToArray();
            var previousStarts = _holeBufferStarts.ToArray();
            var promotedStart = previousStarts[promotedHoleIndex];
            var promotedEnd = promotedHoleIndex + 1 < previousStarts.Length ? previousStarts[promotedHoleIndex + 1] : previousHoles.Length;
            _outer.Clear();
            for (var index = promotedStart; index < promotedEnd; index++) _outer.Add(previousHoles[index]);
            _holes.Clear();
            _holeBufferStarts.Clear();
            for (var ringIndex = 0; ringIndex < previousStarts.Length; ringIndex++)
            {
                _holeBufferStarts.Add(_holes.Count);
                if (ringIndex == promotedHoleIndex)
                {
                    _holes.AddRange(previousOuter);
                    continue;
                }
                var start = previousStarts[ringIndex];
                var end = ringIndex + 1 < previousStarts.Length ? previousStarts[ringIndex + 1] : previousHoles.Length;
                for (var index = start; index < end; index++) _holes.Add(previousHoles[index]);
            }
        }

        private bool HasInvalidIntersections()
        {
            var ringCount = _holeStarts.Count + 1;
            for (var ringIndex = 0; ringIndex < ringCount; ringIndex++)
            {
                var start = RingStart(ringIndex);
                var end = RingEnd(ringIndex);
                if (RingSelfIntersects(start, end)) return true;
                for (var otherIndex = ringIndex + 1; otherIndex < ringCount; otherIndex++)
                {
                    var otherStart = RingStart(otherIndex);
                    var otherEnd = RingEnd(otherIndex);
                    if (RingsIntersect(start, end, otherStart, otherEnd)) return true;
                }
            }
            return false;
        }

        private bool HasNestedBounds()
        {
            for (var ringIndex = 1; ringIndex <= _holeStarts.Count; ringIndex++)
            {
                if (PointInRing(ringIndex, 0)) return true;
                for (var other = 1; other < ringIndex; other++)
                {
                    if (PointInRing(ringIndex, RingStart(other)) ||
                        PointInRing(other, RingStart(ringIndex))) return true;
                }
            }
            return false;
        }

        private int RingStart(int ringIndex) => ringIndex == 0 ? 0 : _holeStarts[ringIndex - 1];

        private int RingEnd(int ringIndex) => ringIndex < _holeStarts.Count ? _holeStarts[ringIndex] : _flatOrdinals.Count;

        private bool RingSelfIntersects(int start, int end)
        {
            var count = end - start;
            for (var first = 0; first < count; first++)
            {
                var firstNext = (first + 1) % count;
                for (var second = first + 1; second < count; second++)
                {
                    var secondNext = (second + 1) % count;
                    if (first == second || firstNext == second || secondNext == first) continue;
                    if (SegmentsIntersect(start + first, start + firstNext, start + second, start + secondNext)) return true;
                }
            }
            return false;
        }

        private bool RingsIntersect(int firstStart, int firstEnd, int secondStart, int secondEnd)
        {
            var firstCount = firstEnd - firstStart;
            var secondCount = secondEnd - secondStart;
            for (var first = 0; first < firstCount; first++)
            {
                for (var second = 0; second < secondCount; second++)
                {
                    if (SegmentsIntersect(
                            firstStart + first,
                            firstStart + (first + 1) % firstCount,
                            secondStart + second,
                            secondStart + (second + 1) % secondCount)) return true;
                }
            }
            return false;
        }

        private bool SegmentsIntersect(int a, int b, int c, int d)
        {
            var ax = _coordinates[a * 2];
            var ay = _coordinates[a * 2 + 1];
            var bx = _coordinates[b * 2];
            var by = _coordinates[b * 2 + 1];
            var cx = _coordinates[c * 2];
            var cy = _coordinates[c * 2 + 1];
            var dx = _coordinates[d * 2];
            var dy = _coordinates[d * 2 + 1];
            var abC = Orient(ax, ay, bx, by, cx, cy);
            var abD = Orient(ax, ay, bx, by, dx, dy);
            var cdA = Orient(cx, cy, dx, dy, ax, ay);
            var cdB = Orient(cx, cy, dx, dy, bx, by);
            var scale = Math.Max(1d, Math.Max(
                Math.Max(Math.Abs(ax), Math.Abs(ay)),
                Math.Max(Math.Max(Math.Abs(bx), Math.Abs(by)), Math.Max(Math.Max(Math.Abs(cx), Math.Abs(cy)), Math.Max(Math.Abs(dx), Math.Abs(dy))))));
            var coordinateEpsilon = 1e-12 * scale;
            var areaEpsilon = coordinateEpsilon * scale;
            if (((abC > areaEpsilon && abD < -areaEpsilon) || (abC < -areaEpsilon && abD > areaEpsilon)) &&
                ((cdA > areaEpsilon && cdB < -areaEpsilon) || (cdA < -areaEpsilon && cdB > areaEpsilon))) return true;
            return Math.Abs(abC) <= areaEpsilon && OnSegment(ax, ay, bx, by, cx, cy, coordinateEpsilon) ||
                   Math.Abs(abD) <= areaEpsilon && OnSegment(ax, ay, bx, by, dx, dy, coordinateEpsilon) ||
                   Math.Abs(cdA) <= areaEpsilon && OnSegment(cx, cy, dx, dy, ax, ay, coordinateEpsilon) ||
                   Math.Abs(cdB) <= areaEpsilon && OnSegment(cx, cy, dx, dy, bx, by, coordinateEpsilon);
        }

        private static double Orient(double ax, double ay, double bx, double by, double cx, double cy) =>
            (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

        private static bool OnSegment(double ax, double ay, double bx, double by, double px, double py, double epsilon) =>
            px >= Math.Min(ax, bx) - epsilon && px <= Math.Max(ax, bx) + epsilon &&
            py >= Math.Min(ay, by) - epsilon && py <= Math.Max(ay, by) + epsilon;

        private double TriangleNormalDot(int a, int b, int c, Vector3 normal)
        {
            return TriangleNormal(a, b, c).Dot(normal);
        }

        private Vector3 TriangleNormal(int a, int b, int c)
        {
            var pa = _points.AtOrdinal(_flatOrdinals[a]);
            var pb = _points.AtOrdinal(_flatOrdinals[b]);
            var pc = _points.AtOrdinal(_flatOrdinals[c]);
            var ab = new Vector3(pb.X - pa.X, pb.Y - pa.Y, pb.Z - pa.Z);
            var ac = new Vector3(pc.X - pa.X, pc.Y - pa.Y, pc.Z - pa.Z);
            return ab.Cross(ac);
        }

        private static Vector3 Newell(IReadOnlyList<Vertex3> vertices)
        {
            var normal = new Vector3(0, 0, 0);
            for (var index = 0; index < vertices.Count; index++)
            {
                var current = vertices[index].Point;
                var next = vertices[(index + 1) % vertices.Count].Point;
                normal = new Vector3(
                    normal.X + (current.Y - next.Y) * (current.Z + next.Z),
                    normal.Y + (current.Z - next.Z) * (current.X + next.X),
                    normal.Z + (current.X - next.X) * (current.Y + next.Y));
            }
            return normal;
        }
    }

    private sealed class PointTable
    {
        private readonly int[] _ordinalByExpressId;
        private readonly int[] _expressIds;
        private readonly double[] _coordinates;
        private readonly List<double> _syntheticCoordinates = [];

        private PointTable(int[] ordinalByExpressId, int[] expressIds, double[] coordinates)
        {
            _ordinalByExpressId = ordinalByExpressId;
            _expressIds = expressIds;
            _coordinates = coordinates;
        }

        public int Count => checked(_expressIds.Length + _syntheticCoordinates.Count / 3);

        public static PointTable Build(ReadOnlySpan<byte> source, ReadOnlySpan<byte> entries, long maximumExpressId, TypeRegistry registry)
        {
            var expected = checked((int)registry.Entries.Where(entry => entry.Kind == EntityKind.CartesianPoint).Sum(entry => entry.Count));
            var ordinals = new int[checked((int)maximumExpressId + 1)];
            var expressIds = new int[expected];
            var coordinates = new double[checked(expected * 3)];
            var ordinal = 0;
            Span<double> parsed = stackalloc double[4];
            for (var expressId = 0; expressId <= maximumExpressId; expressId++)
            {
                if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, expressId, out var record, out var typeId) ||
                    registry[typeId].Kind != EntityKind.CartesianPoint) continue;
                if (!StepParsing.TryGetTopLevelArgument(record, 0, out var coordinateArgument) ||
                    !StepParsing.TryParseDoubleList(coordinateArgument, parsed, out var count) || count is < 2 or > 3)
                {
                    throw new InvalidDataException($"IfcCartesianPoint #{expressId} has invalid coordinates.");
                }
                ordinals[checked((int)expressId)] = ordinal + 1;
                expressIds[ordinal] = checked((int)expressId);
                coordinates[ordinal * 3] = parsed[0];
                coordinates[ordinal * 3 + 1] = parsed[1];
                coordinates[ordinal * 3 + 2] = count == 3 ? parsed[2] : 0;
                ordinal++;
            }
            if (ordinal != expected) throw new InvalidDataException($"Cartesian-point coverage mismatch: expected {expected:N0}, decoded {ordinal:N0}.");
            return new PointTable(ordinals, expressIds, coordinates);
        }

        public int ExpressIdAt(int ordinal) => ordinal < _expressIds.Length ? _expressIds[ordinal] : 0;

        public Point3 AtOrdinal(int ordinal)
        {
            if (ordinal < _expressIds.Length)
            {
                var offset = checked(ordinal * 3);
                return new Point3(_coordinates[offset], _coordinates[offset + 1], _coordinates[offset + 2]);
            }
            var generatedOffset = checked((ordinal - _expressIds.Length) * 3);
            return new Point3(
                _syntheticCoordinates[generatedOffset],
                _syntheticCoordinates[generatedOffset + 1],
                _syntheticCoordinates[generatedOffset + 2]);
        }

        public int AppendSynthetic(Point3 point)
        {
            var ordinal = Count;
            _syntheticCoordinates.Add(point.X);
            _syntheticCoordinates.Add(point.Y);
            _syntheticCoordinates.Add(point.Z);
            return ordinal;
        }

        public bool TryGet(int expressId, out int ordinal, out Point3 point)
        {
            ordinal = 0;
            point = default;
            if ((uint)expressId >= (uint)_ordinalByExpressId.Length) return false;
            var stored = _ordinalByExpressId[expressId];
            if (stored == 0) return false;
            ordinal = stored - 1;
            point = AtOrdinal(ordinal);
            return true;
        }
    }

    private readonly record struct Point3(double X, double Y, double Z)
    {
        public bool SameAs(Point3 other) => X == other.X && Y == other.Y && Z == other.Z;
    }

    private readonly record struct Vertex3(int Ordinal, Point3 Point);
    private readonly record struct Vector3(double X, double Y, double Z)
    {
        public bool IsFinite => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Z);
        public double LengthSquared => X * X + Y * Y + Z * Z;
        public Vector3 Cross(Vector3 other) => new(Y * other.Z - Z * other.Y, Z * other.X - X * other.Z, X * other.Y - Y * other.X);
        public double Dot(Vector3 other) => X * other.X + Y * other.Y + Z * other.Z;
    }

    private struct Bounds3
    {
        public double MinimumX;
        public double MinimumY;
        public double MinimumZ;
        public double MaximumX;
        public double MaximumY;
        public double MaximumZ;

        public static Bounds3 Empty => new()
        {
            MinimumX = double.PositiveInfinity,
            MinimumY = double.PositiveInfinity,
            MinimumZ = double.PositiveInfinity,
            MaximumX = double.NegativeInfinity,
            MaximumY = double.NegativeInfinity,
            MaximumZ = double.NegativeInfinity,
        };

        public bool IsValid => double.IsFinite(MinimumX) && double.IsFinite(MaximumX) && MinimumX <= MaximumX;

        public void Include(Point3 point)
        {
            MinimumX = Math.Min(MinimumX, point.X);
            MinimumY = Math.Min(MinimumY, point.Y);
            MinimumZ = Math.Min(MinimumZ, point.Z);
            MaximumX = Math.Max(MaximumX, point.X);
            MaximumY = Math.Max(MaximumY, point.Y);
            MaximumZ = Math.Max(MaximumZ, point.Z);
        }
    }

    private readonly record struct FaceResult(
        int IndexCount,
        bool UsedEarcut,
        bool NonSimple,
        bool Empty,
        bool Degenerate,
        bool ContainmentRejected,
        int Vertices,
        int Holes,
        double AreaDeviation,
        int RecoveredIslands);
    private sealed record PreparedGeneratedMesh(
        int[] PointOrdinals,
        IReadOnlyList<int> Indices,
        int FaceCount,
        int EarcutFaces);
    private readonly record struct TessellationBuildResult(
        long CartesianPoints,
        long BaseDefinitions,
        long Products,
        long Instances,
        long UniqueFaces,
        long ExpandedFaces,
        long Triangles,
        long ExpandedTriangles,
        long Indices,
        long FastPathFaces,
        long EarcutFaces,
        long NonSimpleFaces,
        long RecoveredDisjointFaces,
        long EmptyFaces,
        long DegenerateFaces,
        long ContainmentRejectedFaces,
        double MaximumAreaDeviation,
        double LengthUnitScaleToMetres,
        IReadOnlyList<double> SourceToViewerTransform,
        MaterialChunkWriter.MaterialBuildResult Materials,
        SemanticChunkWriter.SemanticBuildResult Semantic,
        IReadOnlyList<NonSimpleFaceManifest> NonSimpleFaceDetails);
}
