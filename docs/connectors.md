# Connectors

A connector is one GitHub organization (or user) or one Azure DevOps
organization, plus a PAT. Admins add connectors under **Connectors → Add
connector**. The PAT is verified with **Test connection**, encrypted at rest,
and never returned by the API. The first full collection starts when the
connector is created. Afterwards it runs every *schedule* minutes (default 6 h)
and on every webhook delivery.

## GitHub

| Setting | Notes |
|---|---|
| Organization or user | An org login. A user login also works: user repos are collected, and no org asset is created. |
| API URL | Default `https://api.github.com`. For GitHub Enterprise Server use `https://<host>/api/v3`. |
| Repository filter | Optional regex on the repository name |
| Include archived | Archived repos are collected but skipped by most controls |
| Collect collaborators & teams | 2 extra calls per repo; used for members and owner |

**PAT permissions** (read-only is enough):

- **Classic token:**
  - `repo` for private repos, branch protection and vulnerability alerts.
  - `read:org` for members and teams.
  - To see the org security settings (2FA requirement, base permission,
    repo-creation policy), the token owner must be an **organization owner**.
    Otherwise those controls are skipped.
- **Fine-grained token** on the organization, all repositories, read-only:
  - Repository permissions: Administration, Contents, Metadata, Custom
    properties, Dependabot alerts, Secret scanning alerts.
  - Organization permissions: Members, Administration.

Branch protection on private repos needs GitHub Team/Enterprise. On the Free
plan the API returns 403. open-cap records that in `errors.branch_protection`,
and GH-REPO-01 then *skips* instead of failing.

**API cost:** about 8 calls per repository per full run. A 5,000-repo org
needs about 40k calls, which is more than one PAT's hourly limit. Raise the
schedule interval, rely on webhooks, or split the org across connectors with
repository filters.

**Webhook:** Organization settings → Webhooks → Add webhook.
- Payload URL: `https://cap.bupasec.com/webhooks/github/<connector-id>`. It is
  shown on the connector page.
- Content type: `application/json`.
- Secret: from the connector page (*Reveal secret*).
- Events: *Repositories, Branch protection rules, Repository rulesets, Pushes,
  Members, Teams, Organizations*. "Send me everything" also works.

A repository event triggers a scoped run for that one repository. An
organization or member event re-collects the org asset. A `repository.deleted`
event removes the asset immediately.

## Azure DevOps

| Setting | Notes |
|---|---|
| Organization | The `dev.azure.com/<organization>` name |
| Base URL | Default `https://dev.azure.com`. For Azure DevOps Server use `https://<host>/<collection-path>`. |
| Project filter | Optional regex on the project name |

**PAT scopes:**
- Code (Read): repositories and branch policies.
- Project and Team (Read).
- Member Entitlement Management (Read): optional, for org members.

**Service hook:** Project settings → Service hooks → Web Hooks.
- URL: `https://cap.bupasec.com/webhooks/ado/<connector-id>`.
- Basic authentication: any username, with the connector's webhook secret as
  the password. Alternatively add the HTTP header
  `X-CAP-Webhook-Secret: <secret>`.
- Events: *Code pushed*, *Repository created / renamed / status changed /
  deleted*. Add more for policy changes if your org supports them. The
  scheduled run catches policy edits anyway.

## Runs

Each run records:
- assets seen, created, changed and removed;
- enrichment errors and API calls;
- duration and the error message if it failed.

Runs are listed on the connector page and on the Connectors page. A failed run
leaves existing assets untouched. Only a **successful full** run removes assets
that disappeared upstream.
