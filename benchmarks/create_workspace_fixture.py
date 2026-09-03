"""Create a private Properties gate fixture; never modify the source IFC."""
from pathlib import Path
import argparse
import json
import re

import ifcopenshell
from ifcopenshell import guid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--element", type=int, default=58)
    parser.add_argument("--identity-edges", action="store_true", help="Include duplicate/missing GlobalId exporter edge cases")
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        parser.error("Output must differ from the source IFC")
    model = ifcopenshell.open(str(args.source))
    element = model.by_id(args.element)
    prop = model.create_entity("IfcPropertySingleValue", Name="WorkspaceCode",
                               NominalValue=model.create_entity("IfcLabel", "WS-PSET-READY"))
    pset = model.create_entity("IfcPropertySet", GlobalId=guid.new(), Name="Pset_WorkspaceGate", HasProperties=[prop])
    model.create_entity("IfcRelDefinesByProperties", GlobalId=guid.new(), RelatedObjects=[element], RelatingPropertyDefinition=pset)
    quantity = model.create_entity("IfcQuantityLength", Name="GateLength", LengthValue=3.5)
    quantities = model.create_entity("IfcElementQuantity", GlobalId=guid.new(), Name="Qto_WorkspaceGate", Quantities=[quantity])
    model.create_entity("IfcRelDefinesByProperties", GlobalId=guid.new(), RelatedObjects=[element], RelatingPropertyDefinition=quantities)
    material = model.create_entity("IfcMaterial", Name="WS-STEEL")
    model.create_entity("IfcRelAssociatesMaterial", GlobalId=guid.new(), RelatedObjects=[element], RelatingMaterial=material)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.identity_edges:
        elements = [item for item in model.by_type("IfcElement") if item.Representation][:3]
        if len(elements) < 3:
            parser.error("Identity fixture needs at least three represented elements")
        elements[1].GlobalId = elements[0].GlobalId
        text = model.to_string()
        # Deliberately invalid exporter identity; preserve its valid geometry.
        text, count = re.subn(rf"(#{elements[2].id()}=IFC\w+\()'[^']*'", r"\g<1>$", text)
        if count != 1:
            raise RuntimeError("Missing identity fixture substitution failed")
        args.output.write_text(text, encoding="utf-8")
        args.output.with_suffix(".identity.json").write_text(json.dumps({"duplicateIds": [item.id() for item in elements[:2]],
            "missingId": elements[2].id(), "duplicateGuid": elements[0].GlobalId}), encoding="utf-8")
    else:
        model.write(str(args.output))


if __name__ == "__main__":
    main()
