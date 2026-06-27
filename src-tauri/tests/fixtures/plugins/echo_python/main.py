import json

capability = __weave_capability__
params = json.loads(__weave_params__)

result = {
    "capability": capability,
    "message": params.get("message", ""),
}
