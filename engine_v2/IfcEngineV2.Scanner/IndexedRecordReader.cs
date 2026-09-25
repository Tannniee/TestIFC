using System.Buffers.Binary;

namespace IfcEngineV2.Scanner;

/// <summary>
/// Reads individual STEP records using 64-bit source offsets. The mapped range
/// may cover the entire file or a smaller view, but a record must fit inside it.
/// The caller owns the mapped source and validated index for this reader's lifetime.
/// </summary>
internal readonly unsafe struct IndexedRecordReader(
    byte* mappedSource, long mappedOffset, long mappedLength, long sourceLength,
    byte* entries, long maximumExpressId, int typeCount)
{
    private const int EntryBytes = 16;

    internal bool TryGetTypeId(long expressId, out ushort typeId)
    {
        typeId = 0;
        if (expressId < 0 || expressId > maximumExpressId) return false;
        var entry = new ReadOnlySpan<byte>(entries + expressId * EntryBytes, EntryBytes);
        if (BinaryPrimitives.ReadUInt16LittleEndian(entry[14..]) != 1) return false;
        var candidate = BinaryPrimitives.ReadUInt16LittleEndian(entry[12..]);
        if (candidate >= typeCount) return false;
        typeId = candidate;
        return true;
    }

    internal bool TryRead(long expressId, out ReadOnlySpan<byte> record, out ushort typeId)
    {
        record = default;
        typeId = 0;
        if (expressId < 0 || expressId > maximumExpressId) return false;

        var entry = new ReadOnlySpan<byte>(entries + expressId * EntryBytes, EntryBytes);
        if (BinaryPrimitives.ReadUInt16LittleEndian(entry[14..]) != 1) return false;
        var offset = BinaryPrimitives.ReadInt64LittleEndian(entry);
        var length = BinaryPrimitives.ReadInt32LittleEndian(entry[8..]);
        var candidateTypeId = BinaryPrimitives.ReadUInt16LittleEndian(entry[12..]);
        if (length <= 0 || offset < 0 || offset > sourceLength - length ||
            offset < mappedOffset || offset - mappedOffset > mappedLength - length ||
            candidateTypeId >= typeCount)
            return false;

        record = new ReadOnlySpan<byte>(mappedSource + (offset - mappedOffset), length);
        typeId = candidateTypeId;
        return true;
    }
}
