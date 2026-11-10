"""Usage: python tests/validate_ifc.py file.ifc [IfcOpenShell package directory]."""
import sys
if len(sys.argv) > 2:
    sys.path.insert(0, sys.argv[2])
import ifcopenshell
import ifcopenshell.validate
import ifcopenshell.geom
import ifcopenshell.util.shape
import ifcopenshell.util.unit

model = ifcopenshell.open(sys.argv[1])
assert model.schema == 'IFC4'
logger = ifcopenshell.validate.json_logger()
ifcopenshell.validate.validate(model, logger, express_rules=True)
assert not logger.statements, '\n'.join(str(s.get('message')) for s in logger.statements)
assert ifcopenshell.util.unit.calculate_unit_scale(model) == 1
assert len(model.by_type('IfcWall')) == 4
assert len(model.by_type('IfcSlab')) == 2
assert len(model.by_type('IfcDoor')) == 1
assert len(model.by_type('IfcWindow')) == 1
assert len(model.by_type('IfcRelVoidsElement')) == 2
assert len(model.by_type('IfcRelFillsElement')) == 2
wall = next(w for w in model.by_type('IfcWall') if w.Name == "남쪽 벽 O'Brien")
shape = ifcopenshell.geom.create_shape(ifcopenshell.geom.settings(), wall)
expected = 6 * .2 * 3 - .9 * 2.1 * .2 - 1.2 * 1.2 * .2
assert abs(ifcopenshell.util.shape.get_volume(shape.geometry) - expected) < 1e-6
roots = model.by_type('IfcRoot')
assert len({x.GlobalId for x in roots}) == len(roots)
assert model.by_type('IfcWindow')[0].FillsVoids[0].RelatingOpeningElement.VoidsElements[0].RelatingBuildingElement == wall
print('PASS: IFC4 schema + EXPRESS rules, units, spatial structure, hosted openings, Unicode, unique IDs and exact wall geometry')
