package cap

# Force pushes to the default branch are blocked.
default pass := false

pass if input.related.branch_protection.allow_force_pushes.enabled == false

pass if {
	some rule in input.related.branch_rules
	rule.type == "non_fast_forward"
}

skip if input.data.archived == true

skip_reason := "Repository is archived"

violations contains msg if {
	not pass
	msg := sprintf("Force pushes to '%s' are not blocked", [input.data.default_branch])
}
