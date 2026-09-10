import requests
import json
url = "http://127.0.0.1:8000/api/controls/PCI-1.1.1/proofs/"
with open("test.txt", "w") as f: f.write("test data")
# We need an auth token or bypass auth.
# Since we are outside, we can't easily authenticate.
