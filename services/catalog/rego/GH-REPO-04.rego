package cap

# Dependabot vulnerability alerts are enabled.
default pass := false

pass if input.related.vulnerability_alerts_enabled == true

skip if input.data.archived == true

skip if not is_boolean(input.related.vulnerability_alerts_enabled)

skip_reason := "Repository is archived" if {
	input.data.archived == true
} else := "Vulnerability alert status could not be read (PAT needs admin on the repository)"

violations contains "Dependabot vulnerability alerts are disabled" if {
	input.related.vulnerability_alerts_enabled == false
}
