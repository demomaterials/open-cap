package cap

# Application has at least two members (no single point of knowledge).
default pass := false

pass if count(input.members) >= 2

violations contains sprintf("Application has %d member(s); at least 2 required", [count(input.members)]) if not pass
