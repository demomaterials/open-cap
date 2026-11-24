package cap

# A CODEOWNERS file exists (root, .github/ or docs/).
default pass := false

pass if input.related.codeowners_present == true

skip if input.data.archived == true

skip if not is_boolean(input.related.codeowners_present)

skip_reason := "Repository is archived" if {
	input.data.archived == true
} else := "CODEOWNERS presence could not be determined"

violations contains "Repository has no CODEOWNERS file" if {
	input.related.codeowners_present == false
}
