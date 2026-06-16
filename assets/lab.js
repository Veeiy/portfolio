/* ============================================================
   Brad O'Haire portfolio - Lab page engine (/lab only)
   Loaded with `defer`. The whole file is wrapped so it no-ops
   on every page that lacks #console (i.e. everywhere but /lab):
   the root null-check at the top returns immediately, leaving
   zero console errors and nothing running.

   THE ENGINE IS REAL. This is a deterministic, client-side state
   machine, not a fake script and not a model call:
     - Each mission has a fixed wave plan (agents + a gate verdict).
     - On Run it steps wave -> dispatch agents -> auditor gate.
     - Exactly one wave is authored to BLOCK on a caught
       contradiction, route back, re-run, then PASS (the iterate
       loop), and that retry is counted against the run budget.
     - A later step asks for an irreversible action; the SAFETY
       FLOOR blocks it and the run stops there, even at Tier 3.
     - It ends on a clean stop at the definition of done, or when
       the dispatch budget is exhausted.

   The two autonomy dials genuinely change control flow:
     - Execution autonomy: Full runs straight through; Checkpoint
       pauses at every gate; Manual pauses before every dispatch.
       Each pause waits for a real "Continue" click.
     - External authority (Tier 1/2/3): changes which actions are
       allowed outright vs. need approval. BUT the safety floor
       always blocks money / secrets / irreversible actions
       regardless of tier. That invariance is the whole point.

   The agent OUTPUT TEXT in the run log is illustrative (labeled as
   such in the markup and caption). The logic that decides what
   happens is the real, reproducible part.
   ============================================================ */

(function(){
  "use strict";

  const console_ = document.getElementById("console");
  if(!console_) return; // not on /lab: no-op, zero errors.

  const reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- DOM refs (each guarded at use) ---------- */
  const missionSel = document.getElementById("con-mission");
  const segAutonomy= document.getElementById("seg-autonomy");
  const segAuthority=document.getElementById("seg-authority");
  const runBtn     = document.getElementById("con-run");
  const resetBtn   = document.getElementById("con-reset");
  const continueBtn= document.getElementById("con-continue");
  const tierNote   = document.getElementById("con-tier-note");

  const dagWrap    = document.getElementById("con-dag");
  const logWrap    = document.getElementById("con-log");
  const aria       = document.getElementById("con-aria");

  const mWave      = document.getElementById("meta-wave");
  const mWaves     = document.getElementById("meta-waves");
  const mUsed      = document.getElementById("meta-used");
  const mBudget    = document.getElementById("meta-budget");
  const mState     = document.getElementById("meta-state");

  /* ============================================================
     Mission plans. Each wave:
       id, label, sub (short role line), agents[] (node labels),
       gate: the AUTHORED auditor verdict for this wave.
     One wave per mission carries `contradiction: true` -> it gates
     BLOCK on first pass, routes back, re-runs (a second dispatch
     of its agents, counted against budget), then PASS.
     One later step carries `floor: {...}` -> an irreversible action
     the safety floor blocks. The run halts there.
     Budget is sized with headroom over each mission's full scripted run
     (including the contradiction wave's re-run dispatches), so the run
     always stops on the definition of done / safety floor, not by
     accidentally clipping the budget. The budget is still real: a longer
     plan would exhaust it, which is the point of having one.
     Numbers shown by the console are the run's OWN state, never a
     business metric.
     ============================================================ */
  const MISSIONS = {
    portfolio: {
      name: "Build this portfolio site",
      budget: 14,
      def: "a deployed, accessible, multi-page site at the written definition of done",
      waves: [
        { id:"W1", label:"Ideation", sub:"think-tank, parallel",
          agents:["Concept A","Concept B","Concept C"], gate:"PASS",
          log:["frame the brief three ways in parallel",
               "rank directions against the rubric",
               "synthesis picks the layered Lab direction"] },
        { id:"W2", label:"Build", sub:"specialists, parallel",
          agents:["Page + structure","Console engine"], gate:"BLOCK",
          contradiction:{
            what:"prices on the page contradict the economics in the brief",
            fix:"reconcile to a single source of truth, rebuild the affected view"
          },
          log:["dispatch build specialists on their own slices",
               "assemble the page and the interactive console"] },
        { id:"W3", label:"Test", sub:"persona testers, parallel",
          agents:["Keyboard user","Mobile user","Skeptical hiring manager"], gate:"WARN",
          warn:"one contrast pair sits just under AA; flagged for a quick fix, not a blocker",
          log:["persona testers click through the result",
               "keyboard and mobile paths exercised",
               "findings routed back as a warning, not a stop"] },
        { id:"W4", label:"Iterate and deploy", sub:"fix, re-check, then publish",
          agents:["Fix + re-audit","Deploy step"], gate:"PASS",
          floor:{
            action:"Promote to production at bradohaire.com",
            why:"publishing to the live domain is irreversible and outside the run's authority"
          },
          log:["apply the contrast fix and re-audit",
               "definition of done met; prepare the deploy step"] }
      ]
    },

    labeling: {
      name: "First-pass labeling pipeline",
      budget: 14,
      def: "a triaged queue with a human confirming every call",
      waves: [
        { id:"W1", label:"Ideation", sub:"think-tank, parallel",
          agents:["Taxonomy A","Taxonomy B","Heuristic set"], gate:"PASS",
          log:["propose category schemes in parallel",
               "score schemes for coverage and overlap",
               "synthesis fixes the first-pass taxonomy"] },
        { id:"W2", label:"Build", sub:"specialists, parallel",
          agents:["Classifier","Confidence + routing"], gate:"PASS",
          log:["build a transparent keyword classifier",
               "wire confidence scoring and the review lane"] },
        { id:"W3", label:"Test", sub:"evaluation, parallel",
          agents:["Accuracy check","Edge cases","Reviewer load"], gate:"BLOCK",
          contradiction:{
            what:"the auto-confirm lane claims a higher accuracy than the holdout set supports",
            fix:"lower the auto-confirm threshold, re-route the contested items to a human"
          },
          log:["score first-pass accuracy against ground truth",
               "probe deliberately ambiguous items"] },
        { id:"W4", label:"Iterate and hand off", sub:"re-check, then route to humans",
          agents:["Re-tune + re-audit","Queue hand-off"], gate:"PASS",
          floor:{
            action:"Auto-apply final labels to the production dataset",
            why:"writing labels with no human confirmation is exactly what this pattern forbids"
          },
          log:["re-tune the threshold and re-audit the lanes",
               "queue is ready; every call still waits for a human"] }
      ]
    },

    product: {
      name: "Ship a product",
      budget: 14,
      def: "a staged storefront in test mode, cleared for a human to take live",
      waves: [
        { id:"W1", label:"Ideation", sub:"think-tank, parallel",
          agents:["Offer A","Offer B","Feasibility"], gate:"PASS",
          log:["propose product directions in parallel",
               "pressure-test each for feasibility and liability",
               "synthesis picks a buildable, compliant offer"] },
        { id:"W2", label:"Build", sub:"specialists, parallel",
          agents:["Storefront","Checkout (test mode)"], gate:"WARN",
          warn:"copy drifts past the content-claim boundary in one spot; flagged for a rewrite",
          log:["build the storefront and product page",
               "wire checkout in sandbox / test mode only"] },
        { id:"W3", label:"Test", sub:"persona testers, parallel",
          agents:["First-time buyer","Mobile checkout","Compliance read"], gate:"BLOCK",
          contradiction:{
            what:"the price on the product page contradicts the price at checkout",
            fix:"reconcile both to the economics in the brief, re-test the buy path"
          },
          log:["run the buy path end to end in test mode",
               "compliance read on the on-page claims"] },
        { id:"W4", label:"Iterate and stage", sub:"fix, re-check, then hand off",
          agents:["Fix + re-audit","Stage for launch"], gate:"PASS",
          floor:{
            action:"Charge a live card / move funds to go live",
            why:"moving real money is a hard floor; going live is a human decision, never the run's"
          },
          log:["reconcile pricing and re-audit the buy path",
               "staged in test mode; cleared for a human to launch"] }
      ]
    }
  };

  /* ---------- Tier policy: how External authority changes verdicts ----------
     Tier 1: most real-world actions need a human; only read-only / internal
             work is allowed outright.
     Tier 2: routine external actions allowed; consequential ones need approval.
     Tier 3: broad authority; acts on its own across the plan.
     In ALL tiers the safety floor still blocks money / secrets / irreversible.
     This drives a per-tier note plus an extra approval pause in the lower tiers
     when Execution autonomy is not Manual (Manual already pauses everywhere). */
  const TIER_COPY = {
    "1":"Tier 1: read-only and internal work runs on its own; consequential external actions wait for a human.",
    "2":"Tier 2: routine external actions run on their own; consequential ones still wait for approval.",
    "3":"Tier 3: broad authority to act across the plan. The safety floor still blocks money, secrets, and irreversible actions."
  };

  /* ---------- Live run state ---------- */
  const state = {
    autonomy:"full",      // full | checkpoint | manual
    authority:"1",        // "1" | "2" | "3"
    missionKey:"portfolio",
    running:false,
    used:0,               // dispatches consumed
    budget:12,
    waveEls:[],           // rendered .wave nodes, indexed by wave
    timers:[],            // setTimeout ids, cleared on reset
    awaiting:null,        // a resolver fn when paused for Continue
    tick:0,               // monotonic log tick
    finished:false
  };

  /* ---------- Small helpers ---------- */
  function clearTimers(){ state.timers.forEach(clearTimeout); state.timers = []; }
  // A cancellable delay that also resolves immediately when not animating.
  function wait(ms){
    if(reduceMotion) return Promise.resolve();
    return new Promise(res => { state.timers.push(setTimeout(res, ms)); });
  }
  // A pause that blocks until the user clicks Continue (Manual / Checkpoint).
  function awaitContinue(labelText){
    if(continueBtn){
      continueBtn.hidden = false;
      continueBtn.textContent = labelText || "Continue";
      continueBtn.focus();
    }
    setState("paused");
    return new Promise(res => { state.awaiting = res; });
  }
  function resolveContinue(){
    if(!state.awaiting) return;
    const r = state.awaiting; state.awaiting = null;
    if(continueBtn) continueBtn.hidden = true;
    setState("running");
    r();
  }
  function setMeta(){
    if(mWave)  mWave.textContent  = String(Math.min(curWaveIndex+1, plan().waves.length) || 0);
    if(mWaves) mWaves.textContent = String(plan().waves.length);
    if(mUsed)  mUsed.textContent  = String(state.used);
    if(mBudget)mBudget.textContent= String(state.budget);
  }
  function setState(s){
    const labels = {idle:"Idle",running:"Running",paused:"Paused",blocked:"Blocked",done:"Done"};
    if(mState) mState.textContent = labels[s] || s;
    console_.setAttribute("data-state", s);
  }
  function say(msg){ if(aria) aria.textContent = msg; }

  let curWaveIndex = -1;
  function plan(){ return MISSIONS[state.missionKey]; }

  // Reveal an element with its CSS transition, reliably. We force a reflow (read
  // offsetWidth) to flush the initial hidden styles, then add `.show` so the
  // transition runs. This does NOT depend on requestAnimationFrame, so it still
  // works if the tab is backgrounded (where rAF is paused) mid-run.
  function revealNext(el){
    void el.offsetWidth; // force reflow so the pre-show styles are committed
    el.classList.add("show");
  }

  /* ---------- Run log ---------- */
  function logLine(text, kind){
    if(!logWrap) return Promise.resolve();
    const li = document.createElement("li");
    li.className = "log-line" + (kind ? " k-"+kind : "");
    const tick = document.createElement("span");
    tick.className = "log-tick";
    state.tick += 1;
    tick.textContent = String(state.tick).padStart(2,"0");
    const txt = document.createElement("span");
    txt.className = "log-txt";
    txt.textContent = text;
    li.appendChild(tick); li.appendChild(txt);
    logWrap.appendChild(li);
    logWrap.scrollTop = logWrap.scrollHeight;
    if(reduceMotion){ li.classList.add("show"); return Promise.resolve(); }
    revealNext(li);
    return wait(140);
  }

  /* ---------- Render the wave DAG shell for the current mission ---------- */
  function buildDag(){
    if(!dagWrap) return;
    dagWrap.innerHTML = "";
    state.waveEls = [];
    plan().waves.forEach((w, i) => {
      const wave = document.createElement("div");
      wave.className = "wave";
      wave.setAttribute("data-wave", String(i));

      const head = document.createElement("div");
      head.className = "wave-head";
      const dot = document.createElement("span");
      dot.className = "wave-dot";
      dot.textContent = String(i+1);
      const title = document.createElement("span");
      title.className = "wave-title";
      title.innerHTML = ""; // build safely below
      const tStrong = document.createElement("span");
      tStrong.textContent = w.label;
      const tSub = document.createElement("span");
      tSub.className = "wave-sub";
      tSub.textContent = w.sub;
      title.appendChild(tStrong); title.appendChild(tSub);

      const retry = document.createElement("span");
      retry.className = "wave-retry";
      retry.textContent = "re-run";
      title.appendChild(retry);

      const stamp = document.createElement("span");
      stamp.className = "gate-stamp";
      const gdot = document.createElement("span"); gdot.className = "gdot";
      const gtxt = document.createElement("span");
      stamp.appendChild(gdot); stamp.appendChild(gtxt);

      head.appendChild(dot); head.appendChild(title); head.appendChild(stamp);

      const agents = document.createElement("div");
      agents.className = "wave-agents";
      w.agents.forEach(a => {
        const node = document.createElement("span");
        node.className = "agent-node";
        const p = document.createElement("span"); p.className = "an-pulse";
        const lab = document.createElement("span"); lab.textContent = a;
        node.appendChild(p); node.appendChild(lab);
        agents.appendChild(node);
      });

      wave.appendChild(head); wave.appendChild(agents);
      dagWrap.appendChild(wave);
      state.waveEls.push({ wave, dot, stamp, gdot, gtxt, retry, agents });
    });
  }

  function paintStamp(refs, verdict){
    const map = {
      PASS:["gate-pass","PASS"], WARN:["gate-warn","WARN"],
      BLOCK:["gate-block","BLOCK"], FLOOR:["gate-floor","Blocked: safety floor"]
    };
    const [cls, label] = map[verdict] || map.PASS;
    refs.stamp.className = "gate-stamp " + cls;
    refs.gtxt.textContent = label;
    if(reduceMotion){ refs.stamp.classList.add("show"); return Promise.resolve(); }
    revealNext(refs.stamp);
    return wait(360);
  }

  /* ---------- External authority: how the current tier treats this wave ----------
     Returns a {kind, text} log line describing whether the wave's work is allowed
     outright at the current tier or would be routed to a human. Ideation (W1) is
     internal work, allowed at every tier. The later waves carry consequential
     external actions, so the tier matters. This is what makes the authority dial
     visibly change behavior. The safety floor is enforced separately and ALWAYS
     blocks, regardless of what this returns. */
  function tierDecision(w){
    if(w.id === "W1"){
      return { kind:"pass", text:"Tier " + state.authority + ": internal work, allowed at every tier" };
    }
    if(state.authority === "1"){
      return { kind:"warn", text:"Tier 1: consequential external work, would route to a human to approve" };
    }
    if(state.authority === "2"){
      return { kind:null, text:"Tier 2: routine external work, allowed; consequential steps still flagged" };
    }
    return { kind:null, text:"Tier 3: allowed under broad authority for this run" };
  }

  /* ---------- Dispatch the agents of one wave (animated, in parallel) ----------
     Each agent dispatched counts ONE against the budget. Returns false if the
     budget is exhausted mid-wave (the run then stops on budget).

     The pause flow is owned ENTIRELY by the Execution autonomy dial:
       - Manual:     pause before EVERY dispatch (Continue per dispatch).
       - Checkpoint: handled by the caller (pause at each gate boundary).
       - Full:       no pauses, runs straight through.
     The External authority dial does NOT add or remove pauses; it changes the
     tier-decision line logged here. That keeps each dial's behavior distinct. */
  async function dispatchWave(w, refs, isRetry){
    refs.wave.classList.add("is-active");
    if(isRetry) refs.retry.classList.add("show");

    // External authority: log how this tier treats the wave (does not pause).
    const td = tierDecision(w);
    await logLine(td.text, td.kind);

    // Manual autonomy: pause before EACH dispatch. At Tier 1 the consequential
    // waves frame the pause as an explicit approval; otherwise it is a step gate.
    if(state.autonomy === "manual"){
      const approve = (state.authority === "1" && w.id !== "W1");
      await awaitContinue((approve ? "Approve and dispatch " : "Continue: dispatch ") + w.label);
    }
    if(!state.running) return false;

    const nodes = Array.from(refs.agents.querySelectorAll(".agent-node"));
    // Light them up in parallel (a small stagger reads as "parallel", not sequential).
    for(let k=0;k<nodes.length;k++){
      if(state.used >= state.budget){
        return false; // budget hit mid-wave
      }
      nodes[k].classList.add("dispatched");
      state.used += 1;
      setMeta();
      await wait(90);
    }
    // illustrative agent chatter
    if(w.log){
      for(const line of w.log){ await logLine(line, null); }
    }
    await wait(180);
    nodes.forEach(n => { n.classList.remove("dispatched"); n.classList.add("complete"); });
    await wait(120);
    return true;
  }

  /* ---------- The auditor gate for a wave ----------
     Honors the authored verdict. For the contradiction wave it returns BLOCK,
     the caller routes back and re-runs, then this returns PASS on the retry. */
  async function gateWave(w, refs, isRetry){
    await logLine("auditor gate reviews wave " + w.label, "gate");

    if(w.contradiction && !isRetry){
      await paintStamp(refs, "BLOCK");
      setState("blocked");
      await logLine("BLOCK: " + w.contradiction.what, "block");
      await logLine("route back: " + w.contradiction.fix, "warn");
      say("Auditor blocked " + w.label + " on a caught contradiction. Routing it back to re-run.");
      // reset the stamp + nodes for the visible re-run
      await wait(420);
      refs.stamp.classList.remove("show");
      refs.agents.querySelectorAll(".agent-node").forEach(n => n.classList.remove("complete"));
      setState("running");
      return "BLOCK";
    }

    if(w.gate === "WARN"){
      await paintStamp(refs, "WARN");
      await logLine("WARN: " + (w.warn || "minor issue flagged, not a blocker"), "warn");
      say(w.label + " passed with a warning.");
      return "WARN";
    }

    await paintStamp(refs, "PASS");
    await logLine("PASS: wave " + w.label + " cleared", "pass");
    say(w.label + " passed the auditor gate.");
    return "PASS";
  }

  /* ---------- The safety floor check on an irreversible action ----------
     ALWAYS blocks, regardless of External authority tier. */
  async function safetyFloor(w, refs){
    await logLine("requested: " + w.floor.action, "gate");
    await logLine("safety floor check at Tier " + state.authority + " ...", "gate");
    await paintStamp(refs, "FLOOR");
    setState("blocked");
    await logLine("Blocked: safety floor. " + w.floor.why, "floor");
    await logLine("even at Tier 3 this stays blocked; it is a human decision", "floor");
    say("Safety floor blocked an irreversible action: " + w.floor.action +
        ". This holds at every authority tier.");
  }

  /* ============================================================
     The run loop.
     ============================================================ */
  async function run(){
    if(state.running) return;
    resetRun(true); // fresh state, keep dial selections
    state.running = true;
    state.finished = false;
    console_.classList.add("is-running");
    console_.classList.remove("has-run");
    if(runBtn) runBtn.disabled = true;
    setState("running");

    await logLine("mission: " + plan().name, "gate");
    await logLine("autonomy=" + state.autonomy + "  authority=Tier " + state.authority +
                  "  budget=" + state.budget + " dispatches", null);

    const waves = plan().waves;
    for(let i=0;i<waves.length;i++){
      if(!state.running) break;
      curWaveIndex = i;
      setMeta();
      const w = waves[i];
      const refs = state.waveEls[i];

      // Checkpoint autonomy: pause at each gate boundary (before dispatch of
      // every wave after the first, representing a human checkpoint per wave).
      if(state.autonomy === "checkpoint" && i > 0){
        await awaitContinue("Continue to " + w.label);
        if(!state.running) break;
      }

      // ---- dispatch ----
      let ok = await dispatchWave(w, refs, false);
      if(!ok){ await budgetStop(); return; }

      // ---- gate ----
      let verdict = await gateWave(w, refs, false);

      // ---- contradiction: route back and re-run, then re-gate ----
      if(verdict === "BLOCK" && w.contradiction){
        if(state.autonomy === "manual" || state.autonomy === "checkpoint"){
          await awaitContinue("Continue: re-run " + w.label);
          if(!state.running) break;
        }
        ok = await dispatchWave(w, refs, true);
        if(!ok){ await budgetStop(); return; }
        verdict = await gateWave(w, refs, true); // PASS on retry
      }

      refs.wave.classList.remove("is-active");
      refs.wave.classList.add("is-done");

      // ---- safety floor: the authored irreversible action on this wave ----
      if(w.floor){
        await safetyFloor(w, refs);
        // The run stops cleanly here: the floor held, the rest is a human's call.
        await finishAtFloor();
        return;
      }
    }

    await finishClean();
  }

  async function finishClean(){
    state.running = false;
    state.finished = true;
    console_.classList.remove("is-running");
    console_.classList.add("has-run");
    if(runBtn) runBtn.disabled = false;
    setState("done");
    await logLine("definition of done met: " + plan().def, "done");
    say("Run complete. Definition of done met, " + state.used + " of " +
        state.budget + " dispatches used.");
  }

  async function finishAtFloor(){
    state.running = false;
    state.finished = true;
    console_.classList.remove("is-running");
    console_.classList.add("has-run");
    if(runBtn) runBtn.disabled = false;
    // state stays "blocked" so the meta strip reads red: the run ended on the floor.
    await logLine("clean stop: the safety floor held. Going further is a human step.", "done");
  }

  async function budgetStop(){
    state.running = false;
    state.finished = true;
    console_.classList.remove("is-running");
    console_.classList.add("has-run");
    if(runBtn) runBtn.disabled = false;
    setState("done");
    if(continueBtn) continueBtn.hidden = true;
    await logLine("run budget reached: " + state.used + " of " + state.budget +
                  " dispatches. Halting on the budget boundary.", "done");
    say("Run halted on the dispatch budget: " + state.used + " of " + state.budget + " used.");
  }

  /* ============================================================
     Reduced-motion path: render a COMPLETE, already-resolved run.
     No sequencing, no awaits that matter (wait() resolves instantly),
     no Continue pauses. Every wave shows its final verdict, the
     contradiction wave shows its retry + PASS, and the safety-floor
     block is shown. Called by Run and on first load.
     ============================================================ */
  function renderResolvedStatic(){
    buildDag();
    if(logWrap) logWrap.innerHTML = "";
    state.tick = 0;
    state.used = 0;
    console_.classList.remove("is-running");
    console_.classList.add("has-run");

    const waves = plan().waves;
    logLineStatic("mission: " + plan().name, "gate");
    logLineStatic("autonomy=" + state.autonomy + "  authority=Tier " + state.authority +
                  "  budget=" + state.budget + " dispatches (static, reduced-motion view)", null);

    waves.forEach((w, i) => {
      const refs = state.waveEls[i];
      refs.wave.classList.add("is-done");
      const nodes = Array.from(refs.agents.querySelectorAll(".agent-node"));
      // tier-decision line: the authority dial changes this in the static view too
      const td = tierDecision(w);
      logLineStatic(td.text, td.kind);
      nodes.forEach(n => { n.classList.add("complete"); state.used += 1; });
      if(w.log) w.log.forEach(l => logLineStatic(l, null));

      if(w.contradiction){
        // show the block, the route-back, the retry, then the resolved PASS
        logLineStatic("auditor gate reviews wave " + w.label, "gate");
        logLineStatic("BLOCK: " + w.contradiction.what, "block");
        logLineStatic("route back: " + w.contradiction.fix, "warn");
        refs.retry.classList.add("show");
        nodes.forEach(() => { state.used += 1; }); // retry dispatches counted
        logLineStatic("re-run " + w.label + " after the fix", null);
        paintStampStatic(refs, "PASS");
        logLineStatic("PASS: wave " + w.label + " cleared on re-run", "pass");
      } else if(w.gate === "WARN"){
        logLineStatic("auditor gate reviews wave " + w.label, "gate");
        paintStampStatic(refs, "WARN");
        logLineStatic("WARN: " + (w.warn || "minor issue flagged"), "warn");
      } else {
        logLineStatic("auditor gate reviews wave " + w.label, "gate");
        paintStampStatic(refs, "PASS");
        logLineStatic("PASS: wave " + w.label + " cleared", "pass");
      }

      if(w.floor){
        logLineStatic("requested: " + w.floor.action, "gate");
        paintStampStatic(refs, "FLOOR");
        logLineStatic("Blocked: safety floor. " + w.floor.why, "floor");
        logLineStatic("even at Tier 3 this stays blocked; it is a human decision", "floor");
      }
    });

    logLineStatic("clean stop: the safety floor held. Going further is a human step.", "done");
    curWaveIndex = waves.length - 1;
    setMeta();
    setState("blocked"); // the scripted run ends on the held floor
    say("Static run shown: all waves resolved, the caught contradiction re-gated to pass, " +
        "and the safety floor blocking an irreversible action. No animation.");
  }
  function logLineStatic(text, kind){
    if(!logWrap) return;
    const li = document.createElement("li");
    li.className = "log-line show" + (kind ? " k-"+kind : "");
    const tick = document.createElement("span");
    tick.className = "log-tick";
    state.tick += 1;
    tick.textContent = String(state.tick).padStart(2,"0");
    const txt = document.createElement("span");
    txt.className = "log-txt";
    txt.textContent = text;
    li.appendChild(tick); li.appendChild(txt);
    logWrap.appendChild(li);
  }
  function paintStampStatic(refs, verdict){
    const map = {
      PASS:["gate-pass","PASS"], WARN:["gate-warn","WARN"],
      BLOCK:["gate-block","BLOCK"], FLOOR:["gate-floor","Blocked: safety floor"]
    };
    const [cls, label] = map[verdict] || map.PASS;
    refs.stamp.className = "gate-stamp show " + cls;
    refs.gtxt.textContent = label;
  }

  /* ---------- Reset ---------- */
  // resetRun(keepDials): wipe the run state. When keepDials is true we keep the
  // current mission/dial selections (used at the top of run()); otherwise it is
  // a full user-driven reset back to the idle baseline.
  function resetRun(keepDials){
    clearTimers();
    state.awaiting = null;
    state.running = false;
    state.finished = false;
    state.used = 0;
    state.tick = 0;
    curWaveIndex = -1;
    if(continueBtn) continueBtn.hidden = true;
    if(runBtn) runBtn.disabled = false;
    console_.classList.remove("is-running","has-run");
    if(logWrap) logWrap.innerHTML = "";
    buildDag();
    setMeta();
    setState("idle");
    if(!keepDials) say("Reset. Configure a run and press Run.");
  }

  /* ============================================================
     Controls wiring.
     ============================================================ */
  // Segmented controls: roving selection + full keyboard support.
  function wireSegment(group, onChange){
    if(!group) return;
    const segs = Array.from(group.querySelectorAll(".seg"));
    function select(seg){
      segs.forEach(s => s.setAttribute("aria-checked", s === seg ? "true" : "false"));
      onChange(seg.dataset.val);
    }
    segs.forEach((seg, idx) => {
      seg.addEventListener("click", () => select(seg));
      seg.addEventListener("keydown", (e) => {
        let t = null;
        if(e.key === "ArrowRight" || e.key === "ArrowDown") t = segs[(idx+1) % segs.length];
        else if(e.key === "ArrowLeft" || e.key === "ArrowUp") t = segs[(idx-1+segs.length) % segs.length];
        if(t){ e.preventDefault(); t.focus(); select(t); }
      });
    });
  }

  wireSegment(segAutonomy, (val) => {
    state.autonomy = val;
    // changing a dial resets the board so the next Run reflects the new behavior
    if(!reduceMotion) resetRun(true); else renderResolvedStatic();
  });
  wireSegment(segAuthority, (val) => {
    state.authority = val;
    if(tierNote) tierNote.textContent = TIER_COPY[val] || "";
    if(!reduceMotion) resetRun(true); else renderResolvedStatic();
  });

  if(missionSel){
    missionSel.addEventListener("change", () => {
      state.missionKey = missionSel.value;
      state.budget = plan().budget;
      if(!reduceMotion) resetRun(true); else renderResolvedStatic();
    });
  }

  if(runBtn) runBtn.addEventListener("click", () => {
    if(reduceMotion){ renderResolvedStatic(); return; }
    run();
  });
  if(resetBtn) resetBtn.addEventListener("click", () => {
    if(reduceMotion){ renderResolvedStatic(); say("Reset. Static run re-rendered."); return; }
    resetRun(false);
  });
  if(continueBtn) continueBtn.addEventListener("click", resolveContinue);

  /* ---------- Initial paint ---------- */
  state.missionKey = (missionSel && missionSel.value) || "portfolio";
  state.budget = plan().budget;
  if(tierNote) tierNote.textContent = TIER_COPY[state.authority] || "";
  if(reduceMotion){
    // Render the complete, static, resolved run immediately.
    renderResolvedStatic();
  } else {
    resetRun(false);
  }

})();
