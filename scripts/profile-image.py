#!/usr/bin/env python3
"""profile-image — 다섯 채널에 같은 프로필 이미지를 쓰기 위해 만든다.

왜 필요한가.
  계정을 만드는 화면마다 프로필 사진을 물어본다. 그 자리에서 매번 다른 것을 고르면
  다섯 채널이 서로 다른 회사처럼 보이고, 고를 것이 없으면 기본 회색 아바타로 남는다.
  기본 아바타는 "관리되지 않는 계정"으로 읽힌다 — 금융 정보를 파는 계정에서 이건 비싸다.

  블로그 대표 이미지(scripts/blog-thumb.py) · 숏폼(shorts/render.py)과 같은 팔레트,
  같은 폰트다. 세 곳이 같은 회사에서 나온 것으로 보여야 한다.

원형으로 잘리는 것을 전제로 그린다.
  다섯 채널이 전부 프로필 사진을 원으로 자른다. 정사각으로 만들고 네 모서리까지 쓰면
  잘려 나간다. 그래서 글씨를 지름의 안쪽(내접원)에만 넣는다.

쓰는 법.
  python3 scripts/profile-image.py     → dist/profile/profile-1080.png
"""

import os
from PIL import Image, ImageDraw, ImageFont

W = H = 1080
OUT = "dist/profile"

FONT_BOLD = ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 1)
FONT_REG = ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 1)

BG = (12, 16, 30)
FG = (255, 255, 255)
HILITE = (255, 214, 10)


def font(spec, size):
    path, index = spec
    return ImageFont.truetype(path, size, index=index)


def main():
    os.makedirs(OUT, exist_ok=True)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    f_big = font(FONT_BOLD, 300)
    f_small = font(FONT_REG, 92)

    big, small = "IB", "리서치팀"

    # 글자 상자를 중앙 기준(anchor="mm")으로 재고 그 실측값으로 배치한다.
    # 폰트 어센더/디센더를 손으로 빼면 밑줄이 글자를 가로지른다.
    cx, big_cy = W / 2, H * 0.44
    bx0, by0, bx1, by1 = d.textbbox((cx, big_cy), big, font=f_big, anchor="mm")
    d.text((cx, big_cy), big, font=f_big, fill=FG, anchor="mm")

    # 'IB' 아래 형광 밑줄. 숏폼·대표 이미지에서 강조를 쓰는 방식과 같다.
    rule_y = by1 + 34
    d.rectangle([bx0, rule_y, bx1, rule_y + 16], fill=HILITE)

    d.text((cx, rule_y + 16 + 34 + 46), small, font=f_small, fill=FG, anchor="mm")

    path = os.path.join(OUT, "profile-1080.png")
    img.save(path)
    print(f"  {path}  {W}x{H}")

    # 원형으로 잘렸을 때를 미리 본다. 계정 화면에서 처음 보면 늦다.
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, W - 1, H - 1], fill=255)
    circle = Image.new("RGB", (W, H), (233, 236, 239))
    circle.paste(img, (0, 0), mask)
    cpath = os.path.join(OUT, "profile-1080-circle-preview.png")
    circle.save(cpath)
    print(f"  {cpath}  (원형 크롭 확인용)")


if __name__ == "__main__":
    main()
