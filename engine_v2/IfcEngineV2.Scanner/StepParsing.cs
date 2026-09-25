using System.Buffers.Text;
using System.Text;

namespace IfcEngineV2.Scanner;

internal static class StepParsing
{
    private const ulong FnvOffsetBasis = 14695981039346656037UL;
    private const ulong FnvPrime = 1099511628211UL;

    public static ulong HashAsciiUpper(ReadOnlySpan<byte> value)
    {
        var hash = FnvOffsetBasis;
        foreach (var current in value)
        {
            var normalized = current is >= (byte)'a' and <= (byte)'z'
                ? (byte)(current - 32)
                : current;
            hash ^= normalized;
            hash *= FnvPrime;
        }
        return hash;
    }

    public static string AsciiUpperString(ReadOnlySpan<byte> value)
    {
        return string.Create(value.Length, value.ToArray(), static (target, source) =>
        {
            for (var index = 0; index < source.Length; index++)
            {
                var current = source[index];
                target[index] = current is >= (byte)'a' and <= (byte)'z'
                    ? (char)(current - 32)
                    : (char)current;
            }
        });
    }

    public static bool TryReadRecordHeader(ReadOnlySpan<byte> data, int hashOffset, out RecordHeader header)
    {
        header = default;
        var cursor = hashOffset + 1;
        if ((uint)cursor >= (uint)data.Length || !IsDigit(data[cursor]))
        {
            return false;
        }

        long expressId = 0;
        while ((uint)cursor < (uint)data.Length && IsDigit(data[cursor]))
        {
            expressId = checked(expressId * 10 + data[cursor] - (byte)'0');
            cursor++;
        }

        SkipWhitespace(data, ref cursor);
        if ((uint)cursor >= (uint)data.Length || data[cursor++] != (byte)'=')
        {
            return false;
        }

        SkipWhitespace(data, ref cursor);
        var typeStart = cursor;
        while ((uint)cursor < (uint)data.Length && IsIdentifier(data[cursor]))
        {
            cursor++;
        }

        var typeLength = cursor - typeStart;
        if (typeLength == 0)
        {
            return false;
        }

        SkipWhitespace(data, ref cursor);
        if ((uint)cursor >= (uint)data.Length || data[cursor] != (byte)'(')
        {
            return false;
        }

        header = new RecordHeader(expressId, typeStart, typeLength);
        return true;
    }

    public static bool TryGetTopLevelArgument(ReadOnlySpan<byte> record, int requestedIndex, out ReadOnlySpan<byte> argument)
    {
        argument = default;
        var open = record.IndexOf((byte)'(');
        if (open < 0)
        {
            return false;
        }

        var depth = 1;
        var currentIndex = 0;
        var argumentStart = open + 1;
        var inString = false;
        var inComment = false;

        for (var cursor = open + 1; cursor < record.Length; cursor++)
        {
            var current = record[cursor];
            var next = cursor + 1 < record.Length ? record[cursor + 1] : (byte)0;

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
                if (current == (byte)'\'' && next == (byte)'\'')
                {
                    cursor++;
                }
                else if (current == (byte)'\'')
                {
                    inString = false;
                }
                continue;
            }

            if (current == (byte)'/' && next == (byte)'*')
            {
                inComment = true;
                cursor++;
            }
            else if (current == (byte)'\'')
            {
                inString = true;
            }
            else if (current == (byte)'(')
            {
                depth++;
            }
            else if (current == (byte)')')
            {
                depth--;
                if (depth == 0)
                {
                    if (currentIndex == requestedIndex)
                    {
                        argument = Trim(record[argumentStart..cursor]);
                        return true;
                    }
                    return false;
                }
            }
            else if (current == (byte)',' && depth == 1)
            {
                if (currentIndex == requestedIndex)
                {
                    argument = Trim(record[argumentStart..cursor]);
                    return true;
                }
                currentIndex++;
                argumentStart = cursor + 1;
            }
        }

        return false;
    }

    public static bool IsOmitted(ReadOnlySpan<byte> value)
    {
        value = Trim(value);
        return value.Length == 1 && value[0] is (byte)'$' or (byte)'*';
    }

    public static int CountReferences(ReadOnlySpan<byte> value)
    {
        var count = 0;
        var inString = false;
        for (var cursor = 0; cursor < value.Length; cursor++)
        {
            var current = value[cursor];
            var next = cursor + 1 < value.Length ? value[cursor + 1] : (byte)0;
            if (inString)
            {
                if (current == (byte)'\'' && next == (byte)'\'') cursor++;
                else if (current == (byte)'\'') inString = false;
                continue;
            }
            if (current == (byte)'\'') inString = true;
            else if (current == (byte)'#' && next is >= (byte)'0' and <= (byte)'9') count++;
        }
        return count;
    }

    public static void CollectReferences(ReadOnlySpan<byte> value, List<int> destination)
    {
        destination.Clear();
        var inString = false;
        var inComment = false;
        for (var cursor = 0; cursor < value.Length; cursor++)
        {
            var current = value[cursor];
            var next = cursor + 1 < value.Length ? value[cursor + 1] : (byte)0;
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
            if (current != (byte)'#' || next is < (byte)'0' or > (byte)'9') continue;

            var id = 0;
            cursor++;
            while (cursor < value.Length && value[cursor] is >= (byte)'0' and <= (byte)'9')
            {
                id = checked(id * 10 + value[cursor] - (byte)'0');
                cursor++;
            }
            destination.Add(id);
            cursor--;
        }
    }

    public static bool TryReadSingleReference(ReadOnlySpan<byte> value, out int expressId)
    {
        expressId = 0;
        value = Trim(value);
        if (value.Length < 2 || value[0] != (byte)'#') return false;
        for (var cursor = 1; cursor < value.Length; cursor++)
        {
            var current = value[cursor];
            if (current is < (byte)'0' or > (byte)'9') return false;
            expressId = checked(expressId * 10 + current - (byte)'0');
        }
        return true;
    }

    public static bool TryParseLogical(ReadOnlySpan<byte> value, out bool result)
    {
        value = Trim(value);
        if (value.SequenceEqual(".T."u8))
        {
            result = true;
            return true;
        }
        if (value.SequenceEqual(".F."u8))
        {
            result = false;
            return true;
        }
        result = false;
        return false;
    }

    public static int CountListItems(ReadOnlySpan<byte> value)
    {
        value = Trim(value);
        if (value.Length < 2 || value[0] != (byte)'(')
        {
            return 0;
        }

        var depth = 0;
        var items = 0;
        var hasToken = false;
        var inString = false;
        for (var cursor = 1; cursor < value.Length; cursor++)
        {
            var current = value[cursor];
            var next = cursor + 1 < value.Length ? value[cursor + 1] : (byte)0;
            if (inString)
            {
                hasToken = true;
                if (current == (byte)'\'' && next == (byte)'\'') cursor++;
                else if (current == (byte)'\'') inString = false;
                continue;
            }
            if (current == (byte)'\'')
            {
                inString = true;
                hasToken = true;
            }
            else if (current == (byte)'(')
            {
                depth++;
                hasToken = true;
            }
            else if (current == (byte)')')
            {
                if (depth == 0)
                {
                    if (hasToken) items++;
                    return items;
                }
                depth--;
                hasToken = true;
            }
            else if (current == (byte)',' && depth == 0)
            {
                items++;
                hasToken = false;
            }
            else if (!IsWhitespace(current))
            {
                hasToken = true;
            }
        }
        return items;
    }

    public static bool TryParseDoubleList(ReadOnlySpan<byte> value, Span<double> destination, out int count)
    {
        count = 0;
        value = Trim(value);
        if (value.Length < 2 || value[0] != (byte)'(' || value[^1] != (byte)')') return false;
        value = value[1..^1];
        var start = 0;
        while (start <= value.Length)
        {
            var comma = value[start..].IndexOf((byte)',');
            var end = comma < 0 ? value.Length : start + comma;
            var token = Trim(value[start..end]);
            if (count >= destination.Length || token.Length == 0 ||
                !Utf8Parser.TryParse(token, out double parsed, out var consumed) || consumed != token.Length)
            {
                return false;
            }
            destination[count++] = parsed;
            if (comma < 0) break;
            start = end + 1;
        }
        return count > 0;
    }

    public static bool TryParsePositiveIntList(ReadOnlySpan<byte> value, List<int> destination)
    {
        destination.Clear();
        value = Trim(value);
        if (value.Length < 2 || value[0] != (byte)'(' || value[^1] != (byte)')') return false;
        value = value[1..^1];
        var start = 0;
        while (start <= value.Length)
        {
            var comma = value[start..].IndexOf((byte)',');
            var end = comma < 0 ? value.Length : start + comma;
            var token = Trim(value[start..end]);
            if (token.Length == 0 ||
                !Utf8Parser.TryParse(token, out int parsed, out var consumed) ||
                consumed != token.Length || parsed <= 0)
            {
                destination.Clear();
                return false;
            }
            destination.Add(parsed);
            if (comma < 0) break;
            start = end + 1;
        }
        return destination.Count > 0;
    }

    public static bool TryParsePositiveIntTuples(ReadOnlySpan<byte> value, List<int[]> destination)
    {
        destination.Clear();
        value = Trim(value);
        if (value.Length < 4 || value[0] != (byte)'(' || value[^1] != (byte)')') return false;
        var scratch = new List<int>();
        var cursor = 1;
        while (cursor < value.Length - 1)
        {
            while (cursor < value.Length - 1 && (IsWhitespace(value[cursor]) || value[cursor] == (byte)',')) cursor++;
            if (cursor >= value.Length - 1) break;
            if (value[cursor] != (byte)'(') return false;
            var end = FindBalancedListEnd(value, cursor);
            if (end < 0 || !TryParsePositiveIntList(value[cursor..(end + 1)], scratch)) return false;
            destination.Add(scratch.ToArray());
            cursor = end + 1;
        }
        return destination.Count > 0;
    }

    public static bool TryParseDoubleTuples(ReadOnlySpan<byte> value, int dimensions, List<double[]> destination)
    {
        destination.Clear();
        value = Trim(value);
        if (dimensions is < 2 or > 3 || value.Length < 4 || value[0] != (byte)'(' || value[^1] != (byte)')') return false;
        Span<double> scratch = stackalloc double[3];
        var cursor = 1;
        while (cursor < value.Length - 1)
        {
            while (cursor < value.Length - 1 && (IsWhitespace(value[cursor]) || value[cursor] == (byte)',')) cursor++;
            if (cursor >= value.Length - 1) break;
            if (value[cursor] != (byte)'(') return false;
            var end = FindBalancedListEnd(value, cursor);
            if (end < 0 || !TryParseDoubleList(value[cursor..(end + 1)], scratch, out var count) || count != dimensions)
            {
                destination.Clear();
                return false;
            }
            destination.Add(scratch[..count].ToArray());
            cursor = end + 1;
        }
        return destination.Count > 0;
    }

    public static bool TryParseIndexedLineSegments(ReadOnlySpan<byte> value, List<int> destination)
    {
        destination.Clear();
        value = Trim(value);
        if (value.Length < 2 || value[0] != (byte)'(' || value[^1] != (byte)')') return false;
        var scratch = new List<int>();
        var cursor = 1;
        var first = true;
        while (cursor < value.Length - 1)
        {
            while (cursor < value.Length - 1 && IsWhitespace(value[cursor])) cursor++;
            if (cursor >= value.Length - 1) break;
            if (!first)
            {
                if (value[cursor] != (byte)',') return false;
                cursor++;
                while (cursor < value.Length - 1 && IsWhitespace(value[cursor])) cursor++;
            }
            var identifierStart = cursor;
            while (cursor < value.Length - 1 && IsIdentifier(value[cursor])) cursor++;
            if (!AsciiUpperString(value[identifierStart..cursor]).Equals("IFCLINEINDEX", StringComparison.Ordinal)) return false;
            while (cursor < value.Length - 1 && IsWhitespace(value[cursor])) cursor++;
            if (cursor >= value.Length - 1 || value[cursor] != (byte)'(') return false;
            var wrapperEnd = FindBalancedListEnd(value, cursor);
            if (wrapperEnd < 0 || wrapperEnd >= value.Length - 1 ||
                !TryParsePositiveIntList(Trim(value[(cursor + 1)..wrapperEnd]), scratch) || scratch.Count < 2)
            {
                destination.Clear();
                return false;
            }
            if (destination.Count > 0 && destination[^1] != scratch[0])
            {
                destination.Clear();
                return false;
            }
            destination.AddRange(destination.Count == 0 ? scratch : scratch.Skip(1));
            cursor = wrapperEnd + 1;
            first = false;
        }
        return destination.Count >= 3;
    }

    public static bool TryParseDouble(ReadOnlySpan<byte> value, out double result)
    {
        value = Trim(value);
        return Utf8Parser.TryParse(value, out result, out var consumed) && consumed == value.Length;
    }

    public static ReadOnlySpan<byte> Trim(ReadOnlySpan<byte> value)
    {
        var start = 0;
        var end = value.Length;
        while (start < end && IsWhitespace(value[start])) start++;
        while (end > start && IsWhitespace(value[end - 1])) end--;
        return value[start..end];
    }

    public static string NormalizeStepString(ReadOnlySpan<byte> value)
    {
        return AsciiUpperString(TrimStepString(value));
    }

    public static string DecodeStepString(ReadOnlySpan<byte> value)
    {
        value = Trim(value);
        if (IsOmitted(value)) return string.Empty;
        value = TrimStepString(value);
        var result = new StringBuilder(value.Length);
        for (var cursor = 0; cursor < value.Length; cursor++)
        {
            var current = value[cursor];
            if (current == (byte)'\'' && cursor + 1 < value.Length && value[cursor + 1] == (byte)'\'')
            {
                result.Append('\'');
                cursor++;
                continue;
            }
            if (current != (byte)'\\' || cursor + 2 >= value.Length)
            {
                result.Append((char)current);
                continue;
            }
            if (cursor + 3 < value.Length && value[cursor + 1] == (byte)'X' && value[cursor + 2] == (byte)'\\')
            {
                if (TryHex(value.Slice(cursor + 3, 2), out var decoded))
                {
                    result.Append((char)decoded);
                    cursor += 4;
                    continue;
                }
            }
            if (value[cursor + 1] == (byte)'S' && value[cursor + 2] == (byte)'\\' && cursor + 3 < value.Length)
            {
                result.Append((char)(value[cursor + 3] + 128));
                cursor += 3;
                continue;
            }
            var width = cursor + 3 < value.Length && value[cursor + 1] == (byte)'X' &&
                value[cursor + 2] is (byte)'2' or (byte)'4' && value[cursor + 3] == (byte)'\\'
                ? value[cursor + 2] == (byte)'2' ? 4 : 8
                : 0;
            if (width > 0)
            {
                var start = cursor + 4;
                var end = FindEscapeEnd(value, start);
                if (end >= 0 && (end - start) % width == 0)
                {
                    var valid = true;
                    for (var offset = start; offset < end; offset += width)
                    {
                        if (!TryHex(value.Slice(offset, width), out var codePoint) ||
                            codePoint > 0x10ffff || codePoint is >= 0xd800 and <= 0xdfff)
                        {
                            valid = false;
                            break;
                        }
                        result.Append(char.ConvertFromUtf32(codePoint));
                    }
                    if (valid)
                    {
                        cursor = end + 3;
                        continue;
                    }
                }
            }
            result.Append((char)current);
        }
        return result.ToString();
    }

    private static int FindEscapeEnd(ReadOnlySpan<byte> value, int start)
    {
        for (var cursor = start; cursor + 3 < value.Length; cursor++)
        {
            if (value[cursor] == (byte)'\\' && value[cursor + 1] == (byte)'X' &&
                value[cursor + 2] == (byte)'0' && value[cursor + 3] == (byte)'\\') return cursor;
        }
        return -1;
    }

    private static int FindBalancedListEnd(ReadOnlySpan<byte> value, int start)
    {
        var depth = 0;
        for (var cursor = start; cursor < value.Length; cursor++)
        {
            if (value[cursor] == (byte)'(') depth++;
            else if (value[cursor] == (byte)')' && --depth == 0) return cursor;
        }
        return -1;
    }

    private static bool TryHex(ReadOnlySpan<byte> value, out int parsed)
    {
        parsed = 0;
        foreach (var current in value)
        {
            var digit = current switch
            {
                >= (byte)'0' and <= (byte)'9' => current - (byte)'0',
                >= (byte)'A' and <= (byte)'F' => current - (byte)'A' + 10,
                >= (byte)'a' and <= (byte)'f' => current - (byte)'a' + 10,
                _ => -1,
            };
            if (digit < 0) return false;
            if (parsed > (0x10ffff - digit) / 16) return false;
            parsed = parsed * 16 + digit;
        }
        return value.Length > 0;
    }

    public static ReadOnlySpan<byte> TrimStepString(ReadOnlySpan<byte> value)
    {
        value = Trim(value);
        return value.Length >= 2 && value[0] == (byte)'\'' && value[^1] == (byte)'\''
            ? value[1..^1]
            : value;
    }

    public static string DetectSchema(ReadOnlySpan<byte> data)
    {
        var headerLength = Math.Min(data.Length, 1024 * 1024);
        var header = data[..headerLength];
        var marker = "FILE_SCHEMA"u8;
        var markerOffset = header.IndexOf(marker);
        if (markerOffset < 0)
        {
            return "UNKNOWN";
        }

        var tail = header[(markerOffset + marker.Length)..];
        for (var cursor = 0; cursor < tail.Length; cursor++)
        {
            if (tail[cursor] != (byte)'\'') continue;
            var end = tail[(cursor + 1)..].IndexOf((byte)'\'');
            if (end < 0) break;
            var candidate = tail.Slice(cursor + 1, end);
            if (candidate.StartsWith("IFC"u8)) return AsciiUpperString(candidate);
            cursor += end + 1;
        }
        return "UNKNOWN";
    }

    private static void SkipWhitespace(ReadOnlySpan<byte> data, ref int cursor)
    {
        while ((uint)cursor < (uint)data.Length && IsWhitespace(data[cursor])) cursor++;
    }

    private static bool IsIdentifier(byte value) =>
        value is >= (byte)'A' and <= (byte)'Z' or >= (byte)'a' and <= (byte)'z' or >= (byte)'0' and <= (byte)'9' or (byte)'_';

    private static bool IsDigit(byte value) => value is >= (byte)'0' and <= (byte)'9';

    private static bool IsWhitespace(byte value) => value is (byte)' ' or (byte)'\t' or (byte)'\r' or (byte)'\n';
}
