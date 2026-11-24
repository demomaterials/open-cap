package cap

# Repository declares an accountable owner in the custom property "owner".
owner_values contains v if {
	some p in input.related.custom_properties
	lower(p.property_name) == "owner"
	v := p.value
	is_string(v)
	trim_space(v) != ""
}

default pass := false

pass if count(owner_values) > 0

skip if input.data.archived == true

skip_reason := "Repository is archived"

violations contains "Repository has no 'owner' custom property" if not pass
