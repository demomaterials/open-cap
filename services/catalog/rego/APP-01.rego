package cap

# Application has an accountable owner.
default pass := false

pass if {
	is_string(input.owner)
	trim_space(input.owner) != ""
}

violations contains "Application has no owner" if not pass
