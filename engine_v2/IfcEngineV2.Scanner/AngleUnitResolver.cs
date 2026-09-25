namespace IfcEngineV2.Scanner;

internal static class AngleUnitResolver
{
    public static double ResolveRadiansPerUnit(
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> entries,
        long maximumExpressId,
        TypeRegistry registry)
    {
        for (var expressId = 0; expressId <= maximumExpressId; expressId++)
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
                    !StepParsing.TryGetTopLevelArgument(unit, 1, out var measureType) ||
                    StepParsing.AsciiUpperString(StepParsing.Trim(measureType)) != ".PLANEANGLEUNIT.")
                {
                    continue;
                }

                var typeName = registry[unitTypeId].Name;
                if (typeName == "IFCSIUNIT")
                {
                    if (!StepParsing.TryGetTopLevelArgument(unit, 3, out var unitName) ||
                        StepParsing.AsciiUpperString(StepParsing.Trim(unitName)) != ".RADIAN.")
                    {
                        throw new InvalidDataException($"IfcSIUnit #{unitId} has an unsupported plane-angle unit.");
                    }
                    return 1d;
                }

                if (typeName == "IFCCONVERSIONBASEDUNIT")
                {
                    if (!StepParsing.TryGetTopLevelArgument(unit, 2, out var nameArgument) ||
                        !StepParsing.TryGetTopLevelArgument(unit, 3, out var factorArgument) ||
                        !StepParsing.TryReadSingleReference(factorArgument, out var factorId))
                        throw new InvalidDataException($"IfcConversionBasedUnit #{unitId} has no valid plane-angle conversion.");
                    var name = StepParsing.AsciiUpperString(StepParsing.Trim(nameArgument));
                    if (name is not ("'DEGREE'" or "'DEGREES'"))
                        throw new InvalidDataException($"IfcConversionBasedUnit #{unitId} has unsupported plane-angle unit {name}.");
                    if (!GraphCoverageAnalyzer.TryGetRecord(source, entries, factorId, out var factor, out var factorTypeId) ||
                        registry[factorTypeId].Name != "IFCMEASUREWITHUNIT" ||
                        !StepParsing.TryGetTopLevelArgument(factor, 0, out var valueArgument) ||
                        !TryParsePlaneAngleMeasure(valueArgument, out var radiansPerUnit) ||
                        !StepParsing.TryGetTopLevelArgument(factor, 1, out var componentArgument) ||
                        !StepParsing.TryReadSingleReference(componentArgument, out var componentId) ||
                        !GraphCoverageAnalyzer.TryGetRecord(source, entries, componentId, out var component, out var componentTypeId) ||
                        registry[componentTypeId].Name != "IFCSIUNIT" ||
                        !StepParsing.TryGetTopLevelArgument(component, 1, out var componentMeasureType) ||
                        StepParsing.AsciiUpperString(StepParsing.Trim(componentMeasureType)) != ".PLANEANGLEUNIT." ||
                        !StepParsing.TryGetTopLevelArgument(component, 3, out var componentName) ||
                        StepParsing.AsciiUpperString(StepParsing.Trim(componentName)) != ".RADIAN." ||
                        !double.IsFinite(radiansPerUnit) || radiansPerUnit <= 0 ||
                        // buildingSMART's own IFC example writes 1.745E-2 for
                        // DEGREE. Accept that rounded conversion, but still reject
                        // a mismatched or implausible unit definition.
                        Math.Abs(radiansPerUnit - Math.PI / 180d) > 1e-5)
                    {
                        throw new InvalidDataException($"IfcConversionBasedUnit #{unitId} DEGREE has an invalid radian conversion factor.");
                    }
                    return radiansPerUnit;
                }

                throw new InvalidDataException($"Plane-angle unit {typeName} #{unitId} is not supported.");
            }
            break;
        }

        // IFC parameter values default to radians when no explicit plane-angle unit is assigned.
        return 1d;
    }

    private static bool TryParsePlaneAngleMeasure(ReadOnlySpan<byte> value, out double radiansPerUnit)
    {
        radiansPerUnit = 0;
        value = StepParsing.Trim(value);
        var open = value.IndexOf((byte)'(');
        if (open < 0 || value[^1] != (byte)')') return false;
        // IFC2X3 exporters also encode the dimensionless degree-to-radian
        // factor as IfcRatioMeasure. The referenced base unit and numeric
        // pi/180 check above still guard the interpretation.
        var kind = StepParsing.AsciiUpperString(value[..open]);
        // One real IFC4 exporter mislabels this numeric value as a positive
        // length measure. The referenced SI plane-angle unit and degree-scale
        // check above still make this narrow recovery unambiguous.
        if (kind is not ("IFCPLANEANGLEMEASURE" or "IFCRATIOMEASURE" or "IFCPOSITIVELENGTHMEASURE")) return false;
        return StepParsing.TryParseDouble(value[(open + 1)..^1], out radiansPerUnit);
    }
}
