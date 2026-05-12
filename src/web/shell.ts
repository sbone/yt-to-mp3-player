function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function renderSpaShell(title = "yt-to-audio"): string {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
  const devBase = devServerUrl ? trimTrailingSlash(devServerUrl) : null;
  const headScripts = devBase
    ? `
    <script type="module" src="${devBase}/@vite/client"></script>
    <script type="module" src="${devBase}/src/client/main.tsx"></script>`
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
