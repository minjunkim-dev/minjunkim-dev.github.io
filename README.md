# MINJUN KIM — Mobile Engineer

iOS 중심 모바일 엔지니어 김민준의 경력·프로젝트 소개와 한국어 기술 글을 담은 사이트입니다. Astro의 Content Collections를 사용해 정적 사이트로 빌드하며 GitHub Pages에 배포합니다.

## 구성

- 홈: 주력 기술과 개발 경험, 대표 글
- Writing: 전체 글 목록과 동적 상세 페이지
- About: 경력, 주요 프로젝트별 기여, 추가 경험, 기술, 학력
- SEO: canonical, Open Graph, Twitter Card, JSON-LD
- 피드/검색: RSS, sitemap, robots.txt
- 기타: 반응형 내비게이션, 키보드 포커스, skip link, 404

## 로컬 실행

배포 워크플로와 동일한 Node.js 24와 npm을 사용합니다.

```bash
npm ci
npm run dev
```

기본 개발 서버가 출력하는 로컬 주소에서 확인합니다.

## 검증과 빌드

```bash
npm run check
npm run build
python3 scripts/verify-site.py
npm run preview
```

`npm run build`는 `astro check`를 먼저 실행한 뒤 정적 파일을 `dist/`에 생성합니다.
`python3 scripts/verify-site.py`는 생성된 페이지의 내부 링크와 공개 경력 표기를 검사합니다.
Swift가 설치된 환경에서는 `python3 scripts/verify-swift-sizing.py`로 글에 실린 크기 계산 함수의 정상·비정상 입력을 실행 검증할 수 있습니다. UIKit 디코딩이나 기기 메모리 측정은 별도입니다.

## 글 작성

글은 `src/content/writing/` 아래의 Markdown 파일로 관리합니다.

```yaml
---
title: "글 제목"
description: "검색 결과와 목록에 표시할 요약"
publishedAt: 2026-07-15
updatedAt: 2026-07-16 # 선택
tags:
  - Swift
draft: false
featured: false
---
```

`draft: true`인 글은 페이지, 목록, RSS에서 제외됩니다. 파일명이 글 URL의 slug가 됩니다.

## 디렉터리

```text
src/
├── components/       # 헤더, 푸터, 글 목록 행
├── content/writing/  # Markdown 기술 글
├── data/             # 사이트 메타데이터
├── layouts/          # 공통 HTML/SEO 레이아웃
├── pages/            # Astro 라우트와 RSS
└── styles/           # 전역 디자인 시스템
public/               # favicon, OG 이미지, robots.txt
.github/workflows/    # GitHub Pages 배포
```

## GitHub Pages 배포

`.github/workflows/deploy-pages.yml`은 `main` 브랜치 push 또는 수동 실행 시 다음 순서로 동작합니다.

1. `npm ci`
2. `npm run check`
3. `npm run build`
4. `dist/`를 Pages artifact로 업로드
5. GitHub Pages에 배포

저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정해야 합니다.

## 공개 범위

이 사이트의 글과 경력 설명은 공개 가능한 일반화된 기술 경험만 다룹니다. 회사 기밀, 내부 URL, 고객 정보, 비공개 코드, 검증되지 않은 성과 수치는 포함하지 않습니다.
