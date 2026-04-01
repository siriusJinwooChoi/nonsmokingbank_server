/**
 * 담타 커뮤니티 등 짧은 공개 텍스트용: 금칙어를 "나쁜말"로 치환합니다.
 * 필요 시 BAD_WORDS 배열을 서비스 정책에 맞게 확장하세요.
 */
const REPLACEMENT = "나쁜말";

const BAD_WORDS = [
  "시발",
  "씨발",
  "시팔",
  "ㅅㅂ",
  "ㅆㅂ",
  "개새끼",
  "개새",
  "병신",
  "ㅂㅅ",
  "지랄",
  "ㅈㄹ",
  "좆",
  "좃",
  "섹스",
  "섹1스",
  "성관계",
  "보지",
  "자지",
  "뷰지",
  "쥬지",
  "야동",
  "야사",
  "자위",
  "딸딸이",
  "꼴림",
  "꼴려",
  "fuck",
  "shit",
  "porn",
  "bitch",
  "dick",
  "cock",
  "asshole",
  "nazi",
  "fuk",
  "fck",
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} input
 * @returns {string}
 */
export function sanitizePublicText(input) {
  if (input == null || typeof input !== "string") return "";
  let out = input;
  const sorted = [...BAD_WORDS].sort((a, b) => b.length - a.length);
  for (const w of sorted) {
    if (!w) continue;
    const isAscii = /^[a-zA-Z]+$/.test(w);
    const re = new RegExp(escapeRegExp(w), isAscii ? "gi" : "g");
    out = out.replace(re, REPLACEMENT);
  }
  return out;
}
