using System.Buffers.Binary;
using System.Text;

namespace IfcEngineV2.Scanner;

internal static class MaterialChunkWriter
{
    private const int ChunkHeaderBytes = 32;
    private const ushort ChunkVersion = 1;
    private const ushort MaterialChunkKind = 6;
    private const int MaterialRecordBytes = 32;
    private const uint DefaultMaterialFlag = 1;
    private const uint TransparentMaterialFlag = 2;
    private static readonly byte[] ChunkMagic = "IFCV2CHK"u8.ToArray();

    internal ref struct Resolver
    {
        private readonly ReadOnlySpan<byte> _source;
        private readonly ReadOnlySpan<byte> _entries;
        private readonly TypeRegistry _registry;
        private readonly int _expressIdRange;
        private readonly Dictionary<int, List<int>> _styledItemsByTarget;
        private readonly Dictionary<int, ResolvedMaterial?> _entityCache;
        private readonly Dictionary<MaterialKey, uint> _materialOrdinals;
        private readonly List<MaterialRecord> _materials;
        private readonly HashSet<int> _resolutionStack;
        private readonly List<string> _issues;
        private readonly List<int> _references;
        private readonly Dictionary<int, HashSet<int>> _materialAssociationsByProduct;
        private readonly HashSet<int> _materialsWithStyledRepresentation;
        private readonly Dictionary<int, List<int>> _materialRepresentationsByMaterial;
        private readonly Dictionary<int, bool> _materialAppearanceCache;
        private long _resolvedInstanceAssignments;
        private long _defaultInstanceAssignments;

        public Resolver(
            ReadOnlySpan<byte> source,
            ReadOnlySpan<byte> entries,
            TypeRegistry registry,
            int expressIdRange)
        {
            _source = source;
            _entries = entries;
            _registry = registry;
            _expressIdRange = expressIdRange;
            _styledItemsByTarget = new Dictionary<int, List<int>>();
            _entityCache = new Dictionary<int, ResolvedMaterial?>();
            _materialOrdinals = new Dictionary<MaterialKey, uint>();
            _materials = new List<MaterialRecord>();
            _resolutionStack = new HashSet<int>();
            _issues = new List<string>();
            _references = new List<int>(4);
            _materialAssociationsByProduct = new Dictionary<int, HashSet<int>>();
            _materialsWithStyledRepresentation = new HashSet<int>();
            _materialRepresentationsByMaterial = new Dictionary<int, List<int>>();
            _materialAppearanceCache = new Dictionary<int, bool>();

            for (var expressId = 0; expressId < expressIdRange; expressId++)
            {
                if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, expressId, out var record, out var typeId)) continue;
                var kind = registry[typeId].Kind;
                if (kind == EntityKind.RelAssociatesMaterial)
                {
                    if (StepParsing.TryGetTopLevelArgument(record, 4, out var relatedObjects) &&
                        StepParsing.TryGetTopLevelArgument(record, 5, out var materialArgument) &&
                        StepParsing.TryReadSingleReference(materialArgument, out var materialId))
                    {
                        StepParsing.CollectReferences(relatedObjects, _references);
                        foreach (var productId in _references)
                        {
                            if (!_materialAssociationsByProduct.TryGetValue(productId, out var materials))
                            {
                                materials = new HashSet<int>();
                                _materialAssociationsByProduct.Add(productId, materials);
                            }
                            materials.Add(materialId);
                        }
                    }
                    continue;
                }
                if (registry[typeId].Name == "IFCMATERIALDEFINITIONREPRESENTATION" &&
                    StepParsing.TryGetTopLevelArgument(record, 3, out var materialArgumentOfStyle) &&
                    StepParsing.TryReadSingleReference(materialArgumentOfStyle, out var styledMaterialId))
                {
                    _materialsWithStyledRepresentation.Add(styledMaterialId);
                    if (!_materialRepresentationsByMaterial.TryGetValue(styledMaterialId, out var representations))
                    {
                        representations = new List<int>();
                        _materialRepresentationsByMaterial.Add(styledMaterialId, representations);
                    }
                    if (StepParsing.TryGetTopLevelArgument(record, 2, out var representationArgument))
                        StepParsing.CollectReferences(representationArgument, representations);
                    continue;
                }
                if (kind != EntityKind.StyledItem) continue;
                if (!StepParsing.TryGetTopLevelArgument(record, 0, out var itemArgument) ||
                    !StepParsing.TryReadSingleReference(itemArgument, out var targetId))
                {
                    // A null target is valid in IfcStyledRepresentation and does
                    // not style a geometry item directly.
                    continue;
                }
                if (!_styledItemsByTarget.TryGetValue(targetId, out var styledItems))
                {
                    styledItems = new List<int>(1);
                    _styledItemsByTarget.Add(targetId, styledItems);
                }
                styledItems.Add(expressId);

                if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, targetId, out _, out var targetTypeId))
                {
                    AddIssue($"IfcStyledItem #{expressId} references missing target #{targetId}.");
                    continue;
                }
                var targetKind = registry[targetTypeId].Kind;
                if (targetKind is EntityKind.Face or EntityKind.FaceOuterBound or EntityKind.FaceBound or
                    EntityKind.ClosedShell or EntityKind.OpenShell)
                {
                    AddIssue($"Per-face or per-shell style target {registry[targetTypeId].Name} #{targetId} is not supported.");
                }
            }
            var defaultMaterial = new MaterialRecord(0, 0, 0, 1f, 1f, 1f, 1f, DefaultMaterialFlag);
            _materials.Add(defaultMaterial);
            _materialOrdinals.Add(MaterialKey.From(defaultMaterial), 0);
        }

        public uint ResolveInstance(int productId, int sourceItemId, int baseDefinitionId)
        {
            if (TryResolveGeometryTarget(baseDefinitionId, 0, out var material) ||
                sourceItemId != baseDefinitionId && TryResolveTarget(sourceItemId, out material))
            {
                _resolvedInstanceAssignments++;
                return GetOrAddMaterial(material);
            }
            if (TryResolveAssociatedMaterial(productId, out material))
            {
                _resolvedInstanceAssignments++;
                return GetOrAddMaterial(material);
            }

            _defaultInstanceAssignments++;
            if (RequiresAppearanceFallback(productId))
            {
                AddIssue($"Product #{productId} needs material-association fallback because no representation-item style resolved.");
            }
            return 0;
        }

        private bool TryResolveAssociatedMaterial(int productId, out ResolvedMaterial material)
        {
            material = default;
            if (!_materialAssociationsByProduct.TryGetValue(productId, out var associated)) return false;
            ResolvedMaterial? selected = null;
            foreach (var id in associated)
            {
                if (!TryCollectMaterialStyles(id, 0, ref selected)) return false;
            }
            if (!selected.HasValue) return false;
            material = selected.Value;
            return true;
        }

        private bool TryCollectMaterialStyles(int id, int depth, ref ResolvedMaterial? selected)
        {
            if (depth > 16 || !GraphCoverageAnalyzer.TryGetRecord(_source, _entries, id, out var record, out var typeId))
                return false;
            var name = _registry[typeId].Name;
            if (name == "IFCMATERIAL")
            {
                if (!_materialRepresentationsByMaterial.TryGetValue(id, out var representations)) return true;
                foreach (var representationId in representations)
                {
                    if (!GraphCoverageAnalyzer.TryGetRecord(_source, _entries, representationId, out var representation, out _) ||
                        !StepParsing.TryGetTopLevelArgument(representation, 3, out var itemsArgument)) return false;
                    var styledItems = new List<int>();
                    StepParsing.CollectReferences(itemsArgument, styledItems);
                    foreach (var styledItem in styledItems)
                    {
                        _resolutionStack.Clear();
                        if (!TryResolveEntity(styledItem, 0, out var resolved)) return false;
                        // Without a face-to-layer mapping, use the first styled
                        // layer as the single instance colour.
                        // Geometry-item styles above still take precedence.
                        selected ??= resolved;
                    }
                }
                return true;
            }
            var childrenIndex = name switch
            {
                "IFCMATERIALLAYERSETUSAGE" => 0,
                "IFCMATERIALLAYERSET" => 0,
                "IFCMATERIALLAYER" => 0,
                "IFCMATERIALLIST" => 0,
                _ => -1,
            };
            if (childrenIndex < 0 || !StepParsing.TryGetTopLevelArgument(record, childrenIndex, out var childrenArgument))
                return false;
            var children = new List<int>();
            StepParsing.CollectReferences(childrenArgument, children);
            foreach (var child in children)
                if (!TryCollectMaterialStyles(child, depth + 1, ref selected)) return false;
            return true;
        }

        private bool RequiresAppearanceFallback(int productId)
        {
            if (!_materialAssociationsByProduct.TryGetValue(productId, out var materials)) return false;
            foreach (var materialId in materials)
            {
                if (MaterialMayHaveStyledAppearance(materialId, 0)) return true;
            }
            return false;
        }

        private bool MaterialMayHaveStyledAppearance(int id, int depth)
        {
            if (_materialAppearanceCache.TryGetValue(id, out var cached)) return cached;
            if (depth > 16 || !GraphCoverageAnalyzer.TryGetRecord(_source, _entries, id, out var record, out var typeId)) return true;
            if (_materialsWithStyledRepresentation.Contains(id)) return true;
            var name = _registry[typeId].Name;
            if (name == "IFCMATERIAL") return false;
            // A layer set made only of named, unstyled IfcMaterial leaves has no
            // surface colour. The default material preserves that appearance.
            var childrenIndex = name switch
            {
                "IFCMATERIALLAYERSETUSAGE" => 0,
                "IFCMATERIALLAYERSET" => 0,
                "IFCMATERIALLAYER" => 0,
                "IFCMATERIALLIST" => 0,
                _ => -1,
            };
            if (childrenIndex < 0 || !StepParsing.TryGetTopLevelArgument(record, childrenIndex, out var argument)) return true;
            var children = new List<int>();
            StepParsing.CollectReferences(argument, children);
            if (children.Count == 0) return true;
            var needsFallback = false;
            foreach (var child in children)
            {
                if (!MaterialMayHaveStyledAppearance(child, depth + 1)) continue;
                needsFallback = true;
                break;
            }
            _materialAppearanceCache[id] = needsFallback;
            return needsFallback;
        }

        private bool TryResolveGeometryTarget(int targetId, int depth, out ResolvedMaterial material)
        {
            if (TryResolveTarget(targetId, out material)) return true;
            if (depth >= 64 || !GraphCoverageAnalyzer.TryGetRecord(_source, _entries, targetId, out var record, out var typeId) ||
                _registry[typeId].Kind is not (EntityKind.BooleanClippingResult or EntityKind.BooleanResult) ||
                !StepParsing.TryGetTopLevelArgument(record, 1, out var firstOperand) ||
                !StepParsing.TryReadSingleReference(firstOperand, out var firstId))
            {
                material = default;
                return false;
            }
            return TryResolveGeometryTarget(firstId, depth + 1, out material);
        }

        public MaterialBuildResult Complete(string directory, long instanceAssignments)
        {
            if (_resolvedInstanceAssignments + _defaultInstanceAssignments != instanceAssignments)
            {
                throw new InvalidDataException("Material assignment coverage does not match the instance table.");
            }

            var path = Path.Combine(directory, "materials.ifcv2");
            using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 64 * 1024, FileOptions.SequentialScan);
            using var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
            writer.Write(new byte[ChunkHeaderBytes]);
            foreach (var material in _materials)
            {
                writer.Write(material.Ordinal);
                writer.Write(material.SourceStyledItemId);
                writer.Write(material.SourceColourId);
                writer.Write(material.Flags);
                writer.Write(material.Red);
                writer.Write(material.Green);
                writer.Write(material.Blue);
                writer.Write(material.Alpha);
            }
            CompleteHeader(stream, checked((uint)_materials.Count));

            return new MaterialBuildResult(
                _issues.Count == 0,
                _styledItemsByTarget.Values.Sum(items => (long)items.Count),
                _resolvedInstanceAssignments,
                _defaultInstanceAssignments,
                _materials.Count,
                instanceAssignments,
                _issues.ToArray());
        }

        private bool TryResolveTarget(int targetId, out ResolvedMaterial material)
        {
            material = default;
            if (!_styledItemsByTarget.TryGetValue(targetId, out var styledItems)) return false;
            foreach (var styledItemId in styledItems)
            {
                _resolutionStack.Clear();
                if (TryResolveEntity(styledItemId, 0, out material)) return true;
            }
            AddIssue($"Styled representation item #{targetId} has no supported surface colour.");
            return false;
        }

        private bool TryResolveEntity(int expressId, int depth, out ResolvedMaterial material)
        {
            material = default;
            if (depth > 32 || !_resolutionStack.Add(expressId)) return false;
            try
            {
                if (_entityCache.TryGetValue(expressId, out var cached))
                {
                    if (!cached.HasValue) return false;
                    material = cached.Value;
                    return true;
                }
                if (!GraphCoverageAnalyzer.TryGetRecord(_source, _entries, expressId, out var record, out var typeId))
                {
                    _entityCache[expressId] = null;
                    return false;
                }

                var resolved = _registry[typeId].Kind switch
                {
                    EntityKind.StyledItem => TryResolveReferenceList(record, 1, depth, expressId, out material),
                    EntityKind.PresentationStyleAssignment => TryResolveReferenceList(record, 0, depth, 0, out material),
                    EntityKind.SurfaceStyle => TryResolveReferenceList(record, 2, depth, 0, out material),
                    EntityKind.SurfaceStyleRendering => TryResolveRendering(record, depth, out material),
                    EntityKind.SurfaceStyleShading => TryResolveSingleReference(record, 0, depth, out material),
                    EntityKind.ColourRgb => TryResolveColour(record, expressId, out material),
                    _ => false,
                };
                _entityCache[expressId] = resolved ? material : null;
                return resolved;
            }
            finally
            {
                _resolutionStack.Remove(expressId);
            }
        }

        private bool TryResolveReferenceList(
            ReadOnlySpan<byte> record,
            int argumentIndex,
            int depth,
            int sourceStyledItemId,
            out ResolvedMaterial material)
        {
            material = default;
            if (!StepParsing.TryGetTopLevelArgument(record, argumentIndex, out var referencesArgument)) return false;
            StepParsing.CollectReferences(referencesArgument, _references);
            foreach (var reference in _references)
            {
                if (!TryResolveEntity(reference, depth + 1, out material)) continue;
                if (sourceStyledItemId != 0) material = material with { SourceStyledItemId = sourceStyledItemId };
                return true;
            }
            return false;
        }

        private bool TryResolveSingleReference(ReadOnlySpan<byte> record, int argumentIndex, int depth, out ResolvedMaterial material)
        {
            material = default;
            return StepParsing.TryGetTopLevelArgument(record, argumentIndex, out var referenceArgument) &&
                   StepParsing.TryReadSingleReference(referenceArgument, out var referenceId) &&
                   TryResolveEntity(referenceId, depth + 1, out material);
        }

        private bool TryResolveRendering(ReadOnlySpan<byte> record, int depth, out ResolvedMaterial material)
        {
            if (!TryResolveSingleReference(record, 0, depth, out material)) return false;
            var alpha = 1d;
            if (StepParsing.TryGetTopLevelArgument(record, 1, out var transparencyArgument) &&
                !StepParsing.IsOmitted(transparencyArgument))
            {
                if (!TryParseRatio(transparencyArgument, out var transparency) || transparency is < 0 or > 1)
                {
                    material = default;
                    return false;
                }
                alpha = 1 - transparency;
            }
            material = material with { Alpha = CheckedRatio(alpha) };
            return true;
        }

        private static bool TryResolveColour(ReadOnlySpan<byte> record, int colourId, out ResolvedMaterial material)
        {
            material = default;
            if (!StepParsing.TryGetTopLevelArgument(record, 1, out var redArgument) ||
                !StepParsing.TryGetTopLevelArgument(record, 2, out var greenArgument) ||
                !StepParsing.TryGetTopLevelArgument(record, 3, out var blueArgument) ||
                !TryParseRatio(redArgument, out var red) ||
                !TryParseRatio(greenArgument, out var green) ||
                !TryParseRatio(blueArgument, out var blue) ||
                red is < 0 or > 1 || green is < 0 or > 1 || blue is < 0 or > 1)
            {
                return false;
            }
            material = new ResolvedMaterial(0, colourId, CheckedRatio(red), CheckedRatio(green), CheckedRatio(blue), 1f);
            return true;
        }

        private uint GetOrAddMaterial(ResolvedMaterial resolved)
        {
            var flags = resolved.Alpha < 1f ? TransparentMaterialFlag : 0u;
            var candidate = new MaterialRecord(
                checked((uint)_materials.Count),
                resolved.SourceStyledItemId,
                resolved.SourceColourId,
                resolved.Red,
                resolved.Green,
                resolved.Blue,
                resolved.Alpha,
                flags);
            var key = MaterialKey.From(candidate);
            if (_materialOrdinals.TryGetValue(key, out var ordinal)) return ordinal;
            _materials.Add(candidate);
            _materialOrdinals.Add(key, candidate.Ordinal);
            return candidate.Ordinal;
        }

        private void AddIssue(string issue)
        {
            if (_issues.Count < 100 && !_issues.Contains(issue, StringComparer.Ordinal)) _issues.Add(issue);
        }

        private static bool TryParseRatio(ReadOnlySpan<byte> value, out double result)
        {
            if (StepParsing.TryParseDouble(value, out result)) return true;
            value = StepParsing.Trim(value);
            var open = value.IndexOf((byte)'(');
            if (open < 0 || value.Length < open + 3 || value[^1] != (byte)')') return false;
            return StepParsing.TryParseDouble(value[(open + 1)..^1], out result);
        }

        private static float CheckedRatio(double value)
        {
            if (!double.IsFinite(value) || value is < 0 or > 1) throw new InvalidDataException("Material ratio is outside [0, 1].");
            return (float)value;
        }
    }

    private static void CompleteHeader(FileStream stream, uint records)
    {
        var payloadBytes = checked((ulong)records * MaterialRecordBytes);
        if (checked((ulong)(stream.Length - ChunkHeaderBytes)) != payloadBytes)
        {
            throw new InvalidDataException("Material chunk payload length is inconsistent.");
        }
        Span<byte> header = stackalloc byte[ChunkHeaderBytes];
        ChunkMagic.CopyTo(header);
        BinaryPrimitives.WriteUInt16LittleEndian(header[8..], ChunkVersion);
        BinaryPrimitives.WriteUInt16LittleEndian(header[10..], MaterialChunkKind);
        BinaryPrimitives.WriteUInt32LittleEndian(header[12..], ChunkHeaderBytes);
        BinaryPrimitives.WriteUInt64LittleEndian(header[16..], payloadBytes);
        BinaryPrimitives.WriteUInt32LittleEndian(header[24..], records);
        stream.Position = 0;
        stream.Write(header);
        stream.Flush(flushToDisk: true);
    }

    internal readonly record struct MaterialBuildResult(
        bool Complete,
        long StyledItemsIndexed,
        long ResolvedInstanceAssignments,
        long DefaultInstanceAssignments,
        long MaterialDefinitions,
        long InstanceAssignments,
        IReadOnlyList<string> Issues)
    {
        public MaterialCoverageManifest ToManifest() => new(
            Complete ? "complete" : "fallback-required",
            "base-style-then-mapped-item-style-then-first-material-layer-style-then-default",
            StyledItemsIndexed,
            ResolvedInstanceAssignments,
            DefaultInstanceAssignments,
            MaterialDefinitions,
            InstanceAssignments,
            Issues);
    }

    private readonly record struct ResolvedMaterial(
        int SourceStyledItemId,
        int SourceColourId,
        float Red,
        float Green,
        float Blue,
        float Alpha);

    private readonly record struct MaterialRecord(
        uint Ordinal,
        int SourceStyledItemId,
        int SourceColourId,
        float Red,
        float Green,
        float Blue,
        float Alpha,
        uint Flags);

    private readonly record struct MaterialKey(int Red, int Green, int Blue, int Alpha, uint Flags)
    {
        public static MaterialKey From(MaterialRecord material) => new(
            BitConverter.SingleToInt32Bits(material.Red),
            BitConverter.SingleToInt32Bits(material.Green),
            BitConverter.SingleToInt32Bits(material.Blue),
            BitConverter.SingleToInt32Bits(material.Alpha),
            material.Flags & TransparentMaterialFlag);
    }
}
