package cap

# No project in the Azure DevOps organization is public.
public_projects contains p.name if {
	some p in input.related.projects
	p.visibility == "public"
}

default pass := false

pass if count(public_projects) == 0

violations contains sprintf("Project '%s' is public", [name]) if some name in public_projects
