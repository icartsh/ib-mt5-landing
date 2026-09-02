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
   *   data-link="telegram" → config.telegramUrl. 비어 있으면 **서버에 물어본다**.
   *   data-fallback        → 위 둘이 모두 지워졌을 때만 보이는 대체 CTA(우리 상담 폼).
   *
   * ## 텔레그램 주소만 서버에 물어보는 이유
   *
   * 이 버튼의 진짜 실패는 "링크가 없는 것" 이 아니라 **읽는 사람이 없는 봇을 가리키는
   * 것**이다. 봇에 온 메시지는 아무도 꺼내지 않으면 24시간 뒤 사라지는데, 고객 화면에는
   * 대화창이 열리고 전송도 정상으로 보인다. 고객은 답을 기다리고 우리는 문의가 왔다는
   * 사실조차 모른다.
   *
   * 어느 봇을 실제로 읽고 있는지는 서버의 환경변수가 정한다(server/config.mjs 의
   * resolveInquiryBot). 그 값을 여기에 손으로 옮겨 적으면 언젠가 반드시 어긋나고,
   * 어긋난 순간 화면에는 아무 이상이 없다. 그래서 주소를 적어 두는 대신
   * `/api/health` 가 알려주는 `sinks.inquiry` 를 그대로 따른다 — 읽을 준비가 된
   * 봇이 있으면 그 봇을 걸고, 없으면 버튼을 지운다. 손으로 맞출 것이 없어진다.
   *
   * config.telegramUrl 에 주소를 적어 두면 그쪽이 이긴다(서버에 묻지 않는다).
   * 서버가 없는 환경에서 페이지만 열어 보는 경우를 위해 남겨 둔 문이다.
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

  /**
   * 텔레그램은 utm 파라미터를 읽지 않는다. 붙여 봐야 아무도 읽지 못하는 글자가 주소에
   * 늘어날 뿐이다. 대신 **봇 주소(t.me/xxx_bot)** 에는 텔레그램이 공식으로 지원하는
   * `?start=<페이로드>` 로 실어 보낸다 — 봇이 `/start <페이로드>` 로 받으므로
   * 문의를 받는 쪽에서 어느 글을 보고 온 문의인지 구분할 수 있다.
   * 봇이 페이로드를 쓰지 않더라도 사용자 화면은 똑같다(그냥 대화가 열린다).
   * 채널·그룹 주소에는 이 자리가 없으므로 받은 주소를 그대로 내보낸다.
   */
  function telegramHref(url) {
    try {
      var u = new URL(url, location.href);
      if (u.hostname !== "t.me" || !/_?bot$/i.test(u.pathname.replace(/^\//, ""))) return url;

      var utm = currentUtm();
      var payload = [utm.utm_source, utm.utm_campaign]
        .filter(Boolean)
        .join("-")
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 64); /* 텔레그램 제한: 64자, A-Z a-z 0-9 _ - */

      if (!payload) return url;
      u.search = "";
      u.searchParams.set("start", payload);
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

  function wire(kind, href) {
    var wired = false;
    [].slice.call(document.querySelectorAll('[data-link="' + kind + '"]')).forEach(function (el) {
      if (!href) {
        el.remove();
        return;
      }
      el.setAttribute("href", kind === "telegram" ? telegramHref(href) : withUtm(href));
      el.setAttribute("target", "_blank");
      /* 외부 탭에서 우리 페이지 객체에 접근하지 못하게 한다 (탭내빙 방지) */
      el.setAttribute("rel", "noopener noreferrer");
      wired = true;
    });
    live[kind] = wired;
  }

  /* 대체 CTA 와 안내 문구는 텔레그램 답이 온 뒤에 한 번만 정리한다. 먼저 정리해 버리면
     서버가 봇을 알려줬을 때 이미 지워진 뒤라 되돌릴 수 없다. */
  function settle() {
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
  }

  wire("mim", HREF.mim);

  if (HREF.telegram) {
    /* 주소가 적혀 있으면 그대로 쓴다 — 서버가 없는 환경에서도 페이지가 돈다. */
    wire("telegram", HREF.telegram);
    settle();
  } else {
    /* 답이 오기 전까지는 버튼을 감춰 둔다. 눌렀는데 주소가 없는 상태를 만들지 않기 위해서다.
       (요소를 지우지는 않는다 — 답이 오면 되살려야 한다.) */
    [].slice.call(document.querySelectorAll('[data-link="telegram"]')).forEach(function (el) {
      el.hidden = true;
    });

    askServer(function (username) {
      [].slice.call(document.querySelectorAll('[data-link="telegram"]')).forEach(function (el) {
        el.hidden = false;
      });
      wire("telegram", username ? "https://t.me/" + username : "");
      settle();
    });
  }

  /**
   * `/api/health` 에게 "지금 문의를 실제로 읽고 있는 봇" 을 묻는다.
   *
   * 못 물어봤거나(오프라인·404) 준비가 안 된 상태면 빈 값으로 답한다 — 그러면 버튼이
   * 사라지고 대체 CTA(우리 상담 폼)가 나온다. 확실하지 않을 때 버튼을 남기는 쪽이
   * 훨씬 나쁘다. 그 경우 문의는 조용히 사라지고 우리는 그 사실을 모른다.
   */
  function askServer(done) {
    var settled = false;
    function finish(username) {
      if (settled) return;
      settled = true;
      done(username);
    }

    /* 서버가 늦게 답하면 사람은 이미 스크롤을 내려가 버린다. 3초를 넘기면 없는 것으로 본다. */
    var timer = setTimeout(function () {
      finish("");
    }, 3000);

    try {
      fetch("/api/health", { headers: { Accept: "application/json" } })
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (body) {
          clearTimeout(timer);
          var inquiry = (body && body.sinks && body.sinks.inquiry) || null;
          /* ready 가 아니면 토큰·webhook·목적지 중 뭔가가 빠진 상태다. 봇 주소는 알아도
             그 끝이 비어 있으므로 거는 것이 아니라 지우는 것이 맞다. */
          if (!inquiry || !inquiry.ready) return finish("");
          finish(String(inquiry.username || "").replace(/^@/, ""));
        })
        .catch(function () {
          clearTimeout(timer);
          finish("");
        });
    } catch (e) {
      clearTimeout(timer);
      finish("");
    }
  }
})();
