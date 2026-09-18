import { handleSignupRequest, type SignupEnv } from '../../src/lib/signup-handler';

type PagesContext = {
  request: Request;
  env: SignupEnv;
};

/** Cloudflare Pages Function — POST /api/signup (same-origin; no CORS). */
export async function onRequest(context: PagesContext): Promise<Response> {
  return handleSignupRequest(context.request, context.env, { isDev: false });
}
