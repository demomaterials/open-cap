package cap

# Members cannot create public repositories.
default pass := false

pass if input.data.members_can_create_public_repositories == false

skip if not is_boolean(input.data.members_can_create_public_repositories)

skip_reason := "members_can_create_public_repositories is only returned to organization owners"

violations contains "Organization members can create public repositories" if {
	input.data.members_can_create_public_repositories == true
}
