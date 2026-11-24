package cap

# PR authors cannot approve their own changes.
min_reviewers := "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"

reviewer_policies contains p if {
	some p in input.related.policies
	p.type.id == min_reviewers
	p.isEnabled
}

default pass := false

pass if {
	count(reviewer_policies) > 0
	every p in reviewer_policies {
		p.settings.creatorVoteCounts == false
	}
}

skip if input.data.isDisabled == true

skip if not input.data.defaultBranch

skip_reason := "Repository is disabled or empty"

violations contains "No reviewer policy on the default branch" if count(reviewer_policies) == 0

violations contains "Reviewer policy lets the PR author's vote count" if {
	some p in reviewer_policies
	p.settings.creatorVoteCounts == true
}
