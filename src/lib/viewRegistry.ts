import registry from '../content/views/_registry.json';

export type ViewAccessConfig = {
  /** Cloudflare Zero Trust application name (for your records). */
  policyName: string;
  type: 'one_time_pin' | 'email' | 'shared_password';
};

export type ViewRegistryEntry = {
  id: string;
  title: string;
  subdomain: string;
  access: ViewAccessConfig;
  /** Optional note sent with the employer link (not rendered on site). */
  recipientNote?: string;
};

export type ViewRegistry = {
  views: ViewRegistryEntry[];
};

export function getViewRegistry(): ViewRegistry {
  return registry as ViewRegistry;
}

export function getViewRegistryEntry(viewId: string): ViewRegistryEntry | undefined {
  return getViewRegistry().views.find((entry) => entry.id === viewId);
}

export function getViewSubdomain(viewId: string): string | undefined {
  return getViewRegistryEntry(viewId)?.subdomain;
}
