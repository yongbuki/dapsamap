// Metres, XY plan with Z up. Independent helpers shared by CAD input and BIM schedules.
export function snapPoint(p,{step=.01,vertices=[],anchor=null,ortho=false,tolerance=.15}={}){
  let q=p.map(v=>Math.round(v/step)*step);
  if(ortho&&anchor){if(Math.abs(q[0]-anchor[0])>=Math.abs(q[1]-anchor[1]))q[1]=anchor[1];else q[0]=anchor[0];}
  let best=tolerance;
  for(const v of vertices){if(ortho&&anchor&&Math.abs(v[0]-q[0])>1e-8&&Math.abs(v[1]-q[1])>1e-8)continue;const d=Math.hypot(v[0]-q[0],v[1]-q[1]);if(d<best){q=v.slice();best=d;}}
  return q;
}
export function wallFromAxis(a,b,thickness){
  const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);
  if(![...a,...b,thickness].every(Number.isFinite)||l<.1||thickness<.05||thickness>2)throw Error('벽 길이는 0.1m 이상, 두께는 0.05~2m로 입력하세요.');
  const x=-dy/l*thickness/2,y=dx/l*thickness/2;
  return [[a[0]+x,a[1]+y],[b[0]+x,b[1]+y],[b[0]-x,b[1]-y],[a[0]-x,a[1]-y]];
}
export function checkPolygon(points){
  if(points.length<3||points.length>400)throw Error('꼭짓점은 3~400개가 필요합니다.');
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(Math.hypot(b[0]-a[0],b[1]-a[1])<.001)throw Error('겹치는 꼭짓점을 제거하세요.');
    for(let j=i+1;j<points.length;j++){
      if(j===i+1||i===0&&j===points.length-1)continue;
      const c=points[j],d=points[(j+1)%points.length];
      if(Math.max(a[0],b[0])+1e-9<Math.min(c[0],d[0])||Math.max(c[0],d[0])+1e-9<Math.min(a[0],b[0])||Math.max(a[1],b[1])+1e-9<Math.min(c[1],d[1])||Math.max(c[1],d[1])+1e-9<Math.min(a[1],b[1]))continue;
      if(cross(a,b,c)*cross(a,b,d)<=1e-12&&cross(c,d,a)*cross(c,d,b)<=1e-12)throw Error('선이 교차하거나 맞닿는 다각형은 만들 수 없습니다.');
    }
  }
}
export function quantities(items){return items.map(o=>{
  const p=o.points,area=Math.abs(p.reduce((a,q,i)=>{const r=p[(i+1)%p.length];return a+q[0]*r[1]-r[0]*q[1];},0)/2),length=Math.hypot(p[1][0]-p[0][0],p[1][1]-p[0][1]),height=o.floors*o.fh;
  const holes=(o.openings||[]).reduce((n,h)=>n+h.width*h.height,0),thickness=area/length;
  return {id:o.id,name:o.name,type:o.type||'mass',level:o.level||'',material:o.material||'',area,height,length,volume:Math.max(0,area*height-(o.type==='wall'?holes*thickness:0)),openings:holes};
});}
export function quantityCSV(items){const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';return '\uFEFF'+[['id','name','type','level','material','plan_area_m2','height_m','net_volume_m3','opening_area_m2'],...quantities(items).map(r=>[r.id,r.name,r.type,r.level,r.material,r.area,r.height,r.volume,r.openings])].map(r=>r.map(cell).join(',')).join('\r\n');}
