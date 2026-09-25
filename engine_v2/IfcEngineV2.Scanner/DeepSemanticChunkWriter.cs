using System.Buffers;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace IfcEngineV2.Scanner;

/// <summary>
/// Writes a sorted product-to-payload index plus independently addressable JSON
/// payloads. The browser loads the small index once and range-reads only the
/// selected products from the value chunk.
/// </summary>
internal static class DeepSemanticChunkWriter
{
    private const int ChunkHeaderBytes = 32;
    private const ushort ChunkVersion = 1;
    private const ushort DeepIndexChunkKind = 12;
    private const ushort DeepValueChunkKind = 13;
    private const int DeepIndexRecordBytes = 24;
    private const int MaximumProductPayloadBytes = 8 * 1024 * 1024;
    private static readonly byte[] ChunkMagic = "IFCV2CHK"u8.ToArray();

    private enum RelationGroup : byte
    {
        PropertyDefinition = 1,
        Type = 2,
        Material = 3,
        Classification = 4,
    }

    private readonly record struct RelationEdge(int ObjectId, int TargetId, RelationGroup Group);

    public static DeepSemanticBuildResult Write(
        string directory,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int[] productDefinitionIdsByProduct,
        double lengthUnitScaleToMetres)
    {
        var units = ResolveUnitScales(source, entries, registry, lengthUnitScaleToMetres);
        var products = productDefinitionIdsByProduct
            .Select((productDefinitionId, productId) => (productDefinitionId, productId))
            .Where(item => item.productDefinitionId > 0)
            .Select(item => item.productId)
            .ToArray();
        var edges = CollectRelations(source, entries, registry);
        edges.Sort(static (left, right) =>
        {
            var byObject = left.ObjectId.CompareTo(right.ObjectId);
            if (byObject != 0) return byObject;
            var byGroup = left.Group.CompareTo(right.Group);
            return byGroup != 0 ? byGroup : left.TargetId.CompareTo(right.TargetId);
        });

        var indexPath = Path.Combine(directory, "semantic-deep-index.ifcv2");
        var valuePath = Path.Combine(directory, "semantic-deep-values.ifcv2");
        using var indexStream = CreateChunkStream(indexPath);
        using var valueStream = CreateChunkStream(valuePath);
        using var indexWriter = new BinaryWriter(indexStream, Encoding.UTF8, leaveOpen: true);
        using var valueWriter = new BinaryWriter(valueStream, Encoding.UTF8, leaveOpen: true);
        WriteEmptyHeader(indexWriter);
        WriteEmptyHeader(valueWriter);

        var buffer = new ArrayBufferWriter<byte>(4096);
        long maximumRecordBytes = 0;
        long productsWithRelations = 0;
        foreach (var productId in products)
        {
            buffer.Clear();
            using (var json = new Utf8JsonWriter(buffer, new JsonWriterOptions { SkipValidation = false }))
            {
                WriteProductPayload(json, productId, edges, source, entries, registry, units, out var hasRelations);
                json.Flush();
                if (hasRelations) productsWithRelations++;
            }
            if (buffer.WrittenCount > MaximumProductPayloadBytes)
                throw new InvalidDataException($"Semantic payload for product #{productId} exceeds {MaximumProductPayloadBytes:N0} bytes.");
            var offset = checked((ulong)(valueStream.Position - ChunkHeaderBytes));
            valueWriter.Write(buffer.WrittenSpan);
            indexWriter.Write(productId);
            indexWriter.Write(0u);
            indexWriter.Write(offset);
            indexWriter.Write(checked((uint)buffer.WrittenCount));
            indexWriter.Write(0u);
            maximumRecordBytes = Math.Max(maximumRecordBytes, buffer.WrittenCount);
        }

        var valueBytes = valueStream.Length - ChunkHeaderBytes;
        CompleteHeader(indexStream, DeepIndexChunkKind, checked((ulong)products.Length * DeepIndexRecordBytes), checked((uint)products.Length));
        CompleteHeader(valueStream, DeepValueChunkKind, checked((ulong)valueBytes), checked((uint)valueBytes));
        return new DeepSemanticBuildResult(
            products.Length,
            productsWithRelations,
            edges.Count,
            valueBytes,
            maximumRecordBytes);
    }

    private static List<RelationEdge> CollectRelations(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry)
    {
        var edges = new List<RelationEdge>();
        var related = new List<int>();
        var maximumExpressId = entries.Length / 16 - 1;
        for (var expressId = 0; expressId <= maximumExpressId; expressId++)
        {
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, expressId, out var record, out var typeId)) continue;
            var group = registry[typeId].Name switch
            {
                "IFCRELDEFINESBYPROPERTIES" => RelationGroup.PropertyDefinition,
                "IFCRELDEFINESBYTYPE" => RelationGroup.Type,
                "IFCRELASSOCIATESMATERIAL" => RelationGroup.Material,
                "IFCRELASSOCIATESCLASSIFICATION" => RelationGroup.Classification,
                _ => (RelationGroup)0,
            };
            if (group == 0 || !StepParsing.TryGetTopLevelArgument(record, 4, out var relatedArgument) ||
                !StepParsing.TryGetTopLevelArgument(record, 5, out var targetArgument) ||
                !StepParsing.TryReadSingleReference(targetArgument, out var targetId)) continue;
            StepParsing.CollectReferences(relatedArgument, related);
            foreach (var objectId in related)
            {
                if (objectId > 0 && targetId > 0) edges.Add(new RelationEdge(objectId, targetId, group));
            }
        }
        return edges;
    }

    private static void WriteProductPayload(
        Utf8JsonWriter writer,
        int productId,
        List<RelationEdge> edges,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        UnitScales units,
        out bool hasRelations)
    {
        var direct = RelationSlice(edges, productId);
        var typeIds = Targets(direct, RelationGroup.Type);
        var propertyIds = Targets(direct, RelationGroup.PropertyDefinition);
        foreach (var typeId in typeIds)
        {
            if (!TryEntity(source, entries, registry, typeId, out var typeRecord, out _)) continue;
            if (StepParsing.TryGetTopLevelArgument(typeRecord, 5, out var propertySetArgument))
            {
                var references = new List<int>();
                StepParsing.CollectReferences(propertySetArgument, references);
                propertyIds.AddRange(references);
            }
        }

        var materialIds = Targets(direct, RelationGroup.Material);
        var classificationIds = Targets(direct, RelationGroup.Classification);
        foreach (var typeId in typeIds)
        {
            var inherited = RelationSlice(edges, typeId);
            materialIds.AddRange(Targets(inherited, RelationGroup.Material));
            classificationIds.AddRange(Targets(inherited, RelationGroup.Classification));
        }

        propertyIds = propertyIds.Distinct().Order().ToList();
        typeIds = typeIds.Distinct().Order().ToList();
        materialIds = materialIds.Distinct().Order().ToList();
        classificationIds = classificationIds.Distinct().Order().ToList();
        hasRelations = propertyIds.Count + typeIds.Count + materialIds.Count + classificationIds.Count > 0;

        writer.WriteStartObject();
        if (typeIds.Count > 0)
        {
            writer.WritePropertyName("type");
            WriteIdentity(writer, typeIds[0], source, entries, registry, unwrapMaterialUsage: false);
        }
        if (materialIds.Count > 0)
        {
            writer.WritePropertyName("material");
            WriteIdentity(writer, materialIds[0], source, entries, registry, unwrapMaterialUsage: true);
        }

        var hasArea = false;
        var hasVolume = false;
        var hasMass = false;
        WritePropertyDefinitions(writer, propertyIds, source, entries, registry, units, ref hasArea, ref hasVolume, ref hasMass);
        if (classificationIds.Count > 0)
        {
            writer.WritePropertyName("classifications");
            writer.WriteStartArray();
            foreach (var classificationId in classificationIds)
                WriteClassification(writer, classificationId, source, entries, registry);
            writer.WriteEndArray();
        }
        writer.WritePropertyName("units");
        writer.WriteStartObject();
        writer.WriteString("lengthUnit", "m");
        writer.WriteNumber("projectLengthUnitScaleToMeters", units.Length);
        if (hasArea) writer.WriteString("areaUnit", "m2");
        if (hasVolume) writer.WriteString("volumeUnit", "m3");
        if (hasMass) writer.WriteString("massUnit", "kg");
        writer.WriteEndObject();
        writer.WriteEndObject();
    }

    private static void WritePropertyDefinitions(
        Utf8JsonWriter writer,
        List<int> propertyIds,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        UnitScales units,
        ref bool hasArea,
        ref bool hasVolume,
        ref bool hasMass)
    {
        var propertySets = new List<(int Id, string Name, ReadOnlyMemory<byte> Record)>();
        var quantitySets = new List<(int Id, string Name, ReadOnlyMemory<byte> Record)>();
        foreach (var definitionId in propertyIds)
        {
            if (!TryEntity(source, entries, registry, definitionId, out var definition, out var typeName)) continue;
            var name = ReadStringArgument(definition, 2);
            var copy = definition.ToArray();
            if (typeName == "IFCPROPERTYSET") propertySets.Add((definitionId, name, copy));
            else if (typeName == "IFCELEMENTQUANTITY") quantitySets.Add((definitionId, name, copy));
        }

        if (propertySets.Count > 0)
        {
            writer.WritePropertyName("properties");
            writer.WriteStartObject();
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var (id, rawName, recordMemory) in propertySets)
            {
                var name = UniqueName(rawName, id, names);
                writer.WritePropertyName(name);
                writer.WriteStartObject();
                if (StepParsing.TryGetTopLevelArgument(recordMemory.Span, 4, out var propertiesArgument))
                {
                    var references = new List<int>();
                    StepParsing.CollectReferences(propertiesArgument, references);
                    var propertyNames = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var propertyId in references)
                        WriteProperty(writer, propertyId, propertyNames, source, entries, registry);
                }
                writer.WriteNumber("id", id);
                writer.WriteEndObject();
            }
            writer.WriteEndObject();
        }

        if (quantitySets.Count > 0)
        {
            writer.WritePropertyName("quantities");
            writer.WriteStartObject();
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var (id, rawName, recordMemory) in quantitySets)
            {
                var name = UniqueName(rawName, id, names);
                writer.WritePropertyName(name);
                writer.WriteStartObject();
                if (StepParsing.TryGetTopLevelArgument(recordMemory.Span, 5, out var quantitiesArgument))
                {
                    var references = new List<int>();
                    StepParsing.CollectReferences(quantitiesArgument, references);
                    var quantityNames = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var quantityId in references)
                        WriteQuantity(writer, quantityId, quantityNames, source, entries, registry, units,
                            ref hasArea, ref hasVolume, ref hasMass);
                }
                writer.WriteNumber("id", id);
                writer.WriteEndObject();
            }
            writer.WriteEndObject();
        }
    }

    private static void WriteProperty(
        Utf8JsonWriter writer,
        int propertyId,
        HashSet<string> names,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry)
    {
        if (!TryEntity(source, entries, registry, propertyId, out var record, out var typeName)) return;
        var rawName = ReadStringArgument(record, 0);
        var name = UniqueName(rawName, propertyId, names);
        writer.WritePropertyName(name);
        switch (typeName)
        {
            case "IFCPROPERTYSINGLEVALUE":
                WriteArgumentValue(writer, record, 2);
                break;
            case "IFCPROPERTYENUMERATEDVALUE":
            case "IFCPROPERTYLISTVALUE":
                WriteArgumentValue(writer, record, 2);
                break;
            case "IFCPROPERTYBOUNDEDVALUE":
                writer.WriteStartObject();
                writer.WritePropertyName("UpperBoundValue");
                WriteArgumentValue(writer, record, 2);
                writer.WritePropertyName("LowerBoundValue");
                WriteArgumentValue(writer, record, 3);
                writer.WriteEndObject();
                break;
            case "IFCPROPERTYTABLEVALUE":
                writer.WriteStartObject();
                writer.WritePropertyName("DefiningValues");
                WriteArgumentValue(writer, record, 2);
                writer.WritePropertyName("DefinedValues");
                WriteArgumentValue(writer, record, 3);
                writer.WriteEndObject();
                break;
            case "IFCCOMPLEXPROPERTY":
                writer.WriteStartObject();
                if (StepParsing.TryGetTopLevelArgument(record, 3, out var nestedArgument))
                {
                    var nested = new List<int>();
                    StepParsing.CollectReferences(nestedArgument, nested);
                    var nestedNames = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var nestedId in nested) WriteProperty(writer, nestedId, nestedNames, source, entries, registry);
                }
                writer.WriteNumber("id", propertyId);
                writer.WriteEndObject();
                break;
            default:
                writer.WriteStringValue($"#{propertyId} {typeName}");
                break;
        }
    }

    private static void WriteQuantity(
        Utf8JsonWriter writer,
        int quantityId,
        HashSet<string> names,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        UnitScales units,
        ref bool hasArea,
        ref bool hasVolume,
        ref bool hasMass)
    {
        if (!TryEntity(source, entries, registry, quantityId, out var record, out var typeName)) return;
        var name = UniqueName(ReadStringArgument(record, 0), quantityId, names);
        writer.WritePropertyName(name);
        if (!StepParsing.TryGetTopLevelArgument(record, 3, out var valueArgument) ||
            !TryReadNumericValue(valueArgument, out var value))
        {
            writer.WriteNullValue();
            return;
        }
        var scale = QuantityScale(record, typeName, source, entries, registry, units);
        if (scale is null)
        {
            writer.WriteNumberValue(value);
            return;
        }
        value *= scale.Value;
        switch (typeName)
        {
            case "IFCQUANTITYLENGTH":
                break;
            case "IFCQUANTITYAREA":
                hasArea = true;
                break;
            case "IFCQUANTITYVOLUME":
                hasVolume = true;
                break;
            case "IFCQUANTITYWEIGHT":
                hasMass = true;
                break;
        }
        writer.WriteNumberValue(value);
    }

    private static double? QuantityScale(
        ReadOnlySpan<byte> record,
        string typeName,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        UnitScales units)
    {
        if (StepParsing.TryGetTopLevelArgument(record, 2, out var explicitArgument) &&
            StepParsing.TryReadSingleReference(explicitArgument, out var explicitUnit))
            return ResolveNamedUnitScale(explicitUnit, source, entries, registry, new HashSet<int>());
        return typeName switch
        {
            "IFCQUANTITYLENGTH" => units.Length,
            "IFCQUANTITYAREA" => units.Area,
            "IFCQUANTITYVOLUME" => units.Volume,
            "IFCQUANTITYWEIGHT" => units.Mass,
            _ => 1,
        };
    }

    private static UnitScales ResolveUnitScales(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        double lengthScale)
    {
        double? area = null;
        double? volume = null;
        double? mass = null;
        var maximumExpressId = entries.Length / 16 - 1;
        for (var expressId = 0; expressId <= maximumExpressId; expressId++)
        {
            if (!TryEntity(source, entries, registry, expressId, out var record, out var typeName) ||
                typeName != "IFCUNITASSIGNMENT" || !StepParsing.TryGetTopLevelArgument(record, 0, out var unitsArgument)) continue;
            var references = new List<int>();
            StepParsing.CollectReferences(unitsArgument, references);
            foreach (var unitId in references)
            {
                if (!TryEntity(source, entries, registry, unitId, out var unit, out _) ||
                    !StepParsing.TryGetTopLevelArgument(unit, 1, out var unitTypeArgument)) continue;
                var unitType = NormalizeEnum(unitTypeArgument);
                var scale = ResolveNamedUnitScale(unitId, source, entries, registry, new HashSet<int>());
                if (scale is null) continue;
                if (unitType == "AREAUNIT") area = scale;
                else if (unitType == "VOLUMEUNIT") volume = scale;
                else if (unitType == "MASSUNIT") mass = scale;
            }
            break;
        }
        return new UnitScales(lengthScale, area ?? lengthScale * lengthScale, volume ?? lengthScale * lengthScale * lengthScale, mass);
    }

    private static double? ResolveNamedUnitScale(
        int unitId,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        HashSet<int> visited)
    {
        if (!visited.Add(unitId) || !TryEntity(source, entries, registry, unitId, out var record, out var typeName)) return null;
        if (typeName == "IFCSIUNIT")
        {
            if (!StepParsing.TryGetTopLevelArgument(record, 1, out var unitTypeArgument) ||
                !StepParsing.TryGetTopLevelArgument(record, 3, out var nameArgument)) return null;
            var unitType = NormalizeEnum(unitTypeArgument);
            var name = NormalizeEnum(nameArgument);
            var prefix = StepParsing.TryGetTopLevelArgument(record, 2, out var prefixArgument)
                ? PrefixScale(NormalizeEnum(prefixArgument))
                : 1d;
            if (unitType == "MASSUNIT" && name == "GRAM") return prefix / 1000d;
            if (name.StartsWith("SQUARE_", StringComparison.Ordinal)) return prefix * prefix;
            if (name.StartsWith("CUBIC_", StringComparison.Ordinal)) return prefix * prefix * prefix;
            return prefix;
        }
        if (typeName == "IFCCONVERSIONBASEDUNIT" &&
            StepParsing.TryGetTopLevelArgument(record, 3, out var factorArgument) &&
            StepParsing.TryReadSingleReference(factorArgument, out var factorId) &&
            TryEntity(source, entries, registry, factorId, out var factor, out var factorType) &&
            factorType == "IFCMEASUREWITHUNIT" &&
            StepParsing.TryGetTopLevelArgument(factor, 0, out var valueArgument) &&
            TryReadNumericValue(valueArgument, out var value) &&
            StepParsing.TryGetTopLevelArgument(factor, 1, out var componentArgument) &&
            StepParsing.TryReadSingleReference(componentArgument, out var componentId))
        {
            var componentScale = ResolveNamedUnitScale(componentId, source, entries, registry, visited);
            return componentScale is null ? null : value * componentScale.Value;
        }
        return null;
    }

    private static string NormalizeEnum(ReadOnlySpan<byte> value)
    {
        value = StepParsing.Trim(value);
        if (value.Length >= 2 && value[0] == (byte)'.' && value[^1] == (byte)'.') value = value[1..^1];
        return StepParsing.AsciiUpperString(value);
    }

    private static double PrefixScale(string prefix) => prefix switch
    {
        "EXA" => 1e18,
        "PETA" => 1e15,
        "TERA" => 1e12,
        "GIGA" => 1e9,
        "MEGA" => 1e6,
        "KILO" => 1e3,
        "HECTO" => 1e2,
        "DECA" => 1e1,
        "DECI" => 1e-1,
        "CENTI" => 1e-2,
        "MILLI" => 1e-3,
        "MICRO" => 1e-6,
        "NANO" => 1e-9,
        "PICO" => 1e-12,
        "FEMTO" => 1e-15,
        "ATTO" => 1e-18,
        _ => 1d,
    };

    private static void WriteIdentity(
        Utf8JsonWriter writer,
        int expressId,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        bool unwrapMaterialUsage)
    {
        var visited = new HashSet<int>();
        while (unwrapMaterialUsage && visited.Add(expressId) &&
               TryEntity(source, entries, registry, expressId, out var usageRecord, out var usageType) &&
               usageType is "IFCMATERIALLAYERSETUSAGE" or "IFCMATERIALPROFILESETUSAGE" &&
               StepParsing.TryGetTopLevelArgument(usageRecord, 0, out var setArgument) &&
               StepParsing.TryReadSingleReference(setArgument, out var setId)) expressId = setId;

        writer.WriteStartObject();
        writer.WriteNumber("expressId", expressId);
        if (TryEntity(source, entries, registry, expressId, out var record, out var typeName))
        {
            writer.WriteString("ifcType", typeName);
            var nameIndex = typeName switch
            {
                "IFCMATERIAL" => 0,
                "IFCMATERIALLAYERSET" => 1,
                "IFCMATERIALPROFILESET" => 0,
                _ => 2,
            };
            var name = ReadStringArgument(record, nameIndex);
            if (string.IsNullOrEmpty(name) && typeName == "IFCMATERIALPROFILESET") name = FirstNestedMaterialName(record, 2, source, entries, registry);
            if (string.IsNullOrEmpty(name) && typeName == "IFCMATERIALLAYERSET") name = FirstNestedMaterialName(record, 0, source, entries, registry);
            if (!string.IsNullOrEmpty(name)) writer.WriteString("name", name);
        }
        writer.WriteEndObject();
    }

    private static string FirstNestedMaterialName(
        ReadOnlySpan<byte> record,
        int referenceArgumentIndex,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry)
    {
        if (!StepParsing.TryGetTopLevelArgument(record, referenceArgumentIndex, out var argument)) return string.Empty;
        var references = new List<int>();
        StepParsing.CollectReferences(argument, references);
        foreach (var reference in references)
        {
            if (!TryEntity(source, entries, registry, reference, out var nested, out var type)) continue;
            if (type == "IFCMATERIAL") return ReadStringArgument(nested, 0);
            var materialIndex = type is "IFCMATERIALPROFILE" or "IFCMATERIALLAYER" ? 2 : -1;
            if (type == "IFCMATERIALLAYER") materialIndex = 0;
            if (materialIndex < 0 || !StepParsing.TryGetTopLevelArgument(nested, materialIndex, out var materialArgument) ||
                !StepParsing.TryReadSingleReference(materialArgument, out var materialId) ||
                !TryEntity(source, entries, registry, materialId, out var material, out var materialType) || materialType != "IFCMATERIAL") continue;
            var name = ReadStringArgument(material, 0);
            if (!string.IsNullOrEmpty(name)) return name;
        }
        return string.Empty;
    }

    private static void WriteClassification(
        Utf8JsonWriter writer,
        int expressId,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry)
    {
        writer.WriteStartObject();
        writer.WriteNumber("expressId", expressId);
        if (TryEntity(source, entries, registry, expressId, out var record, out _))
        {
            var identification = ReadStringArgument(record, 1);
            var name = ReadStringArgument(record, 2);
            if (!string.IsNullOrEmpty(identification)) writer.WriteString("identification", identification);
            if (!string.IsNullOrEmpty(name)) writer.WriteString("name", name);
        }
        writer.WriteEndObject();
    }

    private static bool TryEntity(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int expressId,
        out ReadOnlySpan<byte> record,
        out string typeName)
    {
        typeName = string.Empty;
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, expressId, out record, out var typeId)) return false;
        typeName = registry[typeId].Name;
        return true;
    }

    private static List<RelationEdge> RelationSlice(List<RelationEdge> edges, int objectId)
    {
        var start = LowerBound(edges, objectId);
        var result = new List<RelationEdge>();
        for (var index = start; index < edges.Count && edges[index].ObjectId == objectId; index++) result.Add(edges[index]);
        return result;
    }

    private static int LowerBound(List<RelationEdge> edges, int objectId)
    {
        var low = 0;
        var high = edges.Count;
        while (low < high)
        {
            var middle = low + (high - low) / 2;
            if (edges[middle].ObjectId < objectId) low = middle + 1;
            else high = middle;
        }
        return low;
    }

    private static List<int> Targets(List<RelationEdge> edges, RelationGroup group) =>
        edges.Where(edge => edge.Group == group).Select(edge => edge.TargetId).ToList();

    private static string UniqueName(string name, int expressId, HashSet<string> used)
    {
        name = string.IsNullOrWhiteSpace(name) ? $"Element #{expressId}" : name;
        if (used.Add(name)) return name;
        var candidate = $"{name} #{expressId}";
        used.Add(candidate);
        return candidate;
    }

    private static string ReadStringArgument(ReadOnlySpan<byte> record, int index) =>
        StepParsing.TryGetTopLevelArgument(record, index, out var value) && !StepParsing.IsOmitted(value)
            ? StepParsing.DecodeStepString(value)
            : string.Empty;

    private static void WriteArgumentValue(Utf8JsonWriter writer, ReadOnlySpan<byte> record, int index)
    {
        if (!StepParsing.TryGetTopLevelArgument(record, index, out var value)) writer.WriteNullValue();
        else WriteStepValue(writer, value, 0);
    }

    private static void WriteStepValue(Utf8JsonWriter writer, ReadOnlySpan<byte> value, int depth)
    {
        value = StepParsing.Trim(value);
        if (depth > 8 || StepParsing.IsOmitted(value)) { writer.WriteNullValue(); return; }
        if (value.Length >= 2 && value[0] == (byte)'\'' && value[^1] == (byte)'\'')
        {
            writer.WriteStringValue(StepParsing.DecodeStepString(value));
            return;
        }
        if (StepParsing.TryParseLogical(value, out var logical)) { writer.WriteBooleanValue(logical); return; }
        if (TryReadNumericValue(value, out var number)) { writer.WriteNumberValue(number); return; }
        if (value.Length >= 2 && value[0] == (byte)'.' && value[^1] == (byte)'.')
        {
            writer.WriteStringValue(Encoding.ASCII.GetString(value[1..^1]));
            return;
        }
        if (value.Length > 2 && value[0] == (byte)'#')
        {
            writer.WriteStringValue(Encoding.ASCII.GetString(value));
            return;
        }
        var open = value.IndexOf((byte)'(');
        if (open >= 0 && value[^1] == (byte)')')
        {
            var typed = open > 0;
            if (typed && StepParsing.TryGetTopLevelArgument(value, 0, out var inner))
            {
                WriteStepValue(writer, inner, depth + 1);
                return;
            }
            writer.WriteStartArray();
            for (var index = 0; StepParsing.TryGetTopLevelArgument(value, index, out var item); index++)
                WriteStepValue(writer, item, depth + 1);
            writer.WriteEndArray();
            return;
        }
        writer.WriteStringValue(Encoding.UTF8.GetString(value));
    }

    private static bool TryReadNumericValue(ReadOnlySpan<byte> value, out double result)
    {
        value = StepParsing.Trim(value);
        if (StepParsing.TryParseDouble(value, out result)) return true;
        if (value.Length > 2 && value[^1] == (byte)')' && StepParsing.TryGetTopLevelArgument(value, 0, out var inner))
            return StepParsing.TryParseDouble(inner, out result);
        result = 0;
        return false;
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
        stream.Position = 0;
        stream.Write(header);
        stream.Flush(flushToDisk: true);
    }

    internal readonly record struct DeepSemanticBuildResult(
        long Records,
        long ProductsWithRelations,
        long RelationEdges,
        long ValueBytes,
        long MaximumRecordBytes);

    private readonly record struct UnitScales(
        double Length,
        double Area,
        double Volume,
        double? Mass);
}
