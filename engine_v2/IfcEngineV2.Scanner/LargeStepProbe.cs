using System.Buffers.Binary;
using System.Diagnostics;
using System.IO.MemoryMappedFiles;
using System.Security.Cryptography;
using System.Text.Json;

namespace IfcEngineV2.Scanner;

/// <summary>
/// Bounded-memory source/index probe. It deliberately makes no geometry-coverage
/// claim; the renderer path still requires the normal complete artifact ledger.
/// </summary>
internal static class LargeStepProbe
{
    internal const long MaximumSourceBytes = 2L * 1024 * 1024 * 1024;
    private const long MaximumDenseIndexBytes = 1024L * 1024 * 1024;
    private const int HashChunkBytes = 16 * 1024 * 1024;
    private const int HeaderLookaheadBytes = 4096;
    private const int IndexHeaderBytes = 4096;
    private const int IndexEntryBytes = 16;
    private const int IndexFooterBytes = 48;

    internal static void CheckSize(long size)
    {
        if (size == 0) throw new InvalidDataException("The IFC source file is empty.");
        if (size > MaximumSourceBytes)
            throw new InvalidDataException($"IFC size {size:N0} bytes exceeds the 2 GiB probe limit.");
    }

    public static unsafe LargeProbeResult Run(string sourcePath, string outputPath, string? indexPath = null,
        bool checkExtrusions = false, bool checkGraph = false, string? chunkOutputDirectory = null)
    {
        sourcePath = Path.GetFullPath(sourcePath);
        outputPath = Path.GetFullPath(outputPath);
        indexPath = indexPath is null ? null : Path.GetFullPath(indexPath);
        chunkOutputDirectory = chunkOutputDirectory is null ? null : Path.GetFullPath(chunkOutputDirectory);
        if (outputPath.Equals(sourcePath, StringComparison.OrdinalIgnoreCase) ||
            (indexPath is not null && outputPath.Equals(indexPath, StringComparison.OrdinalIgnoreCase)))
            throw new ArgumentException("Probe output cannot overwrite its IFC source or index.");
        if (indexPath is not null && indexPath.Equals(sourcePath, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("The index cannot overwrite its IFC source.");
        if ((checkExtrusions || checkGraph) && indexPath is null)
            throw new ArgumentException("Geometry validation requires --index.");
        if (chunkOutputDirectory is not null && (!checkGraph || indexPath is null))
            throw new ArgumentException("Artifact creation requires --check-graph and --index.");
        using var sourceLock = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.RandomAccess);
        var sourceLength = sourceLock.Length;
        CheckSize(sourceLength);
        var registry = new TypeRegistry();
        var stopwatch = Stopwatch.StartNew();
        ScanPass first;
        long indexLength = 0;
        double indexMilliseconds = 0;
        ReachabilityResult? reachability = null;
        double reachabilityMilliseconds = 0;
        ExtrusionProbeResult? extrusionValidation = null;
        double extrusionMilliseconds = 0;
        GraphCoverageLedger? graphValidation = null;
        double graphMilliseconds = 0;
        TessellationArtifactManifest? tessellation = null;
        double tessellationMilliseconds = 0;
        using (var mapped = MemoryMappedFile.CreateFromFile(sourcePath, FileMode.Open, null, 0, MemoryMappedFileAccess.Read))
        using (var view = mapped.CreateViewAccessor(0, sourceLength, MemoryMappedFileAccess.Read))
        {
            byte* pointer = null;
            view.SafeMemoryMappedViewHandle.AcquirePointer(ref pointer);
            try
            {
                pointer += view.PointerOffset;
                first = Scan(pointer, sourceLength, registry, null);
                stopwatch.Stop();
                if (indexPath is not null)
                {
                    var indexTimer = Stopwatch.StartNew();
                    indexLength = WriteIndex(indexPath, pointer, sourceLength, first, registry);
                    indexTimer.Stop();
                    indexMilliseconds = indexTimer.Elapsed.TotalMilliseconds;
                    var reachabilityTimer = Stopwatch.StartNew();
                    reachability = ReachabilityProbe.Run(pointer, sourceLength, indexPath,
                        first.Sha256, first.MaximumExpressId, registry, out var extrusionIds);
                    reachabilityTimer.Stop();
                    reachabilityMilliseconds = reachabilityTimer.Elapsed.TotalMilliseconds;
                    if (checkExtrusions)
                    {
                        var extrusionTimer = Stopwatch.StartNew();
                        extrusionValidation = ExtrusionProbe.Run(pointer, sourceLength, indexPath,
                            first.Sha256, first.MaximumExpressId, registry, extrusionIds);
                        extrusionTimer.Stop();
                        extrusionMilliseconds = extrusionTimer.Elapsed.TotalMilliseconds;
                    }
                    if (checkGraph)
                    {
                        if (sourceLength > int.MaxValue)
                            throw new InvalidDataException("Graph validation still requires a 32-bit source span; use the 64-bit inventory probe at 2 GiB.");
                        var graphTimer = Stopwatch.StartNew();
                        graphValidation = GraphCoverageAnalyzer.Analyze(sourcePath, indexPath,
                            sourceLength, first.Sha256, first.MaximumExpressId, registry,
                            out var occurrenceCounts, out var representativeProductIds,
                            out var productDefinitionIdsByProduct, out var generatedMeshes);
                        graphTimer.Stop();
                        graphMilliseconds = graphTimer.Elapsed.TotalMilliseconds;
                        if (chunkOutputDirectory is not null && graphValidation.Status == "complete" &&
                            graphValidation.GeometryPlan.Status == "complete")
                        {
                            var tessellationTimer = Stopwatch.StartNew();
                            tessellation = TessellationChunkWriter.Write(sourcePath, indexPath,
                                chunkOutputDirectory, sourceLength, first.MaximumExpressId,
                                Convert.ToHexString(first.Sha256), registry, occurrenceCounts,
                                representativeProductIds, productDefinitionIdsByProduct,
                                graphValidation, generatedMeshes);
                            tessellationTimer.Stop();
                            tessellationMilliseconds = tessellationTimer.Elapsed.TotalMilliseconds;
                        }
                    }
                }
            }
            finally
            {
                view.SafeMemoryMappedViewHandle.ReleasePointer();
            }
        }

        var types = registry.Entries.OrderBy(entry => entry.Name, StringComparer.Ordinal)
            .ToDictionary(entry => entry.Name, entry => entry.Count, StringComparer.Ordinal);
        var result = new LargeProbeResult(
            "ifc-engine-v2-large-probe", 1,
            tessellation is null ? "not-evaluated" : "native-artifact-produced-unverified",
            sourcePath, sourceLength, Convert.ToHexString(first.Sha256), first.Schema,
            first.EntityCount, first.MaximumExpressId, first.PhysicalLineCount,
            first.MaximumPhysicalLineBytes, first.MaximumRecordBytes,
            stopwatch.Elapsed.TotalMilliseconds, indexMilliseconds, indexPath, indexLength, types,
            reachabilityMilliseconds, reachability, extrusionMilliseconds, extrusionValidation,
            graphMilliseconds, graphValidation, tessellationMilliseconds, tessellation);
        WriteJsonAtomic(outputPath, result);
        return result;
    }

    private static unsafe ScanPass Scan(byte* source, long length, TypeRegistry registry, byte* indexEntries)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        for (long offset = 0; offset < length; offset += HashChunkBytes)
            hash.AppendData(new ReadOnlySpan<byte>(source + offset,
                checked((int)Math.Min(HashChunkBytes, length - offset))));
        var entityCount = 0L;
        var maximumExpressId = -1L;
        var physicalLineCount = 0L;
        var maximumPhysicalLineBytes = 0L;
        var maximumRecordBytes = 0L;
        var physicalLineStart = 0L;
        var recordStart = -1L;
        var recordExpressId = -1;
        ushort recordTypeId = 0;
        var inRecord = false;
        var inString = false;
        var inComment = false;

        for (long cursor = 0; cursor < length; cursor++)
        {
            var current = source[cursor];
            var next = cursor + 1 < length ? source[cursor + 1] : (byte)0;
            if (current == (byte)'\n')
            {
                physicalLineCount++;
                var lineBytes = cursor - physicalLineStart;
                if (lineBytes > 0 && source[cursor - 1] == (byte)'\r') lineBytes--;
                maximumPhysicalLineBytes = Math.Max(maximumPhysicalLineBytes, lineBytes);
                physicalLineStart = cursor + 1;
            }
            if (inComment)
            {
                if (current == (byte)'*' && next == (byte)'/') { inComment = false; cursor++; }
                continue;
            }
            if (inString)
            {
                if (current == (byte)'\'' && next == (byte)'\'') cursor++;
                else if (current == (byte)'\'') inString = false;
                continue;
            }
            if (current == (byte)'/' && next == (byte)'*') { inComment = true; cursor++; continue; }
            if (current == (byte)'\'') { inString = true; continue; }
            if (!inRecord && current == (byte)'#' && next is >= (byte)'0' and <= (byte)'9')
            {
                var lookahead = new ReadOnlySpan<byte>(source + cursor,
                    checked((int)Math.Min(HeaderLookaheadBytes, length - cursor)));
                if (!StepParsing.TryReadRecordHeader(lookahead, 0, out var header))
                    throw new InvalidDataException($"Malformed or oversized STEP record header at byte {cursor:N0}.");
                if (header.ExpressId > int.MaxValue)
                    throw new InvalidDataException($"Express ID {header.ExpressId} exceeds the current artifact identity range.");
                recordStart = cursor;
                recordExpressId = checked((int)header.ExpressId);
                recordTypeId = indexEntries == null
                    ? registry.Resolve(lookahead.Slice(header.TypeStart, header.TypeLength))
                    : registry.ResolveExisting(lookahead.Slice(header.TypeStart, header.TypeLength));
                maximumExpressId = Math.Max(maximumExpressId, header.ExpressId);
                inRecord = true;
                continue;
            }
            if (inRecord && current == (byte)';')
            {
                var recordLength = cursor - recordStart + 1;
                if (recordLength > int.MaxValue)
                    throw new InvalidDataException($"STEP record #{recordExpressId} exceeds the 32-bit record-length limit.");
                entityCount++;
                maximumRecordBytes = Math.Max(maximumRecordBytes, recordLength);
                if (indexEntries == null) registry[recordTypeId].Count++;
                else
                {
                    var entry = new Span<byte>(indexEntries + (long)recordExpressId * IndexEntryBytes, IndexEntryBytes);
                    if (BinaryPrimitives.ReadInt32LittleEndian(entry[8..]) != 0)
                        throw new InvalidDataException($"Duplicate Express ID #{recordExpressId}.");
                    BinaryPrimitives.WriteInt64LittleEndian(entry, recordStart);
                    BinaryPrimitives.WriteInt32LittleEndian(entry[8..], checked((int)recordLength));
                    BinaryPrimitives.WriteUInt16LittleEndian(entry[12..], recordTypeId);
                    BinaryPrimitives.WriteUInt16LittleEndian(entry[14..], 1);
                }
                inRecord = false;
                recordStart = -1;
                recordExpressId = -1;
            }
        }
        if (physicalLineStart < length)
        {
            physicalLineCount++;
            maximumPhysicalLineBytes = Math.Max(maximumPhysicalLineBytes, length - physicalLineStart);
        }
        if (inRecord) throw new InvalidDataException($"Unterminated STEP entity record starting at byte {recordStart:N0}.");
        if (entityCount == 0) throw new InvalidDataException("No STEP entity records were found.");
        return new ScanPass(hash.GetHashAndReset(),
            StepParsing.DetectSchema(new ReadOnlySpan<byte>(source, checked((int)Math.Min(length, 1024 * 1024)))),
            entityCount, maximumExpressId, physicalLineCount, maximumPhysicalLineBytes, maximumRecordBytes);
    }

    private static unsafe long WriteIndex(string indexPath, byte* source, long sourceLength, ScanPass first, TypeRegistry registry)
    {
        var entriesLength = checked((first.MaximumExpressId + 1) * IndexEntryBytes);
        if (entriesLength > MaximumDenseIndexBytes)
            throw new InvalidDataException($"Dense index needs {entriesLength:N0} bytes; a paged index is required.");
        var indexLength = checked(IndexHeaderBytes + entriesLength + IndexFooterBytes);
        Directory.CreateDirectory(Path.GetDirectoryName(indexPath)!);
        var temporaryPath = indexPath + "." + Guid.NewGuid().ToString("N") + ".partial";
        try
        {
            using (var file = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
                file.SetLength(indexLength);
            using (var mapped = MemoryMappedFile.CreateFromFile(temporaryPath, FileMode.Open, null, indexLength, MemoryMappedFileAccess.ReadWrite))
            using (var view = mapped.CreateViewAccessor(0, indexLength, MemoryMappedFileAccess.ReadWrite))
            {
                byte* pointer = null;
                view.SafeMemoryMappedViewHandle.AcquirePointer(ref pointer);
                try
                {
                    pointer += view.PointerOffset;
                    var header = new Span<byte>(pointer, IndexHeaderBytes);
                    header.Clear();
                    "IFC2IDX2"u8.CopyTo(header);
                    BinaryPrimitives.WriteInt32LittleEndian(header[8..], 2);
                    BinaryPrimitives.WriteInt32LittleEndian(header[12..], IndexEntryBytes);
                    BinaryPrimitives.WriteInt64LittleEndian(header[16..], sourceLength);
                    BinaryPrimitives.WriteInt64LittleEndian(header[24..], first.MaximumExpressId);
                    BinaryPrimitives.WriteInt64LittleEndian(header[32..], first.EntityCount);
                    first.Sha256.CopyTo(header[40..72]);
                    BinaryPrimitives.WriteInt64LittleEndian(header[72..], DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                    var entries = pointer + IndexHeaderBytes;
                    var second = Scan(source, sourceLength, registry, entries);
                    if (second.EntityCount != first.EntityCount || second.MaximumExpressId != first.MaximumExpressId ||
                        !second.Sha256.AsSpan().SequenceEqual(first.Sha256))
                        throw new InvalidDataException("Source changed between index passes.");
                    using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                    for (long offset = 0; offset < entriesLength; offset += HashChunkBytes)
                        hash.AppendData(new ReadOnlySpan<byte>(entries + offset,
                            checked((int)Math.Min(HashChunkBytes, entriesLength - offset))));
                    var footer = new Span<byte>(entries + entriesLength, IndexFooterBytes);
                    "IFC2END2"u8.CopyTo(footer);
                    BinaryPrimitives.WriteInt64LittleEndian(footer[8..], first.EntityCount);
                    hash.GetHashAndReset().CopyTo(footer[16..]);
                    view.Flush();
                }
                finally { view.SafeMemoryMappedViewHandle.ReleasePointer(); }
            }
            for (var attempt = 0; ; attempt++)
            {
                try { File.Move(temporaryPath, indexPath, true); break; }
                catch (IOException) when (attempt < 5) { Thread.Sleep(20 << attempt); }
            }
            return indexLength;
        }
        catch
        {
            try { File.Delete(temporaryPath); } catch (IOException) { }
            throw;
        }
    }

    private static void WriteJsonAtomic(string path, LargeProbeResult result)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporaryPath = path + "." + Guid.NewGuid().ToString("N") + ".partial";
        try
        {
            File.WriteAllText(temporaryPath, JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(temporaryPath, path, true);
        }
        catch
        {
            try { File.Delete(temporaryPath); } catch (IOException) { }
            throw;
        }
    }

    private sealed record ScanPass(byte[] Sha256, string Schema, long EntityCount, long MaximumExpressId,
        long PhysicalLineCount, long MaximumPhysicalLineBytes, long MaximumRecordBytes);
}

internal sealed record LargeProbeResult(string Format, int Version, string GeometryStatus,
    string SourcePath, long SourceBytes, string SourceSha256, string Schema,
    long EntityCount, long MaximumExpressId, long PhysicalLineCount,
    long MaximumPhysicalLineBytes, long MaximumRecordBytes,
    double ScanMilliseconds, double IndexMilliseconds, string? IndexPath,
    long IndexBytes, IReadOnlyDictionary<string, long> EntityTypes,
    double ReachabilityMilliseconds, ReachabilityResult? Reachability,
    double ExtrusionMilliseconds, ExtrusionProbeResult? ExtrusionValidation,
    double GraphMilliseconds, GraphCoverageLedger? GraphValidation,
    double TessellationMilliseconds, TessellationArtifactManifest? Tessellation);
