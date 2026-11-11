// Defect catalog (EP001 lessons). Later: <WORKSPACE>/00_채널공통/defects.json
export const DEFECTS: { id: string; label: string; fix: string }[] = [
  { id: "sash", label: "허리띠 생김", fix: "허리가 화면 밖인 클로즈업으로 시작·끝 프레임 둘 다 다시" },
  { id: "sun-disc", label: "해 원반 (넷째 날 이전)", fix: "sun/dawn 단어 금지, 광원 없는 확산광을 긍정형으로, GPT 끝 프레임" },
  { id: "face-profile", label: "옆얼굴·얼굴", fix: "뒷모습 고정 문구, 끝 프레임으로 제한, 문제 구간 트림" },
  { id: "hair-drift", label: "머리 모양 변화", fix: "트림 이음새 금지, 시작·끝 프레임으로 재생성" },
  { id: "hand-deformed", label: "손 기형", fix: "키프레임에서 손가락 5개·엄지 확인, 같은 이미지를 시작·끝 프레임으로" },
  { id: "fish-cutaway", label: "물속 단면·물고기", fix: "수면 위에서만 보는 구도로 키프레임 다시" },
  { id: "roots-exposed", label: "뿌리 노출·흙 단면", fix: "\"roots hidden, no cross-section\"" },
  { id: "static-sea", label: "바다가 멈춤", fix: "시작 프레임만 + 물 움직임 중심 프롬프트 + Quality" },
  { id: "scene-jump", label: "다른 장면으로 튐", fix: "트림 또는 시작·끝 프레임으로 재생성" },
  { id: "duplicate-composition", label: "구도 중복", fix: "다른 구도로 키프레임 다시" },
  { id: "style-mismatch", label: "화풍 불일치", fix: "시리즈 스타일 문구 강조, 다시 생성" },
  { id: "land-animals", label: "다섯째 날 육지 동물", fix: "로케이션을 날짜 하나에 하나로 분리" },
  { id: "apple", label: "사과 열매", fix: "무화과형 열매 명시" },
  { id: "text-in-image", label: "그림 속 글자", fix: "화면 글자는 편집 단계 캡션으로" },
];
export const defectLabel = (id: string) => DEFECTS.find((d) => d.id === id)?.label ?? id;

export const STATUSES: { id: string; label: string }[] = [
  { id: "design", label: "샷 설계" },
  { id: "keyframe", label: "키프레임" },
  { id: "kf-review", label: "키프레임 검수" },
  { id: "video", label: "영상 생성" },
  { id: "review", label: "검수 중" },
  { id: "fix", label: "수정 필요" },
  { id: "adopted", label: "채택" },
];
export const statusLabel = (id: string) => STATUSES.find((s) => s.id === id)?.label ?? id;

export const STATE_LABEL: Record<string, string> = {
  adopted: "채택", history: "이력", superseded: "교체됨", rejected: "폐기", alternative: "대안", candidate: "후보",
};
export const ROLE_LABEL: Record<string, string> = {
  start: "시작", end: "끝", "start+end": "시작=끝", still: "정지", render: "편집용",
};
export const MOTIONS = ["zoomIn", "zoomOut", "panLeft", "panRight", "driftUp", "static"];
