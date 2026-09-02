(function () {
  "use strict";

  var CFG = window.IB_CONFIG || {};
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var STORE_KEY = "ib_attribution";

  /* ------------------------------------------------------------------ */
  /* 유입 추적 — 세션 내 first-touch 를 유지한다.                        */
  /* 링크를 타고 들어온 뒤 페이지를 새로고침해도 utm 이 날아가지 않도록.  */
  /* ------------------------------------------------------------------ */

  function readAttribution() {
    var params = new URLSearchParams(location.search);
    var fromUrl = {};
    var hasUtm = false;

    UTM_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) {
        fromUrl[k] = v.slice(0, 120);
        hasUtm = true;
      }
    });

    var saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
    } catch (e) {
      saved = null;
    }

    // URL 에 utm 이 있으면 그것이 이번 방문의 진짜 출처다. 없으면 저장분을 쓴다.
    if (!hasUtm && saved) return saved;

    var attribution = {
      utm: fromUrl,
      referrer: (document.referrer || "").slice(0, 300),
      landingPath: location.pathname + location.search,
    };

    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(attribution));
    } catch (e) {
      /* 사파리 프라이빗 모드 등 — 추적 실패가 폼을 막지는 않는다 */
    }
    return attribution;
  }

  var attribution = readAttribution();

  /* utm_source 가 유입 경로 선택지와 맞아떨어지면 미리 골라 준다.
     사용자는 언제든 바꿀 수 있고, 저장되는 값은 어디까지나 사용자가 고른 값이다. */
  var SOURCE_MAP = {
    naver_blog: "네이버 블로그",
    blog: "네이버 블로그",
    naver: "네이버 검색",
    naver_search: "네이버 검색",
    instagram: "인스타그램",
    ig: "인스타그램",
    youtube: "유튜브",
    yt: "유튜브",
  };

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */

  var form = document.getElementById("lead-form");
  var statusEl = document.getElementById("form-status");
  var submitBtn = document.getElementById("submit-btn");
  var donePanel = document.getElementById("done-panel");
  var stickyCta = document.getElementById("sticky-cta");

  /* 카카오 링크: 주소가 없으면 버튼을 숨긴다 (죽은 링크를 노출하지 않는다) */
  ["kakao-link", "kakao-link-2"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    if (CFG.kakaoUrl) el.href = CFG.kakaoUrl;
    else el.hidden = true;
  });

  var talkSection = document.getElementById("talk");
  if (talkSection && !CFG.kakaoUrl) talkSection.hidden = true;

  /* 카카오 버튼을 감춘 경우, 그 버튼을 가리키던 안내 문장도 같이 바꾼다 */
  var doneLead = document.getElementById("done-lead");
  if (doneLead && !CFG.kakaoUrl) {
    doneLead.textContent = "담당자가 남겨주신 연락처로 1:1 연락드립니다.";
  }

  if (CFG.brandName) document.getElementById("brand-name").textContent = CFG.brandName;
  if (CFG.brandContact) document.getElementById("brand-contact").textContent = CFG.brandContact;

  /* 리드 수집 서버가 붙지 않은 배포(디자인 검토용)에서는 그 사실을 숨기지 않는다.
     실제 신청자가 접수된 줄 알고 기다리는 상황을 만들면 안 된다. */
  if (!CFG.leadEndpoint) {
    var banner = document.createElement("div");
    banner.className = "preview-banner";
    banner.textContent = "검토용 프리뷰입니다 — 신청은 아직 접수되지 않습니다.";
    document.body.insertBefore(banner, document.body.firstChild);
  }

  /* 개인정보 처리 안내 토글 */
  var privacyToggle = document.getElementById("privacy-toggle");
  var privacyDetail = document.getElementById("privacy-detail");
  if (privacyToggle && privacyDetail) {
    privacyToggle.addEventListener("click", function (e) {
      e.preventDefault();
      var open = privacyDetail.hidden;
      privacyDetail.hidden = !open;
      privacyToggle.setAttribute("aria-expanded", String(open));
      privacyToggle.textContent = open ? "접기" : "내용 보기";
    });
  }

  /* 유입 경로 기본 선택 */
  var sourceSelect = document.getElementById("source");
  var mapped = SOURCE_MAP[String(attribution.utm.utm_source || "").toLowerCase()];
  if (sourceSelect && mapped) sourceSelect.value = mapped;

  /* 폼이 화면에 보이면 하단 고정 CTA 를 치운다 (버튼 중복 방지) */
  var applySection = document.getElementById("apply");
  if (stickyCta && applySection && "IntersectionObserver" in window) {
    new IntersectionObserver(
      function (entries) {
        stickyCta.classList.toggle("is-hidden", entries[0].isIntersecting);
      },
      { threshold: 0 }
    ).observe(applySection);
  }

  /* ------------------------------------------------------------------ */
  /* 검증                                                                */
  /* ------------------------------------------------------------------ */

  function setError(name, message) {
    var slot = form.querySelector('[data-err="' + name + '"]');
    if (slot) slot.textContent = message || "";
    var input = form.elements[name];
    if (input && input.setAttribute && !input.length) {
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }

  function normalizePhone(raw) {
    return String(raw || "").replace(/[\s.\-()]/g, "");
  }

  function validate(values) {
    var errors = {};

    if (!values.name || values.name.length < 2) {
      errors.name = "이름을 2자 이상 입력해 주세요.";
    }

    var phone = normalizePhone(values.contact);
    // 010-xxxx-xxxx 형태를 기본으로 받되, 일반 유선/국제번호도 허용한다.
    if (!phone) errors.contact = "연락처를 입력해 주세요.";
    else if (!/^\+?\d{9,15}$/.test(phone)) errors.contact = "연락처 형식을 확인해 주세요. (예: 010-1234-5678)";

    if (!values.experience) errors.experience = "거래 경험 수준을 선택해 주세요.";
    if (!values.source) errors.source = "유입 경로를 선택해 주세요.";
    if (!values.consent) errors.consent = "개인정보 수집·이용에 동의해 주셔야 신청이 가능합니다.";

    return errors;
  }

  function collect() {
    var experience = form.querySelector('input[name="experience"]:checked');
    return {
      name: form.elements.name.value.trim(),
      contact: form.elements.contact.value.trim(),
      experience: experience ? experience.value : "",
      source: form.elements.source.value,
      consent: form.elements.consent.checked,
      company: form.elements.company.value, // honeypot
    };
  }

  /* ------------------------------------------------------------------ */
  /* 제출                                                                */
  /* ------------------------------------------------------------------ */

  var submitting = false;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submitting) return;

    var values = collect();
    var errors = validate(values);

    ["name", "contact", "experience", "source", "consent"].forEach(function (k) {
      setError(k, errors[k]);
    });

    var firstError = Object.keys(errors)[0];
    if (firstError) {
      statusEl.textContent = "";
      var el = form.querySelector('[data-err="' + firstError + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    if (!CFG.leadEndpoint) {
      statusEl.className = "form-status is-error";
      statusEl.textContent =
        "현재 페이지는 디자인 확인용 프리뷰입니다. 신청은 아직 접수되지 않습니다.";
      return;
    }

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "신청 접수 중…";
    statusEl.className = "form-status";
    statusEl.textContent = "";

    var payload = {
      name: values.name,
      contact: values.contact,
      contactNormalized: normalizePhone(values.contact),
      experience: values.experience,
      source: values.source,
      consent: true,
      company: values.company,
      attribution: attribution,
      page: location.href.slice(0, 500),
      submittedAt: new Date().toISOString(),
    };

    fetch(CFG.leadEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (r) {
        if (!r.ok || !r.body || !r.body.ok) {
          throw new Error((r.body && r.body.error) || "저장에 실패했습니다.");
        }
        form.hidden = true;
        donePanel.hidden = false;
        donePanel.scrollIntoView({ block: "center", behavior: "smooth" });
        if (stickyCta) stickyCta.hidden = true;
      })
      .catch(function (err) {
        statusEl.className = "form-status is-error";
        statusEl.textContent =
          "신청 접수에 실패했습니다. 잠시 후 다시 시도해 주세요. (" + err.message + ")";
      })
      .then(function () {
        submitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "내 조건으로 비용 계산받기";
      });
  });

  /* 입력을 고치면 해당 오류 메시지는 바로 지운다 */
  form.addEventListener("input", function (e) {
    if (e.target && e.target.name) setError(e.target.name, "");
  });
  form.addEventListener("change", function (e) {
    if (e.target && e.target.name) setError(e.target.name, "");
  });
})();
