"use strict";

module.exports = function indexHtml(config) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${config.name} - Nexus Plugin</title>
  <link rel="stylesheet" href="{{NEXUS_API_URL}}/api/v1/theme.css" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font-sans);
      background: var(--color-nx-deep);
      color: var(--color-nx-text);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }

    .app {
      max-width: 520px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }

    .header {
      text-align: center;
      margin-bottom: 2rem;
    }
    .header h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-nx-accent);
    }
    .header .subtitle {
      color: var(--color-nx-text-secondary);
      font-size: 0.8125rem;
      margin-top: 0.25rem;
    }

    .card {
      background: var(--color-nx-surface);
      border: 1px solid var(--color-nx-border);
      border-radius: var(--radius-card);
      padding: 1.25rem 1.5rem;
      margin-bottom: 1rem;
    }
    .card-label {
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-nx-text-muted);
      margin-bottom: 0.5rem;
    }
    .card-value {
      font-size: 1rem;
      font-weight: 500;
    }

    .status-bar {
      margin-top: 1.5rem;
      padding: 0.625rem 0.875rem;
      background: var(--color-nx-accent-muted);
      border: 1px solid var(--color-nx-border-accent);
      border-radius: var(--radius-button);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.75rem;
      color: var(--color-nx-accent);
      font-weight: 500;
    }
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--color-nx-accent);
      flex-shrink: 0;
    }

    .error-state {
      text-align: center;
      padding: 1.25rem;
      background: var(--color-nx-error-muted);
      border: 1px solid var(--color-nx-error);
      border-radius: var(--radius-button);
      color: var(--color-nx-error);
      font-size: 0.8125rem;
    }
  </style>
</head>
<body>
  <div class="app">
    <div class="header">
      <h1>${config.name}</h1>
      <p class="subtitle">${config.description}</p>
    </div>

    <div class="card">
      <div class="card-label">Status</div>
      <div class="card-value" id="status-text">Connecting...</div>
    </div>

    <div id="content"></div>
    <div id="status"></div>
  </div>

  <script>
    async function init() {
      const statusText = document.getElementById('status-text');
      const statusEl = document.getElementById('status');

      try {
        const configRes = await fetch('/api/config');
        const config = await configRes.json();

        // Load settings from Host API
        let settings = {};
        try {
          const settingsRes = await fetch(\`\${config.apiUrl}/api/v1/settings\`, {
            headers: { 'Authorization': \`Bearer \${config.token}\` }
          });
          if (settingsRes.ok) {
            settings = await settingsRes.json();
          }
        } catch (_) {}

        statusText.textContent = 'Connected';
        statusEl.innerHTML = \`
          <div class="status-bar">
            <span class="status-dot"></span>
            Connected to Nexus
          </div>
        \`;

      } catch (err) {
        statusText.textContent = 'Disconnected';
        statusEl.innerHTML = \`<div class="error-state">Failed to connect: \${err.message}</div>\`;
      }
    }

    init();
  </script>
</body>
</html>
`;
};
