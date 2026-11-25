import json, math
from pathlib import Path
import ifcopenshell, ifcopenshell.util.placement
import numpy as np

model = ifcopenshell.open(r'F:\Working\IFC Temp\Nhip chinh.ifc')
rows = []
for entity_id in (490757, 178955, 281338, 448868):
    host = model.by_id(entity_id)
    relations = [r for r in model.get_inverse(host) if r.is_a('IfcRelVoidsElement')
                 and r.RelatingBuildingElement == host]
    def describe(product):
        result = {'id': product.id(), 'type': product.is_a(), 'name': product.Name, 'reps': []}
        placement = ifcopenshell.util.placement.get_local_placement(product.ObjectPlacement)
        for rep in product.Representation.Representations:
            data = {'id': rep.id(), 'identifier': rep.RepresentationIdentifier,
                    'representationType': rep.RepresentationType, 'items': []}
            for item in rep.Items:
                node = {'id': item.id(), 'type': item.is_a(), 'step': str(item)[:400]}
                if item.is_a('IfcExtrudedAreaSolid'):
                    transform = placement @ ifcopenshell.util.placement.get_axis2placement(item.Position)
                    axis = transform[:3,:3] @ np.asarray(item.ExtrudedDirection.DirectionRatios)
                    axis /= np.linalg.norm(axis)
                    node.update(depth=item.Depth, axis=axis.tolist(), transform=transform.tolist(),
                                profile=str(item.SweptArea)[:400])
                data['items'].append(node)
            result['reps'].append(data)
        return result
    row = {'host': describe(host), 'cutters': [describe(r.RelatedOpeningElement) for r in relations]}
    rows.append(row)
    print(json.dumps(row), flush=True)
Path(__file__).with_name('remaining-local-structures.json').write_text(json.dumps(rows, indent=2))
