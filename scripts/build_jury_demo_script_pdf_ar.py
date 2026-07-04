#!/usr/bin/env python3
"""One-page printable Arabic (RTL) cue card for the 5-minute jury demo.
Content mirrors Jury_Demo_Script_5min_AR.md. Requires arabic_reshaper and
python-bidi (pip install arabic_reshaper python-bidi). Run:
    python scripts/build_jury_demo_script_pdf_ar.py"""
import os
from PIL import Image, ImageDraw, ImageFont
import arabic_reshaper
from bidi.algorithm import get_display

ROOT = r"c:/Users/Administrator/smart-elevator-twin"
OUT = os.path.join(ROOT, "Jury_Demo_Script_5min_AR.pdf")

W, H = 1240, 1754
M = 80
INK = (15, 23, 42); BODY = (31, 41, 55); SUB = (71, 85, 105)
CYAN = (14, 136, 153); GREY = (148, 163, 184); RULE = (226, 232, 240)
FB = r"C:/Windows/Fonts/tahomabd.ttf"; FR = r"C:/Windows/Fonts/tahoma.ttf"


def f(path, size):
    return ImageFont.truetype(path, size)


_meas = ImageDraw.Draw(Image.new("RGB", (8, 8)))


def shape(text):
    return get_display(arabic_reshaper.reshape(text))


def wrap_rtl(text, fnt, maxw):
    """Word-wrap logical Arabic text; each returned line is already
    shaped+bidi-reordered and ready to draw left-to-right."""
    words = text.split(" ")
    out = []
    line_words = []
    for w in words:
        trial = line_words + [w]
        trial_shaped = shape(" ".join(trial))
        if _meas.textlength(trial_shaped, font=fnt) <= maxw or not line_words:
            line_words = trial
        else:
            out.append(shape(" ".join(line_words)))
            line_words = [w]
    if line_words:
        out.append(shape(" ".join(line_words)))
    return out


def draw_right(d, y, shaped_line, fnt, fill, right_edge):
    wpx = _meas.textlength(shaped_line, font=fnt)
    d.text((right_edge - wpx, y), shaped_line, font=fnt, fill=fill)


# (heading, timing, [(is_cue, text), ...])
SECTIONS = [
    ("1 · الترحيب", "0:00–0:25 · ~25s", [
        (False, "صباح الخير (أو مساء الخير)، شكرًا لاستضافتنا. أنا [الاسم]، وهذا "
                 "زميلي [الاسم]. في الدقائق الخمس القادمة، سنُريكم مباشرة مصعدًا "
                 "صغيرًا يفكّر بنفسه ولا يُخفي عنكم أي شيء يقوم به.")]),
    ("2 · المشكلة والفكرة", "0:25–1:00 · ~35s", [
        (False, "معظم المصاعد اليوم مجرد صناديق بسيطة: تصعد وتنزل، ولا أحد يراقبها "
                 "فعليًا في الوقت الحقيقي. المشاكل عادة لا تُكتشف إلا بعد وقوعها، "
                 "ولا توجد طريقة بسيطة وآمنة لمتابعتها أو التحكم فيها عن بُعد."),
        (False, "ما قمنا ببنائه يمنح المصعد توأمًا رقميًا حيًّا — نسخة محدَّثة "
                 "باستمرار منه على الشاشة — يمكن لأي شخص مراقبتها، والتصرف بأمان "
                 "بناءً عليها، من أي مكان.")]),
    ("3 · كيف يعمل النظام، في جملة واحدة", "1:00–1:30 · ~30s", [
        (False, "إليكم الفكرة كاملة في جملة واحدة: هذا المصعد الصغير يُرسل باستمرار "
                 "ما يقوم به — في أي طابق هو، هل الباب مفتوح، من قام بتمرير بطاقته "
                 "— عبر رابط لاسلكي، مباشرة إلى هذه الشاشة، التي تعكس ذلك فورًا. كل "
                 "ما يحدث فعليًا، ترونه هنا، لحظة بلحظة."),
        (True, "أشر إلى النموذج، ثم إلى لوحة التحكم.")]),
    ("4 · العرض الأول — التوأم الرقمي يعكس الواقع", "1:30–3:15 · ~105s", [
        (True, "اطلب صعود المقصورة إلى الطابق المحدَّد."),
        (False, "راقبوا المصعد والشاشة في الوقت نفسه. سأطلب الآن صعود المقصورة إلى "
                 "الطابق [X]."),
        (False, "...ها هي تتحرك — وفي اللحظة نفسها، تُظهر الشاشة الأمر ذاته تمامًا: "
                 "نفس الطابق، نفس الاتجاه، تحديث لحظي — وليس تقريرًا من خمس دقائق "
                 "مضت."),
        (True, "عند الوصول:"),
        (False, "تصل المقصورة، يُفتح الباب — والشاشة تُظهر مباشرة 'الباب مفتوح'. "
                 "هذا هو التوأم الرقمي: ليس صورة، بل مرآة حيّة.")]),
    ("5 · العرض الثاني — من المسموح له بالدخول", "3:15–4:15 · ~60s", [
        (True, "مرّر البطاقة المصرّح بها."),
        (False, "الآن، الأمن. بعض الطوابق تتطلب بطاقة معتمدة. لنجرّب أولًا بطاقة "
                 "مصرّحًا بها. النفاذ مقبول — على المصعد، وعلى الشاشة، في اللحظة "
                 "نفسها."),
        (True, "مرّر البطاقة غير المصرّح بها."),
        (False, "والآن بطاقة غير مسجَّلة. النفاذ مرفوض — وانظروا، الشاشة تُطلق "
                 "تنبيهًا أمنيًا وتزيد عدّاد المحاولات. كل محاولة، سواء قُبلت أو "
                 "رُفضت، تُسجَّل. لا شيء يبقى مخفيًا.")]),
    ("6 · ما الذي يجعله \"ذكيًا\"", "4:15–4:45 · ~30s", [
        (False, "هناك أمران يحدثان تلقائيًا لا يمكنكم رؤيتهما مباشرة اليوم: يراقب "
                 "النظام حالته الصحية باستمرار لاكتشاف أي مشكلة قبل أن تتحوّل إلى "
                 "عطل، والأهم من ذلك — كل أمر يُرسَل إليه، سواء من شخص أو من "
                 "البرنامج نفسه، يمرّ تلقائيًا عبر فحص أمان قبل تنفيذه. إن بدا الأمر "
                 "غير آمن، يُرفض ويُسجَّل. بلا استثناء.")]),
    ("7 · الختام", "4:45–5:00 · ~15s", [
        (False, "إذن باختصار: مصعد صغير، نسخة رقمية حيّة منه يمكن الوثوق بها، "
                 "وشبكة أمان حول كل إجراء. هذا إثبات عملي صغير على أن النظام نفسه "
                 "قادر على تشغيل مصعد حقيقي، في مبنى حقيقي. شكرًا لكم، ويسعدنا "
                 "الإجابة عن أي أسئلة.")]),
]

CONTINGENCY = [
    "تأخّر لوحة التحكم أو انقطاعها: تابعوا العرض بثقة، وقولوا \"المصعد يواصل "
    "العمل بأمان من تلقاء نفسه حتى لو تأخّرت الشاشة لحظة، وهذا مقصود في "
    "التصميم\" ثم أكملوا.",
    "عدم قراءة بطاقة RFID بشكل صحيح: أعيدوا المحاولة بهدوء. إن استمر الخلل، "
    "قولوا \"سنعود إلى هذا لاحقًا\" وانتقلوا مباشرة إلى الختام.",
    "ضيق الوقت: احذفوا العرض الثاني (البطاقات) بالكامل وانتقلوا من العرض "
    "الأول مباشرة إلى القسم السادس، مع ذكر التحكم بالدخول في جملة واحدة فقط "
    "دون عرضه فعليًا.",
]

HEAD = f(FB, 22); TIME_F = f(FR, 15); BODY_F = f(FR, 18); CUE_F = f(FR, 17)
LBL = f(FB, 26)
lh = 26

pages = []
page = d = None
y = 0


def new_page(first=False):
    global page, d, y
    page = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(page)
    d.rectangle([0, 0, W, 10], fill=CYAN)
    if first:
        draw_right(d, 40, shape("سيناريو العرض أمام اللجنة (5 دقائق)"), LBL, INK, W - M)
        draw_right(d, 82, shape("توأم رقمي لمصعد ذكي — شرح مبسّط لغير المتخصصين"),
                   f(FR, 17), SUB, W - M)
        y = 128
    else:
        draw_right(d, 34, shape("سيناريو العرض أمام اللجنة (تابع)"), f(FB, 17), SUB, W - M)
        y = 70
    d.line([M, y, W - M, y], fill=RULE, width=2)
    y += 20
    pages.append(page)


new_page(first=True)

for head, timing, lines in SECTIONS:
    wrapped = []
    for is_cue, text in lines:
        fnt = CUE_F if is_cue else BODY_F
        prefix = "← " if is_cue else ""
        wrapped.append((is_cue, wrap_rtl(prefix + text, fnt, W - 2 * M)))
    block = sum(len(ls) * lh + 6 for _, ls in wrapped)
    needed = 34 + block + 14
    if y + min(needed, 34 + 2 * lh) > H - M:
        new_page()
    head_shaped = shape(head)
    draw_right(d, y, head_shaped, HEAD, CYAN, W - M)
    d.text((M, y + 6), timing, font=TIME_F, fill=GREY)
    y += 34
    for is_cue, ls in wrapped:
        fnt = CUE_F if is_cue else BODY_F
        fill = SUB if is_cue else BODY
        for wl in ls:
            if y + lh > H - M:
                new_page()
            draw_right(d, y, wl, fnt, fill, W - M)
            y += lh
        y += 4
    y += 14

if y + 34 + len(CONTINGENCY) * (lh * 2) > H - M:
    new_page()
draw_right(d, y, shape("إذا حدث خلل ما (لا يُقال إلا عند الحاجة)"), f(FB, 19), CYAN, W - M)
y += 32
for item in CONTINGENCY:
    for wl in wrap_rtl("• " + item, BODY_F, W - 2 * M):
        if y + lh > H - M:
            new_page()
        draw_right(d, y, wl, BODY_F, BODY, W - M)
        y += lh
    y += 8

pages[0].save(OUT, "PDF", save_all=True, append_images=pages[1:], resolution=150.0)
print("Saved:", OUT, "| pages:", len(pages))
