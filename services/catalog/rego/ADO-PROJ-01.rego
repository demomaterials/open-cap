package cap

# Azure DevOps project visibility is private.
default pass := false

pass if input.data.visibility == "private"

violations contains sprintf("Project visibility is '%s'", [input.data.visibility]) if not pass
