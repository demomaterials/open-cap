package cap

# Repositories are not public unless explicitly approved with the topic "public-approved".
default pass := false

pass if input.data.visibility != "public"

pass if "public-approved" in input.data.topics

violations contains "Repository is public without the 'public-approved' topic" if not pass
