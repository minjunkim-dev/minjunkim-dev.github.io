# Minjun Kim — Mobile Engineer

Swift/iOS와 React Native 제품의 출시·운영 경험을 실패 경로 중심으로 기록하는 한국어 기술 블로그입니다. Astro의 Content Collections를 사용해 정적 사이트로 빌드하며 GitHub Pages에 배포합니다.

## 구성

- 홈: 엔지니어링 관점과 대표 글
- Writing: 전체 글 목록과 동적 상세 페이지
- About: 공개 가능한 경력, 프로젝트명, 작업 원칙
- SEO: canonical, Open Graph, Twitter Card, JSON-LD
- 피드/검색: RSS, sitemap, robots.txt
- 기타: 반응형 내비게이션, 키보드 포커스, skip link, 404

## 로컬 실행

Node.js 20 이상과 npm을 사용합니다.

```bash
npm ci
npm run dev
```

기본 개발 서버가 출력하는 로컬 주소에서 확인합니다.

## 검증과 빌드

```bash
npm run check
npm run build
npm run preview
```

`npm run build`는 `astro check`를 먼저 실행한 뒤 정적 파일을 `dist/`에 생성합니다.

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
