import json

with open("grc-frontend/package.json", "r") as f:
    pkg = json.load(f)

pkg["dependencies"]["react-hook-form"] = "^7.54.2"
pkg["dependencies"]["zod"] = "^3.24.2"
pkg["dependencies"]["@hookform/resolvers"] = "^3.10.0"

with open("grc-frontend/package.json", "w") as f:
    json.dump(pkg, f, indent=2)
