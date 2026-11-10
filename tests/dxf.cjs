// Validate the production DXF writer with an independent CAD parser.
// Requires Python ezdxf: python -m pip install ezdxf
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('function dxfText('), html.indexOf('async function exportDXF('));
const writeDXF = new Function(`${source}; return dxfText;`)();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dapsamap-dxf-'));
try {
  const entities = [
    {t:'pl', layer:'BUILDINGS', pts:[[200000,300000],[200040,300000],[200040,300020],[200000,300020]], z:50, th:12, closed:true},
    {t:'pl', layer:'CONTOURS', pts:[[199980,299980],[200050,300030]], z:45},
    {t:'tx', layer:'LABELS', x:200010, y:300010, h:1.5, s:'4F'},
    {t:'pl', layer:'BUILDINGS', pts:[[NaN,0],[0,Infinity]]},
  ];
  fs.writeFileSync(path.join(dir,'map.dxf'), writeDXF(entities, [['BUILDINGS',7],['CONTOURS',30],['LABELS',3]],6));
  fs.writeFileSync(path.join(dir,'empty.dxf'), writeDXF([], []));
  fs.writeFileSync(path.join(dir,'sheet.dxf'), writeDXF([{t:'pl',layer:'CUT',pts:[[0,-300],[600,-300],[600,0]],closed:true}], [['CUT',1]],4));
  const r = spawnSync('python', ['-c', `
import sys, math
from pathlib import Path
import ezdxf
root = Path(sys.argv[1])
for name in ['map', 'empty', 'sheet']:
    doc = ezdxf.readfile(root / (name + '.dxf'))
    audit = doc.audit()
    assert not audit.errors, (name, audit.errors)
    assert not audit.fixes, (name, audit.fixes)
    view = doc.viewports.get_config('*ACTIVE')[0]
    cx, cy = view.dxf.center.x, view.dxf.center.y
    h, w = view.dxf.height, view.dxf.height * view.dxf.aspect_ratio
    assert all(math.isfinite(v) for v in [cx,cy,h,w]) and h > 0
    for entity in doc.modelspace().query('POLYLINE'):
        for point in entity.points():
            assert abs(point.x-cx) <= w/2 + 1e-6, (name,point,view.dxf.center)
            assert abs(point.y-cy) <= h/2 + 1e-6
    if name == 'map':
        assert len(doc.modelspace()) == 3
        building = doc.modelspace().query('POLYLINE[layer=="BUILDINGS"]')[0]
        assert building.is_closed and building.dxf.elevation.z == 50
        assert building.dxf.thickness == 12
        assert doc.header['$EXTMIN'] == (199980,299980,0)
        assert doc.header['$EXTMAX'] == (200050,300030,62)
    print('PASS: DXF', name, 'parser, audit, opening viewport and geometry')
`, dir], {encoding:'utf8'});
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  if(r.error) throw r.error;
  assert.equal(r.status, 0, 'independent DXF validation failed');
} finally { fs.rmSync(dir, {recursive:true, force:true}); }
