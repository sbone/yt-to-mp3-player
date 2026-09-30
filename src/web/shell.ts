export function renderSpaShell(title = "Local Audio Device Sync"): string {
  const headScripts = process.env.DEV_MODE === "1"
    ? `
    <script type="module" src="/@vite/client"></script>
    <script type="module" src="/src/client/main.tsx"></script>`
    : `
    <link rel="stylesheet" href="/assets/client.css" />
    <script type="module" src="/assets/client.js"></script>`;

  return `<!doctype html>
<html lang="en" data-webtui-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
${headScripts}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
}
