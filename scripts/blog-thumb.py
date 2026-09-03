#!/usr/bin/env python3
"""blog-thumb — 블로그 5편의 네이버 대표 이미지를 만든다.

왜 필요한가.
  네이버 블로그는 대표 이미지가 없으면 목록·검색 결과에서 썸네일 자리가 비고,
  같은 자리의 다른 글보다 눈에 덜 띈다. 그런데 이미지를 매번 손으로 만들면
  글마다 톤이 갈리고, 만들다 지치면 그냥 안 넣게 된다.

  글씨만 있는 카드라 촬영도 디자인 도구도 필요 없다. 숏폼 렌더러(shorts/render.py)와
  같은 팔레트·같은 폰트를 쓴다 — 블로그와 숏폼이 같은 회사에서 나온 것으로 보여야 한다.

크기.
  1080x1080 정사각. 네이버는 목록에서 썸네일을 정사각으로 자르고, 공유 카드는
  가로로 자른다. 정사각으로 만들고 글씨를 가운데 모으면 어느 쪽으로 잘려도 안 깨진다.

쓰는 법.
  python3 scripts/blog-thumb.py        → dist/blog-thumb/*.png
"""

import os
from PIL import Image, ImageDraw, ImageFont

W = H = 1080
OUT = "dist/blog-thumb"

FONT_BOLD = ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 1)
FONT_REG = ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 1)

BG = (12, 16, 30)
FG = (255, 255, 255)
MUTED = (150, 163, 187)
HILITE = (255, 214, 10)
INK = (14, 14, 14)

# 편별 카드. kicker = 위쪽 작은 라벨, lines = 큰 글씨(리스트 한 줄이 한 행),
# hilite = 형광 배경을 깔 행 번호(0-based). 없으면 -1.
CARDS = [
    {
        "file": "b01-margin.png",
        "kicker": "해외선물 증거금",
        "lines": ["증거금 다 넣었는데", "왜 청산될까"],
        "hilite": 1,
        "foot": "개시증거금 · 유지증거금",
    },
    {
        "file": "b02-cost.png",
        "kicker": "해외선물 수수료",
        "lines": ["수수료 한 줄만 봤다면", "총비용은 다릅니다"],
        "hilite": 1,
        "foot": "왕복 · 환전 · 보유 비용",
    },
    {
        "file": "b03-tax.png",
        "kicker": "해외선물 세금",
        "lines": ["얼마부터", "신고해야 할까"],
        "hilite": 1,
        "foot": "양도소득세 계산과 신고 시기",
    },
    {
        "file": "b04-nasdaq.png",
        "kicker": "미니나스닥",
        "lines": ["같은 나스닥100인데", "상품이 갈립니다"],
        "hilite": 1,
        "foot": "거래소 선물 · 지수 CFD",
    },
    {
        "file": "b05-howto.png",
        "kicker": "해외선물 하는법",
        "lines": ["계좌부터", "만들지 마세요"],
        "hilite": 1,
        "foot": "시작 전 확인할 6단계",
    },
]

_cache = {}


def font(spec, size):
    key = (spec, size)
    if key not in _cache:
        path, index = spec
        _cache[key] = ImageFont.truetype(path, size, index=index)
    return _cache[key]


def fit(draw, text, spec, start, max_w):
    """글자 수가 늘어도 카드 밖으로 나가지 않게 크기를 줄여 맞춘다."""
    size = start
    while size > 40:
        f = font(spec, size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 4
    return font(spec, size)


def render(card):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    pad = 90
    max_w = W - pad * 2

    # 위쪽 라벨 — 어떤 주제의 글인지 0.5초 안에 알리는 자리
    kf = font(FONT_REG, 46)
    d.text((pad, 150), card["kicker"], font=kf, fill=MUTED)
    d.line([(pad, 232), (pad + 120, 232)], fill=HILITE, width=6)

    # 큰 글씨 — 가운데 정렬이 아니라 왼쪽 정렬이다. 두 줄의 시작점이 어긋나면 읽는 속도가 떨어진다.
    fonts = [fit(d, ln, FONT_BOLD, 104, max_w) for ln in card["lines"]]
    heights = [int(f.size * 1.34) for f in fonts]
    y = (H - sum(heights)) // 2 - 20
    for n, (ln, f, lh) in enumerate(zip(card["lines"], fonts, heights)):
        if n == card["hilite"]:
            tw = d.textlength(ln, font=f)
            d.rectangle(
                [pad - 14, y + int(f.size * 0.16), pad + tw + 14, y + int(f.size * 1.18)],
                fill=HILITE,
            )
            d.text((pad, y), ln, font=f, fill=INK)
        else:
            d.text((pad, y), ln, font=f, fill=FG)
        y += lh

    # 아래 한 줄 — 본문에서 무엇을 얻는지. 여기까지 읽으면 클릭 이유가 생긴다.
    ff = font(FONT_REG, 42)
    d.text((pad, H - 190), card["foot"], font=ff, fill=MUTED)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    for card in CARDS:
        path = os.path.join(OUT, card["file"])
        render(card).save(path, "PNG")
        print(f"  {card['file']}  ({os.path.getsize(path) // 1024}KB)")
    print(f"\nPASS  대표 이미지 {len(CARDS)}장 — 1080x1080, 네이버 글쓰기에서 본문 맨 위에 넣는다.")


if __name__ == "__main__":
    main()
