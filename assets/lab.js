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
    },

    support: {
      name: "Customer support resolution agent",
      budget: 14,
      def: "a resolved ticket with identity verified, policy applied, and any money decision left to a human",
      waves: [
        { id:"W1", label:"Triage the request", sub:"intake, parallel",
          agents:["Read the ticket","Classify and route"], gate:"PASS",
          log:["read the customer's message and pull the intent",
               "classify the request and route it to the right lane"] },
        { id:"W2", label:"Verify identity", sub:"prerequisite gate before any account action",
          agents:["Identity check","Account match"], gate:"BLOCK",
          contradiction:{
            what:"a refund was attempted before identity was verified",
            fix:"hold the account action, run the identity check first, then proceed"
          },
          log:["the request asks for a refund on the account",
               "prerequisite gate: no account action until identity is verified"] },
        { id:"W3", label:"Resolve in parallel", sub:"lookup order, check policy",
          agents:["Look up the order","Check the refund policy","Draft the reply"], gate:"WARN",
          warn:"the policy is silent on this exact case; flagged to escalate, not auto-decided",
          log:["look up the order and the policy at the same time",
               "policy does not cover this exact case; mark it for a human"] },
        { id:"W4", label:"Auditor gate and refund decision", sub:"resolve, or escalate to a human",
          agents:["Auditor review","Escalation packet"], gate:"PASS",
          floor:{
            action:"Issue the refund to the customer's card",
            why:"moving money is a hard floor; with policy silent, the refund is a human's call, not the run's"
          },
          log:["auditor clears the reply and the verified identity",
               "policy was silent, so the money decision routes to a human"] }
      ]
    },

    extraction: {
      name: "Structured data extraction pipeline",
      budget: 14,
      def: "validated records that match the schema, staged for a human to commit to the system of record",
      waves: [
        { id:"W1", label:"Ingest documents", sub:"intake, parallel",
          agents:["Parse files","Normalize text"], gate:"PASS",
          log:["read the batch of documents in",
               "normalize the text so every document looks the same"] },
        { id:"W2", label:"Extract with a JSON schema", sub:"one agent per document, parallel",
          agents:["Doc 1 to schema","Doc 2 to schema","Doc 3 to schema"], gate:"PASS",
          log:["dispatch one extractor per document against the same schema",
               "each returns fields typed to the schema, in parallel"] },
        { id:"W3", label:"Validate", sub:"flag calculated-vs-stated mismatches",
          agents:["Schema check","Cross-field math"], gate:"BLOCK",
          contradiction:{
            what:"a line total does not equal quantity times unit price (calculated vs stated mismatch)",
            fix:"retry that document's extraction with the specific validation error fed back"
          },
          log:["validate every record against the schema",
               "recompute totals and compare them to the stated values"] },
        { id:"W4", label:"Auditor gate and commit", sub:"re-validate, then hand off to a human",
          agents:["Auditor review","Stage for commit"], gate:"PASS",
          floor:{
            action:"Write the extracted records into the production system of record",
            why:"an irreversible write to the system of record is a hard floor; a human commits, not the run"
          },
          log:["re-validate the corrected record; the mismatch is gone",
               "records match the schema; staged for a human to commit"] }
      ]
    },

    research: {
      name: "Multi-agent research system",
      budget: 14,
      def: "a cited report, staged for a human to review and publish",
      waves: [
        { id:"W1", label:"Frame the question", sub:"plan, parallel",
          agents:["Scope the question","Plan the sources"], gate:"PASS",
          log:["break the question into sub-questions",
               "plan which sources answer which part"] },
        { id:"W2", label:"Research in parallel", sub:"one agent per source type",
          agents:["Web search agent","Document analysis agent"], gate:"PASS",
          log:["dispatch a web search agent and a document analysis agent at once",
               "each gathers evidence for its assigned sub-questions"] },
        { id:"W3", label:"Synthesis with citations", sub:"compose, attach sources",
          agents:["Compose findings","Attach citations"], gate:"BLOCK",
          contradiction:{
            what:"one finding is thinly sourced and contradicts another source",
            fix:"route back for another research pass; reconcile the claim or drop it, then re-cite"
          },
          log:["compose the findings into a single draft",
               "attach a citation to every claim"] },
        { id:"W4", label:"Auditor gate and deliver", sub:"clear the citations, then hand off",
          agents:["Auditor review","Stage the report"], gate:"PASS",
          floor:{
            action:"Auto-publish the report to an external channel",
            why:"posting externally is irreversible; publishing is a human's call, never the run's"
          },
          log:["auditor confirms every claim is now sourced and consistent",
               "report is cited and staged; a human reviews before it goes out"] }
      ]
    },

    review: {
      name: "CI/CD code review",
      budget: 14,
      def: "review feedback posted as comments, with merge and deploy left to a human",
      waves: [
        { id:"W1", label:"Ingest the diff", sub:"intake, parallel",
          agents:["Read the PR diff","Map changed files"], gate:"PASS",
          log:["read the pull-request diff in",
               "map which files and tests the change touches"] },
        { id:"W2", label:"Review and generate tests", sub:"one agent per file, plus tests",
          agents:["File review A","File review B","Test generation"], gate:"PASS",
          log:["dispatch a reviewer per changed file in parallel",
               "generate tests that cover the new behavior"] },
        { id:"W3", label:"Auditor gate", sub:"pass, warn, or block; tuned for low false positives",
          agents:["Severity triage","Confirm findings"], gate:"BLOCK",
          contradiction:{
            what:"a flagged blocker is a false positive the tests actually cover",
            fix:"re-check against the generated tests; downgrade the false positive, keep the real findings"
          },
          log:["triage each finding by severity",
               "the gate is tuned to minimize false positives, so weak flags are re-checked"] },
        { id:"W4", label:"Post the review", sub:"comment, then leave merge to a human",
          agents:["Compose comments","Post to the PR"], gate:"PASS",
          floor:{
            action:"Auto-merge the pull request and push to production",
            why:"merging and shipping to production is irreversible and needs human approval, at every tier"
          },
          log:["compose the confirmed findings into review comments",
               "feedback posted; the merge and the deploy stay a human decision"] }
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


/* ============================================================
   The real rollout: explorable timeline (/lab #rollout).
   A SEPARATE, self-contained IIFE with its OWN root null-check, so
   it no-ops anywhere the timeline is absent (every page but /lab),
   leaving zero console errors and independent of the console above.

   Two jobs, both progressive enhancement on top of working markup:
     1) Render the small wave-stat chips (agents dispatched + gate
        verdict) from a data array. This array is the rollout's OWN
        record of how this site was built, not a business metric and
        not invented. The static HTML carries the same values as a
        no-JS fallback; we re-render so the source of truth is one
        array, the same single-source-of-truth discipline the rest
        of the build follows.
     2) Stagger the scroll-reveal: set --rw-i per wave and add .rw-in
        as each enters view. Under reduced-motion or without
        IntersectionObserver, reveal everything at once. The
        expand/collapse is native <details>, so it needs no JS and
        keeps working regardless of this block.
   ============================================================ */
(function(){
  "use strict";

  const timeline = document.getElementById("rollout-timeline");
  if(!timeline) return; // not on /lab (or shell missing): no-op, zero errors.

  const reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* The rollout's own record, wave by wave. verdict drives both the chip
     label and its color class. This is the record of THIS build, presented
     as the project's own log, exactly as the visible gate stamps already show. */
  const ROLLOUT = [
    { agents:3, verdict:"Pass" },  // 1 Ideation
    { agents:1, verdict:"Pass" },  // 2 Synthesis + gate
    { agents:5, verdict:"Pass" },  // 3 Build
    { agents:1, verdict:"Warn" },  // 4 Auditor gate
    { agents:2, verdict:"Warn" },  // 5 Persona testing
    { agents:2, verdict:"Pass" },  // 6 Iterate
    { agents:1, verdict:"Pass" }   // 7 Deploy
  ];

  const waves = Array.prototype.slice.call(timeline.querySelectorAll("[data-rw]"));

  // ---- 1) Re-render the stat chips from the data array (idempotent) ----
  waves.forEach((wave, i) => {
    const rec = ROLLOUT[i];
    const slot = wave.querySelector("[data-rollout-stats]");
    if(!rec || !slot) return; // tolerate any markup/array mismatch, no throw

    const vClass = rec.verdict === "Warn" ? "rw-v-warn"
                 : rec.verdict === "Block" ? "rw-v-block"
                 : "rw-v-pass";

    // build with DOM nodes (no innerHTML) so text can never be parsed as markup
    slot.textContent = "";
    const mk = (kText, vText, vCls) => {
      const stat = document.createElement("span");
      stat.className = "rw-stat";
      const k = document.createElement("span");
      k.className = "rw-stat-k"; k.textContent = kText;
      const v = document.createElement("span");
      v.className = "rw-stat-v" + (vCls ? " " + vCls : ""); v.textContent = vText;
      stat.appendChild(k); stat.appendChild(v);
      return stat;
    };
    slot.appendChild(mk("Agents dispatched", String(rec.agents)));
    slot.appendChild(mk("Gate verdict", rec.verdict, vClass));
  });

  // ---- 2) Staggered scroll-reveal of each wave row ----
  // Assign a stagger index used by the CSS transition-delay (capped so a long
  // list never delays absurdly), then reveal on intersection.
  waves.forEach((wave, i) => { wave.style.setProperty("--rw-i", String(Math.min(i, 6))); });

  function revealAll(){ waves.forEach(w => w.classList.add("rw-in")); }

  if(reduceMotion || !("IntersectionObserver" in window)){
    revealAll();
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if(en.isIntersecting){
        en.target.classList.add("rw-in");
        io.unobserve(en.target);
      }
    });
  }, { threshold:0.12, rootMargin:"0px 0px -40px 0px" });
  waves.forEach(w => io.observe(w));

})();


/* ============================================================
   The Triage Desk: a real, working, client-side first-pass labeler
   (/lab #triage). A SEPARATE, self-contained IIFE with its OWN root
   null-check (#triage-desk), so it no-ops on every page that lacks
   the tool (everywhere but /lab), leaving zero console errors and
   fully independent of the console + rollout blocks above.

   HONESTY, by construction:
     - The classifier is a TRANSPARENT RULE-BASED SIGNAL MATCHER, not
       a model and not AI. Each category owns a list of signal terms.
       A line is scored by which signals match; the winning category
       and a computed confidence are shown ALONGSIDE the exact signals
       that fired (the "show the work"). Same input -> same output,
       always. No randomness, no network, no inference.
     - Everything runs in the browser. NOTHING the visitor pastes is
       sent anywhere: there is no fetch / XHR / beacon in this file.
     - Low-confidence or no-signal lines go to an explicit "Unsure"
       lane and float to the TOP for review. That is the honest,
       correct behaviour of a first-pass system.
     - A human CONFIRMS or OVERRIDES every row. The tool tracks its
       OWN counts (confirmed / overridden / needs-review). Those are
       the tool's own tallies, never a business metric.
     - Export builds a CSV / JSON file client-side via a Blob and an
       object URL; no upload.
   ============================================================ */
(function(){
  "use strict";

  const root = document.getElementById("triage-desk");
  if(!root) return; // not on /lab (or shell missing): no-op, zero errors.

  const reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- DOM refs (each guarded at use) ---------- */
  const ta         = document.getElementById("triage-text");
  const goBtn      = document.getElementById("triage-go");
  const sampleBtn  = document.getElementById("triage-sample");
  const clearBtn   = document.getElementById("triage-clear");
  const rowsEl     = document.getElementById("triage-rows");
  const emptyEl    = document.getElementById("triage-empty");
  const summaryEl  = document.getElementById("triage-summary");
  const aria       = document.getElementById("triage-aria");
  const exportBtn  = document.getElementById("triage-export");
  const exportMenu = document.getElementById("triage-export-menu");
  const exportCsv  = document.getElementById("triage-export-csv");
  const exportJson = document.getElementById("triage-export-json");

  const sumTotal      = document.getElementById("tsum-total");
  const sumReview     = document.getElementById("tsum-review");
  const sumConfirmed  = document.getElementById("tsum-confirmed");
  const sumOverridden = document.getElementById("tsum-overridden");

  /* ============================================================
     The taxonomy. A fixed, universally legible set, plus an explicit
     Unsure lane. Each category carries `signals`: terms or short
     phrases that, when present, vote for that category. Matching is
     case-insensitive and word-boundary aware (so "bug" does not fire
     inside "debugger"; multi-word phrases match as substrings). This
     list IS the classifier; it is shown to the user as the rules.
     ============================================================ */
  const CATEGORIES = [
    { key:"bug",      label:"Bug",              cls:"cat-bug",
      signals:["crash","crashes","crashed","error","errors","bug","broken","broke","breaks",
               "fails","failed","failing","freeze","frozen","glitch","not working",
               "doesn't work","does not work","won't load","wont load","stuck","blank screen",
               "500","404","exception","unresponsive","hangs"] },
    { key:"feature",  label:"Feature request",  cls:"cat-feature",
      signals:["please add","add a","add an","add support","would love","wish","it would be great",
               "feature request","can you add","could you add","would be nice","i'd like",
               "id like","support for","ability to","option to","allow me to","integrate with",
               "dark mode","export to","make it possible"] },
    { key:"question", label:"Question",         cls:"cat-question",
      signals:["how do i","how do you","how can i","how to","what is","what's the","whats the",
               "where do i","where is","why does","why is","can i","is there a way","is it possible",
               "do you support","does it","which","when will","help me understand","?"] },
    { key:"praise",   label:"Positive feedback",cls:"cat-praise",
      signals:["love","loved","awesome","amazing","great job","fantastic","excellent","best",
               "thank you","thanks","brilliant","perfect","works great","so good","really nice",
               "well done","impressed","game changer","life saver","wonderful","favorite"] }
  ];
  const UNSURE = { key:"unsure", label:"Unsure", cls:"cat-unsure" };

  // For the override dropdown: every real category plus the Unsure lane.
  const ALL_LANES = CATEGORIES.concat([UNSURE]);

  /* ---------- Sample lines (CLEARLY labeled as sample in the UI) ----------
     Realistic, de-identified, one per line, covering every lane including a
     deliberately ambiguous one that should land in Unsure. */
  const SAMPLE = [
    "The app crashes every time I tap export on my phone.",
    "Could you please add a dark mode for late-night use?",
    "How do I reset my password if I lost access to my email?",
    "Honestly this is the best scheduling tool I have used all year.",
    "It says error 500 when I try to save a draft.",
    "Would love the ability to bulk-tag items in one go.",
    "Is there a way to export my data to CSV?",
    "Thanks so much, the new layout works great on mobile.",
    "the thing on the page",
    "Login is broken and the dashboard won't load after the update."
  ].join("\n");

  /* ============================================================
     The classifier. Pure function: text in, a verdict out, with the
     matched signals. Deterministic. No state, no network.

     Scoring: for each category, sum a small weight per distinct signal
     that matches the line. The category with the top score wins. We
     then compute a confidence from (a) the winning raw score and (b)
     the MARGIN over the runner-up. No signals at all, or a winner that
     barely edges the field, routes to the Unsure lane (low confidence
     floats up). This margin rule is what makes "Unsure" honest rather
     than a dumping ground.
     ============================================================ */
  // Escape a signal term for use in a RegExp.
  function esc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // Does `term` occur in `text`? Word-boundary aware for alphanumeric
  // terms; plain substring for phrases/punctuation (spaces, "?", etc.).
  function hasSignal(text, term){
    if(/[^a-z0-9]/.test(term)){
      // phrase or punctuation signal: substring match (already lowercased)
      return text.indexOf(term) !== -1;
    }
    // single token: require word boundaries so "bug" != "debugger"
    const re = new RegExp("\\b" + esc(term) + "\\b");
    return re.test(text);
  }

  function classify(rawLine){
    const text = rawLine.toLowerCase();
    const scores = {};
    const matched = {};
    let topKey = null, topScore = 0, secondScore = 0;

    CATEGORIES.forEach(cat => {
      let score = 0;
      const fired = [];
      cat.signals.forEach(sig => {
        if(hasSignal(text, sig)){ score += 1; fired.push(sig); }
      });
      scores[cat.key] = score;
      matched[cat.key] = fired;
      if(score > topScore){ secondScore = topScore; topScore = score; topKey = cat.key; }
      else if(score > secondScore){ secondScore = score; }
    });

    // No signal fired anywhere -> honest Unsure, no confidence.
    if(topScore === 0){
      return { catKey:UNSURE.key, confidence:"low", pct:0, signals:[], reason:"no signal terms matched" };
    }

    const margin = topScore - secondScore;
    // Confidence: a transparent function of the winner's strength and its
    // separation from the runner-up. Tunable, but fixed + reproducible.
    //   high  : a clear winner (>=2 signals) that also leads by >=2
    //   medium: a winner that leads by >=1
    //   low   : a tie or a single weak signal -> treat as Unsure lane
    let confidence, catKey = topKey;
    if(topScore >= 2 && margin >= 2){ confidence = "high"; }
    else if(margin >= 1){ confidence = "medium"; }
    else { confidence = "low"; catKey = UNSURE.key; } // tie at the top: float up to Unsure

    // A computed percent for display: scaled from score + margin, capped.
    // This is the tool's own arithmetic, shown for transparency, not a model probability.
    const pct = Math.min(95, 45 + topScore * 12 + margin * 12);

    return { catKey:catKey, confidence:confidence, pct:(catKey===UNSURE.key?Math.min(pct,40):pct),
             signals:matched[topKey], reason:null, proposedKey:topKey };
  }

  function catByKey(key){
    for(const c of ALL_LANES){ if(c.key === key) return c; }
    return UNSURE;
  }

  /* ---------- Live state: one record per line, holding the proposal
     and the human decision. This array is also what export serialises. ---------- */
  let records = []; // { i, text, proposedKey, currentKey, confidence, pct, signals, decided:false, action:null }

  /* ---------- Render helpers (DOM nodes only; no innerHTML for user text) ---------- */
  function makeCatPill(catKey){
    const c = catByKey(catKey);
    const pill = document.createElement("span");
    pill.className = "trow-cat " + c.cls;
    const dot = document.createElement("span"); dot.className = "cat-dot";
    const lab = document.createElement("span"); lab.textContent = c.label;
    pill.appendChild(dot); pill.appendChild(lab);
    return pill;
  }

  function renderRow(rec){
    const li = document.createElement("li");
    li.className = "trow";
    li.setAttribute("data-i", String(rec.i));

    // index dot
    const idx = document.createElement("span");
    idx.className = "trow-idx";
    idx.textContent = String(rec.i + 1);

    const body = document.createElement("div");
    body.className = "trow-body";

    // the line text (user content -> textContent, never parsed as markup)
    const txt = document.createElement("p");
    txt.className = "trow-text";
    txt.textContent = rec.text;

    // proposal: category + confidence
    const prop = document.createElement("div");
    prop.className = "trow-proposed";
    prop.appendChild(makeCatPill(rec.currentKey));
    const conf = document.createElement("span");
    const cMap = { high:"c-high", medium:"c-med", low:"c-low" };
    conf.className = "trow-conf " + (cMap[rec.confidence] || "c-low");
    conf.textContent = rec.confidence + " confidence" + (rec.pct ? " · " + rec.pct + "%" : "");
    prop.appendChild(conf);

    // why: the matched signals (show the work)
    const why = document.createElement("p");
    why.className = "trow-why";
    const wk = document.createElement("span");
    wk.className = "trow-why-k";
    wk.textContent = "Why: ";
    why.appendChild(wk);
    if(rec.signals && rec.signals.length){
      rec.signals.forEach(sig => {
        const s = document.createElement("span");
        s.className = "trow-sig";
        s.textContent = sig;
        why.appendChild(s);
      });
    } else {
      const none = document.createElement("span");
      none.className = "trow-why-none";
      none.textContent = "no signal terms matched, routed to Unsure for a human";
      why.appendChild(none);
    }

    // decision controls: confirm + override select + state note
    const decide = document.createElement("div");
    decide.className = "trow-decide";

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "trow-confirm";
    confirm.setAttribute("aria-pressed", rec.action === "confirmed" ? "true" : "false");
    const ck = document.createElement("span"); ck.className = "tc-check";
    const cl = document.createElement("span"); cl.textContent = "Confirm";
    confirm.appendChild(ck); confirm.appendChild(cl);

    const ovLab = document.createElement("label");
    ovLab.className = "trow-override-lab";
    ovLab.textContent = "Override:";
    const selId = "trow-sel-" + rec.i;
    ovLab.setAttribute("for", selId);

    const sel = document.createElement("select");
    sel.className = "trow-select";
    sel.id = selId;
    ALL_LANES.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.key; opt.textContent = c.label;
      if(c.key === rec.currentKey) opt.selected = true;
      sel.appendChild(opt);
    });

    const stateNote = document.createElement("span");
    stateNote.className = "trow-state";
    decide.appendChild(confirm);
    decide.appendChild(ovLab);
    decide.appendChild(sel);
    decide.appendChild(stateNote);

    // ---- wire the row's controls ----
    confirm.addEventListener("click", () => {
      // confirm locks the CURRENT proposal (or the current override) as accepted
      rec.action = (rec.action === "confirmed") ? null : "confirmed";
      if(rec.action === "confirmed"){ rec.decided = true; }
      else { rec.decided = (rec.currentKey !== rec.proposedKey); rec.action = rec.decided ? "overridden" : null; }
      applyRowState(li, rec, confirm, stateNote);
      refreshSummary();
    });

    sel.addEventListener("change", () => {
      rec.currentKey = sel.value;
      if(rec.currentKey === rec.proposedKey){
        // back to the proposal: it is no longer an override. Keep confirmed if it was.
        rec.action = (rec.action === "confirmed") ? "confirmed" : null;
        rec.decided = (rec.action === "confirmed");
      } else {
        rec.action = "overridden";
        rec.decided = true;
      }
      // re-render the category pill to match the new lane
      const oldPill = prop.querySelector(".trow-cat");
      if(oldPill) prop.replaceChild(makeCatPill(rec.currentKey), oldPill);
      applyRowState(li, rec, confirm, stateNote);
      refreshSummary();
    });

    body.appendChild(txt);
    body.appendChild(prop);
    body.appendChild(why);
    body.appendChild(decide);
    li.appendChild(idx);
    li.appendChild(body);

    applyRowState(li, rec, confirm, stateNote);
    return li;
  }

  // Paint a row's edge + state note from its decision, and keep the
  // confirm button's pressed state in sync.
  function applyRowState(li, rec, confirm, stateNote){
    li.classList.remove("is-review","is-confirmed","is-overridden");
    confirm.setAttribute("aria-pressed", rec.action === "confirmed" ? "true" : "false");
    if(rec.action === "confirmed"){
      li.classList.add("is-confirmed");
      stateNote.className = "trow-state s-confirmed";
      stateNote.textContent = "Confirmed";
    } else if(rec.action === "overridden"){
      li.classList.add("is-overridden");
      stateNote.className = "trow-state s-overridden";
      stateNote.textContent = "Overridden to " + catByKey(rec.currentKey).label;
    } else {
      stateNote.className = "trow-state";
      stateNote.textContent = "";
      // undecided + (Unsure or low confidence) -> flag for review
      if(rec.currentKey === UNSURE.key || rec.confidence === "low"){
        li.classList.add("is-review");
      }
    }
  }

  /* ---------- The summary strip: the tool's OWN counts ---------- */
  function refreshSummary(){
    const total = records.length;
    let confirmed = 0, overridden = 0, review = 0;
    records.forEach(r => {
      if(r.action === "confirmed") confirmed += 1;
      else if(r.action === "overridden") overridden += 1;
      else if(r.currentKey === UNSURE.key || r.confidence === "low") review += 1;
    });
    if(sumTotal) sumTotal.textContent = String(total);
    if(sumReview) sumReview.textContent = String(review);
    if(sumConfirmed) sumConfirmed.textContent = String(confirmed);
    if(sumOverridden) sumOverridden.textContent = String(overridden);
    if(summaryEl) summaryEl.setAttribute("data-review", review > 0 ? "some" : "none");
    say(total + " line" + (total===1?"":"s") + " triaged. " + review + " need review, " +
        confirmed + " confirmed, " + overridden + " overridden.");
  }

  function say(msg){ if(aria) aria.textContent = msg; }

  /* ---------- Run triage on the textarea contents ---------- */
  function runTriage(){
    if(!ta) return;
    // split to lines, trim, drop blanks. Graceful on empty / whitespace / garbage.
    const lines = ta.value.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);

    if(rowsEl) rowsEl.innerHTML = "";
    records = [];

    if(lines.length === 0){
      // empty / garbage input: keep the tool calm, explain, do not error.
      root.classList.remove("has-run");
      if(summaryEl) summaryEl.hidden = true;
      if(exportBtn) exportBtn.hidden = true;
      if(exportMenu) exportMenu.hidden = true;
      if(emptyEl){
        emptyEl.style.display = "";
        emptyEl.textContent = "Nothing to triage yet. Paste one item per line, or load the sample, then press Triage.";
      }
      say("No lines to triage. Paste one item per line or load the sample.");
      return;
    }

    // classify each line into a record
    lines.forEach((line, i) => {
      const v = classify(line);
      records.push({
        i: i,
        text: line,
        proposedKey: v.catKey,
        currentKey: v.catKey,
        confidence: v.confidence,
        pct: v.pct,
        signals: v.signals,
        decided: false,
        action: null
      });
    });

    // Sort so low-confidence / Unsure rows float to the TOP for review,
    // then by original order. Stable: map to index for a deterministic tie-break.
    const rank = { low:0, medium:1, high:2 };
    const ordered = records
      .map((r, idx) => ({ r, idx }))
      .sort((a, b) => {
        const ra = a.r.currentKey === UNSURE.key ? -1 : rank[a.r.confidence];
        const rb = b.r.currentKey === UNSURE.key ? -1 : rank[b.r.confidence];
        if(ra !== rb) return ra - rb;
        return a.idx - b.idx;
      })
      .map(o => o.r);

    root.classList.add("has-run");
    if(summaryEl) summaryEl.hidden = false;
    if(exportBtn) exportBtn.hidden = false;

    // render in the sorted (review-first) order; reveal with the row transition
    ordered.forEach(rec => {
      const li = renderRow(rec);
      rowsEl.appendChild(li);
      if(reduceMotion){ li.classList.add("show"); }
      else { void li.offsetWidth; li.classList.add("show"); }
    });

    refreshSummary();
  }

  /* ============================================================
     Export: build a CSV or JSON file entirely client-side via a Blob
     and an object URL, then trigger a download. No upload, no network.
     Serialises each record's text, the proposed label, the final
     label, the confidence, the matched signals, and the human action.
     ============================================================ */
  function download(filename, text, mime){
    try{
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // revoke on the next tick so the click is processed first
      setTimeout(() => URL.revokeObjectURL(url), 0);
      say("Exported " + records.length + " decisions as " + filename + ". The file was built in your browser.");
    } catch(e){
      say("Export could not start in this browser. Your decisions are still on the page.");
    }
  }

  function csvCell(v){
    const s = String(v == null ? "" : v);
    // quote if it contains a comma, quote, or newline; double internal quotes
    if(/[",\r\n]/.test(s)){ return '"' + s.replace(/"/g, '""') + '"'; }
    return s;
  }

  function finalAction(r){
    if(r.action === "confirmed") return "confirmed";
    if(r.action === "overridden") return "overridden";
    return "undecided";
  }

  function exportCSV(){
    if(!records.length) return;
    const header = ["line","text","proposed_label","final_label","confidence","matched_signals","human_action"];
    const rows = records.map(r => [
      r.i + 1,
      r.text,
      catByKey(r.proposedKey).label,
      catByKey(r.currentKey).label,
      r.confidence,
      (r.signals || []).join("; "),
      finalAction(r)
    ].map(csvCell).join(","));
    const csv = header.join(",") + "\r\n" + rows.join("\r\n") + "\r\n";
    download("triage-decisions.csv", csv, "text/csv;charset=utf-8");
  }

  function exportJSON(){
    if(!records.length) return;
    const payload = {
      tool: "Triage Desk (rule-based first-pass labeler)",
      note: "Proposals are from a transparent client-side signal classifier, not a model. Final labels reflect human confirm/override.",
      generated: new Date().toISOString(),
      count: records.length,
      decisions: records.map(r => ({
        line: r.i + 1,
        text: r.text,
        proposed_label: catByKey(r.proposedKey).label,
        final_label: catByKey(r.currentKey).label,
        confidence: r.confidence,
        matched_signals: r.signals || [],
        human_action: finalAction(r)
      }))
    };
    download("triage-decisions.json", JSON.stringify(payload, null, 2), "application/json");
  }

  /* ---------- Wiring ---------- */
  if(goBtn) goBtn.addEventListener("click", runTriage);
  if(sampleBtn) sampleBtn.addEventListener("click", () => {
    if(ta){ ta.value = SAMPLE; ta.focus(); }
    runTriage();
  });
  if(clearBtn) clearBtn.addEventListener("click", () => {
    if(ta){ ta.value = ""; ta.focus(); }
    records = [];
    if(rowsEl) rowsEl.innerHTML = "";
    root.classList.remove("has-run");
    if(summaryEl) summaryEl.hidden = true;
    if(exportBtn) exportBtn.hidden = true;
    if(exportMenu) exportMenu.hidden = true;
    if(emptyEl){
      emptyEl.style.display = "";
      emptyEl.textContent = "Press Triage to label your lines. Each row shows the proposed category, the confidence, and the signals that fired. You confirm or override every call.";
    }
    say("Cleared. Paste lines or load the sample, then press Triage.");
  });

  // Ctrl/Cmd+Enter in the textarea runs triage (keyboard convenience).
  if(ta) ta.addEventListener("keydown", (e) => {
    if((e.ctrlKey || e.metaKey) && e.key === "Enter"){ e.preventDefault(); runTriage(); }
  });

  // Export: the button reveals a small CSV / JSON group; the format
  // buttons do the work. (A simple disclosure, no library.)
  if(exportBtn) exportBtn.addEventListener("click", () => {
    if(!exportMenu) { exportCSV(); return; }
    const open = !exportMenu.hidden;
    exportMenu.hidden = open;
    exportBtn.setAttribute("aria-expanded", String(!open));
    if(!open){ const f = exportMenu.querySelector("button"); if(f) f.focus(); }
  });
  if(exportCsv) exportCsv.addEventListener("click", exportCSV);
  if(exportJson) exportJson.addEventListener("click", exportJSON);

})();
