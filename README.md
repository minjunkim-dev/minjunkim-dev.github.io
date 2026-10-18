# MINJUN KIM — Mobile Engineer

iOS 중심 모바일 엔지니어 김민준의 경력·프로젝트 소개와 한국어 기술 글을 담은 사이트입니다. Astro의 Content Collections를 사용해 정적 사이트로 빌드하며 GitHub Pages에 배포합니다.

## 이 구조를 유지하는 이유

- 글 속 코드의 원본은 테스트되는 파일 하나입니다. 글(MDX)은 `examples/`의 파일 구간을 불러와 보여 줍니다. 그래서 글과 코드가 어긋나지 않습니다. Go 공식 블로그와 같은 방식입니다.
- 서버와 DB 없이 정적 HTML만 배포합니다. 운영할 대상과 공격받을 곳이 줄어듭니다.
- Content Collections 스키마가 글 머리말을 검사합니다. 형식이 틀린 글은 빌드에서 실패합니다.
- 글 속 코드를 CI에서 실행해 검증합니다. 블로그 플랫폼 대신 직접 만든 사이트를 쓰는 이유입니다. TypeScript는 `node --test`, Swift는 `swift test`, UIKit 코드는 iOS Simulator의 `xcodebuild test`로 실행합니다.

2026-10에 Hugo, Jekyll, Swift 생성기(Ignite)와 비교했습니다. Astro가 위 조건을 이미 지키므로 유지합니다. 글이 MDX 불러오기 문법을 쓰므로, 생성기를 바꾸면 이 부분을 옮겨야 합니다.

## 구성

- 홈: 소개 → 주요 프로젝트와 기여 → 경력·기술 → 기술 글
- Writing: 전체 글 목록과 동적 상세 페이지
- About: 경력, 주요 프로젝트별 기여, 추가 경험, 기술, 학력
- SEO: canonical, Open Graph, Twitter Card, JSON-LD
- 피드/검색: RSS, sitemap, robots.txt
- 기타: 반응형 내비게이션, 키보드 포커스, skip link, 404

## 로컬 실행

배포 워크플로와 동일한 Node.js 24와 npm 11.19.0을 사용합니다.
`.npmrc`로 의존성 설치 스크립트를 차단합니다. 현재 빌드에는 예외 허용이 필요하지 않습니다.

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
`npm run check`는 `astro check`, 글 구조 검사(`scripts/verify-article-contracts.mjs`), TypeScript 예제 테스트(`npm run test:examples`)를 실행합니다.
`python3 scripts/verify-site.py`는 생성된 페이지의 내부 링크와 공개 경력 표기를 검사합니다.

Swift 예제는 Xcode가 있는 Mac에서 실행합니다.

```bash
swift test --package-path examples/react-native-force-update-fail-open
swift test --package-path examples/ios-startup-idempotent-initialization
cd examples/imageio-downsampling-memory-stability && xcodebuild test -scheme Thumbnail-Package -destination 'platform=iOS Simulator,name=<iPhone 이름>'
```

ImageIO 예제는 UIKit을 쓰므로 macOS `swift test`가 아니라 iOS Simulator에서 실행합니다. 기기 메모리 측정은 테스트 범위 밖입니다.

## 글 작성

글은 `src/content/writing/<slug>.mdx`로 관리합니다. 코드가 없는 글은 `.md`로 써도 됩니다.

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

### 글 속 코드

1. 코드와 테스트를 `examples/<slug>/`에 둡니다. 폴더는 기술 스택이 아니라 글 단위로 나눕니다. 스택은 `tags`로 분류합니다.
2. 글에 보일 부분을 `// snippet:start <이름>`과 `// snippet:end <이름>`으로 감쌉니다.
3. 글에서 파일을 불러와 `Snippet`으로 보여 줍니다. 구간 이름이 틀리면 빌드가 실패합니다.

```mdx
import Snippet from '../../components/Snippet.astro';
import gate from '../../../examples/<slug>/gate.ts?raw';

<Snippet code={gate} lang="typescript" region="decide-gate" />
```

실행할 수 없는 조각(피해야 할 예시, 화면 연결 스케치)만 글에 직접 씁니다. 예제 코드가 다른 사람이 설치해 쓰는 라이브러리로 자라면 별도 저장소로 옮깁니다.

## 디렉터리

```text
src/
├── components/       # 헤더, 푸터, 글 목록 행, Snippet
├── content/writing/  # 기술 글 (MDX)
├── lib/              # snippet 구간 추출
├── data/             # 사이트 메타데이터
├── layouts/          # 공통 HTML/SEO 레이아웃
├── pages/            # Astro 라우트와 RSS
└── styles/           # 전역 디자인 시스템
examples/<slug>/      # 글마다 실행·테스트하는 코드
public/               # favicon, OG 이미지, robots.txt
.github/workflows/    # PR CI, GitHub Pages 배포
```

## CI

`.github/workflows/ci.yml`은 PR과 `main` push에서 실행합니다.

- `site`(Ubuntu): `npm run check`, `astro build`, `verify-site.py`
- `swift`(macOS): Swift 예제의 `swift test`, ImageIO 예제의 iOS Simulator `xcodebuild test`

공개 저장소라 GitHub 기본 runner 사용에 Actions 분 한도가 적용되지 않습니다.

## GitHub Pages 배포

`.github/workflows/deploy-pages.yml`은 `main` 브랜치 push 또는 수동 실행 시 다음 순서로 동작합니다.

1. npm 11.19.0 선택 후 `npm ci --ignore-scripts --include=dev`
2. `npm audit --include=dev --audit-level=moderate`
3. `npm run check`
4. `npm run build` 및 `python3 scripts/verify-site.py`
5. `dist/`를 Pages artifact로 업로드
6. GitHub Pages에 배포

저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정해야 합니다.

## 공개 범위

이 사이트의 글과 경력 설명은 공개 가능한 일반화된 기술 경험만 다룹니다. 회사 기밀, 내부 URL, 고객 정보, 비공개 코드, 검증되지 않은 성과 수치는 포함하지 않습니다.
