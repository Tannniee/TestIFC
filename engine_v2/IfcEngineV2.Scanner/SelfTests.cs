using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace IfcEngineV2.Scanner;

internal static class SelfTests
{
    public static void Run()
    {
        TestArgumentParser();
        TestIndexedRecordReader64Bit();
        TestEarcutTriangulation();
        TestScannerAndIndex();
        TestLargeProbeChunkBoundary();
        TestExtrusionArtifact();
        TestRoundedHollowProfileArtifact();
        TestCAndLProfileArtifact();
        TestEmptyShapeRepresentation();
        TestGenericProductRepresentationArtifact();
        TestDerivedAndTaperedArtifact();
        TestRatioAngleUnit();
        TestDisjointBoundRecovery();
        TestArbitraryProfileArtifact();
        TestReversedTrimmedCircleArtifact();
        TestP62GeometryArtifact();
        TestNestedBooleanUsesFallback();
        TestTriangulatedFaceSetArtifact();
        TestPolygonalFaceSetArtifact();
        TestRoundedPolygonalCoordinatesAndCogArtifact();
        TestFaceBasedSurfaceModelArtifact();
        TestRuledStripFaceArtifact();
        TestIdenticalOuterAndHoleArtifact();
        TestSpurAndNestedHoleArtifact();
        TestCrossingCongruentHoleArtifact();
        TestReachabilityAndPlacementGuards();
        TestUnsupportedProfileFallsBack();
        TestSizeLimit();
    }

    private static void TestArgumentParser()
    {
        var record = "#42=IFCTEST((#1,#2),'a,b;#99=FAKE()',(#3,(#4,#5)),$);"u8;
        Assert(StepParsing.TryGetTopLevelArgument(record, 0, out var first), "First argument was not found.");
        Assert(StepParsing.CountReferences(first) == 2, "Reference list count is wrong.");
        Assert(StepParsing.TryGetTopLevelArgument(record, 1, out var second), "Second argument was not found.");
        Assert(Encoding.ASCII.GetString(second) == "'a,b;#99=FAKE()'", "Quoted delimiters changed the argument boundary.");
        Assert(StepParsing.TryGetTopLevelArgument(record, 2, out var third), "Third argument was not found.");
        Assert(StepParsing.CountReferences(third) == 3, "Nested reference count is wrong.");
        Assert(StepParsing.TryGetTopLevelArgument(record, 3, out var omitted) && StepParsing.IsOmitted(omitted), "Omitted argument was not recognized.");
    }

    private static unsafe void TestIndexedRecordReader64Bit()
    {
        const long sourceLength = 2L * 1024 * 1024 * 1024;
        const long mappedOffset = int.MaxValue - 32L;
        byte* mapped = stackalloc byte[64];
        byte* index = stackalloc byte[5 * 16];
        new Span<byte>(mapped, 64).Clear();
        new Span<byte>(index, 5 * 16).Clear();
        var expected = "#4=IFCWALL();"u8;
        var recordOffset = sourceLength - expected.Length;
        expected.CopyTo(new Span<byte>(mapped + recordOffset - mappedOffset, expected.Length));
        var entry = new Span<byte>(index + 4 * 16, 16);
        BinaryPrimitives.WriteInt64LittleEndian(entry, recordOffset);
        BinaryPrimitives.WriteInt32LittleEndian(entry[8..], expected.Length);
        BinaryPrimitives.WriteUInt16LittleEndian(entry[12..], 1);
        BinaryPrimitives.WriteUInt16LittleEndian(entry[14..], 1);

        var reader = new IndexedRecordReader(mapped, mappedOffset, 64, sourceLength, index, 4, 2);
        Assert(reader.TryGetTypeId(4, out var typeId) && typeId == 1,
            "64-bit index lost the record type.");
        Assert(reader.TryRead(4, out var record, out typeId) && record.SequenceEqual(expected),
            "64-bit indexed record did not cross the 32-bit source boundary.");
        Assert(!reader.TryRead(5, out _, out _) && !reader.TryRead(-1, out _, out _),
            "Indexed record reader accepted an out-of-range Express ID.");
        BinaryPrimitives.WriteInt64LittleEndian(entry, mappedOffset - 1);
        Assert(!reader.TryRead(4, out _, out _), "Indexed record reader escaped its mapped view.");
        BinaryPrimitives.WriteInt64LittleEndian(entry, sourceLength);
        Assert(!reader.TryRead(4, out _, out _), "Indexed record reader escaped the IFC file.");
        BinaryPrimitives.WriteInt64LittleEndian(entry, recordOffset);
        BinaryPrimitives.WriteUInt16LittleEndian(entry[12..], 2);
        Assert(!reader.TryRead(4, out _, out _), "Indexed record reader accepted an unknown type ID.");
    }

    private static void TestEarcutTriangulation()
    {
        var triangles = new List<int>();
        double[] square = [0, 0, 4, 0, 4, 4, 0, 4];
        EarcutTriangulator.Triangulate(square, [], triangles);
        Assert(triangles.Count == 6, "Square triangulation count is wrong.");
        Assert(EarcutTriangulator.Deviation(square, [], triangles) < 1e-12, "Square triangulation area is wrong.");

        double[] concave = [0, 0, 2, 0, 2, 2, 1, 1, 0, 2];
        EarcutTriangulator.Triangulate(concave, [], triangles);
        Assert(triangles.Count == 9, "Concave triangulation count is wrong.");
        Assert(EarcutTriangulator.Deviation(concave, [], triangles) < 1e-12, "Concave triangulation area is wrong.");

        double[] withHole = [0, 0, 6, 0, 6, 6, 0, 6, 2, 2, 2, 4, 4, 4, 4, 2];
        EarcutTriangulator.Triangulate(withHole, [4], triangles);
        Assert(triangles.Count == 24, "Hole triangulation count is wrong.");
        Assert(EarcutTriangulator.Deviation(withHole, [4], triangles) < 1e-12, "Hole triangulation area is wrong.");
    }

    private static void TestScannerAndIndex()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"ifc-engine-v2-selftest-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            var sourcePath = Path.Combine(directory, "fixture.ifc");
            var manifestPath = Path.Combine(directory, "fixture.manifest.json");
            var indexPath = Path.Combine(directory, "fixture.ifc2idx");
            var chunkPath = Path.Combine(directory, "fixture.chunks");
            var longValue = new string('X', 1024 * 1024);
            var source = $"""
                ISO-10303-21;
                HEADER;
                FILE_SCHEMA(('IFC2X3'));
                ENDSEC;
                DATA;
                /* #900=FAKE(); */
                #1=IFCCARTESIANPOINT((0.,1.,2.));
                #14=IFCCARTESIANPOINT((1.,0.,0.));
                #15=IFCCARTESIANPOINT((0.,1.,0.));
                #2=IFCPOLYLOOP((#1,#14,#15));
                #3=IFCFACE((#4));
                #4=IFCFACEOUTERBOUND(#2,.T.);
                #5=IFCCLOSEDSHELL((#3));
                #6=IFCFACETEDBREP(#5);
                #7=IFCSHAPEREPRESENTATION(#8,'Body','Brep',(#6));
                #8=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#10,$);
                #9=IFCLOCALPLACEMENT($,#10);
                #10=IFCAXIS2PLACEMENT3D(#1,$,$);
                #11=IFCCOLOURRGB('semi;colon and doubled quote '' ok',0.8,0.1,0.2);
                #12=IFCPRODUCTDEFINITIONSHAPE($,$,(#7));
                #13=IFCWALL('test-guid',$,'\X2\0110\X0\irect wall','Primary wall','Exterior',#9,#12,$);
                #20=IFCPROPERTYSINGLEVALUE('long',$,IFCTEXT('{longValue}'),$);
                #23=IFCREPRESENTATIONMAP(#10,#33);
                #24=IFCCARTESIANPOINT((5.,6.,7.));
                #25=IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,#24,$,$);
                #26=IFCMAPPEDITEM(#23,#25);
                #27=IFCSHAPEREPRESENTATION(#8,'Body','MappedRepresentation',(#26));
                #28=IFCPRODUCTDEFINITIONSHAPE($,$,(#27));
                #29=IFCWALL('mapped-guid',$,'Mapped wall',$,$,#9,#28,$);
                #30=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
                #31=IFCUNITASSIGNMENT((#30));
                #32=IFCFACETEDBREP(#5);
                #33=IFCSHAPEREPRESENTATION(#8,'Body','Brep',(#32));
                #40=IFCSURFACESTYLERENDERING(#11,0.25,$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.00390625),IFCSPECULAREXPONENT(10.),.NOTDEFINED.);
                #41=IFCSURFACESTYLE('direct',.POSITIVE.,(#40));
                #42=IFCPRESENTATIONSTYLEASSIGNMENT((#41));
                #43=IFCSTYLEDITEM(#6,(#42),$);
                #44=IFCCOLOURRGB('mapped',0.2,0.3,0.9);
                #45=IFCSURFACESTYLERENDERING(#44,0.,$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.00390625),IFCSPECULAREXPONENT(10.),.NOTDEFINED.);
                #46=IFCSURFACESTYLE('mapped',.POSITIVE.,(#45));
                #47=IFCPRESENTATIONSTYLEASSIGNMENT((#46));
                #48=IFCSTYLEDITEM(#26,(#47),$);
                #50=IFCPROJECT('project-guid',$,'Project',$,$,$,$,(#8),#31);
                #51=IFCBUILDINGSTOREY('storey-guid',$,'Level 1',$,$,#9,$,$,.ELEMENT.,0.);
                #52=IFCRELAGGREGATES('aggregate-guid',$,$,$,#50,(#51));
                #53=IFCRELCONTAINEDINSPATIALSTRUCTURE('contain-guid',$,$,$,(#13,#29),#51);
                #54=IFCPROPERTYSET('pset-guid',$,'Pset_Test',$,(#20));
                #55=IFCRELDEFINESBYPROPERTIES('property-rel',$,$,$,(#13),#54);
                #56=IFCQUANTITYLENGTH('Length',$,$,1500.);
                #57=IFCELEMENTQUANTITY('quantity-guid',$,'BaseQuantities',$,$,(#56));
                #58=IFCRELDEFINESBYPROPERTIES('quantity-rel',$,$,$,(#13),#57);
                #59=IFCMATERIAL('Steel');
                #60=IFCRELASSOCIATESMATERIAL('material-rel',$,$,$,(#13),#59);
                #61=IFCCLASSIFICATIONREFERENCE($,'A-1','Class',$);
                #62=IFCRELASSOCIATESCLASSIFICATION('classification-rel',$,$,$,(#13),#61);
                #63=IFCWALLTYPE('type-guid',$,'Wall type',$,$,(#54),$,$,.NOTDEFINED.);
                #64=IFCRELDEFINESBYTYPE('type-rel',$,$,$,(#13),#63);
                ENDSEC;
                END-ISO-10303-21;
                """;
            File.WriteAllText(sourcePath, source, new UTF8Encoding(false));

            var result = StepScanner.Scan(new ScanOptions(sourcePath, manifestPath, indexPath, chunkPath));
            var manifest = result.Manifest;
            var probePath = Path.Combine(directory, "fixture.probe.json");
            var probeIndexPath = Path.Combine(directory, "fixture.probe.ifc2idx");
            var probe = LargeStepProbe.Run(sourcePath, probePath, probeIndexPath, checkGraph: true,
                chunkOutputDirectory: Path.Combine(directory, "probe.chunks"));
            Assert(probe.GeometryStatus == "native-artifact-produced-unverified", "Probe artifact status is wrong.");
            Assert(probe.SourceSha256 == manifest.Source.Sha256, "Probe SHA-256 differs from the guarded scanner.");
            Assert(probe.Schema == manifest.Source.Schema, "Probe schema differs from the guarded scanner.");
            Assert(probe.EntityCount == manifest.Scan.EntityCount && probe.MaximumExpressId == manifest.Scan.MaximumExpressId,
                "Probe entity inventory differs from the guarded scanner.");
            Assert(probe.MaximumRecordBytes == manifest.Scan.MaximumRecordBytes, "Probe truncated a long record.");
            Assert(probe.Reachability is { ProductDefinitionShapes: 2, RootItemOccurrences: 2,
                LeafItemOccurrences: 2, MappedItemOccurrences: 1, InvalidReferences: 0 },
                "Probe representation-map reachability inventory is wrong.");
            Assert(probe.Reachability!.LeafItemTypes["IFCFACETEDBREP"] == 2,
                "Probe reachable geometry family count is wrong.");
            Assert(probe.GraphValidation is { Status: "complete", GeometryPlan: { Status: "complete" } },
                "Probe graph validation differs from the guarded scanner.");
            Assert(probe.Tessellation is { ViewerReady: true, Triangles: 2, Products: 2 },
                "Probe artifact differs from the guarded scanner.");
            var standardIndex = File.ReadAllBytes(indexPath);
            var probeIndex = File.ReadAllBytes(probeIndexPath);
            Assert(standardIndex.Length == probeIndex.Length, "Probe index size differs from the guarded scanner.");
            Assert(standardIndex.AsSpan(0, 72).SequenceEqual(probeIndex.AsSpan(0, 72)), "Probe index header differs.");
            Assert(standardIndex.AsSpan(4096).SequenceEqual(probeIndex.AsSpan(4096)), "Probe index entries or checksum differ.");
            GraphCoverageAnalyzer.ValidateIndex(probeIndex, new FileInfo(sourcePath).Length, Convert.FromHexString(probe.SourceSha256), 64);
            probeIndex[4096 + 16] ^= 1;
            try
            {
                GraphCoverageAnalyzer.ValidateIndex(probeIndex, new FileInfo(sourcePath).Length,
                    Convert.FromHexString(probe.SourceSha256), 64);
                throw new InvalidOperationException("Corrupt probe index was accepted.");
            }
            catch (InvalidDataException) { }
            Assert(manifest.Complete, "Manifest was not marked complete.");
            Assert(manifest.Source.Schema == "IFC2X3", "Schema detection failed.");
            Assert(manifest.Scan.EntityCount == 51, "Entity count is wrong.");
            Assert(manifest.Scan.MaximumExpressId == 64, "Maximum Express ID is wrong.");
            Assert(manifest.Scan.MaximumRecordBytes > 1024 * 1024, "Large record was truncated.");
            Assert(manifest.Coverage.Status == "fast-path-candidate", "Supported fixture was not accepted as a fast-path candidate.");
            Assert(manifest.Coverage.Graph.Status == "complete", "Graph coverage did not complete.");
            Assert(manifest.Coverage.Graph.ProductDefinitions == 2 && manifest.Coverage.Graph.ResolvedProductDefinitions == 2, "Product definition coverage is wrong.");
            Assert(manifest.Coverage.Graph.ProductBindings.BoundProductDefinitions == 2, "Product binding coverage is wrong.");
            Assert(manifest.Coverage.Graph.GeometryPlan.ResolvedBaseDefinitions == 2, "Base geometry plan coverage is wrong.");
            Assert(manifest.Coverage.Graph.GeometryPlan.CleanedExpandedTriangles == 2, "Triangle plan is wrong.");
            Assert(manifest.Coverage.Topology.PolyLoops == 1, "PolyLoop census is wrong.");
            Assert(manifest.Coverage.Topology.CandidateTrianglesBeforeHoleReconciliation == 1, "Triangle candidate census is wrong.");
            Assert(manifest.Coverage.Placements.RootLocalPlacements == 1, "Root placement census is wrong.");
            Assert(manifest.Source.Sha256 == Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(sourcePath))), "SHA-256 does not match the source.");
            var tessellation = manifest.Tessellation ?? throw new InvalidOperationException("Tessellation artifact is missing.");
            Assert(tessellation is { Complete: true, ViewerReady: true }, "Tessellation artifact state is wrong.");
            Assert(tessellation.PositionPolicy == "float64-source-adaptive-triangle-cluster-rebase-before-float32-upload", "Position policy is wrong.");
            Assert(tessellation.NormalPolicy == "octahedral-snorm16-per-triangle", "Normal policy is wrong.");
            Assert(tessellation.Triangles == 2 && tessellation.Indices == 6, "Tessellation triangle coverage is wrong.");
            Assert(tessellation.Products == 2 && tessellation.Instances == 2, "Instance coverage is wrong.");
            Assert(tessellation.LengthUnitScaleToMetres == 0.001, "Length-unit scale is wrong.");
            Assert(tessellation.Materials is { Status: "complete", MaterialDefinitions: 3, InstanceAssignments: 2 }, "Material coverage is wrong.");
            Assert(tessellation.Chunks.Count == 13, "Artifact chunk count is wrong.");
            Assert(tessellation.Semantic is { Status: "complete", Records: 4, ParentLinks: 3, Roots: 1, RepresentedProducts: 2 }, "Semantic-core coverage is wrong.");
            Assert(tessellation.Semantic.Deep is { Status: "complete", Records: 2, ProductsWithRelations: 1 }, "Deep semantic coverage is wrong.");

            Span<byte> chunkHeader = stackalloc byte[32];
            foreach (var chunk in tessellation.Chunks)
            {
                var chunkFile = Path.Combine(chunkPath, chunk.File);
                using var chunkStream = File.OpenRead(chunkFile);
                chunkStream.ReadExactly(chunkHeader);
                Assert(chunkHeader[..8].SequenceEqual("IFCV2CHK"u8), $"Chunk {chunk.File} magic is wrong.");
                Assert(BinaryPrimitives.ReadUInt16LittleEndian(chunkHeader[10..]) == chunk.Kind, $"Chunk {chunk.File} kind is wrong.");
                Assert(BinaryPrimitives.ReadUInt64LittleEndian(chunkHeader[16..]) == (ulong)chunk.PayloadBytes, $"Chunk {chunk.File} payload length is wrong.");
                Assert(Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(chunkFile))) == chunk.Sha256, $"Chunk {chunk.File} checksum is wrong.");
            }

            using (var positions = File.OpenRead(Path.Combine(chunkPath, "positions.ifcv2")))
            {
                positions.Position = 32;
                Span<byte> record = stackalloc byte[16];
                positions.ReadExactly(record);
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 1, "Position-table Express ID is wrong.");
                Assert(BinaryPrimitives.ReadSingleLittleEndian(record[4..]) == 0f, "Position-table X is wrong.");
                Assert(BinaryPrimitives.ReadSingleLittleEndian(record[8..]) == 1f, "Position-table Y is wrong.");
                Assert(BinaryPrimitives.ReadSingleLittleEndian(record[12..]) == 2f, "Position-table Z is wrong.");
            }

            using (var positions = File.OpenRead(Path.Combine(chunkPath, "positions-f64.ifcv2")))
            {
                positions.Position = 32;
                Span<byte> record = stackalloc byte[32];
                positions.ReadExactly(record);
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 1, "High-precision position Express ID is wrong.");
                Assert(BinaryPrimitives.ReadDoubleLittleEndian(record[8..]) == 0, "High-precision position X is wrong.");
                Assert(BinaryPrimitives.ReadDoubleLittleEndian(record[16..]) == 1, "High-precision position Y is wrong.");
                Assert(BinaryPrimitives.ReadDoubleLittleEndian(record[24..]) == 2, "High-precision position Z is wrong.");
            }

            using (var meshes = File.OpenRead(Path.Combine(chunkPath, "meshes.ifcv2")))
            {
                meshes.Position = 32;
                Span<byte> record = stackalloc byte[56];
                meshes.ReadExactly(record);
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 6, "Mesh-table base definition is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[4..]) == 13, "Mesh-table product binding is wrong.");
                Assert(BinaryPrimitives.ReadInt64LittleEndian(record[8..]) == 0, "Mesh-table first index is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[16..]) == 3, "Mesh-table index count is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[20..]) == 1, "Mesh-table face count is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[24..]) == 1, "Mesh-table occurrence count is wrong.");

                meshes.ReadExactly(record);
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 32, "Mapped mesh-table base definition is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[24..]) == 1, "Mapped mesh-table occurrence count is wrong.");
            }

            using (var indices = File.OpenRead(Path.Combine(chunkPath, "indices.ifcv2")))
            {
                indices.Position = 32;
                Span<byte> record = stackalloc byte[12];
                indices.ReadExactly(record);
                var pointOrdinals = new[]
                {
                    BinaryPrimitives.ReadUInt32LittleEndian(record),
                    BinaryPrimitives.ReadUInt32LittleEndian(record[4..]),
                    BinaryPrimitives.ReadUInt32LittleEndian(record[8..]),
                };
                Array.Sort(pointOrdinals);
                Assert(pointOrdinals.SequenceEqual(new uint[] { 0, 1, 2 }), "Triangle indices do not cover the fixture points.");
            }

            using (var instances = File.OpenRead(Path.Combine(chunkPath, "instances.ifcv2")))
            {
                instances.Position = 32;
                Span<byte> record = stackalloc byte[112];
                instances.ReadExactly(record);
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 13, "Instance product is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[4..]) == 6, "Instance base definition is wrong.");
                Assert(BinaryPrimitives.ReadUInt32LittleEndian(record[12..]) == 0, "Direct instance flags are wrong.");
                Assert(BinaryPrimitives.ReadDoubleLittleEndian(record[88..]) == 0, "Instance translation X is wrong.");
                Assert(BinaryPrimitives.ReadDoubleLittleEndian(record[96..]) == 1, "Instance translation Y is wrong.");
                Assert(BinaryPrimitives.ReadDoubleLittleEndian(record[104..]) == 2, "Instance translation Z is wrong.");

                instances.ReadExactly(record);
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 29, "Mapped instance product is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[4..]) == 32, "Mapped instance base definition is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[8..]) == 26, "Mapped instance source item is wrong.");
                Assert(BinaryPrimitives.ReadUInt32LittleEndian(record[12..]) == 1, "Mapped instance flags are wrong.");
                Assert(BinaryPrimitives.ReadDoubleLittleEndian(record[88..]) == 5, "Mapped instance translation X is wrong.");
                Assert(BinaryPrimitives.ReadDoubleLittleEndian(record[96..]) == 8, "Mapped instance translation Y is wrong.");
                Assert(BinaryPrimitives.ReadDoubleLittleEndian(record[104..]) == 11, "Mapped instance translation Z is wrong.");
            }

            using (var materials = File.OpenRead(Path.Combine(chunkPath, "materials.ifcv2")))
            {
                materials.Position = 32 + 32;
                Span<byte> record = stackalloc byte[32];
                materials.ReadExactly(record);
                Assert(BinaryPrimitives.ReadUInt32LittleEndian(record) == 1, "Direct material ordinal is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[4..]) == 43, "Direct material source style is wrong.");
                Assert(BinaryPrimitives.ReadSingleLittleEndian(record[16..]) == 0.8f, "Direct material red channel is wrong.");
                Assert(BinaryPrimitives.ReadSingleLittleEndian(record[28..]) == 0.75f, "Direct material alpha is wrong.");

                materials.ReadExactly(record);
                Assert(BinaryPrimitives.ReadUInt32LittleEndian(record) == 2, "Mapped material ordinal is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[4..]) == 48, "Mapped material source style is wrong.");
                Assert(BinaryPrimitives.ReadSingleLittleEndian(record[24..]) == 0.9f, "Mapped material blue channel is wrong.");
            }

            using (var assignments = File.OpenRead(Path.Combine(chunkPath, "instance-materials.ifcv2")))
            {
                assignments.Position = 32;
                Span<byte> records = stackalloc byte[8];
                assignments.ReadExactly(records);
                Assert(BinaryPrimitives.ReadUInt32LittleEndian(records) == 1, "Direct instance material assignment is wrong.");
                Assert(BinaryPrimitives.ReadUInt32LittleEndian(records[4..]) == 2, "Mapped instance material assignment is wrong.");
            }

            using (var normals = File.OpenRead(Path.Combine(chunkPath, "normals.ifcv2")))
            {
                normals.Position = 32;
                Span<byte> records = stackalloc byte[8];
                normals.ReadExactly(records);
                Assert(!records[..4].SequenceEqual(new byte[4]), "Direct triangle normal was not encoded.");
                Assert(records[..4].SequenceEqual(records[4..]), "Equivalent base triangles produced different normals.");
            }

            using (var products = File.OpenRead(Path.Combine(chunkPath, "products.ifcv2")))
            {
                products.Position = 32;
                Span<byte> record = stackalloc byte[24];
                products.ReadExactly(record);
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 13, "Product-table Express ID is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[4..]) == 12, "Product-table definition is wrong.");
                Assert(BinaryPrimitives.ReadInt64LittleEndian(record[8..]) == 0, "Product-table first instance is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[16..]) == 1, "Product-table instance count is wrong.");

                products.ReadExactly(record);
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 29, "Mapped product-table Express ID is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[4..]) == 28, "Mapped product-table definition is wrong.");
                Assert(BinaryPrimitives.ReadInt64LittleEndian(record[8..]) == 1, "Mapped product-table first instance is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[16..]) == 1, "Mapped product-table instance count is wrong.");
            }

            using (var records = File.OpenRead(Path.Combine(chunkPath, "semantic-records.ifcv2")))
            using (var strings = File.OpenRead(Path.Combine(chunkPath, "semantic-strings.ifcv2")))
            {
                records.Position = 32;
                Span<byte> record = stackalloc byte[48];
                records.ReadExactly(record);
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 13, "Semantic record Express ID is wrong.");
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record[4..]) == 51, "Semantic parent is wrong.");
                Assert((BinaryPrimitives.ReadUInt16LittleEndian(record[10..]) & 1) != 0, "Semantic represented-product flag is missing.");
                var nameOffset = BinaryPrimitives.ReadUInt32LittleEndian(record[20..]);
                var nameLength = BinaryPrimitives.ReadUInt32LittleEndian(record[24..]);
                var nameBytes = new byte[nameLength];
                strings.Position = 32 + nameOffset;
                strings.ReadExactly(nameBytes);
                Assert(Encoding.UTF8.GetString(nameBytes) == "Đirect wall", "Semantic STEP string decoding is wrong.");
            }

            using (var deepIndex = File.OpenRead(Path.Combine(chunkPath, "semantic-deep-index.ifcv2")))
            using (var deepValues = File.OpenRead(Path.Combine(chunkPath, "semantic-deep-values.ifcv2")))
            {
                deepIndex.Position = 32;
                Span<byte> record = stackalloc byte[24];
                deepIndex.ReadExactly(record);
                Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 13, "Deep semantic product ID is wrong.");
                var valueOffset = BinaryPrimitives.ReadUInt64LittleEndian(record[8..]);
                var valueLength = BinaryPrimitives.ReadUInt32LittleEndian(record[16..]);
                var value = new byte[valueLength];
                deepValues.Position = checked(32 + (long)valueOffset);
                deepValues.ReadExactly(value);
                using var deep = JsonDocument.Parse(value);
                var root = deep.RootElement;
                Assert(root.GetProperty("type").GetProperty("expressId").GetInt32() == 63, "Native type relation is wrong.");
                Assert(root.GetProperty("material").GetProperty("name").GetString() == "Steel", "Native material relation is wrong.");
                Assert(root.GetProperty("properties").GetProperty("Pset_Test").GetProperty("long").GetString() == longValue, "Native property value is wrong.");
                Assert(root.GetProperty("quantities").GetProperty("BaseQuantities").GetProperty("Length").GetDouble() == 1.5, "Native quantity normalization is wrong.");
                Assert(root.GetProperty("classifications")[0].GetProperty("identification").GetString() == "A-1", "Native classification relation is wrong.");
            }

            using var index = File.OpenRead(indexPath);
            var header = new byte[4096];
            index.ReadExactly(header);
            Assert(Encoding.ASCII.GetString(header, 0, 8) == "IFC2IDX2", "Index magic is wrong.");
            Assert(BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(8)) == 2, "Index version is wrong.");
            Assert(BinaryPrimitives.ReadInt64LittleEndian(header.AsSpan(24)) == 64, "Index maximum ID is wrong.");
            index.Position = index.Length - 48;
            var footer = new byte[48];
            index.ReadExactly(footer);
            Assert(Encoding.ASCII.GetString(footer, 0, 8) == "IFC2END2", "Index footer is missing.");
            Assert(BinaryPrimitives.ReadInt64LittleEndian(footer.AsSpan(8)) == BinaryPrimitives.ReadInt64LittleEndian(header.AsSpan(32)), "Index footer entity count is wrong.");
            var indexBytes = File.ReadAllBytes(indexPath);
            var sourceHash = header.AsSpan(40, 32).ToArray();
            GraphCoverageAnalyzer.ValidateIndex(indexBytes, BinaryPrimitives.ReadInt64LittleEndian(header.AsSpan(16)), sourceHash, 64);
            indexBytes[4096 + 16] ^= 1;
            try
            {
                GraphCoverageAnalyzer.ValidateIndex(indexBytes, BinaryPrimitives.ReadInt64LittleEndian(header.AsSpan(16)), sourceHash, 64);
                throw new InvalidOperationException("Corrupted index entries escaped footer validation.");
            }
            catch (InvalidDataException)
            {
                // Expected: a checksum failure prevents graph planning from using the index.
            }
            index.Position = 4096 + 20 * 16 + 8;
            Span<byte> lengthBytes = stackalloc byte[4];
            index.ReadExactly(lengthBytes);
            Assert(BinaryPrimitives.ReadInt32LittleEndian(lengthBytes) > 1024 * 1024, "Index lost the large record length.");

            using var parsed = JsonDocument.Parse(File.ReadAllText(manifestPath));
            Assert(parsed.RootElement.GetProperty("complete").GetBoolean(), "Atomic JSON manifest is invalid.");
            Assert(!Directory.EnumerateFileSystemEntries(directory, "*.partial").Any(), "Partial artifacts were not cleaned up.");
        }
        finally
        {
            DeleteTestDirectory(directory);
        }
    }

    private static void TestSizeLimit()
    {
        LargeStepProbe.CheckSize(LargeStepProbe.MaximumSourceBytes);
        try
        {
            LargeStepProbe.CheckSize(LargeStepProbe.MaximumSourceBytes + 1);
            throw new InvalidOperationException("The 2 GiB probe boundary accepted one byte too many.");
        }
        catch (InvalidDataException) { }
        var directory = Path.Combine(Path.GetTempPath(), $"ifc-engine-v2-limit-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            var sourcePath = Path.Combine(directory, "small.ifc");
            File.WriteAllText(sourcePath, "#1=IFCCARTESIANPOINT((0.,0.,0.));", Encoding.ASCII);
            try
            {
                StepScanner.Scan(new ScanOptions(sourcePath, Path.Combine(directory, "manifest.json"), null, MaximumIfcBytes: 1));
                throw new InvalidOperationException("Size limit did not reject an oversized file.");
            }
            catch (IfcSizeLimitException exception)
            {
                Assert(exception.ActualBytes > exception.MaximumBytes, "Size limit exception has invalid measurements.");
            }
        }
        finally
        {
            DeleteTestDirectory(directory);
        }
    }

    private static void TestLargeProbeChunkBoundary()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"ifc-engine-v2-boundary-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            var sourcePath = Path.Combine(directory, "boundary.ifc");
            const string prefix = "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCPROPERTYSINGLEVALUE('";
            var padding = new string('X', 16 * 1024 * 1024 - 1 - Encoding.ASCII.GetByteCount(prefix));
            File.WriteAllText(sourcePath, prefix + padding + "''more',$,$);\n#2=IFCCARTESIANPOINT((0.,0.,0.));\nENDSEC;",
                new UTF8Encoding(false));
            var result = LargeStepProbe.Run(sourcePath, Path.Combine(directory, "probe.json"),
                Path.Combine(directory, "probe.ifc2idx"));
            using var input = File.OpenRead(sourcePath);
            Assert(result.SourceSha256 == Convert.ToHexString(SHA256.HashData(input)),
                "Probe hash changed when an escaped quote crossed a hash chunk.");
            Assert(result.EntityCount == 2 && result.MaximumExpressId == 2,
                "Probe lost a record across a hash chunk.");
            Assert(result.MaximumRecordBytes > 16 * 1024 * 1024 - prefix.Length,
                "Probe truncated a record across a hash chunk.");
        }
        finally { DeleteTestDirectory(directory); }
    }

    private static void TestUnsupportedProfileFallsBack()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"ifc-engine-v2-fallback-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            var sourcePath = Path.Combine(directory, "unsupported.ifc");
            File.WriteAllText(
                sourcePath,
                """
                ISO-10303-21;
                HEADER;
                FILE_SCHEMA(('IFC4'));
                ENDSEC;
                DATA;
                #1=IFCCARTESIANPOINT((0.,0.,0.));
                #2=IFCDIRECTION((0.,0.,1.));
                #3=IFCDIRECTION((1.,0.,0.));
                #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
                #5=IFCLOCALPLACEMENT($,#4);
                #6=IFCBOOLEANRESULT(.DIFFERENCE.,#100,#101);
                #7=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
                #8=IFCSHAPEREPRESENTATION(#7,'Body','CSG',(#6));
                #9=IFCPRODUCTDEFINITIONSHAPE($,$,(#8));
                #10=IFCWALL('unsupported-guid',$,'Unsupported wall',$,$,#5,#9,$);
                #11=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
                #12=IFCUNITASSIGNMENT((#11));
                ENDSEC;
                END-ISO-10303-21;
                """, new UTF8Encoding(false));
            var chunks = Path.Combine(directory, "chunks");
            var result = StepScanner.Scan(new ScanOptions(
                sourcePath,
                Path.Combine(directory, "manifest.json"),
                Path.Combine(directory, "index.ifc2idx"),
                chunks));
            Assert(result.Manifest.Coverage.Status == "fallback-required", "Unsupported geometry did not select fallback.");
            Assert(result.Manifest.EntityTypes.GetValueOrDefault("IFCBOOLEANRESULT") == 1, "Boolean geometry census is wrong.");
            Assert(result.Manifest.Coverage.Reasons.Any(reason => reason.Contains("Boolean operand #100", StringComparison.Ordinal)),
                "Reachable fallback reason lost the missing boolean operand path.");
            Assert(result.Manifest.Tessellation is null && !Directory.Exists(chunks), "Fallback scan published a partial artifact.");
        }
        finally
        {
            DeleteTestDirectory(directory);
        }
    }

    private static void TestExtrusionArtifact()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"ifc-engine-v2-extrusion-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            var sourcePath = Path.Combine(directory, "extrusion.ifc");
            var chunks = Path.Combine(directory, "chunks");
            File.WriteAllText(sourcePath, """
                ISO-10303-21;
                HEADER;
                FILE_SCHEMA(('IFC4'));
                ENDSEC;
                DATA;
                #1=IFCCARTESIANPOINT((0.,0.,0.));
                #2=IFCDIRECTION((0.,0.,1.));
                #3=IFCDIRECTION((1.,0.,0.));
                #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
                #5=IFCLOCALPLACEMENT($,#4);
                #6=IFCAXIS2PLACEMENT2D(#1,#3);
                #7=IFCRECTANGLEPROFILEDEF(.AREA.,'Rect',#6,2.,4.);
                #8=IFCEXTRUDEDAREASOLID(#7,#4,#2,3.);
                #9=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
                #10=IFCSHAPEREPRESENTATION(#9,'Body','SweptSolid',(#8));
                #11=IFCSHAPEREPRESENTATION(#9,'Axis','Curve3D',(#999));
                #12=IFCPRODUCTDEFINITIONSHAPE($,$,(#10,#11));
                #13=IFCWALL('extrusion-guid',$,'Extruded wall',$,$,#5,#12,$);
                #14=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
                #15=IFCUNITASSIGNMENT((#14));
                #99=IFCBOOLEANRESULT(.DIFFERENCE.,#97,#98);
                ENDSEC;
                END-ISO-10303-21;
                """, new UTF8Encoding(false));
            var result = StepScanner.Scan(new ScanOptions(
                sourcePath,
                Path.Combine(directory, "manifest.json"),
                Path.Combine(directory, "index.ifc2idx"),
                chunks));
            Assert(result.Manifest.Coverage.Status == "fast-path-candidate", "Supported extrusion selected fallback.");
            Assert(result.Manifest.EntityTypes.GetValueOrDefault("IFCBOOLEANRESULT") == 1,
                "Unused boolean geometry was not retained in the entity census.");
            Assert(result.Manifest.Coverage.Graph.Status == "complete", "Extrusion graph coverage is incomplete.");
            var tessellation = result.Manifest.Tessellation ?? throw new InvalidOperationException("Extrusion artifact is missing.");
            Assert(tessellation.BaseDefinitions == 1 && tessellation.Products == 1 && tessellation.Instances == 1, "Extrusion identity coverage is wrong.");
            Assert(tessellation.Triangles == 12 && tessellation.UniqueFaces == 6, "Rectangular extrusion topology is wrong.");
            Assert(tessellation.CartesianPoints == 9, "Generated extrusion vertex count is wrong.");
            var probe = LargeStepProbe.Run(sourcePath, Path.Combine(directory, "extrusion.probe.json"),
                Path.Combine(directory, "extrusion.probe.ifc2idx"), checkExtrusions: true);
            Assert(probe.ExtrusionValidation is { ReachableUniqueExtrusions: 1, Succeeded: 1,
                Failed: 0, GeneratedTriangles: 12 }, "Reachable extrusion validation differs from artifact geometry.");
            Assert(probe.ExtrusionValidation!.SucceededByProfile.GetValueOrDefault("IFCRECTANGLEPROFILEDEF") == 1,
                "Reachable extrusion was assigned the wrong profile family.");

            using var meshes = File.OpenRead(Path.Combine(chunks, "meshes.ifcv2"));
            meshes.Position = 32;
            Span<byte> record = stackalloc byte[56];
            meshes.ReadExactly(record);
            Assert(BinaryPrimitives.ReadSingleLittleEndian(record[32..]) == -1f, "Extrusion minimum X is wrong.");
            Assert(BinaryPrimitives.ReadSingleLittleEndian(record[36..]) == -2f, "Extrusion minimum Y is wrong.");
            Assert(BinaryPrimitives.ReadSingleLittleEndian(record[40..]) == 0f, "Extrusion minimum Z is wrong.");
            Assert(BinaryPrimitives.ReadSingleLittleEndian(record[44..]) == 1f, "Extrusion maximum X is wrong.");
            Assert(BinaryPrimitives.ReadSingleLittleEndian(record[48..]) == 2f, "Extrusion maximum Y is wrong.");
            Assert(BinaryPrimitives.ReadSingleLittleEndian(record[52..]) == 3f, "Extrusion maximum Z is wrong.");
        }
        finally
        {
            DeleteTestDirectory(directory);
        }
    }

    private static void TestRoundedHollowProfileArtifact()
    {
        WithArtifact("rounded-hollow", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCDIRECTION((0.,0.,1.));
            #3=IFCDIRECTION((1.,0.,0.));
            #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
            #5=IFCLOCALPLACEMENT($,#4);
            #6=IFCRECTANGLEHOLLOWPROFILEDEF(.AREA.,'RHS',$,200.,100.,8.,2.,10.);
            #7=IFCEXTRUDEDAREASOLID(#6,#4,#2,3.);
            #8=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
            #9=IFCSHAPEREPRESENTATION(#8,'Body','SweptSolid',(#7));
            #10=IFCPRODUCTDEFINITIONSHAPE($,$,(#9));
            #11=IFCBEAM('rounded-hollow-guid',$,'RHS',$,$,#5,#10,$);
            #12=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #13=IFCUNITASSIGNMENT((#12));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, chunks) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate" &&
                manifest.Coverage.Graph.GeometryPlan.Status == "complete",
                "Rounded hollow profile did not pass geometry planning.");
            Assert(manifest.Tessellation is { ViewerReady: true, BaseDefinitions: 1, Products: 1, Instances: 1 },
                "Rounded hollow profile did not produce a complete artifact.");
            Assert(manifest.Tessellation!.Triangles > 100,
                "Rounded hollow profile lost its curved corners.");
            using var positions = File.OpenRead(Path.Combine(chunks, "positions-f64.ifcv2"));
            positions.Position = 32;
            Span<byte> point = stackalloc byte[32];
            var outerTangent = false;
            var innerTangent = false;
            while (positions.Position < positions.Length)
            {
                positions.ReadExactly(point);
                var x = BinaryPrimitives.ReadDoubleLittleEndian(point[8..]);
                var y = BinaryPrimitives.ReadDoubleLittleEndian(point[16..]);
                var z = BinaryPrimitives.ReadDoubleLittleEndian(point[24..]);
                if (Math.Abs(z) > 1e-10) continue;
                if (Math.Abs(x - 90) < 1e-8 && Math.Abs(y + 50) < 1e-8) outerTangent = true;
                if (Math.Abs(x - 90) < 1e-8 && Math.Abs(y + 42) < 1e-8) innerTangent = true;
            }
            Assert(outerTangent && innerTangent,
                "Rounded hollow profile lost outer or inner fillet tangencies.");
        });
    }

    private static void TestCAndLProfileArtifact()
    {
        WithArtifact("c-and-l-profiles", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC2X3'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCDIRECTION((0.,0.,1.));
            #3=IFCDIRECTION((1.,0.,0.));
            #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
            #5=IFCLOCALPLACEMENT($,#4);
            #6=IFCCSHAPEPROFILEDEF(.AREA.,'C',$,100.,50.,1.5,15.,$,$);
            #7=IFCEXTRUDEDAREASOLID(#6,#4,#2,3.);
            #8=IFCLSHAPEPROFILEDEF(.AREA.,'L',$,63.,63.,5.,7.,1.7,$,$,$);
            #9=IFCEXTRUDEDAREASOLID(#8,#4,#2,3.);
            #10=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
            #11=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#7));
            #12=IFCPRODUCTDEFINITIONSHAPE($,$,(#11));
            #13=IFCBEAM('c-profile-guid',$,'C',$,$,#5,#12,$);
            #14=IFCSHAPEREPRESENTATION(#10,'Body','SweptSolid',(#9));
            #15=IFCPRODUCTDEFINITIONSHAPE($,$,(#14));
            #16=IFCBEAM('l-profile-guid',$,'L',$,$,#5,#15,$);
            #17=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #18=IFCUNITASSIGNMENT((#17));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, chunks) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate" &&
                manifest.Tessellation is { ViewerReady: true, BaseDefinitions: 2, Products: 2, Instances: 2 },
                "C and rounded L profiles did not produce complete geometry.");
            using var meshes = File.OpenRead(Path.Combine(chunks, "meshes.ifcv2"));
            meshes.Position = 32;
            Span<byte> record = stackalloc byte[56];
            meshes.ReadExactly(record);
            Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 7 &&
                BinaryPrimitives.ReadInt32LittleEndian(record[16..]) / 3 == 44,
                "C profile topology differs from the independently triangulated solid.");
            meshes.ReadExactly(record);
            Assert(BinaryPrimitives.ReadInt32LittleEndian(record) == 9 &&
                BinaryPrimitives.ReadInt32LittleEndian(record[16..]) / 3 > 100,
                "Rounded L profile lost its inner or edge fillets.");
        });
    }

    private static void TestEmptyShapeRepresentation()
    {
        WithArtifact("empty-shape-representation", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC2X3'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCDIRECTION((0.,0.,1.));
            #3=IFCDIRECTION((1.,0.,0.));
            #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
            #5=IFCLOCALPLACEMENT($,#4);
            #6=IFCRECTANGLEPROFILEDEF(.AREA.,'Rect',$,2.,4.);
            #7=IFCEXTRUDEDAREASOLID(#6,#4,#2,3.);
            #8=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
            #9=IFCSHAPEREPRESENTATION(#8,'Body','SweptSolid',(#7));
            #10=IFCPRODUCTDEFINITIONSHAPE($,$,(#9));
            #11=IFCBEAM('solid-guid',$,'Solid',$,$,#5,#10,$);
            #12=IFCSHAPEREPRESENTATION(#8,'Body','MappedRepresentation',());
            #13=IFCPRODUCTDEFINITIONSHAPE($,$,(#12));
            #14=IFCBEAM('empty-guid',$,'Empty',$,$,#5,#13,$);
            #15=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #16=IFCUNITASSIGNMENT((#15));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Graph.Status == "complete" &&
                manifest.Tessellation is { ViewerReady: true, Products: 1, Instances: 1 },
                "An explicitly empty shape representation changed the visible solid coverage.");
        });
    }

    private static void TestGenericProductRepresentationArtifact()
    {
        var source = BasicBrepFixture("#15=IFCLOCALPLACEMENT($,#6);", 15, "(#11)")
            .Replace("IFCPRODUCTDEFINITIONSHAPE", "IFCPRODUCTREPRESENTATION", StringComparison.Ordinal);
        WithArtifact("generic-product-representation", source, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate", "IfcProductRepresentation selected fallback.");
            Assert(manifest.Tessellation?.ViewerReady == true, "IfcProductRepresentation did not produce viewer geometry.");
        });
    }

    private static void TestDerivedAndTaperedArtifact()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"ifc-engine-v2-derived-tapered-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            var sourcePath = Path.Combine(directory, "derived-tapered.ifc");
            var chunks = Path.Combine(directory, "chunks");
            File.WriteAllText(sourcePath, """
                ISO-10303-21;
                HEADER;
                FILE_SCHEMA(('IFC4'));
                ENDSEC;
                DATA;
                #1=IFCCARTESIANPOINT((0.,0.,0.));
                #2=IFCDIRECTION((0.,0.,1.));
                #3=IFCDIRECTION((1.,0.,0.));
                #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
                #5=IFCLOCALPLACEMENT($,#4);
                #6=IFCCARTESIANPOINT((0.,-0.5));
                #7=IFCCARTESIANTRANSFORMATIONOPERATOR2D($,$,#6,$);
                #8=IFCRECTANGLEPROFILEDEF(.AREA.,'Parent',$,2.,1.);
                #9=IFCDERIVEDPROFILEDEF(.AREA.,'Derived',#8,#7,$);
                #10=IFCEXTRUDEDAREASOLID(#9,#4,#2,3.);
                #11=IFCISHAPEPROFILEDEF(.AREA.,'Start',$,0.5,0.8,0.01,0.02,$,$,$);
                #12=IFCISHAPEPROFILEDEF(.AREA.,'End',$,0.5,0.625,0.01,0.02,$,$,$);
                #13=IFCEXTRUDEDAREASOLIDTAPERED(#11,#4,#2,3.,#12);
                #14=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
                #15=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#10));
                #16=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#13));
                #17=IFCPRODUCTDEFINITIONSHAPE($,$,(#15));
                #18=IFCPRODUCTDEFINITIONSHAPE($,$,(#16));
                #19=IFCWALL('derived-guid',$,'Derived',$,$,#5,#17,$);
                #20=IFCWALL('tapered-guid',$,'Tapered',$,$,#5,#18,$);
                #21=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
                #22=IFCUNITASSIGNMENT((#21));
                #23=IFCMATERIAL('Concrete');
                #24=IFCMATERIALLAYER(#23,0.2,$,$,$,$,$);
                #25=IFCMATERIALLAYERSET((#24),$,$);
                #26=IFCMATERIALLAYERSETUSAGE(#25,.AXIS2.,.POSITIVE.,0.);
                #27=IFCRELASSOCIATESMATERIAL('association-guid',$,$,$,(#19),#26);
                ENDSEC;
                END-ISO-10303-21;
                """, new UTF8Encoding(false));
            var result = StepScanner.Scan(new ScanOptions(sourcePath,
                Path.Combine(directory, "manifest.json"), Path.Combine(directory, "index.ifc2idx"), chunks));
            Assert(result.Manifest.Coverage.Status == "fast-path-candidate", "Derived/tapered extrusion selected fallback.");
            var tessellation = result.Manifest.Tessellation ?? throw new InvalidOperationException("Derived/tapered artifact is missing.");
            Assert(tessellation.BaseDefinitions == 2 && tessellation.Triangles == 56,
                "Derived/tapered extrusion triangle coverage is wrong.");
            Assert(tessellation.Materials.Status == "complete",
                "An unstyled material-layer set must use the faithful default appearance.");
            using var meshes = File.OpenRead(Path.Combine(chunks, "meshes.ifcv2"));
            meshes.Position = 32;
            Span<byte> mesh = stackalloc byte[56];
            var foundDerived = false;
            while (meshes.Read(mesh) == mesh.Length)
            {
                if (BinaryPrimitives.ReadInt32LittleEndian(mesh) != 10) continue;
                foundDerived = true;
                Assert(BinaryPrimitives.ReadSingleLittleEndian(mesh[36..]) == -1f &&
                    BinaryPrimitives.ReadSingleLittleEndian(mesh[48..]) == 0f,
                    "Derived profile operator translation was not applied once.");
            }
            Assert(foundDerived, "Derived extrusion mesh is missing.");
        }
        finally { DeleteTestDirectory(directory); }
    }

    private static void TestRatioAngleUnit()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"ifc-engine-v2-ratio-angle-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            var sourcePath = Path.Combine(directory, "ratio-angle.ifc");
            File.WriteAllText(sourcePath, """
                ISO-10303-21;
                HEADER;
                FILE_SCHEMA(('IFC2X3'));
                ENDSEC;
                DATA;
                #1=IFCCARTESIANPOINT((0.,0.,0.));
                #2=IFCDIRECTION((0.,0.,1.));
                #3=IFCDIRECTION((1.,0.,0.));
                #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
                #5=IFCRECTANGLEPROFILEDEF(.AREA.,'Rect',$,2.,4.);
                #6=IFCEXTRUDEDAREASOLID(#5,#4,#2,3.);
                #7=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
                #8=IFCSHAPEREPRESENTATION(#7,'Body','SweptSolid',(#6));
                #9=IFCPRODUCTDEFINITIONSHAPE($,$,(#8));
                #10=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);
                #11=IFCMEASUREWITHUNIT(IFCRATIOMEASURE(1.745E-2),#10);
                #12=IFCDIMENSIONALEXPONENTS(0,0,0,0,0,0,0);
                #13=IFCCONVERSIONBASEDUNIT(#12,.PLANEANGLEUNIT.,'DEGREE',#11);
                #14=IFCUNITASSIGNMENT((#13));
                ENDSEC;
                END-ISO-10303-21;
                """, new UTF8Encoding(false));
            var probe = LargeStepProbe.Run(sourcePath, Path.Combine(directory, "probe.json"),
                Path.Combine(directory, "probe.ifc2idx"), checkExtrusions: true);
            Assert(probe.ExtrusionValidation is { ReachableUniqueExtrusions: 1, Succeeded: 1, Failed: 0 },
                "IFC2X3 ratio-measure angle conversion rejected a valid extrusion.");
            Assert(Math.Abs(probe.ExtrusionValidation!.AngleScaleToRadians - 1.745E-2) < 1e-12,
                "IFC2X3 ratio-measure angle conversion has the wrong scale.");
            var mislabeledSource = Path.Combine(directory, "mislabeled-degree.ifc");
            File.WriteAllText(mislabeledSource,
                File.ReadAllText(sourcePath).Replace("IFCRATIOMEASURE(1.745E-2)",
                    "IFCPOSITIVELENGTHMEASURE(1.74532925239284E-2)", StringComparison.Ordinal),
                new UTF8Encoding(false));
            var mislabeledProbe = LargeStepProbe.Run(mislabeledSource,
                Path.Combine(directory, "mislabeled-probe.json"),
                Path.Combine(directory, "mislabeled-probe.ifc2idx"), checkExtrusions: true);
            Assert(mislabeledProbe.ExtrusionValidation is { Succeeded: 1, Failed: 0 },
                "A mislabeled but numerically valid degree factor was rejected.");
        }
        finally { DeleteTestDirectory(directory); }
    }

    private static void TestDisjointBoundRecovery()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"ifc-engine-v2-disconnected-hole-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            var sourcePath = Path.Combine(directory, "disconnected-hole.ifc");
            var chunkPath = Path.Combine(directory, "chunks");
            var source = """
                ISO-10303-21;
                HEADER;
                FILE_SCHEMA(('IFC4'));
                ENDSEC;
                DATA;
                #1=IFCCARTESIANPOINT((0.,0.,0.));
                #2=IFCCARTESIANPOINT((4.,0.,0.));
                #3=IFCCARTESIANPOINT((4.,4.,0.));
                #4=IFCCARTESIANPOINT((0.,4.,0.));
                #5=IFCCARTESIANPOINT((10.,10.,0.));
                #6=IFCCARTESIANPOINT((11.,10.,0.));
                #7=IFCCARTESIANPOINT((10.,11.,0.));
                #8=IFCPOLYLOOP((#1,#2,#3,#4));
                #9=IFCPOLYLOOP((#5,#6,#7));
                #10=IFCFACEOUTERBOUND(#8,.T.);
                #11=IFCFACEBOUND(#9,.T.);
                #12=IFCFACE((#10,#11));
                #13=IFCCLOSEDSHELL((#12));
                #14=IFCFACETEDBREP(#13);
                #15=IFCAXIS2PLACEMENT3D(#1,$,$);
                #16=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#15,$);
                #17=IFCSHAPEREPRESENTATION(#16,'Body','Brep',(#14));
                #18=IFCPRODUCTDEFINITIONSHAPE($,$,(#17));
                #19=IFCLOCALPLACEMENT($,#15);
                #20=IFCWALL('disconnected-hole',$,'Wall',$,$,#19,#18,$);
                #21=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
                #22=IFCUNITASSIGNMENT((#21));
                ENDSEC;
                END-ISO-10303-21;
                """;
            File.WriteAllText(sourcePath, source, new UTF8Encoding(false));
            var result = StepScanner.Scan(new ScanOptions(sourcePath, Path.Combine(directory, "manifest.json"),
                Path.Combine(directory, "index.ifc2idx"), chunkPath));
            var tessellation = result.Manifest.Tessellation ?? throw new InvalidOperationException("Missing tessellation.");
            Assert(tessellation.ViewerReady && tessellation.Triangles == 3,
                "A disjoint bound did not produce the outer surface and separate island.");
            Assert(tessellation.NonSimpleFaces == 1 && tessellation.ContainmentRejectedFaces == 0,
                "Disjoint-bound recovery was not recorded without a containment rejection.");
            Assert(tessellation.RecoveredDisjointFaces == 1 &&
                tessellation.NonSimpleFaceDetails.Single().RecoveredIslands == 1,
                "Disjoint-bound recovery lost its manifest diagnostics.");

            var crossingSource = source.Replace("(10.,10.,0.)", "(3.,3.,0.)", StringComparison.Ordinal)
                .Replace("(11.,10.,0.)", "(5.,3.,0.)", StringComparison.Ordinal)
                .Replace("(10.,11.,0.)", "(3.,5.,0.)", StringComparison.Ordinal);
            File.WriteAllText(sourcePath, crossingSource, new UTF8Encoding(false));
            var crossingChunks = Path.Combine(directory, "crossing-chunks");
            try
            {
                StepScanner.Scan(new ScanOptions(sourcePath, Path.Combine(directory, "crossing-manifest.json"),
                    Path.Combine(directory, "crossing-index.ifc2idx"), crossingChunks));
                throw new InvalidOperationException("An intersecting face bound produced an artifact.");
            }
            catch (InvalidDataException exception)
            {
                Assert(exception.Message.Contains("cannot be triangulated", StringComparison.Ordinal),
                    "Intersecting-bound rejection lost its precise reason.");
            }
            Assert(!Directory.Exists(crossingChunks), "Intersecting-bound artifact was promoted.");

            var nonPlanarSource = source.Replace("(10.,11.,0.)", "(10.,11.,1.)", StringComparison.Ordinal);
            File.WriteAllText(sourcePath, nonPlanarSource, new UTF8Encoding(false));
            var nonPlanarChunks = Path.Combine(directory, "nonplanar-chunks");
            try
            {
                StepScanner.Scan(new ScanOptions(sourcePath, Path.Combine(directory, "nonplanar-manifest.json"),
                    Path.Combine(directory, "nonplanar-index.ifc2idx"), nonPlanarChunks));
                throw new InvalidOperationException("A nonplanar island produced an artifact.");
            }
            catch (InvalidDataException exception)
            {
                Assert(exception.Message.Contains("cannot be triangulated", StringComparison.Ordinal),
                    "Nonplanar-island rejection lost its precise reason.");
            }
            Assert(!Directory.Exists(nonPlanarChunks), "Nonplanar-island artifact was promoted.");
        }
        finally { DeleteTestDirectory(directory); }
    }

    private static void TestArbitraryProfileArtifact()
    {
        WithArtifact("arbitrary-profile", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCDIRECTION((0.,0.,1.));
            #3=IFCDIRECTION((1.,0.,0.));
            #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
            #5=IFCLOCALPLACEMENT($,#4);
            #6=IFCCARTESIANPOINT((-3.,-3.));
            #7=IFCCARTESIANPOINT((3.,-3.));
            #8=IFCCARTESIANPOINT((3.,3.));
            #9=IFCCARTESIANPOINT((-3.,3.));
            #10=IFCCARTESIANPOINT((-1.,-1.));
            #11=IFCCARTESIANPOINT((-1.,1.));
            #12=IFCCARTESIANPOINT((1.,1.));
            #13=IFCCARTESIANPOINT((1.,-1.));
            #24=IFCCARTESIANPOINTLIST2D(((-3.,-3.),(3.,-3.),(3.,3.),(-3.,3.)));
            #25=IFCINDEXEDPOLYCURVE(#24,(IFCLINEINDEX((1,2,3,4,1))),.F.);
            #15=IFCPOLYLINE((#10,#11,#12,#13,#10));
            #16=IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,'Hollow square',#25,(#15));
            #17=IFCEXTRUDEDAREASOLID(#16,#4,#2,2.);
            #18=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
            #19=IFCSHAPEREPRESENTATION(#18,'Body','SweptSolid',(#17));
            #20=IFCPRODUCTDEFINITIONSHAPE($,$,(#19));
            #21=IFCWALL('arbitrary-guid',$,'Arbitrary wall',$,$,#5,#20,$);
            #22=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #23=IFCUNITASSIGNMENT((#22));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate", "Arbitrary profile selected fallback.");
            var tessellation = manifest.Tessellation ?? throw new InvalidOperationException("Arbitrary profile artifact is missing.");
            Assert(tessellation is { BaseDefinitions: 1, Products: 1, Instances: 1 }, "Arbitrary profile identity coverage is wrong.");
            Assert(tessellation.Triangles == 32 && tessellation.UniqueFaces == 10, "Arbitrary profile topology is wrong.");
            Assert(tessellation.CartesianPoints == 25, "Arbitrary profile point coverage is wrong.");
        });
    }

    private static void TestReversedTrimmedCircleArtifact()
    {
        WithArtifact("reversed-trimmed-circle", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC2X3'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCDIRECTION((0.,0.,1.));
            #3=IFCDIRECTION((1.,0.,0.));
            #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
            #5=IFCLOCALPLACEMENT($,#4);
            #6=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
            #66=IFCCARTESIANPOINT((7.,6.));
            #67=IFCCARTESIANPOINT((7.,-6.));
            #68=IFCPOLYLINE((#66,#67));
            #69=IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,#68);
            #70=IFCDIRECTION((1.,0.));
            #71=IFCCARTESIANPOINT((0.,-6.));
            #72=IFCAXIS2PLACEMENT2D(#71,#70);
            #73=IFCCIRCLE(#72,7.);
            #74=IFCTRIMMEDCURVE(#73,(IFCPARAMETERVALUE(0.)),(IFCPARAMETERVALUE(3.14159265358979)),.F.,.PARAMETER.);
            #75=IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,#74);
            #76=IFCCARTESIANPOINT((-7.,-6.));
            #77=IFCCARTESIANPOINT((-7.,6.));
            #78=IFCPOLYLINE((#76,#77));
            #79=IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,#78);
            #80=IFCDIRECTION((-1.,0.));
            #81=IFCCARTESIANPOINT((0.,6.));
            #82=IFCAXIS2PLACEMENT2D(#81,#80);
            #83=IFCCIRCLE(#82,7.);
            #84=IFCTRIMMEDCURVE(#83,(IFCPARAMETERVALUE(0.)),(IFCPARAMETERVALUE(3.14159265358979)),.F.,.PARAMETER.);
            #85=IFCCOMPOSITECURVESEGMENT(.DISCONTINUOUS.,.T.,#84);
            #86=IFCCOMPOSITECURVE((#69,#75,#79,#85),.F.);
            #87=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#86);
            #88=IFCEXTRUDEDAREASOLID(#87,#4,#2,1.8);
            #89=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#88));
            #90=IFCPRODUCTDEFINITIONSHAPE($,$,(#89));
            #91=IFCBEAM('reversed-trim-guid',$,'Curved beam',$,$,#5,#90,$);
            #92=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #93=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);
            #94=IFCUNITASSIGNMENT((#92,#93));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate" &&
                manifest.Tessellation is { ViewerReady: true, BaseDefinitions: 1, Products: 1 },
                "Opposite-sense circular trims did not form a closed profile.");
            Assert(manifest.Tessellation!.Triangles > 100,
                "Opposite-sense circular trims lost curved profile geometry.");
        });
    }

    private static void TestP62GeometryArtifact()
    {
        WithArtifact("p62-geometry", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4X3'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCDIRECTION((0.,0.,1.));
            #3=IFCDIRECTION((1.,0.,0.));
            #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
            #5=IFCLOCALPLACEMENT($,#4);
            #6=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
            #10=IFCCARTESIANPOINT((1.,0.));
            #11=IFCAXIS2PLACEMENT2D(#10,#3);
            #12=IFCCIRCLE(#11,1.);
            #13=IFCTRIMMEDCURVE(#12,(#25),(#15),.T.,.CARTESIAN.);
            #14=IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,#13);
            #15=IFCCARTESIANPOINT((1.,1.));
            #16=IFCCARTESIANPOINT((-1.,1.));
            #17=IFCPOLYLINE((#15,#16));
            #18=IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,#17);
            #19=IFCCARTESIANPOINT((-1.,0.));
            #20=IFCAXIS2PLACEMENT2D(#19,#3);
            #21=IFCCIRCLE(#20,1.);
            #22=IFCTRIMMEDCURVE(#21,(IFCPARAMETERVALUE(90.)),(IFCPARAMETERVALUE(270.)),.T.,.PARAMETER.);
            #23=IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,#22);
            #24=IFCCARTESIANPOINT((-1.,-1.));
            #25=IFCCARTESIANPOINT((1.,-1.));
            #26=IFCPOLYLINE((#24,#25));
            #27=IFCCOMPOSITECURVESEGMENT(.CONTINUOUS.,.T.,#26);
            #28=IFCCOMPOSITECURVE((#14,#18,#23,#27),.F.);
            #29=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'Stadium',#28);
            #30=IFCEXTRUDEDAREASOLID(#29,#4,#2,2.);
            #31=IFCAXIS2PLACEMENT2D(#1,#3);
            #32=IFCISHAPEPROFILEDEF(.AREA.,'Rounded I',#31,4.,6.,1.,1.,0.25,$,$);
            #33=IFCEXTRUDEDAREASOLID(#32,#4,#2,2.);
            #34=IFCRECTANGLEPROFILEDEF(.AREA.,'Clip box',#31,4.,4.);
            #35=IFCEXTRUDEDAREASOLID(#34,#4,#2,4.);
            #36=IFCCARTESIANPOINT((0.,0.,2.));
            #37=IFCAXIS2PLACEMENT3D(#36,#2,#3);
            #38=IFCPLANE(#37);
            #39=IFCHALFSPACESOLID(#38,.F.);
            #40=IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#35,#39);
            #41=IFCSHAPEREPRESENTATION(#6,'Body','Clipping',(#30,#33,#40));
            #42=IFCPRODUCTDEFINITIONSHAPE($,$,(#41));
            #43=IFCWALL('p62-guid',$,'P6.2 wall',$,$,#5,#42,$);
            #44=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #45=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);
            #46=IFCDIMENSIONALEXPONENTS(0,0,0,0,0,0,0);
            #47=IFCMEASUREWITHUNIT(IFCPLANEANGLEMEASURE(0.0174532925199433),#45);
            #48=IFCCONVERSIONBASEDUNIT(#46,.PLANEANGLEUNIT.,'DEGREE',#47);
            #49=IFCUNITASSIGNMENT((#44,#48));
            #50=IFCCARTESIANPOINT((8.,0.,0.));
            #51=IFCAXIS2PLACEMENT3D(#50,#2,#3);
            #52=IFCLOCALPLACEMENT($,#51);
            #53=IFCWALL('p62-shared-guid',$,'Shared shape wall',$,$,#52,#42,$);
            #54=IFCSHAPEREPRESENTATION(#6,'FootPrint','GeometricCurveSet',(#17));
            #55=IFCPRODUCTDEFINITIONSHAPE($,$,(#54));
            #56=IFCGRID('p62-grid-guid',$,'Auxiliary grid',$,$,#5,#55,(),(),$,$);
            #57=IFCMATERIAL('Unnamed');
            #58=IFCRELASSOCIATESMATERIAL('p62-material-guid',$,$,$,(#53),#57);
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, chunks) =>
        {
            Assert(manifest.EngineVersion == EngineContract.EngineVersion, "P6.2 worker version is wrong.");
            Assert(manifest.Coverage.Status == "fast-path-candidate", "P6.2 composite, fillet, or clipping geometry selected fallback.");
            Assert(manifest.Coverage.Graph.GeometryPlan.Status == "complete", "P6.2 geometry plan is incomplete.");
            var tessellation = manifest.Tessellation ?? throw new InvalidOperationException("P6.2 geometry artifact is missing.");
            Assert(tessellation is { ViewerReady: true, BaseDefinitions: 3, Products: 2, Instances: 6 }, "P6.2 shared-shape or auxiliary-only product coverage is wrong.");
            Assert(tessellation.Triangles > 100, "P6.2 curved and clipped geometry lost tessellation detail.");
            Assert(tessellation.Materials.Status == "complete" && tessellation.Semantic.RepresentedProducts == 2,
                "An unstyled material or auxiliary-only grid changed native admission.");
            using var products = File.OpenRead(Path.Combine(chunks, "products.ifcv2"));
            products.Position = 32;
            Span<byte> product = stackalloc byte[24];
            products.ReadExactly(product);
            Assert(BinaryPrimitives.ReadInt32LittleEndian(product) == 43 &&
                BinaryPrimitives.ReadInt32LittleEndian(product[4..]) == 42 &&
                BinaryPrimitives.ReadInt32LittleEndian(product[16..]) == 3,
                "First shared-shape product range is wrong.");
            products.ReadExactly(product);
            Assert(BinaryPrimitives.ReadInt32LittleEndian(product) == 53 &&
                BinaryPrimitives.ReadInt32LittleEndian(product[4..]) == 42 &&
                BinaryPrimitives.ReadInt64LittleEndian(product[8..]) == 3 &&
                BinaryPrimitives.ReadInt32LittleEndian(product[16..]) == 3,
                "Second shared-shape product range is wrong.");
        });
    }

    private static void TestNestedBooleanUsesFallback()
    {
        WithArtifact("nested-boolean-fallback", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCDIRECTION((0.,0.,1.));
            #3=IFCDIRECTION((1.,0.,0.));
            #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
            #5=IFCLOCALPLACEMENT($,#4);
            #6=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
            #7=IFCAXIS2PLACEMENT2D(#1,#3);
            #8=IFCRECTANGLEPROFILEDEF(.AREA.,'Box',#7,4.,4.);
            #9=IFCEXTRUDEDAREASOLID(#8,#4,#2,4.);
            #10=IFCCARTESIANPOINT((0.,0.,2.));
            #11=IFCAXIS2PLACEMENT3D(#10,#2,#3);
            #12=IFCPLANE(#11);
            #13=IFCHALFSPACESOLID(#12,.F.);
            #14=IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#9,#13);
            #15=IFCBOOLEANCLIPPINGRESULT(.DIFFERENCE.,#14,#13);
            #16=IFCSHAPEREPRESENTATION(#6,'Body','Clipping',(#15));
            #17=IFCPRODUCTDEFINITIONSHAPE($,$,(#16));
            #18=IFCWALL('nested-guid',$,'Nested',$,$,#5,#17,$);
            #19=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #20=IFCUNITASSIGNMENT((#19));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fallback-required", "Unverified nested CSG was admitted to the native fast path.");
            Assert(manifest.Tessellation is null, "Unverified nested CSG emitted a native artifact.");
            Assert(manifest.Coverage.Graph.GeometryPlan.Issues.Any(issue => issue.Contains("Nested boolean operand", StringComparison.Ordinal)),
                "Nested CSG fallback lost its precise reason.");
        });
    }

    private static void TestTriangulatedFaceSetArtifact()
    {
        WithArtifact("triangulated-face-set", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCDIRECTION((0.,0.,1.));
            #3=IFCDIRECTION((1.,0.,0.));
            #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
            #5=IFCLOCALPLACEMENT($,#4);
            #6=IFCCARTESIANPOINTLIST3D(((99.,99.,99.),(0.,0.,0.),(1.,0.,0.),(0.,1.,0.),(0.,0.,1.)));
            #7=IFCTRIANGULATEDFACESET(#6,$,.T.,((1,3,2),(1,2,4),(2,3,4),(1,4,3)),(2,3,4,5));
            #8=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
            #9=IFCSHAPEREPRESENTATION(#8,'Body','Tessellation',(#7));
            #10=IFCPRODUCTDEFINITIONSHAPE($,$,(#9));
            #11=IFCWALL('triangulated-guid',$,'Triangulated wall',$,$,#5,#10,$);
            #12=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #13=IFCUNITASSIGNMENT((#12));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate", "Triangulated face set selected fallback.");
            var tessellation = manifest.Tessellation ?? throw new InvalidOperationException("Triangulated face-set artifact is missing.");
            Assert(tessellation.Triangles == 4 && tessellation.UniqueFaces == 4, "Triangulated face-set topology is wrong.");
            Assert(tessellation.FastPathFaces == 4 && tessellation.EarcutFaces == 0, "Triangulated face-set path accounting is wrong.");
        });
    }

    private static void TestPolygonalFaceSetArtifact()
    {
        WithArtifact("polygonal-face-set", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCDIRECTION((0.,0.,1.));
            #3=IFCDIRECTION((1.,0.,0.));
            #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
            #5=IFCLOCALPLACEMENT($,#4);
            #6=IFCCARTESIANPOINTLIST3D(((0.,0.,0.),(6.,0.,0.),(6.,6.,0.),(0.,6.,0.),(2.,2.,0.),(2.,4.,0.),(4.,4.,0.),(4.,2.,0.)));
            #7=IFCINDEXEDPOLYGONALFACEWITHVOIDS((1,2,3,4),((5,6,7,8)));
            #8=IFCPOLYGONALFACESET(#6,.F.,(#7),$);
            #9=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
            #10=IFCSHAPEREPRESENTATION(#9,'Body','Tessellation',(#8));
            #11=IFCPRODUCTDEFINITIONSHAPE($,$,(#10));
            #12=IFCWALL('polygonal-guid',$,'Polygonal wall',$,$,#5,#11,$);
            #13=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #14=IFCUNITASSIGNMENT((#13));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate", "Polygonal face set selected fallback.");
            var tessellation = manifest.Tessellation ?? throw new InvalidOperationException("Polygonal face-set artifact is missing.");
            Assert(tessellation.Triangles == 8 && tessellation.UniqueFaces == 1, "Polygonal face-set topology is wrong.");
            Assert(tessellation.EarcutFaces == 1, "Polygonal face-set path accounting is wrong.");
        });
    }

    private static void TestRoundedPolygonalCoordinatesAndCogArtifact()
    {
        WithArtifact("rounded-polygonal-cog", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCDIRECTION((0.,0.,1.));
            #3=IFCDIRECTION((1.,0.,0.));
            #4=IFCAXIS2PLACEMENT3D(#1,#2,#3);
            #5=IFCLOCALPLACEMENT($,#4);
            #6=IFCCARTESIANPOINTLIST3D(((0.,0.,0.),(100.,0.,0.),(100.,100.,0.000007),(0.,100.,0.)));
            #7=IFCINDEXEDPOLYGONALFACE((1,2,3,4));
            #8=IFCPOLYGONALFACESET(#6,.F.,(#7),$);
            #9=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,$);
            #10=IFCSHAPEREPRESENTATION(#9,'Body','Tessellation',(#8));
            #11=IFCCARTESIANPOINT((50.,50.,0.));
            #12=IFCSHAPEREPRESENTATION(#9,'CoG','Point',(#11));
            #13=IFCPRODUCTDEFINITIONSHAPE($,$,(#10,#12));
            #14=IFCWALL('rounded-polygonal-guid',$,'Wall',$,$,#5,#13,$);
            #15=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #16=IFCUNITASSIGNMENT((#15));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate", "Rounded polygonal face with auxiliary CoG was rejected.");
            Assert(manifest.Tessellation?.Triangles == 2, "Rounded polygonal face has incorrect triangulation.");
        });
    }

    private static void TestFaceBasedSurfaceModelArtifact()
    {
        WithArtifact("face-based-surface", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCCARTESIANPOINT((2.,0.,0.));
            #3=IFCCARTESIANPOINT((0.,2.,0.));
            #4=IFCDIRECTION((0.,0.,1.));
            #5=IFCDIRECTION((1.,0.,0.));
            #6=IFCAXIS2PLACEMENT3D(#1,#4,#5);
            #7=IFCLOCALPLACEMENT($,#6);
            #8=IFCPOLYLOOP((#1,#2,#3));
            #9=IFCFACEOUTERBOUND(#8,.T.);
            #10=IFCFACE((#9));
            #11=IFCCONNECTEDFACESET((#10));
            #12=IFCFACEBASEDSURFACEMODEL((#11));
            #13=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#6,$);
            #14=IFCSHAPEREPRESENTATION(#13,'Body','SurfaceModel',(#12));
            #15=IFCPRODUCTDEFINITIONSHAPE($,$,(#14));
            #16=IFCWALL('surface-guid',$,'Surface wall',$,$,#7,#15,$);
            #17=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #18=IFCUNITASSIGNMENT((#17));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate", "Face-based surface model selected fallback.");
            var tessellation = manifest.Tessellation ?? throw new InvalidOperationException("Face-based surface artifact is missing.");
            Assert(tessellation.Triangles == 1 && tessellation.UniqueFaces == 1, "Face-based surface topology is wrong.");
        });
    }

    private static void TestRuledStripFaceArtifact()
    {
        WithArtifact("ruled-strip-face", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCCARTESIANPOINT((0.,1.,0.));
            #3=IFCCARTESIANPOINT((0.,2.,1.));
            #4=IFCCARTESIANPOINT((3.,2.,1.));
            #5=IFCCARTESIANPOINT((3.,1.,0.));
            #6=IFCCARTESIANPOINT((3.,0.,0.));
            #7=IFCDIRECTION((0.,0.,1.));
            #8=IFCDIRECTION((1.,0.,0.));
            #9=IFCAXIS2PLACEMENT3D(#1,#7,#8);
            #10=IFCLOCALPLACEMENT($,#9);
            #11=IFCPOLYLOOP((#1,#2,#3,#4,#5,#6));
            #12=IFCFACEOUTERBOUND(#11,.T.);
            #13=IFCFACE((#12));
            #14=IFCCONNECTEDFACESET((#13));
            #15=IFCFACEBASEDSURFACEMODEL((#14));
            #16=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#9,$);
            #17=IFCSHAPEREPRESENTATION(#16,'Body','SurfaceModel',(#15));
            #18=IFCPRODUCTDEFINITIONSHAPE($,$,(#17));
            #19=IFCWALL('ruled-strip-guid',$,'Folded surface',$,$,#10,#18,$);
            #20=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #21=IFCUNITASSIGNMENT((#20));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate", "Ruled strip face selected fallback.");
            Assert(manifest.Tessellation?.Triangles == 4, "Ruled strip should contain two planar quads.");
            Assert(manifest.Tessellation?.NonSimpleFaces == 1, "Ruled strip recovery is not reported.");
        });
    }

    private static void TestIdenticalOuterAndHoleArtifact()
    {
        WithArtifact("identical-outer-hole", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCCARTESIANPOINT((1.,0.,0.));
            #3=IFCCARTESIANPOINT((0.,1.,0.));
            #4=IFCCARTESIANPOINT((2.,0.,0.));
            #5=IFCCARTESIANPOINT((3.,0.,0.));
            #6=IFCCARTESIANPOINT((3.,1.,0.));
            #7=IFCCARTESIANPOINT((2.,1.,0.));
            #8=IFCDIRECTION((0.,0.,1.));
            #9=IFCDIRECTION((1.,0.,0.));
            #10=IFCAXIS2PLACEMENT3D(#1,#8,#9);
            #11=IFCLOCALPLACEMENT($,#10);
            #12=IFCPOLYLOOP((#1,#2,#3));
            #13=IFCFACEOUTERBOUND(#12,.T.);
            #14=IFCFACE((#13));
            #15=IFCPOLYLOOP((#4,#5,#6,#7));
            #16=IFCFACEOUTERBOUND(#15,.T.);
            #17=IFCFACEBOUND(#15,.F.);
            #18=IFCFACE((#16,#17));
            #19=IFCCONNECTEDFACESET((#14,#18));
            #20=IFCFACEBASEDSURFACEMODEL((#19));
            #21=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#10,$);
            #22=IFCSHAPEREPRESENTATION(#21,'Body','SurfaceModel',(#20));
            #23=IFCPRODUCTDEFINITIONSHAPE($,$,(#22));
            #24=IFCWALL('identical-hole-guid',$,'Wall',$,$,#11,#23,$);
            #25=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #26=IFCUNITASSIGNMENT((#25));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate", "Identical outer/hole selected fallback.");
            Assert(manifest.Tessellation?.Triangles == 1, "Zero-area bounded face emitted geometry.");
            Assert(manifest.Tessellation?.EmptyFaces == 1, "Zero-area bounded face was not counted.");
        });
    }

    private static void TestSpurAndNestedHoleArtifact()
    {
        WithArtifact("spur-nested-hole", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCCARTESIANPOINT((10.,0.,0.));
            #3=IFCCARTESIANPOINT((10.,10.,0.));
            #4=IFCCARTESIANPOINT((0.,10.,0.));
            #5=IFCCARTESIANPOINT((2.,2.,0.));
            #6=IFCCARTESIANPOINT((4.,2.,0.));
            #7=IFCCARTESIANPOINT((4.,4.,0.));
            #8=IFCCARTESIANPOINT((2.,4.,0.));
            #9=IFCCARTESIANPOINT((2.5,2.5,0.));
            #10=IFCCARTESIANPOINT((3.5,2.5,0.));
            #11=IFCCARTESIANPOINT((3.5,3.5,0.));
            #12=IFCCARTESIANPOINT((2.5,3.5,0.));
            #13=IFCCARTESIANPOINT((3.,1.,0.));
            #14=IFCDIRECTION((0.,0.,1.));
            #15=IFCDIRECTION((1.,0.,0.));
            #16=IFCAXIS2PLACEMENT3D(#1,#14,#15);
            #17=IFCLOCALPLACEMENT($,#16);
            #18=IFCPOLYLOOP((#1,#2,#3,#4));
            #19=IFCFACEOUTERBOUND(#18,.T.);
            #20=IFCPOLYLOOP((#5,#6,#13,#6,#7,#8));
            #21=IFCFACEBOUND(#20,.F.);
            #22=IFCPOLYLOOP((#9,#10,#11,#12));
            #23=IFCFACEBOUND(#22,.F.);
            #24=IFCFACE((#19,#21,#23));
            #25=IFCCONNECTEDFACESET((#24));
            #26=IFCFACEBASEDSURFACEMODEL((#25));
            #27=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#16,$);
            #28=IFCSHAPEREPRESENTATION(#27,'Body','SurfaceModel',(#26));
            #29=IFCPRODUCTDEFINITIONSHAPE($,$,(#28));
            #30=IFCWALL('spur-nested-guid',$,'Wall',$,$,#17,#29,$);
            #31=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #32=IFCUNITASSIGNMENT((#31));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate", "Spur/nested-hole recovery selected fallback.");
            Assert(manifest.Tessellation?.Triangles == 8, "Spur/nested-hole face has wrong triangle count.");
            Assert(manifest.Tessellation?.NonSimpleFaces == 0, "Valid repaired hole remains non-simple.");
        });
    }

    private static void TestCrossingCongruentHoleArtifact()
    {
        WithArtifact("crossing-congruent-hole", """
            ISO-10303-21;
            HEADER;
            FILE_SCHEMA(('IFC4'));
            ENDSEC;
            DATA;
            #1=IFCCARTESIANPOINT((0.,0.,0.));
            #2=IFCCARTESIANPOINT((10.,0.,0.));
            #3=IFCCARTESIANPOINT((10.,10.,0.));
            #4=IFCCARTESIANPOINT((0.,10.,0.));
            #5=IFCCARTESIANPOINT((0.,0.,-0.02));
            #6=IFCCARTESIANPOINT((10.,0.,-0.02));
            #7=IFCCARTESIANPOINT((10.,10.,0.02));
            #8=IFCCARTESIANPOINT((0.,10.,0.02));
            #9=IFCDIRECTION((0.,0.,1.));
            #10=IFCDIRECTION((1.,0.,0.));
            #11=IFCAXIS2PLACEMENT3D(#1,#9,#10);
            #12=IFCLOCALPLACEMENT($,#11);
            #13=IFCPOLYLOOP((#1,#2,#3,#4));
            #14=IFCFACEOUTERBOUND(#13,.T.);
            #15=IFCPOLYLOOP((#5,#6,#7,#8));
            #16=IFCFACEBOUND(#15,.F.);
            #17=IFCFACE((#14,#16));
            #18=IFCCONNECTEDFACESET((#17));
            #19=IFCFACEBASEDSURFACEMODEL((#18));
            #20=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#11,$);
            #21=IFCSHAPEREPRESENTATION(#20,'Body','SurfaceModel',(#19));
            #22=IFCPRODUCTDEFINITIONSHAPE($,$,(#21));
            #23=IFCWALL('crossing-hole-guid',$,'Wall',$,$,#12,#22,$);
            #24=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
            #25=IFCUNITASSIGNMENT((#24));
            ENDSEC;
            END-ISO-10303-21;
            """, (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fast-path-candidate", "Crossing congruent hole selected fallback.");
            Assert(manifest.Tessellation?.Triangles == 2, "Crossing congruent hole changed the outer face.");
            Assert(manifest.Tessellation?.NonSimpleFaces == 1, "Crossing-hole recovery was not reported.");
        });
    }

    private static void TestReachabilityAndPlacementGuards()
    {
        WithArtifact("missing-reachable-item", BasicBrepFixture("#15=IFCLOCALPLACEMENT($,#6);", 15, "(#999)"), (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fallback-required", "A missing reachable representation item was admitted.");
            Assert(manifest.Coverage.Reasons.Any(reason => reason.Contains("missing item #999", StringComparison.OrdinalIgnoreCase)),
                "The missing reachable reference did not produce a precise reason.");
        });

        WithArtifact("placement-cycle", BasicBrepFixture("#15=IFCLOCALPLACEMENT(#15,#6);", 15, "(#11)"), (manifest, _) =>
        {
            Assert(manifest.Coverage.Status == "fallback-required", "A product placement cycle was admitted.");
            Assert(manifest.Coverage.Reasons.Any(reason => reason.Contains("placement cycle", StringComparison.OrdinalIgnoreCase)),
                "The product placement cycle did not produce a precise reason.");
        });

        var placements = new StringBuilder();
        const int firstPlacement = 100;
        const int placementCount = 130;
        for (var index = 0; index < placementCount; index++)
        {
            var id = firstPlacement + index;
            var parent = index == 0 ? "$" : $"#{id - 1}";
            placements.AppendLine($"#{id}=IFCLOCALPLACEMENT({parent},#6);");
        }
        WithArtifact(
            "placement-depth",
            BasicBrepFixture(placements.ToString(), firstPlacement + placementCount - 1, "(#11)"),
            (manifest, _) =>
            {
                Assert(manifest.Coverage.Status == "fallback-required", "Excessive product placement nesting was admitted.");
                Assert(manifest.Coverage.Reasons.Any(reason => reason.Contains("safety limit", StringComparison.OrdinalIgnoreCase)),
                    "Excessive product placement nesting did not produce a precise reason.");
            });
    }

    private static string BasicBrepFixture(string placementRecords, int productPlacementId, string representationItems) => $"""
        ISO-10303-21;
        HEADER;
        FILE_SCHEMA(('IFC4'));
        ENDSEC;
        DATA;
        #1=IFCCARTESIANPOINT((0.,0.,0.));
        #2=IFCCARTESIANPOINT((1.,0.,0.));
        #3=IFCCARTESIANPOINT((0.,1.,0.));
        #4=IFCDIRECTION((0.,0.,1.));
        #5=IFCDIRECTION((1.,0.,0.));
        #6=IFCAXIS2PLACEMENT3D(#1,#4,#5);
        #7=IFCPOLYLOOP((#1,#2,#3));
        #8=IFCFACEOUTERBOUND(#7,.T.);
        #9=IFCFACE((#8));
        #10=IFCCLOSEDSHELL((#9));
        #11=IFCFACETEDBREP(#10);
        #12=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#6,$);
        #13=IFCSHAPEREPRESENTATION(#12,'Body','Brep',{representationItems});
        #14=IFCPRODUCTDEFINITIONSHAPE($,$,(#13));
        {placementRecords}
        #16=IFCWALL('guard-guid',$,'Guard wall',$,$,#{productPlacementId},#14,$);
        #17=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
        #18=IFCUNITASSIGNMENT((#17));
        ENDSEC;
        END-ISO-10303-21;
        """;

    private static void WithArtifact(string name, string source, Action<ScanManifest, string> verify)
    {
        var directory = Path.Combine(Path.GetTempPath(), $"ifc-engine-v2-{name}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            var sourcePath = Path.Combine(directory, $"{name}.ifc");
            var chunks = Path.Combine(directory, "chunks");
            File.WriteAllText(sourcePath, source, new UTF8Encoding(false));
            var result = StepScanner.Scan(new ScanOptions(
                sourcePath,
                Path.Combine(directory, "manifest.json"),
                Path.Combine(directory, "index.ifc2idx"),
                chunks));
            verify(result.Manifest, chunks);
        }
        finally
        {
            DeleteTestDirectory(directory);
        }
    }

    private static void DeleteTestDirectory(string directory)
    {
        var fullPath = Path.GetFullPath(directory);
        var temporaryRoot = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        if (!string.Equals(Path.GetDirectoryName(fullPath), temporaryRoot, StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(fullPath).StartsWith("ifc-engine-v2-", StringComparison.Ordinal))
            throw new InvalidOperationException($"Refusing to delete a non-test directory: {fullPath}");
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                Directory.Delete(fullPath, true);
                return;
            }
            catch (IOException) when (attempt < 5)
            {
                Thread.Sleep(20 << attempt);
            }
            catch (UnauthorizedAccessException) when (attempt < 5)
            {
                Thread.Sleep(20 << attempt);
            }
        }
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
