#!/usr/bin/env python3
"""One-page printable cue card for the 5-minute jury demo (plain-language,
non-specialist audience). Content mirrors Jury_Demo_Script_5min.md. Run:
    python scripts/build_jury_demo_script_pdf.py"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"c:/Users/Administrator/smart-elevator-twin"
OUT = os.path.join(ROOT, "Jury_Demo_Script_5min.pdf")

W, H = 1240, 1754
M = 80
INK = (15, 23, 42); BODY = (31, 41, 55); SUB = (71, 85, 105)
CYAN = (14, 136, 153); GREY = (148, 163, 184); RULE = (226, 232, 240)
FB = r"C:/Windows/Fonts/segoeuib.ttf"; FR = r"C:/Windows/Fonts/segoeui.ttf"
FI = r"C:/Windows/Fonts/segoeuii.ttf"


def f(path, size):
    return ImageFont.truetype(path, size)


_meas = ImageDraw.Draw(Image.new("RGB", (8, 8)))


def wrap(text, fnt, maxw):
    out = []
    line = ""
    for w in text.split(" "):
        tr = (line + " " + w).strip()
        if _meas.textlength(tr, font=fnt) <= maxw:
            line = tr
        else:
            if line:
                out.append(line)
            line = w
    if line:
        out.append(line)
    return out


# (heading, timing, [action_cue_or_None, spoken_line, ...])
SECTIONS = [
    ("1 · Hello", "0:00–0:25 · ~25s", [
        (None, "Good [morning/afternoon], thank you for having us. I'm [name] — "
                "this is [name]. In the next five minutes we're going to show "
                "you, live, a small elevator that thinks for itself and never "
                "hides what it's doing.")]),
    ("2 · The problem & the idea", "0:25–1:00 · ~35s", [
        (None, "Most elevators today are simple boxes: they go up, they go "
                "down, and nobody really watches them in real time. Problems "
                "are usually only discovered after they happen, and there's "
                "no simple, safe way to check on them or control them "
                "remotely."),
        (None, "What we built gives an elevator a live digital twin — an "
                "always-up-to-date copy of it on a screen — that a person "
                "can watch, and safely act on, from anywhere.")]),
    ("3 · How it works, in one sentence", "1:00–1:30 · ~30s", [
        (None, "Here's the whole idea in one sentence: this small elevator "
                "constantly reports what it's doing — which floor, is a door "
                "open, who just badged in — over a wireless link, straight "
                "to this screen, which mirrors it instantly. Whatever "
                "happens for real, you see here, live."),
        ("Point to the prototype, then to the dashboard.", None)]),
    ("4 · Demo 1 — the twin mirrors reality", "1:30–3:15 · ~105s", [
        ("Call the cabin to the chosen floor.", None),
        (None, "Watch the elevator and the screen at the same time. I'm "
                "calling the cabin to floor [X]."),
        (None, "...it's moving — and right now the screen shows the exact "
                "same thing: same floor, same direction, updating live — "
                "not a report from five minutes ago."),
        ("On arrival:", None),
        (None, "It arrives, the door opens — and the screen already says "
                "'door open.' That's the digital twin: not a photo, a live "
                "mirror.")]),
    ("5 · Demo 2 — who's allowed in", "3:15–4:15 · ~60s", [
        ("Scan the authorized badge.", None),
        (None, "Now, security. Some floors need an approved badge. Let's "
                "scan one that IS approved. Access granted — on the "
                "elevator, and on the screen, at the same time."),
        ("Scan the unauthorized badge.", None),
        (None, "Now one that is NOT registered. Access denied — and look, "
                "the screen raises a security alert and counts the attempt. "
                "Every scan, approved or not, is recorded. Nothing is "
                "invisible.")]),
    ("6 · What makes it \"smart\"", "4:15–4:45 · ~30s", [
        (None, "Two things happen automatically that you can't see directly "
                "today: it watches its own health to catch a problem before "
                "it becomes a breakdown, and — the most important part — "
                "every single command sent to it, whether from a person or "
                "from the software, is automatically checked by a safety "
                "rule first. If something looks unsafe, it's blocked and "
                "logged. No exceptions.")]),
    ("7 · Closing", "4:45–5:00 · ~15s", [
        (None, "So: a small elevator, a live digital copy of it you can "
                "trust, and a safety net around every action. This is a "
                "small, working proof that the same system can run a real "
                "elevator, in a real building. Thank you — we're happy to "
                "answer any questions.")]),
]

CONTINGENCY = [
    "Dashboard lags or disconnects: keep going — \"the elevator keeps working "
    "safely on its own even if the screen link hiccups for a second, that's "
    "by design\" — then continue.",
    "RFID reader misreads a badge: try once more, calmly. If it still fails, "
    "say \"let's come back to that\" and move straight to the closing.",
    "Running short on time: drop Demo 2 (RFID) entirely and go from Demo 1 "
    "straight to Section 6, mentioning badge access in one sentence instead "
    "of demoing it.",
]

HEAD = f(FB, 22); TIME_F = f(FR, 15); BODY_F = f(FR, 17); CUE_F = f(FI, 17)
LBL = f(FB, 26)
lh = 24

pages = []
page = d = None
y = 0


def new_page(first=False):
    global page, d, y
    page = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(page)
    d.rectangle([0, 0, W, 10], fill=CYAN)
    if first:
        d.text((M, 40), "5-MINUTE JURY DEMO SCRIPT", font=LBL, fill=INK)
        d.text((M, 78), "Smart Elevator Digital Twin — plain-language walkthrough",
                font=f(FR, 17), fill=SUB)
        y = 128
    else:
        d.text((M, 34), "5-Minute Jury Demo Script (cont.)", font=f(FB, 17), fill=SUB)
        y = 70
    d.line([M, y, W - M, y], fill=RULE, width=2)
    y += 20
    pages.append(page)


new_page(first=True)

for head, timing, lines in SECTIONS:
    block = 0
    for cue, spoken in lines:
        text = cue if cue else spoken
        fnt = CUE_F if cue else BODY_F
        block += len(wrap(text, fnt, W - 2 * M)) * lh + 6
    needed = 34 + block + 14
    if y + min(needed, 34 + 2 * lh) > H - M:
        new_page()
    d.text((M, y), head, font=HEAD, fill=CYAN)
    tw = _meas.textlength(timing, font=TIME_F)
    d.text((W - M - tw, y + 4), timing, font=TIME_F, fill=GREY)
    y += 32
    for cue, spoken in lines:
        if cue:
            for wl in wrap("→ " + cue, CUE_F, W - 2 * M):
                if y + lh > H - M:
                    new_page()
                d.text((M, y), wl, font=CUE_F, fill=SUB)
                y += lh
        else:
            for wl in wrap(spoken, BODY_F, W - 2 * M):
                if y + lh > H - M:
                    new_page()
                d.text((M, y), wl, font=BODY_F, fill=BODY)
                y += lh
        y += 4
    y += 14

if y + 34 + len(CONTINGENCY) * (lh * 2) > H - M:
    new_page()
d.text((M, y), "If something goes wrong (not spoken unless needed)", font=f(FB, 19), fill=CYAN)
y += 30
for item in CONTINGENCY:
    for wl in wrap("•  " + item, BODY_F, W - 2 * M):
        if y + lh > H - M:
            new_page()
        d.text((M, y), wl, font=BODY_F, fill=BODY)
        y += lh
    y += 8

pages[0].save(OUT, "PDF", save_all=True, append_images=pages[1:], resolution=150.0)
print("Saved:", OUT, "| pages:", len(pages))
