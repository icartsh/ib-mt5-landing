/**
 * 구글 시트에 리드를 쌓는 웹훅. 리드를 시트로 받고 싶을 때만 쓴다.
 *
 * 붙이는 순서
 *  1. 구글 시트를 새로 만든다. 첫 시트 이름을 "leads" 로 바꾼다.
 *  2. 확장 프로그램 → Apps Script → 이 파일 내용을 통째로 붙여 넣는다.
 *  3. 배포 → 새 배포 → 유형: 웹 앱
 *       - 실행 계정: 나
 *       - 액세스 권한: 모든 사용자   ← 서버가 호출해야 하므로 필요하다
 *  4. 발급된 웹앱 URL 을 서버 .env 의 SHEETS_WEBHOOK_URL 에 넣는다.
 *
 * 주의: "모든 사용자" 로 열리는 엔드포인트다. 주소를 아는 사람은 누구나 쓰기 요청을
 * 보낼 수 있으므로 URL 자체를 비밀로 취급한다. 필요하면 SHARED_SECRET 를 켠다.
 */

// 비워 두면 검사하지 않는다. 쓰려면 서버에서 payload 에 secret 을 함께 보내야 한다.
var SHARED_SECRET = '';

var HEADERS = [
  '접수시각', '이름', '연락처', '거래경험', '유입경로(응답)',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'referrer', '동의', '리드ID'
];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && data.secret !== SHARED_SECRET) {
      return json({ ok: false, error: 'unauthorized' });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('leads')
      || SpreadsheetApp.getActiveSpreadsheet().insertSheet('leads');

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
    }

    var utm = (data.attribution && data.attribution.utm) || {};

    sheet.appendRow([
      data.receivedAt || new Date().toISOString(),
      data.name || '',
      // 앞자리 0 이 잘리지 않도록 텍스트로 강제한다.
      "'" + (data.contact || ''),
      data.experience || '',
      data.source || '',
      utm.utm_source || '',
      utm.utm_medium || '',
      utm.utm_campaign || '',
      utm.utm_content || '',
      (data.attribution && data.attribution.referrer) || '',
      data.consent ? 'Y' : 'N',
      data.id || ''
    ]);

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
