package cap

# Comments must be resolved before completing a pull request.
comment_policy := "c6a1889d-b943-4856-b76f-9e46bb6b0df2"

default pass := false

pass if {
	some p in input.related.policies
	p.type.id == comment_policy
	p.isEnabled
	p.isBlocking
}

skip if input.data.isDisabled == true

skip if not input.data.defaultBranch

skip_reason := "Repository is disabled or empty"

violations contains "No blocking comment-resolution policy on the default branch" if not pass
