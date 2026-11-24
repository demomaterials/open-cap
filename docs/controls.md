# Writing controls

A control has:

- a key (e.g. `GH-REPO-10`)
- a name, severity, description and remediation
- the **asset types** it applies to
- the frameworks it belongs to
- a **Rego** policy

Create and edit controls in the UI under **Controls → New control**. The editor
validates the Rego against OPA and can **test** an unsaved policy against any
collected asset before you save.

## The Rego contract

Write ordinary Rego v1 (OPA 1.x syntax: `if`, `contains`, `in`). Start with
`package cap`. The evaluator replaces that line with a unique package per
control, keeping line numbers intact so compile errors line up with the editor.

Your policy decides the result with these rules (all optional):

| Rule | Type | Meaning |
|---|---|---|
| `skip` | boolean | `true` → **skipped**: the control does not apply to this asset (e.g. archived repo). Excluded from the score. Checked first. |
| `skip_reason` | string | Shown for skipped results |
| `violations` | set of strings | Non-empty → **fail**, with these reasons |
| `pass` | boolean | `true` → **pass**, `false` → **fail** (when there are no violations) |

The evaluator applies them in this order:

1. If `skip` is true, the result is **skip**.
2. Otherwise, if `violations` is non-empty, the result is **fail**.
3. Otherwise, if `pass` is defined, it decides **pass** or **fail**.
4. Otherwise, if `violations` is an empty set, the result is **pass**.
5. Otherwise the result is **error**.

A compile error, a runtime error or a timeout is also an **error**, which counts
as unexecutable and is excluded from the score like skip.

```rego
package cap

# Repositories must require at least 2 approvals on the default branch.
skip if input.data.archived == true
skip_reason := "archived"

approvals := n if {
	n := input.related.branch_protection.required_pull_request_reviews.required_approving_review_count
}

default pass := false
pass if approvals >= 2

violations contains sprintf("only %d approval(s) required", [approvals]) if approvals < 2
violations contains "no branch protection" if not input.related.branch_protection
```

Network and non-deterministic built-ins (`http.send`, `net.lookup_ip_addr`,
`opa.runtime`, `rego.parse_module`, `time.now_ns`) are rejected.

## The input document

`input` is the **asset definition**: exactly what the asset page shows under
*Definition JSON*.

```jsonc
{
  "id": "uuid",                  // open-cap asset id
  "type": "github_repo",
  "external_id": "github:repo:123",
  "name": "acme/payments",
  "owner": "team-payments",      // derived (see below) or set manually
  "members": [{ "login": "alice", "role": "admin" }, { "team": "core", "role": "push" }],
  "parent": { "type": "github_org", "name": "acme" },
  "source": { "provider": "github", "api": "https://api.github.com", "html_url": "…" },
  "data":    { /* the provider's object, verbatim */ },
  "related": { /* further API responses, verbatim */ },
  "errors":  { /* enrichment calls that failed: name → message */ }
}
```

### github_org
- `data`: `GET /orgs/{org}`. These fields are returned only to organization
  owners: `two_factor_requirement_enabled`, `default_repository_permission`,
  `members_can_create_*`.
- `related.admins`: list of logins.
- `related.members_count`: number.
- `related.actions_permissions`: `GET /orgs/{org}/actions/permissions`.
- `owner`: first org admin.
- `members`: every member with role `admin` or `member`.

### github_repo
- `data`: `GET /repos/{owner}/{repo}`. Includes `security_and_analysis` when the
  PAT has admin.
- `related.branch_protection`: `GET …/branches/{default}/protection`. `null` if
  the branch is unprotected.
- `related.branch_rules`: `GET …/rules/branches/{default}`, the effective
  ruleset rules.
- `related.vulnerability_alerts_enabled`: boolean.
- `related.codeowners_present`: boolean.
- `related.custom_properties`: `GET …/properties/values`.
- `related.collaborators`: direct collaborators, `[{login, role}]`.
- `related.teams`: `[{slug, permission}]`.
- `owner`: the custom property `owner`, else the first team with admin
  (`team:<slug>`), else the org.

### ado_org
- `data`: `{ name, url }`.
- `related.projects`: `[{ id, name, visibility, state }]`.
- `members`: user entitlements (needs Member Entitlement Management read).

### ado_project
- `data`: `GET _apis/projects/{id}?includeCapabilities=true`.
- `related.properties`: project properties.
- `related.teams`: project teams.
- `related.repository_count`: number.
- `owner`: the project property `owner`, else the default team.

### ado_repo
- `data`: the Git repository object (`defaultBranch`, `isDisabled`, `project`,
  …).
- `related.policies`: every policy configuration that applies to the default
  branch, whether repo-scoped, prefix-scoped or project-wide. The common
  `type.id` values:

  | Policy | `type.id` |
  |---|---|
  | Minimum number of reviewers | `fa4e907d-c16b-4a4c-9dfa-4906e5d171dd` |
  | Build validation | `0609b952-1397-4640-95ec-e00a01b2c241` |
  | Comment requirements | `c6a1889d-b943-4856-b76f-9e46bb6b0df2` |
  | Work item linking | `40e92b44-2fe1-4dd6-b3d8-74a9c21d0c6e` |

### application and custom types
`data` holds whatever you registered in the UI or sent to the ingest API.

## Built-in catalog

[services/catalog](../services/catalog) ships 19 controls across 3 frameworks:

- SCM Security Baseline
- Branch Protection
- Ownership & Accountability

The backend seeds each control and framework **once**: anything that already
exists (matched by key) is left alone, so your UI edits are never overwritten.
To ship a new built-in control, add `rego/<KEY>.rego` and an entry in
`catalog.json`.

## Custom asset types

Any asset type can be added under **Assets → Register asset → New asset type**,
or implicitly through the ingest API. Controls can target it immediately. This
is how "any other means" collectors plug in:

```sh
curl -s https://cap.bupasec.com/api/assets/ingest \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '[
  { "type": "cloud_account", "external_id": "aws:123456789012", "name": "prod",
    "owner": "platform-team", "members": ["alice", "bob"],
    "data": { "mfa_enforced": true, "regions": ["eu-west-1"] } }
]'
```

Get `$TOKEN` from `POST /api/auth/login` (the response includes `token`), with
a user whose role is editor or higher.
