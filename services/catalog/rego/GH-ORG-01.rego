package cap

# Organization requires two-factor authentication for all members.
default pass := false

pass if input.data.two_factor_requirement_enabled == true

skip if not is_boolean(input.data.two_factor_requirement_enabled)

skip_reason := "two_factor_requirement_enabled is only returned to organization owners; use an owner PAT with admin:org read"

violations contains "Organization does not require two-factor authentication" if {
	input.data.two_factor_requirement_enabled == false
}
