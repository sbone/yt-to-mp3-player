function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function h(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return escapeHtml(String(value));
}

export function fmtDate(value: string | null): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${h(title)}</title>
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
  <body>
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/">yt-to-audio</a>
        <nav class="nav">
          <a href="/">Dashboard</a>
          <a href="/channels">Channels</a>
          <a href="/runs">Runs</a>
        </nav>
      </div>
    </header>
    <main class="layout">${body}</main>
  </body>
</html>`;
}

