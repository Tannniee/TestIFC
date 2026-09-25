using System.Buffers.Binary;
using System.Text;

namespace IfcEngineV2.Scanner;

internal static class SemanticChunkWriter
{
    private const int ChunkHeaderBytes = 32;
    private const ushort ChunkVersion = 1;
    private const ushort SemanticRecordChunkKind = 10;
    private const ushort SemanticStringChunkKind = 11;
    private const int SemanticRecordBytes = 48;
    private const ushort RepresentedProductFlag = 1;
    private static readonly byte[] ChunkMagic = "IFCV2CHK"u8.ToArray();

    private static readonly HashSet<string> SpatialTypes = new(StringComparer.Ordinal)
    {
        "IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE",
        "IFCFACILITY", "IFCFACILITYPART", "IFCBRIDGE", "IFCBRIDGEPART", "IFCROAD",
        "IFCROADPART", "IFCRAILWAY", "IFCRAILWAYPART", "IFCMARINEFACILITY", "IFCMARINEPART",
    };

    public static SemanticBuildResult Write(
        string directory,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int[] productDefinitionIdsByProduct,
        double lengthUnitScaleToMetres)
    {
        var represented = productDefinitionIdsByProduct
            .Select((productDefinitionId, productId) => (productDefinitionId, productId))
            .Where(item => item.productDefinitionId > 0)
            .Select(item => item.productId)
            .ToHashSet();
        var included = new HashSet<int>(represented);
        var relations = new List<ParentRelation>();
        var maximumExpressId = entries.Length / 16 - 1;

        for (var expressId = 0; expressId <= maximumExpressId; expressId++)
        {
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, expressId, out var record, out var typeId)) continue;
            var typeName = registry[typeId].Name;
            if (SpatialTypes.Contains(typeName) && HasIdentity(record)) included.Add(expressId);
            if (!TryReadRelation(typeName, record, out var relation)) continue;
            relations.Add(relation);
        }

        // Pull in the complete connected decomposition/containment tree around
        // rendered products and spatial roots. This includes non-geometric
        // assemblies without admitting unrelated IfcRoot records.
        var changed = true;
        while (changed)
        {
            changed = false;
            foreach (var relation in relations)
            {
                if (!included.Contains(relation.Parent) && !relation.Children.Any(included.Contains)) continue;
                changed |= TryIncludeIdentity(relation.Parent, included, source, entries, registry);
                foreach (var child in relation.Children)
                    changed |= TryIncludeIdentity(child, included, source, entries, registry);
            }
        }

        var parents = new Dictionary<int, int>();
        foreach (var relation in relations)
        {
            if (!included.Contains(relation.Parent)) continue;
            foreach (var child in relation.Children)
                if (included.Contains(child)) parents.TryAdd(child, relation.Parent);
        }

        var recordPath = Path.Combine(directory, "semantic-records.ifcv2");
        var stringPath = Path.Combine(directory, "semantic-strings.ifcv2");
        using var recordStream = CreateChunkStream(recordPath);
        using var stringStream = CreateChunkStream(stringPath);
        using var recordWriter = new BinaryWriter(recordStream, Encoding.UTF8, leaveOpen: true);
        using var stringWriter = new BinaryWriter(stringStream, Encoding.UTF8, leaveOpen: true);
        WriteEmptyHeader(recordWriter);
        WriteEmptyHeader(stringWriter);
        var strings = new Dictionary<string, StringSlice>(StringComparer.Ordinal);
        long recordCount = 0;
        long parentLinks = 0;
        long roots = 0;

        foreach (var expressId in included.Order())
        {
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, expressId, out var record, out var typeId) || !HasIdentity(record))
                throw new InvalidDataException($"Semantic record #{expressId} disappeared from the source index.");
            var globalId = ReadStringArgument(record, 0);
            var name = ReadStringArgument(record, 2);
            var description = ReadStringArgument(record, 3);
            var objectType = ReadStringArgument(record, 4);
            var globalSlice = WriteString(globalId, strings, stringWriter, stringStream);
            var nameSlice = WriteString(name, strings, stringWriter, stringStream);
            var descriptionSlice = WriteString(description, strings, stringWriter, stringStream);
            var objectTypeSlice = WriteString(objectType, strings, stringWriter, stringStream);
            var parentId = parents.GetValueOrDefault(expressId);
            if (parentId == 0) roots++; else parentLinks++;
            recordWriter.Write(expressId);
            recordWriter.Write(parentId);
            recordWriter.Write(typeId);
            recordWriter.Write(represented.Contains(expressId) ? RepresentedProductFlag : (ushort)0);
            WriteSlice(recordWriter, globalSlice);
            WriteSlice(recordWriter, nameSlice);
            WriteSlice(recordWriter, descriptionSlice);
            WriteSlice(recordWriter, objectTypeSlice);
            recordWriter.Write(0u);
            recordCount++;
        }

        var stringBytes = stringStream.Length - ChunkHeaderBytes;
        CompleteHeader(recordStream, SemanticRecordChunkKind, checked((ulong)recordCount * SemanticRecordBytes), checked((uint)recordCount));
        CompleteHeader(stringStream, SemanticStringChunkKind, checked((ulong)stringBytes), checked((uint)stringBytes));
        var deep = DeepSemanticChunkWriter.Write(
            directory, source, entries, registry, productDefinitionIdsByProduct, lengthUnitScaleToMetres);
        return new SemanticBuildResult(recordCount, parentLinks, roots, represented.Count, stringBytes, deep);
    }

    private static bool TryReadRelation(string typeName, ReadOnlySpan<byte> record, out ParentRelation relation)
    {
        relation = default;
        var parentIndex = typeName == "IFCRELCONTAINEDINSPATIALSTRUCTURE" ? 5 : 4;
        var childrenIndex = typeName == "IFCRELCONTAINEDINSPATIALSTRUCTURE" ? 4 : 5;
        if (typeName is not ("IFCRELAGGREGATES" or "IFCRELNESTS" or "IFCRELCONTAINEDINSPATIALSTRUCTURE") ||
            !StepParsing.TryGetTopLevelArgument(record, parentIndex, out var parentArgument) ||
            !StepParsing.TryReadSingleReference(parentArgument, out var parent) ||
            !StepParsing.TryGetTopLevelArgument(record, childrenIndex, out var childrenArgument)) return false;
        var children = new List<int>();
        StepParsing.CollectReferences(childrenArgument, children);
        if (children.Count == 0) return false;
        relation = new ParentRelation(parent, children.ToArray());
        return true;
    }

    private static bool TryIncludeIdentity(
        int expressId,
        HashSet<int> included,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry)
    {
        if (included.Contains(expressId) ||
            !GraphCoverageAnalyzer.TryGetRecord(source, entries, expressId, out var record, out var typeId) ||
            registry[typeId].Name.StartsWith("IFCREL", StringComparison.Ordinal) || !HasIdentity(record)) return false;
        included.Add(expressId);
        return true;
    }

    private static bool HasIdentity(ReadOnlySpan<byte> record) =>
        StepParsing.TryGetTopLevelArgument(record, 0, out var value) &&
        !StepParsing.IsOmitted(value) && StepParsing.TrimStepString(value).Length > 0;

    private static string ReadStringArgument(ReadOnlySpan<byte> record, int index) =>
        StepParsing.TryGetTopLevelArgument(record, index, out var value) && !StepParsing.IsOmitted(value)
            ? StepParsing.DecodeStepString(value)
            : string.Empty;

    private static StringSlice WriteString(
        string value,
        Dictionary<string, StringSlice> strings,
        BinaryWriter writer,
        FileStream stream)
    {
        if (value.Length == 0) return default;
        if (strings.TryGetValue(value, out var existing)) return existing;
        var bytes = Encoding.UTF8.GetBytes(value);
        var offset = checked((uint)(stream.Position - ChunkHeaderBytes));
        writer.Write(bytes);
        var slice = new StringSlice(offset, checked((uint)bytes.Length));
        strings.Add(value, slice);
        return slice;
    }

    private static void WriteSlice(BinaryWriter writer, StringSlice slice)
    {
        writer.Write(slice.Offset);
        writer.Write(slice.Length);
    }

    private static FileStream CreateChunkStream(string path) =>
        new(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 1024 * 1024, FileOptions.SequentialScan);

    private static void WriteEmptyHeader(BinaryWriter writer) => writer.Write(new byte[ChunkHeaderBytes]);

    private static void CompleteHeader(FileStream stream, ushort kind, ulong payloadBytes, uint records)
    {
        if (checked((ulong)(stream.Length - ChunkHeaderBytes)) != payloadBytes)
            throw new InvalidDataException($"Chunk kind {kind} payload length is inconsistent.");
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

    private readonly record struct ParentRelation(int Parent, int[] Children);
    private readonly record struct StringSlice(uint Offset, uint Length);
    internal readonly record struct SemanticBuildResult(
        long Records,
        long ParentLinks,
        long Roots,
        long RepresentedProducts,
        long StringBytes,
        DeepSemanticChunkWriter.DeepSemanticBuildResult Deep)
    {
        public SemanticCoverageManifest ToManifest() =>
            new(
                "complete",
                Records,
                ParentLinks,
                Roots,
                RepresentedProducts,
                StringBytes,
                new DeepSemanticCoverageManifest(
                    "complete",
                    Deep.Records,
                    Deep.ProductsWithRelations,
                    Deep.RelationEdges,
                    Deep.ValueBytes,
                    Deep.MaximumRecordBytes));
    }
}
