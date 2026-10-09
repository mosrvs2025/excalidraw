import { BASE_CSS } from "./runtime";
import type { CanvasGraph } from "../canvas/context";

const page = (body: string, script: string, extraCss = "") =>
  `<!doctype html><html><head><style>${BASE_CSS}${extraCss}</style></head><body>${body}<script>${script}</script></body></html>`;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export interface AppSpec {
  title: string;
  html: string;
  width: number;
  height: number;
}

/* ───────────── generated from the drawing itself ───────────── */

/** A flowchart becomes a thing you can actually walk through. */
export function flowRunner(graph: CanvasGraph, title = "Walk the flow"): AppSpec | null {
  const nodes = graph.items.filter((i) => ["shape", "note"].includes(i.kind) && i.text);
  if (nodes.length < 2 || graph.edges.length < 1) return null;
  const ids = new Set(nodes.map((n) => n.alias));
  const data = {
    nodes: Object.fromEntries(
      nodes.map((n) => [n.alias, { label: n.text.replace(/\s*\n\s*/g, " "), decision: n.shape === "diamond" }]),
    ),
    edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
  const html = page(
    `<h2 id="t"></h2><div id="stage"></div><div id="trail" class="mut"></div>`,
    `
var G=${json(data)};var T=${json(title)};document.getElementById("t").textContent=T;
var hasIn={};G.edges.forEach(function(e){hasIn[e.to]=1});
var starts=Object.keys(G.nodes).filter(function(k){return !hasIn[k]});
var path=(lumen.state&&lumen.state.path)||[starts[0]||Object.keys(G.nodes)[0]];
function out(k){return G.edges.filter(function(e){return e.from===k})}
function go(k){path.push(k);lumen.save({path:path});draw()}
function reset(){path=[path[0]];lumen.save({path:path});draw()}
function draw(){
  var cur=path[path.length-1],n=G.nodes[cur],o=out(cur),s=document.getElementById("stage");
  s.innerHTML="";
  var c=document.createElement("div");c.className="card cur"+(n.decision?" dec":"");
  c.innerHTML="<div class=mut style='font-size:12px;text-transform:uppercase;letter-spacing:.06em'>"+(n.decision?"Decision":"Step "+path.length)+"</div><div class=big></div>";
  c.querySelector(".big").textContent=n.label;s.appendChild(c);
  var b=document.createElement("div");b.className="opts";
  if(!o.length){var d=document.createElement("div");d.className="done";d.textContent="✓ End of the flow";b.appendChild(d)}
  o.forEach(function(e){var btn=document.createElement("button");btn.className=n.decision||o.length>1?"pri":"pri";
    btn.textContent=(e.label?e.label+" → ":"Next → ")+(o.length>1||e.label?G.nodes[e.to].label:"");
    btn.onclick=function(){go(e.to)};b.appendChild(btn)});
  s.appendChild(b);
  var r=document.createElement("button");r.textContent="↺ Restart";r.onclick=reset;r.style.marginTop="14px";s.appendChild(r);
  document.getElementById("trail").textContent=path.map(function(k){return G.nodes[k].label}).join("  ›  ");
}
draw();`,
    `.big{font-size:20px;font-weight:650;margin-top:4px}.cur{padding:18px;margin-bottom:12px}.dec{border-color:var(--acc);background:var(--acc2)}
.opts{display:flex;flex-direction:column;gap:8px}.opts button{text-align:left;padding:11px 14px}.done{color:var(--ok);font-weight:600;padding:8px 0}#trail{margin-top:14px;font-size:12px;line-height:1.6}`,
  );
  return { title, html, width: 420, height: 380 };
}

/** Any list on the canvas becomes a checklist with progress. */
export function checklist(items: string[], title = "Checklist"): AppSpec {
  const html = page(
    `<h2 id="t"></h2><div class="bar"><i id="fill"></i></div><div id="sub" class="mut" style="margin:6px 0 12px"></div><div id="list"></div>`,
    `
var ITEMS=${json(items)};document.getElementById("t").textContent=${json(title)};
var done=(lumen.state&&lumen.state.done)||{};
function draw(){var l=document.getElementById("list");l.innerHTML="";var n=0;
  ITEMS.forEach(function(t,i){var r=document.createElement("label");r.className="it"+(done[i]?" on":"");
    var c=document.createElement("input");c.type="checkbox";c.checked=!!done[i];if(done[i])n++;
    c.onchange=function(){done[i]=c.checked;lumen.save({done:done});draw()};
    var s=document.createElement("span");s.textContent=t;r.appendChild(c);r.appendChild(s);l.appendChild(r)});
  document.getElementById("fill").style.width=(n/ITEMS.length*100)+"%";
  document.getElementById("sub").textContent=n+" of "+ITEMS.length+(n===ITEMS.length?" — all done 🎉":" done");}
draw();`,
    `.bar{height:8px;border-radius:99px;background:var(--card);overflow:hidden;border:1px solid var(--line)}#fill{display:block;height:100%;background:var(--acc);transition:width .3s}
.it{display:flex;gap:10px;align-items:center;padding:9px 4px;border-bottom:1px solid var(--line);cursor:pointer}.it input{width:18px;height:18px;accent-color:var(--acc)}.it.on span{text-decoration:line-through;color:var(--mut)}`,
  );
  return { title, html, width: 380, height: Math.min(640, 190 + items.length * 44) };
}

/* ───────────── pattern templates ───────────── */

export const TEMPLATES: Record<string, { match: RegExp; build: (title?: string, items?: string[]) => AppSpec }> = {
  todo: {
    match: /\b(to-?do|tasks?|task list|checklist)\b/i,
    build: (title = "To-do") => ({
      title,
      width: 380,
      height: 460,
      html: page(
        `<h2 id="t"></h2><form class="row" id="f"><input class="grow" id="in" placeholder="Add a task…" autocomplete="off"><button class="pri">Add</button></form><div id="c" class="mut" style="margin:10px 0"></div><div id="l"></div>`,
        `
document.getElementById("t").textContent=${json(title)};
var tasks=(lumen.state&&lumen.state.tasks)||[];
function save(){lumen.save({tasks:tasks})}
function draw(){var l=document.getElementById("l");l.innerHTML="";
  tasks.forEach(function(t,i){var r=document.createElement("div");r.className="it"+(t.d?" on":"");
    var c=document.createElement("input");c.type="checkbox";c.checked=t.d;c.onchange=function(){t.d=c.checked;save();draw()};
    var s=document.createElement("span");s.className="grow";s.textContent=t.t;
    var x=document.createElement("button");x.textContent="✕";x.onclick=function(){tasks.splice(i,1);save();draw()};
    r.appendChild(c);r.appendChild(s);r.appendChild(x);l.appendChild(r)});
  var left=tasks.filter(function(t){return !t.d}).length;
  document.getElementById("c").textContent=tasks.length?left+" left · "+(tasks.length-left)+" done":"Nothing yet — add your first task.";}
document.getElementById("f").onsubmit=function(e){e.preventDefault();var i=document.getElementById("in");if(!i.value.trim())return;tasks.unshift({t:i.value.trim(),d:false});i.value="";save();draw()};
draw();`,
        `.it{display:flex;gap:10px;align-items:center;padding:8px 2px;border-bottom:1px solid var(--line)}.it input{width:18px;height:18px;accent-color:var(--acc)}.it.on .grow{text-decoration:line-through;color:var(--mut)}.it button{padding:2px 8px;opacity:.5}.it:hover button{opacity:1}`,
      ),
    }),
  },
  counter: {
    match: /\b(counter|count|tally|clicker)\b/i,
    build: (title = "Counter") => ({
      title,
      width: 300,
      height: 280,
      html: page(
        `<h2 id="t"></h2><div class="n" id="n">0</div><div class="row" style="justify-content:center"><button id="m">−</button><button class="pri" id="p">+</button><button id="r">Reset</button></div>`,
        `
document.getElementById("t").textContent=${json(title)};
var n=(lumen.state&&lumen.state.n)||0;
function draw(){document.getElementById("n").textContent=n;lumen.save({n:n})}
document.getElementById("p").onclick=function(){n++;draw()};document.getElementById("m").onclick=function(){n--;draw()};document.getElementById("r").onclick=function(){n=0;draw()};
document.getElementById("n").textContent=n;`,
        `body{text-align:center}.n{font-size:84px;font-weight:700;margin:14px 0;font-variant-numeric:tabular-nums}.row button{font-size:20px;min-width:56px;padding:10px 16px}`,
      ),
    }),
  },
  timer: {
    match: /\b(timer|pomodoro|countdown|stopwatch|focus)\b/i,
    build: (title = "Focus timer") => ({
      title,
      width: 320,
      height: 380,
      html: page(
        `<h2 id="t"></h2><svg viewBox="0 0 120 120" width="190" height="190" style="display:block;margin:0 auto"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="8"/><circle id="ring" cx="60" cy="60" r="52" fill="none" stroke="var(--acc)" stroke-width="8" stroke-linecap="round" stroke-dasharray="326.7" transform="rotate(-90 60 60)"/><text id="tx" x="60" y="68" text-anchor="middle" font-size="24" font-weight="700" fill="var(--fg)">25:00</text></svg>
<div class="row" style="justify-content:center;margin-top:14px"><button id="s" class="pri">Start</button><button id="r">Reset</button></div><div class="row" style="justify-content:center;margin-top:10px"><button data-m="5">5</button><button data-m="15">15</button><button data-m="25">25</button><button data-m="50">50</button></div>`,
        `
document.getElementById("t").textContent=${json(title)};
var total=25*60,left=total,iv=null;
function fmt(s){var m=Math.floor(s/60),x=s%60;return (m<10?"0":"")+m+":"+(x<10?"0":"")+x}
function draw(){document.getElementById("tx").textContent=fmt(left);document.getElementById("ring").style.strokeDashoffset=326.7*(1-left/total)}
function stop(){clearInterval(iv);iv=null;document.getElementById("s").textContent="Start"}
document.getElementById("s").onclick=function(){if(iv){stop();return}document.getElementById("s").textContent="Pause";
  iv=setInterval(function(){left--;if(left<=0){left=0;stop();document.getElementById("tx").textContent="Done ✓"}draw()},1000)};
document.getElementById("r").onclick=function(){stop();left=total;draw()};
[].forEach.call(document.querySelectorAll("[data-m]"),function(b){b.onclick=function(){stop();total=left=(+b.dataset.m)*60;draw()}});
draw();`,
        `body{text-align:center}h2{text-align:center}`,
      ),
    }),
  },
  calculator: {
    match: /\b(calculator|calc)\b/i,
    build: (title = "Calculator") => ({
      title,
      width: 300,
      height: 420,
      html: page(
        `<div id="d" class="disp">0</div><div class="g" id="g"></div>`,
        `
var keys=["C","±","%","÷","7","8","9","×","4","5","6","−","1","2","3","+","0",".","⌫","="];
var cur="0",acc=null,op=null,fresh=true;
function calc(a,b,o){return o==="+"?a+b:o==="−"?a-b:o==="×"?a*b:o==="÷"?(b===0?NaN:a/b):b}
function show(){var s=String(cur);document.getElementById("d").textContent=s.length>12?(+cur).toPrecision(9):s}
keys.forEach(function(k){var b=document.createElement("button");b.textContent=k;if("÷×−+=".indexOf(k)>=0)b.className="pri";
  b.onclick=function(){
    if(/\\d/.test(k)){cur=fresh||cur==="0"?k:cur+k;fresh=false}
    else if(k==="."){if(fresh){cur="0.";fresh=false}else if(cur.indexOf(".")<0)cur+="."}
    else if(k==="C"){cur="0";acc=null;op=null;fresh=true}
    else if(k==="⌫"){cur=cur.length>1?cur.slice(0,-1):"0"}
    else if(k==="±"){cur=String(-parseFloat(cur))}
    else if(k==="%"){cur=String(parseFloat(cur)/100)}
    else{var v=parseFloat(cur);if(acc!==null&&op&&!fresh){v=calc(acc,v,op);cur=String(v)}acc=v;op=k==="="?null:k;fresh=true;if(k==="=")acc=null}
    show()};
  document.getElementById("g").appendChild(b)});
show();`,
        `.disp{font-size:44px;text-align:right;padding:8px 6px 14px;font-variant-numeric:tabular-nums;overflow:hidden}.g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.g button{padding:14px 0;font-size:18px}`,
      ),
    }),
  },
  poll: {
    match: /\b(poll|vote|voting|survey|ballot)\b/i,
    build: (title = "Quick poll", items) => {
      const opts = items && items.length >= 2 ? items.slice(0, 8) : ["Option A", "Option B", "Option C"];
      return {
        title,
        width: 380,
        height: 150 + opts.length * 56,
        html: page(
          `<h2 id="t"></h2><div id="o"></div><div id="tot" class="mut" style="margin-top:10px"></div>`,
          `
var O=${json(opts)};document.getElementById("t").textContent=${json(title)};
var v=(lumen.state&&lumen.state.v)||O.map(function(){return 0});
function draw(){var sum=v.reduce(function(a,b){return a+b},0),o=document.getElementById("o");o.innerHTML="";
  O.forEach(function(t,i){var b=document.createElement("button");b.className="opt";var p=sum?v[i]/sum*100:0;
    b.innerHTML="<i style='width:"+p+"%'></i><span></span><b>"+Math.round(p)+"%</b>";b.querySelector("span").textContent=t;
    b.onclick=function(){v[i]++;lumen.save({v:v});draw()};o.appendChild(b)});
  document.getElementById("tot").textContent=sum+" vote"+(sum===1?"":"s")+" · click an option to vote";}
draw();`,
          `.opt{position:relative;display:flex;justify-content:space-between;width:100%;margin-bottom:8px;padding:12px 14px;overflow:hidden;text-align:left}.opt i{position:absolute;left:0;top:0;bottom:0;background:var(--acc2);transition:width .35s}.opt span,.opt b{position:relative}`,
        ),
      };
    },
  },
  kanban: {
    match: /\b(kanban|board|sprint board)\b/i,
    build: (title = "Kanban") => ({
      title,
      width: 620,
      height: 420,
      html: page(
        `<div class="cols" id="c"></div>`,
        `
var cols=["To do","Doing","Done"];var cards=(lumen.state&&lumen.state.cards)||[{t:"Try moving me →",c:0}];
function save(){lumen.save({cards:cards})}
function draw(){var c=document.getElementById("c");c.innerHTML="";
  cols.forEach(function(name,ci){var col=document.createElement("div");col.className="col";
    var h=document.createElement("h2");h.textContent=name+" · "+cards.filter(function(x){return x.c===ci}).length;col.appendChild(h);
    cards.forEach(function(k,i){if(k.c!==ci)return;var d=document.createElement("div");d.className="card k";
      var s=document.createElement("div");s.textContent=k.t;d.appendChild(s);var r=document.createElement("div");r.className="row";
      [["←",-1],["→",1]].forEach(function(a){if(ci+a[1]<0||ci+a[1]>2)return;var b=document.createElement("button");b.textContent=a[0];b.onclick=function(){k.c+=a[1];save();draw()};r.appendChild(b)});
      var x=document.createElement("button");x.textContent="✕";x.onclick=function(){cards.splice(i,1);save();draw()};r.appendChild(x);d.appendChild(r);col.appendChild(d)});
    if(ci===0){var a=document.createElement("button");a.textContent="+ Add card";a.onclick=function(){var t=prompt("Card title")||"";if(t.trim()){cards.push({t:t.trim(),c:0});save();draw()}};col.appendChild(a)}
    c.appendChild(col)})}
draw();`,
        `.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;height:100%}.col{background:var(--card);border-radius:12px;padding:10px;min-height:200px}.k{margin-bottom:8px;background:var(--bg)}.k .row{margin-top:8px}.k button{padding:3px 9px;font-size:13px}`,
      ),
    }),
  },
  tip: {
    match: /\b(tip|split (the )?bill|bill split)\b/i,
    build: (title = "Tip & split") => ({
      title,
      width: 340,
      height: 380,
      html: page(
        `<h2 id="t"></h2><label class="mut">Bill</label><input id="b" type="number" value="80" min="0" style="width:100%;margin:4px 0 10px"><label class="mut">Tip <b id="pv">18</b>%</label><input id="p" type="range" min="0" max="30" value="18" style="width:100%"><label class="mut">People</label><input id="n" type="number" value="2" min="1" style="width:100%;margin:4px 0 14px"><div class="card"><div class="row"><span class="grow mut">Total</span><b id="tot"></b></div><div class="row"><span class="grow mut">Each</span><b id="each" style="font-size:22px;color:var(--acc)"></b></div></div>`,
        `
document.getElementById("t").textContent=${json(title)};
function u(){var b=+document.getElementById("b").value||0,p=+document.getElementById("p").value,n=Math.max(1,+document.getElementById("n").value||1);
  document.getElementById("pv").textContent=p;var t=b*(1+p/100);document.getElementById("tot").textContent="$"+t.toFixed(2);document.getElementById("each").textContent="$"+(t/n).toFixed(2)}
["b","p","n"].forEach(function(i){document.getElementById(i).oninput=u});u();`,
      ),
    }),
  },
  dice: {
    match: /\b(dice|die|roll|random)\b/i,
    build: (title = "Dice") => ({
      title,
      width: 300,
      height: 300,
      html: page(
        `<h2 id="t"></h2><div class="d" id="d">⚀</div><div class="row" style="justify-content:center"><button class="pri" data-s="6">Roll d6</button><button data-s="20">d20</button><button data-s="100">d100</button></div>`,
        `
document.getElementById("t").textContent=${json(title)};
var faces="⚀⚁⚂⚃⚄⚅";
[].forEach.call(document.querySelectorAll("[data-s]"),function(b){b.onclick=function(){var s=+b.dataset.s,d=document.getElementById("d"),k=0;
  var iv=setInterval(function(){var r=1+Math.floor(Math.random()*s);d.textContent=s===6?faces[r-1]:r;if(++k>9){clearInterval(iv)}},55)}});`,
        `body{text-align:center}.d{font-size:96px;margin:18px 0;line-height:1;font-variant-numeric:tabular-nums}`,
      ),
    }),
  },
  signup: {
    match: /\b(sign ?up|log ?in|login|register|form|contact)\b/i,
    build: (title = "Sign up") => ({
      title,
      width: 360,
      height: 400,
      html: page(
        `<h2 id="t"></h2><form id="f"><label class="mut">Name</label><input id="n" required style="width:100%;margin:4px 0 10px"><label class="mut">Email</label><input id="e" type="email" required style="width:100%;margin:4px 0 10px"><label class="mut">Password</label><input id="p" type="password" minlength="8" required style="width:100%;margin:4px 0 4px"><div id="m" class="mut" style="min-height:22px;font-size:13px"></div><button class="pri" style="width:100%;padding:11px">Create account</button></form><div id="ok" style="display:none" class="card"><b>🎉 Welcome, <span id="w"></span>!</b><div class="mut">This is a clickable prototype — nothing was sent anywhere.</div></div>`,
        `
document.getElementById("t").textContent=${json(title)};
var p=document.getElementById("p");p.oninput=function(){var s=p.value.length;document.getElementById("m").textContent=s?(s<8?"Too short ("+s+"/8)":"Looks good"):"";document.getElementById("m").style.color=s<8?"var(--bad)":"var(--ok)"};
document.getElementById("f").onsubmit=function(e){e.preventDefault();document.getElementById("w").textContent=document.getElementById("n").value;document.getElementById("f").style.display="none";document.getElementById("ok").style.display="block"};`,
      ),
    }),
  },
};

export function pickTemplate(text: string): keyof typeof TEMPLATES | null {
  for (const [k, t] of Object.entries(TEMPLATES)) if (t.match.test(text)) return k as keyof typeof TEMPLATES;
  return null;
}
