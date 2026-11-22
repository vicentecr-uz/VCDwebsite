# 0014. Untrusted input

Status: Accepted (2026-11-22, recorded from code comments)

## Decision

- **Links** typed in the editor are normalised and `javascript:`, `data:` and script protocols are rejected (`normalizeHref`).
- **Annotation colours**: Drawesome stores CSS colours, so only a serialisable subset (hex, `rgb[a]()`, `hsl[a]()` with numeric arguments) is accepted. Anything else could bring in external resources or extra declarations when rendered.
- **Signup client IP** comes from `cf-connecting-ip`, which Cloudflare sets itself. `X-Forwarded-For` can be prefixed by the client, so it is only a fallback outside Cloudflare. Unexpected 4xx responses from listmonk become a generic 502 so internals do not leak.
- **Teaser password** is visible to the client in a static build. It is a soft gate against casual discovery, not access control; never put anything behind it that must stay private.

## Where

`src/lib/normalizeHref.mjs`; `src/lib/siteAnnotations.ts` → `COLOR`; `src/lib/signup-handler.ts` → `clientIp`, `handleSignupRequest`; `src/lib/teaserAuth.ts`
