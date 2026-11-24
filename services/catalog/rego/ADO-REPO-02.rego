package cap

# Pull requests into the default branch require a successful build (build validation).
build_policy := "0609b952-1397-4640-95ec-e00a01b2c241"

default pass := false

pass if {
	some p in input.related.policies
	p.type.id == build_policy
	p.isEnabled
	p.isBlocking
}

skip if input.data.isDisabled == true

skip if not input.data.defaultBranch

skip_reason := "Repository is disabled or empty"

violations contains msg if {
	not pass
	msg := sprintf("No blocking build validation policy on %s", [input.data.defaultBranch])
}
