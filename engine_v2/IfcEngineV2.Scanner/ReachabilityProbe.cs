using System.IO.MemoryMappedFiles;

namespace IfcEngineV2.Scanner;

/// <summary>Counts shape roots reached through product definitions and representation maps.
/// This is an inventory, not a geometry or product-binding validator.</summary>
internal static class ReachabilityProbe
{
    public static unsafe ReachabilityResult Run(byte* source, long sourceLength, string indexPath,
        byte[] sourceSha256, long maximumExpressId, TypeRegistry registry, out int[] reachableExtrusionIds)
    {
        using var map = MemoryMappedFile.CreateFromFile(indexPath, FileMode.Open, null, 0, MemoryMappedFileAccess.Read);
        using var view = map.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
        byte* index = null;
        view.SafeMemoryMappedViewHandle.AcquirePointer(ref index);
        try
        {
            index += view.PointerOffset;
            var indexSpan = new ReadOnlySpan<byte>(index, checked((int)new FileInfo(indexPath).Length));
            GraphCoverageAnalyzer.ValidateIndex(indexSpan, sourceLength, sourceSha256, maximumExpressId);
            var entries = index + 4096;
            var reader = new IndexedRecordReader(source, 0, sourceLength, sourceLength,
                entries, maximumExpressId, registry.Entries.Count);
            var state = new State(reader, registry);
            if (!registry.TryGetId("IFCPRODUCTDEFINITIONSHAPE", out var shapeType))
                return state.Result(out reachableExtrusionIds);
            for (long id = 0; id <= maximumExpressId; id++)
            {
                if (!reader.TryGetTypeId(id, out var typeId) || typeId != shapeType) continue;
                state.VisitShape(checked((int)id));
            }
            return state.Result(out reachableExtrusionIds);
        }
        finally { view.SafeMemoryMappedViewHandle.ReleasePointer(); }
    }

    private sealed unsafe class State(IndexedRecordReader reader, TypeRegistry registry)
    {
        private long _shapes;
        private long _rootItems;
        private long _leafItems;
        private long _mappedItems;
        private long _invalidReferences;
        private readonly Dictionary<string, long> _itemTypes = new(StringComparer.Ordinal);
        private readonly Dictionary<string, long> _profiles = new(StringComparer.Ordinal);
        private readonly List<string> _issues = [];
        private readonly HashSet<int> _reachableExtrusions = [];

        public ReachabilityResult Result(out int[] reachableExtrusionIds)
        {
            reachableExtrusionIds = _reachableExtrusions.Order().ToArray();
            return new(_shapes, _rootItems, _leafItems, _mappedItems,
                _invalidReferences, _itemTypes, _profiles, _issues);
        }

        private void Issue(string message)
        {
            _invalidReferences++;
            if (_issues.Count < 20) _issues.Add(message);
        }

        private bool Record(int id, out ReadOnlySpan<byte> record, out string name)
        {
            record = default;
            name = "";
            if (!reader.TryRead(id, out record, out var typeId)) return false;
            name = registry[typeId].Name;
            return true;
        }

        public void VisitShape(int id)
        {
            _shapes++;
            if (!Record(id, out var record, out _) ||
                !StepParsing.TryGetTopLevelArgument(record, 2, out var argument))
            {
                Issue($"Shape #{id} has no representation list.");
                return;
            }
            var representations = new List<int>();
            StepParsing.CollectReferences(argument, representations);
            foreach (var representationId in representations)
                VisitRepresentation(representationId, new HashSet<int>(), 0, true);
        }

        private void VisitRepresentation(int id, HashSet<int> visitedMaps, int depth, bool root)
        {
            if (!Record(id, out var record, out var name) || name != "IFCSHAPEREPRESENTATION")
            {
                Issue($"Representation #{id} is missing or invalid.");
                return;
            }
            if (root && RepresentationPolicy.IsAuxiliary(record)) return;
            if (!StepParsing.TryGetTopLevelArgument(record, 3, out var argument))
            {
                Issue($"Representation #{id} has no item list.");
                return;
            }
            var items = new List<int>();
            StepParsing.CollectReferences(argument, items);
            foreach (var itemId in items) VisitItem(itemId, visitedMaps, depth, root);
        }

        private void VisitItem(int id, HashSet<int> visitedMaps, int depth, bool root)
        {
            if (root) _rootItems++;
            if (!Record(id, out var record, out var name))
            {
                Issue($"Geometry item #{id} is missing.");
                return;
            }
            if (name == "IFCMAPPEDITEM")
            {
                _mappedItems++;
                if (depth >= 16 || !StepParsing.TryGetTopLevelArgument(record, 0, out var mapArgument) ||
                    !StepParsing.TryReadSingleReference(mapArgument, out var mapId) ||
                    !visitedMaps.Add(mapId))
                {
                    Issue($"Mapped item #{id} has a missing, cyclic or deeply nested map.");
                    return;
                }
                try
                {
                    if (!Record(mapId, out var map, out var mapName) || mapName != "IFCREPRESENTATIONMAP" ||
                        !StepParsing.TryGetTopLevelArgument(map, 1, out var representationArgument) ||
                        !StepParsing.TryReadSingleReference(representationArgument, out var representationId))
                    {
                        Issue($"Mapped item #{id} has an invalid representation map #{mapId}.");
                        return;
                    }
                    VisitRepresentation(representationId, visitedMaps, depth + 1, false);
                }
                finally { visitedMaps.Remove(mapId); }
                return;
            }
            _leafItems++;
            _itemTypes[name] = _itemTypes.GetValueOrDefault(name) + 1;
            if (name != "IFCEXTRUDEDAREASOLID") return;
            _reachableExtrusions.Add(id);
            if (!StepParsing.TryGetTopLevelArgument(record, 0, out var profileArgument) ||
                !StepParsing.TryReadSingleReference(profileArgument, out var profileId) ||
                !Record(profileId, out _, out var profileName))
            {
                Issue($"Extrusion #{id} has no valid profile.");
                return;
            }
            _profiles[profileName] = _profiles.GetValueOrDefault(profileName) + 1;
        }
    }
}

internal sealed record ReachabilityResult(long ProductDefinitionShapes, long RootItemOccurrences,
    long LeafItemOccurrences, long MappedItemOccurrences, long InvalidReferences,
    IReadOnlyDictionary<string, long> LeafItemTypes, IReadOnlyDictionary<string, long> ExtrusionProfiles,
    IReadOnlyList<string> Issues);
