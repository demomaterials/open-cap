package cap

# At least one approving review is required before merging to the default branch.
approvals contains n if {
	n := input.related.branch_protection.required_pull_request_reviews.required_approving_review_count
}

approvals contains n if {
	some rule in input.related.branch_rules
	rule.type == "pull_request"
	n := rule.parameters.required_approving_review_count
}

default pass := false

pass if {
	some n in approvals
	n >= 1
}

skip if input.data.archived == true

skip_reason := "Repository is archived"

violations contains msg if {
	not pass
	msg := sprintf("Default branch '%s' does not require an approving review", [input.data.default_branch])
}
