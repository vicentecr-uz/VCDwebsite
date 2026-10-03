import { readDevDocument, resolveEditableDocument, writeDevDocument } from './dev-api-plugins.mjs';
import { validateSiteAnnotations } from '../src/lib/siteAnnotations.ts';

export function annotationDevWriter() {
  return {
    name: 'annotation-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/content-annotations', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        const send = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };
        try {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 1_000_000) {
              send(413, { error: 'This drawing is too large to save.' });
              return;
            }
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const relativeFile = resolveEditableDocument(body.document);
          if (!relativeFile) {
            send(400, { error: 'That page cannot be edited.' });
            return;
          }
          const data = await readDevDocument(relativeFile);
          const sections = Array.isArray(data.sections) ? data.sections : [];
          const section = sections.find((item) => item?.id === body.sectionId);
          if (!section) {
            send(409, { error: 'That block has changed. Refresh before saving drawings.' });
            return;
          }
          const ids = new Set([section.id]);
          if (!validateSiteAnnotations(body.annotations, ids)
            || !validateSiteAnnotations(body.expected, ids)) {
            send(400, { error: 'The drawing data is invalid.' });
            return;
          }
          if (JSON.stringify(section.annotations ?? []) !== JSON.stringify(body.expected)) {
            send(409, { error: 'These drawings changed elsewhere. Refresh before saving.' });
            return;
          }
          if (body.annotations.length) section.annotations = body.annotations;
          else delete section.annotations;
          await writeDevDocument(relativeFile, data);
          send(200, { ok: true });
        } catch {
          send(400, { error: 'Could not save the drawings.' });
        }
      });
    },
  };
}
