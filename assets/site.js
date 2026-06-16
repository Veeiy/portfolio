/* ============================================================
   Brad O'Haire portfolio - shared script (runs on every page)
   Loaded with `defer` on all pages. Every initializer null-checks
   its root element/ids and no-ops if absent, so subpages (which do
   NOT carry hero-canvas / data-echo / flow / viz / guard ids) run
   this file with zero console errors. Nothing here assumes any
   particular page's markup exists.
   ============================================================ */

(function(){
  "use strict";

  // ---- GitHub link wiring (global, harmless if no matching nodes) ----
  // Single source of truth, set once the GitHub username is known.
  const GH_USER = "Veeiy";
  const base = "https://github.com/" + GH_USER;
  // [data-repo] anchors rewrite to the full repo URL; no-op if none on page.
  document.querySelectorAll("[data-repo]").forEach(a => { a.href = base + "/" + a.dataset.repo; });
  // Brand/footer GitHub links by id; each guarded individually.
  ["nav-gh","hero-gh","foot-gh"].forEach(id => { const e=document.getElementById(id); if(e) e.href=base; });

  // Respect reduced-motion: one flag drives every animation decision below.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Node-network field (reused: hero backdrop + faint data echo) ----------
     One factory, one rAF per instance, one shared safety contract:
       - never starts under reduced-motion
       - idempotent start(): at most one frame in flight
       - stop() cancels and nulls the frame
       - pauses on hidden tab, resumes only when visible
     Brand-accent gradient: nodes/links blend --accent (#6ea8fe) -> --accent2 (#9d7bff)
     across the field by x-position. Cursor reactivity is opt-in and degrades on touch. */
  const ACCENT_RGB  = [110,168,254]; // --accent  #6ea8fe
  const ACCENT2_RGB = [157,123,255]; // --accent2 #9d7bff
  function mix(t){ // t in 0..1 -> "r,g,b" blended between the two accents
    t = t<0?0:t>1?1:t;
    const r = Math.round(ACCENT_RGB[0] + (ACCENT2_RGB[0]-ACCENT_RGB[0])*t);
    const g = Math.round(ACCENT_RGB[1] + (ACCENT2_RGB[1]-ACCENT_RGB[1])*t);
    const b = Math.round(ACCENT_RGB[2] + (ACCENT2_RGB[2]-ACCENT_RGB[2])*t);
    return r + "," + g + "," + b;
  }

  function nodeField(canvas, opts){
    if(!canvas || reduceMotion) return null;
    const ctx = canvas.getContext("2d");
    if(!ctx) return null;
    const o = Object.assign({
      area:22000, min:14, max:42,   // density: nodes ~= w*h/area, clamped [min,max]
      linkDist:130, linkAlpha:0.35, // link reach (px) and peak opacity
      dotAlpha:0.7, dotR:1.6,       // node fill opacity and radius
      speed:0.25,                   // drift speed
      interactive:false,            // attach pointer reactivity?
      influence:120, pull:0.045, maxBoost:0.9, // cursor radius, attraction, velocity clamp near pointer
      roles:false                   // promote a few nodes to labeled architecture roles + one pulse
    }, opts||{});
    let w=0, h=0, dpr=Math.min(window.devicePixelRatio||1, 2), nodes=[], raf=null, running=true;
    // Pointer is in CSS px, canvas-local. null = no active pointer (touch / left the field).
    let ptr = null;

    /* ---- Live Orchestration roles + pulse (hero only, opt-in via roles:true) ----
       A few nodes are promoted to a labeled coordinator -> specialists -> auditor
       topology, and ONE capped pulse travels the path (request, pass, return) on a
       gentle loop. Everything still lives inside the single rAF below; the pulse is
       a couple of eased lerps and a glow, not a second engine. Roles is opt-in, so
       the faint Data-section echo stays a plain field. */
    let roleNodes = [];   // [coordinator, specialistA, specialistB, auditor], pinned positions
    let labelAlpha = 0;   // eases 0 -> 1 over the first cycle so labels do not pop in
    // Pulse path = ordered role indices into roleNodes; last hop returns to coordinator.
    const PULSE_PATH = [0,1,3,0]; // coordinator -> specialist A -> auditor -> back
    const pulse = { seg:0, t:0, hold:0, on:false };
    const SEG_SPEED = 0.012;       // fraction of a segment per frame (slow)
    const HOLD_FRAMES = 64;        // pause between full loops, keeps the pulse sparse
    function layoutRoles(){
      // Pin role anchors to the RIGHT half / lower band, the hero's whitespace, so the
      // labels never sit on the H1 or lede. On narrow viewports the text fills the width,
      // so labels are suppressed entirely (see the width guard in step()).
      roleNodes = [
        { x:w*0.62, y:h*0.18, name:"Coordinator" },
        { x:w*0.80, y:h*0.40, name:"Specialist" },
        { x:w*0.70, y:h*0.72, name:"Specialist" },
        { x:w*0.90, y:h*0.62, name:"Auditor" }
      ];
    }

    function resize(){
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.max(1, Math.floor(w*dpr));
      canvas.height = Math.max(1, Math.floor(h*dpr));
      ctx.setTransform(dpr,0,0,dpr,0,0);
      // Cap node count, scale gently with area, keep it light on phones.
      const target = Math.min(o.max, Math.max(o.min, Math.round((w*h)/o.area)));
      nodes = [];
      for(let i=0;i<target;i++){
        nodes.push({
          x:Math.random()*w, y:Math.random()*h,
          vx:(Math.random()-.5)*o.speed, vy:(Math.random()-.5)*o.speed
        });
      }
      if(o.roles){ layoutRoles(); pulse.seg=0; pulse.t=0; pulse.hold=0; pulse.on=true; }
    }
    function step(){
      if(!running) return;
      ctx.clearRect(0,0,w,h);
      for(const n of nodes){
        // Soft cursor nudge: a gentle pull within the radius, eased by distance, capped.
        // All the work is here in the rAF tick; the pointer handler only stores coords.
        if(ptr){
          const dx=ptr.x-n.x, dy=ptr.y-n.y, dist=Math.hypot(dx,dy);
          if(dist>0.5 && dist<o.influence){
            const f=(1-dist/o.influence)*o.pull; // 0 at edge, strongest at center
            n.vx+=(dx/dist)*f; n.vy+=(dy/dist)*f;
          }
        }
        // Damp so nudged nodes ease back to a calm drift once the cursor leaves.
        n.vx*=0.96; n.vy*=0.96;
        // Keep a floor of motion so the field never freezes after damping.
        const sp=Math.hypot(n.vx,n.vy), floor=o.speed*0.45;
        if(sp<floor && sp>0){ const k=floor/sp; n.vx*=k; n.vy*=k; }
        // Clamp peak speed near the pointer so it stays smooth, never jumpy.
        if(sp>o.maxBoost){ const k=o.maxBoost/sp; n.vx*=k; n.vy*=k; }
        n.x+=n.vx; n.y+=n.vy;
        if(n.x<0||n.x>w) n.vx*=-1;
        if(n.y<0||n.y>h) n.vy*=-1;
        n.x=n.x<0?0:n.x>w?w:n.x; n.y=n.y<0?0:n.y>h?h:n.y;
      }
      // links: colored by the midpoint's horizontal position, opacity low for readability
      for(let i=0;i<nodes.length;i++){
        for(let j=i+1;j<nodes.length;j++){
          const a=nodes[i], b=nodes[j];
          const dx=a.x-b.x, dy=a.y-b.y, d=Math.hypot(dx,dy);
          if(d<o.linkDist){
            const alpha=(1-d/o.linkDist)*o.linkAlpha;
            const t=w?((a.x+b.x)/2)/w:0.5;
            ctx.strokeStyle="rgba("+mix(t)+","+alpha.toFixed(3)+")";
            ctx.lineWidth=1;
            ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
          }
        }
      }
      // nodes: same gradient blend by x-position
      for(const n of nodes){
        const t=w?n.x/w:0.5;
        ctx.fillStyle="rgba("+mix(t)+","+o.dotAlpha+")";
        ctx.beginPath(); ctx.arc(n.x,n.y,o.dotR,0,Math.PI*2); ctx.fill();
      }

      // ---- Roles overlay + single pulse (hero only) ----
      if(o.roles && roleNodes.length){
        if(labelAlpha < 1) labelAlpha = Math.min(1, labelAlpha + 0.012); // ease labels in once
        // Emphasized connectors along the pulse path, drawn under the role dots.
        ctx.lineWidth = 1.4;
        for(let i=0;i<PULSE_PATH.length-1;i++){
          const a=roleNodes[PULSE_PATH[i]], b=roleNodes[PULSE_PATH[i+1]];
          const t=w?((a.x+b.x)/2)/w:0.5;
          ctx.strokeStyle="rgba("+mix(t)+",0.30)";
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        }
        // Advance the single pulse: ease along the current segment, hold, then loop.
        if(pulse.on){
          if(pulse.hold>0){ pulse.hold--; }
          else {
            pulse.t += SEG_SPEED;
            if(pulse.t>=1){
              pulse.t=0; pulse.seg++;
              if(pulse.seg>=PULSE_PATH.length-1){ pulse.seg=0; pulse.hold=HOLD_FRAMES; }
            }
          }
          const a=roleNodes[PULSE_PATH[pulse.seg]], b=roleNodes[PULSE_PATH[pulse.seg+1]];
          // easeInOutQuad along the segment for a smooth glide.
          const tt=pulse.t<0.5 ? 2*pulse.t*pulse.t : 1-Math.pow(-2*pulse.t+2,2)/2;
          const px=a.x+(b.x-a.x)*tt, py=a.y+(b.y-a.y)*tt;
          const t=w?px/w:0.5;
          // soft glow
          const grad=ctx.createRadialGradient(px,py,0,px,py,9);
          grad.addColorStop(0,"rgba("+mix(t)+",0.9)");
          grad.addColorStop(1,"rgba("+mix(t)+",0)");
          ctx.fillStyle=grad;
          ctx.beginPath(); ctx.arc(px,py,9,0,Math.PI*2); ctx.fill();
          ctx.fillStyle="rgba("+mix(t)+",0.95)";
          ctx.beginPath(); ctx.arc(px,py,2.4,0,Math.PI*2); ctx.fill();
        }
        // Role dots (larger, brighter) + subtle labels eased in over the first cycle.
        // Labels are dropped on narrow viewports where the hero text fills the width,
        // so they can never compete with the H1 or lede for legibility.
        const showLabels = w >= 720;
        ctx.font="600 11px -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif";
        ctx.textAlign="center"; ctx.textBaseline="middle";
        roleNodes.forEach(rn => {
          const t=w?rn.x/w:0.5;
          ctx.fillStyle="rgba("+mix(t)+",0.95)";
          ctx.beginPath(); ctx.arc(rn.x,rn.y,3.2,0,Math.PI*2); ctx.fill();
          ctx.strokeStyle="rgba("+mix(t)+",0.5)"; ctx.lineWidth=1.2;
          ctx.beginPath(); ctx.arc(rn.x,rn.y,7,0,Math.PI*2); ctx.stroke();
          if(showLabels){
            ctx.fillStyle="rgba(231,233,238,"+(0.7*labelAlpha).toFixed(3)+")";
            ctx.fillText(rn.name, rn.x, rn.y-15);
          }
        });
      }
      // Only the live frame re-arms; a stale frame (running flipped off) exits cleanly.
      raf = running ? requestAnimationFrame(step) : null;
    }
    // start() is idempotent: one frame max in flight, never starts under reduced-motion.
    function start(){
      if(reduceMotion || raf || running) return;
      running = true;
      raf = requestAnimationFrame(step);
    }
    function stop(){
      running = false;
      if(raf){ cancelAnimationFrame(raf); raf = null; }
    }

    resize();
    running = false; // ensure a clean baseline before the single start
    start();
    window.addEventListener("resize", () => { resize(); });
    // Pause when the tab is hidden to stay performant; resume only when visible.
    document.addEventListener("visibilitychange", () => {
      if(document.hidden) stop(); else start();
    });

    // Cursor reactivity, only where a fine hover pointer exists (skips touch devices).
    if(o.interactive && window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches){
      const host = canvas.parentElement || canvas;
      host.addEventListener("pointermove", (e) => {
        if(e.pointerType && e.pointerType !== "mouse") { ptr=null; return; }
        const r = canvas.getBoundingClientRect();
        ptr = { x: e.clientX - r.left, y: e.clientY - r.top };
      }, { passive:true });
      // Easing back is automatic once ptr is null (damping in step()).
      host.addEventListener("pointerleave", () => { ptr = null; });
      host.addEventListener("pointercancel", () => { ptr = null; });
    }
    return { start, stop };
  }

  // Hero: full density, cursor-reactive, the centerpiece motion, with labeled
  // architecture roles and a single coordinator -> specialist -> auditor pulse.
  // getElementById returns null on pages without the hero; nodeField no-ops on null.
  nodeField(document.getElementById("hero-canvas"), { interactive:true, roles:true });
  // Data section: a faint, dimmer, sparser echo of the same motif. Not interactive.
  // Only present on /about; null elsewhere, so this no-ops cleanly.
  nodeField(document.getElementById("data-echo"), {
    area:30000, min:8, max:20, linkDist:120, linkAlpha:0.22,
    dotAlpha:0.5, dotR:1.3, speed:0.18, interactive:false
  });

  /* ---------- Scroll reveal ---------- */
  (function reveals(){
    const els = document.querySelectorAll(".reveal");
    if(!els.length) return; // nothing to reveal on this page
    if(reduceMotion || !("IntersectionObserver" in window)){
      els.forEach(e => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if(en.isIntersecting){ en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, {threshold:0.15, rootMargin:"0px 0px -40px 0px"});
    els.forEach(e => io.observe(e));
  })();

  /* ---------- "How a run works" flow diagram: scroll-reveal sequence ----------
     Stages light up in order; forward connectors and the iterate loop draw in.
     Under reduced-motion the CSS already shows the full, lit, drawn diagram, so we no-op.
     Only present on /about; bails immediately elsewhere. */
  (function flowDiagram(){
    const flow = document.getElementById("flow");
    if(!flow) return;
    const stages = flow.querySelectorAll("[data-stage]");
    const links  = flow.querySelectorAll("[data-link]");
    const loop   = flow.querySelector("[data-loop]");
    if(reduceMotion){ return; } // static full diagram from CSS

    // Prime each drawable path with its own length so the dash trick works.
    function prime(path){
      if(!path || typeof path.getTotalLength !== "function") return;
      let len = 0;
      try { len = path.getTotalLength(); } catch(e){ return; }
      path.style.setProperty("--len", len);
      path.classList.add("draw"); // sets dasharray/offset = len via CSS, still hidden
    }
    links.forEach(prime);
    prime(loop);

    function play(){
      // Light stages in sequence and draw the connector that follows each.
      stages.forEach((s, i) => {
        setTimeout(() => {
          s.classList.add("on");
          flow.classList.add("lit");
          const link = links[i]; // connector after stage i (last stage has none)
          if(link) link.style.strokeDashoffset = "0";
        }, i * 240);
      });
      // Draw the iterate loop after the forward chain has played.
      if(loop) setTimeout(() => { loop.style.strokeDashoffset = "0"; }, stages.length * 240 + 120);
    }

    if(!("IntersectionObserver" in window)){ play(); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if(en.isIntersecting){ play(); io.unobserve(en.target); } });
    }, {threshold:0.35});
    io.observe(flow);
  })();

  /* ---------- Animated stat counters ----------
     Drives the #stats tiles AND the real production-outcome metrics in #data
     (same data-count / data-suffix contract, same reduced-motion fallback).
     querySelectorAll returns an empty list on pages without either, so this no-ops. */
  (function counters(){
    const tiles = document.querySelectorAll("#stats b[data-count], #data .metric b[data-count], [data-count]");
    if(!tiles.length) return;
    function run(el){
      const target = parseFloat(el.dataset.count);
      const suffix = el.dataset.suffix || "";
      // Guard against bad/missing data: never render "NaN", leave the tile as authored.
      if(isNaN(target)){ return; }
      if(reduceMotion){ el.textContent = target + suffix; return; }
      const dur = 1100, t0 = performance.now();
      function tick(now){
        const p = Math.min(1, (now - t0)/dur);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if(p < 1) requestAnimationFrame(tick);
        else el.textContent = target + suffix;
      }
      requestAnimationFrame(tick);
    }
    if(reduceMotion || !("IntersectionObserver" in window)){
      tiles.forEach(run); return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if(en.isIntersecting){ run(en.target); io.unobserve(en.target); } });
    }, {threshold:0.6});
    tiles.forEach(t => io.observe(t));
  })();

  /* ---------- Data viz 1: animated multi-series line chart ----------
     Embedded sample arrays. Clearly illustrative, not live or measured.
     Only present on /about; bails immediately elsewhere. */
  (function lineChart(){
    const svgWrap = document.getElementById("viz-series");
    if(!svgWrap) return;
    const X0=40, X1=510, Y0=210, Y1=20; // plot box; value 0..1 maps Y0..Y1
    // Sample series (values 0..1). Hand-picked to read like sampled mid-prices.
    const seriesA=[0.42,0.45,0.44,0.5,0.55,0.52,0.58,0.62,0.6,0.66,0.63,0.69,0.72];
    const seriesB=[0.58,0.55,0.57,0.5,0.46,0.48,0.43,0.4,0.42,0.36,0.39,0.33,0.31];
    const spread =[0.16,0.10,0.13,0.0,0.09,0.04,0.15,0.22,0.18,0.30,0.24,0.36,0.41];
    function toPath(data){
      const n=data.length;
      return data.map((v,i) => {
        const x = X0 + (X1-X0)*(i/(n-1));
        const y = Y0 + (Y1-Y0)*v;
        return (i?"L":"M") + x.toFixed(1) + " " + y.toFixed(1);
      }).join(" ");
    }
    // Pair each path element with its data; drop any path the DOM does not have.
    const paths = [
      [document.getElementById("series-a"), seriesA],
      [document.getElementById("series-b"), seriesB],
      [document.getElementById("series-c"), spread]
    ].filter(pair => pair[0]);
    if(!paths.length) return;
    paths.forEach(([p, data]) => p.setAttribute("d", toPath(data)));

    function setupDraw(path){
      // getTotalLength can throw on a detached/empty path; bail gracefully if so.
      if(!path || typeof path.getTotalLength !== "function") return 0;
      let len = 0;
      try { len = path.getTotalLength(); } catch(e){ return 0; }
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      return len;
    }
    function animate(){
      paths.forEach(([p], idx) => {
        const len = setupDraw(p);
        if(!len) return;
        const dur = 1300 + idx*250, t0 = performance.now();
        function tick(now){
          const prog = Math.min(1, (now - t0)/dur);
          const eased = 1 - Math.pow(1 - prog, 3);
          p.style.strokeDashoffset = (len * (1 - eased)).toFixed(1);
          if(prog < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }
    if(reduceMotion){
      // Show final lines immediately, no draw animation.
      paths.forEach(([p]) => { p.style.strokeDasharray="none"; p.style.strokeDashoffset="0"; });
      return;
    }
    if(!("IntersectionObserver" in window)){ animate(); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if(en.isIntersecting){ animate(); io.unobserve(en.target); } });
    }, {threshold:0.4});
    io.observe(svgWrap);
  })();

  /* ---------- Data viz 2: animated horizontal bars ----------
     Relative emphasis weights, clearly labeled illustrative.
     Only present on /about; bails immediately elsewhere. */
  (function bars(){
    const wrap = document.getElementById("viz-bars");
    if(!wrap) return;
    const fills = wrap.querySelectorAll(".bar-fill");
    if(!fills.length) return;
    function fill(){
      fills.forEach(f => { f.style.width = (parseFloat(f.dataset.pct)||0) + "%"; });
    }
    if(reduceMotion || !("IntersectionObserver" in window)){ fill(); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if(en.isIntersecting){ fill(); io.unobserve(en.target); } });
    }, {threshold:0.4});
    io.observe(wrap);
  })();

  /* ---------- Guardrail / safety-floor panel ----------
     Illustrative permission model. No live integration: clicking only stamps a
     verdict that is already authored in the markup. Keyboard-operable (rows and
     controls are real <button>s). Under reduced-motion CSS shows every verdict
     statically; here we mirror that state without sequencing any motion.
     Only present on the home page; bails immediately elsewhere. */
  (function guardrail(){
    const panel = document.getElementById("guard");
    if(!panel) return;
    const rows    = Array.from(panel.querySelectorAll(".guard-row"));
    const runBtn  = document.getElementById("guard-run");
    const resetBtn= document.getElementById("guard-reset");
    const status  = document.getElementById("guard-status");
    if(!rows.length) return;

    const stamp   = row => row.classList.add("stamped");
    const unstamp = row => row.classList.remove("stamped");

    // Counts are derived from the actual rows' data-verdict, never hardcoded,
    // so the screen-reader announcement always matches what is on screen.
    function verdictCounts(){
      return rows.reduce((c, row) => {
        const v = row.getAttribute("data-verdict");
        if(v === "allow")   c.allow++;
        else if(v === "approve") c.approve++;
        else if(v === "block")   c.block++;
        return c;
      }, {allow:0, approve:0, block:0});
    }
    // Announce completion for keyboard / screen-reader users (visually hidden, polite).
    function announceDone(){
      if(!status) return;
      const c = verdictCounts();
      status.textContent = "Checks complete. " + c.allow + " allowed, " +
        c.approve + " need approval, " + c.block + " blocked.";
    }
    function clearStatus(){ if(status) status.textContent = ""; }

    // Clicking a single action toggles its own verdict in/out.
    rows.forEach(row => {
      row.addEventListener("click", () => {
        row.classList.toggle("stamped");
      });
    });

    // Reduced motion: reveal all verdicts at once, no sequencing, and leave them.
    if(reduceMotion){
      rows.forEach(stamp);
      announceDone();
      if(runBtn) runBtn.addEventListener("click", () => { rows.forEach(stamp); announceDone(); });
      if(resetBtn) resetBtn.addEventListener("click", () => { rows.forEach(unstamp); clearStatus(); });
      return;
    }

    // "Run the checks": clear, then stamp each verdict in sequence. Guarded so
    // repeated clicks cancel any in-flight run instead of stacking timers.
    let timers = [];
    function clearTimers(){ timers.forEach(clearTimeout); timers = []; }
    function runChecks(){
      clearTimers();
      clearStatus();
      rows.forEach(unstamp);
      rows.forEach((row, i) => {
        timers.push(setTimeout(() => stamp(row), 140 + i * 230));
      });
      // Announce once, just after the final verdict has stamped in.
      timers.push(setTimeout(announceDone, 140 + rows.length * 230));
    }
    if(runBtn) runBtn.addEventListener("click", runChecks);
    if(resetBtn) resetBtn.addEventListener("click", () => { clearTimers(); rows.forEach(unstamp); clearStatus(); });

    // Auto-play AT MOST ONCE per page load when the panel first scrolls into view
    // (motion already allowed here). The flag plus unobserve guarantee it never
    // loops; manual "Run the checks" / "Reset" stay available afterward.
    let autoPlayed = false;
    if("IntersectionObserver" in window){
      const io = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if(en.isIntersecting && !autoPlayed){ autoPlayed = true; io.unobserve(en.target); runChecks(); }
        });
      }, {threshold:0.45});
      io.observe(panel);
    } else {
      runChecks();
    }
  })();

})();
