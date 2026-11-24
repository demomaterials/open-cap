package cap

# Secret scanning is enabled.
default pass := false

pass if input.data.security_and_analysis.secret_scanning.status == "enabled"

skip if input.data.archived == true

skip if not input.data.security_and_analysis.secret_scanning.status

skip_reason := "Repository is archived" if {
	input.data.archived == true
} else := "security_and_analysis is not visible to this PAT (needs admin) or not available on this plan"

violations contains "Secret scanning is disabled" if {
	input.data.security_and_analysis.secret_scanning.status == "disabled"
}
