// GitHub collector (PAT). Produces github_org and github_repo assets.
import { createClient, attempt } from '../httpClient.js';
import { mapLimit } from '../../common/util.js';

function client(cfg, pat, counter) {
  return createClient({
    counter,
    headers: { authorization: `Bearer ${pat}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
}

function apiBase(cfg) {
  return (cfg.apiUrl || 'https://api.github.com').replace(/\/+$/, '');
}

async function paginate(http, url, { max = 10_000 } = {}) {
  const out = [];
  let next = url + (url.includes('?') ? '&' : '?') + 'per_page=100';
  while (next && out.length < max) {
    const { json, headers } = await http.request(next);
    out.push(...(Array.isArray(json) ? json : json?.items || []));
    const link = headers.get('link') || '';
    next = link.split(',').map((s) => s.match(/<([^>]+)>;\s*rel="next"/)).find(Boolean)?.[1] || null;
  }
  return out;
}

export async function testConnection(cfg, pat) {
  const http = client(cfg, pat, { calls: 0 });
  const base = apiBase(cfg);
  const me = await http.request(`${base}/user`);
  const scopes = me.headers.get('x-oauth-scopes');
  const target = await attempt(() => http.request(`${base}/orgs/${encodeURIComponent(cfg.org)}`));
  let kind = 'organization';
  if (target[1]) {
    const user = await attempt(() => http.request(`${base}/users/${encodeURIComponent(cfg.org)}`));
    if (user[1]) throw new Error(`cannot read '${cfg.org}' as an organization or user: ${target[1]}`);
    kind = 'user';
  }
  return {
    ok: true,
    identity: me.json.login,
    detail: `Authenticated as ${me.json.login}; '${cfg.org}' is ${kind === 'user' ? 'a user' : 'an organization'}` + (scopes ? `; token scopes: ${scopes}` : ' (fine-grained token)'),
  };
}

/**
 * collect({ cfg, pat, scope, emit, counter })
 *   scope: null (everything) | { repo: "<name>" } | { org: true }
 *   emit(asset, { parentKey }) persists an asset; returns its id.
 */
export async function collect({ cfg, pat, scope, emit, counter }) {
  const http = client(cfg, pat, counter);
  const base = apiBase(cfg);
  const login = cfg.org;
  const source = { provider: 'github', api: base };
  let errorsSeen = 0;

  const [orgObj, orgErr] = await attempt(() => http.request(`${base}/orgs/${encodeURIComponent(login)}`));
  const isOrg = !orgErr;
  if (orgErr) {
    // Fall back to a user account (no org asset).
    await http.request(`${base}/users/${encodeURIComponent(login)}`);
  }

  let orgKey = null;
  if (isOrg && (!scope || scope.org)) {
    const org = orgObj.json;
    const errors = {};
    const [admins, adminErr] = await attempt(() => paginate(http, `${base}/orgs/${login}/members?role=admin`));
    const [members, memberErr] = await attempt(() => paginate(http, `${base}/orgs/${login}/members?role=member`));
    const [actions, actionsErr] = await attempt(async () => (await http.request(`${base}/orgs/${login}/actions/permissions`)).json);
    if (adminErr) errors.admins = adminErr;
    if (memberErr) errors.members = memberErr;
    if (actionsErr) errors.actions_permissions = actionsErr;
    errorsSeen += Object.keys(errors).length;
    const people = [
      ...(admins || []).map((m) => ({ login: m.login, role: 'admin' })),
      ...(members || []).map((m) => ({ login: m.login, role: 'member' })),
    ];
    const asset = {
      type: 'github_org',
      external_id: `github:org:${org.id}`,
      name: org.login,
      owner: admins?.[0]?.login ?? org.login,
      members: people,
      source,
      data: org,
      related: { admins: (admins || []).map((m) => m.login), members_count: people.length, actions_permissions: actions },
      errors,
    };
    orgKey = `${asset.type}:${asset.external_id}`;
    await emit(asset);
  } else if (isOrg) {
    orgKey = `github_org:github:org:${orgObj.json.id}`;
  }

  if (scope?.org) return { errors: errorsSeen };

  let repos;
  if (scope?.repo) {
    repos = [(await http.request(`${base}/repos/${encodeURIComponent(login)}/${encodeURIComponent(scope.repo)}`)).json];
  } else if (isOrg) {
    repos = await paginate(http, `${base}/orgs/${login}/repos?type=all`);
  } else {
    const me = (await http.request(`${base}/user`)).json;
    repos = me.login.toLowerCase() === login.toLowerCase()
      ? await paginate(http, `${base}/user/repos?affiliation=owner`)
      : await paginate(http, `${base}/users/${login}/repos?type=owner`);
  }

  const filter = cfg.repoFilter ? new RegExp(cfg.repoFilter, 'i') : null;
  repos = repos.filter((r) => (!filter || filter.test(r.name)) && (cfg.includeArchived !== false || !r.archived));
  const collectAccess = cfg.collectAccess !== false;

  await mapLimit(repos, Number(cfg.concurrency || 4), async (listed) => {
    const full = `${listed.owner.login}/${listed.name}`;
    const r = `${base}/repos/${full}`;
    const errors = {};
    const related = {};

    const [repo] = await attempt(async () => (await http.request(r)).json);
    const data = repo || listed;
    const branch = encodeURIComponent(data.default_branch || 'main');

    const opt = async (key, fn) => {
      const [v, e] = await attempt(fn);
      if (e) errors[key] = e;
      return v;
    };

    related.branch_protection = await opt('branch_protection', async () => {
      const res = await http.request(`${r}/branches/${branch}/protection`, { accept: [200, 404] });
      return res.status === 200 ? res.json : null;
    });
    related.branch_rules = await opt('branch_rules', async () => {
      const res = await http.request(`${r}/rules/branches/${branch}?per_page=100`, { accept: [200, 404] });
      return res.status === 200 ? res.json : [];
    });
    related.vulnerability_alerts_enabled = await opt('vulnerability_alerts', async () => {
      const res = await http.request(`${r}/vulnerability-alerts`, { accept: [204, 404] });
      return res.status === 204;
    });
    related.codeowners_present = await opt('codeowners', async () => {
      if (data.size === 0) return false;
      const res = await http.request(`${r}/codeowners/errors`, { accept: [200, 404] });
      return res.status === 200;
    });
    related.custom_properties = isOrg
      ? await opt('custom_properties', async () => (await http.request(`${r}/properties/values`)).json)
      : [];
    if (collectAccess) {
      related.collaborators = await opt('collaborators', async () =>
        (await paginate(http, `${r}/collaborators?affiliation=direct`)).map((c) => ({ login: c.login, role: c.role_name })));
      related.teams = isOrg
        ? await opt('teams', async () => (await paginate(http, `${r}/teams`)).map((t) => ({ slug: t.slug, permission: t.permission })))
        : [];
    }
    errorsSeen += Object.keys(errors).length;

    const ownerProp = (related.custom_properties || []).find((p) => p.property_name?.toLowerCase() === 'owner' && p.value);
    const adminTeam = (related.teams || []).find((t) => t.permission === 'admin');
    const members = [
      ...(related.collaborators || []).map((c) => ({ login: c.login, role: c.role })),
      ...(related.teams || []).map((t) => ({ team: t.slug, role: t.permission })),
    ];

    await emit({
      type: 'github_repo',
      external_id: `github:repo:${data.id}`,
      name: data.full_name,
      owner: (ownerProp && String(ownerProp.value)) || (adminTeam && `team:${adminTeam.slug}`) || data.owner?.login,
      members,
      parent: isOrg ? { type: 'github_org', name: login } : null,
      source: { ...source, html_url: data.html_url },
      data,
      related,
      errors,
    }, { parentKey: orgKey });
  });

  return { errors: errorsSeen, partial: Boolean(scope) };
}
