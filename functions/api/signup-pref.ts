import {
  handleSignupPrefRequest,
  type SignupPrefStore,
  type SignupPrefVote,
} from '../../src/lib/signup-pref-handler';

type PrefKv = {
  put: (key: string, value: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  list: (options: { prefix: string }) => Promise<{ keys: Array<{ name: string }> }>;
};

type PagesContext = {
  request: Request;
  env: {
    SIGNUP_PREF?: PrefKv;
    SIGNUP_PREF_KEY?: string;
  };
};

const kvStore = (kv: PrefKv): SignupPrefStore => ({
  add: async (vote: SignupPrefVote) => {
    await kv.put(`vote:${vote.id}`, JSON.stringify(vote));
  },
  list: async () => {
    const listed = await kv.list({ prefix: 'vote:' });
    const votes: SignupPrefVote[] = [];
    for (const key of listed.keys) {
      const raw = await kv.get(key.name);
      if (!raw) continue;
      try {
        votes.push(JSON.parse(raw) as SignupPrefVote);
      } catch {
        /* skip junk */
      }
    }
    return votes;
  },
});

export async function onRequest(context: PagesContext): Promise<Response> {
  const kv = context.env.SIGNUP_PREF;
  if (!kv) {
    return new Response(JSON.stringify({ error: 'Preferences are not stored on this host yet.' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return handleSignupPrefRequest(context.request, kvStore(kv), {
    isDev: false,
    resultsKey: context.env.SIGNUP_PREF_KEY,
  });
};
