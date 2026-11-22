import { handleSignupRequest, type SignupEnv } from '../../src/lib/signup-handler';

type PagesContext = {
  request: Request;
  env: SignupEnv;
};

export async function onRequest(context: PagesContext): Promise<Response> {
  return handleSignupRequest(context.request, context.env, { isDev: false });
}
