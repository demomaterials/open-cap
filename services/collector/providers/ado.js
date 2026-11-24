// Azure DevOps collector (PAT). Produces ado_org, ado_project and ado_repo assets.
import { createClient, attempt } from '../httpClient.js';
import { mapLimit } from '../../common/util.js';

const API = 'api-version=7.1';

function client(pat, counter) {
  return createClient({
    counter,
    headers: { authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}` },
  });
}

function orgBase(cfg) {
  return `${(cfg.baseUrl || 'https://dev.azure.com').replace(/\/+$/, '')}/${encodeURIComponent(cfg.organization)}`;
}

/** ADO list endpoints page with the x-ms-continuationtoken header. */
async function list(http, url, { max = 10_000 } = {}) {
  const out = [];
  let token = null;
  do {
    const u = token ? `${url}&continuationToken=${encodeURIComponent(token)}` : url;
    const { json, headers } = await http.request(u);
    out.push(...(json?.value || []));
    token = headers.get('x-ms-continuationtoken');
  } while (token && out.length < max);
  return out;
}

export async function testConnection(cfg, pat) {
  const http = client(pat, { calls: 0 });
  const projects = await list(http, `${orgBase(cfg)}/_apis/projects?${API}&$top=100`);
  return { ok: true, detail: `Organization '${cfg.organization}' reachable; ${projects.length} project(s) visible to this PAT` };
}

function policyApplies(policy, repo) {
  const scopes = policy.settings?.scope;
  if (!Array.isArray(scopes) || scopes.length === 0) return true; // project-wide
  return scopes.some((s) => {
    if (s.repositoryId && s.repositoryId !== repo.id) return false;
    if (!s.refName) return true;
    if (s.matchKind?.toLowerCase() === 'prefix') return (repo.defaultBranch || '').startsWith(s.refName);
    return s.refName === repo.defaultBranch;
  });
}

export async function collect({ cfg, pat, scope, emit, counter }) {
  const http = client(pat, counter);
  const base = orgBase(cfg);
  const source = { provider: 'ado', api: base };
  let errorsSeen = 0;

  const projectFilter = cfg.projectFilter ? new RegExp(cfg.projectFilter, 'i') : null;
  let projects = await list(http, `${base}/_apis/projects?${API}&$top=500&stateFilter=wellFormed`);
  const allProjects = projects;
  projects = projects.filter((p) => !projectFilter || projectFilter.test(p.name));
  if (scope?.project) projects = projects.filter((p) => p.id === scope.project || p.name === scope.project);

  const orgAsset = {
    type: 'ado_org',
    external_id: `ado:org:${cfg.organization.toLowerCase()}`,
    name: cfg.organization,
    source,
    data: { name: cfg.organization, url: base },
    related: { projects: allProjects.map((p) => ({ id: p.id, name: p.name, visibility: p.visibility, state: p.state })) },
    errors: {},
    members: [],
    owner: null,
  };
  const orgKey = `${orgAsset.type}:${orgAsset.external_id}`;
  if (!scope) {
    if (!cfg.baseUrl || /dev\.azure\.com/.test(cfg.baseUrl)) {
      const [ents, e] = await attempt(async () => (await http.request(
        `https://vsaex.dev.azure.com/${encodeURIComponent(cfg.organization)}/_apis/userentitlements?api-version=7.1-preview.3&$top=1000`)).json);
      if (e) orgAsset.errors.members = e;
      const items = ents?.items || ents?.members || [];
      orgAsset.members = items.map((u) => ({
        login: u.user?.principalName, name: u.user?.displayName, role: u.accessLevel?.licenseDisplayName,
      }));
    }
    errorsSeen += Object.keys(orgAsset.errors).length;
    await emit(orgAsset);
  }

  await mapLimit(projects, Number(cfg.concurrency || 3), async (p) => {
    const pBase = `${base}/${encodeURIComponent(p.id)}`;
    const errors = {};
    const opt = async (key, fn) => {
      const [v, e] = await attempt(fn);
      if (e) errors[key] = e;
      return v;
    };
    const project = (await opt('project', async () =>
      (await http.request(`${base}/_apis/projects/${p.id}?includeCapabilities=true&${API}`)).json)) || p;
    const properties = await opt('properties', async () =>
      (await http.request(`${base}/_apis/projects/${p.id}/properties?api-version=7.1-preview.1`)).json?.value);
    const teams = await opt('teams', async () => list(http, `${base}/_apis/projects/${p.id}/teams?${API}&$top=500`));
    const policies = (await opt('policies', async () => list(http, `${pBase}/_apis/policy/configurations?${API}&$top=1000`))) || [];
    const repos = (await opt('repositories', async () =>
      (await http.request(`${pBase}/_apis/git/repositories?${API}`)).json?.value)) || [];
    errorsSeen += Object.keys(errors).length;

    const projectKey = `ado_project:ado:project:${project.id}`;
    const ownerProp = (properties || []).find((x) => x.name?.toLowerCase() === 'owner');
    if (!scope?.repo) {
      await emit({
        type: 'ado_project',
        external_id: `ado:project:${project.id}`,
        name: `${cfg.organization}/${project.name}`,
        owner: ownerProp?.value || project.defaultTeam?.name || null,
        members: (teams || []).map((t) => ({ team: t.name })),
        parent: { type: 'ado_org', name: cfg.organization },
        source: { ...source, web_url: `${base}/${encodeURIComponent(project.name)}` },
        data: project,
        related: { properties: properties || [], teams: (teams || []).map((t) => ({ id: t.id, name: t.name })), repository_count: repos.length },
        errors,
      }, { parentKey: scope ? null : orgKey });
    }

    for (const repo of repos) {
      if (scope?.repo && repo.id !== scope.repo && repo.name !== scope.repo) continue;
      await emit({
        type: 'ado_repo',
        external_id: `ado:repo:${repo.id}`,
        name: `${cfg.organization}/${project.name}/${repo.name}`,
        owner: ownerProp?.value || project.defaultTeam?.name || null,
        members: [],
        parent: { type: 'ado_project', name: `${cfg.organization}/${project.name}` },
        source: { ...source, web_url: repo.webUrl },
        data: repo,
        related: { policies: policies.filter((pol) => pol.isDeleted !== true && policyApplies(pol, repo)) },
        errors: errors.policies ? { policies: errors.policies } : {},
      }, { parentKey: projectKey });
    }
  });

  return { errors: errorsSeen, partial: Boolean(scope) };
}
