// DWG encoding runs on an explicitly configured converter service. Never relabel DXF as DWG.
export async function dxfToDWG(dxf){
  let endpoint='';try{endpoint=localStorage.getItem('dapsa3d.dwgEndpoint')||'';}catch{}
  if(!endpoint&&location.hostname.endsWith('github.io'))throw Error('DWG 변환 서버가 연결되지 않았어요. DWG 서버 설정에서 배포한 서버 주소를 입력하세요.');
  const url=new URL(endpoint||'/api/dwg',location.href);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('DWG 서버는 HTTPS 주소를 사용하세요.');
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),65000);
  try{
    const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/dxf'},body:dxf,signal:ctl.signal,credentials:'omit'});
    if(!res.ok)throw Error('DWG 변환 서버에 연결하지 못했어요. DWG 서버 설정을 확인하세요. (HTTP '+res.status+')');
    const bytes=new Uint8Array(await res.arrayBuffer());
    if(bytes.length<100||!/^AC10\d{2}$/.test(new TextDecoder().decode(bytes.slice(0,6))))throw Error('서버가 유효한 DWG 파일을 반환하지 않았어요. DXF로 저장한 뒤 AutoCAD에서 다른 이름으로 저장할 수도 있습니다.');
    return bytes;
  }finally{clearTimeout(timer);}
}
export function configureDWG(){
  let old='';try{old=localStorage.getItem('dapsa3d.dwgEndpoint')||'';}catch{}
  const value=prompt('DWG 변환 서버의 HTTPS 주소를 입력하세요. 예: https://서버주소/api/dwg\n같은 서버에서 실행하면 빈칸을 사용합니다. 파일은 이 서버로 전송됩니다.',old);
  if(value===null)return;
  if(value.trim()){const u=new URL(value.trim());if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('HTTPS 주소를 입력하세요.');}
  localStorage.setItem('dapsa3d.dwgEndpoint',value.trim());
}
