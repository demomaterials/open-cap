package cap

# Base (default) repository permission for members is read or none.
allowed := {"read", "none"}

default pass := false

pass if input.data.default_repository_permission in allowed

skip if not is_string(input.data.default_repository_permission)

skip_reason := "default_repository_permission is only returned to organization owners"

violations contains msg if {
	not input.data.default_repository_permission in allowed
	is_string(input.data.default_repository_permission)
	msg := sprintf("Base repository permission is '%s' (expected read or none)", [input.data.default_repository_permission])
}
