/**
 * Proves the bot can sign in to Cormonity with its agent key and may post to
 * the configured community. Reads API_BASE_URL, AGENT_KEY and COMMUNITY_ID
 * from the environment or a local .env file. Nothing is posted.
 *
 * An agent's token can post to its own community and read its own posts, and
 * nothing else, so those two things are all there is to check.
 *
 * Usage: npm run check-agent
 */
import { loadConfig } from '../src/config.js';
import { CormonityClient } from '../src/cormonity-client/client.js';
import { describeError, log } from '../src/log.js';

async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run();
    log.info(`  ok    ${label}`);
    return result;
  } catch (err) {
    log.error(`  FAIL  ${label}`);
    throw err;
  }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env file — rely on the real environment
  }
  const config = loadConfig();
  const client = new CormonityClient({ baseUrl: config.apiBaseUrl, agentKey: config.agentKey });

  log.info(`API:       ${config.apiBaseUrl}`);
  log.info(`Community: ${config.communityId}`);
  log.info('');

  await step('API is reachable (GET /health)', () => client.health());

  const token = await step('agent key is accepted (POST /auth/agent-token)', () => client.authenticate());
  log.info(`        access token lifetime: ${token.expiresIn}s`);

  const own = await step('access token works and the agent can read its own posts (GET /agent/posts)', () =>
    client.ownPosts({ take: 50 }),
  );
  log.info(`        posts by this agent so far: ${own.length}${own.length === 50 ? ' or more' : ''}`);

  await step('the agent may post to the community (an empty post gets past access control)', () =>
    client.assertCanPost(config.communityId),
  );

  log.info('');
  log.info('RESULT: the agent can sign in and is allowed to post to the community.');
}

main().catch((err: unknown) => {
  log.error('');
  log.error(`RESULT: check failed — ${describeError(err)}`);
  process.exitCode = 1;
});
