using System.Buffers.Binary;
using System.Text;

namespace IfcEngineV2.Scanner;

internal static class InstanceChunkWriter
{
    private const int ChunkHeaderBytes = 32;
    private const ushort ChunkVersion = 1;
    private const ushort InstanceChunkKind = 4;
    private const ushort ProductChunkKind = 5;
    private const ushort InstanceMaterialChunkKind = 7;
    private const int InstanceRecordBytes = 112;
    private const int ProductRecordBytes = 24;
    private const int InstanceMaterialRecordBytes = 4;
    private const uint MappedInstanceFlag = 1;
    private static readonly byte[] ChunkMagic = "IFCV2CHK"u8.ToArray();

    public static InstanceBuildResult Write(
        string directory,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int[] productDefinitionIdsByProduct,
        GraphCoverageLedger coverage)
    {
        var lengthUnitScale = ResolveLengthUnitScale(source, entries, productDefinitionIdsByProduct.Length, registry);
        var sourceToViewer = new double[]
        {
            lengthUnitScale, 0, 0, 0,
            0, 0, -lengthUnitScale, 0,
            0, lengthUnitScale, 0, 0,
            0, 0, 0, 1,
        };
        var resolver = new PlacementResolver(source, entries, registry, productDefinitionIdsByProduct.Length);
        var representationIds = new List<int>(4);
        var itemIds = new List<int>(4);
        var mapCache = new Dictionary<int, MapDefinition>();
        var materialResolver = new MaterialChunkWriter.Resolver(source, entries, registry, productDefinitionIdsByProduct.Length);
        var instancePath = Path.Combine(directory, "instances.ifcv2");
        var productPath = Path.Combine(directory, "products.ifcv2");
        var instanceMaterialPath = Path.Combine(directory, "instance-materials.ifcv2");
        using var instanceStream = CreateChunkStream(instancePath);
        using var productStream = CreateChunkStream(productPath);
        using var instanceMaterialStream = CreateChunkStream(instanceMaterialPath);
        using var instanceWriter = new BinaryWriter(instanceStream, Encoding.UTF8, leaveOpen: true);
        using var productWriter = new BinaryWriter(productStream, Encoding.UTF8, leaveOpen: true);
        using var instanceMaterialWriter = new BinaryWriter(instanceMaterialStream, Encoding.UTF8, leaveOpen: true);
        WriteEmptyHeader(instanceWriter);
        WriteEmptyHeader(productWriter);
        WriteEmptyHeader(instanceMaterialWriter);

        long instanceCount = 0;
        long productCount = 0;
        for (var productId = 0; productId < productDefinitionIdsByProduct.Length; productId++)
        {
            var productDefinitionId = productDefinitionIdsByProduct[productId];
            if (productDefinitionId == 0) continue;
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, productId, out var product, out var productTypeId))
            {
                throw new InvalidDataException($"Product #{productId} is missing from the index.");
            }
            string? placementError = null;
            if (!StepParsing.TryGetTopLevelArgument(product, 5, out var placementArgument) ||
                !StepParsing.TryReadSingleReference(placementArgument, out var placementId) ||
                !resolver.TryResolve(placementId, out var productPlacement, out placementError))
            {
                throw new InvalidDataException($"Product #{productId} has an invalid placement: {placementError ?? "missing IfcLocalPlacement"}.");
            }
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, productDefinitionId, out var productDefinition, out var productDefinitionTypeId) ||
                registry[productDefinitionTypeId].Kind != EntityKind.ProductDefinitionShape ||
                !StepParsing.TryGetTopLevelArgument(productDefinition, 2, out var representationsArgument))
            {
                throw new InvalidDataException($"Product #{productId} references invalid IfcProductDefinitionShape #{productDefinitionId}.");
            }

            var firstInstance = instanceCount;
            StepParsing.CollectReferences(representationsArgument, representationIds);
            foreach (var representationId in representationIds)
            {
                if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, representationId, out var representation, out var representationTypeId) ||
                    registry[representationTypeId].Kind != EntityKind.ShapeRepresentation ||
                    !StepParsing.TryGetTopLevelArgument(representation, 3, out var itemsArgument))
                {
                    throw new InvalidDataException($"Product #{productId} references invalid shape representation #{representationId}.");
                }
                if (RepresentationPolicy.IsAuxiliary(representation)) continue;
                StepParsing.CollectReferences(itemsArgument, itemIds);
                foreach (var itemId in itemIds)
                {
                    if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, itemId, out var item, out var itemTypeId))
                    {
                        throw new InvalidDataException($"Shape representation #{representationId} references missing item #{itemId}.");
                    }
                    var itemKind = registry[itemTypeId].Kind;
                    if (GraphCoverageAnalyzer.IsBaseGeometry(itemKind))
                    {
                        WriteInstance(instanceWriter, productId, itemId, itemId, 0, productPlacement);
                        instanceMaterialWriter.Write(materialResolver.ResolveInstance(productId, itemId, itemId));
                        instanceCount++;
                    }
                    else if (itemKind == EntityKind.MappedItem)
                    {
                        WriteMappedInstances(
                            instanceWriter,
                            source,
                            entries,
                            registry,
                            productId,
                            itemId,
                            item,
                            productPlacement,
                            ref resolver,
                            ref materialResolver,
                            instanceMaterialWriter,
                            mapCache,
                            ref instanceCount);
                    }
                    else
                    {
                        throw new InvalidDataException($"Shape representation #{representationId} contains unsupported {registry[itemTypeId].Name} #{itemId}.");
                    }
                }
            }

            var productInstances = checked(instanceCount - firstInstance);
            if (productInstances <= 0 || productInstances > int.MaxValue)
            {
                throw new InvalidDataException($"Product #{productId} produced an invalid instance range.");
            }
            WriteProduct(
                productWriter,
                productId,
                productDefinitionId,
                firstInstance,
                checked((int)productInstances),
                productTypeId);
            productCount++;
        }

        var expectedProducts = productDefinitionIdsByProduct.LongCount(value => value != 0);
        if (productCount != expectedProducts)
        {
            throw new InvalidDataException($"Product-table coverage mismatch: expected {expectedProducts:N0}, wrote {productCount:N0}.");
        }
        if (instanceCount != coverage.GeometryPlan.ExpandedGeometryOccurrences)
        {
            throw new InvalidDataException($"Instance coverage mismatch: expected {coverage.GeometryPlan.ExpandedGeometryOccurrences:N0}, wrote {instanceCount:N0}.");
        }
        CompleteHeader(
            instanceStream,
            InstanceChunkKind,
            checked((ulong)instanceCount * InstanceRecordBytes),
            checked((uint)instanceCount));
        CompleteHeader(
            productStream,
            ProductChunkKind,
            checked((ulong)productCount * ProductRecordBytes),
            checked((uint)productCount));
        CompleteHeader(
            instanceMaterialStream,
            InstanceMaterialChunkKind,
            checked((ulong)instanceCount * InstanceMaterialRecordBytes),
            checked((uint)instanceCount));
        var materials = materialResolver.Complete(directory, instanceCount);
        return new InstanceBuildResult(productCount, instanceCount, lengthUnitScale, sourceToViewer, materials);
    }

    private static void WriteMappedInstances(
        BinaryWriter writer,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int productId,
        int mappedItemId,
        ReadOnlySpan<byte> mappedItem,
        AffineMatrix productPlacement,
        ref PlacementResolver resolver,
        ref MaterialChunkWriter.Resolver materialResolver,
        BinaryWriter instanceMaterialWriter,
        Dictionary<int, MapDefinition> mapCache,
        ref long instanceCount)
    {
        string? targetError = null;
        if (!StepParsing.TryGetTopLevelArgument(mappedItem, 0, out var mapArgument) ||
            !StepParsing.TryReadSingleReference(mapArgument, out var mapId) ||
            !StepParsing.TryGetTopLevelArgument(mappedItem, 1, out var targetArgument) ||
            !StepParsing.TryReadSingleReference(targetArgument, out var targetId) ||
            !resolver.TryResolve(targetId, out var target, out targetError))
        {
            throw new InvalidDataException($"IfcMappedItem #{mappedItemId} is invalid: {targetError ?? "missing map or target"}.");
        }
        if (!mapCache.TryGetValue(mapId, out var map))
        {
            map = ResolveMap(source, entries, registry, mapId);
            mapCache.Add(mapId, map);
        }
        if (!resolver.TryResolve(map.OriginPlacementId, out var mapOrigin, out var originError))
        {
            throw new InvalidDataException($"IfcRepresentationMap #{mapId} has an invalid MappingOrigin: {originError}.");
        }
        var transform = productPlacement.Multiply(target).Multiply(mapOrigin);
        foreach (var baseId in map.BaseDefinitionIds)
        {
            WriteInstance(writer, productId, baseId, mappedItemId, MappedInstanceFlag, transform);
            instanceMaterialWriter.Write(materialResolver.ResolveInstance(productId, mappedItemId, baseId));
            instanceCount++;
        }
    }

    private static MapDefinition ResolveMap(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        TypeRegistry registry,
        int mapId)
    {
        if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, mapId, out var map, out var mapTypeId) ||
            registry[mapTypeId].Kind != EntityKind.RepresentationMap ||
            !StepParsing.TryGetTopLevelArgument(map, 0, out var originArgument) ||
            !StepParsing.TryReadSingleReference(originArgument, out var originId) ||
            !StepParsing.TryGetTopLevelArgument(map, 1, out var representationArgument) ||
            !StepParsing.TryReadSingleReference(representationArgument, out var representationId) ||
            !GraphCoverageAnalyzer.TryGetRecord(source, entries, representationId, out var representation, out var representationTypeId) ||
            registry[representationTypeId].Kind != EntityKind.ShapeRepresentation ||
            !StepParsing.TryGetTopLevelArgument(representation, 3, out var itemsArgument))
        {
            throw new InvalidDataException($"IfcRepresentationMap #{mapId} is invalid.");
        }
        var itemIds = new List<int>(2);
        StepParsing.CollectReferences(itemsArgument, itemIds);
        if (itemIds.Count == 0)
        {
            throw new InvalidDataException($"IfcRepresentationMap #{mapId} has no base definitions.");
        }
        foreach (var itemId in itemIds)
        {
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, itemId, out _, out var itemTypeId) ||
                !GraphCoverageAnalyzer.IsBaseGeometry(registry[itemTypeId].Kind))
            {
                throw new InvalidDataException($"IfcRepresentationMap #{mapId} references unsupported base definition #{itemId}.");
            }
        }
        return new MapDefinition(originId, itemIds.ToArray());
    }

    internal static double ResolveLengthUnitScale(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        int expressIdRange,
        TypeRegistry registry)
    {
        for (var expressId = 0; expressId < expressIdRange; expressId++)
        {
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, expressId, out var assignment, out var assignmentTypeId) ||
                registry[assignmentTypeId].Kind != EntityKind.UnitAssignment ||
                !StepParsing.TryGetTopLevelArgument(assignment, 0, out var unitsArgument))
            {
                continue;
            }
            var unitIds = new List<int>(16);
            StepParsing.CollectReferences(unitsArgument, unitIds);
            foreach (var unitId in unitIds)
            {
                if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, unitId, out var unit, out var unitTypeId) ||
                    registry[unitTypeId].Kind != EntityKind.SiUnit ||
                    !StepParsing.TryGetTopLevelArgument(unit, 1, out var measureType) ||
                    StepParsing.AsciiUpperString(StepParsing.Trim(measureType)) != ".LENGTHUNIT." ||
                    !StepParsing.TryGetTopLevelArgument(unit, 3, out var unitName) ||
                    StepParsing.AsciiUpperString(StepParsing.Trim(unitName)) != ".METRE.")
                {
                    continue;
                }
                if (!StepParsing.TryGetTopLevelArgument(unit, 2, out var prefix) || StepParsing.IsOmitted(prefix))
                {
                    return 1;
                }
                return StepParsing.AsciiUpperString(StepParsing.Trim(prefix)) switch
                {
                    ".EXA." => 1e18,
                    ".PETA." => 1e15,
                    ".TERA." => 1e12,
                    ".GIGA." => 1e9,
                    ".MEGA." => 1e6,
                    ".KILO." => 1e3,
                    ".HECTO." => 1e2,
                    ".DECA." => 1e1,
                    ".DECI." => 1e-1,
                    ".CENTI." => 1e-2,
                    ".MILLI." => 1e-3,
                    ".MICRO." => 1e-6,
                    ".NANO." => 1e-9,
                    ".PICO." => 1e-12,
                    ".FEMTO." => 1e-15,
                    ".ATTO." => 1e-18,
                    _ => throw new InvalidDataException($"IfcSIUnit #{unitId} has unsupported length prefix {Encoding.ASCII.GetString(prefix)}."),
                };
            }
        }
        throw new InvalidDataException("IFC has no supported SI length unit.");
    }

    private static void WriteInstance(
        BinaryWriter writer,
        int productId,
        int baseId,
        int sourceItemId,
        uint flags,
        AffineMatrix transform)
    {
        if (!transform.IsFinite) throw new InvalidDataException($"Instance for product #{productId} has a non-finite transform.");
        writer.Write(productId);
        writer.Write(baseId);
        writer.Write(sourceItemId);
        writer.Write(flags);
        transform.Write3X4(writer);
    }

    private static void WriteProduct(
        BinaryWriter writer,
        int productId,
        int productDefinitionId,
        long firstInstance,
        int instanceCount,
        ushort productTypeId)
    {
        writer.Write(productId);
        writer.Write(productDefinitionId);
        writer.Write(firstInstance);
        writer.Write(instanceCount);
        writer.Write(productTypeId);
        writer.Write((ushort)0);
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

    private readonly record struct MapDefinition(int OriginPlacementId, int[] BaseDefinitionIds);

    internal ref struct PlacementResolver
    {
        private const int MaximumNestingDepth = 128;
        private readonly ReadOnlySpan<byte> _source;
        private readonly ReadOnlySpan<byte> _entries;
        private readonly TypeRegistry _registry;
        private readonly int[] _matrixOrdinals;
        private readonly List<AffineMatrix> _matrices;
        private int _activeDepth;

        public PlacementResolver(
            ReadOnlySpan<byte> source,
            ReadOnlySpan<byte> entries,
            TypeRegistry registry,
            int expressIdRange)
        {
            _source = source;
            _entries = entries;
            _registry = registry;
            _matrixOrdinals = new int[expressIdRange];
            _matrices = new List<AffineMatrix>(Math.Min(expressIdRange, 1024 * 1024));
        }

        public bool TryValidate(int expressId, out string? error) => TryResolve(expressId, out _, out error);

        internal bool TryResolve(int expressId, out AffineMatrix matrix, out string? error)
        {
            matrix = AffineMatrix.Identity;
            error = null;
            if ((uint)expressId >= (uint)_matrixOrdinals.Length)
            {
                error = $"placement #{expressId} is outside the index";
                return false;
            }
            var stored = _matrixOrdinals[expressId];
            if (stored > 0)
            {
                matrix = _matrices[stored - 1];
                return true;
            }
            if (stored == -1)
            {
                error = $"placement cycle at #{expressId}";
                return false;
            }
            if (stored == -2)
            {
                error = $"placement #{expressId} was previously rejected";
                return false;
            }
            if (_activeDepth >= MaximumNestingDepth)
            {
                error = $"placement nesting at #{expressId} exceeds the {MaximumNestingDepth}-level safety limit";
                return false;
            }
            _matrixOrdinals[expressId] = -1;
            _activeDepth++;
            try
            {
                if (!GraphCoverageAnalyzer.TryGetRecord(_source, _entries, expressId, out var record, out var typeId))
                {
                    return Fail(expressId, $"placement #{expressId} is missing", out matrix, out error);
                }

                var kind = _registry[typeId].Kind;
                var success = kind switch
                {
                    EntityKind.LocalPlacement => TryResolveLocal(record, out matrix, out error),
                    EntityKind.Axis2Placement3D => TryResolveAxis(record, out matrix, out error),
                    EntityKind.CartesianTransformationOperator3D => TryResolveOperator(record, out matrix, out error),
                    _ => Fail(expressId, $"{_registry[typeId].Name} #{expressId} is not a supported placement", out matrix, out error),
                };
                if (!success)
                {
                    _matrixOrdinals[expressId] = -2;
                    return false;
                }
                if (!matrix.IsFinite)
                {
                    return Fail(expressId, $"placement #{expressId} is non-finite", out matrix, out error);
                }
                _matrices.Add(matrix);
                _matrixOrdinals[expressId] = _matrices.Count;
                return true;
            }
            finally
            {
                _activeDepth--;
            }
        }

        private bool TryResolveLocal(ReadOnlySpan<byte> record, out AffineMatrix matrix, out string? error)
        {
            matrix = AffineMatrix.Identity;
            error = null;
            var parent = AffineMatrix.Identity;
            if (!StepParsing.TryGetTopLevelArgument(record, 0, out var parentArgument))
            {
                error = "IfcLocalPlacement has no PlacementRelTo argument";
                return false;
            }
            if (!StepParsing.IsOmitted(parentArgument))
            {
                if (!StepParsing.TryReadSingleReference(parentArgument, out var parentId) ||
                    !TryResolve(parentId, out parent, out error))
                {
                    return false;
                }
            }
            if (!StepParsing.TryGetTopLevelArgument(record, 1, out var relativeArgument) ||
                !StepParsing.TryReadSingleReference(relativeArgument, out var relativeId) ||
                !TryResolve(relativeId, out var relative, out error))
            {
                error ??= "IfcLocalPlacement has no valid RelativePlacement";
                return false;
            }
            matrix = parent.Multiply(relative);
            return true;
        }

        private bool TryResolveAxis(ReadOnlySpan<byte> record, out AffineMatrix matrix, out string? error)
        {
            matrix = AffineMatrix.Identity;
            error = null;
            if (!TryReadVectorArgument(record, 0, required: true, new Vector3d(0, 0, 0), out var origin, out error) ||
                !TryReadVectorArgument(record, 1, required: false, new Vector3d(0, 0, 1), out var zAxis, out error) ||
                !TryReadVectorArgument(record, 2, required: false, new Vector3d(1, 0, 0), out var xAxis, out error) ||
                !zAxis.TryNormalize(out zAxis) ||
                !xAxis.TryNormalize(out xAxis))
            {
                error ??= "IfcAxis2Placement3D has invalid axes";
                return false;
            }
            var yAxis = zAxis.Cross(xAxis);
            if (!yAxis.TryNormalize(out yAxis))
            {
                error = "IfcAxis2Placement3D axes are parallel";
                return false;
            }
            xAxis = yAxis.Cross(zAxis);
            if (!xAxis.TryNormalize(out xAxis))
            {
                error = "IfcAxis2Placement3D cannot derive its X axis";
                return false;
            }
            matrix = new AffineMatrix(xAxis, yAxis, zAxis, origin);
            return true;
        }

        private bool TryResolveOperator(ReadOnlySpan<byte> record, out AffineMatrix matrix, out string? error)
        {
            matrix = AffineMatrix.Identity;
            error = null;
            if (!TryReadVectorArgument(record, 0, required: false, new Vector3d(1, 0, 0), out var xAxis, out error) ||
                !TryReadVectorArgument(record, 1, required: false, new Vector3d(0, 1, 0), out var yAxis, out error) ||
                !TryReadVectorArgument(record, 2, required: true, new Vector3d(0, 0, 0), out var origin, out error) ||
                !TryReadVectorArgument(record, 4, required: false, new Vector3d(0, 0, 1), out var zAxis, out error) ||
                !xAxis.TryNormalize(out xAxis) ||
                !yAxis.TryNormalize(out yAxis) ||
                !zAxis.TryNormalize(out zAxis))
            {
                error ??= "IfcCartesianTransformationOperator3D has invalid axes";
                return false;
            }
            var scale = 1d;
            if (StepParsing.TryGetTopLevelArgument(record, 3, out var scaleArgument) &&
                !StepParsing.IsOmitted(scaleArgument) &&
                (!StepParsing.TryParseDouble(scaleArgument, out scale) || !double.IsFinite(scale)))
            {
                error = "IfcCartesianTransformationOperator3D has an invalid scale";
                return false;
            }
            matrix = new AffineMatrix(xAxis.Scale(scale), yAxis.Scale(scale), zAxis.Scale(scale), origin);
            return true;
        }

        private bool TryReadVectorArgument(
            ReadOnlySpan<byte> record,
            int argumentIndex,
            bool required,
            Vector3d defaultValue,
            out Vector3d vector,
            out string? error)
        {
            vector = defaultValue;
            error = null;
            if (!StepParsing.TryGetTopLevelArgument(record, argumentIndex, out var argument))
            {
                if (!required) return true;
                error = $"missing placement argument {argumentIndex}";
                return false;
            }
            if (StepParsing.IsOmitted(argument))
            {
                if (!required) return true;
                error = $"omitted placement argument {argumentIndex}";
                return false;
            }
            if (!StepParsing.TryReadSingleReference(argument, out var vectorId) ||
                !GraphCoverageAnalyzer.TryGetRecord(_source, _entries, vectorId, out var vectorRecord, out var vectorTypeId) ||
                _registry[vectorTypeId].Kind is not (EntityKind.CartesianPoint or EntityKind.Direction) ||
                !StepParsing.TryGetTopLevelArgument(vectorRecord, 0, out var valuesArgument))
            {
                error = $"invalid vector reference in placement argument {argumentIndex}";
                return false;
            }
            Span<double> values = stackalloc double[3];
            if (!StepParsing.TryParseDoubleList(valuesArgument, values, out var count) || count is < 2 or > 3)
            {
                error = $"invalid vector #{vectorId}";
                return false;
            }
            vector = new Vector3d(values[0], values[1], count == 3 ? values[2] : 0);
            return vector.IsFinite;
        }

        private bool Fail(int expressId, string message, out AffineMatrix matrix, out string? error)
        {
            _matrixOrdinals[expressId] = -2;
            matrix = AffineMatrix.Identity;
            error = message;
            return false;
        }
    }

    internal readonly record struct InstanceBuildResult(
        long Products,
        long Instances,
        double LengthUnitScaleToMetres,
        IReadOnlyList<double> SourceToViewerTransform,
        MaterialChunkWriter.MaterialBuildResult Materials);

    internal readonly record struct Vector3d(double X, double Y, double Z)
    {
        public bool IsFinite => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Z);
        public Vector3d Cross(Vector3d other) => new(
            Y * other.Z - Z * other.Y,
            Z * other.X - X * other.Z,
            X * other.Y - Y * other.X);
        public Vector3d Scale(double scale) => new(X * scale, Y * scale, Z * scale);
        public bool TryNormalize(out Vector3d normalized)
        {
            var length = Math.Sqrt(X * X + Y * Y + Z * Z);
            if (!double.IsFinite(length) || length <= 0)
            {
                normalized = default;
                return false;
            }
            normalized = new Vector3d(X / length, Y / length, Z / length);
            return true;
        }
    }

    internal readonly record struct AffineMatrix(
        Vector3d XAxis,
        Vector3d YAxis,
        Vector3d ZAxis,
        Vector3d Translation)
    {
        public static AffineMatrix Identity => new(
            new Vector3d(1, 0, 0),
            new Vector3d(0, 1, 0),
            new Vector3d(0, 0, 1),
            new Vector3d(0, 0, 0));

        public bool IsFinite => XAxis.IsFinite && YAxis.IsFinite && ZAxis.IsFinite && Translation.IsFinite;

        public AffineMatrix Multiply(AffineMatrix other) => new(
            TransformVector(other.XAxis),
            TransformVector(other.YAxis),
            TransformVector(other.ZAxis),
            TransformPoint(other.Translation));

        private Vector3d TransformVector(Vector3d value) => new(
            XAxis.X * value.X + YAxis.X * value.Y + ZAxis.X * value.Z,
            XAxis.Y * value.X + YAxis.Y * value.Y + ZAxis.Y * value.Z,
            XAxis.Z * value.X + YAxis.Z * value.Y + ZAxis.Z * value.Z);

        private Vector3d TransformPoint(Vector3d value)
        {
            var transformed = TransformVector(value);
            return new Vector3d(
                transformed.X + Translation.X,
                transformed.Y + Translation.Y,
                transformed.Z + Translation.Z);
        }

        public void Write3X4(BinaryWriter writer)
        {
            writer.Write(XAxis.X);
            writer.Write(XAxis.Y);
            writer.Write(XAxis.Z);
            writer.Write(YAxis.X);
            writer.Write(YAxis.Y);
            writer.Write(YAxis.Z);
            writer.Write(ZAxis.X);
            writer.Write(ZAxis.Y);
            writer.Write(ZAxis.Z);
            writer.Write(Translation.X);
            writer.Write(Translation.Y);
            writer.Write(Translation.Z);
        }
    }
}
