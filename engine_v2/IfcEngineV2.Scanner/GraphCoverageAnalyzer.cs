using System.Buffers.Binary;
using System.Collections;
using System.IO.MemoryMappedFiles;
using System.Security.Cryptography;

namespace IfcEngineV2.Scanner;

internal static class GraphCoverageAnalyzer
{
    private const int IndexHeaderBytes = 4096;
    private const int IndexEntryBytes = 16;
    private const int IndexFooterBytes = 48;
    private const int MaximumReportedIssues = 50;

    public static unsafe GraphCoverageLedger Analyze(
        string sourcePath,
        string indexPath,
        long sourceLength,
        byte[] sourceSha256,
        long maximumExpressId,
        TypeRegistry registry,
        out int[] occurrenceCounts,
        out int[] representativeProductIds,
        out int[] productDefinitionIdsByProduct,
        out IReadOnlyDictionary<int, GeneratedMesh> generatedMeshes,
        IReadOnlyDictionary<int, GeneratedMesh>? csgOverrides = null)
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
        try
        {
            sourcePointer += sourceView.PointerOffset;
            indexPointer += indexView.PointerOffset;
            var source = new ReadOnlySpan<byte>(sourcePointer, checked((int)sourceLength));
            var index = new ReadOnlySpan<byte>(indexPointer, checked((int)indexLength));
            var entries = ValidateIndex(index, sourceLength, sourceSha256, maximumExpressId);
            return AnalyzeGraph(
                source,
                entries,
                maximumExpressId,
                registry,
                out occurrenceCounts,
                out representativeProductIds,
                out productDefinitionIdsByProduct,
                out generatedMeshes,
                csgOverrides);
        }
        finally
        {
            indexView.SafeMemoryMappedViewHandle.ReleasePointer();
            sourceView.SafeMemoryMappedViewHandle.ReleasePointer();
        }
    }

    public static GraphCoverageLedger NotRun(long productDefinitions) => new(
        "not-run",
        null,
        productDefinitions,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        ["Create an index to run graph coverage."],
        new ProductBindingLedger("not-run", 0, productDefinitions, 0, 0, 0, new Dictionary<string, long>(), ["Create an index to bind products."]),
        new GeometryPlanLedger(
            "not-run", null, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            new CoordinateAuditLedger("not-run", 0, 0, 0, 0, 0, 0, ["Create an index to decode coordinates."]),
            ["Create an index to plan geometry."]));

    private static GraphCoverageLedger AnalyzeGraph(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        long maximumExpressId,
        TypeRegistry registry,
        out int[] occurrenceCounts,
        out int[] representativeProductIds,
        out int[] productDefinitionIdsByProduct,
        out IReadOnlyDictionary<int, GeneratedMesh> generatedMeshes,
        IReadOnlyDictionary<int, GeneratedMesh>? csgOverrides)
    {
        var issues = new IssueCollector();
        var baseDefinitions = new BitArray(checked((int)maximumExpressId + 1));
        var productDefinitionIds = new BitArray(checked((int)maximumExpressId + 1));
        var representationMaps = new BitArray(checked((int)maximumExpressId + 1));
        occurrenceCounts = new int[checked((int)maximumExpressId + 1)];
        var representativeProductDefinitions = new int[checked((int)maximumExpressId + 1)];
        var baseOccurrences = new List<BaseOccurrence>();
        var mapCache = new Dictionary<int, MapResolution>();
        var placementResolver = new InstanceChunkWriter.PlacementResolver(source, entries, registry, checked((int)maximumExpressId + 1));
        var representationIds = new List<int>(4);
        var itemIds = new List<int>(4);
        using var checksum = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        Span<byte> checksumEntry = stackalloc byte[20];

        long productDefinitions = 0;
        long resolvedProducts = 0;
        long directProducts = 0;
        long mappedProducts = 0;
        long mixedProducts = 0;
        long directOccurrences = 0;
        long mappedItemOccurrences = 0;
        long expandedMappedOccurrences = 0;
        long uniqueBaseDefinitions = 0;
        long referencedMaps = 0;

        for (var expressId = 0; expressId <= maximumExpressId; expressId++)
        {
            if (!TryGetRecord(source, entries, expressId, out var productDefinition, out var typeId) ||
                registry[typeId].Kind != EntityKind.ProductDefinitionShape)
            {
                continue;
            }

            productDefinitions++;
            productDefinitionIds[checked((int)expressId)] = true;
            var issueCountBefore = issues.Total;
            var hasDirect = false;
            var hasMapped = false;
            if (!StepParsing.TryGetTopLevelArgument(productDefinition, 2, out var representations))
            {
                issues.Missing($"#{expressId} IFCProductDefinitionShape has no Representations argument.");
                continue;
            }
            StepParsing.CollectReferences(representations, representationIds);
            if (representationIds.Count == 0)
            {
                issues.Missing($"#{expressId} IFCProductDefinitionShape has no representation references.");
                continue;
            }

            foreach (var representationId in representationIds)
            {
                if (!TryGetRecord(source, entries, representationId, out var representation, out var representationTypeId) ||
                    registry[representationTypeId].Kind != EntityKind.ShapeRepresentation)
                {
                    issues.Missing($"#{expressId} references missing or invalid shape representation #{representationId}.");
                    continue;
                }
                if (RepresentationPolicy.IsAuxiliary(representation)) continue;
                if (!StepParsing.TryGetTopLevelArgument(representation, 3, out var items))
                {
                    issues.Missing($"Shape representation #{representationId} has no Items argument.");
                    continue;
                }
                StepParsing.CollectReferences(items, itemIds);
                if (itemIds.Count == 0)
                {
                    // An explicit empty Items set describes no render surface.
                    // Keep the product binding, but emit no mesh occurrence.
                    continue;
                }

                foreach (var itemId in itemIds)
                {
                    if (!TryGetRecord(source, entries, itemId, out var item, out var itemTypeId))
                    {
                        issues.Missing($"Shape representation #{representationId} references missing item #{itemId}.");
                        continue;
                    }
                    var itemKind = registry[itemTypeId].Kind;
                    if (IsBaseGeometry(itemKind))
                    {
                        hasDirect = true;
                        directOccurrences++;
                        AddBaseDefinition(baseDefinitions, itemId, ref uniqueBaseDefinitions);
                        baseOccurrences.Add(new BaseOccurrence(checked((int)expressId), itemId, false));
                        if (representativeProductDefinitions[itemId] == 0)
                            representativeProductDefinitions[itemId] = checked((int)expressId);
                        AppendChecksum(checksum, checksumEntry, checked((int)expressId), representationId, itemId, itemId, 0);
                    }
                    else if (itemKind == EntityKind.MappedItem)
                    {
                        hasMapped = true;
                        mappedItemOccurrences++;
                        ResolveMappedItem(
                            source,
                            entries,
                            registry,
                            placementResolver,
                            item,
                            itemId,
                            checked((int)expressId),
                            representationId,
                            mapCache,
                            representationMaps,
                            baseDefinitions,
                            occurrenceCounts,
                            baseOccurrences,
                            representativeProductDefinitions,
                            checksum,
                            checksumEntry,
                            issues,
                            ref referencedMaps,
                            ref uniqueBaseDefinitions,
                            ref expandedMappedOccurrences);
                    }
                    else
                    {
                        issues.Unsupported($"Shape representation #{representationId} uses {registry[itemTypeId].Name} #{itemId}.");
                    }
                }
            }

            if (issues.Total == issueCountBefore) resolvedProducts++;
            if (hasDirect) directProducts++;
            if (hasMapped) mappedProducts++;
            if (hasDirect && hasMapped) mixedProducts++;
        }

        var totalBaseDefinitions = registry.Entries
            .Where(entry => IsBaseGeometry(entry.Kind))
            .Sum(entry => entry.Count);
        var status = issues.Total == 0 && resolvedProducts == productDefinitions
            ? "complete"
            : "incomplete";
        var productBindings = ProductBindingAnalyzer.Analyze(
            source,
            entries,
            maximumExpressId,
            registry,
            productDefinitionIds,
            productDefinitions,
            out productDefinitionIdsByProduct,
            out var productOwnerCounts,
            out var firstProductOwnerIds);
        Array.Clear(occurrenceCounts);
        var definitionsWithGeometry = new BitArray(productDefinitionIds.Length);
        directOccurrences = 0;
        expandedMappedOccurrences = 0;
        foreach (var occurrence in baseOccurrences)
        {
            var owners = productOwnerCounts[occurrence.ProductDefinitionId];
            if (owners == 0) continue;
            // An external kernel can prove that a Boolean difference is empty.
            // Such an item has no visible geometry or product instance.
            if (csgOverrides is not null && csgOverrides.TryGetValue(occurrence.BaseId, out var external) &&
                external.Indices.Count == 0) continue;
            definitionsWithGeometry[occurrence.ProductDefinitionId] = true;
            occurrenceCounts[occurrence.BaseId] = checked(occurrenceCounts[occurrence.BaseId] + owners);
            if (occurrence.IsMapped) expandedMappedOccurrences = checked(expandedMappedOccurrences + owners);
            else directOccurrences = checked(directOccurrences + owners);
        }
        // Only bases with a real product owner can become drawable instances.
        // Exporter leftovers still appear in the inventory, but they must not
        // inflate the tessellation completeness target.
        uniqueBaseDefinitions = occurrenceCounts.Count(value => value > 0);
        // Auxiliary-only representations (for example an IfcGrid footprint) have
        // no mesh instance. Keep them in the source coverage ledger, but do not
        // emit empty ProductTable records that the renderer cannot consume.
        for (var productId = 0; productId < productDefinitionIdsByProduct.Length; productId++)
        {
            var definitionId = productDefinitionIdsByProduct[productId];
            if (definitionId != 0 && !definitionsWithGeometry[definitionId])
                productDefinitionIdsByProduct[productId] = 0;
        }
        representativeProductIds = new int[checked((int)maximumExpressId + 1)];
        for (var baseId = 0; baseId < representativeProductDefinitions.Length; baseId++)
        {
            var productDefinitionId = representativeProductDefinitions[baseId];
            if (productDefinitionId != 0) representativeProductIds[baseId] = firstProductOwnerIds[productDefinitionId];
        }
        var geometryPlan = GeometryPlanAnalyzer.Analyze(
            source,
            entries,
            maximumExpressId,
            registry,
            occurrenceCounts,
            uniqueBaseDefinitions,
            out generatedMeshes,
            csgOverrides);
        if (productBindings.Status != "complete" || geometryPlan.Status != "complete") status = "incomplete";
        return new GraphCoverageLedger(
            status,
            Convert.ToHexString(checksum.GetHashAndReset()),
            productDefinitions,
            resolvedProducts,
            directProducts,
            mappedProducts,
            mixedProducts,
            directOccurrences,
            mappedItemOccurrences,
            expandedMappedOccurrences,
            occurrenceCounts.Sum(value => (long)value),
            uniqueBaseDefinitions,
            totalBaseDefinitions - uniqueBaseDefinitions,
            referencedMaps,
            issues.MissingCount,
            issues.UnsupportedCount,
            issues.Messages,
            productBindings,
            geometryPlan);
    }

    private static void ResolveMappedItem(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        InstanceChunkWriter.PlacementResolver placementResolver,
        ReadOnlySpan<byte> mappedItem,
        int mappedItemId,
        int productDefinitionId,
        int parentRepresentationId,
        Dictionary<int, MapResolution> mapCache,
        BitArray representationMaps,
        BitArray baseDefinitions,
        int[] occurrenceCounts,
        List<BaseOccurrence> baseOccurrences,
        int[] representativeProductDefinitions,
        IncrementalHash checksum,
        Span<byte> checksumEntry,
        IssueCollector issues,
        ref long referencedMapCount,
        ref long uniqueBaseDefinitions,
        ref long expandedMappedOccurrences)
    {
        if (!StepParsing.TryGetTopLevelArgument(mappedItem, 0, out var sourceArgument) ||
            !StepParsing.TryReadSingleReference(sourceArgument, out var mapId))
        {
            issues.Missing($"IfcMappedItem #{mappedItemId} has no valid MappingSource.");
            return;
        }
        if (!StepParsing.TryGetTopLevelArgument(mappedItem, 1, out var targetArgument) ||
            !StepParsing.TryReadSingleReference(targetArgument, out var targetId) ||
            !TryGetRecord(source, entries, targetId, out _, out var targetTypeId) ||
            registry[targetTypeId].Kind != EntityKind.CartesianTransformationOperator3D)
        {
            issues.Unsupported($"IfcMappedItem #{mappedItemId} has an unsupported MappingTarget.");
            return;
        }
        if (!placementResolver.TryValidate(targetId, out var targetError))
        {
            issues.Unsupported($"IfcMappedItem #{mappedItemId} has an invalid MappingTarget #{targetId}: {targetError}");
            return;
        }

        if (!mapCache.TryGetValue(mapId, out var resolution))
        {
            resolution = ResolveRepresentationMap(source, entries, registry, placementResolver, mapId);
            mapCache.Add(mapId, resolution);
        }
        if (!resolution.IsValid)
        {
            issues.Unsupported($"IfcMappedItem #{mappedItemId} uses invalid map #{mapId}: {resolution.Error}");
            return;
        }
        if (!representationMaps[mapId])
        {
            representationMaps[mapId] = true;
            referencedMapCount++;
        }

        foreach (var baseId in resolution.BaseDefinitionIds)
        {
            AddBaseDefinition(baseDefinitions, baseId, ref uniqueBaseDefinitions);
            baseOccurrences.Add(new BaseOccurrence(productDefinitionId, baseId, true));
            if (representativeProductDefinitions[baseId] == 0)
                representativeProductDefinitions[baseId] = productDefinitionId;
            expandedMappedOccurrences++;
            AppendChecksum(checksum, checksumEntry, productDefinitionId, parentRepresentationId, mappedItemId, baseId, 1);
        }
    }

    private readonly record struct BaseOccurrence(int ProductDefinitionId, int BaseId, bool IsMapped);

    private static MapResolution ResolveRepresentationMap(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        InstanceChunkWriter.PlacementResolver placementResolver,
        int mapId)
    {
        if (!TryGetRecord(source, entries, mapId, out var map, out var mapTypeId) ||
            registry[mapTypeId].Kind != EntityKind.RepresentationMap)
        {
            return MapResolution.Invalid("missing IfcRepresentationMap");
        }
        string? originError = null;
        if (!StepParsing.TryGetTopLevelArgument(map, 0, out var originArgument) ||
            !StepParsing.TryReadSingleReference(originArgument, out var originId) ||
            !placementResolver.TryValidate(originId, out originError))
        {
            return MapResolution.Invalid($"invalid MappingOrigin: {originError ?? "missing placement"}");
        }
        if (!StepParsing.TryGetTopLevelArgument(map, 1, out var mappedRepresentationArgument) ||
            !StepParsing.TryReadSingleReference(mappedRepresentationArgument, out var representationId) ||
            !TryGetRecord(source, entries, representationId, out var representation, out var representationTypeId) ||
            registry[representationTypeId].Kind != EntityKind.ShapeRepresentation)
        {
            return MapResolution.Invalid("missing MappedRepresentation");
        }
        if (!StepParsing.TryGetTopLevelArgument(representation, 3, out var items))
        {
            return MapResolution.Invalid("mapped representation has no Items argument");
        }
        var itemIds = new List<int>(2);
        StepParsing.CollectReferences(items, itemIds);
        if (itemIds.Count == 0)
        {
            return MapResolution.Invalid("mapped representation has no items");
        }
        foreach (var itemId in itemIds)
        {
            if (!TryGetRecord(source, entries, itemId, out _, out var itemTypeId) || !IsBaseGeometry(registry[itemTypeId].Kind))
            {
                return MapResolution.Invalid($"mapped item #{itemId} is missing or unsupported");
            }
        }
        return new MapResolution(true, itemIds.ToArray(), null);
    }

    internal static bool TryGetRecord(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        long expressId,
        out ReadOnlySpan<byte> record,
        out ushort typeId)
    {
        record = default;
        typeId = 0;
        if (expressId < 0 || expressId * IndexEntryBytes + IndexEntryBytes > entries.Length) return false;
        var entry = entries.Slice(checked((int)(expressId * IndexEntryBytes)), IndexEntryBytes);
        if (BinaryPrimitives.ReadUInt16LittleEndian(entry[14..]) != 1) return false;
        var offset = BinaryPrimitives.ReadInt64LittleEndian(entry);
        var length = BinaryPrimitives.ReadInt32LittleEndian(entry[8..]);
        if (offset < 0 || length <= 0 || offset + length > source.Length) return false;
        typeId = BinaryPrimitives.ReadUInt16LittleEndian(entry[12..]);
        record = source.Slice(checked((int)offset), length);
        return true;
    }

    internal static ReadOnlySpan<byte> ValidateIndex(
        ReadOnlySpan<byte> index,
        long sourceLength,
        ReadOnlySpan<byte> sourceSha256,
        long maximumExpressId)
    {
        var entriesLength = checked((maximumExpressId + 1) * IndexEntryBytes);
        var expectedLength = checked(IndexHeaderBytes + entriesLength + IndexFooterBytes);
        if (index.Length != expectedLength) throw new InvalidDataException("Engine V2 index length is invalid.");
        var header = index[..IndexHeaderBytes];
        var entries = index.Slice(IndexHeaderBytes, checked((int)entriesLength));
        var footer = index[^IndexFooterBytes..];
        if (!header[..8].SequenceEqual("IFC2IDX2"u8)) throw new InvalidDataException("Engine V2 index magic is invalid.");
        if (BinaryPrimitives.ReadInt32LittleEndian(header[8..]) != 2) throw new InvalidDataException("Engine V2 index version is unsupported.");
        if (BinaryPrimitives.ReadInt32LittleEndian(header[12..]) != IndexEntryBytes) throw new InvalidDataException("Engine V2 index entry size is invalid.");
        if (BinaryPrimitives.ReadInt64LittleEndian(header[16..]) != sourceLength) throw new InvalidDataException("Engine V2 index source length does not match.");
        if (BinaryPrimitives.ReadInt64LittleEndian(header[24..]) != maximumExpressId) throw new InvalidDataException("Engine V2 index Express-ID range does not match.");
        if (!header[40..72].SequenceEqual(sourceSha256)) throw new InvalidDataException("Engine V2 index source checksum does not match.");
        if (!footer[..8].SequenceEqual("IFC2END2"u8) ||
            BinaryPrimitives.ReadInt64LittleEndian(footer[8..]) != BinaryPrimitives.ReadInt64LittleEndian(header[32..]))
            throw new InvalidDataException("Engine V2 index footer is invalid.");
        Span<byte> computedHash = stackalloc byte[32];
        SHA256.HashData(entries, computedHash);
        if (!footer[16..].SequenceEqual(computedHash)) throw new InvalidDataException("Engine V2 index entry checksum does not match.");
        return entries;
    }

    private static void AddBaseDefinition(BitArray definitions, int baseId, ref long uniqueCount)
    {
        if (definitions[baseId]) return;
        definitions[baseId] = true;
        uniqueCount++;
    }

    private static void AppendChecksum(
        IncrementalHash checksum,
        Span<byte> buffer,
        int productDefinitionId,
        int representationId,
        int itemId,
        int baseId,
        int mapped)
    {
        BinaryPrimitives.WriteInt32LittleEndian(buffer, productDefinitionId);
        BinaryPrimitives.WriteInt32LittleEndian(buffer[4..], representationId);
        BinaryPrimitives.WriteInt32LittleEndian(buffer[8..], itemId);
        BinaryPrimitives.WriteInt32LittleEndian(buffer[12..], baseId);
        BinaryPrimitives.WriteInt32LittleEndian(buffer[16..], mapped);
        checksum.AppendData(buffer);
    }

    internal static bool IsBaseGeometry(EntityKind kind) =>
        kind is EntityKind.FacetedBrep or EntityKind.ShellBasedSurfaceModel or EntityKind.ExtrudedAreaSolid or EntityKind.ExtrudedAreaSolidTapered or EntityKind.SweptDiskSolid or EntityKind.RevolvedAreaSolid or
            EntityKind.FaceBasedSurfaceModel or EntityKind.TriangulatedFaceSet or EntityKind.PolygonalFaceSet or
            EntityKind.BooleanClippingResult or EntityKind.BooleanResult;

    private sealed record MapResolution(bool IsValid, int[] BaseDefinitionIds, string? Error)
    {
        public static MapResolution Invalid(string error) => new(false, [], error);
    }

    private sealed class IssueCollector
    {
        private readonly List<string> _messages = [];
        public long MissingCount { get; private set; }
        public long UnsupportedCount { get; private set; }
        public long Total => MissingCount + UnsupportedCount;
        public IReadOnlyList<string> Messages => _messages;

        public void Missing(string message)
        {
            MissingCount++;
            Add(message);
        }

        public void Unsupported(string message)
        {
            UnsupportedCount++;
            Add(message);
        }

        private void Add(string message)
        {
            if (_messages.Count < MaximumReportedIssues) _messages.Add(message);
        }
    }
}
