package cap

# Default branch requires at least one reviewer (enabled, blocking policy).
min_reviewers := "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"

default pass := false

pass if {
	some p in input.related.policies
	p.type.id == min_reviewers
	p.isEnabled
	p.isBlocking
	p.settings.minimumApproverCount >= 1
}

skip if input.data.isDisabled == true

skip if not input.data.defaultBranch

skip_reason := "Repository is disabled" if {
	input.data.isDisabled == true
} else := "Repository is empty (no default branch)"

violations contains msg if {
	not pass
	msg := sprintf("No blocking 'Minimum number of reviewers' policy on %s", [input.data.defaultBranch])
}
