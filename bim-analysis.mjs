import {validate, signedArea, triangulate} from './studio-editor.mjs';
import {elementType, elementSolids, openingPlan} from './architectural-model.mjs';

// IFC4 STEP, metres, local east/north/up. Spatial reference is an optional
// IfcSite latitude/longitude, not a projected CRS or survey transformation.
export function toIFC(items,{name='Dapsa design',origin}={}){
 validate(items);let n=0;const lines=[],add=s=>{lines.push(`#${++n}=${s};`);return '#'+n;};
 const str=s=>{s=String(s??'').replace(/[\x00-\x1f]/g,' ');if(/[^\x20-\x7e]/.test(s)){let hex='';for(let i=0;i<s.length;i++)hex+=s.charCodeAt(i).toString(16).padStart(4,'0').toUpperCase();return "'\\X2\\"+hex+"\\X0\\'";}return "'"+s.replace(/\\/g,'\\\\').replace(/'/g,"''")+"'";};
 const num=x=>{if(!Number.isFinite(x))throw Error('IFC에는 유한한 수치가 필요합니다.');return Number(x.toFixed(9)).toFixed(9);};
 const guid=()=>{const bytes=crypto.getRandomValues(new Uint8Array(16)),abc='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';let v=0n;for(const b of bytes)v=(v<<8n)|BigInt(b);let s='';for(let i=0;i<22;i++){s=abc[Number(v&63n)]+s;v>>=6n;}return str(s);};
 const point=(x,y,z)=>add(`IFCCARTESIANPOINT((${[x,y,...(z===undefined?[]:[z])].map(num).join(',')}))`);
 const up=add('IFCDIRECTION((0.,0.,1.))'),east=add('IFCDIRECTION((1.,0.,0.))');
 const axis=(x=0,y=0,z=0)=>add(`IFCAXIS2PLACEMENT3D(${point(x,y,z)},${up},${east})`);
 const world=axis(),north=add('IFCDIRECTION((0.,1.))'),context=add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,${world},${north})`);
 const metre=add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"),area=add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),volume=add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"),units=add(`IFCUNITASSIGNMENT((${metre},${area},${volume}))`);
 const placement=(z=0)=>add(`IFCLOCALPLACEMENT($,${axis(0,0,z)})`),project=add(`IFCPROJECT(${guid()},$,${str(name)},$,$,$,$,(${context}),${units})`);
 const angle=v=>{const sign=v<0?-1:1;let t=Math.round(Math.abs(v)*3600e6);const d=Math.floor(t/3600e6);t-=d*3600e6;const m=Math.floor(t/60e6);t-=m*60e6;const s=Math.floor(t/1e6),u=t-s*1e6;return '('+[d,m,s,u].map(x=>sign*x).join(',')+')';};
 const hasOrigin=origin&&Number.isFinite(origin.lng)&&Number.isFinite(origin.lat)&&Math.abs(origin.lng)<=180&&Math.abs(origin.lat)<=90;
 const site=add(`IFCSITE(${guid()},$,${str('대지')},$,$,${placement()},$,$,.ELEMENT.,${hasOrigin?angle(origin.lat):'$'},${hasOrigin?angle(origin.lng):'$'},$,$,$)`);
 const building=add(`IFCBUILDING(${guid()},$,${str(name)},$,$,${placement()},$,$,.ELEMENT.,$,$,$)`),storey=add(`IFCBUILDINGSTOREY(${guid()},$,${str('설계 기준 레벨')},$,$,${placement()},$,$,.ELEMENT.,0.)`);
 for(const [parent,child]of [[project,site],[site,building],[building,storey]])add(`IFCRELAGGREGATES(${guid()},$,$,$,${parent},(${child}))`);
 const shape=(pts,height)=>{const p=signedArea(pts)<0?[...pts].reverse():pts;const refs=p.map(q=>point(q[0],q[1]));refs.push(refs[0]);const curve=add(`IFCPOLYLINE((${refs.join(',')}))`),profile=add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${curve})`),solid=add(`IFCEXTRUDEDAREASOLID(${profile},${world},${up},${num(height)})`),rep=add(`IFCSHAPEREPRESENTATION(${context},'Body','SweptSolid',(${solid}))`);return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);};
 const products=[];
 for(const o of items){
  const type=elementType(o),rep=shape(o.points,o.floors*o.fh),pos=placement(o.base),common=`${guid()},$,${str(o.name||type)},$,$,${pos},${rep},${str(o.id)}`;
  const entity=add(type==='wall'?`IFCWALL(${common},.NOTDEFINED.)`:type==='slab'?`IFCSLAB(${common},.FLOOR.)`:`IFCBUILDINGELEMENTPROXY(${common},.NOTDEFINED.)`);products.push(entity);
  const props=[add(`IFCPROPERTYSINGLEVALUE('SourceId',$,IFCLABEL(${str(o.id)}),$)`),add(`IFCPROPERTYSINGLEVALUE('ElementKind',$,IFCLABEL(${str(type)}),$)`),add(`IFCPROPERTYSINGLEVALUE('Floors',$,IFCINTEGER(${o.floors}),$)`)];
  const pset=add(`IFCPROPERTYSET(${guid()},$,'Pset_DapsaDesign',$,(${props.join(',')}))`);add(`IFCRELDEFINESBYPROPERTIES(${guid()},$,$,$,(${entity}),${pset})`);
  for(const [i,h]of (o.openings||[]).entries()){
   const opening=add(`IFCOPENINGELEMENT(${guid()},$,${str((h.kind==='door'?'문':'창')+' 개구부 '+(i+1))},$,$,${placement(o.base+h.sill)},${shape(openingPlan(o,h),h.height)},$,.OPENING.)`);
   add(`IFCRELVOIDSELEMENT(${guid()},$,$,$,${entity},${opening})`);
   // Filling entities intentionally have no body: the editor models clear
   // apertures, without inventing glazing, frames or door leaves.
   const q=openingPlan(o,h)[0],u=[o.points[1][0]-o.points[0][0],o.points[1][1]-o.points[0][1]],len=Math.hypot(...u),ref=add(`IFCDIRECTION((${num(u[0]/len)},${num(u[1]/len)},0.))`),fillAxis=add(`IFCAXIS2PLACEMENT3D(${point(q[0],q[1],o.base+h.sill)},${up},${ref})`),fillPlacement=add(`IFCLOCALPLACEMENT($,${fillAxis})`);
   const fillBase=`${guid()},$,${str((h.kind==='door'?'문':'창')+' '+(i+1))},$,$,${fillPlacement},$,$,${num(h.height)},${num(h.width)}`;
   const fill=add(h.kind==='door'?`IFCDOOR(${fillBase},.DOOR.,.NOTDEFINED.,$)`:`IFCWINDOW(${fillBase},.WINDOW.,.NOTDEFINED.,$)`);
   add(`IFCRELFILLSELEMENT(${guid()},$,$,$,${opening},${fill})`);products.push(fill);
  }
 }
 if(products.length)add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid()},$,$,$,(${products.join(',')}),${storey})`);
 return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Dapsa geometric design export'),'2;1');\nFILE_NAME('dapsa.ifc','${new Date().toISOString()}',('Dapsa'),('Dapsa'),'Dapsa IFC exporter','Dapsa','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export function rayTriangle(p,d,t){const [a,b,c]=t,e1=sub(b,a),e2=sub(c,a),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-10)return Infinity;const s=sub(p,a),u=dot(s,h)/det;if(u< -1e-8||u>1+1e-8)return Infinity;const q=cross(s,e1),v=dot(d,q)/det;if(v< -1e-8||u+v>1+1e-8)return Infinity;const distance=dot(e2,q)/det;return distance>1e-5?distance:Infinity;}
export function prismTriangles(o){const p=o.points,z=o.base,h=o.floors*o.fh,top=p.map(q=>[...q,z+h]),bottom=p.map(q=>[...q,z]),out=[];for(const t of triangulate(p))out.push(t.map(i=>top[i]),t.map(i=>bottom[i]));for(let i=0;i<p.length;i++){const j=(i+1)%p.length;out.push([bottom[i],bottom[j],top[j]],[bottom[i],top[j],top[i]]);}return out;}
const inPolygon=(q,p)=>{let b=false;for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>q[1])!==(p[j][1]>q[1])&&q[0]<(p[j][0]-p[i][0])*(q[1]-p[i][1])/(p[j][1]-p[i][1])+p[i][0])b=!b;return b;};
export function directSunlight(items,slabId,direction,{workplane=.75,maxSamples=500}={}){
 validate(items);const floor=items.find(o=>o.id===slabId&&elementType(o)==='slab');if(!floor)throw Error('분석할 바닥판을 선택하세요.');
 if(!Array.isArray(direction)||direction.length!==3||!direction.every(Number.isFinite)||!Number.isFinite(workplane)||workplane<0||workplane>3||!Number.isInteger(maxSamples)||maxSamples<10||maxSamples>1000)throw Error('태양 방향과 작업면 높이를 확인하세요.');
 const length=Math.hypot(...direction);if(length<1e-8)throw Error('태양 방향이 없습니다.');const d=direction.map(x=>x/length);
 const all=items.flatMap(elementSolids).flatMap(prismTriangles);if(all.length>100000)throw Error('모델이 너무 복잡합니다. 단순화한 뒤 분석하세요.');
 const wallBodies=items.filter(o=>elementType(o)==='wall'&&(o.openings||[]).length).map(prismTriangles);
 const p=floor.points,minX=Math.min(...p.map(p=>p[0])),maxX=Math.max(...p.map(p=>p[0])),minY=Math.min(...p.map(p=>p[1])),maxY=Math.max(...p.map(p=>p[1]));
 const nx=Math.min(maxSamples,Math.max(1,Math.ceil(Math.sqrt(maxSamples*(maxX-minX)/Math.max(.001,maxY-minY))))),ny=Math.max(1,Math.floor(maxSamples/nx)),dx=(maxX-minX)/nx,dy=(maxY-minY)/ny,z=floor.base+floor.fh+workplane,cells=[];
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const x=minX+(i+.5)*dx,y=minY+(j+.5)*dy;if(!inPolygon([x,y],p))continue;const origin=[x,y,z],lit=d[2]>0&&!all.some(t=>Number.isFinite(rayTriangle(origin,d,t))),throughOpening=lit&&wallBodies.some(body=>body.some(t=>Number.isFinite(rayTriangle(origin,d,t))));
  cells.push({x,y,z,dx,dy,lit,throughOpening});
 }
 if(!cells.length)throw Error('작업면 표본을 만들 수 없습니다.');
 const lit=cells.filter(c=>c.lit).length,through=cells.filter(c=>c.throughOpening).length;
 return {cells,direction:d,slabId,workplane,samples:cells.length,litPercent:lit/cells.length*100,openingPercent:through/cells.length*100,belowHorizon:d[2]<=0};
}
