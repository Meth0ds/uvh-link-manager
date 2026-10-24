import { fail } from './store.mjs';
const BASE = 'https://api.github.com/repos/Meth0ds/uvh-link-manager';
export function createGithub({ fetcher = fetch, token = process.env.UVH_GITHUB_TOKEN } = {}) {
  let etag = null, latest = null, blockedUntil = 0;
  async function get(path, conditional = false) {
    if (blockedUntil > Date.now()) fail('github_rate_limit', 'GitHub ha limitado las consultas. Espera antes de volver a comprobar.', 429);
    const response = await fetcher(`${BASE}${path}`, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: {
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'UVH-Local-Recovery/1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(conditional && etag ? { 'If-None-Match': etag } : {}),
    } });
    if (response.status === 304 && latest) return latest;
    if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
      blockedUntil = Math.min(Date.now() + 3600000, Math.max(Date.now() + 60000, Number(response.headers.get('x-ratelimit-reset')) * 1000 || 0));
      fail('github_rate_limit', 'Límite de GitHub alcanzado. La aplicación sigue disponible.', 429);
    }
    if (response.status === 401 || response.status === 403) fail('github_credentials', 'GitHub rechazó las credenciales o permisos configurados.', 403);
    if (!response.ok) fail('github_unavailable', `GitHub no pudo completar la comprobación (HTTP ${response.status}).`, 503);
    if (Number(response.headers.get('content-length') ?? 0) > 2 * 1024 * 1024) fail('github_response', 'Respuesta de GitHub demasiado grande.');
    let body = '', length = 0;
    for await (const chunk of response.body) { length += chunk.length; if (length > 2 * 1024 * 1024) fail('github_response', 'Respuesta de GitHub demasiado grande.'); body += Buffer.from(chunk).toString('utf8'); }
    const result = JSON.parse(body);
    if (conditional) { etag = response.headers.get('etag'); latest = result; }
    return result;
  }
  async function check(from) {
    const candidate = await get('/commits/main', true);
    if (!/^[a-f0-9]{40}$/.test(candidate.sha ?? '')) fail('github_response', 'GitHub devolvió un commit no válido.');
    const sha = candidate.sha, checks = [];
    for (const file of ['ci.yml', 'codeql.yml', 'security.yml']) {
      const result = await get(`/actions/workflows/${file}/runs?head_sha=${sha}&branch=main&event=push&per_page=20`);
      const runs = (result.workflow_runs ?? []).filter(run => run.head_sha === sha && run.head_branch === 'main' && run.event === 'push'
        && run.repository?.full_name === 'Meth0ds/uvh-link-manager' && run.path === `.github/workflows/${file}`);
      runs.sort((a, b) => b.id - a.id);
      const run = runs[0]; let passed = false;
      if (run?.status === 'completed' && run.conclusion === 'success') {
        const jobs = await get(`/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
        passed = jobs.total_count > 0 && jobs.total_count <= 100 && jobs.jobs?.length === jobs.total_count
          && jobs.jobs.every(job => job.status === 'completed' && job.conclusion === 'success' && job.steps?.length > 0);
      }
      checks.push({ workflow: file, state: passed ? 'passed' : !run ? 'missing' : run.status !== 'completed' ? 'pending' : 'failed' });
    }
    const commits = [];
    if (from !== sha && /^[a-f0-9]{40}$/.test(from)) {
      const comparison = await get(`/compare/${from}...${sha}?per_page=100&page=1`);
      if (!['ahead', 'identical'].includes(comparison.status)) fail('github_diverged', 'El checkout no es un antecesor de main.');
      for (const commit of comparison.commits ?? []) commits.push({ sha: commit.sha, message: String(commit.commit?.message ?? '').slice(0, 1000), date: commit.commit?.committer?.date ?? null, author: String(commit.commit?.author?.name ?? '').slice(0, 120) });
      // Explicit truncation rather than claiming that one page contains every commit.
      return { from, sha, checks, eligible: checks.every(check => check.state === 'passed'), commits, totalCommits: comparison.total_commits,
        truncated: comparison.total_commits > commits.length, compareUrl: `https://github.com/Meth0ds/uvh-link-manager/compare/${from}...${sha}`, checkedAt: new Date().toISOString(), stale: false };
    }
    return { from, sha, checks, eligible: checks.every(check => check.state === 'passed'), commits, totalCommits: 0, truncated: false,
      compareUrl: null, checkedAt: new Date().toISOString(), stale: false };
  }
  return { check };
}
