"""Validate handoff JSON/YAML fixtures. Requires PyYAML and jsonschema.
Run from any directory: python tests/verify_contracts.py
This validates supplied documents, not a running API implementation.
"""
from pathlib import Path
import json
import yaml
from jsonschema import Draft202012Validator, FormatChecker
ROOT=Path(__file__).resolve().parents[1]
api=yaml.safe_load((ROOT/'contracts/openapi.yaml').read_text())
Draft202012Validator.check_schema(json.loads((ROOT/'contracts/plan-draft.schema.json').read_text()))
Draft202012Validator(json.loads((ROOT/'contracts/plan-draft.schema.json').read_text())).validate(json.loads((ROOT/'examples/plan-draft.demo.json').read_text()))
for filename, schema in [('plan-request.json','PlanRequest'),('show-plan.demo.json','ShowPlan'),('capabilities.demo.json','Capabilities')]:
    composite={'$ref':f'#/components/schemas/{schema}','components':api['components']}
    Draft202012Validator(composite,format_checker=FormatChecker()).validate(json.loads((ROOT/'examples'/filename).read_text()))
    print('PASS',filename,'->',schema)
# All internal schema/parameter/response references must resolve.
def walk(value):
    if isinstance(value,dict):
        if '$ref' in value and value['$ref'].startswith('#/'):
            current=api
            for part in value['$ref'][2:].split('/'):
                current=current[part.replace('~1','/').replace('~0','~')]
        for item in value.values():walk(item)
    elif isinstance(value,list):
        for item in value:walk(item)
walk(api)
for f in ROOT.rglob('*.json'):json.loads(f.read_text())
print('PASS all JSON parse; OpenAPI internal references resolve; PlanDraft fixture validates')
