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

  /* ---------- Shared animation ticker: ONE requestAnimationFrame for the whole page ----------
     Every node-field instance (the hero, the about-page echo, and the new
     site-wide ambient backdrop) registers a per-frame callback here instead of
     owning its own rAF. The single loop below is the ONLY requestAnimationFrame
     driving these canvases, so adding the ambient layer does not add a second
     loop. It also centralizes the safety contract: it never runs under
     reduced-motion, it pauses on a hidden tab and resumes only when visible,
     and a registered field that becomes empty simply stops being ticked. */
  const ticker = (function(){
    const cbs = new Set();   // active per-frame callbacks
    let raf = null;          // the single in-flight frame (null when idle)
    let last = 0;            // timestamp of the previous frame, for a dt clamp
    function frame(now){
      // Clamp dt so a backgrounded then resumed tab cannot jump the motion.
      const dt = last ? Math.min(2, (now - last) / 16.6667) : 1;
      last = now;
      // Iterate a snapshot so a callback can unregister mid-frame safely.
      cbs.forEach(cb => { try { cb(dt); } catch(e){ /* never let one field break the loop */ } });
      raf = cbs.size ? requestAnimationFrame(frame) : null;
    }
    function arm(){ // idempotent: at most one frame in flight
      if(reduceMotion || raf || document.hidden || !cbs.size) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    }
    function add(cb){ cbs.add(cb); arm(); }
    function remove(cb){ cbs.delete(cb); }
    function stopAll(){ if(raf){ cancelAnimationFrame(raf); raf = null; } }
    // Pause on hidden tab, resume when visible. One listener for every field.
    document.addEventListener("visibilitychange", () => {
      if(document.hidden) stopAll(); else arm();
    });
    return { add, remove, arm };
  })();

  function nodeField(canvas, opts){
    if(!canvas || reduceMotion) return null;
    const ctx = canvas.getContext("2d");
    if(!ctx) return null;
    const o = Object.assign({
      area:22000, min:14, max:42,   // density: nodes ~= w*h/area, clamped [min,max]
      linkDist:130, linkAlpha:0.35, // link reach (px) and peak opacity
      dotAlpha:0.7, dotR:1.6,       // node fill opacity and radius (base; stars vary per node)
      speed:0.25,                   // drift speed
      interactive:false,            // attach pointer reactivity?
      influence:120, pull:0.045, maxBoost:0.9, // cursor radius, attraction, velocity clamp near pointer
      roles:false,                  // promote a few nodes to labeled architecture roles + one pulse
      ambient:false,                // site-wide backdrop variant: softer points, lighter links
      glow:true,                    // soft additive glow under points for depth
      stars:true,                   // render points as varied glowing stars with a soft twinkle
      twinkleShare:0.5,             // fraction of stars that gently vary in brightness
      starGlow:2.6                  // halo radius multiplier around each star core
    }, opts||{});
    let w=0, h=0, dpr=Math.min(window.devicePixelRatio||1, 2), nodes=[];
    // Pointer is in CSS px, canvas-local. null = no active pointer (touch / left the field).
    let ptr = null;
    // A field-level, frame-rate-independent clock (sum of dt) that drives the
    // gentle star twinkle. Advanced every frame in step(), so it ticks on the
    // plain ambient field too, not only on the roles hero.
    let skyClock = 0;

    /* ---- Orchestration handoff cycle (hero only, opt-in via roles:true) ----
       A few nodes are promoted to a labeled Coordinator -> Specialists -> Auditor
       topology, and the animation depicts ONE sequenced project handoff at a time,
       so a viewer can read the actual passing of work between agents:

         1 DISPATCH  Coordinator sends a "task" token to BOTH specialists at once.
         2 WORK      Each specialist shows a filling progress arc (processing).
         3 RETURN    Each specialist sends a "result" token to the Auditor.
         4 GATE      The Auditor emits a verdict. Usually "pass" -> a "done" token
                     to the Coordinator. About 1 in 3 cycles it emits "revise" ->
                     a token back to one specialist, which re-works and re-returns,
                     then passes. This shows the iterate loop honestly.
         5 repeat with the next task, continuously but one clear cycle at a time.

       Everything lives inside the SINGLE rAF below. Tokens are a small, hard-capped
       pool (<= 4 live) of eased lerps plus a glow, not a second engine. Roles is
       opt-in, so the faint Data-section echo stays a plain field.

       Role indices: 0 Coordinator, 1 Specialist A, 2 Specialist B, 3 Auditor. */
    let roleNodes = [];   // pinned role anchors, indexed as above
    let labelAlpha = 0;   // eases 0 -> 1 over the first cycle so labels do not pop in
    const SPECIALISTS = [1,2,3,4]; // role indices that do work
    const AUDITOR = 5, COORD = 0;
    // Verdict palette: pass = brand green (--ok), revise = amber (matches the
    // guardrail "needs approval" pill). Tokens otherwise use the accent blend.
    const OK_RGB = [67,214,146];     // --ok  #43d692
    const AMBER_RGB = [246,196,84];  //       #f6c454
    // One token in flight along a connector. color: "accent" | "ok" | "amber".
    // A capped pool: at most one per specialist plus one verdict token, with headroom.
    let tokens = [];            // active tokens this frame
    const TOKEN_SPEED = 0.018;  // fraction of the hop per frame (slow, readable)
    // Per-specialist work progress 0..1 (the filling arc); -1 means "not working".
    let workProg = {};
    // The cycle state machine. One phase at a time; timers are frame counters so
    // everything advances off the single rAF and pauses with it on a hidden tab.
    const cyc = {
      phase:"idle",   // idle | dispatch | work | return | gate | verdict | done
      timer:0,        // frames remaining in a holding phase
      revise:false,   // is this a revise cycle?
      reviseTarget:1, // which specialist re-works on a revise
      reworked:false, // has the revise rework already happened?
      pending:0       // tokens that must arrive before the phase advances
    };
    let cycleCount = 0; // drives the deterministic "1 in 3 cycles revises" cadence
    let phaseClock = 0; // ever-increasing dt sum; feeds gentle sine pulses on active nodes
    function layoutRoles(){
      // Pin role anchors to the RIGHT half / lower band, the hero's whitespace, so the
      // labels never sit on the H1 or lede. On narrow viewports the text fills the width,
      // so labels are suppressed entirely (see the width guard in step()).
      roleNodes = [
        { x:w*0.62, y:h*0.22, name:"Coordinator" },
        { x:w*0.76, y:h*0.12, name:"Specialist" },
        { x:w*0.87, y:h*0.34, name:"Specialist" },
        { x:w*0.87, y:h*0.66, name:"Specialist" },
        { x:w*0.74, y:h*0.88, name:"Specialist" },
        { x:w*0.96, y:h*0.50, name:"Auditor" }
      ];
    }
    // Mix toward a fixed rgb target (used for the green/amber verdict tokens).
    function rgbStr(c){ return c[0]+","+c[1]+","+c[2]; }
    // Spawn a labeled token traveling from role index a to role index b.
    function addToken(a, b, label, color){
      if(tokens.length >= 12) return; // hard cap, never overflow the pool
      tokens.push({ a:a, b:b, t:0, label:label, color:color||"accent" });
    }
    // Begin a fresh cycle: decide pass vs revise, dispatch a task to each specialist.
    function startCycle(){
      cycleCount++;
      cyc.revise = (cycleCount % 3 === 0);        // ~1 in 3 cycles iterate
      cyc.reviseTarget = SPECIALISTS[cycleCount % SPECIALISTS.length]; // rotate which specialist
      cyc.reworked = false;
      cyc.phase = "dispatch";
      cyc.pending = SPECIALISTS.length;
      tokens = [];
      SPECIALISTS.forEach(s => { workProg[s] = -1; });
      SPECIALISTS.forEach(s => addToken(COORD, s, "task", "accent"));
    }
    // Advance the cycle when a phase's tokens have all arrived (called from step()).
    function onTokenArrive(tok){
      if(cyc.phase === "dispatch" && tok.label === "task"){
        // A task reached a specialist: it starts working (arc fills in WORK phase).
        workProg[tok.b] = 0;
        cyc.pending--;
        if(cyc.pending <= 0){ cyc.phase = "work"; }
      } else if(cyc.phase === "return" && tok.label === "result"){
        cyc.pending--;
        if(cyc.pending <= 0){ cyc.phase = "gate"; cyc.timer = 46; } // auditor "thinks"
      } else if(cyc.phase === "verdict"){
        if(tok.label === "done"){
          cyc.phase = "done"; cyc.timer = 52; // brief rest, then next task
        } else if(tok.label === "revise"){
          // Revise reached a specialist: it re-works, then re-returns one result.
          workProg[tok.b] = 0; cyc.reworked = true; cyc.phase = "rework";
        } else if(tok.label === "result"){
          // The re-worked result reached the auditor: now it passes.
          cyc.phase = "gate"; cyc.timer = 40; cyc.revise = false;
        }
      }
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
        // z is a depth factor in 0.45..1: nearer stars (z->1) are larger,
        // brighter and drift a little faster; farther stars (z->0.45) recede.
        // This gives the field real layering/parallax without adding nodes.
        const z = 0.45 + Math.random()*0.55;
        // Per-star variety so the field reads as a real sky, not a uniform grid:
        //   mag    a brightness magnitude in ~0.55..1.15 (a few bright, many faint),
        //   rJit   a small radius jitter so star sizes are not all identical,
        //   twPh   a random phase, twAmp the per-star twinkle depth (0 = steady).
        // Only a subset twinkles, and only when stars mode is on.
        const mag = 0.55 + Math.pow(Math.random(), 1.7)*0.6;
        const twinkles = o.stars && (Math.random() < o.twinkleShare);
        nodes.push({
          x:Math.random()*w, y:Math.random()*h,
          vx:(Math.random()-.5)*o.speed*z, vy:(Math.random()-.5)*o.speed*z,
          z:z, mag:mag, rJit:0.8 + Math.random()*0.8,
          twPh:Math.random()*Math.PI*2, twAmp:twinkles ? 0.18 + Math.random()*0.22 : 0
        });
      }
      if(o.roles){
        layoutRoles();
        // Reset the cycle cleanly on (re)size so a resize never strands a token.
        tokens = []; workProg = {}; SPECIALISTS.forEach(s => { workProg[s] = -1; });
        cyc.phase = "idle"; cyc.timer = 30; // short beat before the first dispatch
      }
    }
    // One frame of this field. dt (~1 at 60fps) scales motion so speed is
    // frame-rate independent. Called by the shared ticker, never self-arming.
    function step(dt){
      dt = dt || 1;
      skyClock += dt; // advance the twinkle clock every frame (all fields)
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
        // Keep a floor of motion so the field never freezes after damping. The
        // floor scales with the node's depth so parallax layering is preserved.
        const sp=Math.hypot(n.vx,n.vy), floor=o.speed*0.45*(n.z||1);
        if(sp<floor && sp>0){ const k=floor/sp; n.vx*=k; n.vy*=k; }
        // Clamp peak speed near the pointer so it stays smooth, never jumpy.
        if(sp>o.maxBoost){ const k=o.maxBoost/sp; n.vx*=k; n.vy*=k; }
        n.x+=n.vx*dt; n.y+=n.vy*dt;
        if(n.x<0||n.x>w) n.vx*=-1;
        if(n.y<0||n.y>h) n.vy*=-1;
        n.x=n.x<0?0:n.x>w?w:n.x; n.y=n.y<0?0:n.y>h?h:n.y;
        // Per-star brightness for this frame: depth * magnitude, modulated by a
        // slow twinkle on the subset that twinkles (twAmp 0 leaves it steady).
        // Computed once here and reused by both the link pass and the star pass.
        const tw = n.twAmp ? (1 + n.twAmp*Math.sin(skyClock*0.05 + n.twPh)) : 1;
        n.bri = (0.55 + 0.45*(n.z||1)) * (n.mag||1) * tw;
      }
      // Constellation links: faint, thin lines between nearby stars whose opacity
      // scales with proximity (quadratic falloff) so the links read as constellations
      // forming and dissolving as the stars drift, never popping. The opacity also
      // scales with the two endpoint stars' brightness, so a line between two bright
      // stars reads a touch stronger and the faint background stays quiet. Per-segment
      // gradient between the two accent tints; hairline width keeps text readable.
      // Same O(n^2) pass over a hard-capped star count, so cost is unchanged.
      ctx.lineCap = "round";
      for(let i=0;i<nodes.length;i++){
        const a=nodes[i];
        const ta = w ? a.x/w : 0.5;
        for(let j=i+1;j<nodes.length;j++){
          const b=nodes[j];
          const dx=a.x-b.x, dy=a.y-b.y, d=Math.hypot(dx,dy);
          if(d<o.linkDist){
            const fall=1-d/o.linkDist;            // 1 close .. 0 at reach
            const lum=Math.min(1,((a.bri||1)+(b.bri||1))*0.5); // mean star brightness
            const alpha=fall*fall*o.linkAlpha*(0.45+0.55*lum);
            if(alpha < 0.004) continue;           // skip imperceptible links (cheap)
            const tb = w ? b.x/w : 0.5;
            const g = ctx.createLinearGradient(a.x,a.y,b.x,b.y);
            g.addColorStop(0,"rgba("+mix(ta)+","+alpha.toFixed(3)+")");
            g.addColorStop(1,"rgba("+mix(tb)+","+alpha.toFixed(3)+")");
            ctx.strokeStyle=g;
            ctx.lineWidth=0.5+0.4*lum;            // thin hairlines, faint links stay readable
            ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
          }
        }
      }
      // Nodes: gradient blend by x-position, sized and brightened by depth. On
      // Stars. Each star is drawn in two parts: a soft additive halo tinted to
      // the brand accent (blended by x-position), then a crisp near-white core
      // that carries a faint accent tint, so the points read as glowing starlight
      // over the dark sky. Size and brightness vary per star (depth, magnitude,
      // twinkle), giving the field the look of a real night sky rather than a
      // uniform dot grid. The halo pass uses "lighter" so overlapping glows add
      // like light; it is skipped when o.glow is off to stay cheap.
      if(o.glow){
        ctx.globalCompositeOperation = "lighter";
        for(const n of nodes){
          const t=w?n.x/w:0.5, z=n.z||1, col=mix(t);
          const bri=n.bri||1;
          const gr=o.dotR*o.starGlow*(1.6+1.4*z)*(0.7+0.5*(n.mag||1));
          const rg=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,gr);
          rg.addColorStop(0,"rgba("+col+","+(0.22*bri).toFixed(3)+")");
          rg.addColorStop(0.4,"rgba("+col+","+(0.07*bri).toFixed(3)+")");
          rg.addColorStop(1,"rgba("+col+",0)");
          ctx.fillStyle=rg;
          ctx.beginPath(); ctx.arc(n.x,n.y,gr,0,Math.PI*2); ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }
      // Star cores: near-white with a light accent tint, so they look like points
      // of starlight, not flat blue dots. Radius and opacity carry the per-star
      // size jitter and brightness. Opacity is clamped so the brightest stars stay
      // subtle enough to never compete with body text.
      for(const n of nodes){
        const t=w?n.x/w:0.5, z=n.z||1, col=mix(t);
        const bri=n.bri||1;
        const r=o.dotR*(0.55+0.55*z)*(n.rJit||1);
        const a=Math.min(0.92, o.dotAlpha*bri);
        // a soft accent-tinted white: most of the way to white, kept tinted.
        const cs=col.split(",");
        const wr=Math.round(+cs[0]+(255-+cs[0])*0.6);
        const wg=Math.round(+cs[1]+(255-+cs[1])*0.6);
        const wb=Math.round(+cs[2]+(255-+cs[2])*0.6);
        ctx.fillStyle="rgba("+wr+","+wg+","+wb+","+a.toFixed(3)+")";
        ctx.beginPath(); ctx.arc(n.x,n.y,r,0,Math.PI*2); ctx.fill();
      }

      // ---- Orchestration handoff cycle (hero only) ----
      // The FOCUS of the animation: directional, ordered, labeled tokens moving
      // along the connectors between role nodes, one readable cycle at a time.
      if(o.roles && roleNodes.length){
        if(labelAlpha < 1) labelAlpha = Math.min(1, labelAlpha + 0.012*dt); // ease labels in once
        phaseClock += dt; // smooth, frame-rate independent clock for gentle pulses
        const C = roleNodes[COORD], A = roleNodes[AUDITOR];

        // 1) The fixed topology connectors, drawn faint under everything so the
        //    handoff routes (Coordinator -> Specialists -> Auditor -> Coordinator)
        //    read as a stable diagram even between token hops. Each route is a
        //    true gradient between its endpoints' accent tints and uses rounded
        //    caps, so the standing diagram looks deliberate, not wiry.
        ctx.lineWidth = 1.3; ctx.lineCap = "round";
        const route = (a, b) => {
          const ta = w ? a.x/w : 0.5, tb = w ? b.x/w : 0.5;
          const g = ctx.createLinearGradient(a.x,a.y,b.x,b.y);
          g.addColorStop(0,"rgba("+mix(ta)+",0.20)");
          g.addColorStop(1,"rgba("+mix(tb)+",0.20)");
          ctx.strokeStyle = g;
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        };
        SPECIALISTS.forEach(s => { route(C, roleNodes[s]); route(roleNodes[s], A); });
        route(A, C); // auditor -> coordinator (the "done" return path)

        // 2) Advance the cycle state machine off this single rAF tick. All
        //    progress and timers scale by dt so the cycle reads at the same pace
        //    regardless of refresh rate.
        if(cyc.phase === "idle"){
          if(cyc.timer > 0) cyc.timer -= dt; else startCycle();
        } else if(cyc.phase === "work"){
          // Specialists process: fill each arc, then send results to the auditor.
          let allDone = true;
          SPECIALISTS.forEach(s => {
            if(workProg[s] >= 0 && workProg[s] < 1){ workProg[s] = Math.min(1, workProg[s] + 0.014*dt); }
            if(workProg[s] < 1) allDone = false;
          });
          if(allDone){
            cyc.phase = "return"; cyc.pending = SPECIALISTS.length;
            SPECIALISTS.forEach(s => addToken(s, AUDITOR, "result", "accent"));
          }
        } else if(cyc.phase === "gate"){
          // The auditor "thinks", then emits its verdict token.
          if(cyc.timer > 0){ cyc.timer -= dt; }
          else {
            cyc.phase = "verdict";
            if(cyc.revise && !cyc.reworked){
              addToken(AUDITOR, cyc.reviseTarget, "revise", "amber"); // back to a specialist
            } else {
              addToken(AUDITOR, COORD, "done", "ok"); // pass -> coordinator
            }
          }
        } else if(cyc.phase === "rework"){
          // The revised specialist re-works, then re-returns a single result.
          const s = cyc.reviseTarget;
          if(workProg[s] >= 0 && workProg[s] < 1){ workProg[s] = Math.min(1, workProg[s] + 0.016*dt); }
          if(workProg[s] >= 1){
            cyc.phase = "verdict";
            addToken(s, AUDITOR, "result", "accent");
          }
        } else if(cyc.phase === "done"){
          if(cyc.timer > 0){ cyc.timer -= dt; } else { cyc.phase = "idle"; cyc.timer = 22; }
        }

        // 3) Move + draw tokens. Each is an eased glide along its hop; on arrival it
        //    notifies the state machine. Labels ride just above each token, faint.
        //    Labels are dropped below ~700px (phones / narrow tablets), where the
        //    hero text fills the column, so they can never compete with the H1.
        const showLabels = w >= 700;
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineCap = "round";
        const survivors = [];
        for(const tok of tokens){
          tok.t += TOKEN_SPEED*dt;
          const a = roleNodes[tok.a], b = roleNodes[tok.b];
          // easeInOutCubic: a smoother accel/decel than the old quad, so the
          // packet eases out of a node and settles into the next more gracefully.
          const tt = tok.t < 0.5 ? 4*tok.t*tok.t*tok.t : 1-Math.pow(-2*tok.t+2,3)/2;
          const px = a.x+(b.x-a.x)*tt, py = a.y+(b.y-a.y)*tt;
          // A short trailing point, so the head reads as moving and leaves a comet.
          const trail = Math.max(0, tt-0.16);
          const qx = a.x+(b.x-a.x)*trail, qy = a.y+(b.y-a.y)*trail;
          // Color: accent blend, or a fixed green/amber for verdict tokens.
          const cv = tok.color === "ok" ? rgbStr(OK_RGB)
                   : tok.color === "amber" ? rgbStr(AMBER_RGB)
                   : mix(w ? px/w : 0.5);
          // The lit connector segment the token has covered: a gradient that
          // fades from the source toward a brighter head, so the hop reads as a
          // directional flow rather than a free-floating dot.
          const seg = ctx.createLinearGradient(a.x,a.y,px,py);
          seg.addColorStop(0,"rgba("+cv+",0.08)");
          seg.addColorStop(1,"rgba("+cv+",0.45)");
          ctx.strokeStyle = seg; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(px,py); ctx.stroke();
          // Comet trail behind the head, additive for a soft light streak.
          const tg = ctx.createLinearGradient(qx,qy,px,py);
          tg.addColorStop(0,"rgba("+cv+",0)");
          tg.addColorStop(1,"rgba("+cv+",0.6)");
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = tg; ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.moveTo(qx,qy); ctx.lineTo(px,py); ctx.stroke();
          // Soft glow head, gently pulsing so the packet feels alive but calm.
          const pulse = 1 + 0.12*Math.sin(phaseClock*0.18 + tok.t*6);
          const gr = 9*pulse;
          const grad = ctx.createRadialGradient(px,py,0,px,py,gr);
          grad.addColorStop(0,"rgba("+cv+",0.9)");
          grad.addColorStop(1,"rgba("+cv+",0)");
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(px,py,gr,0,Math.PI*2); ctx.fill();
          ctx.restore();
          // Crisp core on top.
          ctx.fillStyle = "rgba("+cv+",0.96)";
          ctx.beginPath(); ctx.arc(px,py,2.6,0,Math.PI*2); ctx.fill();
          // Token label, small and faint, carried just above the moving token.
          if(showLabels){
            ctx.font = "600 9.5px -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif";
            ctx.fillStyle = "rgba("+cv+","+(0.85*labelAlpha).toFixed(3)+")";
            ctx.fillText(tok.label, px, py-12);
          }
          if(tok.t >= 1){ onTokenArrive(tok); } else { survivors.push(tok); }
        }
        tokens = survivors;

        // 4) Role nodes. Specialists show a "working" progress arc while processing;
        //    the auditor ring tints to its verdict color during the gate/verdict.
        const auditorActive = (cyc.phase === "gate" || cyc.phase === "verdict");
        const auditorTint = auditorActive
          ? (cyc.revise && !cyc.reworked ? rgbStr(AMBER_RGB) : (cyc.reworked || !cyc.revise ? rgbStr(OK_RGB) : null))
          : null;
        ctx.font = "600 11px -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif";
        // A calm shared pulse (0..1) for active nodes, so a working specialist or
        // gating auditor breathes gently rather than sitting static or flashing.
        const pulse = 0.5 + 0.5*Math.sin(phaseClock*0.12);
        roleNodes.forEach((rn, idx) => {
          const t = w ? rn.x/w : 0.5, col = mix(t);
          const isSpec = SPECIALISTS.indexOf(idx) !== -1;
          const working = isSpec && workProg[idx] >= 0 && workProg[idx] < 1;
          const auditing = (idx === AUDITOR && auditorTint);
          // Soft glow under an active node (additive): the "light" on whoever is
          // currently doing work, tinted to the verdict color while the auditor gates.
          if(working || auditing){
            const glowCol = auditing ? auditorTint : col;
            const gr = 16 + 5*pulse;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            const rg = ctx.createRadialGradient(rn.x,rn.y,0,rn.x,rn.y,gr);
            rg.addColorStop(0,"rgba("+glowCol+","+(0.22+0.12*pulse).toFixed(3)+")");
            rg.addColorStop(1,"rgba("+glowCol+",0)");
            ctx.fillStyle = rg;
            ctx.beginPath(); ctx.arc(rn.x,rn.y,gr,0,Math.PI*2); ctx.fill();
            ctx.restore();
          }
          // Base node + ring.
          ctx.fillStyle = "rgba("+col+",0.95)";
          ctx.beginPath(); ctx.arc(rn.x,rn.y,3.4,0,Math.PI*2); ctx.fill();
          ctx.strokeStyle = "rgba("+col+","+(working?0.3:0.5)+")"; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(rn.x,rn.y,7,0,Math.PI*2); ctx.stroke();
          // Specialist working arc: a progress sweep from the top, clockwise.
          if(working){
            ctx.strokeStyle = "rgba("+col+",0.9)"; ctx.lineWidth = 2; ctx.lineCap = "round";
            ctx.beginPath();
            ctx.arc(rn.x, rn.y, 7, -Math.PI/2, -Math.PI/2 + Math.PI*2*workProg[idx]);
            ctx.stroke();
            ctx.lineCap = "butt";
          }
          // Auditor verdict ring tint during the gate.
          if(auditing){
            ctx.strokeStyle = "rgba("+auditorTint+",0.85)"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(rn.x,rn.y,10,0,Math.PI*2); ctx.stroke();
          }
          // Role label, eased in, dropped on narrow viewports so it never competes
          // with the H1 or lede for legibility.
          if(showLabels){
            ctx.fillStyle = "rgba(231,233,238,"+(0.62*labelAlpha).toFixed(3)+")";
            ctx.fillText(rn.name, rn.x, rn.y - 16);
          }
        });
      }
    }
    // start()/stop() register or unregister this field's step with the shared
    // ticker. Idempotent (the ticker holds callbacks in a Set), and start never
    // does anything under reduced-motion since this field is never created then.
    function start(){ ticker.add(step); }
    function stop(){ ticker.remove(step); }

    resize();
    // Paint ONE full frame synchronously, before the rAF loop is consulted, so
    // the constellation is on screen immediately on load. The shared ticker gates
    // its rAF on document.hidden (correct: it pauses animation for a backgrounded
    // tab), but that gate also used to suppress the very first paint, leaving a
    // background-loaded or unfocused tab showing a blank canvas until it gained
    // focus. Drawing here with dt=0 lays down the initial layout with no motion
    // advance (drift, twinkle and the handoff clock all scale by dt), so the
    // field never flashes blank and is screenshot-able regardless of focus; the
    // rAF loop then animates from this exact frame once the tab is visible.
    step(0);
    start();
    window.addEventListener("resize", () => { resize(); });

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

  /* ---------- Site-wide ambient backdrop (every page) ----------
     Injects ONE fixed, full-viewport canvas as the first child of <body>, then
     runs a faint, drift-only night-sky starfield on it. No html file is touched.
     The canvas is aria-hidden, pointer-events:none, and lives at z-index:-1
     (behind all content, above the page background), so it can never affect
     layout, scroll, overflow, or text legibility. It shares the single page rAF
     via the ticker, and is never created under reduced-motion.

     CONSISTENCY: the field parameters are IDENTICAL on every page, including the
     home page. The home hero is a separate, brighter canvas inside the header;
     below it (and on every other page) this same quiet starfield carries through,
     so the background reads the same everywhere instead of being prominent only
     on home. The CSS gives the layer one even, full-viewport opacity on all pages
     and only eases the very top band under the home hero so the two layers
     compose as one sky rather than competing. */
  (function ambientBackdrop(){
    const hero = document.getElementById("hero-canvas");
    // Flag the home page so CSS can ease the ambient layer under the hero only.
    if(hero && document.body){ document.body.classList.add("has-hero"); }
    // Skip the work entirely under reduced-motion (no canvas, nothing to clean up).
    if(reduceMotion || !document.body) return;
    if(document.getElementById("ambient-bg")) return; // never inject twice
    const c = document.createElement("canvas");
    c.id = "ambient-bg";
    c.setAttribute("aria-hidden", "true");
    // First child so it paints behind the skip-link, nav, main and footer.
    document.body.insertBefore(c, document.body.firstChild);
    // A calm, sparse, slow starfield. Same on every page so the sky is consistent.
    // Star count is capped and scaled by viewport area, so it stays cheap on phones.
    nodeField(c, {
      area: 30000, min: 18, max: 72,
      linkDist: 165, linkAlpha: 0.36, dotAlpha: 0.82, dotR: 1.6,
      speed: 0.10, interactive: false, glow: true, starGlow: 3.4, twinkleShare: 0.6
    });
  })();

  // Hero: cursor-reactive, the featured constellation CLUSTER. Same star visual
  // language as the site-wide sky, but brighter and a little denser so the hero
  // reads as the focal cluster within the same night sky. The labeled Coordinator
  // -> Specialists -> Auditor handoff CYCLE (roles:true) layers on top of the stars
  // and remains the meaningful focus; the drifting stars behind it never compete.
  // getElementById returns null on pages without the hero; nodeField no-ops on null.
  nodeField(document.getElementById("hero-canvas"), {
    interactive:true, roles:true,
    area:30000, max:38, linkDist:155, linkAlpha:0.36, dotAlpha:0.86, dotR:1.7,
    speed:0.16, starGlow:3.4, twinkleShare:0.5
  });
  // Data section: a fainter, sparser echo of the same starfield. Not interactive.
  // Only present on /about; null elsewhere, so this no-ops cleanly.
  nodeField(document.getElementById("data-echo"), {
    area:30000, min:8, max:22, linkDist:120, linkAlpha:0.16,
    dotAlpha:0.5, dotR:1.3, speed:0.16, interactive:false, starGlow:2.6, twinkleShare:0.5
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
      // Reduced motion OR a hidden tab: rAF will not advance to completion, so a
      // started animation would freeze at the in-flight floor value (e.g. "1%") on a
      // headline proof metric. Commit the true value now; animate only when visible.
      if(reduceMotion || document.hidden){ el.textContent = target + suffix; return; }
      const dur = 1100, t0 = performance.now();
      function tick(now){
        const p = Math.min(1, (now - t0)/dur);
        const eased = 1 - Math.pow(1 - p, 3);
        // Floor the in-flight value so a headline proof metric never flashes a
        // misleading 0 (e.g. "0%") on the first frame. For a positive target the
        // count starts at 1 and ramps up; for a non-positive target we leave the
        // rounded value as-is. The final frame below always lands on the real value.
        let v = Math.round(target * eased);
        if(target >= 1 && v < 1){ v = 1; }
        el.textContent = v + suffix;
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

  /* ---------- Triage classifier demo (the Triage Desk on /lab) ----------
     A self-contained, honest illustration of the propose-then-confirm pattern on
     SYNTHETIC data in a neutral domain (generic support-message snippets sorted
     into Billing, Bug, How-to, Feedback). Everything here is transparent and
     reproducible: a simple keyword/heuristic classifier assigns a proposed
     category plus a confidence score, and EVERY displayed number is computed
     live in this function from the data below, never hardcoded.

     The honest point: triage does not remove the human, it routes attention to
     the ambiguous cases. Items at or above the confidence threshold are offered
     for bulk-confirm; the rest are sent to hand review. The "lift" is the share
     of items the human no longer has to open one by one.

     Root-checked: bails immediately on pages without #triage. No network, no
     library. Keyboard-operable (real <button>s + a labeled range input with
     aria), and a reduced-motion path that skips the staged reveal. */
  (function triageDemo(){
    const root = document.getElementById("triage");
    if(!root) return;

    // ---- Synthetic dataset (54 items). Each: text + hidden ground-truth label.
    // Neutral, obviously illustrative support-style snippets. No employer domain.
    const DATA = [
      { text: "I was charged twice for my subscription this month", truth: "Billing" },
      { text: "Can I get a refund for the duplicate payment?", truth: "Billing" },
      { text: "My invoice total looks wrong compared to last month", truth: "Billing" },
      { text: "How do I update the credit card on my account?", truth: "Billing" },
      { text: "You charged me after I cancelled my plan", truth: "Billing" },
      { text: "Where can I download a receipt for my payment?", truth: "Billing" },
      { text: "My subscription renewed but I wanted to cancel", truth: "Billing" },
      { text: "The price I was billed does not match the checkout page", truth: "Billing" },
      { text: "I need a copy of last quarter's invoices for expenses", truth: "Billing" },
      { text: "Why was there an extra fee on my latest charge?", truth: "Billing" },
      { text: "Can you switch my billing cycle to annual?", truth: "Billing" },
      { text: "I think I was overcharged on tax for my order", truth: "Billing" },

      { text: "The app crashes every time I open the reports tab", truth: "Bug" },
      { text: "Export to CSV throws an error and nothing downloads", truth: "Bug" },
      { text: "The page is stuck loading and never finishes", truth: "Bug" },
      { text: "Login is broken on Safari, it just reloads", truth: "Bug" },
      { text: "I get a 500 error when I try to save settings", truth: "Bug" },
      { text: "The dashboard shows a blank screen after the update", truth: "Bug" },
      { text: "Notifications stopped working since yesterday", truth: "Bug" },
      { text: "The search bar freezes the whole app when I type", truth: "Bug" },
      { text: "Uploading a photo fails with an unknown error", truth: "Bug" },
      { text: "The mobile layout is glitching and text overlaps", truth: "Bug" },
      { text: "Clicking submit does nothing, the button is unresponsive", truth: "Bug" },
      { text: "Data is not syncing between my laptop and phone", truth: "Bug" },

      { text: "How do I invite a teammate to my workspace?", truth: "How-to" },
      { text: "Where is the setting to turn on dark mode?", truth: "How-to" },
      { text: "What is the way to export my data to a spreadsheet?", truth: "How-to" },
      { text: "How can I reset my password if I am locked out?", truth: "How-to" },
      { text: "Is there a guide for setting up two-factor auth?", truth: "How-to" },
      { text: "How do I connect my calendar to the app?", truth: "How-to" },
      { text: "Where do I find the option to change my username?", truth: "How-to" },
      { text: "What steps do I follow to archive an old project?", truth: "How-to" },
      { text: "How do I set up notifications for just my team?", truth: "How-to" },
      { text: "Can you explain how to merge two accounts?", truth: "How-to" },
      { text: "How do I create a shared folder for the group?", truth: "How-to" },
      { text: "Where is the tutorial for the reporting feature?", truth: "How-to" },

      { text: "Love the new design, it feels so much cleaner", truth: "Feedback" },
      { text: "It would be great if you added a calendar view", truth: "Feedback" },
      { text: "Honestly the best tool I have used for this, thank you", truth: "Feedback" },
      { text: "Please consider adding a feature to bulk edit tags", truth: "Feedback" },
      { text: "The recent update made the app so much faster, nice work", truth: "Feedback" },
      { text: "I wish there was a way to customize the dashboard layout", truth: "Feedback" },
      { text: "Your support team has been wonderful, really appreciate it", truth: "Feedback" },
      { text: "A suggestion: let us pin our favorite reports to the top", truth: "Feedback" },
      { text: "This has saved my team so much time, keep it up", truth: "Feedback" },
      { text: "It would be nice to have a darker color option someday", truth: "Feedback" },
      { text: "Really happy with how intuitive everything is now", truth: "Feedback" },
      { text: "Would love an integration with our chat tool down the line", truth: "Feedback" },

      // Deliberately ambiguous items: they trip more than one category's
      // keywords, so the classifier is genuinely uncertain and routes them to a
      // human. This is the point: review load is never zero, and the hard cases
      // are exactly the ones a person should own.
      { text: "Thanks, but the new update changed where my invoice lives", truth: "Billing" },
      { text: "Quick question and also some feedback on the export flow", truth: "How-to" },
      { text: "The export keeps failing and honestly it is frustrating", truth: "Bug" },
      { text: "How do I get a refund, the page just errors out", truth: "Billing" },
      { text: "Great app, but how do I change my billing date?", truth: "How-to" },
      { text: "Love it, though the invoice screen crashed on me", truth: "Bug" }
    ];

    // ---- Transparent keyword classifier. ----
    // For each category we keep weighted keyword lists. We lower-case the item,
    // score every category by summing the weights of the keywords it contains,
    // and pick the highest as the proposed category.
    //
    // Confidence blends two plain signals, both in 0..1:
    //   margin   = (top - runnerUp) / (top + runnerUp)
    //              how clearly the winner beat the second-best category. 1.0 when
    //              only one category matched, ~0 when two categories tie. This is
    //              the real "is the agent sure?" signal: contested items score low.
    //   evidence = min(1, top / SAT)        (SAT = 5)
    //              absolute strength of the winning evidence, so a single weak
    //              keyword cannot read as fully confident.
    //   confidence = 0.55 * margin + 0.45 * evidence
    // Every term is deterministic arithmetic on the keyword hits, so the score is
    // fully reproducible and explainable. This is intentionally a simple
    // heuristic, not a model; it is labeled as such in the copy.
    const SAT = 5; // evidence saturation point (weight at which strength maxes out)
    const RULES = {
      "Billing":  [["charge",2],["charged",2],["refund",2],["invoice",2],["payment",2],["billed",2],
                   ["bill",1],["billing",2],["subscription",1],["price",1],["fee",2],["receipt",2],
                   ["card",1],["overcharged",3],["renewed",1],["cancel",1],["cancelled",1],["tax",1],["cycle",1]],
      "Bug":      [["crash",3],["crashes",3],["error",2],["broken",3],["stuck",2],["freezes",3],
                   ["freeze",2],["glitch",2],["glitching",2],["fails",2],["fail",2],["500",2],
                   ["blank",2],["unresponsive",3],["not syncing",3],["stopped working",3],["reloads",1],["overlaps",1]],
      "How-to":   [["how do i",3],["how can i",3],["how do",2],["where is",2],["where do",2],["where can",2],
                   ["what is the way",2],["what steps",2],["guide",2],["tutorial",2],["set up",1],
                   ["setting",1],["reset my password",2],["connect",1],["explain how",2],["option to",1]],
      "Feedback": [["love",3],["wish",2],["it would be great",3],["it would be nice",3],["would love",3],
                   ["suggestion",3],["please consider",3],["thank you",2],["appreciate",2],["best tool",3],
                   ["keep it up",2],["nice work",2],["happy with",2],["consider adding",3],["let us",2],["feels",1]]
    };
    const CATS = Object.keys(RULES);

    // Score one item: returns { cat, confidence, matched }.
    function classify(text){
      const t = " " + text.toLowerCase() + " ";
      const scores = {};
      CATS.forEach(cat => {
        let s = 0;
        RULES[cat].forEach(([kw, w]) => { if(t.indexOf(kw) !== -1) s += w; });
        scores[cat] = s;
      });
      // Rank categories by score; ties resolve to the earlier category in CATS.
      const ranked = CATS.slice().sort((a, b) => scores[b] - scores[a]);
      const best = ranked[0];
      const top = scores[best];
      const runner = scores[ranked[1]] || 0;
      // No keyword hit at all: a genuine unknown, parked low so it goes to review.
      if(top === 0) return { cat: best, confidence: 0.15, matched: false };
      const margin = (top - runner) / (top + runner); // 0 tied .. 1 uncontested
      const evidence = Math.min(1, top / SAT);         // 0 .. 1 absolute strength
      const confidence = 0.55 * margin + 0.45 * evidence;
      return { cat: best, confidence: confidence, matched: true };
    }

    // Precompute predictions once (data + rules are static, so this is stable).
    const PREDS = DATA.map(item => {
      const r = classify(item.text);
      return { text: item.text, truth: item.truth, pred: r.cat, conf: r.confidence, matched: r.matched };
    });

    // ---- Live metrics computed from PREDS at a given confidence threshold. ----
    // accuracy        = share of all items where pred === truth.
    // autoConfirm     = items with confidence >= threshold (bulk-confirm lane).
    // handReview      = the remaining items (the human opens these individually).
    // autoAccuracy    = accuracy within the auto-confirm lane (quality of bulk lane).
    // liftPct         = reduction in items the human reviews one-by-one
    //                   = autoConfirm.length / total  (everything not hand-reviewed).
    function computeMetrics(threshold){
      const total = PREDS.length;
      let correct = 0, auto = 0, autoCorrect = 0;
      PREDS.forEach(p => {
        if(p.pred === p.truth) correct++;
        if(p.conf >= threshold){ auto++; if(p.pred === p.truth) autoCorrect++; }
      });
      const hand = total - auto;
      return {
        total: total,
        accuracy: total ? correct / total : 0,
        autoCount: auto,
        handCount: hand,
        autoAccuracy: auto ? autoCorrect / auto : 0,
        liftPct: total ? auto / total : 0
      };
    }

    // ---- DOM refs (all optional; guard each use) ----
    const runBtn    = document.getElementById("triage-run");
    const resetBtn  = document.getElementById("triage-reset");
    const slider    = document.getElementById("triage-threshold");
    const threshOut = document.getElementById("triage-threshold-val");
    const flatList  = document.getElementById("triage-flat");
    const groupWrap = document.getElementById("triage-grouped");
    const results   = document.getElementById("triage-results");
    const status    = document.getElementById("triage-status");
    const stage     = root.querySelector(".triage-stage");

    // Number formatting helpers.
    const pct = x => Math.round(x * 100) + "%";

    // Stable category order + accent for grouping headers (reuses theme tokens).
    const CAT_ORDER = ["Billing", "Bug", "How-to", "Feedback"];

    // Build the raw flat queue (everything unlabeled, no structure).
    function renderFlat(){
      if(!flatList) return;
      flatList.innerHTML = "";
      PREDS.forEach(p => {
        const li = document.createElement("li");
        li.className = "triage-item";
        const txt = document.createElement("span");
        txt.className = "ti-text";
        txt.textContent = p.text;
        const tag = document.createElement("span");
        tag.className = "ti-unlabeled";
        tag.textContent = "unlabeled";
        li.appendChild(txt);
        li.appendChild(tag);
        flatList.appendChild(li);
      });
    }

    // Build the triaged queue: grouped by predicted category, sorted by
    // confidence within each group, each item flagged confirm vs review.
    function renderGrouped(threshold){
      if(!groupWrap) return;
      groupWrap.innerHTML = "";
      CAT_ORDER.forEach(cat => {
        const inCat = PREDS.filter(p => p.pred === cat)
                           .sort((a, b) => b.conf - a.conf);
        if(!inCat.length) return;
        const group = document.createElement("div");
        group.className = "triage-group";

        const head = document.createElement("div");
        head.className = "tg-head";
        const name = document.createElement("span");
        name.className = "tg-name";
        name.textContent = cat;
        const count = document.createElement("span");
        count.className = "tg-count";
        count.textContent = inCat.length + (inCat.length === 1 ? " item" : " items");
        head.appendChild(name);
        head.appendChild(count);
        group.appendChild(head);

        const ul = document.createElement("ul");
        ul.className = "tg-list";
        inCat.forEach(p => {
          const li = document.createElement("li");
          li.className = "triage-item triaged";
          const txt = document.createElement("span");
          txt.className = "ti-text";
          txt.textContent = p.text;

          const meta = document.createElement("span");
          meta.className = "ti-meta";
          const confSpan = document.createElement("span");
          confSpan.className = "ti-conf";
          confSpan.textContent = pct(p.conf);
          const lane = document.createElement("span");
          const auto = p.conf >= threshold;
          lane.className = "ti-lane " + (auto ? "lane-auto" : "lane-review");
          lane.textContent = auto ? "bulk-confirm" : "hand review";
          meta.appendChild(confSpan);
          meta.appendChild(lane);

          li.appendChild(txt);
          li.appendChild(meta);
          ul.appendChild(li);
        });
        group.appendChild(ul);
        groupWrap.appendChild(group);
      });
    }

    // Render the results panel from freshly computed metrics.
    function renderResults(threshold){
      if(!results) return;
      const m = computeMetrics(threshold);
      const cells = [
        { v: pct(m.accuracy),     l: "classifier accuracy<br><span class=\"tr-sub\">heuristic vs ground truth, all items</span>" },
        { v: pct(m.liftPct),      l: "fewer items reviewed one by one<br><span class=\"tr-sub\">routed to the bulk-confirm lane</span>" },
        { v: m.handCount + "",    l: "items still need hand review<br><span class=\"tr-sub\">the human opens these individually</span>" },
        { v: pct(m.autoAccuracy), l: "accuracy in the bulk-confirm lane<br><span class=\"tr-sub\">quality of what gets bulk-confirmed</span>" }
      ];
      results.innerHTML = "";
      cells.forEach(c => {
        const cell = document.createElement("div");
        cell.className = "tr-cell";
        const b = document.createElement("b");
        b.textContent = c.v;
        const span = document.createElement("span");
        span.innerHTML = c.l;
        cell.appendChild(b);
        cell.appendChild(span);
        results.appendChild(cell);
      });
      // Screen-reader status mirrors the on-screen numbers exactly.
      if(status){
        status.textContent = "Classification complete on " + m.total + " synthetic items. " +
          pct(m.accuracy) + " classifier accuracy. " + m.autoCount + " items routed to bulk-confirm, " +
          m.handCount + " items sent to hand review. That is " + pct(m.liftPct) +
          " fewer items reviewed one by one.";
      }
    }

    // Read the slider as a 0..1 threshold (slider is integer percent 0..100).
    function currentThreshold(){
      if(!slider) return 0.5;
      const v = parseInt(slider.value, 10);
      return isNaN(v) ? 0.5 : v / 100;
    }

    // Refresh the triaged view + results for the current threshold.
    function refresh(){
      const th = currentThreshold();
      if(threshOut) threshOut.textContent = pct(th);
      renderGrouped(th);
      renderResults(th);
    }

    // Switch between the raw and triaged states.
    let triaged = false;
    function showTriaged(on){
      triaged = on;
      if(stage) stage.classList.toggle("is-triaged", on);
      root.setAttribute("data-triaged", on ? "true" : "false");
      if(on) refresh();
    }

    // ---- Wire up. Build the flat queue immediately; triaged view on demand. ----
    renderFlat();
    if(threshOut) threshOut.textContent = pct(currentThreshold());

    if(runBtn) runBtn.addEventListener("click", () => { showTriaged(true); });
    if(resetBtn) resetBtn.addEventListener("click", () => {
      showTriaged(false);
      if(status) status.textContent = "Reset to the raw queue. Nothing is labeled yet.";
    });
    // Slider updates live, but only changes the triaged view once it exists.
    if(slider) slider.addEventListener("input", () => {
      const th = currentThreshold();
      if(threshOut) threshOut.textContent = pct(th);
      if(triaged) refresh();
      emitLift(th);
    });

    // ---- Elite touch: let this demo's threshold drive the savings calculator's
    // lift field live. We broadcast the demo's CURRENT measured liftPct (the exact
    // same computeMetrics value rendered above) on a custom event. The calculator
    // listens and updates if present. This is one-way and fully decoupled: if the
    // calculator is absent the event is simply ignored, and if this demo is absent
    // the calculator keeps its own static default. No shared mutable state.
    function emitLift(threshold){
      const m = computeMetrics(threshold);
      document.dispatchEvent(new CustomEvent("triage:lift", {
        detail: { liftPct: m.liftPct, liftPercent: Math.round(m.liftPct * 100) }
      }));
    }
    // Announce the default-threshold lift once on load so a calculator that wired
    // itself to the demo starts from the demo's measured value, not a guess.
    emitLift(currentThreshold());
  })();

  /* ---------- Projected-savings calculator (illustrative, on /lab) ----------
     A viewer-driven PROJECTION that sits AFTER the triage demo. It does NOT measure
     anything: it takes four assumptions the viewer sets and computes, live, the
     reviewer time and money a review-reduction lift would be worth at scale.

     HONESTY CONTRACT (mirrors the demo's): every displayed output is computed in
     this function from the current input values, never hardcoded. The page ships
     the inputs with editable defaults and the outputs as "--" placeholders; the
     numbers only exist once compute() runs. The lift default (89) is the demo's
     own measured liftPct at its default threshold, and if the demo is on the page
     its slider drives this field live via the "triage:lift" event above.

     Root-checked: bails immediately on pages without #savings-calc. No network,
     no library. Inputs are real labeled <input>s (keyboard operable); outputs
     update an aria-live region; reduced-motion has no effect on the math. */
  (function savingsCalc(){
    const root = document.getElementById("savings-calc");
    if(!root) return;

    // ---- Inputs (each optional; guard every read) ----
    const itemsEl   = document.getElementById("calc-items");    // items reviewed per day
    const minutesEl = document.getElementById("calc-minutes");  // minutes per manual review
    const costEl    = document.getElementById("calc-cost");     // reviewer cost per hour (USD)
    const liftEl    = document.getElementById("calc-lift");     // review-reduction lift (range, percent)
    const liftOut   = document.getElementById("calc-lift-val"); // live readout of the lift slider

    // ---- Outputs ----
    const outWeek  = document.getElementById("calc-out-week");
    const outMonth = document.getElementById("calc-out-month");
    const outYear  = document.getElementById("calc-out-year");
    const outMoney = document.getElementById("calc-out-money");
    const status   = document.getElementById("calc-status");

    // Working-day assumptions, stated in the visible formula copy too.
    const DAYS_PER_WEEK  = 5;
    const DAYS_PER_YEAR  = 260;
    const DAYS_PER_MONTH = DAYS_PER_YEAR / 12; // 21.666..., shown as ~21.7

    // ---- Formatters ----
    // Read a numeric input safely: blank / NaN / negative all clamp to 0 so the
    // projection never shows NaN or a negative saving.
    function num(el){
      if(!el) return 0;
      const v = parseFloat(el.value);
      if(isNaN(v) || v < 0) return 0;
      return v;
    }
    // Hours: one decimal, thousands-separated (e.g. 1,083.3).
    const fmtHours = h => (Math.round(h * 10) / 10).toLocaleString(undefined, {
      minimumFractionDigits: 1, maximumFractionDigits: 1
    });
    // Money: whole dollars, thousands-separated, with a $ prefix (e.g. $32,500).
    const fmtMoney = d => "$" + Math.round(d).toLocaleString();

    // ---- The live computation. Returns every figure the UI shows. ----
    // minutesSavedPerDay = itemsPerDay * (liftPercent/100) * minutesPerReview
    // hoursPerDay        = minutesSavedPerDay / 60
    // week/month/year    = hoursPerDay * working-days in that span
    // moneyPerYear       = hoursPerYear * costPerHour
    function compute(){
      const itemsPerDay     = num(itemsEl);
      const minutesPerReview= num(minutesEl);
      const costPerHour     = num(costEl);
      // Lift is a percent 0..100 from the slider; clamp into range, then to a fraction.
      let liftPercent = num(liftEl);
      if(liftPercent > 100) liftPercent = 100;
      const liftFraction = liftPercent / 100;

      const minutesSavedPerDay = itemsPerDay * liftFraction * minutesPerReview;
      const hoursPerDay   = minutesSavedPerDay / 60;
      const hoursPerWeek  = hoursPerDay * DAYS_PER_WEEK;
      const hoursPerMonth = hoursPerDay * DAYS_PER_MONTH;
      const hoursPerYear  = hoursPerDay * DAYS_PER_YEAR;
      const moneyPerYear  = hoursPerYear * costPerHour;
      return { liftPercent, hoursPerWeek, hoursPerMonth, hoursPerYear, moneyPerYear };
    }

    // ---- Render from a freshly computed result. Writes nothing if a node is absent. ----
    function render(){
      const r = compute();
      if(liftOut) liftOut.textContent = r.liftPercent + "%";
      if(outWeek)  outWeek.textContent  = fmtHours(r.hoursPerWeek);
      if(outMonth) outMonth.textContent = fmtHours(r.hoursPerMonth);
      if(outYear)  outYear.textContent  = fmtHours(r.hoursPerYear);
      if(outMoney) outMoney.textContent = fmtMoney(r.moneyPerYear);
      // Screen-reader summary mirrors the on-screen numbers exactly.
      if(status){
        status.textContent = "Projection updated. At a " + r.liftPercent +
          " percent review-reduction lift, this projects " + fmtHours(r.hoursPerYear) +
          " reviewer hours saved per year, about " + fmtMoney(r.moneyPerYear) +
          " per year at the cost per hour you set. This is a projection from your assumptions, not a measured result.";
      }
    }

    // ---- Wire inputs: every change recomputes live. ----
    [itemsEl, minutesEl, costEl].forEach(el => {
      if(el) el.addEventListener("input", render);
    });
    if(liftEl) liftEl.addEventListener("input", render);

    // ---- Demo -> calculator link: when the triage demo broadcasts its measured
    // lift, mirror it into the lift slider and recompute. Guarded so a malformed
    // event cannot throw, and so manual edits still work (the next demo-slider move
    // simply re-syncs). This is the "demo drives the field live" elite touch, kept
    // safe by being one-way and idempotent. ----
    document.addEventListener("triage:lift", (e) => {
      if(!liftEl || !e || !e.detail) return;
      const p = e.detail.liftPercent;
      if(typeof p !== "number" || isNaN(p)) return;
      const clamped = p < 0 ? 0 : p > 100 ? 100 : Math.round(p);
      if(parseInt(liftEl.value, 10) === clamped) return; // no-op if unchanged
      liftEl.value = clamped;
      render();
    });

    // First paint: compute from the shipped defaults so the outputs are live
    // immediately (no "--" left on screen, and no hardcoded result).
    render();
  })();

})();
