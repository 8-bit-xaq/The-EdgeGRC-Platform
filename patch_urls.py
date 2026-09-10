import re
with open("grc-backend/frameworks/urls.py", "r") as f:
    content = f.read()

# Add imports
if "JobStatusView" not in content:
    content = content.replace(
        "from .views import (",
        "from .views import (\n    JobStatusView,\n    JobDownloadView,"
    )

# Add paths
if "jobs/<str:task_id>/status/" not in content:
    paths = """
    path('jobs/<str:task_id>/status/', JobStatusView.as_view()),
    path('jobs/<str:task_id>/download/', JobDownloadView.as_view()),
]
"""
    content = content.replace("]", paths, 1)

with open("grc-backend/frameworks/urls.py", "w") as f:
    f.write(content)
