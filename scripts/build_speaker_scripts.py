#!/usr/bin/env python3
"""Two-presenter speaker scripts (text only, <=2 pages each), condensed talking points.
Part 1 = Abderrahmane (slides 1-13), Part 2 = Mohamed (slides 14-23)."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT=r"c:/Users/Administrator/smart-elevator-twin"
OUT_A=os.path.join(ROOT,"Defense_Script_Part1_Zaouidi.pdf")
OUT_B=os.path.join(ROOT,"Defense_Script_Part2_Bengherbia.pdf")

W,H=1240,1754; M=80
INK=(15,23,42); BODY=(31,41,55); SUB=(71,85,105); CYAN=(14,136,153); GREY=(148,163,184); RULE=(226,232,240)
FB=r"C:/Windows/Fonts/segoeuib.ttf"; FR=r"C:/Windows/Fonts/segoeui.ttf"; FSB=r"C:/Windows/Fonts/segoeuib.ttf"
def f(p,s): return ImageFont.truetype(p,s)
_m=ImageDraw.Draw(Image.new("RGB",(8,8)))

# slide -> (heading, timing, [lines], para?)
N={
1:("Slide 1 · Introduction","~50s",[
  "Good morning, honoured members of the jury — thank you for being here.",
  "Picture a hospital whose only elevator suddenly stops: patients stranded, staff blocked. Elevators are critical infrastructure — yet most are still supervised reactively, and going online only adds new risks.",
  "We are Abderrahmane Zaouidi and Mohamed Hachem Bengherbia. Our thesis asks one question: can we make elevator management smarter and more secure — without ever letting AI take control?",
  "Our answer is a software platform: a digital twin with safe, rule-based automation. The small four-floor elevator you will see is only our test bench — the software is the real contribution, designed to run a real elevator.",
  "I will present the problem and our solution; then Mohamed opens the platform and shows our results."],True),
2:("Slide 2 · Plan","~20s",[
  "Roadmap: problem → our solution → the tech in plain words → the platform part by part → the ML model → validation → the bigger picture → conclusion."],False),
3:("Slide 3 · Context & problem","~45s",[
  "Today's elevators use fixed, isolated controllers — no live copy, no audited remote commands, security added late.",
  "Six pains: reactive maintenance · long waiting · high electricity bills · high maintenance costs · weak, siloed security · no single live picture.",
  "These are exactly what our platform is built to address."],False),
4:("Slide 4 · Our solution","~55s",[
  "One platform beats a simple elevator on every line: live twin + history, context-aware dispatch (less waiting), an energy strategy, predictive maintenance, audited security, safe remote control, one live picture.",
  "Three points: software is the core; safe by design — AI never controls, a fixed check approves every command; fully reproducible with open tools.",
  "Honesty: we are designed to reduce waiting, energy and maintenance — we do not claim measured savings yet."],False),
5:("Slide 5 · Contributions","~40s",[
  "One reproducible architecture, seven parts: ESP32 test bench · secure messaging · two-way bridge · Ditto shared truth · single-job agents + one safety check · adaptive dispatch (ML in shadow) · safe dashboard.",
  "'Agentic AI' here = small fixed-rule helpers — not autonomous, not generative control."],False),
6:("Slide 6 · The technology, in plain words","~45s",[
  "ESP32 = on-board brain · MQTT / Mosquitto = device messaging + post office · the Bridge = translator into the twin.",
  "Eclipse Ditto = the always-current copy, our source of truth · PostgreSQL = the logbook · n8n = single-job helpers · Next.js = the screen · Docker = packaging · the LLM only explains."],False),
7:("Slide 7 · The whole map","~40s",[
  "The whole platform on one map. Readings go up: elevator → MQTT → bridge → Ditto → dashboard, agents, database.",
  "Commands come down and pass the safety check first.",
  "Three rules: Ditto is the truth · commands are checked requests · the LLM only explains. We now walk it part by part."],False),
8:("Slide 8 · Architecture view","~15s",[
  "(Full-screen architecture — we point to the layers; brief pointer, then continue.)"],False),
9:("Slide 9 · Architecture view","~15s",[
  "(Architecture detail / zoom — brief pointer, then continue.)"],False),
10:("Slide 10 · Part 1 — Field","~40s",[
  "Our reduced-scale 4-floor elevator + ESP32-S3. It reads inputs, runs a safe state machine, and publishes readings over MQTT.",
  "A cheap, safe test bench — a small part of the work."],False),
11:("Slide 11 · Part 2 — Messaging","~40s",[
  "Mosquitto moves readings up; the bridge tidies them into the twin and forwards only approved commands down.",
  "Our security boundary lives here: sign-in, access rules, encryption."],False),
12:("Slide 12 · Part 3 — Digital twin","~45s",[
  "Eclipse Ditto keeps one always-current copy. The bridge writes per-field updates; dashboard and agents read the twin, never raw messages.",
  "One shared truth, ready for many elevators. On screen: the live twin, 15 fields, in sync."],False),
13:("Slide 13 · Part 4 — Agents  →  HANDOFF","~45s",[
  "Small n8n helpers (analysis, security, maintenance, notification, audit) — each one job, fixed rules, one shared format.",
  "Even a lockdown passes the same safety check.",
  "Handoff: \"Now my colleague Mohamed takes you through dispatch, the model, and our results.\""],False),
14:("Slide 14 · Part 5 — Dispatch","~45s",[
  "Thank you, Abderrahmane. Dispatch is how the cabin serves calls.",
  "Two brains: Brain A (a fixed scorer) is active; Brain B (a learning model) runs only in shadow.",
  "Build a context vector → score 8 strategies → the active brain binds → it still passes the safety check. Adaptivity without risk."],False),
15:("Slide 15 · Part 6 — Safety check (the heart)","~55s",[
  "Every command — operator, agent, or system — passes one fixed rule set: allow-listed, authorised, fresh twin, no emergency/overload, safe door, risk within limit.",
  "Pass → update the twin → device. Fail → logged with a reason, nothing changes — zero writes.",
  "Verified 33/33 in tests + 9 live decisions. The LLM is completely outside this — this is how we keep AI from unsafe actions."],False),
16:("Slide 16 · Part 7 — Memory","~35s",[
  "PostgreSQL + TimescaleDB stores telemetry, audit, every command and dispatch decision, work orders, notifications.",
  "Full traceability, and the data for analytics and learning — over 19,600 rows in our run."],False),
17:("Slide 17 · Part 8 — Screen","~35s",[
  "A Next.js dashboard reads the live twin and shows the full picture.",
  "It acts only through safe server APIs — the browser can never command the device. Supervision and requests, not direct control."],False),
18:("Slide 18 · The machine-learning model","~60s",[
  "Brain B (ml_v1) is a softmax linear model: from the live context it picks one of 8 strategies.",
  "Inputs: traffic, energy, machine health (incl. remaining-useful-life), load, security.",
  "Trained and evaluated offline; promoted only if it provably beats Brain A and a human approves; always in shadow.",
  "Today it imitates Brain A at ~66% — below the gate — so we correctly keep Brain A active. Its value: it proves the whole safe pipeline."],False),
19:("Slide 19 · Validation","~50s",[
  "Rule: a test passes only with real evidence; software proof is not hardware proof.",
  "Green: safety check, dispatch, bridge–Ditto sync, messaging security, database, dashboard, n8n.",
  "Amber: ESP32 path (no serial log), hardware bench (documented). Grey, out of scope: KY-024, SPDT, physical RFID. We never call grey green."],False),
20:("Slide 20 · The numbers","~40s",[
  "127 automated tests pass; safety check 33/33 + 9 live decisions; >19,600 telemetry rows; 15 live twin fields in sync; final live run on the full stack, 13 June.",
  "On screen, real evidence: the live twin page and the AI / security / maintenance view."],False),
21:("Slide 21 · The bigger picture","~40s",[
  "Per-elevator IDs, a standard twin and open APIs — so it is designed to plug into a Building Management System, and scale across a smart city: many buildings, many twins, one dashboard.",
  "Honestly: a roadmap, shown for one cabin."],False),
22:("Slide 22 · Conclusion","~45s",[
  "Yes — traceability, command safety and predictive-maintenance support are improved, shown in software, without giving AI any control — while hardware validation stays a stated boundary.",
  "The contribution is the whole safe-by-design architecture — a lab platform, and an honest base toward a hardened industrial system."],False),
23:("Slide 23 · Thank you","~10s",[
  "Thank you for your attention. We welcome your questions."],False),
}

def wrap(text,fnt,maxw):
    out=[]; line=""
    for w in text.split(" "):
        tr=(line+" "+w).strip()
        if _m.textlength(tr,font=fnt)<=maxw: line=tr
        else:
            if line: out.append(line)
            line=w
    if line: out.append(line)
    return out

def build(path, part_no, presenter, role, span, slide_ids):
    HEAD=f(FSB,18); TIME=f(FR,14); BUL=f(FR,16); PARA=f(FR,16)
    lh=24; pages=[]
    def newpage():
        pg=Image.new("RGB",(W,H),"white"); d=ImageDraw.Draw(pg)
        d.rectangle([0,0,W,10],fill=CYAN)
        d.text((M,40),f"PART {part_no}",font=f(FB,18),fill=CYAN)
        d.text((M,66),presenter,font=f(FB,30),fill=INK)
        d.text((M,108),role,font=f(FR,17),fill=SUB)
        d.text((W-M-260,70),span,font=f(FR,15),fill=GREY)
        d.line([M,150,W-M,150],fill=RULE,width=2)
        pages.append(pg); return pg,d,160
    pg,d,y=newpage()
    for sid in slide_ids:
        head,timing,lines,para=N[sid]
        # estimate height of this block
        bl=0
        for ln in lines:
            indent = 0 if para else 26
            bl += len(wrap(("" if para else "•  ")+ln, PARA if para else BUL, W-2*M-(0 if para else 0)))*lh + (8 if para else 2)
        block=30+bl+12
        if y+min(block, 3*lh+30) > H-M-10:
            pg,d,y=newpage()
        # heading + timing
        d.text((M,y),head,font=HEAD,fill=CYAN)
        d.text((W-M-_m.textlength(timing,font=TIME),y+3),timing,font=TIME,fill=GREY)
        y+=30
        for ln in lines:
            if para:
                for k,wl in enumerate(wrap(ln,PARA,W-2*M)):
                    if y+lh>H-M: pg,d,y=newpage()
                    d.text((M,y),wl,font=PARA,fill=BODY); y+=lh
                y+=8
            else:
                wl=wrap("•  "+ln,BUL,W-2*M)
                for k,seg in enumerate(wl):
                    if y+lh>H-M: pg,d,y=newpage()
                    x=M if k==0 else M+26
                    d.text((x,y),seg,font=BUL,fill=BODY); y+=lh
                y+=2
        y+=12
    pages[0].save(path,"PDF",save_all=True,append_images=pages[1:],resolution=150.0)
    return len(pages)

na=build(OUT_A,1,"Abderrahmane Zaouidi","Opening · problem, solution & platform overview","~10 min · slides 1–13",list(range(1,14)))
nb=build(OUT_B,2,"Mohamed Hachem Bengherbia","Platform internals, the model & results","~10 min · slides 14–23",list(range(14,24)))
print("Part 1:",OUT_A,"->",na,"pages")
print("Part 2:",OUT_B,"->",nb,"pages")
