"""Extend the private phase3 IFC fixture with three independently filterable beams."""
import sys

import ifcopenshell
import ifcopenshell.guid

model = ifcopenshell.open(sys.argv[1])
beam = model.by_id(5)
beams = [beam]
guid = ifcopenshell.guid.new
for index, name in enumerate(["Group Beam B", "Group Beam C"], 1):
    point = model.create_entity("IfcCartesianPoint", (float(index * 1500), 0., 0.))
    placement = model.create_entity("IfcLocalPlacement", None, model.create_entity("IfcAxis2Placement3D", point))
    beams.append(model.create_entity("IfcBeam", GlobalId=guid(), Name=name,
                                    Representation=beam.Representation, ObjectPlacement=placement))
model.by_id(20).RelatedElements = beams
model.by_id(31).RelatedObjects = beams
model.by_id(33).RelatedObjects = beams[:2]
model.by_id(37).RelatedObjects = beams
for item, zone in zip(beams, ["A", "A", "B"]):
    prop = model.create_entity("IfcPropertySingleValue", Name="Zone", NominalValue=model.create_entity("IfcLabel", zone))
    pset = model.create_entity("IfcPropertySet", GlobalId=guid(), Name="Pset_GroupSelection", HasProperties=[prop])
    model.create_entity("IfcRelDefinesByProperties", GlobalId=guid(), RelatedObjects=[item], RelatingPropertyDefinition=pset)
prop = model.create_entity("IfcPropertySingleValue", Name="Profile", NominalValue=model.create_entity("IfcLabel", "PL 20x200"))
pset = model.create_entity("IfcPropertySet", GlobalId=guid(), Name="Pset_Phase3Benchmark", HasProperties=[prop])
model.create_entity("IfcRelDefinesByProperties", GlobalId=guid(), RelatedObjects=[beams[2]], RelatingPropertyDefinition=pset)
model.write(sys.argv[2])
