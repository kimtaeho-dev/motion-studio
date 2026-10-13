# sample-crayon — 손그림 3D 샘플

> 참고용 샘플. `films/`로 복사하지 않는다. 화풍이 프리셋에 없을 때 "THREE로 직접 짜되 렌더 계약은 지키는" 방법을 보여준다.
> 크레용이라서가 아니라 기법 때문에 본다: 수채화·종이 공예·판화·픽셀 등 다른 화풍도 같은 뼈대로 짠다.

<inputs>
- 스케치북 위 크레용 로켓이 장난감처럼 부풀어 입체가 되고, 종이 윗변을 찢고 날아갔다가 제자리로 다이빙한다. 9.2초 루프.
- 스타일: 일러스트·손그림 (UI 모션 기본값을 쓰지 않는다: 여러 색, 종이 조각·연기 입자, 스프링 아닌 곡선, 손글씨 문구)
</inputs>

<techniques>
- 화풍 = 캔버스 질감 + 직접 만든 재질: 크레용 빗금·종이결을 2D 캔버스에 그려 CanvasTexture로, MeshToonMaterial(3단 명암) + BackSide 외곽선 헐.
- world() 렌더 방식 옵션: render { toneMapping: 'none', colorSpace: 'linear', clipping: true }, colorManagement: false, environment: false, ambient.
- 윤곽 하나로 2D와 3D: bodyR·noseProf·finPts로 종이 위 2D 그림과 3D Lathe를 같이 만든다 → 그림이 부풀어 입체가 될 때 모양이 튀지 않는다.
- 종이·책상도 3D 평면: 로켓이 실제로 종이 윗변을 뚫고, 다이빙하면 종이 아래로 잘린다(clippingPlanes).
- boil(손그림 떨림): floor(t / 0.13)으로 질감 3벌 중 하나 + 외곽선 굵기·질감 위치를 그 번호의 rng로.
- 입자(연기·종이 조각)도 t의 순수 함수: 태어난 시각·시드를 정해 두고 t에서 위치를 해석식으로 계산한다. 앞 프레임을 이어받지 않는다.
- 질감용 난수는 Stage.film 안에서 같은 시드로 다시 시작한다 → film.json이 바뀌어도 같은 질감.
- 9x16은 아직 없다: 카메라만 물러나면 위아래가 비어 --check 구도에서 실패한다. 세로 포맷은 종이·경로 배치 표를 따로 둬야 한다.
</techniques>
