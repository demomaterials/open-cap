package cap

# Default branch is protected by branch protection or a ruleset.
protected if input.related.branch_protection.url

protected if count(input.related.branch_rules) > 0

default pass := false

pass if protected

skip if input.data.archived == true

skip if {
	not protected
	input.errors.branch_protection
}

skip_reason := "Repository is archived" if {
	input.data.archived == true
} else := sprintf("Branch protection could not be read: %s", [input.errors.branch_protection])

violations contains msg if {
	not protected
	msg := sprintf("Default branch '%s' has no branch protection rule or ruleset", [input.data.default_branch])
}
