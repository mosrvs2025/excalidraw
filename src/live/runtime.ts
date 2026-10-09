/**
 * Live objects are tiny sandboxed web apps that live *on* the canvas.
 *
 * They run in an iframe with `sandbox="allow-scripts"` (no same-origin, no top navigation),
 * so even a model-written app cannot touch the host page, storage, or cookies.
 * A minimal bridge gives them what a canvas object needs: theme, persisted state, and a size.
 */

export const BASE_CSS = `
:root{--bg:#ffffff;--fg:#1c1c1e;--mut:#70707a;--line:#e6e6ec;--card:#f5f5f8;--acc:#5b5bd6;--acc2:#ecebff;--ok:#2f9e44;--bad:#e03131}
html[data-theme=dark]{--bg:#17171c;--fg:#f2f2f5;--mut:#9a9aa6;--line:#2c2c35;--card:#22222a;--acc:#8b8bf5;--acc2:#2a2a45;--ok:#51cf66;--bad:#ff6b6b}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--fg);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px;overflow:auto;-webkit-font-smoothing:antialiased}
h1,h2{margin:0 0 10px;font-size:17px;letter-spacing:-.01em}.mut{color:var(--mut)}
button{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:10px;padding:8px 12px;transition:transform .08s,background .15s}
button:hover{background:var(--acc2)}button:active{transform:scale(.97)}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff}button.pri:hover{filter:brightness(1.08)}
input,select{font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px;outline:none;min-width:0}
input:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc2)}
.row{display:flex;gap:8px;align-items:center}.grow{flex:1}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
`;

export function bridgeScript(state: unknown, theme: "light" | "dark") {
  const s = JSON.stringify(state ?? null).replace(/</g, "\\u003c");
  return `<script>
(function(){
  var st=${s};
  window.lumen={theme:${JSON.stringify(theme)},state:st,
    save:function(v){window.lumen.state=v;try{parent.postMessage({lumen:"save",state:v},"*")}catch(e){}}};
  document.documentElement.setAttribute("data-theme",${JSON.stringify(theme)});
})();
</script>`;
}

/** Compose the document the iframe renders. */
export function composeApp(html: string, state: unknown, theme: "light" | "dark"): string {
  const base = html.includes("--acc2") ? "" : `<style>${BASE_CSS}</style>`;
  const inject = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${bridgeScript(state, theme)}${base}`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + inject);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + "<head>" + inject + "</head>");
  return `<!doctype html><html><head>${inject}</head><body>${html}</body></html>`;
}

/* ───────── markdown (small, safe) for document cards ───────── */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  // open lists, innermost last; each remembers its indent so nesting follows the source
  const stack: { type: "ul" | "ol"; indent: number }[] = [];
  let code = false;
  const closeTo = (indent: number) => {
    while (stack.length && stack[stack.length - 1].indent > indent) {
      out.push(`</li></${stack.pop()!.type}>`);
    }
  };
  const closeAll = () => closeTo(-1);
  for (const raw of lines) {
    if (raw.trim().startsWith("```")) {
      closeAll();
      out.push(code ? "</pre>" : "<pre>");
      code = !code;
      continue;
    }
    if (code) {
      out.push(esc(raw) + "\n");
      continue;
    }
    const h = raw.match(/^(#{1,4})\s+(.*)$/);
    const item = raw.match(/^(\s*)([-*]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/);
    if (h) {
      closeAll();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (item) {
      const indent = item[1].replace(/\t/g, "  ").length;
      const type = /\d/.test(item[2]) ? "ol" : "ul";
      closeTo(indent);
      const top = stack[stack.length - 1];
      if (top && top.indent === indent) {
        if (top.type !== type) {
          out.push(`</li></${top.type}><${type}>`);
          top.type = type;
        } else out.push("</li>");
      } else {
        out.push(`<${type}>`);
        stack.push({ type, indent });
      }
      const box = item[3] ? `<input type="checkbox" disabled ${/x/i.test(item[3]) ? "checked" : ""}> ` : "";
      out.push(`<li>${box}${inline(item[4])}`);
    } else if (/^>\s?/.test(raw)) {
      closeAll();
      out.push(`<blockquote>${inline(raw.replace(/^>\s?/, ""))}</blockquote>`);
    } else if (!raw.trim()) {
      // blank lines don't end a list that continues after them
    } else {
      closeAll();
      out.push(`<p>${inline(raw)}</p>`);
    }
  }
  closeAll();
  if (code) out.push("</pre>");
  return out.join("\n");
}
