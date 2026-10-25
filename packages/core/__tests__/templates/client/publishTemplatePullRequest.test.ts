// Tests the GitHub fork-to-pull-request flow against a recording fake fetch.
import { GitHubError, publishTemplatePullRequest } from '../../../src/templates/client';

type Reply = [status: number, body: unknown];
type Handler = Reply | ((body: any) => Reply);

interface Call {
  method: string;
  path: string;
  body: any;
  headers: Record<string, string>;
}

function fakeGitHub(overrides: Record<string, Handler | Handler[]> = {}) {
  const calls: Call[] = [];
  const routes: Record<string, Handler | Handler[]> = {
    'POST /repos/labshelf/templates/forks': [202, { full_name: 'ana/templates' }],
    'GET /repos/ana/templates': [200, { full_name: 'ana/templates' }],
    'POST /repos/ana/templates/merge-upstream': [200, { message: 'ok' }],
    'GET /repos/ana/templates/git/ref/heads/main': [200, { object: { sha: 'base-sha' } }],
    'GET /repos/ana/templates/git/commits/base-sha': [200, { tree: { sha: 'base-tree' } }],
    'POST /repos/ana/templates/git/blobs': (b) => [201, { sha: `blob-${b.content}` }],
    'POST /repos/ana/templates/git/trees': [201, { sha: 'new-tree' }],
    'POST /repos/ana/templates/git/commits': [201, { sha: 'new-commit' }],
    'POST /repos/ana/templates/git/refs': [201, {}],
    'POST /repos/labshelf/templates/pulls': [201, { html_url: 'https://github.com/labshelf/templates/pull/7' }],
    ...overrides,
  };
  const fetch = async (url: string, init: any = {}) => {
    const method = init.method ?? 'GET';
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, headers: { ...init.headers } });
    const route = routes[`${method} ${path}`];
    let handler: Handler | undefined;
    if (Array.isArray(route) && typeof route[0] !== 'number') {
      // A list of handlers is consumed in order; the last one repeats.
      const list = route as Handler[];
      handler = list.length > 1 ? list.shift() : list[0];
    } else {
      handler = route as Handler | undefined;
    }
    if (!handler) return new Response('{"message":"Not Found"}', { status: 404 });
    const [status, payload] = typeof handler === 'function' ? handler(body) : handler;
    return new Response(JSON.stringify(payload), { status });
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const binary = new Uint8Array([0, 255, 128, 1]);

function run(fake: { fetch: typeof globalThis.fetch }, sleep = jest.fn(async () => {})) {
  return {
    sleep,
    promise: publishTemplatePullRequest({
      fetch: fake.fetch,
      token: 'tok',
      upstream: { owner: 'labshelf', repo: 'templates' },
      templateId: 'thesis',
      files: [
        { path: 'template.yaml', bytes: new TextEncoder().encode('id: thesis') },
        { path: 'files/logo.png', bytes: binary },
      ],
      title: 'Add thesis',
      body: 'A thesis template',
      now: () => new Date('2026-03-09T23:59:00Z'),
      sleep,
    }),
  };
}

const forkMissing: Record<string, Handler | Handler[]> = {
  'GET /repos/ana/templates': [[404, { message: 'Not Found' }], [200, { full_name: 'ana/templates' }]],
};

describe('publishTemplatePullRequest', () => {
  it('forks, commits under templates/<id>/ and returns the pull request url', async () => {
    const fake = fakeGitHub(forkMissing);
    const { promise } = run(fake);
    await expect(promise).resolves.toEqual({
      url: 'https://github.com/labshelf/templates/pull/7',
      branch: 'template/thesis-2026-03-09',
    });
    const order = fake.calls.map((c) => `${c.method} ${c.path}`);
    const idx = (s: string) => order.indexOf(s);
    expect(order[0]).toBe('POST /repos/labshelf/templates/forks');
    expect(idx('POST /repos/ana/templates/merge-upstream')).toBeGreaterThan(idx('POST /repos/labshelf/templates/forks'));
    const chain = [
      'POST /repos/ana/templates/merge-upstream',
      'GET /repos/ana/templates/git/ref/heads/main',
      'GET /repos/ana/templates/git/commits/base-sha',
      'POST /repos/ana/templates/git/blobs',
      'POST /repos/ana/templates/git/trees',
      'POST /repos/ana/templates/git/commits',
      'POST /repos/ana/templates/git/refs',
      'POST /repos/labshelf/templates/pulls',
    ].map(idx);
    expect([...chain].sort((a, b) => a - b)).toEqual(chain);
    expect(chain.every((i) => i >= 0)).toBe(true);

    const post = (p: string) => fake.calls.filter((c) => c.method === 'POST' && c.path.endsWith(p));
    expect(post('/merge-upstream')[0]!.body).toEqual({ branch: 'main' });
    const blobs = post('/git/blobs');
    expect(blobs).toHaveLength(2);
    expect(blobs[1]!.body).toEqual({ content: Buffer.from(binary).toString('base64'), encoding: 'base64' });
    const tree = post('/git/trees')[0]!.body;
    expect(tree.base_tree).toBe('base-tree');
    expect(tree.tree).toEqual([
      { path: 'templates/thesis/template.yaml', mode: '100644', type: 'blob', sha: `blob-${Buffer.from('id: thesis').toString('base64')}` },
      { path: 'templates/thesis/files/logo.png', mode: '100644', type: 'blob', sha: `blob-${Buffer.from(binary).toString('base64')}` },
    ]);
    expect(post('/git/commits')[0]!.body).toMatchObject({ tree: 'new-tree', parents: ['base-sha'] });
    expect(post('/git/refs')[0]!.body).toEqual({ ref: 'refs/heads/template/thesis-2026-03-09', sha: 'new-commit' });
    expect(post('/pulls')[0]!.body).toEqual({
      title: 'Add thesis',
      body: 'A thesis template',
      head: 'ana:template/thesis-2026-03-09',
      base: 'main',
    });
  });

  it('uses an existing fork without waiting', async () => {
    const fake = fakeGitHub();
    const { promise, sleep } = run(fake);
    await promise;
    expect(sleep).not.toHaveBeenCalled();
  });

  it('commits to the fork GitHub names when <login>/<repo> is another repository', async () => {
    // A transferred upstream leaves a redirect at the user's old name, answering with the upstream itself.
    const fake = fakeGitHub({
      'GET /repos/ana/templates': [200, { full_name: 'labshelf/templates' }],
      'POST /repos/labshelf/templates/forks': [202, { full_name: 'ana/templates-1' }],
      'GET /repos/ana/templates-1': [200, { full_name: 'ana/templates-1' }],
      'POST /repos/ana/templates-1/merge-upstream': [200, { message: 'ok' }],
      'GET /repos/ana/templates-1/git/ref/heads/main': [200, { object: { sha: 'base-sha' } }],
      'GET /repos/ana/templates-1/git/commits/base-sha': [200, { tree: { sha: 'base-tree' } }],
      'POST /repos/ana/templates-1/git/blobs': (b) => [201, { sha: `blob-${b.content}` }],
      'POST /repos/ana/templates-1/git/trees': [201, { sha: 'new-tree' }],
      'POST /repos/ana/templates-1/git/commits': [201, { sha: 'new-commit' }],
      'POST /repos/ana/templates-1/git/refs': [201, {}],
    });
    const { promise } = run(fake);
    await expect(promise).resolves.toMatchObject({ url: 'https://github.com/labshelf/templates/pull/7' });
    expect(fake.calls.some((c) => c.path.startsWith('/repos/ana/templates/'))).toBe(false);
    expect(fake.calls.find((c) => c.path.endsWith('/pulls'))!.body.head).toBe('ana:template/thesis-2026-03-09');
  });

  it('waits and sleeps while a new fork is not ready', async () => {
    const fake = fakeGitHub({
      'GET /repos/ana/templates': [
        [404, { message: 'Not Found' }],
        [404, { message: 'Not Found' }],
        [200, { full_name: 'ana/templates' }],
      ],
    });
    const { promise, sleep } = run(fake);
    await promise;
    expect(sleep).toHaveBeenCalled();
  });

  it('gives up with step wait when the fork never answers', async () => {
    const fake = fakeGitHub({
      'GET /repos/ana/templates': [404, { message: 'Not Found' }],
    });
    const { promise, sleep } = run(fake);
    await expect(promise).rejects.toMatchObject({ step: 'wait' });
    await promise.catch((e: any) => expect(e).toBeInstanceOf(GitHubError));
    expect(sleep.mock.calls.length).toBeGreaterThan(0);
    expect(sleep.mock.calls.length).toBeLessThan(100);
    expect(fake.calls.some((c) => c.path.endsWith('/merge-upstream'))).toBe(false);
  });

  it('maps 403 on blobs to a permission error naming the step', async () => {
    const fake = fakeGitHub({ 'POST /repos/ana/templates/git/blobs': [403, { message: 'Resource not accessible' }] });
    const err = await run(fake).promise.catch((e: any) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err).toMatchObject({ step: 'blob', status: 403, githubMessage: 'Resource not accessible' });
    expect(err.message).toMatch(/permission|rate limit/i);
    expect(err.message).toMatch(/blob/i);
  });

  it('maps 422 on refs to an error carrying the GitHub message', async () => {
    const fake = fakeGitHub({ 'POST /repos/ana/templates/git/refs': [422, { message: 'Reference already exists' }] });
    const err = await run(fake).promise.catch((e: any) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err).toMatchObject({ step: 'branch', status: 422, githubMessage: 'Reference already exists' });
    expect(err.message).toContain('Reference already exists');
  });

  it('reports a sync conflict as a GitHubError', async () => {
    const fake = fakeGitHub({ 'POST /repos/ana/templates/merge-upstream': [409, { message: 'Merge conflict' }] });
    await expect(run(fake).promise).rejects.toMatchObject({ step: 'sync', status: 409 });
  });

  it('sends the auth and version headers on every request', async () => {
    const fake = fakeGitHub(forkMissing);
    await run(fake).promise;
    expect(fake.calls.length).toBeGreaterThan(8);
    for (const call of fake.calls) {
      expect(call.headers).toMatchObject({
        Authorization: 'Bearer tok',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      });
    }
  });
});
