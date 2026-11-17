# DWG conversion server

The app's CAD drawing, BIM model, DXF, IFC and quantities work as a static website.
Binary DWG encoding requires this service. GitHub Pages cannot run it.
The service receives a DXF, normalizes its tables with ezdxf, and uses LibreDWG 0.14
to write AutoCAD 2000 (AC1015). Geometry/layer readback is covered by tests.
This is an experimental encoder; AutoCAD/ODA application compatibility is not certified.
It exports drawing geometry, not native Revit RVT projects or editable BIM relations in DWG.

Run from the checkout root on a Linux host with Python 3, GCC, Make and curl:

```sh
bash scripts/install-dwg.sh /workspace/.dapsamap-tools/libredwg
python -m venv /workspace/.dapsamap-tools/cad-venv
/workspace/.dapsamap-tools/cad-venv/bin/pip install -r server/requirements.txt
DXF2DWG=/workspace/.dapsamap-tools/libredwg/bin/dxf2dwg \
  /workspace/.dapsamap-tools/cad-venv/bin/python server/cad_server.py --port 8000
```

Use a persistent process manager for hosting; put the service behind your HTTPS reverse
proxy. To accept proxy connections bind using `--host 0.0.0.0`. Set
`CAD_ALLOWED_ORIGINS=https://yongbuki.github.io,https://your-app.example` to the exact
allowed origins (without trailing slash), preserving origins actually in use.
Do not point the frontend at a short-lived development session.
The server accepts at most two conversions concurrently, 20 MiB ASCII DXF inputs,
and gives each converter process 60 seconds. Temporary drawings are deleted after a request.
It serves only root-level app HTML, JavaScript modules and CSS; Git and backend source are blocked.
`GET /api/health` returns `ready` if dxf2dwg is available.

When the app is served by this server it uses `/api/dwg` automatically. For GitHub
Pages, deploy this service on your host and use **DWG 서버 설정** in the app to enter
`https://your-server.example/api/dwg`. Drawing data is sent to this configured server.
A deployment account/host has not been provisioned by this change.

Tests (the readback package is a test dependency, not included in the website):

```sh
npm install --no-save --package-lock=false playwright@1.58.2 @mlightcad/libredwg-web@0.9.0
DXF2DWG=/path/to/dxf2dwg node tests/dwg.cjs
```

The converter is GNU LibreDWG (GPL-3.0-or-later); upstream source and license are at
https://github.com/LibreDWG/libredwg/tree/0.14. The installer downloads that source
and checks its pinned SHA-256 before building. No third-party binary is committed.
