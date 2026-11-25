import ifcopenshell
from pathlib import Path
model = ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc')
hosts = set()
for rel in model.by_type('IfcRelVoidsElement'):
    opening = rel.RelatedOpeningElement
    if opening.Representation and any(rep.RepresentationIdentifier == 'Body'
                                      for rep in opening.Representation.Representations):
        hosts.add(rel.RelatingBuildingElement.id())
out = Path(__file__).resolve().parent / 'all-body-void-hosts.txt'
out.write_text('\n'.join(map(str, sorted(hosts))))
print(len(hosts), out)
