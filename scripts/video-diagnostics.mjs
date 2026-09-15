import { writeAtomicJson } from './dev-api-plugins.mjs';

export const VIDEO_DIAGNOSTICS_PATH = '/tmp/vcd-video-diagnostics.json';

export function validateVideoDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid video diagnostic report.');
  const report = {
    pathname: typeof value.pathname === 'string' ? value.pathname.slice(0, 300) : '',
    userAgent: typeof value.userAgent === 'string' ? value.userAgent.slice(0, 300) : '',
    errors: Array.isArray(value.errors) ? value.errors.slice(0, 8).map((error) => ({
      message: String(error?.message || '').slice(0, 300),
      filename: String(error?.filename || '').slice(0, 300),
    })) : [],
    definitions: value.definitions && typeof value.definitions === 'object' && !Array.isArray(value.definitions)
      ? Object.fromEntries(Object.entries(value.definitions).slice(0, 5).map(([key, present]) => [String(key).slice(0, 80), Boolean(present)])) : {},
    videos: Array.isArray(value.videos) ? value.videos.slice(0, 8).map((video) => ({
      controls: Boolean(video?.controls),
      playsInline: Boolean(video?.playsInline),
      readyState: Number.isFinite(video?.readyState) ? video.readyState : null,
      errorCode: Number.isFinite(video?.errorCode) ? video.errorCode : null,
      controllerExists: Boolean(video?.controllerExists),
      enhancedMarker: Boolean(video?.enhancedMarker),
      customPlayCount: Number.isFinite(video?.customPlayCount) ? video.customPlayCount : null,
      computedVideoTransform: String(video?.computedVideoTransform || '').slice(0, 300),
      computedControllerDisplay: String(video?.computedControllerDisplay || '').slice(0, 80),
    })) : [],
  };
  if (!report.pathname || !report.userAgent) throw new Error('Invalid video diagnostic report.');
  return report;
}

export function createVideoDiagnosticsHandler({ write = writeAtomicJson, reportPath = VIDEO_DIAGNOSTICS_PATH } = {}) {
  return async (req, res, next) => {
    if (req.method !== 'POST') {
      next();
      return;
    }
    try {
      const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
      const origin = String(req.headers?.origin || '');
      const host = String(req.headers?.host || '');
      const fetchSite = String(req.headers?.['sec-fetch-site'] || '').toLowerCase();
      if (!contentType.startsWith('application/json') || fetchSite === 'cross-site' || (origin && host && new URL(origin).host !== host)) {
        throw new Error('Invalid video diagnostic request.');
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16_000) throw new Error('Request too large.');
      }
      const report = validateVideoDiagnostics(JSON.parse(body));
      await write(reportPath, report);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ path: reportPath }));
    } catch (error) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: error?.message === 'Request too large.' ? error.message : 'Invalid video diagnostic report.' }));
    }
  };
}

export function videoDiagnosticsWriter({ write = writeAtomicJson, reportPath = VIDEO_DIAGNOSTICS_PATH } = {}) {
  return {
    name: 'video-diagnostics-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/video-diagnostics', createVideoDiagnosticsHandler({ write, reportPath }));
    },
  };
}
