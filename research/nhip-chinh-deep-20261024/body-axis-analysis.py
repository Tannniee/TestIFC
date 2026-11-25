import ifcopenshell,ifcopenshell.util.placement as pl,numpy as np,json
from pathlib import Path
p=Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024')
f=ifcopenshell.open(str(p/'body-repro/minimal-original.ifc'));h=f[2444];solid=h.Representation.Representations[0].Items[0];hm=pl.get_local_placement(h.ObjectPlacement)@pl.get_axis2placement(solid.Position);R=hm[:3,:3];rows=[]
print('HOST',solid,hm.tolist())
for rel in h.HasOpenings:
 e=rel.RelatedOpeningElement;rep=e.Representation.Representations[0]
 for s in rep.Items:
  om=pl.get_local_placement(e.ObjectPlacement)@pl.get_axis2placement(s.Position);d=om[:3,:3]@np.array(s.ExtrudedDirection.DirectionRatios);local=R.T@d;rot=np.linalg.inv(hm)@om
  r={'id':e.id(),'profile':str(s.SweptArea),'depth':s.Depth,'directionInHostSolidAxes':local.tolist(),'baseInHostSolid':rot[:3,3].tolist()};rows.append(r);print(json.dumps(r))
(p/'body-axis-analysis.json').write_text(json.dumps(rows,indent=2))
