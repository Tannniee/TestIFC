using System.Text.Json.Serialization;

namespace IfcEngineV2.Scanner;

internal static class EngineContract
{
    public const string EngineVersion = "0.8.9-p6.2";
    public const string ManifestFormat = "ifc-engine-v2-scan-manifest";
    public const int ManifestVersion = 1;
    public const long DefaultMaximumIfcBytes = 2_000_000_000L;
}

internal enum EntityKind : ushort
{
    Other,
    ShapeRepresentation,
    ProductDefinitionShape,
    RepresentationMap,
    MappedItem,
    FacetedBrep,
    ShellBasedSurfaceModel,
    ClosedShell,
    OpenShell,
    Face,
    FaceOuterBound,
    FaceBound,
    PolyLoop,
    CartesianPoint,
    Direction,
    LocalPlacement,
    Axis2Placement3D,
    Axis2Placement2D,
    CartesianTransformationOperator3D,
    CartesianTransformationOperator2D,
    ExtrudedAreaSolid,
    ExtrudedAreaSolidTapered,
    SweptDiskSolid,
    RevolvedAreaSolid,
    FaceBasedSurfaceModel,
    ConnectedFaceSet,
    TriangulatedFaceSet,
    PolygonalFaceSet,
    CartesianPointList2D,
    CartesianPointList3D,
    IndexedPolygonalFace,
    IndexedPolygonalFaceWithVoids,
    RectangleProfile,
    RectangleHollowProfile,
    CircleProfile,
    CircleHollowProfile,
    IShapeProfile,
    LShapeProfile,
    CShapeProfile,
    ArbitraryClosedProfile,
    ArbitraryProfileWithVoids,
    DerivedProfile,
    Polyline,
    IndexedPolyCurve,
    CompositeCurve,
    CompositeCurveSegment,
    TrimmedCurve,
    Circle,
    Plane,
    HalfSpaceSolid,
    PolygonalBoundedHalfSpace,
    BooleanClippingResult,
    BooleanResult,
    UnitAssignment,
    SiUnit,
    StyledItem,
    PresentationStyleAssignment,
    SurfaceStyle,
    SurfaceStyleRendering,
    SurfaceStyleShading,
    ColourRgb,
    RelAssociatesMaterial,
    UnsupportedGeometry,
}

internal sealed class TypeEntry
{
    public required ushort Id { get; init; }
    public required string Name { get; init; }
    [JsonIgnore]
    public required EntityKind Kind { get; init; }
    public long Count { get; set; }
}

internal sealed record SourceManifest(
    string Path,
    long SizeBytes,
    string Sha256,
    string Schema);

internal sealed record ScanMetrics(
    DateTimeOffset StartedAtUtc,
    DateTimeOffset CompletedAtUtc,
    double HashAndScanMilliseconds,
    double IndexMilliseconds,
    double GraphCoverageMilliseconds,
    double TessellationMilliseconds,
    long EntityCount,
    long MaximumExpressId,
    double ExpressIdDensity,
    long PhysicalLineCount,
    long MaximumPhysicalLineBytes,
    long MaximumRecordBytes);

internal sealed record IndexManifest(
    string? Path,
    string Format,
    int Version,
    int EntryBytes,
    long SizeBytes,
    bool Complete);

internal sealed record PlacementCensus(
    long RootLocalPlacements,
    long NestedLocalPlacements,
    long ExplicitAxisPlacements,
    long DefaultAxisPlacements,
    long TranslationOnlyTransformOperators,
    long ComplexTransformOperators);

internal sealed record TopologyCensus(
    long Faces,
    long FaceBoundReferences,
    int MaximumBoundsPerFace,
    long PolyLoops,
    long PolyLoopPointReferences,
    int MaximumPointsPerLoop,
    long CandidateTrianglesBeforeHoleReconciliation,
    IReadOnlyDictionary<string, long> LoopSizeBuckets,
    IReadOnlyDictionary<string, long> CartesianPointDimensions);

internal sealed record CoverageCensus(
    string Status,
    IReadOnlyList<string> Reasons,
    IReadOnlyList<string> SupportedRepresentationTypes,
    IReadOnlyDictionary<string, long> RepresentationTypes,
    IReadOnlyDictionary<string, long> UnsupportedGeometryEntities,
    long BaseGeometryDefinitions,
    long MappedItems,
    long StyledItems,
    long Colours,
    PlacementCensus Placements,
    TopologyCensus Topology,
    GraphCoverageLedger Graph);

internal sealed record GraphCoverageLedger(
    string Status,
    string? Sha256,
    long ProductDefinitions,
    long ResolvedProductDefinitions,
    long DirectProducts,
    long MappedProducts,
    long MixedProducts,
    long DirectGeometryOccurrences,
    long MappedItemOccurrences,
    long ExpandedMappedGeometryOccurrences,
    long LogicalInstanceEstimate,
    long UniqueBaseDefinitionsReferenced,
    long UnreferencedBaseDefinitions,
    long RepresentationMapsReferenced,
    long MissingReferenceCount,
    long UnsupportedItemCount,
    IReadOnlyList<string> Issues,
    ProductBindingLedger ProductBindings,
    GeometryPlanLedger GeometryPlan);

internal sealed record ProductBindingLedger(
    string Status,
    long BoundProductDefinitions,
    long MissingProductDefinitions,
    long DuplicateProductDefinitions,
    long ProductsWithLocalPlacement,
    long ProductsWithGlobalId,
    IReadOnlyDictionary<string, long> RepresentedProductTypes,
    IReadOnlyList<string> Issues);

internal sealed record GeometryPlanLedger(
    string Status,
    string? Sha256,
    long BaseDefinitions,
    long ResolvedBaseDefinitions,
    long ExpandedGeometryOccurrences,
    long Faces,
    long FacesWithHoles,
    long OuterBoundReferences,
    long InnerBoundReferences,
    long BaseTriangles,
    long ExpandedTriangles,
    long CleanedBaseTriangles,
    long CleanedExpandedTriangles,
    long DegenerateFaces,
    CoordinateAuditLedger Coordinates,
    IReadOnlyList<string> Issues);

internal sealed record CoordinateAuditLedger(
    string Status,
    long CartesianPointsDecoded,
    long PolyLoopsDecoded,
    long LoopsWithClosingDuplicate,
    long ConsecutiveDuplicateVerticesRemoved,
    long CollinearVerticesRemoved,
    long InvalidPointReferences,
    IReadOnlyList<string> Issues);

internal sealed record ScanManifest(
    string Format,
    int Version,
    string EngineVersion,
    bool Complete,
    SourceManifest Source,
    ScanMetrics Scan,
    IndexManifest Index,
    IReadOnlyDictionary<string, long> EntityTypes,
    IReadOnlyDictionary<string, ushort> TypeIds,
    CoverageCensus Coverage,
    TessellationArtifactManifest? Tessellation);

internal sealed record ScanOptions(
    string SourcePath,
    string ManifestPath,
    string? IndexPath,
    string? ChunkOutputDirectory = null,
    long MaximumIfcBytes = EngineContract.DefaultMaximumIfcBytes,
    string? CsgOverridePath = null);

internal sealed record ScanResult(ScanManifest Manifest);

internal sealed record ChunkFileManifest(
    string File,
    ushort Kind,
    long SizeBytes,
    long PayloadBytes,
    long RecordCount,
    string Sha256);

internal sealed record NonSimpleFaceManifest(
    int BaseDefinitionExpressId,
    int RepresentativeProductExpressId,
    int FaceExpressId,
    int Occurrences,
    int Vertices,
    int Holes,
    int Triangles,
    bool Empty,
    bool ContainmentRejected,
    int RecoveredIslands);

internal sealed record MaterialCoverageManifest(
    string Status,
    string AssignmentPolicy,
    long StyledItemsIndexed,
    long ResolvedInstanceAssignments,
    long DefaultInstanceAssignments,
    long MaterialDefinitions,
    long InstanceAssignments,
    IReadOnlyList<string> Issues);

internal sealed record SemanticCoverageManifest(
    string Status,
    long Records,
    long ParentLinks,
    long Roots,
    long RepresentedProducts,
    long StringBytes,
    DeepSemanticCoverageManifest Deep);

internal sealed record DeepSemanticCoverageManifest(
    string Status,
    long Records,
    long ProductsWithRelations,
    long RelationEdges,
    long ValueBytes,
    long MaximumRecordBytes);

internal sealed record TessellationArtifactManifest(
    string Format,
    int Version,
    string EngineVersion,
    bool Complete,
    bool ViewerReady,
    string Directory,
    string SourceSha256,
    string CoordinateSpace,
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
    string PositionPolicy,
    string NormalPolicy,
    MaterialCoverageManifest Materials,
    IReadOnlyList<string> TypeNames,
    SemanticCoverageManifest Semantic,
    IReadOnlyList<NonSimpleFaceManifest> NonSimpleFaceDetails,
    IReadOnlyList<ChunkFileManifest> Chunks);

internal readonly record struct RecordHeader(long ExpressId, int TypeStart, int TypeLength);

internal readonly record struct RegistryKey(ulong Hash, int Length);

internal sealed class TypeRegistry
{
    private readonly Dictionary<RegistryKey, ushort> _ids = new();
    private readonly List<TypeEntry> _entries = [];

    public IReadOnlyList<TypeEntry> Entries => _entries;

    public bool TryGetId(string name, out ushort id)
    {
        var bytes = System.Text.Encoding.ASCII.GetBytes(name);
        return _ids.TryGetValue(new RegistryKey(StepParsing.HashAsciiUpper(bytes), bytes.Length), out id);
    }

    public ushort Resolve(ReadOnlySpan<byte> name)
    {
        var key = new RegistryKey(StepParsing.HashAsciiUpper(name), name.Length);
        if (_ids.TryGetValue(key, out var existing))
        {
            return existing;
        }

        if (_entries.Count >= ushort.MaxValue)
        {
            throw new InvalidDataException("The IFC contains too many distinct entity types.");
        }

        var normalized = StepParsing.AsciiUpperString(name);
        var id = checked((ushort)_entries.Count);
        _ids.Add(key, id);
        _entries.Add(new TypeEntry
        {
            Id = id,
            Name = normalized,
            Kind = Classify(normalized),
        });
        return id;
    }

    public ushort ResolveExisting(ReadOnlySpan<byte> name)
    {
        var key = new RegistryKey(StepParsing.HashAsciiUpper(name), name.Length);
        if (_ids.TryGetValue(key, out var existing))
        {
            return existing;
        }

        throw new InvalidDataException($"Entity type {StepParsing.AsciiUpperString(name)} appeared only during index creation.");
    }

    public TypeEntry this[ushort id] => _entries[id];

    private static EntityKind Classify(string name) => name switch
    {
        "IFCSHAPEREPRESENTATION" => EntityKind.ShapeRepresentation,
        "IFCPRODUCTDEFINITIONSHAPE" => EntityKind.ProductDefinitionShape,
        "IFCPRODUCTREPRESENTATION" => EntityKind.ProductDefinitionShape,
        "IFCREPRESENTATIONMAP" => EntityKind.RepresentationMap,
        "IFCMAPPEDITEM" => EntityKind.MappedItem,
        "IFCFACETEDBREP" => EntityKind.FacetedBrep,
        "IFCSHELLBASEDSURFACEMODEL" => EntityKind.ShellBasedSurfaceModel,
        "IFCCLOSEDSHELL" => EntityKind.ClosedShell,
        "IFCOPENSHELL" => EntityKind.OpenShell,
        "IFCFACE" => EntityKind.Face,
        "IFCFACEOUTERBOUND" => EntityKind.FaceOuterBound,
        "IFCFACEBOUND" => EntityKind.FaceBound,
        "IFCPOLYLOOP" => EntityKind.PolyLoop,
        "IFCCARTESIANPOINT" => EntityKind.CartesianPoint,
        "IFCDIRECTION" => EntityKind.Direction,
        "IFCLOCALPLACEMENT" => EntityKind.LocalPlacement,
        "IFCAXIS2PLACEMENT3D" => EntityKind.Axis2Placement3D,
        "IFCAXIS2PLACEMENT2D" => EntityKind.Axis2Placement2D,
        "IFCCARTESIANTRANSFORMATIONOPERATOR3D" => EntityKind.CartesianTransformationOperator3D,
        "IFCCARTESIANTRANSFORMATIONOPERATOR2D" => EntityKind.CartesianTransformationOperator2D,
        "IFCEXTRUDEDAREASOLID" => EntityKind.ExtrudedAreaSolid,
        "IFCEXTRUDEDAREASOLIDTAPERED" => EntityKind.ExtrudedAreaSolidTapered,
        "IFCSWEPTDISKSOLID" or "IFCSWEPTDISKSOLIDPOLYGONAL" => EntityKind.SweptDiskSolid,
        "IFCREVOLVEDAREASOLID" or "IFCREVOLVEDAREASOLIDTAPERED" => EntityKind.RevolvedAreaSolid,
        "IFCFACEBASEDSURFACEMODEL" => EntityKind.FaceBasedSurfaceModel,
        "IFCCONNECTEDFACESET" => EntityKind.ConnectedFaceSet,
        "IFCTRIANGULATEDFACESET" => EntityKind.TriangulatedFaceSet,
        "IFCPOLYGONALFACESET" => EntityKind.PolygonalFaceSet,
        "IFCCARTESIANPOINTLIST2D" => EntityKind.CartesianPointList2D,
        "IFCCARTESIANPOINTLIST3D" => EntityKind.CartesianPointList3D,
        "IFCINDEXEDPOLYGONALFACE" => EntityKind.IndexedPolygonalFace,
        "IFCINDEXEDPOLYGONALFACEWITHVOIDS" => EntityKind.IndexedPolygonalFaceWithVoids,
        "IFCRECTANGLEPROFILEDEF" => EntityKind.RectangleProfile,
        "IFCRECTANGLEHOLLOWPROFILEDEF" => EntityKind.RectangleHollowProfile,
        "IFCCIRCLEPROFILEDEF" => EntityKind.CircleProfile,
        "IFCCIRCLEHOLLOWPROFILEDEF" => EntityKind.CircleHollowProfile,
        "IFCISHAPEPROFILEDEF" => EntityKind.IShapeProfile,
        "IFCLSHAPEPROFILEDEF" => EntityKind.LShapeProfile,
        "IFCCSHAPEPROFILEDEF" => EntityKind.CShapeProfile,
        "IFCARBITRARYCLOSEDPROFILEDEF" => EntityKind.ArbitraryClosedProfile,
        "IFCARBITRARYPROFILEDEFWITHVOIDS" => EntityKind.ArbitraryProfileWithVoids,
        "IFCDERIVEDPROFILEDEF" => EntityKind.DerivedProfile,
        "IFCPOLYLINE" => EntityKind.Polyline,
        "IFCINDEXEDPOLYCURVE" => EntityKind.IndexedPolyCurve,
        "IFCCOMPOSITECURVE" => EntityKind.CompositeCurve,
        "IFCCOMPOSITECURVESEGMENT" => EntityKind.CompositeCurveSegment,
        "IFCTRIMMEDCURVE" => EntityKind.TrimmedCurve,
        "IFCCIRCLE" => EntityKind.Circle,
        "IFCPLANE" => EntityKind.Plane,
        "IFCHALFSPACESOLID" => EntityKind.HalfSpaceSolid,
        "IFCPOLYGONALBOUNDEDHALFSPACE" => EntityKind.PolygonalBoundedHalfSpace,
        "IFCBOOLEANCLIPPINGRESULT" => EntityKind.BooleanClippingResult,
        "IFCBOOLEANRESULT" => EntityKind.BooleanResult,
        "IFCUNITASSIGNMENT" => EntityKind.UnitAssignment,
        "IFCSIUNIT" => EntityKind.SiUnit,
        "IFCSTYLEDITEM" => EntityKind.StyledItem,
        "IFCPRESENTATIONSTYLEASSIGNMENT" => EntityKind.PresentationStyleAssignment,
        "IFCSURFACESTYLE" => EntityKind.SurfaceStyle,
        "IFCSURFACESTYLERENDERING" => EntityKind.SurfaceStyleRendering,
        "IFCSURFACESTYLESHADING" => EntityKind.SurfaceStyleShading,
        "IFCCOLOURRGB" => EntityKind.ColourRgb,
        "IFCRELASSOCIATESMATERIAL" => EntityKind.RelAssociatesMaterial,
        _ when UnsupportedGeometryTypes.Contains(name) => EntityKind.UnsupportedGeometry,
        _ => EntityKind.Other,
    };

    internal static readonly HashSet<string> UnsupportedGeometryTypes = new(StringComparer.Ordinal)
    {
        "IFCADVANCEDBREP",
        "IFCADVANCEDBREPWITHVOIDS",
        "IFCBLOCK",
        "IFCBOUNDINGBOX",
        "IFCBREPWITHVOIDS",
        "IFCCSGSOLID",
        "IFCCYLINDRICALSURFACE",
        "IFCFIXEDREFERENCESWEPTAREASOLID",
        "IFCMANIFOLDSOLIDBREP",
        "IFCRECTANGULARPYRAMID",
        "IFCRIGHTCIRCULARCONE",
        "IFCRIGHTCIRCULARCYLINDER",
        "IFCSECTIONEDSOLIDHORIZONTAL",
        "IFCSPHERE",
        "IFCSURFACECURVESWEPTAREASOLID",
    };
}
