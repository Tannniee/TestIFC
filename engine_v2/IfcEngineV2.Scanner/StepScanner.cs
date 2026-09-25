using System.Buffers.Binary;
using System.Diagnostics;
using System.IO.MemoryMappedFiles;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace IfcEngineV2.Scanner;

internal static class StepScanner
{
    private const int IndexHeaderBytes = 4096;
    private const int IndexEntryBytes = 16;
    private const int IndexFooterBytes = 48;
    private const int HashChunkBytes = 16 * 1024 * 1024;
    private static readonly byte[] IndexMagic = "IFC2IDX2"u8.ToArray();

    public static unsafe ScanResult Scan(ScanOptions options)
    {
        var sourcePath = Path.GetFullPath(options.SourcePath);
        var manifestPath = Path.GetFullPath(options.ManifestPath);
        var indexPath = options.IndexPath is null ? null : Path.GetFullPath(options.IndexPath);
        var chunkOutputDirectory = options.ChunkOutputDirectory is null ? null : Path.GetFullPath(options.ChunkOutputDirectory);
        if (chunkOutputDirectory is not null && indexPath is null)
        {
            throw new ArgumentException("Tessellation chunks require --index.");
        }
        var sourceInfo = new FileInfo(sourcePath);
        if (!sourceInfo.Exists)
        {
            throw new FileNotFoundException("The IFC source file does not exist.", sourcePath);
        }
        using var sourceLock = new FileStream(
            sourcePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            4096,
            FileOptions.RandomAccess);
        var sourceLength = sourceLock.Length;
        if (sourceLength == 0)
        {
            throw new InvalidDataException("The IFC source file is empty.");
        }
        if (sourceLength > options.MaximumIfcBytes)
        {
            throw new IfcSizeLimitException(sourceLength, options.MaximumIfcBytes);
        }
        if (sourceLength > int.MaxValue)
        {
            throw new InvalidDataException("Engine V2 geometry conversion requires a source shorter than 2 GiB.");
        }

        var startedAt = DateTimeOffset.UtcNow;
        var registry = new TypeRegistry();
        var coverage = new CoverageCollector();
        var firstPass = Stopwatch.StartNew();
        FirstPassResult scan;

        using (var mapped = MemoryMappedFile.CreateFromFile(sourcePath, FileMode.Open, null, 0, MemoryMappedFileAccess.Read))
        using (var view = mapped.CreateViewAccessor(0, sourceLength, MemoryMappedFileAccess.Read))
        {
            byte* pointer = null;
            view.SafeMemoryMappedViewHandle.AcquirePointer(ref pointer);
            try
            {
                pointer += view.PointerOffset;
                var data = new ReadOnlySpan<byte>(pointer, checked((int)sourceLength));
                scan = RunFirstPass(data, registry, coverage);
            }
            finally
            {
                view.SafeMemoryMappedViewHandle.ReleasePointer();
            }
        }
        firstPass.Stop();
        var csgOverrides = options.CsgOverridePath is null
            ? null
            : CsgOverrideReader.Read(options.CsgOverridePath, scan.Sha256);

        var indexMilliseconds = 0d;
        var indexSize = 0L;
        var graphMilliseconds = 0d;
        var tessellationMilliseconds = 0d;
        TessellationArtifactManifest? tessellation = null;
        var occurrenceCounts = Array.Empty<int>();
        var representativeProductIds = Array.Empty<int>();
        var productDefinitionIdsByProduct = Array.Empty<int>();
        IReadOnlyDictionary<int, GeneratedMesh> generatedMeshes = new Dictionary<int, GeneratedMesh>();
        CoverageCensus coverageCensus;
        GraphCoverageLedger graph;
        if (indexPath is not null)
        {
            var indexTimer = Stopwatch.StartNew();
            indexSize = WriteIndexAtomic(sourceLength, indexPath, scan);
            indexTimer.Stop();
            indexMilliseconds = indexTimer.Elapsed.TotalMilliseconds;

            var graphTimer = Stopwatch.StartNew();
            graph = GraphCoverageAnalyzer.Analyze(
                sourcePath,
                indexPath,
                sourceLength,
                scan.Sha256,
                scan.MaximumExpressId,
                registry,
                out occurrenceCounts,
                out representativeProductIds,
                out productDefinitionIdsByProduct,
                out generatedMeshes,
                csgOverrides);
            graphTimer.Stop();
            graphMilliseconds = graphTimer.Elapsed.TotalMilliseconds;
            coverageCensus = coverage.Build(registry, graph);

            if (chunkOutputDirectory is not null && coverageCensus.Status == "fast-path-candidate" && graph.Status == "complete")
            {
                var tessellationTimer = Stopwatch.StartNew();
                tessellation = TessellationChunkWriter.Write(
                    sourcePath,
                    indexPath,
                    chunkOutputDirectory,
                    sourceLength,
                    scan.MaximumExpressId,
                    Convert.ToHexString(scan.Sha256),
                    registry,
                    occurrenceCounts,
                    representativeProductIds,
                    productDefinitionIdsByProduct,
                    graph,
                    generatedMeshes);
                tessellationTimer.Stop();
                tessellationMilliseconds = tessellationTimer.Elapsed.TotalMilliseconds;
            }
        }
        else
        {
            var productDefinitions = registry.TryGetId("IFCPRODUCTDEFINITIONSHAPE", out var productDefinitionTypeId)
                ? registry[productDefinitionTypeId].Count
                : 0;
            if (registry.TryGetId("IFCPRODUCTREPRESENTATION", out var productRepresentationTypeId))
                productDefinitions += registry[productRepresentationTypeId].Count;
            graph = GraphCoverageAnalyzer.NotRun(productDefinitions);
            coverageCensus = coverage.Build(registry, graph);
        }

        var completedAt = DateTimeOffset.UtcNow;
        var entityTypes = registry.Entries
            .OrderBy(entry => entry.Name, StringComparer.Ordinal)
            .ToDictionary(entry => entry.Name, entry => entry.Count, StringComparer.Ordinal);
        var typeIds = registry.Entries
            .OrderBy(entry => entry.Name, StringComparer.Ordinal)
            .ToDictionary(entry => entry.Name, entry => entry.Id, StringComparer.Ordinal);
        var manifest = new ScanManifest(
            EngineContract.ManifestFormat,
            EngineContract.ManifestVersion,
            EngineContract.EngineVersion,
            true,
            new SourceManifest(sourcePath, sourceLength, Convert.ToHexString(scan.Sha256), scan.Schema),
            new ScanMetrics(
                startedAt,
                completedAt,
                firstPass.Elapsed.TotalMilliseconds,
                indexMilliseconds,
                graphMilliseconds,
                tessellationMilliseconds,
                scan.EntityCount,
                scan.MaximumExpressId,
                scan.MaximumExpressId < 0 ? 0 : (double)scan.EntityCount / (scan.MaximumExpressId + 1),
                scan.PhysicalLineCount,
                scan.MaximumPhysicalLineBytes,
                scan.MaximumRecordBytes),
            new IndexManifest(indexPath, "ifc-engine-v2-dense-index", 2, IndexEntryBytes, indexSize, indexPath is not null),
            entityTypes,
            typeIds,
            coverageCensus,
            tessellation);

        WriteManifestAtomic(manifestPath, manifest);
        return new ScanResult(manifest);
    }

    private static FirstPassResult RunFirstPass(ReadOnlySpan<byte> data, TypeRegistry registry, CoverageCollector coverage)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long entityCount = 0;
        long maximumExpressId = -1;
        long maximumRecordBytes = 0;
        long physicalLineCount = 0;
        long maximumPhysicalLineBytes = 0;
        var physicalLineStart = 0;
        var inString = false;
        var inComment = false;
        var inRecord = false;
        var recordStart = -1;
        var recordExpressId = -1;
        ushort recordTypeId = 0;
        var indexRecords = new List<IndexRecord>();

        var nextHashStart = 0;
        for (var cursor = 0; cursor < data.Length; cursor++)
        {
            while (cursor >= nextHashStart && nextHashStart < data.Length)
            {
                var hashLength = Math.Min(HashChunkBytes, data.Length - nextHashStart);
                hash.AppendData(data.Slice(nextHashStart, hashLength));
                nextHashStart += hashLength;
            }
            var current = data[cursor];
            var next = cursor + 1 < data.Length ? data[cursor + 1] : (byte)0;

            if (current == (byte)'\n')
            {
                physicalLineCount++;
                var lineBytes = cursor - physicalLineStart;
                if (lineBytes > 0 && data[cursor - 1] == (byte)'\r') lineBytes--;
                maximumPhysicalLineBytes = Math.Max(maximumPhysicalLineBytes, lineBytes);
                physicalLineStart = cursor + 1;
            }

            if (inComment)
            {
                if (current == (byte)'*' && next == (byte)'/')
                {
                    inComment = false;
                    cursor++;
                }
                continue;
            }
            if (inString)
            {
                if (current == (byte)'\'' && next == (byte)'\'') cursor++;
                else if (current == (byte)'\'') inString = false;
                continue;
            }
            if (current == (byte)'/' && next == (byte)'*')
            {
                inComment = true;
                cursor++;
                continue;
            }
            if (current == (byte)'\'')
            {
                inString = true;
                continue;
            }

            if (!inRecord && current == (byte)'#' && StepParsing.TryReadRecordHeader(data, cursor, out var header))
            {
                if (header.ExpressId > int.MaxValue)
                {
                    throw new InvalidDataException($"Express ID {header.ExpressId} exceeds the Engine V2 index range.");
                }
                inRecord = true;
                recordStart = cursor;
                recordExpressId = checked((int)header.ExpressId);
                recordTypeId = registry.Resolve(data.Slice(header.TypeStart, header.TypeLength));
                maximumExpressId = Math.Max(maximumExpressId, header.ExpressId);
                continue;
            }

            if (inRecord && current == (byte)';')
            {
                var recordLength = cursor - recordStart + 1;
                entityCount++;
                maximumRecordBytes = Math.Max(maximumRecordBytes, recordLength);
                var entry = registry[recordTypeId];
                entry.Count++;
                coverage.Observe(entry.Kind, data.Slice(recordStart, recordLength));
                indexRecords.Add(new IndexRecord(recordExpressId, recordStart, recordLength, recordTypeId));
                inRecord = false;
                recordStart = -1;
                recordExpressId = -1;
            }
        }

        if (physicalLineStart < data.Length)
        {
            physicalLineCount++;
            maximumPhysicalLineBytes = Math.Max(maximumPhysicalLineBytes, data.Length - physicalLineStart);
        }
        if (inRecord)
        {
            throw new InvalidDataException($"Unterminated STEP entity record starting at byte {recordStart:N0}.");
        }
        if (entityCount == 0)
        {
            throw new InvalidDataException("No STEP entity records were found.");
        }

        return new FirstPassResult(
            hash.GetHashAndReset(),
            StepParsing.DetectSchema(data),
            entityCount,
            maximumExpressId,
            physicalLineCount,
            maximumPhysicalLineBytes,
            maximumRecordBytes,
            indexRecords.ToArray());
    }

    private static unsafe long WriteIndexAtomic(
        long sourceLength,
        string indexPath,
        FirstPassResult scan)
    {
        var directory = Path.GetDirectoryName(indexPath) ?? Directory.GetCurrentDirectory();
        Directory.CreateDirectory(directory);
        var temporaryPath = Path.Combine(directory, $".{Path.GetFileName(indexPath)}.{Guid.NewGuid():N}.partial");
        var entriesLength = checked((scan.MaximumExpressId + 1) * IndexEntryBytes);
        var indexLength = checked(IndexHeaderBytes + entriesLength + IndexFooterBytes);

        try
        {
            using (var stream = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
            {
                stream.SetLength(indexLength);
            }
            {
                using var indexMap = MemoryMappedFile.CreateFromFile(temporaryPath, FileMode.Open, null, indexLength, MemoryMappedFileAccess.ReadWrite);
                using var indexView = indexMap.CreateViewAccessor(0, indexLength, MemoryMappedFileAccess.ReadWrite);
                byte* indexPointer = null;
                indexView.SafeMemoryMappedViewHandle.AcquirePointer(ref indexPointer);
                try
                {
                    indexPointer += indexView.PointerOffset;
                    var header = new Span<byte>(indexPointer, IndexHeaderBytes);
                    WriteIndexHeader(header, sourceLength, scan);
                    var entries = new Span<byte>(indexPointer + IndexHeaderBytes, checked((int)entriesLength));
                    PopulateIndex(entries, scan.IndexRecords, scan.EntityCount);
                    var footer = new Span<byte>(indexPointer + IndexHeaderBytes + entriesLength, IndexFooterBytes);
                    "IFC2END2"u8.CopyTo(footer);
                    BinaryPrimitives.WriteInt64LittleEndian(footer[8..], scan.EntityCount);
                    SHA256.HashData(entries, footer[16..]);
                    indexView.Flush();
                }
                finally
                {
                    indexView.SafeMemoryMappedViewHandle.ReleasePointer();
                }
            }
            // Windows indexers can briefly retain a handle after the memory map closes.
            // Retry only the atomic promotion; never expose a partially written index.
            for (var attempt = 0; ; attempt++)
            {
                try
                {
                    File.Move(temporaryPath, indexPath, true);
                    break;
                }
                catch (IOException) when (attempt < 5)
                {
                    Thread.Sleep(20 << attempt);
                }
            }
            return indexLength;
        }
        catch
        {
            TryDelete(temporaryPath);
            throw;
        }
    }

    private static void WriteIndexHeader(Span<byte> header, long sourceLength, FirstPassResult scan)
    {
        header.Clear();
        IndexMagic.CopyTo(header);
        BinaryPrimitives.WriteInt32LittleEndian(header[8..], 2);
        BinaryPrimitives.WriteInt32LittleEndian(header[12..], IndexEntryBytes);
        BinaryPrimitives.WriteInt64LittleEndian(header[16..], sourceLength);
        BinaryPrimitives.WriteInt64LittleEndian(header[24..], scan.MaximumExpressId);
        BinaryPrimitives.WriteInt64LittleEndian(header[32..], scan.EntityCount);
        scan.Sha256.CopyTo(header[40..72]);
        BinaryPrimitives.WriteInt64LittleEndian(header[72..], DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private static void PopulateIndex(Span<byte> entries, IReadOnlyList<IndexRecord> records, long expectedCount)
    {
        foreach (var record in records)
        {
            var entry = entries.Slice(checked(record.ExpressId * IndexEntryBytes), IndexEntryBytes);
            if (BinaryPrimitives.ReadInt32LittleEndian(entry[8..]) != 0)
            {
                throw new InvalidDataException($"Duplicate Express ID #{record.ExpressId}.");
            }
            BinaryPrimitives.WriteInt64LittleEndian(entry, record.Offset);
            BinaryPrimitives.WriteInt32LittleEndian(entry[8..], record.Length);
            BinaryPrimitives.WriteUInt16LittleEndian(entry[12..], record.TypeId);
            BinaryPrimitives.WriteUInt16LittleEndian(entry[14..], 1);
        }

        if (records.Count != expectedCount)
        {
            throw new InvalidDataException($"Index coverage mismatch: expected {expectedCount:N0}, wrote {records.Count:N0} records.");
        }
    }

    private static void WriteManifestAtomic(string manifestPath, ScanManifest manifest)
    {
        var directory = Path.GetDirectoryName(manifestPath) ?? Directory.GetCurrentDirectory();
        Directory.CreateDirectory(directory);
        var temporaryPath = Path.Combine(directory, $".{Path.GetFileName(manifestPath)}.{Guid.NewGuid():N}.partial");
        var json = JsonSerializer.Serialize(manifest, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
        });
        try
        {
            File.WriteAllText(temporaryPath, json + Environment.NewLine, new UTF8Encoding(false));
            File.Move(temporaryPath, manifestPath, true);
        }
        catch
        {
            TryDelete(temporaryPath);
            throw;
        }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { }
    }

    private sealed record FirstPassResult(
        byte[] Sha256,
        string Schema,
        long EntityCount,
        long MaximumExpressId,
        long PhysicalLineCount,
        long MaximumPhysicalLineBytes,
        long MaximumRecordBytes,
        IReadOnlyList<IndexRecord> IndexRecords);

    private readonly record struct IndexRecord(int ExpressId, int Offset, int Length, ushort TypeId);
}

internal sealed class IfcSizeLimitException(long actualBytes, long maximumBytes)
    : Exception($"IFC size {actualBytes:N0} bytes exceeds the supported limit ({maximumBytes:N0} bytes).")
{
    public long ActualBytes { get; } = actualBytes;
    public long MaximumBytes { get; } = maximumBytes;
}
