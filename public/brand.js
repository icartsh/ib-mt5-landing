(function () {
  "use strict";

  /**
   * 푸터 사업자 표기. 모든 페이지가 같은 푸터를 쓰므로 여기 한 곳에서만 채운다.
   * (원래 app.js 안에 있었는데, 폼이 없는 콘텐츠 페이지가 생기면서 밖으로 뺐다.
   *  같은 일을 하는 코드가 두 벌이 되면 한쪽만 고치는 사고가 난다.)
   */
  var CFG = window.IB_CONFIG || {};

  function fill(id, value) {
    var el = document.getElementById(id);
    if (el && value) el.textContent = value;
  }

  fill("brand-name", CFG.brandName);
  fill("brand-contact", CFG.brandContact);
})();
