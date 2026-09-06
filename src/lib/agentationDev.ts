import { Agentation, type AgentationProps } from 'agentation';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

const ROOT_ID = 'agentation-root';

if (!document.getElementById(ROOT_ID)) {
  const container = document.createElement('div');
  container.id = ROOT_ID;
  document.body.append(container);
  createRoot(container).render(createElement<AgentationProps>(Agentation, {
    endpoint: 'http://localhost:4747',
  }));
}
