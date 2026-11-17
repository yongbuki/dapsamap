"""Serve the app and convert DXF to genuine R2000 DWG with LibreDWG.
Run behind HTTPS for public hosting; set CAD_ALLOWED_ORIGINS to explicit app origins.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import io
import ezdxf
import argparse
import os
import shutil
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parent.parent
LIMIT = 20 * 1024 * 1024
SLOTS = threading.BoundedSemaphore(2)

def convert(data, converter):
    if len(data) > LIMIT or b'SECTION' not in data[:4096] or b'EOF' not in data[-128:]:
        raise ValueError('Invalid or oversized DXF')
    with tempfile.TemporaryDirectory(prefix='dapsa-dwg-') as temp:
        src, dst = Path(temp)/'input.dxf', Path(temp)/'output.dwg'
        try:
            source=ezdxf.read(io.StringIO(data.decode('utf-8-sig'), newline=None))
            if not len(source.modelspace()):
                raise ValueError('DXF has no drawing entities')
            target=ezdxf.new('R2000')
            target.units=source.units or 6
            space=target.modelspace()
            for entity in source.modelspace():
                layer=entity.dxf.layer
                if layer not in target.layers:
                    color=source.layers.get(layer).dxf.color if layer in source.layers else 7
                    target.layers.new(layer,dxfattribs={'color':color})
                attrs={'layer':layer}
                kind=entity.dxftype()
                if kind == 'POLYLINE':
                    if not entity.is_2d_polyline:
                        raise ValueError('Only planar 2D polylines are supported')
                    attrs.update(elevation=entity.dxf.elevation.z,thickness=entity.dxf.thickness)
                    space.add_lwpolyline([(v.dxf.location.x,v.dxf.location.y, v.dxf.bulge) for v in entity.vertices],format='xyb',close=entity.is_closed,dxfattribs=attrs)
                elif kind == 'LWPOLYLINE':
                    attrs.update(elevation=entity.dxf.elevation,thickness=entity.dxf.thickness)
                    space.add_lwpolyline(list(entity.get_points('xyseb')),format='xyseb',close=entity.closed,dxfattribs=attrs)
                elif kind == 'TEXT':
                    attrs.update(insert=entity.dxf.insert,height=entity.dxf.height,rotation=entity.dxf.rotation)
                    space.add_text(entity.dxf.text,dxfattribs=attrs)
                elif kind == 'LINE':
                    space.add_line(entity.dxf.start,entity.dxf.end,dxfattribs=attrs)
                else:
                    raise ValueError('Unsupported DXF entity')
            for key in ['$EXTMIN','$EXTMAX']:
                if key in source.header:
                    target.header[key]=source.header[key]
            view=source.viewports.get_config('*ACTIVE')
            if view:
                target.set_modelspace_vport(height=view[0].dxf.height,center=view[0].dxf.center)
            target.saveas(src)
        except (UnicodeError, ezdxf.DXFError, ValueError) as e:
            raise ValueError('Invalid DXF') from e
        proc = subprocess.run([converter, '--as', 'r2000', '-y', '-o', str(dst), str(src)],
                              capture_output=True, timeout=60)
        # LibreDWG can report noncritical warnings; a usable output is required.
        if proc.returncode != 0 or not dst.is_file():
            raise ValueError('DXF conversion failed')
        out = dst.read_bytes()
        if len(out) < 100 or out[:6] != b'AC1015':
            raise ValueError('DWG encoder returned an invalid file')
        return out

class Handler(SimpleHTTPRequestHandler):
    converter = ''
    allowed_origins = set()
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)
    def send_data(self, status, data, content_type='text/plain; charset=utf-8'):
        self.send_response(status)
        origin = self.headers.get('Origin')
        if origin in self.allowed_origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        self.wfile.write(data)
    def do_GET(self):
        if self.path == '/api/health':
            return self.send_data(200 if self.converter else 503, b'ready' if self.converter else b'DWG converter unavailable')
        # Never expose Git metadata, server files, or directory listings.
        clean = self.path.split('?',1)[0]
        if clean != '/' and (clean.count('/') != 1 or not (clean.endswith(('.html','.mjs','.css')))):
            return self.send_data(404,b'Not found')
        super().do_GET()
    def do_OPTIONS(self):
        if self.headers.get('Origin') not in self.allowed_origins:
            return self.send_data(403,b'Origin not allowed')
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods','POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.end_headers()
    def do_POST(self):
        if self.path != '/api/dwg':
            return self.send_data(404,b'Not found')
        origin = self.headers.get('Origin')
        if origin and origin not in self.allowed_origins:
            return self.send_data(403,b'Origin not allowed')
        if not self.converter:
            return self.send_data(503,b'Install dxf2dwg on the server')
        try:
            length=int(self.headers.get('Content-Length','0'))
        except ValueError:
            return self.send_data(400,b'Invalid length')
        if not 0 < length <= LIMIT:
            return self.send_data(413,b'DXF size must be 1 byte to 20 MiB')
        if not SLOTS.acquire(blocking=False):
            return self.send_data(429,b'Converter busy; retry later')
        try:
            self.connection.settimeout(30)
            data=self.rfile.read(length)
            if len(data) != length:
                raise ValueError('Incomplete upload')
            self.send_data(200,convert(data,self.converter),'application/acad')
        except (ValueError,subprocess.TimeoutExpired,TimeoutError):
            self.send_data(422,b'Cannot convert this DXF')
        finally:
            SLOTS.release()

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--port',type=int,default=8000)
    args=parser.parse_args()
    Handler.converter=shutil.which(os.environ.get('DXF2DWG','dxf2dwg')) or ''
    Handler.allowed_origins=set(filter(None,os.environ.get('CAD_ALLOWED_ORIGINS',f'http://localhost:{args.port},http://127.0.0.1:{args.port},https://yongbuki.github.io').split(',')))
    ThreadingHTTPServer((args.host,args.port),Handler).serve_forever()
