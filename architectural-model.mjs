// Rectangular hosted openings subdivide a wall into individually closed panels.
// The openings are preserved in previews and OBJ without a CSG dependency.
export const elementType=o=>o.type||'mass';
export function wallFrame(o){
 const p=o.points,a=p[0],b=p[1],v=p[3],w=Math.hypot(b[0]-a[0],b[1]-a[1]),d=Math.hypot(v[0]-a[0],v[1]-a[1]);
 if(p.length!==4||w<0.1||d<0.05)throw Error('벽은 길이 0.1m 이상, 두께 0.05m 이상의 사각형이어야 합니다.');
 const u=[(b[0]-a[0])/w,(b[1]-a[1])/w],n=[(v[0]-a[0])/d,(v[1]-a[1])/d];
 if(Math.abs(u[0]*n[0]+u[1]*n[1])>1e-5||Math.hypot(p[2][0]-b[0]-v[0]+a[0],p[2][1]-b[1]-v[1]+a[1])>1e-4)throw Error('벽 윤곽은 직교 사각형이어야 합니다.');
 return {w,d,at:(x,y)=>[a[0]+u[0]*x+n[0]*y,a[1]+u[1]*x+n[1]*y]};
}
export function validateElement(o){
 const type=elementType(o);if(!['mass','wall','slab'].includes(type))throw Error('지원하지 않는 건축 요소입니다.');
 if(type==='mass')return;
 if(o.floors!==1||!Number.isFinite(o.fh)||o.fh<(type==='slab'?0.05:0.5)||o.fh>(type==='slab'?2:10))throw Error(type==='slab'?'바닥 두께는 0.05~2m로 지정하세요.':'벽 높이는 0.5~10m로 지정하세요.');
 if(type==='slab'){if((o.openings||[]).length)throw Error('개구부는 벽에 추가하세요.');return;}
 const f=wallFrame(o),openings=o.openings||[];if(openings.length>20)throw Error('벽마다 문·창은 20개까지입니다.');
 for(let i=0;i<openings.length;i++){
  const p=openings[i];if(!['door','window'].includes(p.kind)||![p.offset,p.width,p.height,p.sill].every(Number.isFinite)||p.offset<0||p.width<0.1||p.height<0.1||p.sill<0||p.offset+p.width>f.w+1e-6||p.sill+p.height>o.fh+1e-6||p.kind==='door'&&p.sill!==0)throw Error('문·창의 폭·높이는 0.1m 이상이며 벽 안에 있어야 합니다. 문턱 높이는 0m입니다.');
  for(let j=0;j<i;j++){const q=openings[j];if(Math.min(p.offset+p.width,q.offset+q.width)-Math.max(p.offset,q.offset)>1e-6&&Math.min(p.sill+p.height,q.sill+q.height)-Math.max(p.sill,q.sill)>1e-6)throw Error('문·창이 서로 겹칩니다.');}
 }
}
export function openingPlan(o,p){const f=wallFrame(o);return [f.at(p.offset,0),f.at(p.offset+p.width,0),f.at(p.offset+p.width,f.d),f.at(p.offset,f.d)];}
export function elementSolids(o){
 if(elementType(o)!=='wall'||!(o.openings||[]).length)return [o];
 const f=wallFrame(o),cuts=a=>[...new Set(a)].sort((a,b)=>a-b),xs=cuts([0,f.w,...o.openings.flatMap(p=>[p.offset,p.offset+p.width])]),zs=cuts([0,o.fh,...o.openings.flatMap(p=>[p.sill,p.sill+p.height])]),out=[];
 for(let i=1;i<xs.length;i++)for(let j=1;j<zs.length;j++){
  const x=(xs[i-1]+xs[i])/2,z=(zs[j-1]+zs[j])/2;
  if(o.openings.some(p=>x>p.offset&&x<p.offset+p.width&&z>p.sill&&z<p.sill+p.height))continue;
  if(xs[i]-xs[i-1]<1e-8||zs[j]-zs[j-1]<1e-8)continue;
  out.push({...o,id:o.id+'_panel_'+i+'_'+j,points:[f.at(xs[i-1],0),f.at(xs[i],0),f.at(xs[i],f.d),f.at(xs[i-1],f.d)],floors:1,fh:zs[j]-zs[j-1],base:o.base+zs[j-1],openings:[]});
 }
 return out;
}
