from pathlib import Path
import json
import ifcopenshell, ifcopenshell.util.placement as pl
import numpy as np

root = Path(__file__).resolve().parent
for family, entity_id in [('plate',490757),('footing',178955),('member',281338)]:
    model = ifcopenshell.open(str(root / f'{family}-{entity_id}.ifc'))
    host = model.by_id(entity_id)
    solid = next(item for rep in host.Representation.Representations
                 if rep.RepresentationIdentifier == 'Body' for item in rep.Items
                 if item.is_a('IfcExtrudedAreaSolid'))
    frame = pl.get_local_placement(host.ObjectPlacement) @ pl.get_axis2placement(solid.Position)
    inverse = np.linalg.inv(frame)
    products = [host] + [rel.RelatedOpeningElement for rel in host.HasOpenings]
    converted = [(p, inverse @ pl.get_local_placement(p.ObjectPlacement)) for p in products]
    def placement(matrix):
        matrix[np.abs(matrix) < 1e-12] = 0.0
        matrix[np.abs(matrix - 1.0) < 1e-12] = 1.0
        matrix[np.abs(matrix + 1.0) < 1e-12] = -1.0
        point = model.create_entity('IfcCartesianPoint', tuple(float(x) for x in matrix[:3,3]))
        axis = model.create_entity('IfcDirection', tuple(float(x) for x in matrix[:3,2]))
        ref = model.create_entity('IfcDirection', tuple(float(x) for x in matrix[:3,0]))
        return model.create_entity('IfcLocalPlacement', None,
            model.create_entity('IfcAxis2Placement3D', point, axis, ref))
    for product, transform in converted:
        product.ObjectPlacement = placement(transform)
    for site in model.by_type('IfcSite'):
        site.ObjectPlacement = placement(np.eye(4))
    target = root / f'{family}-{entity_id}-host-frame.ifc'
    model.write(str(target))
    (root / f'{family}-{entity_id}-frame.json').write_text(json.dumps(frame.tolist()))
    print(target, flush=True)
