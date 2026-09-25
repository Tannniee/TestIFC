using System.Collections;

namespace IfcEngineV2.Scanner;

internal static class ProductBindingAnalyzer
{
    private const int MaximumReportedIssues = 50;

    public static ProductBindingLedger Analyze(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        long maximumExpressId,
        TypeRegistry registry,
        BitArray productDefinitionIds,
        long expectedProductDefinitions,
        out int[] productDefinitionIdsByProduct,
        out int[] productOwnerCounts,
        out int[] firstProductOwnerIds)
    {
        productOwnerCounts = new int[checked((int)maximumExpressId + 1)];
        firstProductOwnerIds = new int[checked((int)maximumExpressId + 1)];
        productDefinitionIdsByProduct = new int[checked((int)maximumExpressId + 1)];
        var productTypes = new Dictionary<string, long>(StringComparer.Ordinal);
        var issues = new List<string>();
        var placementResolver = new InstanceChunkWriter.PlacementResolver(source, entries, registry, productDefinitionIdsByProduct.Length);
        long productsWithPlacement = 0;
        long productsWithGlobalId = 0;

        for (var expressId = 0; expressId <= maximumExpressId; expressId++)
        {
            if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, expressId, out var record, out var typeId)) continue;
            if (!StepParsing.TryGetTopLevelArgument(record, 6, out var representationArgument) ||
                !StepParsing.TryReadSingleReference(representationArgument, out var productDefinitionId) ||
                productDefinitionId < 0 ||
                productDefinitionId >= productDefinitionIds.Length ||
                !productDefinitionIds[productDefinitionId])
            {
                continue;
            }

            productOwnerCounts[productDefinitionId] = checked(productOwnerCounts[productDefinitionId] + 1);
            productDefinitionIdsByProduct[expressId] = productDefinitionId;
            if (firstProductOwnerIds[productDefinitionId] == 0) firstProductOwnerIds[productDefinitionId] = checked((int)expressId);
            var typeName = registry[typeId].Name;
            productTypes[typeName] = productTypes.GetValueOrDefault(typeName) + 1;

            string? placementError = null;
            if (StepParsing.TryGetTopLevelArgument(record, 5, out var placementArgument) &&
                StepParsing.TryReadSingleReference(placementArgument, out var placementId) &&
                GraphCoverageAnalyzer.TryGetRecord(source, entries, placementId, out _, out var placementTypeId) &&
                registry[placementTypeId].Kind == EntityKind.LocalPlacement &&
                placementResolver.TryValidate(placementId, out placementError))
            {
                productsWithPlacement++;
            }
            else
            {
                AddIssue(issues, $"Product #{expressId} has an invalid IfcLocalPlacement: {placementError ?? "missing or wrong entity type"}.");
            }

            if (StepParsing.TryGetTopLevelArgument(record, 0, out var globalId) && HasStepStringValue(globalId))
            {
                productsWithGlobalId++;
            }
            else
            {
                AddIssue(issues, $"Product #{expressId} has no GlobalId.");
            }
        }

        long bound = 0;
        long missing = 0;
        long duplicates = 0;
        for (var expressId = 0; expressId <= maximumExpressId; expressId++)
        {
            if (!productDefinitionIds[checked((int)expressId)]) continue;
            var count = productOwnerCounts[checked((int)expressId)];
            if (count == 0)
            {
                missing++;
                AddIssue(issues, $"IfcProductDefinitionShape #{expressId} has no product owner.");
            }
            else
            {
                bound++;
                if (count > 1)
                {
                    duplicates++;
                }
            }
        }

        var representedProducts = productTypes.Values.Sum();
        // An unowned shape definition cannot appear in the product table and
        // contributes no visible model element. Keep it in the ledger, but do
        // not reject every owned product because an exporter left it behind.
        var status = bound + missing == expectedProductDefinitions &&
                     productsWithPlacement == representedProducts && productsWithGlobalId == representedProducts
            ? "complete"
            : "incomplete";
        return new ProductBindingLedger(
            status,
            bound,
            missing,
            duplicates,
            productsWithPlacement,
            productsWithGlobalId,
            productTypes.OrderBy(pair => pair.Key, StringComparer.Ordinal).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            issues);
    }

    private static bool HasStepStringValue(ReadOnlySpan<byte> value)
    {
        value = StepParsing.Trim(value);
        return value.Length >= 2 && value[0] == (byte)'\'' && value[^1] == (byte)'\'' && value.Length > 2;
    }

    private static void AddIssue(List<string> issues, string issue)
    {
        if (issues.Count < MaximumReportedIssues) issues.Add(issue);
    }
}
