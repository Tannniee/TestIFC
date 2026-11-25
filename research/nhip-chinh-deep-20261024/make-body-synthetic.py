from pathlib import Path
import math,json
p=Path(r'F:\Steel\VBA\IFC-Lite\research\nhip-chinh-deep-20261024')
lines=['ISO-10303-21;','HEADER;',"FILE_DESCRIPTION(('Synthetic thin-axis plate invariant'),'2;1');","FILE_NAME('thin-axis.ifc','2026-10-24T00:00:00',(''),(''),'','','');","FILE_SCHEMA(('IFC4'));",'ENDSEC;','DATA;',"#1=IFCCARTESIANPOINT((0.,0.,0.));","#2=IFCAXIS2PLACEMENT3D(#1,$,$);","#3=IFCLOCALPLACEMENT($,#2);","#4=IFCDIRECTION((0.,0.,1.));","#5=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);","#6=IFCUNITASSIGNMENT((#5));","#7=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-7,#2,$);","#8=IFCPROJECT('0000000000000000000001',$,'P',$,$,$,$,(#7),#6);","#9=IFCCARTESIANPOINT((1000000.,2000000.,0.));","#10=IFCAXIS2PLACEMENT3D(#9,$,$);","#11=IFCLOCALPLACEMENT($,#10);","#12=IFCSITE('0000000000000000000002',$,'S',$,$,#11,$,$,.ELEMENT.,$,$,$,$,$);","#13=IFCCARTESIANPOINT((16.,86.,56.));","#14=IFCDIRECTION((0.7966496318,0.0312806458,-0.6036314151));","#15=IFCDIRECTION((0.4771486302,0.5805057096,0.6598047483));","#16=IFCAXIS2PLACEMENT3D(#13,#14,#15);","#17=IFCLOCALPLACEMENT(#11,#16);","#18=IFCRECTANGLEPROFILEDEF(.AREA.,$,$,0.016,2.46);","#19=IFCEXTRUDEDAREASOLID(#18,#2,#4,3.114);","#20=IFCSHAPEREPRESENTATION(#7,'Body','SweptSolid',(#19));","#21=IFCPRODUCTDEFINITIONSHAPE($,$,(#20));","#100=IFCMEMBER('0000000000000000000003',$,'Plate',$,$,#17,#21,$,.NOTDEFINED.);","#22=IFCCARTESIANPOINT((-0.016,0.,0.));","#23=IFCDIRECTION((1.,0.,0.));","#24=IFCDIRECTION((0.,1.,0.));","#25=IFCAXIS2PLACEMENT3D(#22,#23,#24);"]
nextid=200

def poly(points):
 global nextid
 i=nextid;nextid+=7
 coords=','.join(f'({x:.12g},{y:.12g},0.)' for x,y in points+[points[0]])
 lines.extend([f'#{i}=IFCCARTESIANPOINTLIST3D(({coords}));'])
 # Use 2D point list + indexed polycurve instead.
 lines[-1]=f'#{i}=IFCCARTESIANPOINTLIST2D(({",".join(f"({x:.12g},{y:.12g})" for x,y in points)}));'
 lines.extend([f'#{i+1}=IFCINDEXEDPOLYCURVE(#{i},(IFCLINEINDEX(({",".join(str(k) for k in range(1,len(points)+1))},1))),$);',f'#{i+2}=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#{i+1});',f'#{i+3}=IFCEXTRUDEDAREASOLID(#{i+2},#25,#4,0.032);',f"#{i+4}=IFCSHAPEREPRESENTATION(#7,'Body','SweptSolid',(#{i+3}));",f'#{i+5}=IFCPRODUCTDEFINITIONSHAPE($,$,(#{i+4}));',f"#{i+6}=IFCVOIDINGFEATURE('000000000000000000{i+6:04d}',$,'Cut',$,$,#17,#{i+5},$,.HOLE.);"])
 rel=nextid;nextid+=1;lines.append(f"#{rel}=IFCRELVOIDSELEMENT('000000000000000000{rel:04d}',$,$,$,#100,#{i+6});")

# Rounded rectangular interior hole with 16 points per quadrant.
pts=[]
for cx,cy,start in [(.53,.7,270),(.53,2.414,0),(-.53,2.414,90),(-.53,.7,180)]:
 for j in range(17):
  a=math.radians(start+j*90/16);pts.append((cx+.2*math.cos(a),cy+.2*math.sin(a)))
poly(pts)
# Quarter-circle corner notches and a complete transverse slit splitting components.
for y,z in [(-1.23,0),(1.23,0),(-1.23,3.114),(1.23,3.114)]:
 poly([(y+.035*math.cos(a*2*math.pi/32),z+.035*math.sin(a*2*math.pi/32)) for a in range(32)])
lines+=['ENDSEC;','END-ISO-10303-21;']
(p/'body-synthetic-rotated.ifc').write_text('\n'.join(lines))
print('written',nextid,len(lines))

