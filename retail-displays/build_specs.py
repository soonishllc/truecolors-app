"""Builds Truecolors-Display-Build-Spec.pdf: fabrication spec for the Sunbox, Prism and Tower partner displays.
Run with a Python that has reportlab: python build_specs.py"""
from pathlib import Path

from reportlab.graphics.shapes import Circle, Drawing, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, Image, KeepTogether, NextPageTemplate, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

HERE = Path(__file__).parent
OUT = HERE / "Truecolors-Display-Build-Spec.pdf"
DOC_NO, REV, DATE = "TC-DSP-001", "Rev A", "29 October 2026"

for name, file in [("Display", "SpaceGrotesk-Medium"), ("Body", "SpaceGrotesk-Regular"), ("Mono", "JetBrainsMono-Regular"),
                   ("MonoB", "JetBrainsMono-Bold"), ("Serif", "InstrumentSerif-Italic")]:
    pdfmetrics.registerFont(TTFont(name, str(HERE / "fonts" / f"{file}.ttf")))

INK, MUTED, LINE = colors.HexColor("#2a2926"), colors.HexColor("#6f6b64"), colors.HexColor("#e6e2dc")
DARK, OFF, TINT = colors.HexColor("#232220"), colors.HexColor("#faf9f8"), colors.HexColor("#f3f1f0")
GOLD, GOLD_TEXT = colors.HexColor("#cdaa3d"), colors.HexColor("#9a7b20")
SUN = [colors.HexColor(c) for c in ("#c43fd3", "#e5603f", "#f29a0c", "#f2e600")]
UV = colors.HexColor("#8a63e8")
GLASS = colors.HexColor("#e9e5df")

W, H = A4
M = 18 * mm

# ---------- text styles ----------
body = ParagraphStyle("body", fontName="Body", fontSize=9, leading=13.2, textColor=INK, alignment=TA_LEFT)
small = ParagraphStyle("small", parent=body, fontSize=7.6, leading=10.4, textColor=MUTED)
cell = ParagraphStyle("cell", parent=body, fontSize=7.8, leading=10.4)
cellb = ParagraphStyle("cellb", parent=cell, fontName="Display")
label = ParagraphStyle("label", fontName="Mono", fontSize=7.5, leading=10, textColor=GOLD_TEXT, spaceAfter=6)
h1 = ParagraphStyle("h1", fontName="Display", fontSize=24, leading=27, textColor=INK, spaceAfter=8)
h2 = ParagraphStyle("h2", fontName="Display", fontSize=13.5, leading=17, textColor=INK, spaceBefore=12, spaceAfter=6)
h3 = ParagraphStyle("h3", fontName="Display", fontSize=10, leading=13, textColor=INK, spaceBefore=8, spaceAfter=3)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=11, bulletIndent=0, spaceAfter=2)


def P(text, style=body):
    return Paragraph(text, style)


def bullets(items):
    return [Paragraph(t, bullet, bulletText="→") for t in items]


def section(no, title, sub=None):
    out = [CondPageBreak(60 * mm), P(f"§ {no:02d} / {title.upper()}", label), P(title if sub is None else sub, h1)]
    return out


def table(rows, widths, header=True, zebra=True):
    data = [[c if not isinstance(c, str) else Paragraph(c, cellb if (header and r == 0) else cell) for c in row]
            for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
             ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
             ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE)]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), TINT), ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK)]
    t.setStyle(TableStyle(style))
    return t


RENDERS = HERE.parent / "shopify-theme" / "assets"


def render_block(name, notes):
    """Studio render of the unit beside its key design-intent notes."""
    img = Image(str(RENDERS / f"tc-display-{name}.jpg"), width=58 * mm, height=87 * mm)
    side = [P("Design intent", h3), P("Concept render for look and finish. Where it differs from the drawings, "
                                     "the drawings and this text govern.", small), Spacer(1, 4)] + bullets(notes)
    t = Table([[img, side]], colWidths=[62 * mm, W - 2 * M - 62 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (0, 0), 4 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return t


# ---------- drawing helpers (all inputs in mm, drawing units in pt) ----------
class Plot:
    """A Drawing with an mm coordinate system: origin (ox, oy) in pt, s = pt per mm."""

    def __init__(self, width_pt, height_pt):
        self.d = Drawing(width_pt, height_pt)

    def at(self, ox, oy, s):
        self.ox, self.oy, self.s = ox, oy, s
        return self

    def p(self, x, y):
        return self.ox + x * self.s, self.oy + y * self.s

    def rect(self, x, y, w, h, fill=None, stroke=INK, sw=0.6, dash=None):
        X, Y = self.p(x, y)
        self.d.add(Rect(X, Y, w * self.s, h * self.s, fillColor=fill, strokeColor=stroke, strokeWidth=sw, strokeDashArray=dash))

    def poly(self, pts, fill=None, stroke=INK, sw=0.6, dash=None):
        flat = [v for x, y in pts for v in self.p(x, y)]
        self.d.add(Polygon(flat, fillColor=fill, strokeColor=stroke, strokeWidth=sw, strokeDashArray=dash))

    def line(self, x1, y1, x2, y2, stroke=INK, sw=0.5, dash=None):
        self.d.add(Line(*self.p(x1, y1), *self.p(x2, y2), strokeColor=stroke, strokeWidth=sw, strokeDashArray=dash))

    def circle(self, x, y, r, fill=None, stroke=INK, sw=0.6):
        X, Y = self.p(x, y)
        self.d.add(Circle(X, Y, r * self.s, fillColor=fill, strokeColor=stroke, strokeWidth=sw))

    def text(self, x, y, t, size=6, font="Mono", color=INK, anchor="middle", dx=0, dy=0):
        X, Y = self.p(x, y)
        self.d.add(String(X + dx, Y + dy, t, fontName=font, fontSize=size, fillColor=color, textAnchor=anchor))

    def sun_strip(self, x, y, w, h):
        n = 24
        for i in range(n):
            t = i / (n - 1) * 3
            k = min(int(t), 2)
            c = colors.linearlyInterpolatedColor(SUN[k], SUN[k + 1], 0, 1, t - k)
            self.rect(x + w * i / n, y, w / n + 0.3, h, fill=c, stroke=None, sw=0)

    def dim_h(self, x1, x2, y, txt, off=0):
        """Horizontal dimension line at height y (mm) with ticks."""
        self.line(x1, y, x2, y, stroke=MUTED, sw=0.4)
        for x in (x1, x2):
            X, Y = self.p(x, y)
            self.d.add(Line(X - 2, Y - 2, X + 2, Y + 2, strokeColor=MUTED, strokeWidth=0.6))
        self.text((x1 + x2) / 2, y, txt, size=5.6, color=MUTED, dy=2.2 + off)

    def dim_v(self, y1, y2, x, txt, side=1):
        self.line(x, y1, x, y2, stroke=MUTED, sw=0.4)
        for y in (y1, y2):
            X, Y = self.p(x, y)
            self.d.add(Line(X - 2, Y - 2, X + 2, Y + 2, strokeColor=MUTED, strokeWidth=0.6))
        X, Y = self.p(x, (y1 + y2) / 2)
        s = String(0, 0, txt, fontName="Mono", fontSize=5.6, fillColor=MUTED, textAnchor="middle")
        from reportlab.graphics.shapes import Group
        g = Group(s)
        g.transform = (0, 1, -1, 0, X - 2.2 * side, Y) if side > 0 else (0, 1, -1, 0, X + 6.2, Y)
        self.d.add(g)

    def callout(self, x, y, tx, ty, t, anchor="start"):
        self.line(x, y, tx, ty, stroke=GOLD_TEXT, sw=0.35)
        self.circle(x, y, 0.9 / self.s * 2, fill=GOLD_TEXT, stroke=None)
        self.text(tx, ty, t, size=5.6, color=INK, anchor=anchor, dx=2 if anchor == "start" else -2, dy=-2)

    def tee(self, cx, cy, w, h, lit=False):
        """Flat tee outline centred on (cx, cy) fitting w × h mm, with a print."""
        pts = [(31, 8), (43, 4), (50, 9), (57, 4), (69, 8), (92, 25), (82, 41), (72, 35), (72, 97), (28, 97), (28, 35), (18, 41), (8, 25)]
        sx, sy = w / 84, h / 93
        self.poly([(cx + (px - 50) * sx, cy - (py - 50) * sy) for px, py in pts], fill=colors.white, stroke=colors.HexColor("#bdb7ae"), sw=0.5)
        self.circle(cx, cy + 8 * sy, 11 * min(sx, sy), fill=SUN[2] if lit else None, stroke=SUN[1] if lit else colors.HexColor("#8d8880"), sw=0.6)

    def title(self, x, y, t):
        self.text(x, y, t, size=6.4, font="MonoB", color=GOLD_TEXT, anchor="start")


def logo_bar(pl, x, y, w, h):
    pl.rect(x, y, w, h, fill=DARK, stroke=None)
    X, Y = pl.p(x + w / 2, y + h / 2)
    fs = min(h * pl.s * 0.5, w * pl.s / 7)
    from reportlab.graphics.shapes import Group
    word = Group(String(0, 0, "true", fontName="Display", fontSize=fs, fillColor=OFF, textAnchor="end"),
                 String(0, 0, "colors", fontName="Display", fontSize=fs, fillColor=SUN[2], textAnchor="start"))
    word.translate(X - fs * 0.55, Y - fs * 0.35)
    pl.d.add(word)


# ---------- drawings ----------
def draw_sunbox():
    pl = Plot(W - 2 * M, 300)
    # Front elevation, 1:5 → 0.4 pt/mm would be too small; use s = 0.38 pt/mm
    s = 0.37
    pl.at(40, 40, s)
    pl.title(0, 640, "FRONT ELEVATION")
    pl.rect(0, 0, 420, 600, fill=DARK, stroke=INK)
    logo_bar(pl, 0, 516, 420, 84)
    pl.sun_strip(0, 512, 420, 4)
    pl.rect(30, 140, 360, 360, fill=GLASS, stroke=colors.HexColor("#55534f"), sw=1)
    pl.tee(210, 330, 230, 300)
    pl.circle(110, 62, 15, fill=SUN[2], stroke=None)
    pl.circle(110, 62, 8, fill=colors.HexColor("#ffd36b"), stroke=None)
    pl.text(140, 58, "PRESS FOR SUN", size=5, color=OFF, anchor="start")
    pl.rect(300, 30, 70, 70, fill=OFF, stroke=None)
    pl.text(335, 60, "QR", size=5, color=INK)
    pl.dim_h(0, 420, -40, "420")
    pl.dim_h(30, 390, 155 - 40, "360 aperture")
    pl.dim_v(0, 600, -40, "600")
    pl.dim_v(140, 500, 450, "360", side=-1)
    pl.dim_v(516, 600, 450, "84", side=-1)
    pl.dim_v(0, 120, 450, "120", side=-1)
    pl.callout(390, 440, 490, 470, "4 mm UV-filter acrylic")
    pl.callout(215, 516, 490, 560, "Backlit logo header")
    pl.callout(110, 62, 490, 90, "Ø30 illuminated button")
    pl.callout(335, 65, 490, 40, "QR plate 70×70")

    # Side section
    pl.at(305, 40, s)
    pl.title(0, 640, "SIDE SECTION A–A")
    pl.rect(0, 0, 300, 600, fill=None, stroke=INK)
    pl.rect(0, 140, 6, 360, fill=GLASS, stroke=colors.HexColor("#55534f"))
    pl.rect(200, 140, 5, 360, fill=colors.white, stroke=INK, sw=0.4)
    pl.rect(205, 0, 15, 600, fill=TINT, stroke=INK, sw=0.4)
    pl.rect(225, 150, 60, 120, fill=None, stroke=MUTED, dash=[2, 2])
    pl.text(255, 205, "ELEC.", size=4.6, color=MUTED)
    pl.rect(285, 20, 15, 560, fill=colors.HexColor("#d9d4cc"), stroke=INK, sw=0.4)
    for y in (150, 490):
        pl.poly([(8, y), (30, y), (30, y + (14 if y < 300 else -14))], fill=UV, stroke=None)
    pl.line(30, 160, 200, 300, stroke=UV, sw=0.4, dash=[2, 2])
    pl.line(30, 480, 200, 340, stroke=UV, sw=0.4, dash=[2, 2])
    pl.dim_h(0, 300, -40, "300")
    pl.dim_h(0, 200, 520, "~195 cavity", off=0)
    pl.callout(20, 155, 330, 120, "UV strip, 45° alu angle")
    pl.callout(202, 400, 330, 430, "Shirt board, 5 PVC")
    pl.callout(292, 300, 330, 330, "Rear door + interlock")
    pl.callout(212, 560, 330, 560, "15 backboard")
    return pl.d


def draw_prism():
    pl = Plot(W - 2 * M, 520)
    s = 0.245
    # Face A
    pl.at(40, 50, s)
    pl.title(0, 1930, "FACE A — SCREEN")
    pl.rect(0, 0, 600, 1850, fill=DARK, stroke=INK)
    pl.rect(25, 0, 550, 100, fill=colors.HexColor("#151413"), stroke=None)
    logo_bar(pl, 0, 1650, 600, 200)
    pl.sun_strip(0, 1646, 600, 4)
    pl.rect(90, 880, 420, 725, fill=colors.HexColor("#0d0d0c"), stroke=colors.HexColor("#55534f"))
    pl.rect(101, 893, 398, 700, fill=colors.HexColor("#1d1c26"), stroke=None)
    pl.tee(300, 1280, 260, 300, lit=True)
    pl.text(300, 1000, "SCREEN LOOP", size=4.8, color=OFF)
    pl.rect(70, 300, 460, 470, fill=None, stroke=colors.HexColor("#55534f"), dash=[3, 2])
    pl.text(300, 660, "GRAPHIC PANEL", size=4.8, color=OFF)
    pl.text(300, 615, "(access door)", size=4.4, color=MUTED)
    pl.rect(225, 360, 150, 150, fill=OFF, stroke=None)
    pl.text(300, 430, "QR", size=4.8)
    pl.dim_h(0, 600, -90, "600")
    pl.dim_v(0, 1850, -70, "1850")
    pl.dim_v(880, 1605, 640, "725", side=-1)
    pl.dim_v(0, 880, 640, "880", side=-1)
    pl.dim_v(1650, 1850, 640, "200", side=-1)
    pl.dim_v(0, 100, 760, "100", side=-1)

    # Face B / C
    pl.at(225, 50, s)
    pl.title(0, 1930, "FACES B + C — DEMO")
    pl.rect(0, 0, 600, 1850, fill=colors.HexColor("#2b2a27"), stroke=INK)
    pl.rect(25, 0, 550, 100, fill=colors.HexColor("#151413"), stroke=None)
    logo_bar(pl, 0, 1650, 600, 200)
    pl.sun_strip(0, 1646, 600, 4)
    pl.rect(90, 800, 420, 560, fill=GLASS, stroke=colors.HexColor("#55534f"), sw=1.2)
    pl.tee(300, 1080, 360, 470)
    pl.circle(555, 1080, 15, fill=SUN[2], stroke=None)
    pl.circle(555, 1080, 8, fill=colors.HexColor("#ffd36b"), stroke=None)
    pl.rect(70, 160, 460, 400, fill=None, stroke=colors.HexColor("#55534f"), dash=[3, 2])
    pl.text(300, 360, "DESIGN NAME PANEL", size=4.6, color=OFF)
    pl.dim_h(90, 510, -90, "420 aperture")
    pl.dim_v(800, 1360, 640, "560", side=-1)
    pl.dim_v(0, 800, 640, "800", side=-1)
    pl.dim_v(0, 1080, 760, "1080 ⌀ btn", side=-1)

    # Plan
    pl.at(400, 300, 0.15)
    pl.title(-40, 1180, "PLAN (TOP)")
    import math
    a = 600
    hgt = a * math.sqrt(3) / 2
    tri = [(0, 0), (a, 0), (a / 2, hgt)]
    pl.poly(tri, fill=TINT, stroke=INK, sw=0.8)
    t2 = [(60, 35), (a - 60, 35), (a / 2, hgt - 70)]
    pl.poly(t2, fill=None, stroke=MUTED, dash=[2, 2])
    pl.rect(a / 2 - 20, hgt / 3 - 20, 40, 40, fill=MUTED, stroke=None)
    pl.text(a / 2, -60, "FACE A", size=5)
    pl.text(80, hgt / 2 + 40, "B", size=5, anchor="end")
    pl.text(a - 80, hgt / 2 + 40, "C", size=5, anchor="start")
    pl.dim_h(0, a, -140, "600")
    pl.callout(a / 2, hgt / 3, a / 2, -420, "40×40 SHS spine", anchor="middle")
    pl.text(a / 2, -260, "0.156 m² footprint", size=5, color=MUTED)

    return pl.d


def draw_tower():
    pl = Plot(W - 2 * M, 330)
    s = 0.15
    w, d, h, side = 1016, 559, 1829, 70
    cw = (w - 2 * side - 3 * 18) / 4
    pl.at(60, 40, s)
    pl.title(0, 1920, "FRONT = BACK ELEVATION — STOCK")
    pl.rect(0, 0, w, h, fill=DARK, stroke=INK)
    pl.rect(30, 0, w - 60, 100, fill=colors.HexColor("#151413"), stroke=None)
    logo_bar(pl, 0, 1700, w, 129)
    pl.sun_strip(0, 1696, w, 4)
    for i, c in enumerate(["S", "M", "L", "XL"]):
        x = side + i * (cw + 18)
        pl.text(x + cw / 2, 1652, c, size=5, color=OFF)
        for r in range(7):
            y = 118 + r * 216
            pl.rect(x, y, cw, 198, fill=colors.HexColor("#3a3936"), stroke=None)
            pl.rect(x + 18, y + 10, cw - 36, 80, fill=colors.HexColor("#f4f1ec"), stroke=None)
    pl.dim_h(0, w, -120, "1016")
    pl.dim_v(0, h, -100, "1829")
    pl.dim_v(118, 316, w + 60, "198", side=-1)
    for bx in (side / 2, w - side / 2):
        pl.circle(bx, 1050, 15, fill=SUN[2], stroke=None)
    pl.callout(w - side / 2, 1050, w + 60, 1250, "Button 1050 AFF")
    pl.dim_h(side, side + cw, 70, f"{cw:.0f}")

    pl.at(320, 40, s)
    pl.title(0, 1920, "SIDE ELEVATION — GALLERY (BOTH SIDES)")
    pl.rect(0, 0, d, h, fill=colors.HexColor("#2b2a27"), stroke=INK)
    logo_bar(pl, 0, 1700, d, 129)
    pl.sun_strip(0, 1696, d, 4)
    gx, gy, gw, gh = (d - 470) / 2, 520, 470, 1140
    pl.rect(gx, gy, gw, gh, fill=GLASS, stroke=colors.HexColor("#55534f"), sw=1)
    for r in range(5):
        for c in range(2):
            pl.tee(gx + 122 + c * 226, gy + gh - 120 - r * 228, 190, 200)
    pl.dim_h(0, d, -120, "559")
    pl.dim_v(gy, gy + gh, d + 50, "1140", side=-1)
    pl.dim_h(gx, gx + gw, gy - 60, "470")
    pl.callout(gx + gw - 10, gy + gh - 40, d + 150, 1600, "UV-filter glazing, hinged")
    pl.callout(gx + 10, gy + 600, d + 150, 1150, "10 face-out tees, 60 deep")
    return pl.d


def draw_wiring():
    pl = Plot(W - 2 * M, 190)
    pl.at(0, 0, 1)

    def box(x, y, w, h, t1, t2="", fill=TINT):
        pl.rect(x, y, w, h, fill=fill, stroke=INK, sw=0.6)
        pl.text(x + w / 2, y + h / 2 + 2, t1, size=6, font="MonoB")
        if t2:
            pl.text(x + w / 2, y + h / 2 - 7, t2, size=5.2, color=MUTED)

    def arrow(x1, y1, x2, y2, t="", c=INK):
        pl.line(x1, y1, x2, y2, stroke=c, sw=0.7)
        import math
        a = math.atan2(y2 - y1, x2 - x1)
        for da in (2.6, -2.6):
            pl.line(x2, y2, x2 - 5 * math.cos(a + da / 6), y2 - 5 * math.sin(a + da / 6), stroke=c, sw=0.7)
        if t:
            pl.text((x1 + x2) / 2, (y1 + y2) / 2 + 3, t, size=5, color=MUTED)

    box(0, 120, 78, 40, "MAINS INLET", "IEC C14 + fuse + switch")
    box(110, 140, 82, 32, "POWER STRIP", "internal, 4-way")
    box(110, 92, 82, 32, "12 V PSU", "enclosed, 60–100 W")
    box(225, 150, 90, 30, "SCREEN", "32\" signage, USB loop")
    box(225, 104, 90, 30, "FUSE 3 A", "per UV channel")
    box(345, 104, 90, 30, "TIMER RELAY", "delay-off, 20 s")
    box(225, 40, 90, 34, "PUSH BUTTON", "momentary, 12 V ring LED")
    box(345, 40, 90, 34, "DOOR SWITCH", "NC, opens = UV off")
    box(462, 104, 64, 30, "UV-A LEDs", "365 nm strip", fill=colors.HexColor("#ece5fb"))
    box(462, 150, 64, 30, "HEADER LEDs", "4000 K backlight")
    arrow(78, 140, 110, 156)
    arrow(78, 140, 110, 108)
    arrow(192, 160, 225, 165, "AC")
    arrow(192, 108, 225, 119, "12 V")
    arrow(315, 119, 345, 119)
    arrow(435, 119, 462, 119)
    arrow(270, 74, 370, 104, "trigger")
    arrow(390, 74, 470, 104, "", c=colors.HexColor("#b8322a"))
    arrow(192, 112, 462, 165, "12 V")
    pl.text(0, 18, "Sunbox: no mains inside. A certified 12 V 2 A plug-in adapter feeds the DC jack; the rest of the 12 V side is the same.",
            size=5.8, anchor="start", color=MUTED)
    pl.text(0, 6, "Prism has one timer + button + LED channel per demo face (2). The door switch breaks the LED supply, not the trigger.",
            size=5.8, anchor="start", color=MUTED)
    return pl.d


# ---------- page furniture ----------
def furniture(c, doc):
    c.saveState()
    c.setFillColor(DARK)
    c.rect(0, H - 14 * mm, W, 14 * mm, stroke=0, fill=1)
    c.drawImage(str(HERE / "logo.png"), M, H - 10.2 * mm, width=33 * mm, height=33 * mm * 163 / 1200, mask="auto")
    c.setFont("Mono", 7)
    c.setFillColor(colors.HexColor("#a49f97"))
    c.drawRightString(W - M, H - 8.6 * mm, f"PARTNER DISPLAYS · BUILD SPEC · {DOC_NO} {REV}")
    n = 40
    for i in range(n):
        t = i / (n - 1) * 3
        k = min(int(t), 2)
        c.setFillColor(colors.linearlyInterpolatedColor(SUN[k], SUN[k + 1], 0, 1, t - k))
        c.rect(i * W / n, H - 14 * mm - 1.2, W / n + 0.5, 1.2, stroke=0, fill=1)
    c.setFont("Mono", 6.6)
    c.setFillColor(MUTED)
    c.drawString(M, 10 * mm, f"True Colors Trading LLC · Confidential: for fabrication quotes only · {DATE}")
    c.drawRightString(W - M, 10 * mm, f"{doc.page}")
    c.restoreState()


def cover(c, doc):
    c.saveState()
    c.setFillColor(DARK)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.drawImage(str(HERE / "logo.png"), M, H - 34 * mm, width=62 * mm, height=62 * mm * 163 / 1200, mask="auto")
    n = 60
    for i in range(n):
        t = i / (n - 1) * 3
        k = min(int(t), 2)
        c.setFillColor(colors.linearlyInterpolatedColor(SUN[k], SUN[k + 1], 0, 1, t - k))
        c.rect(M + i * (W - 2 * M) / n, H - 44 * mm, (W - 2 * M) / n + 0.4, 2.4, stroke=0, fill=1)
    c.setFont("Mono", 8)
    c.setFillColor(GOLD)
    c.drawString(M, H - 70 * mm, "§ BUILD SPECIFICATION · RETAIL PARTNER DISPLAYS")
    c.setFillColor(OFF)
    c.setFont("Display", 40)
    c.drawString(M, H - 90 * mm, "Sunbox, Prism")
    c.drawString(M, H - 105 * mm, "and Tower.")
    c.setFont("Serif", 30)
    c.setFillColor(colors.HexColor("#d8d4cd"))
    c.drawString(M, H - 120 * mm, "Displays that bring the sun indoors.")
    c.setFont("Body", 10.5)
    c.setFillColor(colors.HexColor("#c9c5be"))
    y = H - 140 * mm
    for line in ["Fabrication brief for three consignment displays placed in hotel boutiques,",
                 "airport retail and attractions. Each carries a UV-A \"sun\" so guests can",
                 "see Truecolors prints change colour indoors."]:
        c.drawString(M, y, line)
        y -= 15
    rows = [("Document", f"{DOC_NO} {REV}"), ("Date", DATE), ("Issued by", "True Colors Trading LLC, Dubai"),
            ("Contact", "hello@truecolors.global"), ("Units", "Millimetres unless stated"),
            ("Status", "For quotation and prototype. Not for production until shop drawings are approved.")]
    y = 70 * mm
    for k, v in rows:
        c.setFont("Mono", 7.5)
        c.setFillColor(colors.HexColor("#8a8780"))
        c.drawString(M, y, k.upper())
        c.setFont("Body", 9.5)
        c.setFillColor(OFF)
        c.drawString(M + 32 * mm, y, v)
        y -= 6.5 * mm
    c.restoreState()


# ---------- content ----------
def build():
    doc = BaseDocTemplate(str(OUT), pagesize=A4, leftMargin=M, rightMargin=M, topMargin=22 * mm, bottomMargin=17 * mm,
                          title="Truecolors Partner Displays — Build Specification", author="True Colors Trading LLC")
    frame = Frame(M, 17 * mm, W - 2 * M, H - 39 * mm, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate("cover", [frame], onPage=cover), PageTemplate("page", [frame], onPage=furniture)])
    FW = W - 2 * M
    s = [NextPageTemplate("page"), PageBreak()]

    # 1 Overview
    s += section(1, "Overview", "Three displays, one job.")
    s += [P("Truecolors tees are printed with UV-reactive ink: grey line art in the shade, full colour in direct sun. Indoor "
            "shop lighting has almost no UV, so every display carries its own sealed UV-A light that guests trigger with a "
            "button. The displays are placed on consignment in partner venues and must survive public use with little care "
            "from venue staff. Truecolors installs, restocks and services them."), Spacer(1, 8)]
    s += [table([["", "Sunbox", "Prism", "Tower"],
                 ["Code", "TC-SBX", "TC-PRS", "TC-TWR"],
                 ["Type", "Countertop, one demo shirt", "Floor, 3-sided, display only", "Floor, stock + design gallery"],
                 ["Overall (W × D × H)", "420 × 300 × 600", "600 per side (triangle) × 1850", "1016 × 559 × 1829"],
                 ["Floor / counter area", "0.13 m² counter", "0.156 m²", "0.57 m²"],
                 ["Demo shirts", "1", "2 (faces B, C)", "20 designs (10 per side)"],
                 ["Screen", "None (QR to video)", "32\" portrait, face A", "None"],
                 ["Stock held", "None", "None, sold at till", "~340 tees, 28 through-cubbies"],
                 ["Power", "12 V plug-in adapter", "Mains, 1 socket", "Mains, 1 socket"],
                 ["Target mass", "≈ 7 kg", "≈ 80–90 kg (ballasted)", "≈ 80 kg"],
                 ["Quantity, first run", "Quote 10 / 25 / 50", "Quote 3 / 10 / 25", "Quote 2 / 5 / 10"]],
                [32 * mm, (FW - 32 * mm) / 3] * 1 + [(FW - 32 * mm) / 3] * 2)]
    s += [Spacer(1, 6), P("Build the first unit of each type as a prototype for sign-off before batch production. The UV "
                          "module (section 6) should be proven on a bench rig with real Truecolors shirts before cabinets are cut.", small)]

    # 2 General requirements
    s += section(2, "General requirements", "Applies to every unit.")
    s += [P("Brand finishes", h2),
          table([["Element", "Specification"],
                 ["Carcass colour", "Charcoal <b>#232220</b>. Matt 2K PU lacquer, 10–15 gloss units, or 0.8 mm matt HPL. Submit a drawdown for approval."],
                 ["Interior of UV boxes", "Off-white <b>#FAF9F8</b>, matt. No optical brighteners (they fluoresce under UV)."],
                 ["Gradient strip", "4 mm band under every header: #C43FD3 → #E5603F → #F29A0C → #F2E600, printed vinyl or UV-print on acrylic. Artwork supplied."],
                 ["Logo", "Truecolors wordmark (white \"true\" + gradient \"colors\"), only ever on charcoal. Vector artwork supplied; never redraw."],
                 ["Type on graphics", "Space Grotesk (headings), JetBrains Mono (labels). All print-ready artwork supplied by Truecolors."],
                 ["Edges & corners", "2 mm ABS edge band or anodised aluminium angle (black). Exposed external corners radius ≥ 3 mm."]],
                [38 * mm, FW - 38 * mm])]
    s += [P("Materials", h2),
          table([["Part", "Material", "Notes"],
                 ["Carcass panels", "18 mm moisture-resistant MDF (E1 / CARB P2), or 18 mm birch ply", "Sunbox may use 15 mm. Ply for Prism faces if MDF chips at mitres."],
                 ["Structure (Prism)", "40 × 40 × 3 mm steel SHS spine, 10 mm steel base plate", "Powder-coat black. Spine carries the screen VESA bracket."],
                 ["Demo glazing", "UV-filtering acrylic, ≥ 98% UV block below 380 nm", "4 mm Sunbox, 5 mm floor units. e.g. ACRYLITE OP-3, PLEXIGLAS UF-3 or equivalent."],
                 ["Shirt backboard", "5 mm white PVC foam board", "Shirt fixed with clear clips; quick to swap."],
                 ["Header lightbox", "5 mm opal acrylic, printed backlit film, 12 V LED module 4000 K", "Even light, no hotspots at 300 mm viewing."],
                 ["Graphic panels", "3 mm aluminium composite (Dibond) or 3 mm white acrylic, UV-printed, matt laminate", "Panels removable for re-branding per venue."],
                 ["Fixings", "Security Torx (pin) screws on public faces; knock-down cam fittings internally", "All service doors on one keyed-alike cam lock (key code agreed with Truecolors)."],
                 ["Feet", "M10 levelling feet, ±15 mm, nylon pads", "Floor units only. Sunbox: 4 rubber feet + tether point."]],
                [32 * mm, 62 * mm, FW - 94 * mm])]
    s += [P("Electrical & safety", h2)] + bullets([
        "All mains components certified for the country of installation (UL/ETL in the US, CE/UKCA in Europe and the UK, ECAS-registered in the UAE, NOM in Mexico). Ask Truecolors for the destination before ordering parts.",
        "Mains enters through one panel-mount IEC C14 inlet with fuse and switch. Supply a 3 m cord with the local plug. Earth all exposed metal (Class I).",
        "Everything inside except the screen runs on 12 V SELV from one enclosed PSU. Fuse each 12 V branch. Strain-relieve and tie every cable; no loose wiring in any shirt cavity.",
        "Vent the electronics bays: slot vents top and bottom. Internal temperature must stay under 40 °C at 30 °C ambient (fit a thermostat fan if needed).",
        "Floor units must not tip with a 50 N horizontal push at the top edge in any direction, or when tilted 10°. Provide floor-fixing points for airports.",
        "UV light must never be visible directly from outside: no line of sight to an LED from any viewing position 0–1800 mm high. See section 6.",
        "Fit a rating and serial plate on the rear: model code, serial, date, maker, voltage, power."])

    # 3 Sunbox
    s += [PageBreak()] + section(3, "Sunbox · TC-SBX", "Sunbox, the countertop unit.")
    s += [P("A small lit shadow box that sits beside the till. It holds one folded demo shirt behind UV-filtering glazing. "
            "Pressing the button lights the shirt for 20 seconds. It holds no stock; staff sell from behind the counter."),
          Spacer(1, 6), render_block("sunbox", [
              "Reads as a lit picture frame: charcoal box, glowing header, bright window.",
              "The violet glow is visible on the inside edges only; LEDs themselves are hidden.",
              "Button is the only colour on the base, so it's obvious what to press.",
              "Same header, stripe and button as the floor units: one family."]),
          CondPageBreak(110 * mm), Spacer(1, 6), draw_sunbox(), Spacer(1, 4)]
    s += [P("Construction", h3)] + bullets([
        "Five-sided 15 mm MDF box, charcoal outside, off-white inside. Front frame rebated 8 mm to take the 376 × 376 × 4 mm glazing, held by a screwed bezel (security Torx).",
        "Header 420 × 84: lightbox with printed logo film over 5 mm opal acrylic; 4 mm gradient strip below.",
        "Base zone 0–120: Ø30 illuminated button (left) and 70 × 70 QR plate (right) linking to the shade-to-sun video.",
        "Shirt: adult tee retail-folded to about 250 × 330, clipped to a 5 mm PVC foam board 195 mm behind the glazing.",
        "Rear lift-off door with cam lock and interlock switch: opening it switches the UV off. Electronics on the inside of the backboard.",
        "Power: certified 12 V 2 A plug-in adapter, 5.5/2.1 mm DC jack on the rear, 2 m lead. Four rubber feet and a steel tether loop for a security cable."])
    s += [P("Sunbox bill of materials (per unit)", h3),
          table([["Qty", "Item", "Specification", "Est. USD"],
                 ["1", "Cabinet kit", "15 mm MR MDF, lacquered, per drawing", "Fabricator"],
                 ["1", "Glazing", "376 × 376 × 4 mm UV-filtering acrylic", "Fabricator"],
                 ["0.7 m", "UV-A LED strip", "12 V, 365 nm, 60 LED/m, in 2 × 330 mm runs", "10–25"],
                 ["2", "Aluminium angle profile", "45° LED channel, no diffuser, 330 mm", "4–8"],
                 ["1", "Push button", "Ø30 (or 22 mm), momentary, stainless anti-vandal, 12 V ring LED", "8–20"],
                 ["1", "Timer relay", "12 V delay-off module, trigger input, set to 20 s", "5–15"],
                 ["1", "Interlock switch", "Micro-switch, NC, roller lever", "2–5"],
                 ["1", "Header LED", "12 V LED module / strip, 4000 K, ~2 W", "3–8"],
                 ["1", "PSU", "12 V 2 A plug-in adapter, locally certified", "8–15"],
                 ["1", "Graphics", "Header film, gradient strip, QR plate (artwork supplied)", "Printer"]],
                [12 * mm, 34 * mm, FW - 70 * mm, 24 * mm])]

    # 4 Prism
    s += [PageBreak()] + section(4, "Prism · TC-PRS", "Prism, the three-sided floor unit.")
    s += [P("A triangular column that draws people in from across the floor. Face A plays a looping video on a 32\" portrait "
            "screen. Faces B and C each hold one demo shirt behind UV glazing with its own button. The Prism holds no stock: "
            "graphics send guests to the counter for sizes."),
          Spacer(1, 6), render_block("prism", [
              "A slim triangular column: from any approach, guests see a screen or a lit shirt.",
              "Sharp, trimmed vertical corners; flat triangular top cap.",
              "Lower panels carry venue-specific line art in tone-on-tone grey (artwork supplied).",
              "The lit window and the orange button are the brightest things on the unit."]),
          PageBreak(), draw_prism()]
    s += [P("Construction", h3)] + bullets([
        "Plan: equilateral triangle, 600 mm per face, 1850 mm high. Corners finished with black anodised 60° aluminium angle.",
        "Structure: 10 mm steel triangular base plate (side 540) with a central 40 × 40 SHS spine, and 18 mm MDF triangular bulkheads at 100, 800, 1360 and 1646. Face panels screw to the bulkheads from inside.",
        "Ballast: 2 × 8 kg steel plates bolted to the base plate. Three M10 levellers in a 25 mm recessed plinth with a 12 V LED floor wash. Three Ø9 holes for optional floor anchors.",
        "Ships as two modules: body (0–1646) and crown (1646–1850), located with dowels and fixed with M8 bolts from inside. The crown has a plug-and-socket for the header LEDs.",
        "Face A: screen on a VESA 200 × 200 bracket fixed to the spine; cut the aperture to the chosen screen's bezel +2 mm. The lower graphic panel (300–770) is the lockable access door to the electronics bay (PSU, strip, timers).",
        "Faces B and C: the glazing frame (420 × 560 aperture, 5 mm UV-filter acrylic) is hinged on one side with a cam lock and interlock on the other. Shirt board sits ~80 mm behind the glazing on spine brackets. Use an adult S/M tee with sleeves folded behind, or a youth L laid flat.",
        "Each demo face has its button in the 90 mm margin beside the window, centred at 1080 mm above floor: natural reach, and well above kicking height. Screen centre at about 1240 mm (eye level).",
        "Vent the screen bay at the top of face A and through the crown. Mass target 80–90 kg."])
    s += [P("Prism bill of materials (per unit)", h3),
          table([["Qty", "Item", "Specification", "Est. USD"],
                 ["1", "Cabinet + crown", "18 mm MR MDF, lacquered, aluminium corner angles", "Fabricator"],
                 ["1", "Steel frame", "10 mm base plate, 40 × 40 SHS spine, 2 × 8 kg ballast, powder-coated", "Fabricator"],
                 ["1", "Display", "32\" commercial signage, portrait, ≥ 350 cd/m², 16/7 rated, USB autoplay, VESA 200 (e.g. Samsung QM32R, LG 32SM5J or equivalent)", "450–900"],
                 ["2", "Glazing", "440 × 580 × 5 mm UV-filtering acrylic (in hinged frames)", "Fabricator"],
                 ["1.8 m", "UV-A LED strip", "12 V, 365 nm, 60 LED/m: 2 × 420 mm per demo face", "25–60"],
                 ["2", "Push button", "Ø30 momentary, stainless anti-vandal, 12 V ring LED", "16–40"],
                 ["2", "Timer relay", "12 V delay-off module, 20 s", "10–30"],
                 ["2", "Interlock switch", "Micro-switch, NC", "4–10"],
                 ["1", "PSU", "12 V 60–100 W enclosed (Mean Well LRS series or equivalent)", "20–35"],
                 ["1", "Mains", "IEC C14 fused inlet with switch, 4-way internal strip, 3 m local cord", "20–40"],
                 ["3", "Header LEDs", "12 V LED modules, 4000 K, for 3 crown lightboxes", "10–25"],
                 ["1", "Fan (if needed)", "80 mm 12 V quiet fan with 35 °C thermostat switch", "10–20"],
                 ["1", "Graphics set", "3 header films, 3 gradient strips, 3 lower panels, QR (artwork supplied)", "Printer"]],
                [12 * mm, 30 * mm, FW - 66 * mm, 24 * mm])]

    # 5 Tower
    s += [PageBreak()] + section(5, "Tower · TC-TWR", "Tower, stock and a 20-design gallery.")
    s += [P("A shop-in-shop for high-traffic boutiques, sized like the existing Magic Tees reference stand (40 × 22 × 72 in). "
            "Like the reference, it shows many designs at once: each side carries a gallery of 10 face-out tees behind UV "
            "glazing (20 designs in all), lit by its own button. The stock sits in 28 through-cubbies, open front and back, "
            "in four size columns with one design per row: as an island it is shopped from both sides, and against a wall it "
            "still works from the front, with no dead space behind."),
          Spacer(1, 6), render_block("tower", [
              "Galleries face the two approaches, so guests see lit designs from either side.",
              "Front stock stays grey (no UV reaches it): the contrast with the lit gallery is the sales pitch.",
              "One design per row of cubbies, sizes S–XL across, as on the label rail; the back is identical.",
              "Venue picks its 20 gallery designs; we swap them on restock."]),
          CondPageBreak(120 * mm), Spacer(1, 4), draw_tower()]
    s += [P("Construction", h3)] + bullets([
        "Carcass 18 mm MR MDF, 1016 × 559 × 1829, open front and back. Four columns (S, M, L, XL) by seven rows of through-cubbies, clear about 206 × 198 × 523, with a 22 mm high centre lip on each shelf so the front and back stacks stay separate; 70 mm side zones house the galleries.",
        "Front and back faces are identical: header lightbox, S–XL label rail, 28 openings. Place as an island, or against a wall (restock from the front; the back openings simply face the wall).",
        "Side galleries (both sides): aperture 470 × 1140 at 520–1660, 60 mm deep, off-white back. Ten folded tees face-out on 2 × 5 clear acrylic ledges (about 200 × 210 each).",
        "Each gallery: 5 mm UV-filter acrylic in a hinged frame (piano hinge, cam lock, interlock), UV-A strips down both long edges, its own timer, and one Ø30 button on the front corner post beside the gallery (the 70 mm stile) at 1050 mm above floor: natural reach, visible from the front, and out of kicking range. On island sites a second pair can go on the back corner posts.",
        "Header lightbox wraps all four sides (129 high), gradient strip below. Size labels on a 40 mm rail above the cubbies, front and back.",
        "No rear door: electronics (PSU, timers, mains strip) live in the header box behind a lockable lift-off top panel, with mains entering through the plinth.",
        "Ships flat-packed: carcass, header and shelf kit with cam fittings. Four M10 levellers; anti-tip wall strap included."])
    s += [P("Tower bill of materials (per unit)", h3),
          table([["Qty", "Item", "Specification", "Est. USD"],
                 ["1", "Cabinet", "18 mm MR MDF, lacquered, 28 through-cubbies with centre lips, two gallery bays, per drawing", "Fabricator"],
                 ["2", "Glazing", "486 × 1156 × 5 mm UV-filtering acrylic, in hinged frames", "Fabricator"],
                 ["20", "Gallery ledges", "Clear 3 mm acrylic ledge, 200 wide, with front lip", "Fabricator"],
                 ["4.6 m", "UV-A LED strip", "12 V, 365 nm, 60 LED/m: 2 × 1140 mm per gallery (both long edges)", "60–140"],
                 ["2", "Push button, timer, interlock", "As Sunbox, one set per gallery", "30–80"],
                 ["1", "PSU + mains", "12 V 100 W enclosed PSU, IEC fused inlet, 3 m cord", "40–70"],
                 ["1", "Header LEDs", "12 V, 4000 K", "5–12"],
                                  ["1", "Graphics set", "Four-sided header, gradient strip, size labels front and back", "Printer"]],
                [12 * mm, 38 * mm, FW - 74 * mm, 24 * mm])]
    s += [Spacer(1, 4), P("Est. USD covers bought-in components only, at small-batch prices; confirm locally. Cabinet, glazing, "
                          "steel and print are quoted by the fabricator.", small)]

    # 6 UV module
    s += [PageBreak()] + section(6, "The sun module", "The UV demo module (all units).")
    s += [P("This is the part that sells the shirt, so prove it first. Build a bench rig with one LED channel, one button and "
            "one timer, and test it on shirts Truecolors supplies before committing the cabinet design."), Spacer(1, 6),
          draw_wiring(), Spacer(1, 6)]
    s += [table([["Item", "Requirement"],
                 ["Light source", "UV-A LED strip, <b>365 nm</b> peak, 12 V, 60 LEDs/m. 395–405 nm strips are cheaper but glow visibly violet and activate the ink less; use them only if the prototype test passes with them."],
                 ["Placement", "Two runs, along the top and bottom inside the glazing frame, in 45° aluminium angle aimed at the shirt. No PMMA/PC diffuser over the LEDs (it blocks UV)."],
                 ["Glazing", "UV-filtering acrylic between guest and LEDs. The guest sees the colour change, not the UV."],
                 ["Behaviour", "Press: UV on for 20 s (adjustable 10–60 s), then off. Presses during a cycle are ignored. Button ring LED on whenever the unit is ready."],
                 ["Button height", "Every press-for-sun button sits at natural reach, 1000–1100 mm above the floor (the Sunbox's sits on a counter at about the same height). Never low enough to be kicked: buttons near the floor become a repair job."],
                 ["Interlock", "NC micro-switch on every door or glazing frame that opens onto the cavity, wired in series with the LED supply. Door open = UV off."],
                 ["Performance", "Print visibly coloured within 10 s of pressing, full colour by 20 s, measured on a Truecolors demo shirt at 20–25 °C. Confirm on prototype."],
                 ["Eye safety", "Aim for the Exempt group under IEC 62471 at any viewing position. Fit a \"UV-A inside: switch off before servicing\" label inside every access door."],
                 ["Option: press counter", "A small microcontroller (e.g. Arduino Nano or ESP32) instead of the timer module, logging presses per day, so Truecolors can report engagement to the venue. Quote as an option."]],
                [32 * mm, FW - 32 * mm])]
    s += [Spacer(1, 4), P("Demo shirts lose some response after many cycles. Truecolors swaps them every 6–8 weeks during restocking; "
                          "make the shirt board swappable in under 2 minutes.", small)]

    # 7 Screen & graphics
    s += section(7, "Screen & graphics", "Screen content and artwork.")
    s += [table([["Item", "Specification"],
                 ["Screen behaviour", "Powers on and plays the loop from USB automatically after a power cut, with no menus or input banners. Use the built-in scheduler to switch it off outside venue hours."],
                 ["Video (supplied)", "MP4, H.264, 1080 × 1920 portrait, 30 fps, 20–40 s seamless loop, no audio. Shows the shade-to-sun change, \"Press for sun\", and \"Sizes at the counter\"."],
                 ["Print artwork", "Supplied by Truecolors as press-ready PDF, CMYK, 3 mm bleed, at 1:1. Maker supplies exact cut sizes from their shop drawings before artwork is finalised."],
                 ["Venue panels", "Lower graphic panels are swappable so each venue can carry its own location-specific design names."]],
                [32 * mm, FW - 32 * mm])]

    # 8 QA
    s += section(8, "Acceptance", "Acceptance tests and handover.")
    s += [table([["#", "Test", "Pass criteria"],
                 ["1", "Dimensions", "Overall ±3 mm; apertures and joinery ±1 mm; glazing sits flush in its frame."],
                 ["2", "Finish", "No visible defects at 1 m under shop lighting; colour matches approved drawdown."],
                 ["3", "Stability (floor units)", "No tipping under 50 N at the top edge in any direction, or at 10° tilt, with screen fitted."],
                 ["4", "Electrical", "Earth continuity and insulation test to local rules; 12 V branches fused; cables tied and relieved."],
                 ["5", "UV module", "20 ± 2 s per press; re-press ignored mid-cycle; interlock cuts UV on every door; no LED visible from outside at 0–1800 mm."],
                 ["6", "Demo response", "Truecolors shirt visibly coloured within 10 s of pressing."],
                 ["7", "Screen", "Auto-plays the loop within 60 s of mains on; no menus; schedule set."],
                 ["8", "Burn-in", "24 h powered with a button press every 5 min (automated); no faults, internal temperature under 40 °C."],
                 ["9", "Documentation", "Photos of each unit, serial plate, wiring diagram inside the access door, 2 keys per unit, spare fuses."]],
                [8 * mm, 38 * mm, FW - 46 * mm])]
    s += [P("Maker deliverables", h2)] + bullets([
        "Shop drawings and a cut list for approval before any material is cut.",
        "Finish drawdowns (charcoal and off-white) and one sample of UV-filter acrylic.",
        "Bench-tested UV module (section 6), then one prototype of each unit for sign-off.",
        "Quotes at the quantities in section 1, with lead time, crating and delivery to the destination.",
        "Ask Truecolors anything unclear before building, at hello@truecolors.global."])
    doc.build(s)
    print("wrote", OUT)


if __name__ == "__main__":
    build()
