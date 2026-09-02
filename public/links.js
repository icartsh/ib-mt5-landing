(function () {
  "use strict";

  /**
   * 브로커·텔레그램 링크 배선. (IB-10)
   *
   * 원칙 하나로 굴러간다 — **주소가 없으면 그 버튼은 존재하지 않는다.**
   * "준비 중입니다" 버튼이나 죽은 링크를 내보내는 쪽이 없는 것보다 나쁘다. 클릭한 사람이
   * 한 번 실망하면 다시 안 돌아오고, 우리는 그 이탈을 볼 방법조차 없다.
   *
   * 마크업 쪽 계약:
   *   data-link="mim"      → config.mimSignupUrl. 없으면 요소를 지운다.
   *   data-link="telegram" → config.telegramUrl.  없으면 요소를 지운다.
   *   data-fallback        → 위 둘이 모두 지워졌을 때만 보이는 대체 CTA(우리 상담 폼).
   *
   * 링크에는 utm 을 그대로 실어 보낸다. 어느 글에서 온 사람이 브로커까지 갔는지
   * 알 수 없으면 콘텐츠 중에 뭘 더 쓸지 판단할 근거가 사라진다.
   */

  var CFG = window.IB_CONFIG || {};
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

  function currentUtm() {
    var params = new URLSearchParams(location.search);
    var out = {};
    var found = false;

    UTM_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) {
        out[k] = v.slice(0, 120);
        found = true;
      }
    });
    if (found) return out;

    /* app.js 가 first-touch 로 저장해 둔 것을 재사용한다. 페이지를 몇 번 옮겨다녀도
       원래 출처가 유지되도록. (app.js 가 없는 페이지에서는 그냥 비어 있다.) */
    try {
      var saved = JSON.parse(sessionStorage.getItem("ib_attribution") || "null");
      if (saved && saved.utm) return saved.utm;
    } catch (e) {
      /* 프라이빗 모드 등 — 추적 실패가 링크를 막지는 않는다 */
    }
    return {};
  }

  function withUtm(url) {
    var utm = currentUtm();
    var keys = Object.keys(utm);
    if (!keys.length) return url;

    try {
      var u = new URL(url, location.href);

      /* 해시 라우팅(#/register?ib=CODE) 쓰는 포털이 있다. 이런 주소에 searchParams 를 쓰면
         utm 이 해시 **앞**에 붙으면서 주소 모양이 통째로 바뀐다:
           .../#/register?ib=CODE  →  .../?utm_source=x#/register?ib=CODE
         IB 코드가 살아남긴 하지만, 우리가 받은 링크를 우리가 재조립하는 셈이다.
         가입 링크는 수수료가 걸린 유일한 링크다 — utm 을 얻자고 손댈 값이 아니다.
         유입 출처는 어차피 sessionStorage 와 신청 폼에 남는다. 해시가 있으면 원본 그대로 보낸다. */
      if (u.hash) return url;

      keys.forEach(function (k) {
        if (!u.searchParams.has(k)) u.searchParams.set(k, utm[k]);
      });
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  var HREF = {
    mim: typeof CFG.mimSignupUrl === "string" ? CFG.mimSignupUrl.trim() : "",
    telegram: typeof CFG.telegramUrl === "string" ? CFG.telegramUrl.trim() : "",
  };

  var live = { mim: false, telegram: false };

  [].slice.call(document.querySelectorAll("[data-link]")).forEach(function (el) {
    var kind = el.getAttribute("data-link");
    var href = HREF[kind];

    if (!href) {
      el.remove();
      return;
    }

    el.setAttribute("href", withUtm(href));
    el.setAttribute("target", "_blank");
    /* 외부 탭에서 우리 페이지 객체에 접근하지 못하게 한다 (탭내빙 방지) */
    el.setAttribute("rel", "noopener noreferrer");
    live[kind] = true;
  });

  /* 외부 경로가 하나도 살아 있지 않을 때만 대체 CTA 를 보여준다. */
  var anyLive = live.mim || live.telegram;
  [].slice.call(document.querySelectorAll("[data-fallback]")).forEach(function (el) {
    if (anyLive) el.remove();
    else el.hidden = false;
  });

  /* 링크가 하나라도 살아 있으면, 그 옆의 "다른 경로 안내" 문구는 중복이라 지운다. */
  if (live.mim) {
    [].slice.call(document.querySelectorAll("[data-when-no-mim]")).forEach(function (el) {
      el.remove();
    });
  }
})();
