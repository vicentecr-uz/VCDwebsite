# VCDwebsite Roadmap

## Deployment

- [ ] **Deploy to Cloudflare Pages**
  - Connect GitHub repo (`vcruzdesigns/vcdwebsite`) to Cloudflare Pages
  - Build command: `bun run build`
  - Output directory: `dist`
  - Connect custom domain `vcruzdesigns.com` (already on Cloudflare — DNS managed there)
  - No adapter needed (static site, pre-rendered at build time)
